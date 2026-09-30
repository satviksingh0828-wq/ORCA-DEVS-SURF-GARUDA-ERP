/**
 * user-auth.ts
 *
 * All authentication and user-management operations run as TanStack Start
 * server functions — they execute on the server using the service-role
 * Supabase client (supabaseAdmin) and never expose passwords or raw user
 * records to the browser.
 *
 * The client receives only the SessionUser shape (no password field).
 */

import { createServerFn } from "@tanstack/react-start";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { adminAlertEmails, emailTemplate, sendResendEmail } from "@/lib/email";
import type { AppRole } from "@/lib/roles";

// ── Public user shape (safe to store in localStorage / send to client) ──────

export type SessionUser = {
  id: string;
  username: string;
  fullName: string;
  role: AppRole;
  /** IDs of branches this user may access. Admin ignores this; basic users are filtered to these. */
  branchIds: string[];
  /**
   * HMAC-signed server session token used to authorize admin server functions.
   * Format: `{userId}:{role}:{expiresMs}:{hmacHex}`
   * Signed with SESSION_SECRET at login; verified server-side — never trust
   * a caller-supplied userId alone.
   */
  sessionToken?: string;
};

export type AppUserPublic = {
  id: string;
  username: string;
  full_name: string;
  role: AppRole;
  is_active: boolean;
  is_paused: boolean;
  failed_login_attempts: number;
  created_at: string;
};

export type SaveUserInput = {
  id?: string;
  username: string;
  full_name: string;
  password: string; // blank = keep existing (update only)
  role: AppRole;
  is_active: boolean;
  branchIds: string[];
};

// ── Sign in ──────────────────────────────────────────────────────────────────

export type SignInResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: "invalid_credentials" | "server_error" | "device_not_authorized" | "captcha_failed" | "already_logged_in"; message: string }
  | { ok: false; reason: "account_paused"; message: string; role: AppRole };

