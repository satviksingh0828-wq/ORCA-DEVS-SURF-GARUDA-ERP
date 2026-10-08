const configuredWmsApiUrl = (import.meta.env.VITE_WMS_API_URL || "").trim().replace(/\/$/, "");

let warmedToken = "";
let warmPromise: Promise<void> | null = null;

/**
 * Warm the WMS API session immediately after ERP authentication. The WMS API
 * validates the ERP token and the shared ERP↔WMS link, then sets its normal
 * HttpOnly WMS cookie. No WMS password is copied into the ERP bundle.
 */
export async function warmWmsSession(erpSessionToken: string) {
  if (!configuredWmsApiUrl || !erpSessionToken) return;
  if (warmedToken === erpSessionToken) return warmPromise ?? Promise.resolve();

  warmedToken = erpSessionToken;
  warmPromise = (async () => {
    try {
      await fetch(`${configuredWmsApiUrl}/api/auth/erp-session`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ erp_session_token: erpSessionToken }),
      });
    } catch {
      // WMS is optional. A transient API failure must not block ERP login.
    }
  })();

  try {
    await warmPromise;
  } finally {
    warmPromise = null;
  }
}
