import { createContext, useContext, useState, useEffect } from "react";
import { api } from "./api.js";
import { friendlyError } from "./utils/friendlyError.js";

const AuthContext = createContext(null);

export function AuthProvider({ children, erpSessionToken = "" }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

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
      // The WMS API can exchange the signed ERP session for its normal
      // HttpOnly WMS cookie. The API endpoint is intentionally server-side;
      // this bundle never receives or stores a WMS password.
      if (erpSessionToken) {
        try {
          await api.post("/auth/erp-session", { erp_session_token: erpSessionToken });
        } catch {
          // Fall through to the normal WMS cookie probe.
        }
      }
      try {
        const res = await api.get("/auth/me");
        if (cancelled) return;
        if (res && res.ok) {
          const data = await res.json();
          setUser(data);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    bootstrap().catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [erpSessionToken]);

  // Re-fetch /auth/me. Used after change-password to pick up the cleared
  // must_change_password flag so the router guard lets the user out of
  // the forced-change screen.
  async function refreshUser() {
    const res = await api.get("/auth/me");
    if (res && res.ok) {
      const data = await res.json();
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
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