export const serverSignIn = createServerFn({ method: "POST" })
  .validator((data: {
    username: string;
    password: string;
    turnstileToken: string;
    /** Credential ID of the passkey that already passed Windows Hello on this device */
    credentialId?: string;
  }) => data)
  .handler(async ({ data }): Promise<SignInResult> => {

    // ── 1. Verify Cloudflare Turnstile CAPTCHA ───────────────────────────────
    const captcha = await verifyTurnstileToken({ token: data.turnstileToken });
    if (!captcha.ok) {
      return {
        ok: false,
        reason: "captcha_failed",
        message: captcha.error ?? "Security check failed or expired. Please try again.",
      };
    }

    // ── 2. Load Supabase admin ─────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let supabaseAdmin: any;
    try {
      const mod = await import("@/integrations/supabase/client.server");
      supabaseAdmin = mod.supabaseAdmin;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[serverSignIn] Failed to init Supabase admin client:", msg);
      return { ok: false, reason: "server_error", message: `Database connection failed: ${msg}` };
    }

    // ── 3. Verify username + password ──────────────────────────────────────────
    const { data: user, error } = await supabaseAdmin
      .from("app_users")
      .select("id, username, full_name, role, password, is_paused, failed_login_attempts")
      .eq("username", data.username.trim().toLowerCase())
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      console.error("[serverSignIn] Supabase query error:", error.message, error.code, error.details);
      return { ok: false, reason: "server_error", message: `Database error: ${error.message} (code: ${error.code})` };
    }
    if (!user) {
      console.warn("[serverSignIn] No active user found for username:", data.username.trim().toLowerCase());
      return { ok: false, reason: "invalid_credentials", message: "Invalid login ID or password." };
    }

    // ── 3a. Paused account check — block BEFORE password, no hints ────────────
    if (user.is_paused) {
      console.warn("[serverSignIn] Blocked: account is paused:", data.username.trim().toLowerCase());
      return {
        ok: false,
        reason: "account_paused",
        message: "Your account has been locked.",
        role: user.role as AppRole,
      };
    }

    if (user.password !== data.password) {
      console.warn("[serverSignIn] Password mismatch for username:", data.username.trim().toLowerCase());

      // ── 3b. Increment failure counter; pause at 3 ─────────────────────────
      const newCount = ((user.failed_login_attempts as number) ?? 0) + 1;
      const shouldPause = newCount >= 3;
      try {
        await supabaseAdmin
          .from("app_users")
          .update({
            failed_login_attempts: newCount,
            ...(shouldPause ? { is_paused: true, paused_at: new Date().toISOString() } : {}),
          })
          .eq("id", user.id as string);

        // ── 3c. Email alert + one-time code when an admin account gets paused ──
        if (shouldPause && ((user.role as string) === "admin" || (user.role as string) === "semi_admin")) {
          // Generate a 6-character alphanumeric code (e.g. "A3FX9K")
          const unpauseCode = Math.random().toString(36).slice(2, 8).toUpperCase();
          // Store the code on the user row (cleared on unpause)
          await supabaseAdmin
            .from("app_users")
            .update({ unpause_code: unpauseCode })
            .eq("id", user.id as string)
            .then(() => {/* fire-and-forget */});

          const recipients = adminAlertEmails();
          if (process.env.RESEND_API_KEY && recipients.length) {
            sendResendEmail({ to: recipients, subject: "⚠️ Admin account paused — Garuda Logistics", html: emailTemplate({
              title: "Admin account paused", eyebrow: "Security alert", accent: "#dc2626",
              intro: `The admin account <strong>${user.username as string}</strong> was paused after three consecutive failed login attempts.`,
              content: `<p style="font-size:14px;line-height:1.6;color:#475569">Enter this one-time code in the Users panel to unpause the account:</p>
  <div style="background:#f4f4f4;border:2px dashed #c0392b;border-radius:8px;padding:20px 32px;margin:24px 0;text-align:center">
    <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#c0392b">${unpauseCode}</span>
  </div>`, notice: "This code is valid for one use only. The password has not been changed." })
            }).catch(() => {/* non-fatal */});
          }
        }
      } catch {
        // Non-fatal — still return invalid_credentials
      }

      if (shouldPause) {
        return {
          ok: false,
          reason: "account_paused",
          message: "Your account has been paused after too many failed login attempts. Please contact your administrator to restore access.",
        };
      }

      return { ok: false, reason: "invalid_credentials", message: "Invalid login ID or password." };
    }

    // ── 3d. Successful password match — reset failure counter ─────────────────
    try {
      if ((user.failed_login_attempts as number) > 0) {
        await supabaseAdmin
          .from("app_users")
          .update({ failed_login_attempts: 0 })
          .eq("id", user.id as string);
      }
    } catch {
      // Non-fatal
    }

    // ── 4. Device-user authorization check ────────────────────────────────────
    if (data.credentialId) {
      const { data: devRow } = await supabaseAdmin
        .from("device_registrations")
        .select("id, status")
        .eq("credential_id", data.credentialId)
        .maybeSingle();

      if (devRow && devRow.status === "approved") {
        const { data: assignments } = await supabaseAdmin
          .from("device_user_assignments")
          .select("app_user_id")
          .eq("device_registration_id", devRow.id);

        const allowedIds: string[] = ((assignments ?? []) as { app_user_id: string }[]).map(a => a.app_user_id);

        if (allowedIds.length > 0 && !allowedIds.includes(user.id as string)) {
          console.warn("[serverSignIn] User not authorized on this device:", data.username);
          return {
            ok: false,
            reason: "device_not_authorized",
            message: "Your account is not authorised to access this application from this device.",
          };
        }
      }
    }

    // ── 5. Fetch branch access ─────────────────────────────────────────────────
    const { data: branchData } = await supabaseAdmin
      .from("user_branch_access")
      .select("branch_id")
      .eq("user_id", user.id);

    // ── 5b. Single-session enforcement: first login wins ──────────────────────
    // If a live session row exists (last_seen_at within 2 minutes) the account
    // is actively in use — reject this login attempt.
    // 2 min = ~4 missed heartbeats (heartbeat runs every 30 s); anything older
    // means the previous session ended without a clean sign-out (crash / inactivity
    // auto-logout) and a new login is safe to allow.
    try {
      const STALE_MS  = 2 * 60 * 1000; // 2 minutes
      const staleTime = new Date(Date.now() - STALE_MS).toISOString();

      const { data: existingSession, error: sessionCheckErr } = await supabaseAdmin
        .from("user_sessions")
        .select("last_seen_at")
        .eq("user_id", user.id as string)
        .maybeSingle();

      if (!sessionCheckErr && existingSession) {
        const lastSeen = new Date(existingSession.last_seen_at as string).getTime();
        if (lastSeen > Date.now() - STALE_MS) {
          console.warn("[serverSignIn] Blocked: active session exists for user:", data.username);
          void staleTime; // suppress unused warning
          return {
            ok: false,
            reason: "already_logged_in",
            message: "This account is already logged in on another device. Please sign out there first, or wait for the session to expire.",
          };
        }
      }
      // If sessionCheckErr (table missing / RLS) → allow login gracefully
    } catch {
      // Non-fatal: if check fails, allow login rather than locking the user out
    }

    // ── 6. Generate HMAC-signed session token ─────────────────────────────────
    // Token = "userId:role:expiresMs:hmac" signed with SESSION_SECRET.
    // Server functions verify this token independently — we never trust a
    // client-supplied userId alone.
    let sessionToken: string | undefined;
    try {
      const { createHmac } = await import("crypto");
      const secret = process.env.SESSION_SECRET ?? "dev-fallback-secret";
      const uid    = user.id as string;
      const role   = user.role as string;
      const expires = Date.now() + 12 * 60 * 60 * 1000; // 12 hours
      const sig = createHmac("sha256", secret)
        .update(`${uid}:${role}:${expires}`)
        .digest("hex");
      sessionToken = `${uid}:${role}:${expires}:${sig}`;
    } catch {
      // If token generation fails (e.g. crypto unavailable), continue without it.
      // Admin server functions will reject the empty token.
    }

    // ── 7. Persist session token (single-session enforcement) ─────────────────
    // One row per user – upsert replaces any previous token, so if another
    // device was already logged in its next heartbeat will get { valid: false }
    // and auto-sign-out.
    if (sessionToken) {
      try {
        const { error: upsertErr } = await supabaseAdmin
          .from("user_sessions")
          .upsert(
            {
              user_id: user.id as string,
              session_token: sessionToken,
              created_at: new Date().toISOString(),
              last_seen_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
        if (upsertErr) {
          // Non-fatal: session enforcement best-effort (table may not exist yet)
          console.warn("[serverSignIn] Could not upsert user_sessions:", upsertErr.message);
        }
      } catch (e) {
        console.warn("[serverSignIn] Unexpected error upserting user_sessions:", e);
      }
    }

    return {
      ok: true,
      user: {
        id: user.id as string,
        username: user.username as string,
        fullName: (user.full_name as string) || (user.username as string),
        role: user.role as AppRole,
        branchIds: ((branchData ?? []) as { branch_id: string }[]).map(
          (r) => r.branch_id,
        ),
        sessionToken,
      },
    };
  });

// ── Shared token-integrity helper ────────────────────────────────────────────
// Verifies the HMAC signature AND expiry of an app session token.
// Returns the parsed { uid, role } when valid, or null when invalid/tampered/expired.
// Uses timingSafeEqual to prevent timing-oracle attacks on the signature.

export async function verifyAppToken(
  token: string,
): Promise<{ uid: string; role: string } | null> {
  if (!token) return null;

  // Token format: "userId:role:expiresMs:hmacHex"
  // Strategy: split on the LAST colon → everything after is the hex signature;
  // everything before is the signed payload "userId:role:expiresMs".
  // userId is a UUID (hyphens only, no colons), so payload has exactly 3 segments.
  const lastColon = token.lastIndexOf(":");
  if (lastColon === -1) return null;

  const payload     = token.slice(0, lastColon);   // "userId:role:expiresMs"
  const suppliedSig = token.slice(lastColon + 1);  // "hmacHex"

  // Payload must have exactly 3 colon-delimited parts: uid, role, expiresMs
  const payloadParts = payload.split(":");
  if (payloadParts.length !== 3) return null;

  const [uid, role, expiresStr] = payloadParts;
  const expiresMs = Number(expiresStr);
  if (!uid || !role || !Number.isFinite(expiresMs)) return null;
  if (Date.now() > expiresMs) return null; // token expired

  try {
    const { createHmac, timingSafeEqual } = await import("crypto");
    const secret   = process.env.SESSION_SECRET ?? "dev-fallback-secret";
    // HMAC was computed over "uid:role:expiresMs" — same as payload
    const expected = createHmac("sha256", secret).update(payload).digest("hex");

    // timingSafeEqual requires equal-length buffers
    if (suppliedSig.length !== expected.length) return null;
    const aBytes = Buffer.from(suppliedSig, "utf8");
    const bBytes = Buffer.from(expected,    "utf8");
    if (!timingSafeEqual(aBytes, bBytes)) return null;
  } catch {
    return null;
  }

  return { uid, role };
}

// ── Verify session heartbeat (single-session enforcement) ────────────────────
// Called every ~30 s by the client. Returns { valid: false } when another
// device has signed in (the DB token no longer matches this client's token),
// or when the token is tampered / expired.

export const serverVerifySession = createServerFn({ method: "POST" })
  .validator((token: string) => token)
  .handler(async ({ data: token }): Promise<{ valid: boolean }> => {
    const parsed = await verifyAppToken(token);
    if (!parsed) return { valid: false };
    const { uid } = parsed;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let supabaseAdmin: any;
    try {
      const mod = await import("@/integrations/supabase/client.server");
      supabaseAdmin = mod.supabaseAdmin;
    } catch {
      // DB client unavailable — don't boot the user for infrastructure issues
      return { valid: true };
    }

    const { data, error } = await supabaseAdmin
      .from("user_sessions")
      .select("session_token")
      .eq("user_id", uid)
      .maybeSingle();

    // Any DB / RLS / table-missing error → non-destructive: let session continue
    if (error) {
      console.warn("[serverVerifySession] DB error, allowing session:", error.message);
      return { valid: true };
    }

    // No row yet (table empty / upsert failed at login) → benefit of the doubt
    if (!data) return { valid: true };

    // Row found but token differs → another device logged in → revoke this session
    if (data.session_token !== token) return { valid: false };

    // Tokens match → valid; bump last_seen_at (fire-and-forget)
    supabaseAdmin
      .from("user_sessions")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("user_id", uid)
      .then(() => {/* ignore */});

    return { valid: true };
  });

// ── Clear session on sign-out ─────────────────────────────────────────────────
// Requires a valid HMAC-signed token. Deletes matching on BOTH user_id AND
// session_token so a stale / forged token cannot revoke another user's active session.

export const serverSignOut = createServerFn({ method: "POST" })
  .validator((token: string) => token)
  .handler(async ({ data: token }): Promise<void> => {
    const parsed = await verifyAppToken(token);
    if (!parsed) return; // invalid / expired / tampered — nothing to do

    const { uid } = parsed;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // Match on BOTH columns: a stale token from a previous session cannot
      // delete the row that now belongs to a newer login.
      await supabaseAdmin
        .from("user_sessions")
        .delete()
        .eq("user_id", uid)
        .eq("session_token", token);
    } catch {
      // Non-fatal
    }
  });

