import { verifyAppToken } from "@/lib/user-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  endGuestShareSession,
  guestParticipantRef,
  pruneExpiredGuestShareData,
  resolveGuestShareIdentity,
} from "@/lib/guest-share.server";
import type { GuestShareDb, GuestShareIdentity } from "@/lib/guest-share.server";

type ScreenStatus = "pending" | "active" | "declined" | "ended" | "expired";
type SignalType = "offer" | "answer" | "ice";
type SessionRecord = {
  id: string;
  requester_id: string;
  target_id: string;
  status: ScreenStatus;
  share_scope: "app" | "system";
  created_at: string;
  accepted_at: string | null;
  ended_at: string | null;
  ended_by: string | null;
  end_reason: string | null;
};
type AppUserRow = {
  id: string;
  username: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  is_paused: boolean;
};
type MixedSessionRow = {
  id: string;
  requester_ref: string;
  target_ref: string;
  requester_name: string;
  target_name: string;
  status: ScreenStatus;
  share_scope: "app" | "system";
  created_at: string;
  accepted_at: string | null;
  ended_at: string | null;
  ended_by_ref: string | null;
  end_reason: string | null;
};
type Participant =
  | {
      kind: "user";
      id: string;
      ref: string;
      name: string;
      username: string;
      db: GuestShareDb;
      user: AppUserRow;
    }
  | (GuestShareIdentity & { db: GuestShareDb });

// Browsers throttle timers aggressively in background tabs. Keep a live
// screen-share participant online long enough for its heartbeat to recover.
const ONLINE_WINDOW_MS = 5 * 60_000;
const REQUEST_WINDOW_MS = 2 * 60_000;
const ACTIVE_STATUSES: ScreenStatus[] = ["pending", "active"];
const RECENT_STATUSES: ScreenStatus[] = ["declined", "ended", "expired"];
const GUEST_REF_PATTERN = /^guest:([0-9a-f-]{36})$/i;
const USER_ID_PATTERN = /^[0-9a-f-]{36}$/i;

// The generated Supabase schema omits several custom-auth and guest tables.

function adminDb(): GuestShareDb {
  return supabaseAdmin as GuestShareDb;
}

function isMissingGuestSchema(error: { code?: string } | null | undefined) {
  return error?.code === "42P01";
}

async function requireCurrentUser(sessionToken: string) {
  const parsed = await verifyAppToken(sessionToken);
  if (!parsed) throw new Error("Your app session is invalid or expired. Please sign in again.");

  const db = adminDb();
  const { data: liveSession, error: sessionError } = await db
    .from("user_sessions")
    .select("session_token,last_seen_at")
    .eq("user_id", parsed.uid)
    .maybeSingle();
  if (sessionError) throw new Error("Could not verify the active app session.");
  if (!liveSession || liveSession.session_token !== sessionToken)
    throw new Error("Your app session is no longer active. Please sign in again.");
  if (Date.now() - new Date(liveSession.last_seen_at).getTime() > ONLINE_WINDOW_MS * 2)
    throw new Error("Your app session expired. Please refresh and sign in again.");

  const { data: user, error: userError } = await db
    .from("app_users")
    .select("id,username,full_name,role,is_active,is_paused")
    .eq("id", parsed.uid)
    .maybeSingle();
  if (userError || !user?.is_active || user?.is_paused)
    throw new Error("This account is not allowed to start a screen-control session.");

  return { db, uid: parsed.uid as string, user: user as AppUserRow };
}

async function requireParticipant(sessionToken: string): Promise<Participant> {
  if (await verifyAppToken(sessionToken)) {
    const { db, uid, user } = await requireCurrentUser(sessionToken);
    return {
      kind: "user",
      id: uid,
      ref: `user:${uid}`,
      name: user.full_name || user.username,
      username: user.username,
      db,
      user,
    };
  }
  const db = adminDb();
  const guest = await resolveGuestShareIdentity(sessionToken, db);
  if (!guest) throw new Error("Your temporary guest session expired. Rejoin the share page.");
  return { ...guest, db };
}

