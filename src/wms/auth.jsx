import { createContext, useContext, useState, useEffect } from "react";
import { api, setCsrfTokenFromApi } from "./api.js";
import { friendlyError } from "./utils/friendlyError.js";
import { isWmsApiConfigured, warmWmsSession } from "../lib/wms-auto-login";

const AuthContext = createContext(null);

export function AuthProvider({ children, erpSessionToken = "", embedded = false }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [embeddedAuthError, setEmbeddedAuthError] = useState(null);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);

  useEffect(() => {
    // V-045: session lives in an HttpOnly cookie; there is no token in
    // localStorage to read. Ask the API who we are. If the cookie is
    // missing or expired, /auth/me returns 401 and we stay unauthenticated.
    //
    // Page permissions (mig 061): USER role is now a first-class web-admin
    // identity (gated per page via user_page_permissions). The previous
    // role === 'ADMIN' guard would silently drop a valid USER session
    // and force them back to the login screen.
    let cancelled = false;
    async function bootstrap() {
      try {
        if (embedded && !erpSessionToken)
          throw new Error("The ERP session token is missing. Sign in to ERP again.");
        if (erpSessionToken && !isWmsApiConfigured())
          throw new Error("The WMS API URL is not configured for this deployment.");

        // The ERP session provider warms this HttpOnly cookie at sign-in. Probe
        // it first so opening WMS is instant; only exchange the ERP session if
        // this is a cold tab or the cookie has expired.
        if (erpSessionToken) await warmWmsSession(erpSessionToken);
        let res = await api.get("/auth/me");
        let exchangeError = "";
        if ((!res || !res.ok) && erpSessionToken) {
          // Some WMS deployments complete/set the HttpOnly cookie even when
          // the exchange response is not a conventional success response.
          // The follow-up /auth/me probe is the source of truth; don't reject
          // the ERP session solely from the exchange response status.
          const exchange = await api.post("/auth/erp-session", {
            erp_session_token: erpSessionToken,
          });
          if (exchange && exchange.ok) {
            const exchangeData = await exchange.json().catch(() => null);
            setCsrfTokenFromApi(exchangeData?.csrf_token);
          } else if (exchange) {
            const exchangeData = await exchange.json().catch(() => ({}));
            exchangeError =
              exchangeData?.error || `WMS session exchange failed (${exchange.status}).`;
          } else {
            exchangeError = "The WMS API could not be reached.";
          }
          res = await api.get("/auth/me");
        }
        if (cancelled) return;
        if (res && res.ok) {
          const data = await res.json();
          setCsrfTokenFromApi(data.csrf_token);
          setUser(data);
          setEmbeddedAuthError(false);
        } else if (embedded) {
          const authData = res ? await res.json().catch(() => ({})) : {};
          setEmbeddedAuthError(
            exchangeError ||
              authData?.error ||
              "The WMS API did not accept the ERP session. Check the API deployment and account link.",
          );
        }
      } catch {
        if (!cancelled && embedded)
          setEmbeddedAuthError(
            "The WMS API could not complete the ERP sign-in request. Check the API deployment and retry.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    setLoading(true);
    setEmbeddedAuthError(null);
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [erpSessionToken, embedded, bootstrapAttempt]);

  function retryBootstrap() {
    setEmbeddedAuthError(null);
    setLoading(true);
    setBootstrapAttempt((attempt) => attempt + 1);
  }

  // Re-fetch /auth/me. Used after change-password to pick up the cleared
  // must_change_password flag so the router guard lets the user out of
  // the forced-change screen.
  async function refreshUser() {
    const res = await api.get("/auth/me");
    if (res && res.ok) {
      const data = await res.json();
      setCsrfTokenFromApi(data.csrf_token);
      setUser(data);
      return data;
    }
    return null;
  }

  async function login(username, password) {
    const res = await api.post("/auth/login", { username, password });
    if (!res || !res.ok) {
      const data = res ? await res.json().catch(() => ({})) : {};
      // V-021: never echo the raw backend error string to the user.
      throw new Error(friendlyError(data, "Login failed. Please try again."));
    }
    const data = await res.json();
    setCsrfTokenFromApi(data.csrf_token);
    // Page permissions (mig 061): USERs are allowed into the admin shell.
    // Per-page permissions decide what they can actually do; the
    // sidebar hides ungranted pages and the api gate returns 403 for
    // direct URL hits. Any user with valid credentials proceeds.
    setUser(data.user);
    // The initial /auth/me probe owns this flag until authentication
    // succeeds. When a user logs in from the login screen, there is no
    // second bootstrap request to clear it, so release the protected-route
    // gate here or the app remains indefinitely blank/loading.
    setLoading(false);
    return data.user;
  }

  async function logout() {
    try {
      await api.post("/auth/logout", {});
    } finally {
      setUser(null);
      setCsrfTokenFromApi(null);
    }
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, refreshUser, embeddedAuthError, retryBootstrap }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