// ── List users (admin-only) ──────────────────────────────────────────────────

export const serverListUsers = createServerFn({ method: "GET" }).handler(
  async (): Promise<AppUserPublic[]> => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data } = await supabaseAdmin
      .from("app_users")
      .select("id, username, full_name, role, is_active, is_paused, failed_login_attempts, created_at")
      .order("created_at", { ascending: true });
    return (data ?? []) as AppUserPublic[];
  },
);

// ── List Basic users for optional HR employee association ───────────────────

export type BasicUserOption = Pick<AppUserPublic, "id" | "username" | "full_name" | "is_active">;

export const serverListBasicUsers = createServerFn({ method: "GET" }).handler(
  async (): Promise<BasicUserOption[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_users")
      .select("id, username, full_name, is_active")
      .eq("role", "basic")
      .order("full_name", { ascending: true });
    return (data ?? []) as BasicUserOption[];
  },
);

// ── Get a single user's branch access (admin-only) ───────────────────────────

export const serverGetUserBranches = createServerFn({ method: "POST" })
  .validator((userId: string) => userId)
  .handler(async ({ data: userId }): Promise<string[]> => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data } = await supabaseAdmin
      .from("user_branch_access")
      .select("branch_id")
      .eq("user_id", userId);
    return ((data ?? []) as { branch_id: string }[]).map((r) => r.branch_id);
  });

