import { createServerFn } from "@tanstack/react-start";
import { verifyAppToken } from "@/lib/user-auth";

export type MeetUser = {
  id: string;
  username: string;
  full_name: string;
  role: string;
};

export type MeetParticipant = MeetUser & {
  status: "invited" | "joined" | "left";
  joined_at: string | null;
};

export type MeetRecord = {
  id: string;
  title: string;
  status: "live" | "ended";
  created_at: string;
  started_at: string;
  created_by: string;
  participants: MeetParticipant[];
  my_status: "invited" | "joined" | "left";
};

export type MeetSignal = {
  id: number;
  sender_id: string;
  kind: "offer" | "answer" | "ice" | "media";
  payload: MeetSignalPayload;
};

export type MeetSignalPayload = Record<string, string | number | boolean | null>;

type MeetingRow = Pick<
  MeetRecord,
  "id" | "title" | "status" | "created_at" | "started_at" | "created_by"
>;

async function getActor(sessionToken: string) {
  const parsed = await verifyAppToken(sessionToken);
  if (!parsed) throw new Error("Your session has expired. Please sign in again.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // The generated Supabase database types do not yet include the meeting migration tables.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;
  const { data: user, error } = await db
    .from("app_users")
    .select("id,username,full_name,role,is_active")
    .eq("id", parsed.uid)
    .maybeSingle();
  if (error || !user || !user.is_active || user.role !== parsed.role) {
    throw new Error("Your account is no longer active. Please sign in again.");
  }
  const { data: activeSession } = await db
    .from("user_sessions")
    .select("session_token")
    .eq("user_id", parsed.uid)
    .maybeSingle();
  if (activeSession && activeSession.session_token !== sessionToken) {
    throw new Error("This session is no longer active. Please sign in again.");
  }
  return { db, user: user as MeetUser };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireMeetingAccess(db: any, meetingId: string, userId: string) {
  const { data: member, error } = await db
    .from("meeting_participants")
    .select("status")
    .eq("meeting_id", meetingId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !member) throw new Error("You are not invited to this meeting.");
  return member as { status: "invited" | "joined" | "left" };
}

export const serverListMeetUsers = createServerFn({ method: "POST" })
  .validator((data: { sessionToken: string }) => data)
  .handler(async ({ data }): Promise<MeetUser[]> => {
    const { db, user } = await getActor(data.sessionToken);
    if (user.role !== "admin") throw new Error("Only administrators can invite participants.");
    const { data: users, error } = await db
      .from("app_users")
      .select("id,username,full_name,role")
      .eq("is_active", true)
      .neq("id", user.id)
      .order("full_name", { ascending: true });
    if (error) throw new Error("Could not load the active user list.");
    return (users ?? []) as MeetUser[];
  });

export const serverCreateMeeting = createServerFn({ method: "POST" })
  .validator((data: { sessionToken: string; title: string; inviteeIds: string[] }) => data)
  .handler(async ({ data }): Promise<string> => {
    const { db, user } = await getActor(data.sessionToken);
    if (user.role !== "admin") throw new Error("Only administrators can create meetings.");
    const title = data.title.trim().slice(0, 100) || "Team meeting";
    const inviteeIds = [...new Set(data.inviteeIds)].filter((id) => id !== user.id).slice(0, 100);
    const { data: invitees, error: inviteeError } = await db
      .from("app_users")
      .select("id")
      .eq("is_active", true)
      .in("id", inviteeIds.length ? inviteeIds : ["00000000-0000-0000-0000-000000000000"]);
    if (inviteeError) throw new Error("Could not validate meeting participants.");

    const now = new Date().toISOString();
    const { data: meeting, error: meetingError } = await db
      .from("meetings")
      .insert({ title, status: "live", created_by: user.id, started_at: now })
      .select("id")
      .single();
    if (meetingError || !meeting) throw new Error("Could not start the meeting.");

    const memberRows = [
      { meeting_id: meeting.id, user_id: user.id, status: "joined", joined_at: now },
      ...((invitees ?? []) as { id: string }[]).map(({ id }) => ({
        meeting_id: meeting.id,
        user_id: id,
        status: "invited",
      })),
    ];
    const { error: memberError } = await db.from("meeting_participants").insert(memberRows);
    if (memberError) {
      await db.from("meetings").delete().eq("id", meeting.id);
      throw new Error("Could not invite participants. The meeting was not started.");
    }
    // Prune expired signaling data opportunistically; signal payloads only live for a day.
    await db
      .from("meeting_signals")
      .delete()
      .lt("created_at", new Date(Date.now() - 86_400_000).toISOString());
    return meeting.id as string;
  });

export const serverListMeetings = createServerFn({ method: "POST" })
  .validator((data: { sessionToken: string }) => data)
  .handler(async ({ data }): Promise<MeetRecord[]> => {
    const { db, user } = await getActor(data.sessionToken);
    let meetingRows: MeetingRow[] = [];
    if (user.role === "admin") {
      const { data: rows, error } = await db
        .from("meetings")
        .select("id,title,status,created_at,started_at,created_by")
        .eq("status", "live")
        .order("created_at", { ascending: false });
      if (error) throw new Error("Could not load meetings.");
      meetingRows = (rows ?? []) as MeetingRow[];
    } else {
      const { data: members, error: memberError } = await db
        .from("meeting_participants")
        .select("meeting_id,status")
        .eq("user_id", user.id);
      if (memberError) throw new Error("Could not load your meeting invitations.");
      const ids = ((members ?? []) as { meeting_id: string }[]).map((row) => row.meeting_id);
      if (!ids.length) return [];
      const { data: rows, error } = await db
        .from("meetings")
        .select("id,title,status,created_at,started_at,created_by")
        .eq("status", "live")
        .in("id", ids)
        .order("created_at", { ascending: false });
      if (error) throw new Error("Could not load meetings.");
      meetingRows = (rows ?? []) as MeetingRow[];
    }
    if (!meetingRows.length) return [];
    const meetingIds = meetingRows.map((row) => row.id);
    const [{ data: members }, { data: myRows }] = await Promise.all([
      db
        .from("meeting_participants")
        .select("meeting_id,user_id,status,joined_at")
        .in("meeting_id", meetingIds),
      db
        .from("meeting_participants")
        .select("meeting_id,status")
        .eq("user_id", user.id)
        .in("meeting_id", meetingIds),
    ]);
    const userIds = [
      ...new Set(((members ?? []) as { user_id: string }[]).map((row) => row.user_id)),
    ];
    const { data: profiles } = await db
      .from("app_users")
      .select("id,username,full_name,role")
      .in("id", userIds.length ? userIds : [user.id]);
    const profileMap = new Map(
      ((profiles ?? []) as MeetUser[]).map((profile) => [profile.id, profile]),
    );
    const memberMap = new Map<string, MeetParticipant[]>();
    for (const row of (members ?? []) as {
      meeting_id: string;
      user_id: string;
      status: MeetParticipant["status"];
      joined_at: string | null;
    }[]) {
      const profile = profileMap.get(row.user_id);
      if (!profile) continue;
      const list = memberMap.get(row.meeting_id) ?? [];
      list.push({ ...profile, status: row.status, joined_at: row.joined_at });
      memberMap.set(row.meeting_id, list);
    }
    const myStatusMap = new Map(
      ((myRows ?? []) as { meeting_id: string; status: MeetRecord["my_status"] }[]).map((row) => [
        row.meeting_id,
        row.status,
      ]),
    );
    return meetingRows.map((row) => ({
      ...row,
      participants: memberMap.get(row.id) ?? [],
      my_status: myStatusMap.get(row.id) ?? "invited",
    })) as MeetRecord[];
  });

export const serverJoinMeeting = createServerFn({ method: "POST" })
  .validator((data: { sessionToken: string; meetingId: string }) => data)
  .handler(async ({ data }): Promise<{ joinedAt: string; signalCursor: number }> => {
    const { db, user } = await getActor(data.sessionToken);
    const member = await requireMeetingAccess(db, data.meetingId, user.id);
    const { data: meeting, error: meetingError } = await db
      .from("meetings")
      .select("status")
      .eq("id", data.meetingId)
      .maybeSingle();
    if (meetingError || !meeting || meeting.status !== "live")
      throw new Error("This meeting has ended.");
    const joinedAt = new Date().toISOString();
    if (member.status !== "joined") {
      const { error } = await db
        .from("meeting_participants")
        .update({ status: "joined", joined_at: joinedAt, left_at: null })
        .eq("meeting_id", data.meetingId)
        .eq("user_id", user.id);
      if (error) throw new Error("Could not join the meeting.");
    }
    const { data: latestSignal } = await db
      .from("meeting_signals")
      .select("id")
      .eq("meeting_id", data.meetingId)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { joinedAt, signalCursor: Number(latestSignal?.id ?? 0) };
  });

export const serverMeetingSnapshot = createServerFn({ method: "POST" })
  .validator((data: { sessionToken: string; meetingId: string }) => data)
  .handler(
    async ({ data }): Promise<{ status: "live" | "ended"; participants: MeetParticipant[] }> => {
      const { db, user } = await getActor(data.sessionToken);
      await requireMeetingAccess(db, data.meetingId, user.id);
      const [{ data: meeting, error: meetingError }, { data: members, error: memberError }] =
        await Promise.all([
          db.from("meetings").select("status").eq("id", data.meetingId).maybeSingle(),
          db
            .from("meeting_participants")
            .select("user_id,status,joined_at")
            .eq("meeting_id", data.meetingId)
            .eq("status", "joined"),
        ]);
      if (meetingError || !meeting || memberError)
        throw new Error("Could not refresh the meeting.");
      const joined = (members ?? []) as {
        user_id: string;
        status: "joined";
        joined_at: string | null;
      }[];
      const ids = joined.map((row) => row.user_id);
      const { data: profiles } = await db
        .from("app_users")
        .select("id,username,full_name,role")
        .in("id", ids.length ? ids : [user.id]);
      const profileMap = new Map(
        ((profiles ?? []) as MeetUser[]).map((profile) => [profile.id, profile]),
      );
      return {
        status: meeting.status,
        participants: joined.flatMap((row) => {
          const profile = profileMap.get(row.user_id);
          return profile
            ? [{ ...profile, status: "joined" as const, joined_at: row.joined_at }]
            : [];
        }),
      };
    },
  );

export const serverLeaveMeeting = createServerFn({ method: "POST" })
  .validator((data: { sessionToken: string; meetingId: string }) => data)
  .handler(async ({ data }): Promise<void> => {
    const { db, user } = await getActor(data.sessionToken);
    await requireMeetingAccess(db, data.meetingId, user.id);
    const { error } = await db
      .from("meeting_participants")
      .update({ status: "left", left_at: new Date().toISOString() })
      .eq("meeting_id", data.meetingId)
      .eq("user_id", user.id);
    if (error) throw new Error("Could not leave the meeting.");
  });

export const serverEndMeeting = createServerFn({ method: "POST" })
  .validator((data: { sessionToken: string; meetingId: string }) => data)
  .handler(async ({ data }): Promise<void> => {
    const { db, user } = await getActor(data.sessionToken);
    if (user.role !== "admin") throw new Error("Only an administrator can end this meeting.");
    const { data: meeting, error: findError } = await db
      .from("meetings")
      .select("created_by")
      .eq("id", data.meetingId)
      .maybeSingle();
    if (findError || !meeting) throw new Error("Meeting not found.");
    const { error } = await db
      .from("meetings")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", data.meetingId);
    if (error) throw new Error("Could not end the meeting.");
  });

export const serverSendMeetSignal = createServerFn({ method: "POST" })
  .validator(
    (data: {
      sessionToken: string;
      meetingId: string;
      receiverId: string;
      kind: MeetSignal["kind"];
      payload: MeetSignalPayload;
    }) => data,
  )
  .handler(async ({ data }): Promise<number> => {
    const { db, user } = await getActor(data.sessionToken);
    await requireMeetingAccess(db, data.meetingId, user.id);
    if (JSON.stringify(data.payload).length > 65_536)
      throw new Error("The meeting signal is too large.");
    const { data: receiver } = await db
      .from("meeting_participants")
      .select("status")
      .eq("meeting_id", data.meetingId)
      .eq("user_id", data.receiverId)
      .maybeSingle();
    if (receiver?.status !== "joined")
      throw new Error("This participant is no longer in the meeting.");
    const { data: signal, error } = await db
      .from("meeting_signals")
      .insert({
        meeting_id: data.meetingId,
        sender_id: user.id,
        receiver_id: data.receiverId,
        kind: data.kind,
        payload: data.payload,
      })
      .select("id")
      .single();
    if (error || !signal) throw new Error("Could not send meeting signal.");
    return Number(signal.id);
  });

export const serverPollMeetSignals = createServerFn({ method: "POST" })
  .validator((data: { sessionToken: string; meetingId: string; afterId: number }) => data)
  .handler(async ({ data }): Promise<MeetSignal[]> => {
    const { db, user } = await getActor(data.sessionToken);
    await requireMeetingAccess(db, data.meetingId, user.id);
    const { data: signals, error } = await db
      .from("meeting_signals")
      .select("id,sender_id,kind,payload")
      .eq("meeting_id", data.meetingId)
      .eq("receiver_id", user.id)
      .gt("id", Math.max(0, Math.floor(data.afterId)))
      .order("id", { ascending: true })
      .limit(100);
    if (error) throw new Error("Could not receive meeting updates.");
    return (signals ?? []) as MeetSignal[];
  });
