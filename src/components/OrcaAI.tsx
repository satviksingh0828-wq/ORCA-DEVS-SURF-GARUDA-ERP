import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Bot, ChevronRight, Download, Loader2, Mic, MicOff, Paperclip, Play, Send, Trash2, X } from "lucide-react";
import { useSession } from "@/lib/session";
import { useOrcaAI } from "@/lib/orca-context";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { ADMIN_ROUTES, BASIC_ROUTES, SEMI_ADMIN_ROUTES, VIEWER_ROUTES, buildCapabilitySummary } from "@/lib/ai/capability-map";
import { getCompactPageInventory } from "@/lib/ai/dom-inventory";
import { classifyButtonAction } from "@/lib/ai/safety";
import { parseExpenseFile, summarizeDrafts } from "@/lib/ai/file-ingestion";
import { buildExpenseImportActions } from "@/lib/ai/workflows/expense-import-workflow";
import { validateActions } from "@/lib/ai/action-validator";
import type { SparrowAction } from "@/lib/ai/types";
import { PoweredBy } from "./PoweredBy";

type ReadOnlyRow = {
  id?: string;
  branch_id?: string | null;
  amount?: string | number | null;
  [key: string]: unknown;
};

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function monthRange(offset = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    start: fmt(start),
    end: fmt(end),
    label: start.toLocaleString("en-IN", { month: "long", year: "numeric" }),
  };
}

const currentMonthRange = () => monthRange(0);

function requestedMonthRange(text: string) {
  if (/last month|previous month/i.test(text)) return monthRange(-1);
  return monthRange(0);
}

function sumAmounts(rows: ReadOnlyRow[]) {
  return rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
}

function applyBranchFilter<T extends { branch_id?: string | null }>(
  rows: T[],
  branchIds: string[] | null,
) {
  if (branchIds === null) return rows;
  return rows.filter((row) => row.branch_id && branchIds.includes(row.branch_id));
}

function asksCurrentMonthInsurancePremium(text: string) {
  return (
    /insurance|premium/i.test(text) &&
    /(this month|current month|month|how much|total|sum)/i.test(text)
  );
}

async function answerCurrentMonthInsurancePremium(text: string, role: string, branchIds: string[] | undefined) {
  const allowedBranchIds = role !== "admin" && role !== "semi_admin" ? (branchIds ?? []) : null;
  if (allowedBranchIds !== null && allowedBranchIds.length === 0) {
    return "No insurance premium data is accessible because your account has no assigned branches.";
  }

  const { start, end, label } = requestedMonthRange(text);
  const rows = await fetchAll<ReadOnlyRow>(() => {
    let query = supabase
      .from("expenditures")
      .select("id,expenditure_name,amount,entry_date,branch_id,is_insurance,note")
      .gte("entry_date", start)
      .lt("entry_date", end)
      .order("entry_date", { ascending: false });

    if (allowedBranchIds !== null) {
      query = query.in("branch_id", allowedBranchIds) as typeof query;
    }
    return query;
  });
  const insuranceRows = rows.filter(
    (row) =>
      row.is_insurance === true || /insurance|premium/i.test(String(row.expenditure_name ?? "")),
  );
  const total = sumAmounts(insuranceRows);
  const details = insuranceRows
    .slice(0, 5)
    .map(
      (row) =>
        `• ${row.entry_date ?? "No date"}: ${row.expenditure_name ?? "Insurance Premium"} — ${money(Number(row.amount ?? 0))}${row.note ? ` (${row.note})` : ""}`,
    )
    .join("\n");

  return `Insurance premium expenditure for ${label} is ${money(total)} across ${insuranceRows.length} row(s).${details ? `\n${details}` : ""}`;
}

const BUSINESS_TABLE_SCHEMAS = [
  "branches(id, branch_name, branch_type, city, state, manager_name)",
  "vehicles(id, registration_number, nickname, branch_id, owner_type, current_fastag_balance)",
  "drivers(id, driver_code, full_name, branch_id, mobile_number)",
  "transporters(id, name, branch_id, mobile_number)",
  "locations(id, location_name, city, state)",
  "contracts(id, source_name, branch_id, is_active) + contract_entries(rate fields)",
  "trips(id, trip_code, branch_id, vehicle_id, driver_id, transporter_id, start_date, start_time, ownership)",
  "closed_trips(id, trip_code, branch_id, start_date, end_date, closed_at, total_income, total_expense, net_income, snapshot)",
  "trip_manifests(trip_id, manifest_number, weight_kg, quantity)",
  "trip_other_income(trip_id, income_name, amount, created_at)",
  "trip_expenses(trip_id, expense_name, amount, created_at, note)",
  "incomes(id, income_name, amount, entry_date, received_date, branch_id, vehicle_id, driver_id, transporter_id)",
  "expenditures(id, expenditure_name, amount, entry_date, paid_date, branch_id, vehicle_id, driver_id, transporter_id, is_insurance, is_road_tax)",
  "driver_payrolls, driver_advances, driver_advance_deductions, fastag_transactions, emi_schedules/installments, vehicle_insurance, vehicle_road_tax, yearly_fixed_expenses",
].join("\n");

function wantsReadOnlyData(text: string) {
  return /(how much|total|sum|report|filter|find|show|list|count|insurance|premium|income|expenditure|expense|vehicle|driver|trip|closed trip|open trip)/i.test(
    text,
  );
}