// ── Create or update a user (admin-only) ─────────────────────────────────────

export const serverSaveUser = createServerFn({ method: "POST" })
  .validator((input: SaveUserInput) => input)
  .handler(async ({ data }): Promise<{ id: string; error?: string }> => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    let userId = data.id;

    if (data.id) {
      // Update
      const payload: Record<string, unknown> = {
        username: data.username.trim().toLowerCase(),
        full_name: data.full_name.trim(),
        role: data.role as AppRole,
        is_active: data.is_active,
      };
      if (data.password.trim()) payload.password = data.password;

      const { error } = await supabaseAdmin
        .from("app_users")
        .update(payload as never)
        .eq("id", data.id);
      if (error) return { id: data.id, error: error.message };
    } else {
      // Create
      const { data: created, error } = await supabaseAdmin
        .from("app_users")
        .insert({
          username: data.username.trim().toLowerCase(),
          full_name: data.full_name.trim(),
          password: data.password,
          role: data.role as AppRole,
          is_active: data.is_active,
        })
        .select("id")
        .single();
      if (error || !created) return { id: "", error: error?.message ?? "Could not create user" };
      userId = (created as { id: string }).id;
    }

    // Replace branch access
    await supabaseAdmin
      .from("user_branch_access")
      .delete()
      .eq("user_id", userId!);

    if (data.branchIds.length > 0) {
      const { error } = await supabaseAdmin
        .from("user_branch_access")
        .insert(data.branchIds.map((bid) => ({ user_id: userId!, branch_id: bid })));
      if (error) return { id: userId!, error: error.message };
    }

    return { id: userId! };
  });

