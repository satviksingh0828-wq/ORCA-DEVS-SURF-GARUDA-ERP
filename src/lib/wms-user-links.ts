import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";

export type WmsLinkSettingsData = {
  erpUsers: Array<{
    id: string;
    username: string;
    full_name: string;
    role: string;
    is_active: boolean;
  }>;
  wmsUsers: Array<{
    user_id: number;
    username: string;
    full_name: string;
    role: string;
    is_active: boolean;
  }>;
  links: Array<{
    erp_user_id: string;
    wms_user_id: number;
    linked_by: string | null;
    created_at: string;
    updated_at: string;
  }>;
};

type SessionInput = { sessionToken: string };
type SaveLinkInput = SessionInput & {
  erpUserId: string;
  wmsUserId: number | null;
};

async function requireActiveUser(sessionToken: string) {
  if (typeof sessionToken !== "string" || sessionToken.length < 32 || sessionToken.length > 2048) {
    throw new Error("Your ERP session is unavailable. Sign in again.");
  }
  const { verifyAppToken } = await import("@/lib/user-auth");
  const signedSession = await verifyAppToken(sessionToken);
  if (!signedSession) throw new Error("Your ERP session is no longer active. Sign in again.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: user, error: userError }, { data: currentSession, error: sessionError }] =
    await Promise.all([
      supabaseAdmin
        .from("app_users")
        .select("id, is_active, is_paused")
        .eq("id", signedSession.uid)
        .maybeSingle(),
      supabaseAdmin
        .from("user_sessions")
        .select("session_token")
        .eq("user_id", signedSession.uid)
        .maybeSingle(),
    ]);
  if (
    userError ||
    sessionError ||
    !user ||
    user.is_active !== true ||
    user.is_paused === true ||
    currentSession?.session_token !== sessionToken
  ) {
    throw new Error("Your ERP session is no longer active. Sign in again.");
  }
  return { supabaseAdmin, erpUserId: signedSession.uid };
}

export const serverHasWmsAccess = createServerFn({ method: "POST" })
  .validator((input: SessionInput) => input)
  .handler(async ({ data }): Promise<{ enabled: boolean }> => {
    const { supabaseAdmin, erpUserId } = await requireActiveUser(data.sessionToken);
    const { data: link, error } = await supabaseAdmin
      .from("wms_erp_user_links")
      .select("wms_user_id")
      .eq("erp_user_id", erpUserId)
      .maybeSingle();
    return { enabled: !error && Boolean(link) };
  });

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireActiveAdmin(sessionToken: string) {
  if (typeof sessionToken !== "string" || sessionToken.length < 32 || sessionToken.length > 2048) {
    throw new Error("A valid administrator session is required.");
  }

  const { verifyAppToken } = await import("@/lib/user-auth");
  const signedSession = await verifyAppToken(sessionToken);
  if (!signedSession || signedSession.role !== "admin") {
    throw new Error("Administrator access is required for WMS user linking.");
  }

  const { supabaseAdmin: adminClient } = await import("@/integrations/supabase/client.server");
  const supabaseAdmin = adminClient as unknown as SupabaseClient;
  const [{ data: user, error: userError }, { data: currentSession, error: sessionError }] =
    await Promise.all([
      supabaseAdmin
        .from("app_users")
        .select("id, role, is_active, is_paused")
        .eq("id", signedSession.uid)
        .maybeSingle(),
      supabaseAdmin
        .from("user_sessions")
        .select("session_token")
        .eq("user_id", signedSession.uid)
        .maybeSingle(),
    ]);

  if (
    userError ||
    sessionError ||
    !user ||
    user.id !== signedSession.uid ||
    user.role !== "admin" ||
    user.is_active !== true ||
    user.is_paused === true ||
    currentSession?.session_token !== sessionToken
  ) {
    throw new Error("Your administrator session is no longer active. Sign in again.");
  }

  return { supabaseAdmin, adminUserId: user.id };
}

export const serverLoadWmsUserLinks = createServerFn({ method: "POST" })
  .validator((input: SessionInput) => input)
  .handler(async ({ data }): Promise<WmsLinkSettingsData> => {
    const { supabaseAdmin } = await requireActiveAdmin(data.sessionToken);
    const [erpResult, wmsResult, linksResult] = await Promise.all([
      supabaseAdmin
        .from("app_users")
        .select("id, username, full_name, role, is_active")
        .order("username", { ascending: true }),
      supabaseAdmin
        .from("wms_users")
        .select("user_id, username, full_name, role, is_active")
        .order("username", { ascending: true }),
      supabaseAdmin
        .from("wms_erp_user_links")
        .select("erp_user_id, wms_user_id, linked_by, created_at, updated_at")
        .order("created_at", { ascending: true }),
    ]);

    if (erpResult.error) throw new Error("Could not load ERP users for WMS linking.");
    if (wmsResult.error) {
      throw new Error(
        "Could not load WMS users. Confirm the WMS table is in the shared Supabase public schema.",
      );
    }
    if (linksResult.error) {
      throw new Error("WMS linking is not set up yet. Apply the supplied SQL migration first.");
    }

    return {
      erpUsers: erpResult.data ?? [],
      wmsUsers: wmsResult.data ?? [],
      links: linksResult.data ?? [],
    };
  });

export const serverSaveWmsUserLink = createServerFn({ method: "POST" })
  .validator((input: SaveLinkInput) => input)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    if (!UUID_PATTERN.test(data.erpUserId)) throw new Error("Select a valid ERP user.");
    if (data.wmsUserId !== null && (!Number.isSafeInteger(data.wmsUserId) || data.wmsUserId < 1)) {
      throw new Error("Select a valid WMS user.");
    }

    const { supabaseAdmin, adminUserId } = await requireActiveAdmin(data.sessionToken);
    const { data: erpUser, error: erpError } = await supabaseAdmin
      .from("app_users")
      .select("id")
      .eq("id", data.erpUserId)
      .maybeSingle();
    if (erpError || !erpUser) throw new Error("The selected ERP user no longer exists.");

    if (data.wmsUserId === null) {
      const { error } = await supabaseAdmin
        .from("wms_erp_user_links")
        .delete()
        .eq("erp_user_id", data.erpUserId);
      if (error) throw new Error("Could not remove the WMS user link.");
      return { ok: true };
    }

    const { data: wmsUser, error: wmsError } = await supabaseAdmin
      .from("wms_users")
      .select("user_id")
      .eq("user_id", data.wmsUserId)
      .maybeSingle();
    if (wmsError || !wmsUser) throw new Error("The selected WMS user no longer exists.");

    const { data: existingLink, error: linkCheckError } = await supabaseAdmin
      .from("wms_erp_user_links")
      .select("erp_user_id")
      .eq("wms_user_id", data.wmsUserId)
      .maybeSingle();
    if (linkCheckError) throw new Error("Could not verify whether the WMS user is already linked.");
    if (existingLink && existingLink.erp_user_id !== data.erpUserId) {
      throw new Error("That WMS account is already linked to a different ERP user.");
    }

    const { error: saveError } = await supabaseAdmin.from("wms_erp_user_links").upsert(
      {
        erp_user_id: data.erpUserId,
        wms_user_id: data.wmsUserId,
        linked_by: adminUserId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "erp_user_id" },
    );
    if (saveError) throw new Error("Could not save the WMS user link.");

    return { ok: true };
  });