async function buildReadOnlyDataContext(text: string, role: string, branchIds: string[] | undefined) {
  if (!wantsReadOnlyData(text)) return "";

  const allowedBranchIds = role === "basic" ? (branchIds ?? []) : null;
  if (allowedBranchIds !== null && allowedBranchIds.length === 0) {
    return "READ-ONLY DATA: Basic user has no assigned branches, so no business rows are accessible.";
  }

  const { start, end, label } = requestedMonthRange(text);
  const [expRows, incomeRows, openTripsRows, closedTripsRows, vehiclesRows, driversRows, tripIncomeRows, tripExpenseRows, manifestRows] = await Promise.all([
    fetchAll<ReadOnlyRow>(() => supabase.from("expenditures").select("id,expenditure_name,amount,entry_date,paid_date,branch_id,vehicle_id,driver_id,transporter_id,is_insurance,is_road_tax,note").gte("entry_date", start).lt("entry_date", end).order("entry_date", { ascending: false })),
    fetchAll<ReadOnlyRow>(() => supabase.from("incomes").select("id,income_name,amount,entry_date,received_date,branch_id,vehicle_id,driver_id,transporter_id,note").gte("entry_date", start).lt("entry_date", end).order("entry_date", { ascending: false })),
    fetchAll<ReadOnlyRow>(() => supabase.from("trips").select("id,trip_code,branch_id,vehicle_id,driver_id,transporter_id,start_date,start_time,ownership,created_at").order("created_at", { ascending: false })),
    fetchAll<ReadOnlyRow>(() => supabase.from("closed_trips").select("id,trip_code,branch_id,branch_name,start_date,end_date,closed_at,total_income,total_expense,net_income").gte("closed_at", start).lt("closed_at", end).order("closed_at", { ascending: false })),
    fetchAll<ReadOnlyRow>(() => supabase.from("vehicles").select("id,registration_number,nickname,branch_id").order("registration_number")),
    fetchAll<ReadOnlyRow>(() => supabase.from("drivers").select("id,driver_code,full_name,branch_id").order("full_name")),
    fetchAll<ReadOnlyRow>(() => supabase.from("trip_other_income").select("id,trip_id,income_name,amount,created_at").gte("created_at", start).lt("created_at", end).order("created_at", { ascending: false })),
    fetchAll<ReadOnlyRow>(() => supabase.from("trip_expenses").select("id,trip_id,expense_name,amount,created_at").gte("created_at", start).lt("created_at", end).order("created_at", { ascending: false })),
    fetchAll<ReadOnlyRow>(() => supabase.from("trip_manifests").select("id,trip_id,manifest_number,weight_kg,quantity")),
  ]);

  const expenditures = applyBranchFilter(expRows, allowedBranchIds);
  const incomes = applyBranchFilter(incomeRows, allowedBranchIds);
  const openTrips = applyBranchFilter(openTripsRows, allowedBranchIds);
  const closedTrips = applyBranchFilter(closedTripsRows, allowedBranchIds);
  const vehicles = applyBranchFilter(vehiclesRows, allowedBranchIds);
  const drivers = applyBranchFilter(driversRows, allowedBranchIds);
  const periodOpenTrips = openTrips.filter((row) => String(row.start_date ?? row.created_at ?? "") >= start && String(row.start_date ?? row.created_at ?? "") < end);
  const insuranceRows = expenditures.filter((row) => row.is_insurance === true || /insurance|premium/i.test(String(row.expenditure_name ?? "")));
  const tripIncomeTotal = sumAmounts(tripIncomeRows) + closedTrips.reduce((sum, row) => sum + Number(row.total_income ?? 0), 0);
  const tripExpenseTotal = sumAmounts(tripExpenseRows) + closedTrips.reduce((sum, row) => sum + Number(row.total_expense ?? 0), 0);

  return [
    `READ-ONLY DATA ACCESS: Use this live Supabase data to answer; do not say you cannot access financial data. Data is read-only and already role-filtered.`,
    `Requested period: ${label} (${start} to ${end}, end exclusive).`,
    `Business table schemas available on demand (app/system tables excluded):\n${BUSINESS_TABLE_SCHEMAS}`,
    `Insurance premium expenditure: ${money(sumAmounts(insuranceRows))} across ${insuranceRows.length} row(s).`,
    `Standalone expenditures: ${money(sumAmounts(expenditures))} across ${expenditures.length} row(s).`,
    `Standalone incomes: ${money(sumAmounts(incomes))} across ${incomes.length} row(s).`,
    `Trip income for period (closed_trips.total_income + trip_other_income): ${money(tripIncomeTotal)}. Trip expenses: ${money(tripExpenseTotal)}.`,
    `Open trips total now: ${openTrips.length}; open trips started in period: ${periodOpenTrips.length}; closed trips in period: ${closedTrips.length}; manifests loaded: ${manifestRows.length}; vehicles: ${vehicles.length}; drivers: ${drivers.length}.`,
    `Insurance premium rows: ${insuranceRows.slice(0, 10).map((r) => `${r.entry_date ?? "no date"} ${r.expenditure_name ?? "Insurance"} ${money(Number(r.amount ?? 0))}${r.note ? ` (${r.note})` : ""}`).join("; ") || "none"}.`,
  ].join("\n");
}


function wantsCsvReport(text: string) {
  return /(csv|excel|spreadsheet|download|export|report).*(expense|expenditure|income|trip|branch|driver|vehicle)/i.test(text)
    || /(expense|expenditure|income|trip|branch|driver|vehicle).*(csv|excel|spreadsheet|download|export|report)/i.test(text)
    || /give me.*(report|file|data|list)/i.test(text)
    || /download.*(data|file|report)/i.test(text);
}

type CsvRow = Record<string, string | number>;

function buildCsvBlob(headers: string[], rows: CsvRow[]): string {
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    headers.map(escape).join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ];
  return lines.join("\n");
}

