import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// These tables are intentionally server-only and are created by the OAuth migration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;
const MCP_PATH = "/api/mcp/ltms-reports";
const REPORT_SCOPE = "reports:read";
const OFFLINE_SCOPE = "offline_access";
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const noStore = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function randomToken(prefix: string) {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

function mcpResource(request: Request) {
  return new URL(MCP_PATH, new URL(request.url).origin).toString();
}

function responseJson(value: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(value, {
    status,
    headers: { ...noStore, ...Object.fromEntries(new Headers(headers).entries()) },
  });
}

function oauthError(error: string, status: number, description?: string) {
  return responseJson(
    { error, ...(description ? { error_description: description } : {}) },
    status,
    { "Cache-Control": "no-store", Pragma: "no-cache" },
  );
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char] ?? char;
  });
}

function authPage(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="referrer" content="no-referrer"><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f5f7fa;color:#14202e;margin:0;padding:32px}.card{max-width:520px;margin:8vh auto;background:white;border:1px solid #dce3ea;border-radius:16px;padding:28px;box-shadow:0 10px 32px #14202e12}h1{font-size:22px;margin:0 0 10px}.muted{color:#526174;line-height:1.55}.scope{background:#f3f7fb;border-radius:10px;padding:14px;margin:18px 0}label{display:block;font-size:14px;font-weight:600;margin:18px 0 7px}input[type=password]{box-sizing:border-box;width:100%;padding:12px;border:1px solid #aab7c5;border-radius:8px;font-size:15px}button{border:0;border-radius:8px;padding:11px 16px;font-size:14px;font-weight:650;cursor:pointer}.primary{background:#123b62;color:white}.secondary{background:#edf1f5;color:#1b2733;margin-left:8px}.error{color:#9c2525;background:#fff0f0;border-radius:8px;padding:10px;margin:12px 0}.footer{font-size:12px;color:#69798b;margin-top:20px}</style></head><body><main class="card"><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`,
    {
      status,
      headers: {
        ...noStore,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
      },
    },
  );
}

function isChatGptRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "chatgpt.com" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.pathname.startsWith("/connector/oauth/") ||
        url.pathname === "/connector_platform_oauth_redirect")
    );
  } catch {
    return false;
  }
}

function parseScopes(value: string | null | undefined) {
  // MCP clients commonly omit offline_access. Include it by default so a
  // short-lived access token can be refreshed instead of forcing the user
  // through the authorization screen again every 15 minutes.
  const requested = [
    ...new Set((value ?? `${REPORT_SCOPE} ${OFFLINE_SCOPE}`).split(/\s+/).filter(Boolean)),
  ];
  if (!requested.includes(REPORT_SCOPE)) return null;
  if (requested.some((scope) => scope !== REPORT_SCOPE && scope !== OFFLINE_SCOPE)) return null;
  return requested.sort().join(" ");
}

async function findClient(clientId: string) {
  const { data, error } = await db
    .from("ltms_report_mcp_oauth_clients")
    .select("client_id,client_name,redirect_uris,grant_types")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error("oauth_database");
  return data as {
    client_id: string;
    client_name: string;
    redirect_uris: string[];
    grant_types: string[];
  } | null;
}

async function findActiveMcpKey(rawKey: string) {
  if (!/^orca_mcp_[A-Za-z0-9_-]{40,60}$/.test(rawKey)) return null;
  const { data: key, error } = await db
    .from("ltms_report_mcp_keys")
    .select("id,created_by")
    .eq("token_hash", hash(rawKey))
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new Error("oauth_database");
  if (!key) return null;
  const { data: issuer, error: issuerError } = await db
    .from("app_users")
    .select("id,role,is_active,is_paused")
    .eq("id", key.created_by)
    .maybeSingle();
  if (issuerError) throw new Error("oauth_database");
  if (!issuer || issuer.role !== "admin" || !issuer.is_active || issuer.is_paused) return null;
  return key as { id: string; created_by: string };
}

