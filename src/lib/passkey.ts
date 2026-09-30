/**
 * passkey.ts — Server functions for WebAuthn / Passkey (Windows Hello) security.
 * All crypto operations run server-side only via @simplewebauthn/server.
 */
import { createServerFn } from "@tanstack/react-start";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CredentialStatus = "pending" | "approved" | "rejected" | "not_found";

export type DeviceRow = {
  id: string;
  requester_name: string;
  credential_id: string;
  device_info: string;
  status: "pending" | "approved" | "rejected";
  assigned_user_ids: string[];
  assigned_user_names: string[];
  created_at: string;
  last_used_at: string | null;
};

export type AppUserOption = {
  id: string;
  username: string;
  full_name: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function originToRpId(origin: string): string {
  try { return new URL(origin).hostname; } catch { return "localhost"; }
}

function uint8ToBase64url(arr: Uint8Array): string {
  return Buffer.from(arr).toString("base64url");
}

function base64urlToUint8(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, "base64url"));
}

// ── 1. Start registration (generate challenge + options) ──────────────────────

export const serverStartRegistration = createServerFn({ method: "POST" })
  .validator((input: { name: string; origin: string }) => input)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;

    const { generateRegistrationOptions } = await import("@simplewebauthn/server");
    const rpID = originToRpId(data.origin);

    const options = await generateRegistrationOptions({
      rpName: "ORCA DEVS SURF",
      rpID,
      userName: data.name,
      timeout: 120000,
      attestationType: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
    });

    // Store challenge in DB (5 min TTL)
    const { data: row, error } = await db
      .from("passkey_challenges")
      .insert({ challenge: options.challenge })
      .select("id")
      .single();
    if (error) throw new Error("Could not save challenge: " + error.message);

    return { challengeId: row.id as string, options };
  });

// ── 2. Finish registration (verify + store credential) ───────────────────────

export const serverFinishRegistration = createServerFn({ method: "POST" })
  .validator((input: {
    challengeId: string;
    response: unknown;
    name: string;
    deviceInfo: string;
    origin: string;
  }) => input)
  .handler(async ({ data }): Promise<{ credentialId: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;

    const { verifyRegistrationResponse } = await import("@simplewebauthn/server");

    // Fetch & validate challenge
    const { data: chRow, error: chErr } = await db
      .from("passkey_challenges")
      .select("challenge, used, expires_at")
      .eq("id", data.challengeId)
      .single();
    if (chErr || !chRow) throw new Error("Challenge not found.");
    if (chRow.used) throw new Error("Challenge already used.");
    if (new Date(chRow.expires_at) < new Date()) throw new Error("Challenge expired.");

    const rpID = originToRpId(data.origin);

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: data.response as never,
        expectedChallenge: chRow.challenge as string,
        expectedOrigin: data.origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch (err) {
      throw new Error("Passkey verification failed: " + (err instanceof Error ? err.message : String(err)));
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new Error("Passkey not verified.");
    }

    const { credential } = verification.registrationInfo;

    // Mark challenge used
    await db.from("passkey_challenges").update({ used: true }).eq("id", data.challengeId);

    // Store credential
    const { error: insErr } = await db.from("device_registrations").insert({
      requester_name: data.name,
      credential_id: credential.id,
      public_key_bytes: uint8ToBase64url(credential.publicKey),
      counter: credential.counter,
      transports: JSON.stringify(credential.transports ?? []),
      device_info: data.deviceInfo,
      status: "pending",
    });
    if (insErr) throw new Error("Could not store credential: " + insErr.message);

    return { credentialId: credential.id };
  });

// ── 3. Check credential status ────────────────────────────────────────────────

export const serverCheckCredential = createServerFn({ method: "POST" })
  .validator((input: { credentialId: string }) => input)
  .handler(async ({ data }): Promise<{ status: CredentialStatus; allowedUserIds: string[] }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;

    const { data: row, error } = await db
      .from("device_registrations")
      .select("id, status")
      .eq("credential_id", data.credentialId)
      .maybeSingle();

    if (error || !row) return { status: "not_found", allowedUserIds: [] };

    // Fetch assigned user IDs from junction table
    const { data: assignments } = await db
      .from("device_user_assignments")
      .select("app_user_id")
      .eq("device_registration_id", row.id);

    const allowedUserIds = ((assignments ?? []) as { app_user_id: string }[]).map(a => a.app_user_id);

    return { status: row.status as CredentialStatus, allowedUserIds };
  });