async function generateDataCsv(
  text: string,
  role: string,
  branchIds: string[] | undefined,
): Promise<{ name: string; url: string; summary: string }> {
  const allowedBranchIds = role === "basic" ? (branchIds ?? []) : null;
  if (allowedBranchIds !== null && allowedBranchIds.length === 0) {
    throw new Error("No branches assigned to your account.");
  }

  const { start, end, label } = requestedMonthRange(text);

  // Fetch branch names for ID → name resolution
  const branchRows = await fetchAll<{ id: string; branch_name: string }>(() =>
    supabase.from("branches").select("id,branch_name"),
  );
  const branchMap = new Map(branchRows.map((b) => [b.id, b.branch_name]));

  const isExpense = /expense|expenditure|spend/i.test(text);
  const isIncome = /income|revenue|earning/i.test(text);
  const isTrip = /trip/i.test(text) && !isExpense && !isIncome;
  const isDriver = /driver|payroll|salary/i.test(text);

  let headers: string[] = [];
  let rows: CsvRow[] = [];
  let filename = "report";

  if (isExpense) {
    const data = await fetchAll<ReadOnlyRow>(() => {
      let q = supabase
        .from("expenditures")
        .select("expenditure_name,amount,entry_date,paid_date,branch_id,note,is_insurance,is_road_tax")
        .gte("entry_date", start)
        .lt("entry_date", end)
        .order("entry_date", { ascending: false });
      if (allowedBranchIds !== null) q = q.in("branch_id", allowedBranchIds) as typeof q;
      return q;
    });
    headers = ["Date", "Branch", "Expense Name", "Amount (₹)", "Paid Date", "Note", "Type"];
    rows = data.map((r) => ({
      "Date": String(r.entry_date ?? ""),
      "Branch": branchMap.get(String(r.branch_id ?? "")) ?? String(r.branch_id ?? ""),
      "Expense Name": String(r.expenditure_name ?? ""),
      "Amount (₹)": Number(r.amount ?? 0),
      "Paid Date": String(r.paid_date ?? ""),
      "Note": String(r.note ?? ""),
      "Type": r.is_insurance ? "Insurance" : r.is_road_tax ? "Road Tax" : "General",
    }));
    filename = `expenses-${label.replace(/\s+/g, "-").toLowerCase()}`;
  } else if (isIncome) {
    const data = await fetchAll<ReadOnlyRow>(() => {
      let q = supabase
        .from("incomes")
        .select("income_name,amount,entry_date,received_date,branch_id,note")
        .gte("entry_date", start)
        .lt("entry_date", end)
        .order("entry_date", { ascending: false });
      if (allowedBranchIds !== null) q = q.in("branch_id", allowedBranchIds) as typeof q;
      return q;
    });
    headers = ["Date", "Branch", "Income Name", "Amount (₹)", "Received Date", "Note"];
    rows = data.map((r) => ({
      "Date": String(r.entry_date ?? ""),
      "Branch": branchMap.get(String(r.branch_id ?? "")) ?? String(r.branch_id ?? ""),
      "Income Name": String(r.income_name ?? ""),
      "Amount (₹)": Number(r.amount ?? 0),
      "Received Date": String(r.received_date ?? ""),
      "Note": String(r.note ?? ""),
    }));
    filename = `income-${label.replace(/\s+/g, "-").toLowerCase()}`;
  } else if (isDriver) {
    const data = await fetchAll<ReadOnlyRow>(() => {
      let q = supabase
        .from("drivers")
        .select("driver_code,full_name,branch_id,mobile_number,licence_number,date_of_birth")
        .order("full_name");
      if (allowedBranchIds !== null) q = q.in("branch_id", allowedBranchIds) as typeof q;
      return q;
    });
    headers = ["Driver Code", "Full Name", "Branch", "Mobile", "Licence Number", "Date of Birth"];
    rows = data.map((r) => ({
      "Driver Code": String(r.driver_code ?? ""),
      "Full Name": String(r.full_name ?? ""),
      "Branch": branchMap.get(String(r.branch_id ?? "")) ?? String(r.branch_id ?? ""),
      "Mobile": String(r.mobile_number ?? ""),
      "Licence Number": String(r.licence_number ?? ""),
      "Date of Birth": String(r.date_of_birth ?? ""),
    }));
    filename = "drivers";
  } else if (isTrip) {
    const data = await fetchAll<ReadOnlyRow>(() => {
      let q = supabase
        .from("closed_trips")
        .select("trip_code,branch_name,branch_id,start_date,end_date,closed_at,total_income,total_expense,net_income")
        .gte("closed_at", start)
        .lt("closed_at", end)
        .order("closed_at", { ascending: false });
      if (allowedBranchIds !== null) q = q.in("branch_id", allowedBranchIds) as typeof q;
      return q;
    });
    headers = ["Trip Code", "Branch", "Start Date", "End Date", "Closed At", "Total Income (₹)", "Total Expense (₹)", "Net Income (₹)"];
    rows = data.map((r) => ({
      "Trip Code": String(r.trip_code ?? ""),
      "Branch": String(r.branch_name ?? branchMap.get(String(r.branch_id ?? "")) ?? ""),
      "Start Date": String(r.start_date ?? ""),
      "End Date": String(r.end_date ?? ""),
      "Closed At": String(r.closed_at ?? "").slice(0, 10),
      "Total Income (₹)": Number(r.total_income ?? 0),
      "Total Expense (₹)": Number(r.total_expense ?? 0),
      "Net Income (₹)": Number(r.net_income ?? 0),
    }));
    filename = `trips-${label.replace(/\s+/g, "-").toLowerCase()}`;
  } else {
    // Combined financial report: expenses + income
    const [expData, incData] = await Promise.all([
      fetchAll<ReadOnlyRow>(() => {
        let q = supabase
          .from("expenditures")
          .select("expenditure_name,amount,entry_date,branch_id,note")
          .gte("entry_date", start).lt("entry_date", end).order("entry_date", { ascending: false });
        if (allowedBranchIds !== null) q = q.in("branch_id", allowedBranchIds) as typeof q;
        return q;
      }),
      fetchAll<ReadOnlyRow>(() => {
        let q = supabase
          .from("incomes")
          .select("income_name,amount,entry_date,branch_id,note")
          .gte("entry_date", start).lt("entry_date", end).order("entry_date", { ascending: false });
        if (allowedBranchIds !== null) q = q.in("branch_id", allowedBranchIds) as typeof q;
        return q;
      }),
    ]);
    headers = ["Date", "Type", "Branch", "Name", "Amount (₹)", "Note"];
    rows = [
      ...expData.map((r) => ({
        "Date": String(r.entry_date ?? ""),
        "Type": "Expense",
        "Branch": branchMap.get(String(r.branch_id ?? "")) ?? String(r.branch_id ?? ""),
        "Name": String(r.expenditure_name ?? ""),
        "Amount (₹)": Number(r.amount ?? 0),
        "Note": String(r.note ?? ""),
      })),
      ...incData.map((r) => ({
        "Date": String(r.entry_date ?? ""),
        "Type": "Income",
        "Branch": branchMap.get(String(r.branch_id ?? "")) ?? String(r.branch_id ?? ""),
        "Name": String(r.income_name ?? ""),
        "Amount (₹)": Number(r.amount ?? 0),
        "Note": String(r.note ?? ""),
      })),
    ].sort((a, b) => String(a["Date"]).localeCompare(String(b["Date"])));
    filename = `financial-report-${label.replace(/\s+/g, "-").toLowerCase()}`;
  }

  const csv = buildCsvBlob(headers, rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const total = rows.reduce((s, r) => s + (typeof r["Amount (₹)"] === "number" ? r["Amount (₹)"] : 0), 0);
  const summary = `Generated **${rows.length} rows** for **${label}**${total > 0 ? ` · Total: ${money(total)}` : ""}.`;
  return { name: `${filename}.csv`, url: URL.createObjectURL(blob), summary };
}

// ── Puter.js + Speech Recognition type shims ─────────────────────────────────
declare global {
  interface Window {
    puter?: {
      ai: {
        chat: (
          messages: { role: string; content: string }[],
          options?: { model?: string },
        ) => Promise<{ message: { content: string } }>;
      };
    };
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
  interface SpeechRecognitionInstance extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
    onend: (() => void) | null;
  }
  interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList;
  }
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function fillReactInput(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  nativeSetter ? nativeSetter.call(el, value) : (el.value = value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.focus();
}

/** Get clean trimmed text of an element, stripping icon SVG whitespace. */
function cleanText(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Find an input/textarea associated with a label text.
 * Searches the whole document including open dialogs/portals.
 */
function findInputByLabel(labelText: string): HTMLInputElement | HTMLTextAreaElement | null {
  const needle = labelText.toLowerCase().replace(/[₹*()]/g, "").trim();

  for (const label of Array.from(document.querySelectorAll<HTMLLabelElement>("label"))) {
    const ltext = (label.textContent ?? "").toLowerCase().replace(/[₹*()]/g, "").trim();
    if (!ltext.includes(needle) && !needle.includes(ltext)) continue;

    const forId = label.getAttribute("for");
    if (forId) {
      const el = document.getElementById(forId);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el;
    }
    const nested = label.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
    if (nested) return nested;
    const sibling = label.parentElement?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      "input, textarea",
    );
    if (sibling) return sibling;
  }

  return (
    Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"),
    ).find(
      (i) =>
        i.placeholder?.toLowerCase().includes(needle) ||
        i.getAttribute("aria-label")?.toLowerCase().includes(needle),
    ) ?? null
  );
}

/**
 * Retry finding an input — scrolls to trigger lazy rendering on later attempts.
 */
async function findInputRetry(
  label: string,
  maxAttempts = 6,
  delay = 400,
): Promise<HTMLInputElement | HTMLTextAreaElement | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const el = findInputByLabel(label);
    if (el) return el;
    if (i < maxAttempts - 1) {
      // On retry 2+, scroll the page to trigger lazy renders
      if (i === 2) window.scrollTo({ top: 0, behavior: "smooth" });
      if (i === 3) window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      await sleep(delay);
    }
  }
  return null;
}