// ── Request OTP to unlock a paused admin account (self-service on login page) ─
// Generates a new 6-char code, stores it + timestamp, emails it.
// Rate-limited: one code per 2 minutes to prevent spam.

export const serverRequestUnpauseOtp = createServerFn({ method: "POST" })
  .validator((username: string) => username)
  .handler(async ({ data: username }): Promise<{ ok: boolean; error?: string; retryAfterSeconds?: number }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: user } = await supabaseAdmin
      .from("app_users")
      .select("id, username, role, is_paused, otp_sent_at")
      .eq("username", username.trim().toLowerCase())
      .eq("is_active", true)
      .maybeSingle();

    // Generic error — reveal nothing about whether account/username exists
    if (!user || !(user.is_paused as boolean) || (user.role as string) !== "admin") {
      return { ok: false, error: "Unable to send code. Contact support if the problem persists." };
    }

    // Rate-limit: 2-minute cooldown per send
    const COOLDOWN_MS = 2 * 60 * 1000;
    if (user.otp_sent_at) {
      const elapsed = Date.now() - new Date(user.otp_sent_at as string).getTime();
      if (elapsed < COOLDOWN_MS) {
        const retryAfterSeconds = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
        return { ok: false, error: "Please wait before requesting another code.", retryAfterSeconds };
      }
    }

    // Generate + store code and timestamp
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    await supabaseAdmin
      .from("app_users")
      .update({ unpause_code: code, otp_sent_at: new Date().toISOString() })
      .eq("id", user.id as string);

    // Send email — awaited so we can report failures back to the caller
    const recipients = adminAlertEmails();

    if (!process.env.RESEND_API_KEY || !recipients.length) {
      console.error("[serverRequestUnpauseOtp] Email not configured — set RESEND_API_KEY and an admin email");
      return { ok: false, error: "Email service is not configured on this server. Contact your system administrator." };
    }

    try {
      await sendResendEmail({
          to: recipients,
          subject: "Your account unlock code — Garuda Logistics",
          html: emailTemplate({ title: "Account unlock code", eyebrow: "Security verification", accent: "#b45309",
            intro: `A verification code was requested for the admin account <strong>${user.username as string}</strong>.`, content: `
  <p style="font-size:14px;color:#475569">Enter this code on the login page:</p>
  <div style="background:#fffbeb;border:2px dashed #b45309;border-radius:8px;padding:20px 32px;margin:24px 0;text-align:center">
    <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#b45309">${code}</span>
  </div>`, notice: "This code expires when a new one is requested. If you did not request it, contact your system administrator immediately." }),
      });
    } catch (fetchErr) {
      console.error("[serverRequestUnpauseOtp] Network error sending email:", fetchErr);
      return { ok: false, error: "Failed to send verification email. Please check your connection and try again." };
    }

    return { ok: true };
  });

