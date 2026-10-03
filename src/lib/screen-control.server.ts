import { verifyAppToken } from "@/lib/user-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type ScreenStatus = "pending" | "active" | "declined" | "ended" | "expired";
type SignalType = "offer" | "answer" | "ice";
type SessionRecord = {
  id: string;
  requester_id: string;
  target_id: string;
  status: ScreenStatus;
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

// Browsers throttle timers aggressively in background tabs. Keep a live
// screen-share participant online long enough for its 30-second app heartbeat
// to recover after throttling or a short network suspension.
const ONLINE_WINDOW_MS = 5 * 60_000;
const REQUEST_WINDOW_MS = 2 * 60_000;
const ACTIVE_STATUSES: ScreenStatus[] = ["pending", "active"];

async function requireCurrentUser(sessionToken: string) {
  const parsed = await verifyAppToken(sessionToken);
  if (!parsed) throw new Error("Your app session is invalid or expired. Please sign in again.");

  // The generated Supabase schema omits several legacy/custom-auth tables.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;
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

  return { db, uid: parsed.uid as string, user };
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function endSignals(db: any, sessionId: string) {
  await db.from("screen_control_signals").delete().eq("session_id", sessionId);
}

async function expireStaleSessions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  rows: SessionRecord[],
  onlineIds: Set<string>,
  currentUserId: string,
) {
  const now = Date.now();
  for (const row of rows) {
    if (!ACTIVE_STATUSES.includes(row.status)) continue;
    // Presence is only a request-routing signal. Once a request is active,
    // WebRTC owns the connection and background-tab heartbeat throttling must
    // not terminate the session. Active sessions end explicitly or when the
    // screen owner stops the capture track.
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

export async function getScreenControlState(sessionToken: string) {
  const { db, uid, user } = await requireCurrentUser(sessionToken);
  const onlineSince = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
  const { data: liveRows, error: liveError } = await db
    .from("user_sessions")
    .select("user_id,last_seen_at")
    .gt("last_seen_at", onlineSince);
  if (liveError) throw new Error("Could not check which users are online.");

  const onlineIds = new Set<string>(
    ((liveRows ?? []) as { user_id: string }[]).map((row) => row.user_id),
  );
  onlineIds.add(uid);
  const { data: appUsers, error: usersError } = await db
    .from("app_users")
    .select("id,username,full_name,role,is_active,is_paused")
    .in("id", [...onlineIds])
    .eq("is_active", true)
    .eq("is_paused", false);
  if (usersError) throw new Error("Could not load online users.");

  const onlineProfiles = (appUsers ?? []) as AppUserRow[];
  const profiles = new Map<string, AppUserRow>(onlineProfiles.map((row) => [row.id, row]));
  const validOnlineIds = new Set<string>(onlineProfiles.map((row) => row.id));
  validOnlineIds.add(uid);
  const sessionColumns =
    "id,requester_id,target_id,status,created_at,accepted_at,ended_at,ended_by,end_reason";
  const [liveSessions, recentSessions] = await Promise.all([
    db
      .from("screen_control_sessions")
      .select(sessionColumns)
      .or(`requester_id.eq.${uid},target_id.eq.${uid}`)
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: false }),
    db
      .from("screen_control_sessions")
      .select(sessionColumns)
      .or(`requester_id.eq.${uid},target_id.eq.${uid}`)
      .in("status", ["declined", "ended", "expired"])
      .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  if (liveSessions.error || recentSessions.error)
    throw new Error("Could not load screen-control requests.");

  const ownRows = (
    [...(liveSessions.data ?? []), ...(recentSessions.data ?? [])] as SessionRecord[]
  ).sort((a, b) => b.created_at.localeCompare(a.created_at));
  await expireStaleSessions(db, ownRows, validOnlineIds, uid);

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

  return {
    me: { id: uid, name: user.full_name || user.username, username: user.username },
    onlineUsers: onlineProfiles
      .filter((row) => row.id !== uid)
      .map((row) => ({
        id: row.id,
        name: row.full_name || row.username,
        username: row.username,
        role: row.role,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    sessions: ownRows.map((row) => {
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
    }),
  };
}

export async function createScreenControlRequest(sessionToken: string, targetId: string) {
  const { db, uid } = await requireCurrentUser(sessionToken);
  if (!targetId || targetId === uid) throw new Error("Choose another online user.");

  const { data: targetSession } = await db
    .from("user_sessions")
    .select("user_id,last_seen_at")
    .eq("user_id", targetId)
    .gt("last_seen_at", new Date(Date.now() - ONLINE_WINDOW_MS).toISOString())
    .maybeSingle();
  if (!targetSession)
    throw new Error("That user is no longer online. Refresh the list and try again.");

  const { data: targetUser } = await db
    .from("app_users")
    .select("id,is_active,is_paused")
    .eq("id", targetId)
    .maybeSingle();
  if (!targetUser?.is_active || targetUser?.is_paused)
    throw new Error("That account cannot receive a screen-control request.");

  const { data, error } = await db
    .from("screen_control_sessions")
    .insert({ requester_id: uid, target_id: targetId, status: "pending" })
    .select("id,requester_id,target_id,status,created_at,accepted_at,ended_at,ended_by,end_reason")
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
  const { db, uid } = await requireCurrentUser(sessionToken);
  const { data: request, error: loadError } = await db
    .from("screen_control_sessions")
    .select("id,requester_id,target_id,status,created_at")
    .eq("id", sessionId)
    .eq("target_id", uid)
    .eq("status", "pending")
    .maybeSingle();
  if (loadError || !request) throw new Error("This screen-control request is no longer available.");

  const { data: requesterSession } = await db
    .from("user_sessions")
    .select("user_id,last_seen_at")
    .eq("user_id", request.requester_id)
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
    : terminalUpdate("declined", uid, "declined_by_target");
  const { data, error } = await db
    .from("screen_control_sessions")
    .update(update)
    .eq("id", sessionId)
    .eq("target_id", uid)
    .eq("status", "pending")
    .select("id,requester_id,target_id,status,created_at,accepted_at,ended_at,ended_by,end_reason")
    .maybeSingle();
  if (error || !data) throw new Error("Could not update this screen-control request.");
  return data;
}

export async function endScreenControlSession(
  sessionToken: string,
  sessionId: string,
  reason = "ended_by_user",
) {
  const { db, uid } = await requireCurrentUser(sessionToken);
  const { data, error } = await db
    .from("screen_control_sessions")
    .update(terminalUpdate("ended", uid, reason))
    .eq("id", sessionId)
    .or(`requester_id.eq.${uid},target_id.eq.${uid}`)
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
  const { db, uid } = await requireCurrentUser(sessionToken);
  if (!["offer", "answer", "ice"].includes(signalType))
    throw new Error("Unsupported connection signal.");
  const serialized = JSON.stringify(payload);
  if (!serialized || serialized.length > 32_000) throw new Error("Connection signal is too large.");

  const { data: session, error: sessionError } = await db
    .from("screen_control_sessions")
    .select("id,requester_id,target_id,status")
    .eq("id", sessionId)
    .eq("status", "active")
    .maybeSingle();
  if (sessionError || !session || ![session.requester_id, session.target_id].includes(uid))
    throw new Error("The screen-control session is not active.");
  if (signalType === "offer" && session.target_id !== uid)
    throw new Error("Only the screen owner can start the connection.");
  if (signalType === "answer" && session.requester_id !== uid)
    throw new Error("Only the requesting user can answer the connection.");

  const { count: signalCount, error: countError } = await db
    .from("screen_control_signals")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);
  if (countError) throw new Error("Could not validate screen connection signals.");
  if ((signalCount ?? 0) >= 300)
    throw new Error("The screen connection has too many signaling messages.");

  const recipientId = session.requester_id === uid ? session.target_id : session.requester_id;
  const { error } = await db.from("screen_control_signals").insert({
    session_id: sessionId,
    sender_id: uid,
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
  const { db, uid } = await requireCurrentUser(sessionToken);
  if (!Number.isSafeInteger(afterId) || afterId < 0)
    throw new Error("Invalid screen signal cursor.");
  const { data: session, error: sessionError } = await db
    .from("screen_control_sessions")
    .select("id,requester_id,target_id,status")
    .eq("id", sessionId)
    .eq("status", "active")
    .maybeSingle();
  if (sessionError || !session || ![session.requester_id, session.target_id].includes(uid))
    throw new Error("The screen-control session has ended.");

  const { data, error } = await db
    .from("screen_control_signals")
    .select("id,sender_id,signal_type,payload,created_at")
    .eq("session_id", sessionId)
    .eq("recipient_id", uid)
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
  if (!parsed) return false;
  // The generated Supabase schema omits several legacy/custom-auth tables.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;
  const { data: currentSession } = await db
    .from("user_sessions")
    .select("user_id,session_token")
    .eq("user_id", parsed.uid)
    .maybeSingle();
  if (!currentSession || currentSession.session_token !== sessionToken) return false;

  const { data: rows } = await db
    .from("screen_control_sessions")
    .select("id")
    .or(`requester_id.eq.${parsed.uid},target_id.eq.${parsed.uid}`)
    .in("status", ACTIVE_STATUSES);
  const { error } = await db
    .from("screen_control_sessions")
    .update(terminalUpdate("ended", parsed.uid, reason))
    .or(`requester_id.eq.${parsed.uid},target_id.eq.${parsed.uid}`)
    .in("status", ACTIVE_STATUSES);
  if (error) return false;
  for (const row of rows ?? []) await endSignals(db, row.id);
  return true;
}
