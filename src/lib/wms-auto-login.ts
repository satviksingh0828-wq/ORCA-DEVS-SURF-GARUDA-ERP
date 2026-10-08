const configuredWmsApiUrl = (import.meta.env.VITE_WMS_API_URL || import.meta.env.VITE_API_URL || "")
  .trim()
  .replace(/\/$/, "");

let warmedToken = "";
let warmingToken = "";
let warmPromise: Promise<boolean> | null = null;

/**
 * Warm the WMS API session immediately after ERP authentication. The WMS API
 * validates the ERP token and the shared ERP↔WMS link, then sets its normal
 * HttpOnly WMS cookie. No WMS password is copied into the ERP bundle.
 */
export async function warmWmsSession(erpSessionToken: string) {
  if (!configuredWmsApiUrl || !erpSessionToken) return false;
  if (warmedToken === erpSessionToken) return true;
  if (warmingToken === erpSessionToken && warmPromise) return warmPromise;

  warmingToken = erpSessionToken;
  const request = (async () => {
    try {
      const response = await fetch(`${configuredWmsApiUrl}/api/auth/erp-session`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ erp_session_token: erpSessionToken }),
      });
      if (!response.ok) return false;
      warmedToken = erpSessionToken;
      return true;
    } catch {
      // WMS is optional. A transient API failure must not block ERP login.
      return false;
    }
  })();
  warmPromise = request;

  try {
    return await request;
  } finally {
    if (warmPromise === request) {
      warmPromise = null;
      warmingToken = "";
    }
  }
}

export function isWmsApiConfigured() {
  return Boolean(configuredWmsApiUrl);
}