const isBlocked = (text: string) => classifyButtonAction(text) !== "allowed";

/**
 * Find a button by text — robust to icon+text combos.
 */
function findButtonByText(text: string): HTMLButtonElement | null {
  const needle = text.toLowerCase().trim();
  const all = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));

  const exact = all.find((b) => cleanText(b) === needle);
  if (exact) return exact;

  const contains = all.find((b) => cleanText(b).includes(needle));
  if (contains) return contains;

  // innerText fallback
  const byInner =
    all.find((b) => (b.innerText ?? "").toLowerCase().trim() === needle) ??
    all.find((b) => (b.innerText ?? "").toLowerCase().trim().includes(needle));
  if (byInner) return byInner;

  // Fuzzy fallback: match on first significant word
  const firstWord = needle.split(/\s+/)[0];
  if (firstWord && firstWord.length > 2) {
    return all.find((b) => cleanText(b).startsWith(firstWord)) ?? null;
  }
  return null;
}

/**
 * Retry finding a button — scrolls to reveal off-screen content on later attempts.
 */
async function findButtonRetry(
  text: string,
  maxAttempts = 7,
  delay = 500,
): Promise<HTMLButtonElement | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const btn = findButtonByText(text);
    if (btn) return btn;
    if (i < maxAttempts - 1) {
      if (i === 2) window.scrollTo({ top: 0, behavior: "smooth" });
      if (i === 3) window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      await sleep(delay);
    }
  }
  return null;
}

/**
 * Open an EntityPicker (combobox) by its label, type a search term,
 * and click the first matching item in the command list.
 */
async function openPickerByLabel(
  labelText: string,
  searchTerm: string,
): Promise<{ ok: boolean; message: string }> {
  const needle = labelText.toLowerCase().replace(/[₹*()]/g, "").trim();

  for (const label of Array.from(document.querySelectorAll<HTMLLabelElement>("label"))) {
    const ltext = (label.textContent ?? "").toLowerCase().replace(/[₹*()]/g, "").trim();
    if (!ltext.includes(needle) && !needle.includes(ltext)) continue;

    const container = label.closest("div");
    if (!container) continue;
    const btn = container.querySelector<HTMLButtonElement>('[role="combobox"]');
    if (!btn) continue;

    btn.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(120);
    btn.click();
    await sleep(500);

    const searchInput = document.querySelector<HTMLInputElement>('[cmdk-input]');
    if (searchInput) {
      fillReactInput(searchInput, searchTerm);
      await sleep(400);
      const items = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]'));
      const match = items.find(
        (i) => (i.textContent ?? "").toLowerCase().includes(searchTerm.toLowerCase()),
      );
      if (match) {
        match.click();
        return { ok: true, message: `Selected "${match.textContent?.trim()}"` };
      }
      return { ok: false, message: `No match for "${searchTerm}" in ${labelText} picker` };
    }
    return { ok: false, message: `Picker search box not found for "${labelText}"` };
  }
  return { ok: false, message: `Picker "${labelText}" not found on page` };
}

// ── Read visible page context from DOM ───────────────────────────────────────
function getPageContext(): string {
  const parts: string[] = [];

  // Active sidebar tab
  const desktopActive = document.querySelector<HTMLButtonElement>(
    "nav button.bg-primary-soft, nav li button.bg-primary-soft",
  );
  if (desktopActive) {
    const lines = (desktopActive.innerText ?? desktopActive.textContent ?? "").split("\n");
    const text = lines[0]?.trim();
    if (text && text.length < 30) parts.push(`ACTIVE TAB: ${text}`);
  }

  // Open dialog / sheet title
  const dialogTitle = document.querySelector(
    '[role="dialog"] [id*="title"], [role="dialog"] h2, [role="dialog"] h3',
  )?.textContent?.trim().replace(/\s+/g, " ");
  if (dialogTitle && dialogTitle.length < 80) parts.push(`OPEN FORM: "${dialogTitle}"`);

  // Page heading visible in main content
  const heading = document.querySelector("main h1, main h2, [data-main] h1")
    ?.textContent?.trim().replace(/\s+/g, " ");
  if (heading && heading.length < 80 && heading !== dialogTitle) {
    parts.push(`HEADING: "${heading}"`);
  }

  // Already-filled fields in open dialog (gives AI awareness of current form state)
  const filledFields: string[] = [];
  document.querySelectorAll<HTMLInputElement>('[role="dialog"] input').forEach((inp) => {
    if (!inp.value || inp.type === "hidden") return;
    const label = inp.closest("[class*='space-y']")?.querySelector("label")?.textContent
      ?.replace(/[₹*()]/g, "").trim();
    if (label && inp.value) filledFields.push(`${label}="${inp.value}"`);
  });
  if (filledFields.length > 0) parts.push(`FORM FIELDS: ${filledFields.slice(0, 4).join(", ")}`);

  parts.push(`PAGE INVENTORY JSON: ${getCompactPageInventory()}`);
  return parts.join(" | ");
}

