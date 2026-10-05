import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// This is an admission PIN for the public lobby, not a confidential credential.
// It is intentionally hard-coded per the product request (not read from env).
const GUEST_SHARE_PIN = "3645";
export const GUEST_PRESENCE_TTL_MS = 5 * 60_000;
const PENDING_REQUEST_TTL_MS = 2 * 60_000;
const MAX_ACTIVE_GUESTS = 500;
const GUEST_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._'’-]{1,31}$/u;

// The generated Supabase types omit these custom tables.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GuestShareDb = any;

export type GuestShareIdentity = {
  kind: "guest";
  id: string;
  ref: string;
  username: string;
  name: string;
};

function getDb(): GuestShareDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabaseAdmin as any;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function migrationMissing(error: { code?: string } | null | undefined) {
  return error?.code === "42P01";
}

export function cleanGuestDisplayName(input: string) {
  const name = input.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 32 || !GUEST_NAME_PATTERN.test(name))
    throw new Error(
      "Use a 2–32 character name with letters, numbers, spaces, dots, apostrophes, or hyphens.",
    );
  return name;
}

export function guestParticipantRef(guestId: string) {
  return `guest:${guestId}`;
}

async function deleteGuestById(db: GuestShareDb, guestId: string) {
  const ref = guestParticipantRef(guestId);
  const { error: requesterError } = await db
    .from("guest_screen_control_sessions")
    .delete()
    .eq("requester_ref", ref);
  if (requesterError) throw new Error("Could not clear the guest's screen-control sessions.");
  const { error: targetError } = await db
    .from("guest_screen_control_sessions")
    .delete()
    .eq("target_ref", ref);
  if (targetError) throw new Error("Could not clear the guest's screen-control sessions.");
  const { error } = await db.from("screen_control_guests").delete().eq("id", guestId);
  if (error) throw new Error("Could not remove the temporary guest session.");
}

/** Remove crashed/abandoned guest tabs and pending guest requests after their TTL. */
export async function pruneExpiredGuestShareData(db: GuestShareDb = getDb()) {
  const guestCutoff = new Date(Date.now() - GUEST_PRESENCE_TTL_MS).toISOString();
  const { data: staleGuests, error: guestError } = await db
    .from("screen_control_guests")
    .select("id")
    .lt("last_seen_at", guestCutoff)
    .limit(500);
  if (guestError) {
    if (migrationMissing(guestError))
      throw new Error(
        "Guest screen sharing is not configured yet. Please contact an ERP administrator.",
      );
    throw new Error("Could not clean up expired guest sessions.");
  }
  for (const guest of staleGuests ?? []) await deleteGuestById(db, guest.id);

  const requestCutoff = new Date(Date.now() - PENDING_REQUEST_TTL_MS).toISOString();
  const { data: staleRequests, error: requestError } = await db
    .from("guest_screen_control_sessions")
    .select("id")
    .eq("status", "pending")
    .lt("created_at", requestCutoff)
    .limit(500);
  if (requestError) {
    if (migrationMissing(requestError))
      throw new Error(
        "Guest screen sharing is not configured yet. Please contact an ERP administrator.",
      );
    throw new Error("Could not expire old guest screen-control requests.");
  }
  for (const request of staleRequests ?? []) {
    await db
      .from("guest_screen_control_sessions")
      .update({
        status: "expired",
        updated_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        end_reason: "request_timeout",
      })
      .eq("id", request.id)
      .eq("status", "pending");
    await db.from("guest_screen_control_signals").delete().eq("session_id", request.id);
  }
}

/** Issue a random per-tab capability; only its SHA-256 digest is stored. */
export async function createGuestShareSession(pin: string, rawUsername: string) {
  if (pin !== GUEST_SHARE_PIN) throw new Error("That share PIN is not correct.");
  const username = cleanGuestDisplayName(rawUsername);
  const db = getDb();
  await pruneExpiredGuestShareData(db);

  const activeSince = new Date(Date.now() - GUEST_PRESENCE_TTL_MS).toISOString();
  const { count, error: countError } = await db
    .from("screen_control_guests")
    .select("id", { count: "exact", head: true })
    .gt("last_seen_at", activeSince);
  if (countError) throw new Error("Could not check the public share lobby.");
  if ((count ?? 0) >= MAX_ACTIVE_GUESTS)
    throw new Error("The guest lobby is full right now. Please try again later.");

  const token = randomBytes(32).toString("base64url");
  const { data, error } = await db
    .from("screen_control_guests")
    .insert({ username, token_hash: hashToken(token), last_seen_at: new Date().toISOString() })
    .select("id,username")
    .single();
  if (error || !data) throw new Error("Could not start a temporary guest session.");
  return {
    participant: {
      id: guestParticipantRef(data.id),
      name: data.username,
      username: data.username,
      kind: "guest" as const,
    },
    sessionToken: token,
  };
}

/** Validate a tab token and refresh presence; invalid or expired tokens fail closed. */
export async function resolveGuestShareIdentity(sessionToken: string, db: GuestShareDb = getDb()) {
  if (typeof sessionToken !== "string" || sessionToken.length < 40 || sessionToken.length > 128)
    return null;
  const { data, error } = await db
    .from("screen_control_guests")
    .select("id,username,last_seen_at")
    .eq("token_hash", hashToken(sessionToken))
    .maybeSingle();
  if (error || !data) return null;
  if (Date.now() - new Date(data.last_seen_at).getTime() > GUEST_PRESENCE_TTL_MS) {
    await deleteGuestById(db, data.id);
    return null;
  }

  if (Date.now() - new Date(data.last_seen_at).getTime() > 15_000) {
    await db
      .from("screen_control_guests")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("token_hash", hashToken(sessionToken));
  }
  return {
    kind: "guest" as const,
    id: guestParticipantRef(data.id),
    ref: guestParticipantRef(data.id),
    username: data.username,
    name: data.username,
  } satisfies GuestShareIdentity;
}

/** Change the temporary display name and refresh it in any live request cards. */
export async function renameGuestShareIdentity(sessionToken: string, rawUsername: string) {
  const username = cleanGuestDisplayName(rawUsername);
  const db = getDb();
  const identity = await resolveGuestShareIdentity(sessionToken, db);
  if (!identity) throw new Error("This temporary guest session expired. Rejoin the share page.");
  const { error } = await db
    .from("screen_control_guests")
    .update({ username, last_seen_at: new Date().toISOString() })
    .eq("id", identity.ref.slice("guest:".length));
  if (error) throw new Error("Could not update the guest name.");
  await db
    .from("guest_screen_control_sessions")
    .update({ requester_name: username })
    .eq("requester_ref", identity.ref)
    .in("status", ["pending", "active"]);
  await db
    .from("guest_screen_control_sessions")
    .update({ target_name: username })
    .eq("target_ref", identity.ref)
    .in("status", ["pending", "active"]);
  return { id: identity.id, username, name: username };
}

/** Delete all guest metadata, requests and WebRTC signaling when a tab leaves. */
export async function endGuestShareSession(sessionToken: string) {
  const db = getDb();
  const identity = await resolveGuestShareIdentity(sessionToken, db);
  if (!identity) return false;
  await deleteGuestById(db, identity.ref.slice("guest:".length));
  return true;
}