function validCodeVerifier(value: string) {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}

export function handleOAuthAuthorizationServerMetadata(request: Request) {
  const origin = new URL(request.url).origin;
  return responseJson({
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [REPORT_SCOPE, OFFLINE_SCOPE],
  });
}

export function handleOAuthProtectedResourceMetadata(request: Request) {
  const origin = new URL(request.url).origin;
  return responseJson({
    resource: `${origin}${MCP_PATH}`,
    authorization_servers: [origin],
    scopes_supported: [REPORT_SCOPE, OFFLINE_SCOPE],
    resource_documentation: `${origin}/settings`,
  });
}

export async function handleOAuthClientRegistration(request: Request) {
  if (request.method !== "POST") return oauthError("invalid_request", 405);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return oauthError("invalid_client_metadata", 400);
  }
  const redirects = body.redirect_uris;
  if (
    !Array.isArray(redirects) ||
    redirects.length < 1 ||
    redirects.length > 5 ||
    !redirects.every((uri) => typeof uri === "string" && isChatGptRedirect(uri))
  ) {
    return oauthError("invalid_redirect_uri", 400);
  }
  const responseTypes = Array.isArray(body.response_types) ? body.response_types : ["code"];
  const grantTypes = Array.isArray(body.grant_types)
    ? body.grant_types
    : ["authorization_code", "refresh_token"];
  if (
    responseTypes.length !== 1 ||
    responseTypes[0] !== "code" ||
    grantTypes.some((grant) => grant !== "authorization_code" && grant !== "refresh_token") ||
    !grantTypes.includes("authorization_code") ||
    (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== "none")
  ) {
    return oauthError("invalid_client_metadata", 400);
  }
  const normalizedGrantTypes = [...new Set(grantTypes as string[])];
  const clientId = randomToken("orca_client_");
  const clientName =
    typeof body.client_name === "string" && body.client_name.trim()
      ? body.client_name.trim().slice(0, 100)
      : "ChatGPT MCP client";
  const redirectUris = [...new Set(redirects as string[])];
  const { error } = await db.from("ltms_report_mcp_oauth_clients").insert({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: normalizedGrantTypes,
  });
  if (error) {
    console.error("[ltms-report-mcp-oauth] Client registration failed:", error.code);
    return oauthError("server_error", 503);
  }
  return responseJson(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: clientName,
      redirect_uris: redirectUris,
      response_types: ["code"],
      grant_types: normalizedGrantTypes,
      token_endpoint_auth_method: "none",
      application_type: "web",
    },
    201,
  );
}

function authorizeForm(requestHandle: string, errorText?: string) {
  const body = `${errorText ? `<p class="error">${escapeHtml(errorText)}</p>` : ""}<p class="muted"><strong>ORCA LTMS Reports</strong> is requesting read-only access to report data. The connection cannot create, edit, delete, or post ERP records.</p><div class="scope"><strong>Permission</strong><br><span class="muted">Read-only LTMS finance/operations and accounting journal, ledger and balance reports, plus complete HRMS payroll, payment, loan, advance, deduction, incentive, paid-leave and attendance histories. This includes sensitive financial, employee and compensation data; an active administrator must authorize access.</span></div><form method="post" action="/api/oauth/authorize"><input type="hidden" name="request_handle" value="${escapeHtml(requestHandle)}"><label for="admin_username">Admin login ID</label><input id="admin_username" name="admin_username" type="text" autocomplete="username" required maxlength="120" placeholder="admin"><label for="admin_password">Admin password</label><input id="admin_password" name="admin_password" type="password" autocomplete="current-password" required maxlength="200"><p class="muted">Credentials are submitted only to this ORCA server over HTTPS. They are not stored or sent to ChatGPT.</p><div><button class="primary" name="decision" value="allow">Authorize read-only access</button><button class="secondary" name="decision" value="deny" formnovalidate>Cancel</button></div></form><p class="footer">You can revoke this connection from ERP → Settings → AI Report MCP.</p>`;
  return authPage("Connect ChatGPT to ORCA", body);
}

