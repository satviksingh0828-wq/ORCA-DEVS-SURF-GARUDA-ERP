import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { serverSignIn, serverSignOut, serverVerifySession } from "@/lib/user-auth";
import type { SessionUser } from "@/lib/user-auth";
import { secureSession } from "@/lib/storage";
import { setLoggerUser } from "@/lib/log-actions";
import { warmWmsSession } from "@/lib/wms-auto-login";
import { serverHasWmsAccess } from "@/lib/wms-user-links";
import type { AppRole } from "@/lib/roles";

export type { SessionUser };

// Session stored in sessionStorage (auto-cleared on window/tab close → auto logout)
const KEY = "tms.session.v2";

/** How long (ms) of window inactivity before auto sign-out */
const INACTIVITY_MS = 10 * 60 * 1000; // 10 minutes

/** How often (ms) the client pings the server to verify it still holds the
 *  active session token (single-session enforcement). */
const HEARTBEAT_MS = 30 * 1000; // 30 seconds

export type SignInOutcome =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "invalid_credentials"
        | "server_error"
        | "device_not_authorized"
        | "captcha_failed"
        | "session_expired"
        | "logged_in_elsewhere"
        | "already_logged_in";
      message: string;
    }
  | { ok: false; reason: "account_paused"; message: string; role: AppRole };

type SessionValue = {
  ready: boolean;
  user: SessionUser | null;
  wmsAccessReady: boolean;
  wmsEnabled: boolean;
  signIn: (
    username: string,
    password: string,
    turnstileToken: string,
    credentialId?: string,
  ) => Promise<SignInOutcome>;
  signOut: (reason?: "inactivity" | "elsewhere" | "manual") => void;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [wmsAccess, setWmsAccess] = useState({ ready: false, enabled: false });

  // Refs so timer callbacks always read the latest value without re-registering
  const userRef = useRef<SessionUser | null>(null);
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Internal sign-out (clears storage + state + timers) ──────────────────
  const clearSession = useCallback((token?: string) => {
    // Clear timers first
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
    inactivityTimer.current = null;
    heartbeatTimer.current = null;

    // Remove from storage
    secureSession.removeItem(KEY);
    try {
      localStorage.removeItem("tms.session.v2");
      localStorage.removeItem("tms.session");
    } catch {
      // ignore
    }

    // Tell server to delete the session row (best-effort)
    if (token) {
      serverSignOut({ data: token }).catch(() => {
        /* ignore */
      });
    }

    userRef.current = null;
    setUser(null);
    setWmsAccess({ ready: false, enabled: false });
    setLoggerUser(null);
  }, []);

  const prepareWmsSession = useCallback(async (token: string) => {
    try {
      const { enabled } = await serverHasWmsAccess({ data: { sessionToken: token } });
      setWmsAccess({ ready: true, enabled });
      if (enabled) void warmWmsSession(token);
    } catch {
      // WMS is optional. A WMS outage must never block the ERP session.
      setWmsAccess({ ready: true, enabled: false });
    }
  }, []);

  // ── Reset inactivity countdown ────────────────────────────────────────────
  const resetInactivity = useCallback(() => {
    if (!userRef.current) return; // not logged in — skip
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    inactivityTimer.current = setTimeout(() => {
      // A live screen-control session is an intentional active workflow. Do
      // not log the user out while they are sharing or controlling the app.
      if (document.body.dataset.screenControlActive === "true") {
        resetInactivity();
        return;
      }
      const token = userRef.current?.sessionToken;
      clearSession(token);
      // Dispatch a custom event so UI can show an "inactivity" toast/modal
      window.dispatchEvent(
        new CustomEvent("tms:session-expired", { detail: { reason: "inactivity" } }),
      );
    }, INACTIVITY_MS);
  }, [clearSession]);

  // ── Start heartbeat (single-session enforcement) ──────────────────────────
  const startHeartbeat = useCallback(
    (token: string) => {
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = setInterval(async () => {
        try {
          const { valid } = await serverVerifySession({ data: token });
          if (!valid) {
            clearSession(); // token already gone from DB — don't try to delete again
            window.dispatchEvent(
              new CustomEvent("tms:session-expired", { detail: { reason: "elsewhere" } }),
            );
          }
        } catch {
          // Network hiccup — don't sign the user out; just wait for next tick
        }
      }, HEARTBEAT_MS);
    },
    [clearSession],
  );

  // ── Activity event listeners ──────────────────────────────────────────────
  useEffect(() => {
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"] as const;
    const handler = () => resetInactivity();
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, handler));
  }, [resetInactivity]);

  // ── Restore session on mount ──────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = secureSession.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SessionUser;
        userRef.current = parsed;
        setUser(parsed);
        setLoggerUser(parsed);
        // Restart inactivity timer and heartbeat for restored session
        resetInactivity();
        if (parsed.sessionToken) {
          startHeartbeat(parsed.sessionToken);
          void prepareWmsSession(parsed.sessionToken);
        }
      } else {
        setWmsAccess({ ready: true, enabled: false });
      }
    } catch {
      // ignore corrupt storage
    }
    try {
      localStorage.removeItem("tms.session.v2");
      localStorage.removeItem("tms.session");
    } catch {
      // ignore
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  // ── Sign in ───────────────────────────────────────────────────────────────
  const signIn = useCallback(
    async (
      username: string,
      password: string,
      turnstileToken: string,
      credentialId?: string,
    ): Promise<SignInOutcome> => {
      try {
        const result = await serverSignIn({
          data: { username, password, turnstileToken, credentialId },
        });
        if (!result.ok) return result;

        secureSession.setItem(KEY, JSON.stringify(result.user));
        userRef.current = result.user;
        setUser(result.user);
        setLoggerUser(result.user);

        // Start inactivity timer and heartbeat for the new session
        resetInactivity();
        if (result.user.sessionToken) {
          startHeartbeat(result.user.sessionToken);
          void prepareWmsSession(result.user.sessionToken);
        }

        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, reason: "server_error", message: `Unexpected error: ${msg}` };
      }
    },
    [prepareWmsSession, resetInactivity, startHeartbeat],
  );

  // ── Sign out (manual) ─────────────────────────────────────────────────────
  const signOut = useCallback(
    (_reason?: "inactivity" | "elsewhere" | "manual") => {
      const token = userRef.current?.sessionToken;
      if (token && _reason !== "elsewhere") {
        // Manual sign-out must end any remote-control session. keepalive lets
        // the request finish even though the app immediately navigates away.
        const body = JSON.stringify({ sessionToken: token });
        const blob = new Blob([body], { type: "application/json" });
        if (!navigator.sendBeacon?.("/api/screen-control/disconnect", blob)) {
          void fetch("/api/screen-control/disconnect", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
            keepalive: true,
          }).catch(() => undefined);
        }
      }
      clearSession(token);
    },
    [clearSession],
  );

  const value = useMemo(
    () => ({
      ready,
      user,
      signIn,
      signOut,
      wmsAccessReady: wmsAccess.ready,
      wmsEnabled: wmsAccess.enabled,
    }),
    [ready, user, signIn, signOut, wmsAccess],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