// ── 4. Start authentication (generate challenge) ──────────────────────────────

export const serverStartAuthentication = createServerFn({ method: "POST" })
  .validator((input: { credentialId?: string; origin: string }) => input)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;

    const { generateAuthenticationOptions } = await import("@simplewebauthn/server");
    const rpID = originToRpId(data.origin);

    let allowCredentials: Array<{ id: string }> | undefined;
    if (data.credentialId) {
      allowCredentials = [{ id: data.credentialId }];
    } else {
      const { data: approvedDevices } = await db
        .from("device_registrations")
        .select("credential_id")
        .eq("status", "approved");
      const ids = ((approvedDevices ?? []) as Array<{ credential_id?: string }>)
        .map((device) => device.credential_id)
        .filter((id): id is string => Boolean(id));
      if (ids.length > 0) allowCredentials = ids.map((id) => ({ id }));
    }

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification: "required",
      timeout: 120000,
    });

    const { data: row, error } = await db
      .from("passkey_challenges")
      .insert({ challenge: options.challenge })
      .select("id")
      .single();
    if (error) throw new Error("Could not save challenge.");

    return { challengeId: row.id as string, options };
  });

// ── 5. Finish authentication (verify assertion) ───────────────────────────────

export const serverFinishAuthentication = createServerFn({ method: "POST" })
  .validator((input: {
    challengeId: string;
    credentialId?: string;
    response: unknown;
    origin: string;
  }) => input)
  .handler(async ({ data }): Promise<{ ok: boolean; credentialId?: string; allowedUserIds: string[]; error?: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;

    const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");

    // Fetch challenge
    const { data: chRow, error: chErr } = await db
      .from("passkey_challenges")
      .select("challenge, used, expires_at")
      .eq("id", data.challengeId)
      .single();
    if (chErr || !chRow) return { ok: false, allowedUserIds: [], error: "Challenge not found." };
    if (chRow.used) return { ok: false, allowedUserIds: [], error: "Challenge already used." };
    if (new Date(chRow.expires_at) < new Date()) return { ok: false, allowedUserIds: [], error: "Challenge expired." };

    const responseCredentialId = data.credentialId || String((data.response as { id?: unknown })?.id ?? "");
    if (!responseCredentialId) return { ok: false, allowedUserIds: [], error: "Credential ID missing." };

    // Fetch stored credential
    const { data: credRow, error: credErr } = await db
      .from("device_registrations")
      .select("id, public_key_bytes, counter, transports, status")
      .eq("credential_id", responseCredentialId)
      .maybeSingle();
    if (credErr || !credRow) return { ok: false, allowedUserIds: [], error: "Credential not found." };
    if (credRow.status !== "approved") return { ok: false, allowedUserIds: [], error: "Device not approved." };

    const rpID = originToRpId(data.origin);

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: data.response as never,
        expectedChallenge: chRow.challenge as string,
        expectedOrigin: data.origin,
        expectedRPID: rpID,
        credential: {
          id: responseCredentialId,
          publicKey: base64urlToUint8(credRow.public_key_bytes as string) as Uint8Array<ArrayBuffer>,
          counter: Number(credRow.counter ?? 0),
          transports: (JSON.parse(credRow.transports as string ?? "[]")) as never,
        },
        requireUserVerification: true,
      });
    } catch (err) {
      return { ok: false, allowedUserIds: [], error: err instanceof Error ? err.message : "Verification error." };
    }

    if (!verification.verified) return { ok: false, allowedUserIds: [], error: "Authentication not verified." };

    // Mark challenge used, update counter and last_used_at
    await Promise.all([
      db.from("passkey_challenges").update({ used: true }).eq("id", data.challengeId),
      db.from("device_registrations")
        .update({ counter: verification.authenticationInfo.newCounter, last_used_at: new Date().toISOString() })
        .eq("credential_id", responseCredentialId),
    ]);

    // Fetch allowed user IDs from junction table
    const { data: assignments } = await db
      .from("device_user_assignments")
      .select("app_user_id")
      .eq("device_registration_id", credRow.id);

    const allowedUserIds = ((assignments ?? []) as { app_user_id: string }[]).map(a => a.app_user_id);

    return { ok: true, credentialId: responseCredentialId, allowedUserIds };
  });