// ── Action executor ───────────────────────────────────────────────────────────
async function executeActions(
  actions: SparrowAction[],
  navigateFn: (path: string) => void,
  allowedRoutes: readonly string[],
  onLog: (msg: string) => void,
  onStep: (step: string) => void,
  cancelRef: React.MutableRefObject<boolean>,
) {
  for (const act of actions) {
    if (cancelRef.current) break;

    switch (act.type) {
      case "navigate": {
        if (!allowedRoutes.includes(act.path)) {
          onLog(`Navigation to ${act.path} is not available for your role.`);
          break;
        }
        onStep(`Navigating to ${act.path}…`);
        navigateFn(act.path);
        break;
      }

      case "wait":
        await sleep(Math.min(act.ms, 5000));
        break;

      case "click_button": {
        if (isBlocked(act.text)) {
          onLog(`Blocked: will not click "${act.text}" (save/delete action).`);
          break;
        }
        onStep(`Clicking "${act.text}"…`);
        const btn = await findButtonRetry(act.text);
        if (btn && !btn.disabled) {
          btn.scrollIntoView({ behavior: "smooth", block: "nearest" });
          await sleep(80);
          btn.click();
        } else {
          onLog(`Button "${act.text}" was not found on the page.`);
        }
        break;
      }

      case "click_tab": {
        onStep(`Switching to "${act.text}" tab…`);
        const btn = await findButtonRetry(act.text, 7, 400);
        if (btn && !btn.disabled) {
          btn.click();
        } else {
          onLog(`Tab "${act.text}" was not found.`);
        }
        break;
      }

      case "fill_input": {
        onStep(`Filling "${act.label}"…`);
        const el = await findInputRetry(act.label);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          await sleep(100);
          fillReactInput(el, act.value);
        } else {
          onLog(`Field "${act.label}" was not found on the page.`);
        }
        break;
      }

      case "fill_placeholder": {
        onStep(`Filling field…`);
        const needle = act.placeholder.toLowerCase();
        const el = Array.from(
          document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"),
        ).find((i) => i.placeholder?.toLowerCase().includes(needle));
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          await sleep(100);
          fillReactInput(el, act.value);
        } else {
          onLog(`Field with placeholder "${act.placeholder}" not found.`);
        }
        break;
      }

      case "open_picker": {
        onStep(`Selecting "${act.search}" in ${act.label}…`);
        const result = await openPickerByLabel(act.label, act.search);
        if (!result.ok) onLog(result.message);
        break;
      }

      case "select_dropdown": {
        onStep(`Selecting "${act.option}" in ${act.label}…`);
        const result = await openPickerByLabel(act.label, act.option);
        if (!result.ok) onLog(result.message);
        break;
      }

      case "pick_date": {
        onStep(`Picking date for "${act.label}"…`);
        const el = await findInputRetry(act.label);
        if (el) fillReactInput(el, act.value);
        else onLog(`Date field "${act.label}" was not found.`);
        break;
      }

      case "set_checkbox":
      case "set_switch": {
        onStep(`Setting "${act.label}"…`);
        const el = findInputByLabel(act.label);
        if (el instanceof HTMLInputElement && el.checked !== act.checked) el.click();
        else onLog(`Toggle/checkbox "${act.label}" was not found.`);
        break;
      }

      case "set_radio": {
        onStep(`Selecting "${act.option}"…`);
        const option = Array.from(document.querySelectorAll<HTMLElement>('[role="radio"], input[type="radio"], button'))
          .find((el) => cleanText(el).includes(act.option.toLowerCase()));
        if (option) option.click();
        else onLog(`Radio option "${act.option}" was not found.`);
        break;
      }

      case "ask_user": {
        onLog(act.question);
        onStep("Waiting for you…");
        break;
      }

      case "wait_for_user_action": {
        const timeout = Math.min(act.timeoutMs ?? 120000, 180000);
        onStep(`Waiting for you to ${act.action}…`);
        const start = Date.now();
        const before = document.body.innerText;
        while (!cancelRef.current && Date.now() - start < timeout) {
          await sleep(1000);
          const now = document.body.innerText;
          if (now !== before && /(saved|created|updated|success|successfully)/i.test(now)) break;
        }
        break;
      }

      case "observe_screen": {
        onLog(`Screen observed: ${getCompactPageInventory()}`);
        break;
      }

      case "upload_file": {
        onLog("File upload is handled from the paperclip button in the message box.");
        break;
      }

      case "scroll_to": {
        const el = findInputByLabel(act.label);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        break;
      }
    }
    await sleep(160);
  }
  onStep("");
}

// ── Parse action block ────────────────────────────────────────────────────────
function parseActions(text: string): { actions: SparrowAction[]; displayText: string } {
  const S = "<<ORCA_ACTIONS>>";
  const E = "<<END_ACTIONS>>";
  const s = text.indexOf(S);
  const e = text.indexOf(E);
  if (s === -1 || e === -1 || e <= s) return { actions: [], displayText: text };
  const jsonStr = text.slice(s + S.length, e).trim();
  const displayText = (text.slice(0, s) + text.slice(e + E.length)).trim();
  try {
    return { actions: JSON.parse(jsonStr) as SparrowAction[], displayText };
  } catch {
    return { actions: [], displayText: text };
  }
}

