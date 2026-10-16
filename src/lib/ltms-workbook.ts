/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SNAPSHOT_BYTES = 2_000_000;

export type WorkbookJsonValue =
  string | number | boolean | null | WorkbookJsonValue[] | { [key: string]: WorkbookJsonValue };
export type WorkbookSheetSnapshot = { [key: string]: WorkbookJsonValue };

export type WorkbookManualSheet = {
  id: string;
  name: string;
  owner_id: string;
  is_shared: boolean;
  sheet_data: WorkbookSheetSnapshot;
  updated_at: string;
};

type SessionInput = { sessionToken: string };
type SheetInput = SessionInput & { sheetId: string };
type SaveInput = SessionInput & {
  sheetId?: string;
  name: string;
  sheetData: Record<string, unknown>;
};

async function requireActiveAdmin(sessionToken: string) {
  if (typeof sessionToken !== "string" || sessionToken.length < 32 || sessionToken.length > 2048) {
    throw new Error("A valid administrator session is required. Sign in again.");
  }
  const { verifyAppToken } = await import("@/lib/user-auth");
  const signed = await verifyAppToken(sessionToken);
  if (!signed || !["admin", "semi_admin"].includes(signed.role)) {
    throw new Error("Only an administrator can access the LTMS Workbook.");
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const [{ data: user, error: userError }, { data: activeSession, error: sessionError }] =
    await Promise.all([
      db.from("app_users").select("id,role,is_active,is_paused").eq("id", signed.uid).maybeSingle(),
      db.from("user_sessions").select("session_token").eq("user_id", signed.uid).maybeSingle(),
    ]);
  if (
    userError ||
    sessionError ||
    !user ||
    user.id !== signed.uid ||
    !["admin", "semi_admin"].includes(user.role) ||
    user.role !== signed.role ||
    user.is_active !== true ||
    user.is_paused === true ||
    activeSession?.session_token !== sessionToken
  ) {
    throw new Error("Your administrator session is no longer active. Sign in again.");
  }
  return { db, userId: user.id as string };
}

function validateSheetName(name: unknown) {
  if (typeof name !== "string") throw new Error("Sheet name is required.");
  const clean = name.trim();
  if (!clean || clean.length > 80 || /[\\/?*:[\]]/.test(clean)) {
    throw new Error("Sheet names must be 1–80 characters and cannot contain \\ / ? * : [ or ].");
  }
  return clean;
}

function validateSnapshot(snapshot: unknown): WorkbookSheetSnapshot {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("A valid workbook sheet snapshot is required.");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(snapshot);
  } catch {
    throw new Error("This sheet contains data that cannot be saved.");
  }
  if (serialized.length > MAX_SNAPSHOT_BYTES) {
    throw new Error("This sheet is too large to save (maximum 2 MB per sheet).");
  }
  return JSON.parse(serialized) as WorkbookSheetSnapshot;
}

export const serverLoadWorkbookSheets = createServerFn({ method: "POST" })
  .validator((input: SessionInput) => input)
  .handler(async ({ data }): Promise<WorkbookManualSheet[]> => {
    const { db, userId } = await requireActiveAdmin(data.sessionToken);
    const { data: rows, error } = await db
      .from("ltms_workbook_sheets")
      .select("id,name,owner_id,is_shared,sheet_data,updated_at")
      .or(`owner_id.eq.${userId},is_shared.eq.true`)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`Could not load Workbook sheets: ${error.message}`);
    return (rows ?? []) as WorkbookManualSheet[];
  });

export const serverCreateWorkbookSheet = createServerFn({ method: "POST" })
  .validator((input: SaveInput) => input)
  .handler(async ({ data }): Promise<WorkbookManualSheet> => {
    const { db, userId } = await requireActiveAdmin(data.sessionToken);
    const name = validateSheetName(data.name);
    const sheetData = validateSnapshot(data.sheetData);
    const { data: row, error } = await db
      .from("ltms_workbook_sheets")
      .insert({
        name,
        owner_id: userId,
        is_shared: false,
        sheet_data: sheetData,
        updated_by: userId,
      })
      .select("id,name,owner_id,is_shared,sheet_data,updated_at")
      .single();
    if (error) throw new Error(`Could not create Workbook sheet: ${error.message}`);
    return row as WorkbookManualSheet;
  });

export const serverSaveWorkbookSheet = createServerFn({ method: "POST" })
  .validator((input: SaveInput & { sheetId: string }) => input)
  .handler(async ({ data }): Promise<{ updatedAt: string }> => {
    const { db, userId } = await requireActiveAdmin(data.sessionToken);
    if (!UUID_RE.test(data.sheetId)) throw new Error("Invalid Workbook sheet identifier.");
    const name = validateSheetName(data.name);
    const sheetData = validateSnapshot(data.sheetData);
    const { data: existing, error: loadError } = await db
      .from("ltms_workbook_sheets")
      .select("id,owner_id,is_shared")
      .eq("id", data.sheetId)
      .maybeSingle();
    if (loadError || !existing) throw new Error("Workbook sheet not found.");
    if (existing.owner_id !== userId && existing.is_shared !== true) {
      throw new Error("This private Workbook sheet belongs to another administrator.");
    }
    const { data: updated, error } = await db
      .from("ltms_workbook_sheets")
      .update({
        name,
        sheet_data: sheetData,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.sheetId)
      .or(`owner_id.eq.${userId},is_shared.eq.true`)
      .select("updated_at")
      .maybeSingle();
    if (error) throw new Error(`Could not save Workbook sheet: ${error.message}`);
    if (!updated) {
      throw new Error("This private Workbook sheet belongs to another administrator.");
    }
    return { updatedAt: updated.updated_at as string };
  });

export const serverSetWorkbookSheetSharing = createServerFn({ method: "POST" })
  .validator((input: SheetInput & { isShared: boolean }) => input)
  .handler(async ({ data }): Promise<{ isShared: boolean }> => {
    const { db, userId } = await requireActiveAdmin(data.sessionToken);
    if (!UUID_RE.test(data.sheetId) || typeof data.isShared !== "boolean") {
      throw new Error("Invalid Workbook sharing request.");
    }
    const { data: updated, error } = await db
      .from("ltms_workbook_sheets")
      .update({
        is_shared: data.isShared,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.sheetId)
      .eq("owner_id", userId)
      .select("is_shared")
      .maybeSingle();
    if (error) throw new Error(`Could not update Workbook sharing: ${error.message}`);
    if (!updated) throw new Error("Only the sheet creator can change sharing.");
    return { isShared: updated.is_shared as boolean };
  });

export const serverDeleteWorkbookSheet = createServerFn({ method: "POST" })
  .validator((input: SheetInput) => input)
  .handler(async ({ data }): Promise<{ deleted: true }> => {
    const { db, userId } = await requireActiveAdmin(data.sessionToken);
    if (!UUID_RE.test(data.sheetId)) throw new Error("Invalid Workbook sheet identifier.");
    const { data: deleted, error } = await db
      .from("ltms_workbook_sheets")
      .delete()
      .eq("id", data.sheetId)
      .eq("owner_id", userId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`Could not delete Workbook sheet: ${error.message}`);
    if (!deleted) throw new Error("Only the sheet creator can delete it.");
    return { deleted: true };
  });