function authorizationErrorPage(message: string, status = 400) {
  return authPage(
    "Cannot authorize ChatGPT",
    `<p class="error">${escapeHtml(message)}</p><p class="muted">Close this window and restart the connection from ChatGPT.</p>`,
    status,
  );
}
function authorizationRedirectPage(targetUrl: string) {
  const nonce = randomBytes(18).toString("base64url");
  const safeTarget = escapeHtml(targetUrl);
  const scriptTarget = JSON.stringify(targetUrl).replace(/</g, "\\u003c");
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Returning to ChatGPT</title><meta name="referrer" content="no-referrer"><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f5f7fa;color:#14202e;margin:0;padding:32px}.card{max-width:520px;margin:8vh auto;background:white;border:1px solid #dce3ea;border-radius:16px;padding:28px;box-shadow:0 10px 32px #14202e12}h1{font-size:22px;margin:0 0 10px}.muted{color:#526174;line-height:1.55}a{display:inline-block;margin-top:12px;background:#123b62;color:white;text-decoration:none;border-radius:8px;padding:11px 16px;font-weight:650}</style><script nonce="${nonce}">window.location.replace(${scriptTarget});</script></head><body><main class="card"><h1>Returning to ChatGPT</h1><p class="muted">Your authorization is complete. If you are not redirected automatically, continue to ChatGPT using this button.</p><a href="${safeTarget}">Continue to ChatGPT</a></main></body></html>`,
    {
      status: 200,
      headers: {
        ...noStore,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; navigate-to https://chatgpt.com; base-uri 'none'; frame-ancestors 'none'`,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
      },
    },
  );
}
async function validateAuthorizationParams(params: URLSearchParams, request: Request) {
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const state = params.get("state") ?? "";
  const challenge = params.get("code_challenge") ?? "";
  const resource = params.get("resource") ?? mcpResource(request);
  const scope = parseScopes(params.get("scope"));
  if (
    params.get("response_type") !== "code" ||
    !clientId ||
    !redirectUri ||
    !state ||
    state.length > 2048 ||
    params.get("code_challenge_method") !== "S256" ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(challenge) ||
    resource !== mcpResource(request) ||
    !scope
  ) {
    return null;
  }
  const client = await findClient(clientId);
  if (!client || !client.redirect_uris.includes(redirectUri) || !isChatGptRedirect(redirectUri))
    return null;
  if (scope.split(" ").includes(OFFLINE_SCOPE) && !client.grant_types.includes("refresh_token"))
    return null;
  return { clientId, redirectUri, state, challenge, resource, scope };
}