// ── 6. Admin: list all devices ────────────────────────────────────────────────

export const serverListDevices = createServerFn({ method: "GET" })
  .handler(async (): Promise<DeviceRow[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;

    const { data, error } = await db
      .from("device_registrations")
      .select("id, requester_name, credential_id, device_info, status, created_at, last_used_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) return [];

    // Fetch all assignments for these devices
    const deviceIds = rows.map(r => r.id as string);
    const { data: assignments } = await db
      .from("device_user_assignments")
      .select("device_registration_id, app_user_id")
      .in("device_registration_id", deviceIds);

    // Collect all unique user IDs
    const userIds = [...new Set(((assignments ?? []) as Array<{ app_user_id: string }>).map(a => a.app_user_id))];
    let userMap: Record<string, { username: string; full_name: string }> = {};
    if (userIds.length > 0) {
      const { data: users } = await db
        .from("app_users")
        .select("id, username, full_name")
        .in("id", userIds);
      for (const u of (users ?? [])) {
        userMap[u.id as string] = { username: u.username as string, full_name: u.full_name as string };
      }
    }

    // Build assignment map: deviceId → [userId, ...]
    const assignMap: Record<string, string[]> = {};
    for (const a of ((assignments ?? []) as Array<{ device_registration_id: string; app_user_id: string }>)) {
      if (!assignMap[a.device_registration_id]) assignMap[a.device_registration_id] = [];
      assignMap[a.device_registration_id].push(a.app_user_id);
    }

    return rows.map(r => {
      const devId = r.id as string;
      const uids = assignMap[devId] ?? [];
      return {
        id: devId,
        requester_name: String(r.requester_name ?? ""),
        credential_id: String(r.credential_id ?? ""),
        device_info: String(r.device_info ?? ""),
        status: r.status as "pending" | "approved" | "rejected",
        assigned_user_ids: uids,
        assigned_user_names: uids.map(uid => {
          const u = userMap[uid];
          return u ? (u.full_name || u.username) : uid;
        }),
        created_at: String(r.created_at ?? ""),
        last_used_at: (r.last_used_at as string) ?? null,
      };
    });
  });

// ── 7. Admin: update device status + assign users (multi) ─────────────────────

export const serverUpdateDevice = createServerFn({ method: "POST" })
  .validator((input: {
    id: string;
    status: "approved" | "rejected";
    appUserIds: string[];   // replaces old single appUserId
  }) => input)
  .handler(async ({ data }): Promise<{ error?: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;

    // Update status
    const { error } = await db
      .from("device_registrations")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) return { error: error.message };

    // Replace junction assignments
    await db.from("device_user_assignments").delete().eq("device_registration_id", data.id);
    if (data.appUserIds.length > 0) {
      const { error: insErr } = await db.from("device_user_assignments").insert(
        data.appUserIds.map(uid => ({ device_registration_id: data.id, app_user_id: uid }))
      );
      if (insErr) return { error: insErr.message };
    }

    return {};
  });

// ── 8. Admin: delete device ───────────────────────────────────────────────────

export const serverDeleteDevice = createServerFn({ method: "POST" })
  .validator((deviceId: string) => deviceId)
  .handler(async ({ data: deviceId }): Promise<{ error?: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    // Junction rows cascade-delete via FK
    const { error } = await db.from("device_registrations").delete().eq("id", deviceId);
    if (error) return { error: error.message };
    return {};
  });

// ── 9. Admin: list app users for assignment ───────────────────────────────────

export const serverListAppUsers = createServerFn({ method: "GET" })
  .handler(async (): Promise<AppUserOption[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const { data } = await db
      .from("app_users")
      .select("id, username, full_name")
      .eq("is_active", true)
      .order("full_name");
    return (data ?? []).map((u: Record<string, unknown>) => ({
      id: u.id as string,
      username: String(u.username ?? ""),
      full_name: String(u.full_name ?? ""),
    }));
  });