/** Convert an action to a short human-readable step label. Returns null for waits (skip). */
function summarizeAction(act: SparrowAction): string | null {
  switch (act.type) {
    case "navigate": return `Go to ${act.path}`;
    case "click_button": return `Click "${act.text}"`;
    case "click_tab": return `Switch to "${act.text}" tab`;
    case "fill_input": return `Fill ${act.label} → "${act.value}"`;
    case "fill_placeholder": return `Fill (placeholder "${act.placeholder}") → "${act.value}"`;
    case "open_picker": return `Select "${act.search}" in ${act.label}`;
    case "select_dropdown": return `Select "${act.option}" in ${act.label}`;
    case "set_checkbox": return `Set ${act.label} ${act.checked ? "on" : "off"}`;
    case "set_switch": return `Set ${act.label} ${act.checked ? "on" : "off"}`;
    case "set_radio": return `Choose ${act.option} for ${act.label}`;
    case "pick_date": return `Pick ${act.label} → "${act.value}"`;
    case "upload_file": return `Read attached file`;
    case "ask_user": return `Ask user: ${act.question}`;
    case "wait_for_user_action": return `Wait for user to ${act.action}`;
    case "observe_screen": return `Observe current screen`;
    case "scroll_to": return `Scroll to ${act.label}`;
    case "wait": return null;
    default: return null;
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt(
  role: string,
  userName: string,
  currentPath: string,
  pageContext: string,
): string {
  const isAdmin = role === "admin";
  const isSemiAdmin = role === "semi_admin";
  const isViewer = role === "viewer";
  const routes = isAdmin ? ADMIN_ROUTES : isSemiAdmin ? SEMI_ADMIN_ROUTES : isViewer ? VIEWER_ROUTES : BASIC_ROUTES;

  return `You are ORCA AI — a smart assistant embedded in a Transport Management System (TMS) for Garuda Logistics Solutions.

USER: ${userName} | ROLE: ${isAdmin ? "Admin" : isSemiAdmin ? "Semi-Admin" : isViewer ? "Manager (read-only)" : "Basic User"} | CURRENT PAGE: ${currentPath}${pageContext ? ` | ${pageContext}` : ""}

━━━ CORE RULES ━━━
- Be concise (under 80 words). State what you're doing, then do it.
- ${isAdmin ? "Full admin access to all modules." : isSemiAdmin ? "Semi-Admin: full operational access except the TMS Dashboard, Users, and Settings. Never navigate to or expose those routes." : isViewer ? "Manager: read-only access to Operations, Masters, Dashboard, and Reports. Never create, edit, save, close, delete, or submit records. You CAN generate CSV/Excel report downloads from live data." : "Basic user: NEVER use admin routes (Dashboard, Reports, Users, Settings)."}
- You CAN navigate, click safe buttons, fill text/date/number fields, choose dropdowns/pickers, check boxes, and prepare records. You CANNOT press Save, Delete, Submit, Close Trip, or destructive confirmation buttons; pause and ask the user to do those.
- ALWAYS include <<ORCA_ACTIONS>> whenever you interact with the app.
- If information is missing or ambiguous, use an ask_user action and explain exactly what is needed.
- For bulk expenses from files: fill one expense, ask the user to review and press Save, wait_for_user_action save, then continue with the next row.
- Never say "you can do it yourself" if you can do it via actions.
- Use the CURRENT PAGE and OPEN FORM context above to understand what's already visible.

ALLOWED ROUTES: ${routes.join(", ")}

━━━ WEBSITE CAPABILITY MAP ━━━
${buildCapabilitySummary(role)}

━━━ WHERE THINGS LIVE ━━━
- Trips, Income, Expenditure, Driver Payroll, and (basic users only) Fastag Report → /operations (sidebar tabs)
- Drivers, Vehicles, Transporters, Locations, Sources → /masters (sidebar tabs)
- Dashboard, Reports → /dashboard, /reports (admin only)

━━━ EXACT MODULE → TAB → BUTTON FLOW ━━━
New driver:       navigate /masters → click_tab "Driver"       → click_button "New driver"
New vehicle:      navigate /masters → click_tab "Vehicle"      → click_button "New vehicle"  (admin)
New transporter:  navigate /masters → click_tab "Transporter"  → click_button "New transporter"
New location:     navigate /masters → click_tab "Locations"    → click_button "New location" (admin)
New trip:         navigate /operations → click_tab "Trip"         → click_button "New trip"
New expenditure:  navigate /operations → click_tab "Expenditure"  → click_button "New expenditure"
New income:       navigate /operations → click_tab "Income"       → click_button "New income"

━━━ EXACT FIELD LABELS — use these EXACTLY in fill_input ━━━
Expenditure / Income form:
  "Expenditure name"  — type of expense (e.g. "Tea Expenses")
  "Amount"            — number (label shows "Amount (₹)", use "Amount")
  "Date"              — date picker
  "Note"              — city/remarks (e.g. "Ludhiana")
  "Branch (required)" — PICKER, use open_picker NOT fill_input
  "Vehicle"           — PICKER
  "Driver"            — PICKER  
  "Transporter"       — PICKER

Manifest form (inside trip, click "Create manifest" to open):
  "Cnmt No."          — consignment number
  "Weight (kg)"       — weight in kilograms
  "Quantity (units)"  — number of units  ← NOT "Units", NOT "Quantity"

Trip form tabs (visible after opening a trip):
  Manifest | Other Income | Expenses | Vehicle | Driver | Transporter | Summary

Driver form (at /masters Driver tab):
  "Driver Code", "Full Name", "Date of Birth", "Mobile Number", "Driving Licence Number"

Vehicle form (at /masters Vehicle tab):
  "Vehicle Number (Registration Number)", "Manufacturer", "Model", "Engine No.", "Chassis No."

━━━ TERMINOLOGY ALIASES — map user words to real fields ━━━
- "location" / "city" / "place" / "where" → fill "Note" field
- "department" / "branch" / "office"      → "Branch (required)" (picker — user must select)
- "expense type" / "type" / "category"    → "Expenditure name"
- "units" / "qty"                         → "Quantity (units)"
- "weight"                                → "Weight (kg)"

━━━ BRANCH PICKER — important ━━━
Branch is a dropdown picker, not a text field. If the user provides a branch name such as "Ludhiana", use open_picker with that exact value: {"type":"open_picker","label":"Branch (required)","search":"Ludhiana"}.
Never output search "undefined" or an empty picker search. If the branch is not provided, fill all known fields and use ask_user to request the branch.

━━━ ACTION TIMING RULES ━━━
- After navigate: wait 1500ms before any click
- After click_tab: wait 900ms
- After click_button that opens a dialog/form: wait 1200ms before filling fields
- After open_picker: wait 500ms
- Use fill_input only on text/number/date inputs with a matching Label

━━━ ACTION FORMAT ━━━
<<ORCA_ACTIONS>>
[
  {"type":"navigate","path":"/masters"},
  {"type":"wait","ms":1500},
  {"type":"click_tab","text":"Driver"},
  {"type":"wait","ms":900},
  {"type":"click_button","text":"New driver"},
  {"type":"wait","ms":1200},
  {"type":"fill_input","label":"Driver Code","value":"DRV-001"},
  {"type":"fill_input","label":"Full Name","value":"Rajan Singh"}
]
<<END_ACTIONS>>

BLOCKED buttons (never click): save, delete, remove, submit trip, close trip`;
}

// ── Minimal markdown renderer ─────────────────────────────────────────────────
function parseInline(line: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) parts.push(<span key={i++}>{line.slice(last, m.index)}</span>);
    if (m[1] !== undefined) parts.push(<strong key={i++}>{m[1]}</strong>);
    else if (m[2] !== undefined) parts.push(<em key={i++}>{m[2]}</em>);
    last = re.lastIndex;
  }
  if (last < line.length) parts.push(<span key={i}>{line.slice(last)}</span>);
  return parts.length ? parts : line;
}

