/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Download, LoaderCircle, Plus, RefreshCw, Share2, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConsignmentIncomeReport } from "@/components/reports/ConsignmentIncomeReport";
import { TransporterExpenditureReport } from "@/components/reports/TransporterExpenditureReport";
import { UnloadingIncomeReport } from "@/components/reports/UnloadingIncomeReport";
import {
  InwardReceiptChargesReport,
  LoadingChargesReportContent,
} from "@/components/reports/LoadingChargesReport";
import { TripExpenditureReport } from "@/components/reports/TripExpenditureReport";
import { ConsignmentNetReport } from "@/components/reports/ConsignmentNetReport";
import { fetchAll } from "@/lib/fetch-all";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import {
  serverCreateWorkbookSheet,
  serverDeleteWorkbookSheet,
  serverLoadWorkbookSheets,
  serverSaveWorkbookSheet,
  serverSetWorkbookSheetSharing,
  type WorkbookManualSheet,
  type WorkbookSheetSnapshot,
} from "@/lib/ltms-workbook";
import "@univerjs/preset-sheets-core/lib/index.css";

type ReportRows = Record<string, object[]>;
type RowSource = (rows: object[]) => void;
type UniverRuntime = {
  univer: { dispose: () => void };
  univerAPI: any;
  workbook: any;
};

const REPORT_SHEETS = [
  "Consignment Income",
  "Transporter Expenditure",
  "Unloading Income",
  "Loading Charges",
  "Unloading Charges",
  "Trip Expenditure",
  "Consignment Net",
  "Workmen Loading",
  "Workmen Unloading",
] as const;
type ReportSheetName = (typeof REPORT_SHEETS)[number];
const EMPTY_ROWS: object[] = [];

function displayValue(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return value;
  return "";
}

function flattenReportRow(row: object) {
  const flattened: Record<string, unknown> = {};
  const addValue = (path: string, value: unknown) => {
    if (value == null || typeof value !== "object") {
      flattened[path] = value;
      return;
    }
    if (Array.isArray(value)) {
      const records = value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      );
      if (records.length) {
        flattened[`${path}.Count`] = records.length;
        const childKeys = [...new Set(records.flatMap((item) => Object.keys(item)))];
        for (const key of childKeys) {
          const childValues = records.map((item) => item[key]).filter((item) => item != null);
          addValue(`${path}.${key}`, childValues.length === 1 ? childValues[0] : childValues);
        }
      } else {
        flattened[path] = value
          .map(displayValue)
          .filter((item) => item != null && item !== "")
          .join(", ");
      }
      return;
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) {
      flattened[path] = null;
      return;
    }
    for (const [key, child] of entries) addValue(path ? `${path}.${key}` : key, child);
  };
  for (const [key, value] of Object.entries(row)) addValue(key, value);
  return flattened;
}