function terminalUpdate(
  status: "ended" | "expired" | "declined",
  endedBy: string | null,
  reason: string,
) {
  const now = new Date().toISOString();
  return {
    status,
    updated_at: now,
    ended_at: now,
    ended_by: endedBy,
    end_reason: reason,
  };
}

function mixedTerminalUpdate(
  status: "ended" | "expired" | "declined",
  endedByRef: string | null,
  reason: string,
) {
  const now = new Date().toISOString();
  return {
    status,
    updated_at: now,
    ended_at: now,
    ended_by_ref: endedByRef,
    end_reason: reason,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function endSignals(db: any, sessionId: string) {
  await db.from("screen_control_signals").delete().eq("session_id", sessionId);
}

async function endMixedSignals(db: GuestShareDb, sessionId: string) {
  await db.from("guest_screen_control_signals").delete().eq("session_id", sessionId);
}

function participantIdFromRef(ref: string) {
  if (ref.startsWith("guest:")) return ref;
  return ref.startsWith("user:") ? ref.slice("user:".length) : ref;
}

function formatMixedSession(row: MixedSessionRow) {
  const requesterId = participantIdFromRef(row.requester_ref);
  const targetId = participantIdFromRef(row.target_ref);
  return {
    id: row.id,
    requester_id: requesterId,
    target_id: targetId,
    status: row.status,
    share_scope: row.share_scope,
    created_at: row.created_at,
    accepted_at: row.accepted_at,
    ended_at: row.ended_at,
    ended_by: row.ended_by_ref,
    end_reason: row.end_reason,
    requester: { id: requesterId, name: row.requester_name },
    target: { id: targetId, name: row.target_name },
  };
}

async function guestSchemaIsReady(db: GuestShareDb) {
  const { error } = await db.from("screen_control_guests").select("id").limit(1);
  if (isMissingGuestSchema(error)) return false;
  if (error) throw new Error("Could not check temporary guest screen-share availability.");
  return true;
}

async function loadMixedSessions(db: GuestShareDb, participantRef: string) {
  const filterForParticipant = () =>
    db
      .from("guest_screen_control_sessions")
      .select("*")
      .or(`requester_ref.eq.${participantRef},target_ref.eq.${participantRef}`);
  const [live, recent] = await Promise.all([
    filterForParticipant()
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: false })
      .limit(20),
    filterForParticipant()
      .in("status", RECENT_STATUSES)
      .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  if (live.error || recent.error) {
    const error = live.error || recent.error;
    if (isMissingGuestSchema(error)) return [] as MixedSessionRow[];
    throw new Error("Could not load guest screen-control requests.");
  }
  return ([...(live.data ?? []), ...(recent.data ?? [])] as MixedSessionRow[]).sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
}

async function isParticipantOnline(db: GuestShareDb, ref: string) {
  const onlineSince = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
  const guestMatch = ref.match(GUEST_REF_PATTERN);
  if (guestMatch) {
    const { data, error } = await db
      .from("screen_control_guests")
      .select("id")
      .eq("id", guestMatch[1])
      .gt("last_seen_at", onlineSince)
      .maybeSingle();
    if (error) return false;
    return Boolean(data);
  }
  const userId = ref.startsWith("user:") ? ref.slice(5) : ref;
  if (!USER_ID_PATTERN.test(userId)) return false;
  const { data: session, error: sessionError } = await db
    .from("user_sessions")
    .select("user_id")
    .eq("user_id", userId)
    .gt("last_seen_at", onlineSince)
    .maybeSingle();
  if (sessionError || !session) return false;
  const { data: user, error: userError } = await db
    .from("app_users")
    .select("id,is_active,is_paused")
    .eq("id", userId)
    .maybeSingle();
  return Boolean(!userError && user?.is_active && !user?.is_paused);
}

async function expireStaleSessions(
  db: GuestShareDb,
  rows: SessionRecord[],
  onlineIds: Set<string>,
  currentUserId: string,
) {
  const now = Date.now();
  for (const row of rows) {
    if (!ACTIVE_STATUSES.includes(row.status)) continue;
    // Active WebRTC sessions end explicitly or when the owner stops capture;
    // background-tab heartbeat throttling must not terminate them.
    if (row.status === "active") continue;
    const peerId = row.requester_id === currentUserId ? row.target_id : row.requester_id;
    const expiredRequest =
      row.status === "pending" && now - new Date(row.created_at).getTime() > REQUEST_WINDOW_MS;
    const peerOffline = !onlineIds.has(peerId);
    if (!expiredRequest && !peerOffline) continue;
    await db
      .from("screen_control_sessions")
      .update(
        terminalUpdate("expired", null, expiredRequest ? "request_timeout" : "participant_offline"),
      )
      .eq("id", row.id)
      .in("status", ACTIVE_STATUSES);
    await endSignals(db, row.id);
    row.status = "expired";
    row.end_reason = expiredRequest ? "request_timeout" : "participant_offline";
  }
}

async function expireStaleMixedSessions(
  db: GuestShareDb,
  rows: MixedSessionRow[],
  onlineRefs: Set<string>,
  currentRef: string,
) {
  const now = Date.now();
  for (const row of rows) {
    if (row.status !== "pending") continue;
    const peerRef = row.requester_ref === currentRef ? row.target_ref : row.requester_ref;
    const expiredRequest = now - new Date(row.created_at).getTime() > REQUEST_WINDOW_MS;
    if (!expiredRequest && onlineRefs.has(peerRef)) continue;
    const reason = expiredRequest ? "request_timeout" : "participant_offline";
    await db
      .from("guest_screen_control_sessions")
      .update(mixedTerminalUpdate("expired", null, reason))
      .eq("id", row.id)
      .eq("status", "pending");
    await endMixedSignals(db, row.id);
    row.status = "expired";
    row.end_reason = reason;
  }
}

function parseTarget(targetId: string) {
  const guestMatch = targetId.match(GUEST_REF_PATTERN);
  if (guestMatch) return { kind: "guest" as const, id: guestMatch[1], ref: targetId };
  const userId = targetId.startsWith("user:") ? targetId.slice(5) : targetId;
  if (!USER_ID_PATTERN.test(userId)) throw new Error("Choose an online user from the list.");
  return { kind: "user" as const, id: userId, ref: `user:${userId}` };
}

async function userHasLiveSession(db: GuestShareDb, userId: string) {
  const { count, error } = await db
    .from("screen_control_sessions")
    .select("id", { count: "exact", head: true })
    .in("status", ACTIVE_STATUSES)
    .or(`requester_id.eq.${userId},target_id.eq.${userId}`);
  if (error) throw new Error("Could not verify whether this user is already in a screen session.");
  return (count ?? 0) > 0;
}

export async function getScreenControlState(sessionToken: string) {
  const participant = await requireParticipant(sessionToken);
  const { db } = participant;
  const hasGuestSchema = await guestSchemaIsReady(db);
  if (hasGuestSchema) await pruneExpiredGuestShareData(db);

  const onlineSince = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
  const { data: liveRows, error: liveError } = await db
    .from("user_sessions")
    .select("user_id,last_seen_at")
    .gt("last_seen_at", onlineSince);
  if (liveError) throw new Error("Could not check which users are online.");

  const onlineIds = new Set<string>(
    ((liveRows ?? []) as { user_id: string }[]).map((row) => row.user_id),
  );
  if (participant.kind === "user") onlineIds.add(participant.id);
  const appUsersResult = onlineIds.size
    ? await db
        .from("app_users")
        .select("id,username,full_name,role,is_active,is_paused")
        .in("id", [...onlineIds])
        .eq("is_active", true)
        .eq("is_paused", false)
    : { data: [], error: null };
  if (appUsersResult.error) throw new Error("Could not load online users.");

  const onlineProfiles = (appUsersResult.data ?? []) as AppUserRow[];
  const profiles = new Map<string, AppUserRow>(onlineProfiles.map((row) => [row.id, row]));
  const validOnlineIds = new Set<string>(onlineProfiles.map((row) => row.id));
  if (participant.kind === "user") validOnlineIds.add(participant.id);

  let onlineGuests: Array<{ id: string; username: string; last_seen_at: string }> = [];
  if (hasGuestSchema) {
    const { data: guestRows, error: guestError } = await db
      .from("screen_control_guests")
      .select("id,username,last_seen_at")
      .gt("last_seen_at", onlineSince)
      .order("last_seen_at", { ascending: false })
      .limit(500);
    if (guestError) throw new Error("Could not load online guest participants.");
    onlineGuests = guestRows ?? [];
  }

  const sessionColumns =
    "id,requester_id,target_id,status,share_scope,created_at,accepted_at,ended_at,ended_by,end_reason";
  let ownRows: SessionRecord[] = [];
  if (participant.kind === "user") {
    const [liveSessions, recentSessions] = await Promise.all([
      db
        .from("screen_control_sessions")
        .select(sessionColumns)
        .or(`requester_id.eq.${participant.id},target_id.eq.${participant.id}`)
        .in("status", ACTIVE_STATUSES)
        .order("created_at", { ascending: false }),
      db
        .from("screen_control_sessions")
        .select(sessionColumns)
        .or(`requester_id.eq.${participant.id},target_id.eq.${participant.id}`)
        .in("status", RECENT_STATUSES)
        .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    if (liveSessions.error || recentSessions.error)
      throw new Error("Could not load screen-control requests.");
    ownRows = (
      [...(liveSessions.data ?? []), ...(recentSessions.data ?? [])] as SessionRecord[]
    ).sort((a, b) => b.created_at.localeCompare(a.created_at));
    await expireStaleSessions(db, ownRows, validOnlineIds, participant.id);
  }

  let mixedRows: MixedSessionRow[] = [];
  if (hasGuestSchema) {
    mixedRows = await loadMixedSessions(db, participant.ref);
    const onlineRefs = new Set<string>([
      ...onlineProfiles.map((row) => `user:${row.id}`),
      ...onlineGuests.map((row) => guestParticipantRef(row.id)),
      participant.ref,
    ]);
    await expireStaleMixedSessions(db, mixedRows, onlineRefs, participant.ref);
  }

  const relatedIds = new Set<string>([...onlineIds]);
  for (const row of ownRows) {
    relatedIds.add(row.requester_id);
    relatedIds.add(row.target_id);
  }
  const missingProfileIds = [...relatedIds].filter((id) => !profiles.has(id));
  if (missingProfileIds.length) {
    const { data: additionalUsers } = await db
      .from("app_users")
      .select("id,username,full_name,role,is_active,is_paused")
      .in("id", missingProfileIds);
    for (const row of (additionalUsers ?? []) as AppUserRow[]) profiles.set(row.id, row);
  }

  const legacySessions = ownRows.map((row) => {
    const requesterProfile = profiles.get(row.requester_id);
    const targetProfile = profiles.get(row.target_id);
    return {
      ...row,
      requester: {
        id: row.requester_id,
        name: requesterProfile ? requesterProfile.full_name || requesterProfile.username : "User",
      },
      target: {
        id: row.target_id,
        name: targetProfile ? targetProfile.full_name || targetProfile.username : "User",
      },
    };
  });
  const sessions = [...legacySessions, ...mixedRows.map(formatMixedSession)].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );

  return {
    me: {
      id: participant.id,
      name: participant.name,
      username: participant.username,
      kind: participant.kind,
    },
    onlineUsers: [
      ...onlineProfiles
        .filter((row) => participant.kind !== "user" || row.id !== participant.id)
        .map((row) => ({
          id: row.id,
          name: row.full_name || row.username,
          username: row.username,
          role: row.role,
          kind: "user" as const,
        })),
      ...onlineGuests
        .filter((row) => guestParticipantRef(row.id) !== participant.ref)
        .map((row) => ({
          id: guestParticipantRef(row.id),
          name: row.username,
          username: row.username,
          role: "Guest",
          kind: "guest" as const,
        })),
    ].sort((a, b) => a.name.localeCompare(b.name)),
    sessions,
  };
}

export async function createScreenControlRequest(
  sessionToken: string,
  targetId: string,
  shareScope: "app" | "system",
) {
  const participant = await requireParticipant(sessionToken);
  const { db } = participant;
  if (!targetId || !["app", "system"].includes(shareScope))
    throw new Error("Choose whether to request the app or the full system.");
  const target = parseTarget(targetId);
  if (target.ref === participant.ref) throw new Error("Choose another online user.");
  if (participant.kind === "guest" && target.kind === "guest")
    throw new Error(
      "Guest-to-guest sessions are not allowed. An ERP user must be one of the two participants.",
    );

  let targetName = "";
  if (target.kind === "guest") {
    const { data: guest, error } = await db
      .from("screen_control_guests")
      .select("id,username,last_seen_at")
      .eq("id", target.id)
      .gt("last_seen_at", new Date(Date.now() - ONLINE_WINDOW_MS).toISOString())
      .maybeSingle();
    if (error || !guest)
      throw new Error("That guest is no longer online. Refresh the list and try again.");
    targetName = guest.username;
  } else {
    const { data: targetSession } = await db
      .from("user_sessions")
      .select("user_id,last_seen_at")
      .eq("user_id", target.id)
      .gt("last_seen_at", new Date(Date.now() - ONLINE_WINDOW_MS).toISOString())
      .maybeSingle();
    if (!targetSession)
      throw new Error("That user is no longer online. Refresh the list and try again.");

    const { data: targetUser } = await db
      .from("app_users")
      .select("id,username,full_name,role,is_active,is_paused")
      .eq("id", target.id)
      .maybeSingle();
    if (!targetUser?.is_active || targetUser?.is_paused)
      throw new Error("That account cannot receive a screen-control request.");
    targetName = targetUser.full_name || targetUser.username;
  }

  if (participant.kind === "guest" || target.kind === "guest") {
    if (!(await guestSchemaIsReady(db)))
      throw new Error("Temporary guest screen sharing is not configured in the database yet.");
    if (participant.kind === "user" && (await userHasLiveSession(db, participant.id)))
      throw new Error("You are already in another screen-control session.");
    if (target.kind === "user" && (await userHasLiveSession(db, target.id)))
      throw new Error("That user is already in another screen-control session.");

    const requesterRef = participant.ref;
    const targetRef = target.ref;
    if (!requesterRef.startsWith("user:") && !targetRef.startsWith("user:"))
      throw new Error("A guest must connect with an authenticated ERP user, not another guest.");
    const { data, error } = await db
      .from("guest_screen_control_sessions")
      .insert({
        requester_ref: requesterRef,
        target_ref: targetRef,
        requester_name: participant.name.slice(0, 64),
        target_name: targetName.slice(0, 64),
        status: "pending",
        share_scope: shareScope,
      })
      .select("*")
      .single();
    if (error) {
      if (
        error.code === "23505" ||
        /already in another screen-control session/i.test(error.message ?? "")
      )
        throw new Error("One of these users is already in another screen-control session.");
      if (/guest_screen_control_requires_erp_user/i.test(error.message ?? ""))
        throw new Error("A guest must connect with an authenticated ERP user, not another guest.");
      throw new Error("Could not send the screen-control request.");
    }
    return formatMixedSession(data as MixedSessionRow);
  }

  // User-to-user sessions keep using the existing ERP session table.
  const { data, error } = await db
    .from("screen_control_sessions")
    .insert({
      requester_id: participant.id,
      target_id: target.id,
      status: "pending",
      share_scope: shareScope,
    })
    .select(
      "id,requester_id,target_id,status,share_scope,created_at,accepted_at,ended_at,ended_by,end_reason",
    )
    .single();
  if (error) {
    if (error.code === "23505")
      throw new Error("One of these users is already in another screen-control session.");
    throw new Error("Could not send the screen-control request.");
  }
  return data;
}

export async function respondToScreenControlRequest(
  sessionToken: string,
  sessionId: string,
  accept: boolean,
) {
  const participant = await requireParticipant(sessionToken);
  const { db } = participant;

  const { data: mixedRequest, error: mixedLoadError } = await db
    .from("guest_screen_control_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("target_ref", participant.ref)
    .eq("status", "pending")
    .maybeSingle();
  if (!mixedLoadError && mixedRequest) {
    if (!(await isParticipantOnline(db, mixedRequest.requester_ref))) {
      await db
        .from("guest_screen_control_sessions")
        .update(mixedTerminalUpdate("expired", null, "requester_offline"))
        .eq("id", sessionId)
        .eq("status", "pending");
      await endMixedSignals(db, sessionId);
      throw new Error("The requesting participant went offline.");
    }
    const update = accept
      ? {
          status: "active",
          accepted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      : mixedTerminalUpdate("declined", participant.ref, "declined_by_target");
    const { data, error } = await db
      .from("guest_screen_control_sessions")
      .update(update)
      .eq("id", sessionId)
      .eq("target_ref", participant.ref)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();
    if (error || !data) throw new Error("Could not update this screen-control request.");
    if (!accept) await endMixedSignals(db, sessionId);
    return formatMixedSession(data as MixedSessionRow);
  }
  if (mixedLoadError && !isMissingGuestSchema(mixedLoadError))
    throw new Error("Could not check this screen-control request.");
  if (participant.kind === "guest")
    throw new Error("This screen-control request is no longer available.");

  const { data: incomingRequest, error: loadError } = await db
    .from("screen_control_sessions")
    .select("id,requester_id,target_id,status,share_scope,created_at")
    .eq("id", sessionId)
    .eq("target_id", participant.id)
    .eq("status", "pending")
    .maybeSingle();
  if (loadError || !incomingRequest)
    throw new Error("This screen-control request is no longer available.");

  const { data: requesterSession } = await db
    .from("user_sessions")
    .select("user_id,last_seen_at")
    .eq("user_id", incomingRequest.requester_id)
    .gt("last_seen_at", new Date(Date.now() - ONLINE_WINDOW_MS).toISOString())
    .maybeSingle();
  if (!requesterSession) {
    await db
      .from("screen_control_sessions")
      .update(terminalUpdate("expired", null, "requester_offline"))
      .eq("id", sessionId);
    throw new Error("The requesting user went offline.");
  }

  const update = accept
    ? {
        status: "active",
        accepted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    : terminalUpdate("declined", participant.id, "declined_by_target");
  const { data, error } = await db
    .from("screen_control_sessions")
    .update(update)
    .eq("id", sessionId)
    .eq("target_id", participant.id)
    .eq("status", "pending")
    .select(
      "id,requester_id,target_id,status,share_scope,created_at,accepted_at,ended_at,ended_by,end_reason",
    )
    .maybeSingle();
  if (error || !data) throw new Error("Could not update this screen-control request.");
  return data;
}

export async function endScreenControlSession(
  sessionToken: string,
  sessionId: string,
  reason = "ended_by_user",
) {
  const participant = await requireParticipant(sessionToken);
  const { db } = participant;
  const { data: mixed, error: mixedError } = await db
    .from("guest_screen_control_sessions")
    .select("id,requester_ref,target_ref")
    .eq("id", sessionId)
    .maybeSingle();
  if (!mixedError && mixed && [mixed.requester_ref, mixed.target_ref].includes(participant.ref)) {
    const { data, error } = await db
      .from("guest_screen_control_sessions")
      .update(mixedTerminalUpdate("ended", participant.ref, reason))
      .eq("id", sessionId)
      .in("status", ACTIVE_STATUSES)
      .select("id")
      .maybeSingle();
    if (error) throw new Error("Could not end the screen-control session.");
    if (data?.id) await endMixedSignals(db, sessionId);
    return { ended: Boolean(data?.id) };
  }
  if (mixedError && !isMissingGuestSchema(mixedError))
    throw new Error("Could not check the screen-control session.");
  if (participant.kind === "guest") return { ended: false };

  const { data, error } = await db
    .from("screen_control_sessions")
    .update(terminalUpdate("ended", participant.id, reason))
    .eq("id", sessionId)
    .or(`requester_id.eq.${participant.id},target_id.eq.${participant.id}`)
    .in("status", ACTIVE_STATUSES)
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Could not end the screen-control session.");
  if (data?.id) await endSignals(db, sessionId);
  return { ended: Boolean(data?.id) };
}

export async function sendScreenControlSignal(
  sessionToken: string,
  sessionId: string,
  signalType: SignalType,
  payload: Record<string, unknown>,
) {
  const participant = await requireParticipant(sessionToken);
  const { db } = participant;
  if (!["offer", "answer", "ice"].includes(signalType))
    throw new Error("Unsupported connection signal.");
  const serialized = JSON.stringify(payload);
  if (!serialized || serialized.length > 32_000) throw new Error("Connection signal is too large.");

  const { data: mixed, error: mixedError } = await db
    .from("guest_screen_control_sessions")
    .select("id,requester_ref,target_ref,status")
    .eq("id", sessionId)
    .eq("status", "active")
    .maybeSingle();
  if (!mixedError && mixed) {
    if (![mixed.requester_ref, mixed.target_ref].includes(participant.ref))
      throw new Error("The screen-control session is not active for this participant.");
    if (signalType === "offer" && mixed.target_ref !== participant.ref)
      throw new Error("Only the screen owner can start the connection.");
    if (signalType === "answer" && mixed.requester_ref !== participant.ref)
      throw new Error("Only the requesting user can answer the connection.");
    const { count, error: countError } = await db
      .from("guest_screen_control_signals")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId);
    if (countError) throw new Error("Could not validate screen connection signals.");
    if ((count ?? 0) >= 300)
      throw new Error("The screen connection has too many signaling messages.");
    const recipientRef =
      mixed.requester_ref === participant.ref ? mixed.target_ref : mixed.requester_ref;
    const { error } = await db.from("guest_screen_control_signals").insert({
      session_id: sessionId,
      sender_ref: participant.ref,
      recipient_ref: recipientRef,
      signal_type: signalType,
      payload,
    });
    if (error) throw new Error("Could not exchange the screen connection signal.");
    return { ok: true };
  }
  if (mixedError && !isMissingGuestSchema(mixedError))
    throw new Error("Could not check the screen-control session.");
  if (participant.kind === "guest") throw new Error("The screen-control session has ended.");

  const { data: session, error: sessionError } = await db
    .from("screen_control_sessions")
    .select("id,requester_id,target_id,status")
    .eq("id", sessionId)
    .eq("status", "active")
    .maybeSingle();
  if (
    sessionError ||
    !session ||
    ![session.requester_id, session.target_id].includes(participant.id)
  )
    throw new Error("The screen-control session is not active.");
  if (signalType === "offer" && session.target_id !== participant.id)
    throw new Error("Only the screen owner can start the connection.");
  if (signalType === "answer" && session.requester_id !== participant.id)
    throw new Error("Only the requesting user can answer the connection.");

  const { count: signalCount, error: countError } = await db
    .from("screen_control_signals")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);
  if (countError) throw new Error("Could not validate screen connection signals.");
  if ((signalCount ?? 0) >= 300)
    throw new Error("The screen connection has too many signaling messages.");
  const recipientId =
    session.requester_id === participant.id ? session.target_id : session.requester_id;
  const { error } = await db.from("screen_control_signals").insert({
    session_id: sessionId,
    sender_id: participant.id,
    recipient_id: recipientId,
    signal_type: signalType,
    payload,
  });
  if (error) throw new Error("Could not exchange the screen connection signal.");
  return { ok: true };
}

export async function receiveScreenControlSignals(
  sessionToken: string,
  sessionId: string,
  afterId: number,
) {
  const participant = await requireParticipant(sessionToken);
  const { db } = participant;
  if (!Number.isSafeInteger(afterId) || afterId < 0)
    throw new Error("Invalid screen signal cursor.");

  const { data: mixed, error: mixedError } = await db
    .from("guest_screen_control_sessions")
    .select("id,requester_ref,target_ref,status")
    .eq("id", sessionId)
    .eq("status", "active")
    .maybeSingle();
  if (!mixedError && mixed) {
    if (![mixed.requester_ref, mixed.target_ref].includes(participant.ref))
      throw new Error("The screen-control session has ended.");
    const { data, error } = await db
      .from("guest_screen_control_signals")
      .select("id,sender_ref,signal_type,payload,created_at")
      .eq("session_id", sessionId)
      .eq("recipient_ref", participant.ref)
      .gt("id", afterId)
      .order("id", { ascending: true })
      .limit(50);
    if (error) throw new Error("Could not receive screen connection signals.");
    return (
      (data ?? []) as Array<{ id: number | string; sender_ref: string; [key: string]: unknown }>
    ).map((row) => ({
      ...row,
      sender_id: participantIdFromRef(row.sender_ref),
      id: Number(row.id),
    }));
  }
  if (mixedError && !isMissingGuestSchema(mixedError))
    throw new Error("Could not check the screen-control session.");
  if (participant.kind === "guest") throw new Error("The screen-control session has ended.");

  const { data: session, error: sessionError } = await db
    .from("screen_control_sessions")
    .select("id,requester_id,target_id,status")
    .eq("id", sessionId)
    .eq("status", "active")
    .maybeSingle();
  if (
    sessionError ||
    !session ||
    ![session.requester_id, session.target_id].includes(participant.id)
  )
    throw new Error("The screen-control session has ended.");

  const { data, error } = await db
    .from("screen_control_signals")
    .select("id,sender_id,signal_type,payload,created_at")
    .eq("session_id", sessionId)
    .eq("recipient_id", participant.id)
    .gt("id", afterId)
    .order("id", { ascending: true })
    .limit(50);
  if (error) throw new Error("Could not receive screen connection signals.");
  return ((data ?? []) as Array<{ id: number | string; [key: string]: unknown }>).map((row) => ({
    ...row,
    id: Number(row.id),
  }));
}

export async function endScreenControlSessionsForToken(sessionToken: string, reason: string) {
  const parsed = await verifyAppToken(sessionToken);
  if (!parsed) return endGuestShareSession(sessionToken);
  const { uid } = parsed;
  const db = adminDb();
  const { data: currentSession } = await db
    .from("user_sessions")
    .select("user_id,session_token")
    .eq("user_id", uid)
    .maybeSingle();
  if (!currentSession || currentSession.session_token !== sessionToken) return false;

  const { data: rows } = await db
    .from("screen_control_sessions")
    .select("id")
    .or(`requester_id.eq.${uid},target_id.eq.${uid}`)
    .in("status", ACTIVE_STATUSES);
  const { error } = await db
    .from("screen_control_sessions")
    .update(terminalUpdate("ended", uid, reason))
    .or(`requester_id.eq.${uid},target_id.eq.${uid}`)
    .in("status", ACTIVE_STATUSES);
  if (error) return false;
  for (const row of rows ?? []) await endSignals(db, row.id);

  const userRef = `user:${uid}`;
  const { data: mixedRows, error: mixedError } = await db
    .from("guest_screen_control_sessions")
    .select("id")
    .or(`requester_ref.eq.${userRef},target_ref.eq.${userRef}`)
    .in("status", ACTIVE_STATUSES);
  if (!mixedError) {
    await db
      .from("guest_screen_control_sessions")
      .update(mixedTerminalUpdate("ended", userRef, reason))
      .or(`requester_ref.eq.${userRef},target_ref.eq.${userRef}`)
      .in("status", ACTIVE_STATUSES);
    for (const row of mixedRows ?? []) await endMixedSignals(db, row.id);
  } else if (!isMissingGuestSchema(mixedError)) return false;
  return true;
}