export async function handleOAuthAuthorize(request: Request) {
  if (request.method === "GET") {
    try {
      const params = new URL(request.url).searchParams;
      const validated = await validateAuthorizationParams(params, request);
      if (!validated)
        return authorizationErrorPage("The ChatGPT authorization request is invalid or expired.");
      const handle = randomToken("orca_request_");
      const { error } = await db.from("ltms_report_mcp_oauth_requests").insert({
        request_hash: hash(handle),
        client_id: validated.clientId,
        redirect_uri: validated.redirectUri,
        oauth_state: validated.state,
        code_challenge: validated.challenge,
        resource: validated.resource,
        scope: validated.scope,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
      if (error) {
        console.error(
          "[ltms-report-mcp-oauth] Authorization request could not be stored:",
          error.code,
        );
        return authorizationErrorPage("Authorization is temporarily unavailable.", 503);
      }
      return authorizeForm(handle);
    } catch (error) {
      console.error(
        "[ltms-report-mcp-oauth] Authorization page failed:",
        error instanceof Error ? error.message : "unknown",
      );
      return authorizationErrorPage("Authorization is temporarily unavailable.", 503);
    }
  }

  if (request.method !== "POST") return authorizationErrorPage("Unsupported request method.", 405);
  try {
    const form = await request.formData();
    const requestHandle = String(form.get("request_handle") ?? "");
    if (!/^orca_request_[A-Za-z0-9_-]{40,60}$/.test(requestHandle))
      return authorizationErrorPage(
        "The authorization request is invalid. Restart the connection.",
      );
    const { data: pending, error: pendingError } = await db
      .from("ltms_report_mcp_oauth_requests")
      .select(
        "id,client_id,redirect_uri,oauth_state,code_challenge,resource,scope,expires_at,consumed_at",
      )
      .eq("request_hash", hash(requestHandle))
      .gt("expires_at", new Date().toISOString())
      .is("consumed_at", null)
      .maybeSingle();
    if (pendingError) throw new Error("oauth_database");
    if (!pending)
      return authorizationErrorPage("The authorization request expired. Restart the connection.");

    const decision = String(form.get("decision") ?? "");
    const redirect = new URL(pending.redirect_uri as string);
    redirect.searchParams.set("state", pending.oauth_state as string);
    if (decision === "deny") {
      const { error } = await db
        .from("ltms_report_mcp_oauth_requests")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", pending.id)
        .is("consumed_at", null);
      if (error) throw new Error("oauth_database");
      redirect.searchParams.set("error", "access_denied");
      redirect.searchParams.set(
        "error_description",
        "The user did not authorize read-only report access.",
      );
      return authorizationRedirectPage(redirect.toString());
    }
    if (decision !== "allow")
      return authorizationErrorPage("Choose whether to authorize or cancel.");

    const username = String(form.get("admin_username") ?? "").trim().toLowerCase();
    const password = String(form.get("admin_password") ?? "");
    if (!username || !password) return authorizeForm(requestHandle, "Enter the administrator login ID and password.");
    const { data: admin, error: adminError } = await db
      .from("app_users")
      .select("id,role,password,is_active,is_paused")
      .eq("username", username)
      .maybeSingle();
    if (adminError) throw new Error("oauth_database");
    if (!admin || admin.role !== "admin" || !admin.is_active || admin.is_paused || admin.password !== password)
      return authorizeForm(requestHandle, "Invalid administrator login ID or password.");

    // OAuth report credentials are issued directly for the verified admin.
    // No static API key is required, and the password is never persisted.
    const { data: key, error: keyError } = await db
      .from("ltms_report_mcp_keys")
      .select("id,created_by")
      .eq("created_by", admin.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (keyError) throw new Error("oauth_database");
    let oauthKey = key as { id: string; created_by: string } | null;
    if (!oauthKey) {
      // The OAuth flow no longer asks the administrator to create or paste an
      // API key. Keep the existing FK model by creating an internal anchor;
      // only its hash is stored and the raw random value is discarded.
      const internalSecret = randomToken("orca_oauth_anchor_");
      const { data: createdKey, error: createKeyError } = await db
        .from("ltms_report_mcp_keys")
        .insert({
          display_name: "OAuth admin login",
          token_hash: hash(internalSecret),
          created_by: admin.id,
        })
        .select("id,created_by")
        .single();
      if (createKeyError) throw new Error("oauth_database");
      oauthKey = createdKey as { id: string; created_by: string };
    }

    const code = randomToken("orca_code_");
    const codeHash = hash(code);
    const { error: codeError } = await db.from("ltms_report_mcp_oauth_codes").insert({
      code_hash: codeHash,
      client_id: pending.client_id,
      mcp_key_id: oauthKey.id,
      redirect_uri: pending.redirect_uri,
      code_challenge: pending.code_challenge,
      resource: pending.resource,
      scope: pending.scope,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    if (codeError) throw new Error("oauth_database");
    const now = new Date().toISOString();
    const { data: consumed, error: consumeError } = await db
      .from("ltms_report_mcp_oauth_requests")
      .update({ consumed_at: now })
      .eq("id", pending.id)
      .is("consumed_at", null)
      .gt("expires_at", now)
      .select("id")
      .maybeSingle();
    if (consumeError || !consumed) {
      await db.from("ltms_report_mcp_oauth_codes").delete().eq("code_hash", codeHash);
      if (consumeError) throw new Error("oauth_database");
      return authorizationErrorPage(
        "This authorization request was already used. Restart the connection.",
      );
    }
    redirect.searchParams.set("code", code);
    return authorizationRedirectPage(redirect.toString());
  } catch (error) {
    console.error(
      "[ltms-report-mcp-oauth] Authorization POST failed:",
      error instanceof Error ? error.message : "unknown",
    );
    return authorizationErrorPage("Authorization is temporarily unavailable.", 503);
  }
}

async function activeKeyById(keyId: string) {
  const { data: key, error } = await db
    .from("ltms_report_mcp_keys")
    .select("id,created_by")
    .eq("id", keyId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new Error("oauth_database");
  if (!key) return null;
  const { data: issuer, error: issuerError } = await db
    .from("app_users")
    .select("id,role,is_active,is_paused")
    .eq("id", key.created_by)
    .maybeSingle();
  if (issuerError) throw new Error("oauth_database");
  if (!issuer || issuer.role !== "admin" || !issuer.is_active || issuer.is_paused) return null;
  return key as { id: string; created_by: string };
}

function tokenResponse(accessToken: string, refreshToken: string | null, scope: string) {
  return responseJson({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SECONDS,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    scope,
  });
}

export async function handleOAuthToken(request: Request) {
  if (request.method !== "POST") return oauthError("invalid_request", 405);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return oauthError("invalid_request", 400);
  }
  const grantType = String(form.get("grant_type") ?? "");
  const clientId = String(form.get("client_id") ?? "");
  const resource = String(form.get("resource") ?? "");
  if (!clientId || resource !== mcpResource(request)) return oauthError("invalid_target", 400);

  try {
    const client = await findClient(clientId);
    if (!client) return oauthError("invalid_client", 401);

    if (grantType === "authorization_code") {
      const code = String(form.get("code") ?? "");
      const redirectUri = String(form.get("redirect_uri") ?? "");
      const verifier = String(form.get("code_verifier") ?? "");
      if (!code || !redirectUri || !validCodeVerifier(verifier))
        return oauthError("invalid_grant", 400);
      const { data: authCode, error } = await db
        .from("ltms_report_mcp_oauth_codes")
        .select(
          "id,client_id,mcp_key_id,redirect_uri,code_challenge,resource,scope,expires_at,used_at",
        )
        .eq("code_hash", hash(code))
        .eq("client_id", clientId)
        .eq("redirect_uri", redirectUri)
        .gt("expires_at", new Date().toISOString())
        .is("used_at", null)
        .maybeSingle();
      if (error) throw new Error("oauth_database");
      if (!authCode || authCode.resource !== resource) return oauthError("invalid_grant", 400);
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      if (challenge !== authCode.code_challenge) return oauthError("invalid_grant", 400);
      if (!(await activeKeyById(authCode.mcp_key_id as string)))
        return oauthError("invalid_grant", 400);
      const now = new Date().toISOString();
      const { data: consumed, error: consumeError } = await db
        .from("ltms_report_mcp_oauth_codes")
        .update({ used_at: now })
        .eq("id", authCode.id)
        .is("used_at", null)
        .gt("expires_at", now)
        .select("id")
        .maybeSingle();
      if (consumeError) throw new Error("oauth_database");
      if (!consumed) return oauthError("invalid_grant", 400);

      const accessToken = randomToken("orca_access_");
      const refreshToken =
        (authCode.scope as string).split(" ").includes(OFFLINE_SCOPE) &&
        client.grant_types.includes("refresh_token")
          ? randomToken("orca_refresh_")
          : null;
      const { error: insertError } = await db.from("ltms_report_mcp_oauth_tokens").insert({
        client_id: clientId,
        mcp_key_id: authCode.mcp_key_id,
        access_token_hash: hash(accessToken),
        refresh_token_hash: refreshToken ? hash(refreshToken) : null,
        scope: authCode.scope,
        resource,
        expires_at: new Date(Date.now() + ACCESS_TTL_SECONDS * 1000).toISOString(),
        refresh_expires_at: refreshToken
          ? new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString()
          : null,
      });
      if (insertError) throw new Error("oauth_database");
      return tokenResponse(accessToken, refreshToken, authCode.scope as string);
    }

    if (grantType === "refresh_token") {
      const refreshToken = String(form.get("refresh_token") ?? "");
      if (!refreshToken.startsWith("orca_refresh_")) return oauthError("invalid_grant", 400);
      const { data: current, error } = await db
        .from("ltms_report_mcp_oauth_tokens")
        .select("id,client_id,mcp_key_id,scope,resource,refresh_expires_at,revoked_at")
        .eq("refresh_token_hash", hash(refreshToken))
        .eq("client_id", clientId)
        .eq("resource", resource)
        .gt("refresh_expires_at", new Date().toISOString())
        .is("revoked_at", null)
        .maybeSingle();
      if (error) throw new Error("oauth_database");
      if (!current || !(await activeKeyById(current.mcp_key_id as string)))
        return oauthError("invalid_grant", 400);

      const newAccessToken = randomToken("orca_access_");
      const newRefreshToken = randomToken("orca_refresh_");
      const now = new Date().toISOString();
      const { data: rotated, error: rotateError } = await db
        .from("ltms_report_mcp_oauth_tokens")
        .update({
          access_token_hash: hash(newAccessToken),
          refresh_token_hash: hash(newRefreshToken),
          expires_at: new Date(Date.now() + ACCESS_TTL_SECONDS * 1000).toISOString(),
          refresh_expires_at: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString(),
          last_used_at: now,
        })
        .eq("id", current.id)
        .eq("refresh_token_hash", hash(refreshToken))
        .is("revoked_at", null)
        .select("id")
        .maybeSingle();
      if (rotateError) throw new Error("oauth_database");
      if (!rotated) return oauthError("invalid_grant", 400);
      return tokenResponse(newAccessToken, newRefreshToken, current.scope as string);
    }
    return oauthError("unsupported_grant_type", 400);
  } catch (error) {
    console.error(
      "[ltms-report-mcp-oauth] Token request failed:",
      error instanceof Error ? error.message : "unknown",
    );
    return oauthError("server_error", 503);
  }
}

export async function validateOAuthAccessToken(rawToken: string, request: Request) {
  if (!/^orca_access_[A-Za-z0-9_-]{40,60}$/.test(rawToken)) return null;
  const { data: token, error } = await db
    .from("ltms_report_mcp_oauth_tokens")
    .select("id,mcp_key_id,scope,resource")
    .eq("access_token_hash", hash(rawToken))
    .eq("resource", mcpResource(request))
    .gt("expires_at", new Date().toISOString())
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new Error("oauth_database");
  if (!token || !(token.scope as string).split(" ").includes(REPORT_SCOPE)) return null;
  const key = await activeKeyById(token.mcp_key_id as string);
  if (!key) return null;
  const now = new Date().toISOString();
  const [{ error: useError }, { error: keyError }] = await Promise.all([
    db.from("ltms_report_mcp_oauth_tokens").update({ last_used_at: now }).eq("id", token.id),
    db
      .from("ltms_report_mcp_keys")
      .update({ last_used_at: now })
      .eq("id", key.id)
      .is("revoked_at", null),
  ]);
  if (useError || keyError) throw new Error("oauth_database");
  return key;
}