function columnLabel(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function rowsToMatrix(rows: object[]) {
  const flattenedRows = rows.map(flattenReportRow);
  const keys = [...new Set(flattenedRows.flatMap((row) => Object.keys(row)))];
  if (!keys.length)
    return { keys: ["Status"], matrix: [["No report rows for the current report period"]] };
  return {
    keys,
    matrix: [
      keys.map(columnLabel),
      ...flattenedRows.map((row) => keys.map((key) => displayValue(row[key]))),
    ],
  };
}

function getManualSnapshot(worksheet: any): WorkbookSheetSnapshot {
  return JSON.parse(JSON.stringify(worksheet.getSheet().getSnapshot())) as WorkbookSheetSnapshot;
}

function getPersistedSnapshot(worksheet: any, canonicalName: string): WorkbookSheetSnapshot {
  return { ...getManualSnapshot(worksheet), name: canonicalName };
}

function visibleManualName(name: string, used: Set<string>) {
  let candidate = name;
  let suffix = 2;
  while (used.has(candidate.toLocaleLowerCase())) {
    candidate = `${name.slice(0, 72)} (${suffix})`;
    suffix += 1;
  }
  used.add(candidate.toLocaleLowerCase());
  return candidate;
}

function ReportRowSources({
  onRows,
  reportMonth,
}: {
  onRows: (sheet: ReportSheetName, rows: object[]) => void;
  reportMonth: string;
}) {
  const income = useCallback<RowSource>((rows) => onRows("Consignment Income", rows), [onRows]);
  const transporter = useCallback<RowSource>(
    (rows) => onRows("Transporter Expenditure", rows),
    [onRows],
  );
  const unloadingIncome = useCallback<RowSource>(
    (rows) => onRows("Unloading Income", rows),
    [onRows],
  );
  const loading = useCallback<RowSource>((rows) => onRows("Loading Charges", rows), [onRows]);
  const unloading = useCallback<RowSource>((rows) => onRows("Unloading Charges", rows), [onRows]);
  const trip = useCallback<RowSource>((rows) => onRows("Trip Expenditure", rows), [onRows]);
  const net = useCallback<RowSource>((rows) => onRows("Consignment Net", rows), [onRows]);
  return (
    <div aria-hidden="true" className="hidden">
      <ConsignmentIncomeReport onWorkbookRows={income} reportMonth={reportMonth} />
      <TransporterExpenditureReport onWorkbookRows={transporter} reportMonth={reportMonth} />
      <UnloadingIncomeReport onWorkbookRows={unloadingIncome} reportMonth={reportMonth} />
      <LoadingChargesReportContent onWorkbookRows={loading} reportMonth={reportMonth} />
      <InwardReceiptChargesReport onWorkbookRows={unloading} reportMonth={reportMonth} />
      <TripExpenditureReport onWorkbookRows={trip} reportMonth={reportMonth} />
      <ConsignmentNetReport onWorkbookRows={net} reportMonth={reportMonth} />
    </div>
  );
}

export function LtmsWorkbook() {
  const { user } = useSession();
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<UniverRuntime | null>(null);
  const manualSheetIdBySubUnit = useRef(new Map<string, string>());
  const manualSheetNameById = useRef(new Map<string, string>());
  const activeSheetName = useRef<string | null>(null);
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const reportUpdateQueue = useRef(Promise.resolve());
  const [reportRows, setReportRows] = useState<ReportRows>({});
  const [reportMonth, setReportMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [manualSheets, setManualSheets] = useState<WorkbookManualSheet[]>([]);
  const [activeSubUnitId, setActiveSubUnitId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved">("idle");
  const [refreshKey, setRefreshKey] = useState(0);
  const [workbookMounted, setWorkbookMounted] = useState(false);
  const sessionToken = user?.sessionToken ?? "";
  const currentManualSheet = useMemo(
    () =>
      manualSheets.find(
        (sheet) =>
          sheet.id ===
          (activeSubUnitId ? manualSheetIdBySubUnit.current.get(activeSubUnitId) : undefined),
      ) ?? null,
    [activeSubUnitId, manualSheets],
  );

  const updateReportRows = useCallback((sheet: ReportSheetName, rows: object[]) => {
    setReportRows((current) => ({ ...current, [sheet]: rows }));
  }, []);

  const loadManualSheets = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await serverLoadWorkbookSheets({ data: { sessionToken } });
      setManualSheets(rows);
      manualSheetNameById.current = new Map(rows.map((row) => [row.id, row.name]));
    } catch (error) {
      setManualSheets([]);
      toast.error(
        error instanceof Error ? error.message : "Could not load private Workbook sheets",
      );
    } finally {
      setLoading(false);
      setReady(true);
    }
  }, [sessionToken]);

  useEffect(() => {
    void loadManualSheets();
  }, [loadManualSheets]);

  useEffect(() => {
    let disposed = false;
    let runtime: UniverRuntime | null = null;
    const boot = async () => {
      if (!containerRef.current || !ready) return;
      try {
        const [{ createUniver, LocaleType, mergeLocales }, { UniverSheetsCorePreset }, enUS] =
          await Promise.all([
            import("@univerjs/presets"),
            import("@univerjs/preset-sheets-core"),
            import("@univerjs/preset-sheets-core/locales/en-US"),
          ]);
        if (disposed || !containerRef.current) return;
        const { univer, univerAPI } = createUniver({
          locale: LocaleType.EN_US,
          locales: { [LocaleType.EN_US]: mergeLocales(enUS.default) },
          presets: [
            UniverSheetsCorePreset({
              container: containerRef.current,
              header: false,
              toolbar: false,
              footer: { sheetBar: true, addSheetButtonConfig: { show: false } },
              contextMenu: false,
              disableAutoFocus: true,
            }),
          ],
        });
        const workbook = univerAPI.createWorkbook({});
        const initialSheets = workbook.getSheets();
        if (!initialSheets.length) throw new Error("Univer did not create a default sheet.");
        initialSheets[0].setName(REPORT_SHEETS[0]);
        const usedNames = new Set<string>(REPORT_SHEETS.map((name) => name.toLocaleLowerCase()));
        for (const name of REPORT_SHEETS.slice(1)) workbook.create(name, 200, 26);
        const loadedSheets: WorkbookManualSheet[] = [];
        for (const item of manualSheets) {
          const name = visibleManualName(item.name, usedNames);
          const snapshot = item.sheet_data as unknown as {
            rowCount?: number;
            columnCount?: number;
          };
          const sheetSnapshot = { ...item.sheet_data, name };
          const sheet = workbook.create(
            name,
            snapshot.rowCount ?? 1000,
            snapshot.columnCount ?? 26,
            {
              sheet: sheetSnapshot as never,
            },
          );
          const permission = sheet.getWorksheetPermission();
          if (!permission.isProtected())
            await permission.protect({ name: `${name} workbook sheet` });
          await permission.setEditable();
          loadedSheets.push(item);
          manualSheetIdBySubUnit.current.set(sheet.getSheetId(), item.id);
          manualSheetNameById.current.set(item.id, item.name);
        }
        for (const name of REPORT_SHEETS) {
          const sheet = workbook.getSheetByName(name);
          if (!sheet) continue;
          const permission = sheet.getWorksheetPermission();
          if (!permission.isProtected())
            await permission.protect({ name: `${name} monthly report` });
          await permission.setReadOnly();
        }
        runtime = { univer, univerAPI, workbook };
        runtimeRef.current = runtime;
        setWorkbookMounted(true);
        const preferredSheet = activeSheetName.current
          ? workbook.getSheetByName(activeSheetName.current)
          : null;
        const firstManualSheet = workbook
          .getSheets()
          .find((sheet: any) => manualSheetIdBySubUnit.current.has(sheet.getSheetId()));
        const initialActiveSheet = preferredSheet ?? firstManualSheet ?? workbook.getSheets()[0];
        if (initialActiveSheet) {
          workbook.setActiveSheet(initialActiveSheet);
          activeSheetName.current = initialActiveSheet.getSheetName();
          setActiveSubUnitId(initialActiveSheet.getSheetId());
        }
        const changeSubscription = univerAPI.addEvent(
          univerAPI.Event.SheetValueChanged,
          (event: any) => {
            const subUnitId = event?.payload?.params?.subUnitId;
            const id = manualSheetIdBySubUnit.current.get(subUnitId);
            if (!id || !sessionToken) return;
            const existingTimer = saveTimers.current.get(id);
            if (existingTimer) clearTimeout(existingTimer);
            setSavingState("saving");
            saveTimers.current.set(
              id,
              setTimeout(async () => {
                const sheet = workbook.getSheetBySheetId(subUnitId);
                if (!sheet) return;
                try {
                  const canonicalName = manualSheetNameById.current.get(id) ?? sheet.getSheetName();
                  const data = getPersistedSnapshot(sheet, canonicalName);
                  const saved = await serverSaveWorkbookSheet({
                    data: {
                      sessionToken,
                      sheetId: id,
                      name: canonicalName,
                      sheetData: data,
                    },
                  });
                  setManualSheets((current) =>
                    current.map((item) =>
                      item.id === id
                        ? {
                            ...item,
                            sheet_data: data,
                            updated_at: saved.updatedAt,
                          }
                        : item,
                    ),
                  );
                  setSavingState("saved");
                } catch (error) {
                  setSavingState("idle");
                  toast.error(error instanceof Error ? error.message : "Workbook autosave failed");
                } finally {
                  saveTimers.current.delete(id);
                }
              }, 900),
            );
          },
        );
        const activeSubscription = univerAPI.addEvent(
          univerAPI.Event.ActiveSheetChanged,
          (event: any) => {
            if (event.activeSheet) {
              activeSheetName.current = event.activeSheet.getSheetName();
              setActiveSubUnitId(event.activeSheet.getSheetId());
            }
          },
        );
        (
          runtime as UniverRuntime & { subscriptions?: Array<{ dispose: () => void }> }
        ).subscriptions = [changeSubscription, activeSubscription];
      } catch (error) {
        console.error("[LTMS Workbook] Could not initialize Univer", error);
        toast.error(
          error instanceof Error ? error.message : "Could not open the Workbook spreadsheet",
        );
      }
    };
    void boot();
    const pendingSaveTimers = saveTimers.current;
    const sheetIdMap = manualSheetIdBySubUnit.current;
    return () => {
      disposed = true;
      for (const [id, timer] of pendingSaveTimers.entries()) {
        clearTimeout(timer);
        const sheet = runtime?.workbook
          .getSheets()
          .find((candidate: any) => sheetIdMap.get(candidate.getSheetId()) === id);
        if (sheet && sessionToken) {
          void serverSaveWorkbookSheet({
            data: {
              sessionToken,
              sheetId: id,
              name: manualSheetNameById.current.get(id) ?? sheet.getSheetName(),
              sheetData: getPersistedSnapshot(
                sheet,
                manualSheetNameById.current.get(id) ?? sheet.getSheetName(),
              ),
            },
          }).catch((error) => console.error("[LTMS Workbook] Final autosave failed", error));
        }
      }
      pendingSaveTimers.clear();
      if (runtime) {
        (
          runtime as UniverRuntime & { subscriptions?: Array<{ dispose: () => void }> }
        ).subscriptions?.forEach((item) => item.dispose());
        queueMicrotask(() => runtime?.univer.dispose());
      }
      if (runtimeRef.current === runtime) runtimeRef.current = null;
      sheetIdMap.clear();
      manualSheetNameById.current.clear();
    };
    // Univer is mounted once after the per-admin manual-sheet list is loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, refreshKey, reportMonth]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    reportUpdateQueue.current = reportUpdateQueue.current
      .then(async () => {
        if (runtimeRef.current !== runtime) return;
        for (const name of REPORT_SHEETS) {
          const sheet = runtime.workbook.getSheetByName(name);
          if (!sheet) continue;
          const { keys, matrix } = rowsToMatrix(reportRows[name] ?? EMPTY_ROWS);
          const permission = sheet.getWorksheetPermission();
          if (!permission.isProtected())
            await permission.protect({ name: `${name} monthly report` });
          await permission.setEditable();
          try {
            sheet.setRowCount(Math.max(200, matrix.length));
            sheet.setColumnCount(Math.max(26, keys.length));
            sheet.clearContents();
            sheet.getRange(0, 0, matrix.length, keys.length).setValues(matrix);
            if (keys.length) sheet.getRange(0, 0, 1, keys.length).setFontWeight("bold");
          } finally {
            await permission.setReadOnly();
          }
        }
      })
      .catch((error) => {
        console.error("[LTMS Workbook] Could not refresh report worksheets", error);
      });
  }, [reportRows, workbookMounted]);

  useEffect(() => {
    let cancelled = false;
    async function loadWorkmenRows() {
      try {
        const db = supabase as any;
        const items = await fetchAll<Record<string, any>>(() =>
          db
            .from("workmen_bill_items")
            .select(
              "id,bill_id,charge_type,reference_number,reference_date,package_type,calculated_amount,deduction,addition,final_amount",
            )
            .order("reference_date", { ascending: false }),
        );
        const billIds = [...new Set(items.map((item) => item.bill_id).filter(Boolean))];
        const bills = billIds.length
          ? await fetchAll<Record<string, any>>(() =>
              db
                .from("workmen_bills")
                .select(
                  "id,bill_number,bill_date,period_from,period_to,branch:branches(branch_name)",
                )
                .is("deleted_at", null)
                .in("id", billIds),
            )
          : [];
        if (cancelled) return;
        const billMap = new Map(bills.map((bill) => [bill.id, bill]));
        const monthStart = `${reportMonth}-01`;
        const nextMonth = new Date(
          Number(reportMonth.slice(0, 4)),
          Number(reportMonth.slice(5, 7)),
          1,
        );
        const monthEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`;
        const rows = items
          .filter((item) => {
            const bill = billMap.get(item.bill_id);
            const billDate = String(bill?.bill_date ?? "").slice(0, 10);
            return Boolean(bill && billDate >= monthStart && billDate < monthEnd);
          })
          .map((item) => {
            const bill = billMap.get(item.bill_id)!;
            return {
              charge_type: item.charge_type,
              id: item.id,
              bill_number: bill.bill_number,
              bill_date: bill.bill_date,
              period_from: bill.period_from,
              period_to: bill.period_to,
              branch: bill.branch?.branch_name ?? "",
              reference_number: item.reference_number,
              reference_date: item.reference_date,
              package_type: item.package_type ?? "",
              calculated_amount: Number(item.calculated_amount ?? 0),
              deduction: Number(item.deduction ?? 0),
              addition: Number(item.addition ?? 0),
              final_amount: Number(item.final_amount ?? 0),
            };
          });
        setReportRows((current) => ({
          ...current,
          "Workmen Loading": rows.filter(
            (item) => (item as Record<string, unknown>).charge_type === "loading",
          ),
          "Workmen Unloading": rows.filter(
            (item) => (item as Record<string, unknown>).charge_type === "unloading",
          ),
        }));
      } catch (error) {
        if (!cancelled)
          toast.error(
            error instanceof Error ? error.message : "Could not load Workmen Charges rows",
          );
      }
    }
    void loadWorkmenRows();
    return () => {
      cancelled = true;
    };
  }, [reportMonth, refreshKey]);

  useEffect(() => {
    const timer = window.setInterval(
      () => {
        setReportRows({});
        setRefreshKey((current) => current + 1);
      },
      5 * 60 * 1000,
    );
    return () => window.clearInterval(timer);
  }, []);

  const addSheet = useCallback(async () => {
    if (!runtimeRef.current || !sessionToken) return;
    const currentNames = new Set<string>(
      runtimeRef.current.workbook
        .getSheets()
        .map((sheet: any) => sheet.getSheetName().toLocaleLowerCase()),
    );
    const name = window.prompt("Name this private sheet", "New Sheet")?.trim();
    if (!name) return;
    if (name.length > 80 || /[\\/?*:[\]]/.test(name)) {
      toast.error("Sheet names must be 1–80 characters and cannot contain \\ / ? * : [ or ].");
      return;
    }
    const uniqueName = visibleManualName(name, currentNames);
    const sheet = runtimeRef.current.workbook.create(uniqueName, 1000, 26);
    const permission = sheet.getWorksheetPermission();
    if (!permission.isProtected())
      await permission.protect({ name: `${uniqueName} workbook sheet` });
    await permission.setEditable();
    const initialData = getManualSnapshot(sheet);
    try {
      const created = await serverCreateWorkbookSheet({
        data: { sessionToken, name: uniqueName, sheetData: initialData },
      });
      manualSheetIdBySubUnit.current.set(sheet.getSheetId(), created.id);
      manualSheetNameById.current.set(created.id, created.name);
      runtimeRef.current.workbook.setActiveSheet(sheet);
      setManualSheets((current) => [...current, created]);
      setActiveSubUnitId(sheet.getSheetId());
      toast.success("Private Workbook sheet created");
    } catch (error) {
      runtimeRef.current.workbook.deleteSheet(sheet);
      toast.error(error instanceof Error ? error.message : "Could not create Workbook sheet");
    }
  }, [sessionToken]);

  const toggleSharing = useCallback(async () => {
    if (!currentManualSheet || !sessionToken) return;
    try {
      const result = await serverSetWorkbookSheetSharing({
        data: {
          sessionToken,
          sheetId: currentManualSheet.id,
          isShared: !currentManualSheet.is_shared,
        },
      });
      setManualSheets((current) =>
        current.map((item) =>
          item.id === currentManualSheet.id ? { ...item, is_shared: result.isShared } : item,
        ),
      );
      toast.success(
        result.isShared ? "Sheet shared with all administrators" : "Sheet is private again",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update sharing");
    }
  }, [currentManualSheet, sessionToken]);

  const deleteSheet = useCallback(async () => {
    if (!runtimeRef.current || !currentManualSheet || !sessionToken) return;
    const sheet = runtimeRef.current.workbook
      .getSheets()
      .find(
        (item: any) =>
          manualSheetIdBySubUnit.current.get(item.getSheetId()) === currentManualSheet.id,
      );
    if (!sheet) return;
    if (
      !window.confirm(
        `Delete the manual sheet “${currentManualSheet.name}”? This cannot be undone.`,
      )
    )
      return;
    try {
      await serverDeleteWorkbookSheet({ data: { sessionToken, sheetId: currentManualSheet.id } });
      manualSheetIdBySubUnit.current.delete(sheet.getSheetId());
      manualSheetNameById.current.delete(currentManualSheet.id);
      runtimeRef.current.workbook.deleteSheet(sheet);
      setManualSheets((current) => current.filter((item) => item.id !== currentManualSheet.id));
      toast.success("Workbook sheet deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete Workbook sheet");
    }
  }, [currentManualSheet, sessionToken]);

  const exportExcel = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const workbook = XLSX.utils.book_new();
    const used = new Set<string>();
    const sheetName = (name: string) => {
      let safeName = name.slice(0, 31);
      let suffix = 2;
      while (used.has(safeName.toLowerCase())) {
        safeName = `${name.slice(0, 26)} (${suffix++})`.slice(0, 31);
      }
      used.add(safeName.toLowerCase());
      return safeName;
    };
    for (const name of REPORT_SHEETS) {
      const { keys, matrix } = rowsToMatrix(reportRows[name] ?? EMPTY_ROWS);
      const worksheet = XLSX.utils.aoa_to_sheet(matrix);
      const lastColumn = XLSX.utils.encode_col(Math.max(keys.length - 1, 0));
      worksheet["!autofilter"] = { ref: `A1:${lastColumn}${matrix.length}` };
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName(name));
    }
    const info = XLSX.utils.aoa_to_sheet([
      ["LTMS Monthly Workbook"],
      ["Report month", reportMonth],
      ["Generated at", new Date().toLocaleString()],
      ["Manual formulas", "Formulas in editable sheets are preserved in the exported workbook."],
    ]);
    XLSX.utils.book_append_sheet(workbook, info, sheetName("Workbook Info"));
    for (const item of manualSheets) {
      const sheet = runtime.workbook
        .getSheets()
        .find(
          (candidate: any) =>
            manualSheetIdBySubUnit.current.get(candidate.getSheetId()) === item.id,
        );
      if (!sheet) continue;
      const snapshot = getManualSnapshot(sheet) as {
        cellData?: Record<string, Record<string, { v?: unknown; f?: string }>>;
      };
      const cellData = snapshot.cellData ?? {};
      const rowIndices = Object.keys(cellData).map(Number).filter(Number.isFinite);
      const maxColumn = Object.values(cellData)
        .flatMap((row) => Object.keys(row ?? {}).map(Number))
        .reduce((max, value) => Math.max(max, value), -1);
      const maxRow = rowIndices.reduce((max, value) => Math.max(max, value), -1);
      const matrix = Array.from({ length: maxRow + 1 }, (_, rowIndex) => {
        const row = cellData[String(rowIndex)] ?? {};
        return Array.from({ length: maxColumn + 1 }, (_, columnIndex) => {
          const cell = row[String(columnIndex)];
          if (cell?.f)
            return {
              t: "n",
              f: String(cell.f).replace(/^=/, ""),
              ...(typeof cell.v === "number" ? { v: cell.v } : {}),
            };
          return cell?.v ?? null;
        });
      });
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet(matrix.length ? matrix : [[]]),
        sheetName(item.name),
      );
    }
    XLSX.writeFile(workbook, `LTMS-Workbook-${reportMonth}.xlsx`);
  }, [manualSheets, reportRows, reportMonth]);

  return (
    <div className="space-y-3">
      <ReportRowSources
        key={`${reportMonth}-${refreshKey}`}
        onRows={updateReportRows}
        reportMonth={reportMonth}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
        <div
          className="flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {loading ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Shield className="size-4" />
          )}
          <span>
            {savingState === "saving"
              ? "Saving changes…"
              : savingState === "saved"
                ? "All changes saved"
                : currentManualSheet?.is_shared
                  ? "Shared sheet · editable by administrators"
                  : currentManualSheet
                    ? "Private sheet · only you can see it"
                    : `Read-only monthly report tabs · ${reportMonth} · refreshed every 5 minutes`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Report month</span>
            <input
              aria-label="Report month"
              type="month"
              value={reportMonth}
              max={`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`}
              onChange={(event) => {
                if (!event.target.value) return;
                setWorkbookMounted(false);
                setReportRows({});
                setActiveSubUnitId(null);
                activeSheetName.current = null;
                setReportMonth(event.target.value);
              }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setWorkbookMounted(false);
              setReportRows({});
              setActiveSubUnitId(null);
              setRefreshKey((current) => current + 1);
            }}
            disabled={!ready}
          >
            <RefreshCw className="mr-1.5 size-4" /> Refresh reports
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void addSheet()}
            disabled={!ready || !sessionToken}
          >
            <Plus className="mr-1.5 size-4" /> Add sheet
          </Button>
          {currentManualSheet && currentManualSheet.owner_id === user?.id && (
            <>
              <Button size="sm" variant="outline" onClick={() => void toggleSharing()}>
                <Share2 className="mr-1.5 size-4" />{" "}
                {currentManualSheet.is_shared ? "Unshare" : "Share"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void deleteSheet()}>
                <Trash2 className="mr-1.5 size-4" /> Delete
              </Button>
            </>
          )}
          <Button size="sm" onClick={exportExcel} disabled={!workbookMounted}>
            <Download className="mr-1.5 size-4" /> Export to Excel
          </Button>
        </div>
      </div>
      <div
        className="ltms-workbook-spreadsheet h-[min(76vh,850px)] min-h-[520px]"
        ref={containerRef}
        aria-label="LTMS spreadsheet workbook"
      />
    </div>
  );
}