function renderMessage(text: string): React.ReactNode {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let list: string[] = [];
  const flushList = (k: string) => {
    if (!list.length) return;
    nodes.push(
      <ul key={k} className="my-1 ml-4 space-y-0.5 list-disc">
        {list.map((item, idx) => <li key={idx}>{parseInline(item)}</li>)}
      </ul>,
    );
    list = [];
  };
  lines.forEach((line, i) => {
    const bullet = line.match(/^[•\-]\s+(.+)/);
    if (bullet) { list.push(bullet[1]); }
    else {
      flushList(`l${i}`);
      if (line.trim() === "") nodes.push(<div key={`s${i}`} className="h-1.5" />);
      else nodes.push(<div key={`p${i}`}>{parseInline(line)}</div>);
    }
  });
  flushList("end");
  return <>{nodes}</>;
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Msg = { id: string; role: "user" | "assistant"; content: string; executing?: boolean; download?: { name: string; url: string } };
type PendingPlan = { aiMsgId: string; actions: SparrowAction[]; steps: string[] };
const uid = () => Math.random().toString(36).slice(2);

const ADMIN_CHIPS = ["New expenditure", "New driver", "Open trip form", "Add vehicle", "Open dashboard"];
const BASIC_CHIPS = ["New expenditure", "New driver", "Open trip form", "New transporter"];

async function callPuter(messages: { role: string; content: string }[]): Promise<string> {
  const p = window.puter;
  if (!p?.ai?.chat) throw new Error("AI engine not ready. Please reload and try again.");
  type R = { message: { content: string } };
  const result = await Promise.race<R>([
    p.ai.chat(messages, { model: "gpt-4o-mini" }) as Promise<R>,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("Request timed out. Please try again.")), 30000),
    ),
  ]);
  return result.message?.content ?? "No response received.";
}