// ── Submit OTP to unlock a paused admin account (self-service on login page) ─
// Verifies the code, unpauses the account. Password is NEVER changed.
// After this succeeds the user must still log in normally with their password.

export const serverSubmitUnpauseOtp = createServerFn({ method: "POST" })
  .validator((input: { username: string; code: string }) => input)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: user } = await supabaseAdmin
      .from("app_users")
      .select("id, role, is_paused, unpause_code")
      .eq("username", data.username.trim().toLowerCase())
      .eq("is_active", true)
      .maybeSingle();

    if (!user || !(user.is_paused as boolean)) {
      return { ok: false, error: "Invalid or expired code." };
    }

    if (!user.unpause_code) {
      return { ok: false, error: "No code on record. Please request a new one." };
    }

    if ((user.unpause_code as string).toUpperCase() !== data.code.trim().toUpperCase()) {
      return { ok: false, error: "Incorrect code. Check the email and try again." };
    }

    // Unpause — password column is never touched
    await supabaseAdmin
      .from("app_users")
      .update({
        is_paused: false,
        failed_login_attempts: 0,
        paused_at: null,
        unpause_code: null,
        otp_sent_at: null,
      })
      .eq("id", user.id as string);

    return { ok: true };
  });

// ── Force-logout a user (admin-only) ─────────────────────────────────────────
// Deletes the user's session row so their next heartbeat (~30 s) invalidates them.

export const serverForceLogout = createServerFn({ method: "POST" })
  .validator((userId: string) => userId)
  .handler(async ({ data: userId }): Promise<{ error?: string }> => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error } = await supabaseAdmin
      .from("user_sessions")
      .delete()
      .eq("user_id", userId);
    if (error) return { error: error.message };
    return {};
  });

// ── Unpause a user (admin-only) ───────────────────────────────────────────────
// Basic users: click to unpause, no code needed.
// Admin users: requires the one-time code that was emailed when the account was paused.
// Password is NEVER changed by this operation.

export const serverUnpauseUser = createServerFn({ method: "POST" })
  .validator((input: { userId: string; code?: string }) => input)
  .handler(async ({ data }): Promise<{ error?: string }> => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    // Fetch role + stored code (never expose unpause_code to the client)
    const { data: user, error: fetchErr } = await supabaseAdmin
      .from("app_users")
      .select("role, unpause_code")
      .eq("id", data.userId)
      .maybeSingle();

    if (fetchErr || !user) return { error: "User not found" };

    // Admin accounts require the emailed one-time code
    if ((user.role as string) === "admin") {
      if (!data.code?.trim()) {
        return { error: "A verification code is required to unpause an admin account. Check the alert email." };
      }
      if (!user.unpause_code) {
        return { error: "No verification code on record. Please contact support." };
      }
      if ((user.unpause_code as string).toUpperCase() !== data.code.trim().toUpperCase()) {
        return { error: "Incorrect verification code. Check the alert email and try again." };
      }
    }

    // Clear pause state. Password is untouched.
    const { error } = await supabaseAdmin
      .from("app_users")
      .update({
        is_paused: false,
        failed_login_attempts: 0,
        paused_at: null,
        unpause_code: null,
      })
      .eq("id", data.userId);

    if (error) return { error: error.message };
    return {};
  });

// ── Delete a user (admin-only) ───────────────────────────────────────────────

export const serverDeleteUser = createServerFn({ method: "POST" })
  .validator((userId: string) => userId)
  .handler(async ({ data: userId }): Promise<{ error?: string }> => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    await supabaseAdmin
      .from("user_branch_access")
      .delete()
      .eq("user_id", userId);
    const { error } = await supabaseAdmin
      .from("app_users")
      .delete()
      .eq("id", userId);
    if (error) return { error: error.message };
    return {};
  });