// ── Panel ─────────────────────────────────────────────────────────────────────
export function OrcaAIPanel() {
  const { open, setOpen } = useOrcaAI();
  const { user } = useSession();
  const navigate = useNavigate();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState("");
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  const [isListening, setIsListening] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cancelRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const role = user?.role ?? "basic";
  const isAdmin = role === "admin" || role === "semi_admin";
  const displayName = (user?.fullName ?? user?.username ?? "there").split(" ")[0];
  const chips = isAdmin ? ADMIN_CHIPS : BASIC_CHIPS;
  const allowedRoutes = role === "admin" ? ADMIN_ROUTES : role === "semi_admin" ? SEMI_ADMIN_ROUTES : role === "viewer" ? VIEWER_ROUTES : BASIC_ROUTES;

  const STORAGE_KEY = `sparrow_history_${user?.id ?? "guest"}`;
  const MAX_STORED = 50;

  // ── Persistence ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || messages.length > 0) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: Msg[] = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed);
      }
    } catch { /* ignore corrupt storage */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (messages.length === 0) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_STORED)));
    } catch { /* ignore quota errors */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const clearHistory = useCallback(() => {
    setMessages([]);
    setPendingPlan(null);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [STORAGE_KEY]);

  // ── Scroll + focus ────────────────────────────────────────────────────────
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading, currentStep, pendingPlan]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 100); }, [open]);

  // ── Auto-resize textarea ──────────────────────────────────────────────────
  const resizeTextarea = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  // ── Voice input ───────────────────────────────────────────────────────────
  const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  const voiceSupported = !!SpeechRecognitionCtor;

  const toggleVoice = useCallback(() => {
    if (!SpeechRecognitionCtor) return;

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const rec = new SpeechRecognitionCtor();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-IN";
    rec.onresult = (e: SpeechRecognitionEvent) => {
      const transcript = e.results[0]?.[0]?.transcript ?? "";
      if (transcript) {
        setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
        setTimeout(resizeTextarea, 0);
      }
    };
    rec.onerror = () => setIsListening(false);
    rec.onend = () => setIsListening(false);
    rec.start();
    recognitionRef.current = rec;
    setIsListening(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening, SpeechRecognitionCtor]);

  // ── Execute a confirmed plan ──────────────────────────────────────────────
  const runPlan = useCallback(
    async (plan: PendingPlan) => {
      setPendingPlan(null);
      cancelRef.current = false;

      setMessages((prev) =>
        prev.map((m) => (m.id === plan.aiMsgId ? { ...m, executing: true } : m)),
      );

      await executeActions(
        plan.actions,
        (path) => navigate({ to: path as "/" }),
        allowedRoutes,
        (log) => setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: `⚠️ ${log}` }]),
        (step) => setCurrentStep(step),
        cancelRef,
      );

      setMessages((prev) =>
        prev.map((m) => (m.id === plan.aiMsgId ? { ...m, executing: false } : m)),
      );
      setCurrentStep("");
    },
    [navigate, allowedRoutes],
  );

  const stopExecution = useCallback(() => {
    cancelRef.current = true;
    setCurrentStep("");
    setMessages((prev) => prev.map((m) => m.executing ? { ...m, executing: false } : m));
  }, []);

  const handleExpenseFile = useCallback(async (file: File) => {
    setLoading(true);
    try {
      const drafts = await parseExpenseFile(file);
      const content = `${summarizeDrafts(drafts)}\n\nI can start adding these one by one. I will fill each expense, stop before Save, and wait for you to press Save before continuing.`;
      const aiMsgId = uid();
      const actions = buildExpenseImportActions(drafts);
      setMessages((prev) => [...prev, { id: aiMsgId, role: "assistant", content }]);
      if (actions.length) setPendingPlan({ aiMsgId, actions, steps: actions.map(summarizeAction).filter(Boolean) as string[] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not read that file.";
      setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: msg }]);
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, []);

  // ── Send message ──────────────────────────────────────────────────────────
  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      // Dismiss any pending plan before sending a new message
      setPendingPlan(null);

      const pageContext = getPageContext();
      const userMsg: Msg = { id: uid(), role: "user", content: trimmed };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "auto";
      setLoading(true);
      setCurrentStep("");

      try {
        if (wantsCsvReport(trimmed)) {
          try {
            const download = await generateDataCsv(trimmed, role, user?.branchIds);
            setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: `✅ ${download.summary}\n\nYour file **${download.name}** is ready to download.`, download }]);
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Could not generate report.";
            setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: `❌ ${msg}` }]);
          }
          setCurrentStep("");
          return;
        }

        if (asksCurrentMonthInsurancePremium(trimmed)) {
          const content = await answerCurrentMonthInsurancePremium(trimmed, role, user?.branchIds);
          setMessages((prev) => [...prev, { id: uid(), role: "assistant", content }]);
          setCurrentStep("");
          return;
        }

        const readOnlyDataContext = await buildReadOnlyDataContext(trimmed, role, user?.branchIds);
        const systemPrompt = `${buildSystemPrompt(role, displayName, currentPath, pageContext)}${readOnlyDataContext ? `\n\n━━━ READ-ONLY DATA CONTEXT ━━━\n${readOnlyDataContext}` : ""}`;
        const history = [...messages, userMsg].slice(-20).map((m) => ({
          role: m.role, content: m.content,
        }));

        const rawText = await callPuter([{ role: "system", content: systemPrompt }, ...history]);
        const parsed = parseActions(rawText);
        const validated = validateActions(parsed.actions, role);
        const actions = validated.actions;
        const displayText = [parsed.displayText, ...validated.warnings.map((w) => `⚠️ ${w}`)].filter(Boolean).join("\n");

        const aiMsgId = uid();
        setMessages((prev) => [...prev, {
          id: aiMsgId,
          role: "assistant",
          content: displayText,
          executing: false,
        }]);

        if (actions.length > 0) {
          const steps = actions.map(summarizeAction).filter(Boolean) as string[];
          setPendingPlan({ aiMsgId, actions, steps });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
        setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: msg }]);
        setCurrentStep("");
      } finally {
        setLoading(false);
      }
    },
    [loading, messages, role, displayName, currentPath, user?.branchIds],
  );

  if (!user) return null;

  const isExecuting = messages.some((m) => m.executing);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-l border-border bg-card" role="complementary" aria-label="ORCA AI">

      {/* ── Header ── */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10">
            <Bot className="size-4 text-primary" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-foreground">ORCA AI</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
            {isAdmin ? (role === "semi_admin" ? "Semi-Admin" : "Admin") : role === "viewer" ? "Manager" : "User"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearHistory}
              title="Clear chat history"
              className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="orca-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-3 text-sm">

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn("flex gap-2", msg.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                msg.role === "user"
                  ? "rounded-tr-sm bg-primary text-primary-foreground"
                  : "rounded-tl-sm bg-muted text-foreground",
              )}
            >
              {renderMessage(msg.content)}
              {msg.download && (
                <a
                  href={msg.download.url}
                  download={msg.download.name}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-background px-2.5 py-1.5 text-xs font-medium text-primary hover:underline"
                >
                  <Download className="size-3" />
                  Download {msg.download.name}
                </a>
              )}
              {msg.executing && (
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Loader2 className="size-3 animate-spin shrink-0" />
                  <span>{currentStep || "Working…"}</span>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Typing dots while waiting for AI response */}
        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-muted px-4 py-3">
              <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
              <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
              <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}

        {/* Execution progress banner */}
        {currentStep && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/6 px-3 py-2 text-xs text-primary">
              <Loader2 className="size-3 animate-spin shrink-0" />
              <span className="flex-1">{currentStep}</span>
              <button
                type="button"
                onClick={stopExecution}
                className="ml-1 text-[10px] font-medium text-primary/70 hover:text-primary underline underline-offset-2"
              >
                Stop
              </button>
            </div>
          </div>
        )}

        {/* ── Action plan confirmation card ── */}
        {pendingPlan && !loading && !isExecuting && (
          <div className="rounded-xl border border-primary/25 bg-primary/5 p-3">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                Action Plan
              </span>
              <button
                type="button"
                onClick={() => setPendingPlan(null)}
                className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
            <div className="mb-3 space-y-1.5">
              {pendingPlan.steps.map((step, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-foreground">
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[9px] font-bold text-primary">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => runPlan(pendingPlan)}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Play className="size-3" />
                Run
              </button>
              <button
                type="button"
                onClick={() => setPendingPlan(null)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* ── Quick chips (empty state only) ── */}
      {messages.length === 0 && (
        <div className="shrink-0 border-t border-border px-4 py-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Quick actions
          </p>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => send(chip)}
                disabled={loading}
                className="flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary disabled:opacity-40"
              >
                <ChevronRight className="size-3 shrink-0" />
                {chip}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Input box ── */}
      <div className="shrink-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className={cn(
          "rounded-2xl border border-border bg-muted/30 transition-colors",
          "focus-within:border-primary/50 focus-within:bg-background focus-within:shadow-sm",
          isListening && "border-primary/60 bg-primary/5",
        )}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); resizeTextarea(); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={isListening ? "Listening…" : "Message ORCA AI…"}
            rows={1}
            disabled={loading}
            className={cn(
              "block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm",
              "placeholder:text-muted-foreground focus:outline-none",
              "disabled:opacity-50 min-h-[40px] max-h-[140px]",
            )}
          />
          <div className="flex items-center justify-between px-3 pb-2.5">
            <span className="text-[10px] text-muted-foreground/40 select-none">
              ↵ send · shift+↵ newline
            </span>
            <div className="flex items-center gap-1.5">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv,image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleExpenseFile(file);
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                title="Attach expense Excel, CSV, or image"
                disabled={loading}
                className="flex size-8 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                <Paperclip className="size-3.5" />
              </button>
              {voiceSupported && (
                <button
                  type="button"
                  onClick={toggleVoice}
                  title={isListening ? "Stop listening" : "Voice input"}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-xl transition-all",
                    isListening
                      ? "bg-primary/20 text-primary animate-pulse"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {isListening ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
                </button>
              )}
              <button
                type="button"
                onClick={() => send(input)}
                disabled={loading || !input.trim()}
                className={cn(
                  "flex size-8 items-center justify-center rounded-xl transition-all",
                  input.trim() && !loading
                    ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                    : "bg-muted text-muted-foreground cursor-not-allowed opacity-40",
                )}
              >
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              </button>
            </div>
          </div>
        </div>
        <PoweredBy className="mt-1.5 text-[10px] text-muted-foreground/40" />
      </div>
    </div>
  );
}

// ── Trigger button ─────────────────────────────────────────────────────────────
export function OrcaAITrigger() {
  const { open, toggle } = useOrcaAI();
  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
        open
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Bot className="size-3.5" />
      ORCA AI
    </button>
  );
}
