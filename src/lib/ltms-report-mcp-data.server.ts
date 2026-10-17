/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase report tables are not fully represented in generated types. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { manifestCharges, num, type ContractLite, type EntryLite } from "@/lib/trip-calc";

const PAGE_SIZE = 1000;
const SOURCE_ROW_CAP = 500_000;
const BASE_INPUT = {
  from_date: z
    .string()
    .optional()
    .describe("Inclusive start date, YYYY-MM-DD. Defaults to the current month."),
  to_date: z
    .string()
    .optional()
    .describe("Inclusive end date, YYYY-MM-DD. Defaults to the current month."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Rows per page; default 100, maximum 500."),
  offset: z
    .number()
    .int()
    .min(0)
    .max(SOURCE_ROW_CAP)
    .optional()
    .describe("Zero-based result offset for pagination."),
};
const BASE_SCHEMA = z.object(BASE_INPUT);
const BRANCH_SCHEMA = z.object({
  ...BASE_INPUT,
  branch_id: z
    .string()
    .uuid()
    .optional()
    .describe("Optional branch UUID when the report supports branch filtering."),
});
const INCOME_SCHEMA = z.object({
  ...BASE_INPUT,
  source_id: z
    .string()
    .uuid()
    .optional()
    .describe("Optional source/contract UUID, matching the report's source selector."),
});
const TRANSPORTER_SCHEMA = z.object({
  ...BASE_INPUT,
  transporter_id: z.string().uuid().optional().describe("Optional transporter UUID."),
  source_id: z.string().uuid().optional().describe("Optional transporter source UUID."),
});

type DateRange = { from: string; to: string };
type Paging = { limit?: number; offset?: number };
type AnyDb = { from: (table: string) => any };
type QueryInput = {
  from_date?: string;
  to_date?: string;
  limit?: number;
  offset?: number;
  branch_id?: string;
};
type DataResult = {
  report: string;
  date_range: DateRange;
  total_count: number;
  limit: number;
  offset: number;
  next_offset: number | null;
  rows: Record<string, unknown>[];
};

function currentMonthRange(): DateRange {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

function validDate(value: string, field: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new Error(`${field} must be a real YYYY-MM-DD date.`);
  return value;
}

function resolveRange(input: QueryInput): DateRange {
  const defaults = currentMonthRange();
  const from = validDate(input.from_date ?? defaults.from, "from_date");
  const to = validDate(input.to_date ?? defaults.to, "to_date");
  if (from > to) throw new Error("from_date must be on or before to_date.");
  return { from, to };
}

async function fetchAll<T>(queryFactory: (from: number, to: number) => any): Promise<T[]> {
  const result: T[] = [];
  for (let from = 0; from < SOURCE_ROW_CAP; from += PAGE_SIZE) {
    const { data, error } = await queryFactory(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message ?? "Report query failed.");
    const batch = (data ?? []) as T[];
    result.push(...batch);
    if (batch.length < PAGE_SIZE) return result;
  }
  return result;
}

function page(
  report: string,
  range: DateRange,
  input: Paging,
  rows: Record<string, unknown>[],
): DataResult {
  const limit = input.limit ?? 100;
  const offset = input.offset ?? 0;
  const selected = rows.slice(offset, offset + limit);
  const next = offset + selected.length < rows.length ? offset + selected.length : null;
  return {
    report,
    date_range: range,
    total_count: rows.length,
    limit,
    offset,
    next_offset: next,
    rows: selected,
  };
}

function normalizeMode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function findIncomeEntry(entries: any[], row: any) {
  const mode = normalizeMode(row.transport_mode);
  const fromPin = String(row.from_pin_code ?? "").trim();
  const toPin = String(row.to_pin_code ?? "").trim();
  return entries.find(
    (entry) =>
      normalizeMode(entry.mode) === mode &&
      String(entry.from_pin_code ?? "").trim() === fromPin &&
      String(entry.to_pin_code ?? "").trim() === toPin,
  );
}

function transporterPins(row: any) {
  const savedToPin = String(row.to_pin_code ?? "").trim();
  const ewayToPin = String(row.to_details?.pincode ?? savedToPin).trim();
  return row.movement_mode === "drop"
    ? { fromPin: savedToPin, toPin: ewayToPin }
    : { fromPin: String(row.from_pin_code ?? "").trim(), toPin: savedToPin };
}

function findTransporterEntry(entries: any[], row: any, sourceId?: string | null) {
  const { fromPin, toPin } = transporterPins(row);
  const mode = normalizeMode(row.transport_mode);
  return entries.find(
    (entry) =>
      normalizeMode(entry.mode) === mode &&
      (sourceId ? String(entry.source_id ?? "") === sourceId : !entry.source_id) &&
      String(entry.from_pin_code ?? "").trim() === fromPin &&
      String(entry.to_pin_code ?? "").trim() === toPin,
  );
}

function findNetTransporterEntry(entries: any[], row: any) {
  const savedToPin = String(row.to_pin_code ?? "").trim();
  const firstEwayToPin = String(row.to_details?.pincode ?? savedToPin).trim();
  const fromPin =
    row.movement_mode === "drop" ? savedToPin : String(row.from_pin_code ?? "").trim();
  const toPin = row.movement_mode === "drop" ? firstEwayToPin : savedToPin;
  const mode = normalizeMode(row.transport_mode);
  return entries.find(
    (entry) =>
      normalizeMode(entry.mode) === mode &&
      String(entry.from_pin_code ?? "").trim() === fromPin &&
      String(entry.to_pin_code ?? "").trim() === toPin,
  );
}

function packageSlabCharge(item: any, type: any, entries: any[]) {
  if (!type) return 0;
  const measure = type.basis === "weight" ? num(item.weight_kg) : num(item.quantity);
  const slab = entries
    .filter((entry) => entry.package_rate_type_id === type.id)
    .sort((a, b) => num(b.from_value) - num(a.from_value))
    .find(
      (entry) =>
        num(entry.from_value) <= measure &&
        (entry.to_value == null || measure <= num(entry.to_value)),
    );
  if (!slab) return 0;
  return type.charge_mode === "rate" ? num(slab.amount) * measure : num(slab.amount);
}

function ids(rows: any[], key: string): string[] {
  return [...new Set(rows.map((row) => row?.[key]).filter(Boolean))] as string[];
}

async function consignmentIncome(
  db: AnyDb,
  input: QueryInput & { source_id?: string },
): Promise<DataResult> {
  const range = resolveRange(input);
  let query = db
    .from("consignments")
    .select(
      "id,consignment_number,source_id,consignment_date,consignment_type,transport_mode,from_pin_code,to_pin_code,source:contracts(contract_name)",
    )
    .gte("consignment_date", range.from)
    .lte("consignment_date", range.to)
    .order("consignment_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (input.source_id) query = query.eq("source_id", input.source_id);
  const consignments = await fetchAll<any>((from, to) => query.range(from, to));
  const consignmentIds = ids(consignments, "id");
  const sourceIds = ids(consignments, "source_id");
  const [packages, shipments, contracts, entries] = await Promise.all([
    consignmentIds.length
      ? fetchAll<any>((from, to) =>
          db
            .from("consignment_package_information")
            .select("consignment_id,quantity,weight_kg")
            .in("consignment_id", consignmentIds)
            .range(from, to),
        )
      : [],
    consignmentIds.length
      ? fetchAll<any>((from, to) =>
          db
            .from("shipments")
            .select("consignment_id,dispatch_from_pin_code,ship_to_pin_code")
            .in("consignment_id", consignmentIds)
            .order("created_at", { ascending: true })
            .range(from, to),
        )
      : [],
    sourceIds.length
      ? fetchAll<any>((from, to) =>
          db
            .from("contracts")
            .select("id,contract_name,company_name,gstin,fixed_monthly_charge,fixed_yearly_charge")
            .in("id", sourceIds)
            .range(from, to),
        )
      : [],
    sourceIds.length
      ? fetchAll<any>((from, to) =>
          db
            .from("contract_entries")
            .select(
              "id,contract_id,mode,from_location_id,to_location_id,from_pin_code,to_pin_code,freight_route_range_type,freight_route_ranges,loading_route_range_type,loading_route_ranges,per_manifest_amount",
            )
            .in("contract_id", sourceIds)
            .range(from, to),
        )
      : [],
  ]);
  const firstShipment = new Map<string, any>();
  for (const shipment of shipments)
    if (shipment.consignment_id && !firstShipment.has(shipment.consignment_id))
      firstShipment.set(shipment.consignment_id, shipment);
  const totals = new Map<string, { quantity: number; weight: number }>();
  for (const item of packages) {
    const value = totals.get(item.consignment_id) ?? { quantity: 0, weight: 0 };
    value.quantity += num(item.quantity);
    value.weight += num(item.weight_kg);
    totals.set(item.consignment_id, value);
  }
  const contractMap = new Map(contracts.map((row: any) => [row.id, row]));
  const entriesBySource = new Map<string, any[]>();
  for (const entry of entries)
    entriesBySource.set(entry.contract_id, [
      ...(entriesBySource.get(entry.contract_id) ?? []),
      entry,
    ]);
  const rows = consignments.map((row: any) => {
    const total = totals.get(row.id) ?? { quantity: 0, weight: 0 };
    const shipment = firstShipment.get(row.id);
    const fromPin = shipment?.dispatch_from_pin_code || row.from_pin_code;
    const toPin = shipment?.ship_to_pin_code || row.to_pin_code;
    const incomeRow = { ...row, from_pin_code: fromPin, to_pin_code: toPin };
    const entry = row.source_id
      ? findIncomeEntry(entriesBySource.get(row.source_id) ?? [], incomeRow)
      : undefined;
    const charges = manifestCharges(
      row.source_id ? (contractMap.get(row.source_id) as ContractLite | undefined) : undefined,
      entry as EntryLite | undefined,
      {
        from_location_id: null,
        to_location_id: null,
        from_pin_code: fromPin,
        to_pin_code: toPin,
        weight_kg: String(total.weight),
        quantity: String(total.quantity),
      },
    );
    return {
      "Consignment No.": row.consignment_number,
      Date: row.consignment_date ?? null,
      Source: row.source?.contract_name ?? null,
      Mode: row.transport_mode ?? null,
      "Consignment From PIN": fromPin ?? null,
      "Consignment To PIN": toPin ?? null,
      Quantity: total.quantity,
      "Weight (KG)": total.weight,
      Freight: charges.freight,
      Loading: charges.loading,
      "Total Income": charges.freight + charges.loading,
    };
  });
  return page("Consignment Income", range, input, rows);
}

async function transporterExpenditure(
  db: AnyDb,
  input: QueryInput & { transporter_id?: string; source_id?: string },
): Promise<DataResult> {
  const range = resolveRange(input);
  let query = db
    .from("consignments")
    .select(
      "id,consignment_number,transporter_id,transporter_source_id,movement_mode,consignment_date,consignment_type,transport_mode,from_pin_code,to_pin_code,to_details,freight_deduction,additional_freight,loading_deduction,additional_loading,transporter:ltms_transporters(transporter_name,pin_code),transporter_source:ltms_transporter_sources(source_name)",
    )
    .eq("consignment_type", "third_party")
    .gte("consignment_date", range.from)
    .lte("consignment_date", range.to)
    .order("consignment_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (input.transporter_id) query = query.eq("transporter_id", input.transporter_id);
  if (input.source_id) query = query.eq("transporter_source_id", input.source_id);
  const consignments = await fetchAll<any>((from, to) => query.range(from, to));
  const consignmentIds = ids(consignments, "id");
  const transporterIds = ids(consignments, "transporter_id");
  const [packages, entries] = await Promise.all([
    consignmentIds.length
      ? fetchAll<any>((from, to) =>
          db
            .from("consignment_package_information")
            .select("consignment_id,quantity,weight_kg")
            .in("consignment_id", consignmentIds)
            .range(from, to),
        )
      : [],
    transporterIds.length
      ? fetchAll<any>((from, to) =>
          db
            .from("ltms_transporter_entries")
            .select(
              "id,transporter_id,source_id,mode,from_location_id,to_location_id,from_pin_code,to_pin_code,freight_route_range_type,freight_route_ranges,loading_route_range_type,loading_route_ranges",
            )
            .in("transporter_id", transporterIds)
            .range(from, to),
        )
      : [],
  ]);
  const totals = new Map<string, { quantity: number; weight: number }>();
  for (const item of packages) {
    const value = totals.get(item.consignment_id) ?? { quantity: 0, weight: 0 };
    value.quantity += num(item.quantity);
    value.weight += num(item.weight_kg);
    totals.set(item.consignment_id, value);
  }
  const entriesByScope = new Map<string, any[]>();
  for (const entry of entries) {
    const id = String(entry.transporter_id ?? "");
    const sourceKey = String(entry.source_id ?? id);
    entriesByScope.set(sourceKey, [...(entriesByScope.get(sourceKey) ?? []), entry]);
  }
  const rows = consignments.map((row: any) => {
    const total = totals.get(row.id) ?? { quantity: 0, weight: 0 };
    const route = transporterPins(row);
    const scope = row.transporter_source_id ?? row.transporter_id;
    const entry = scope
      ? findTransporterEntry(entriesByScope.get(scope) ?? [], row, row.transporter_source_id)
      : undefined;
    const charges = manifestCharges(
      {
        id: row.transporter_id ?? "",
        contract_name: row.transporter?.transporter_name ?? "Transporter",
      },
      entry as EntryLite | undefined,
      {
        from_location_id: null,
        to_location_id: null,
        from_pin_code: route.fromPin,
        to_pin_code: route.toPin,
        weight_kg: String(total.weight),
        quantity: String(total.quantity),
      },
    );
    const freight = Math.max(
      0,
      charges.freight - num(row.freight_deduction) + num(row.additional_freight),
    );
    const loading = Math.max(
      0,
      charges.loading - num(row.loading_deduction) + num(row.additional_loading),
    );
    return {
      "Consignment No.": row.consignment_number,
      Date: row.consignment_date ?? null,
      Transporter: row.transporter?.transporter_name ?? null,
      Source: row.transporter_source?.source_name ?? null,
      Movement: row.movement_mode ?? null,
      Mode: row.transport_mode ?? null,
      "Transporter From PIN": route.fromPin || null,
      "Transporter To PIN": route.toPin || null,
      Quantity: total.quantity,
      "Weight (KG)": total.weight,
      Freight: freight,
      Loading: loading,
      "Total Expenditure": freight + loading,
    };
  });
  return page("Transporter Expenditure", range, input, rows);
}

async function stockInwardUnloadingIncome(db: AnyDb, input: QueryInput): Promise<DataResult> {
  const range = resolveRange(input);
  const receipts = await fetchAll<any>((from, to) =>
    db
      .from("stock_inward_receipts")
      .select(
        "id,receipt_number,receipt_date,unloading_date,unloading_amount_received,additional_income_mode,approval_amount,stock_inward_sources(source_id,source:contracts(contract_name)),stock_inward_packages(id,package_rate_type_id,package_type,source_id,quantity,weight_kg,source:contracts(contract_name))",
      )
      .gte("receipt_date", range.from)
      .lte("receipt_date", range.to)
      .order("receipt_date", { ascending: false })
      .range(from, to),
  );
  const typeIds = [
    ...new Set(
      receipts.flatMap((row: any) =>
        (row.stock_inward_packages ?? []).map((item: any) => item.package_rate_type_id),
      ),
    ),
  ];
  const [types, entries] = await Promise.all([
    typeIds.length
      ? fetchAll<any>((from, to) =>
          db
            .from("package_rate_types")
            .select("id,basis,charge_mode")
            .in("id", typeIds)
            .range(from, to),
        )
      : [],
    typeIds.length
      ? fetchAll<any>((from, to) =>
          db
            .from("package_rate_entries")
            .select("package_rate_type_id,from_value,to_value,amount")
            .eq("rate_kind", "unloading")
            .in("package_rate_type_id", typeIds)
            .order("from_value")
            .range(from, to),
        )
      : [],
  ]);
  const typeMap = new Map(types.map((row: any) => [row.id, row]));
  const rows = receipts.map((receipt: any) => {
    const sourceIncome = (receipt.stock_inward_packages ?? []).reduce((sum: number, item: any) => {
      const type: any = typeMap.get(item.package_rate_type_id);
      const measure = type?.basis === "weight" ? num(item.weight_kg) : num(item.quantity);
      const slab = entries
        .filter((entry: any) => entry.package_rate_type_id === item.package_rate_type_id)
        .sort((a: any, b: any) => num(b.from_value) - num(a.from_value))
        .find(
          (entry: any) =>
            num(entry.from_value) <= measure &&
            (entry.to_value == null || measure <= num(entry.to_value)),
        );
      const rate = num(slab?.amount);
      return sum + (slab && type ? (type.charge_mode === "rate" ? rate * measure : rate) : 0);
    }, 0);
    const mode = receipt.additional_income_mode;
    const showApproval = mode === "approval" || mode === "both";
    const showSource = mode === "source" || mode === "both";
    const packageTypes = [
      ...new Set((receipt.stock_inward_packages ?? []).map((item: any) => item.package_type)),
    ].join(", ");
    const sources = (receipt.stock_inward_sources ?? [])
      .map((item: any) => item.source?.contract_name)
      .filter(Boolean)
      .join(", ");
    return {
      "Stock Inward No.": receipt.receipt_number ?? receipt.id.slice(0, 8),
      "Package Types": packageTypes || null,
      Sources: sources || null,
      "Unloading Amount Received": num(receipt.unloading_amount_received),
      "Additional Income Type": mode,
      "Approval Charges": showApproval ? num(receipt.approval_amount) : null,
      "Source Income": showSource ? sourceIncome : null,
    };
  });
  return page("Unloading Income (Stock Inward)", range, input, rows);
}

async function workmenLoading(db: AnyDb, input: QueryInput): Promise<DataResult> {
  const range = resolveRange(input);
  let query = db
    .from("consignments")
    .select(
      "id,consignment_number,branch_id,consignment_date,loading_deduction,additional_loading,branch:branches(branch_name)",
    )
    .gte("consignment_date", range.from)
    .lte("consignment_date", range.to)
    .order("consignment_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (input.branch_id) query = query.eq("branch_id", input.branch_id);
  const consignments = await fetchAll<any>((from, to) => query.range(from, to));
  const idsList = ids(consignments, "id");
  const branchIds = ids(consignments, "branch_id");
  const [packages, types, entries] = await Promise.all([
    idsList.length
      ? fetchAll<any>((from, to) =>
          db
            .from("consignment_package_information")
            .select("consignment_id,package_rate_type_id,package_type,basis,quantity,weight_kg")
            .in("consignment_id", idsList)
            .range(from, to),
        )
      : [],
    branchIds.length
      ? fetchAll<any>((from, to) =>
          db
            .from("package_rate_types")
            .select("id,branch_id,package_type,basis,charge_mode")
            .in("branch_id", branchIds)
            .range(from, to),
        )
      : [],
    branchIds.length
      ? fetchAll<any>((from, to) =>
          db
            .from("package_rate_entries")
            .select("package_rate_type_id,from_value,to_value,amount")
            .eq("rate_kind", "loading")
            .in("branch_id", branchIds)
            .order("from_value")
            .range(from, to),
        )
      : [],
  ]);
  const typeMap = new Map(types.map((row: any) => [row.id, row]));
  const packageMap = new Map<string, any[]>();
  for (const item of packages)
    packageMap.set(item.consignment_id, [...(packageMap.get(item.consignment_id) ?? []), item]);
  const rows = consignments.map((row: any) => {
    const packageRows = packageMap.get(row.id) ?? [];
    const quantity = packageRows.reduce((sum, item) => sum + num(item.quantity), 0);
    const weight = packageRows.reduce((sum, item) => sum + num(item.weight_kg), 0);
    const calculated = packageRows.reduce(
      (sum, item) => sum + packageSlabCharge(item, typeMap.get(item.package_rate_type_id), entries),
      0,
    );
    return {
      "Consignment No.": row.consignment_number,
      Date: row.consignment_date ?? null,
      Branch: row.branch?.branch_name ?? null,
      "Package Information":
        [...new Set(packageRows.map((item) => item.package_type).filter(Boolean))].join(", ") ||
        null,
      Quantity: quantity,
      "Weight (KG)": weight,
      "Final Loading": Math.max(
        0,
        calculated - num(row.loading_deduction) + num(row.additional_loading),
      ),
    };
  });
  return page("Workmen Charges - Loading", range, input, rows);
}

async function workmenUnloading(db: AnyDb, input: QueryInput): Promise<DataResult> {
  const range = resolveRange(input);
  let query = db
    .from("stock_inward_receipts")
    .select(
      "id,branch_id,receipt_number,receipt_date,unloading_deduction,additional_unloading,branch:branches(branch_name),stock_inward_packages(package_rate_type_id,package_type,quantity,weight_kg)",
    )
    .gte("receipt_date", range.from)
    .lte("receipt_date", range.to)
    .order("receipt_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (input.branch_id) query = query.eq("branch_id", input.branch_id);
  const receipts = await fetchAll<any>((from, to) => query.range(from, to));
  const branchIds = ids(receipts, "branch_id");
  const [types, entries] = await Promise.all([
    branchIds.length
      ? fetchAll<any>((from, to) =>
          db
            .from("package_rate_types")
            .select("id,branch_id,package_type,basis,charge_mode")
            .in("branch_id", branchIds)
            .range(from, to),
        )
      : [],
    branchIds.length
      ? fetchAll<any>((from, to) =>
          db
            .from("package_rate_entries")
            .select("package_rate_type_id,from_value,to_value,amount")
            .eq("rate_kind", "unloading")
            .in("branch_id", branchIds)
            .order("from_value")
            .range(from, to),
        )
      : [],
  ]);
  const typeMap = new Map(types.map((row: any) => [row.id, row]));
  const rows = receipts.map((row: any) => {
    const packageRows = row.stock_inward_packages ?? [];
    const quantity = packageRows.reduce((sum: number, item: any) => sum + num(item.quantity), 0);
    const weight = packageRows.reduce((sum: number, item: any) => sum + num(item.weight_kg), 0);
    const calculated = packageRows.reduce(
      (sum: number, item: any) =>
        sum + packageSlabCharge(item, typeMap.get(item.package_rate_type_id), entries),
      0,
    );
    return {
      "Stock Inward No.": row.receipt_number,
      Date: row.receipt_date,
      Branch: row.branch?.branch_name ?? null,
      "Package Information":
        packageRows
          .map((item: any) => item.package_type ?? "")
          .filter(Boolean)
          .join(", ") || null,
      Quantity: quantity,
      "Weight (KG)": weight,
      "Final Unloading": Math.max(
        0,
        calculated - num(row.unloading_deduction) + num(row.additional_unloading),
      ),
    };
  });
  return page("Workmen Charges - Unloading (Stock Inward)", range, input, rows);
}

async function tripExpenditure(db: AnyDb, input: QueryInput): Promise<DataResult> {
  const range = resolveRange(input);
  let consignmentQuery = db
    .from("consignments")
    .select(
      "id,trip_id,branch_id,consignment_number,consignment_type,movement_mode,consignment_date,branch:branches(branch_name)",
    )
    .gte("consignment_date", range.from)
    .lte("consignment_date", range.to)
    .order("consignment_date", { ascending: false });
  if (input.branch_id) consignmentQuery = consignmentQuery.eq("branch_id", input.branch_id);
  const [consignments, branches] = await Promise.all([
    fetchAll<any>((from, to) => consignmentQuery.range(from, to)),
    fetchAll<any>((from, to) =>
      db.from("branches").select("id,branch_name").order("branch_name").range(from, to),
    ),
  ]);
  const tripIds = ids(consignments, "trip_id");
  const trips = tripIds.length
    ? await fetchAll<any>((from, to) =>
        db
          .from("trips")
          .select(
            "id,trip_code,ownership,branch_id,vehicle_id,driver_id,third_party_vehicle_number,start_date,branch:branches(branch_name),expense_hire_charges,expense_toll_charges,expense_toll_cash,expense_fuel,expense_driver_bata,expense_morning,expense_night,expense_sunday,expense_parking,expense_dala,expense_unloading",
          )
          .in("id", tripIds)
          .in("ownership", ["own", "third_party"])
          .order("start_date", { ascending: false })
          .range(from, to),
      )
    : [];
  const vehicleIds = ids(trips, "vehicle_id");
  const driverIds = ids(trips, "driver_id");
  const [expenses, otherIncome, vehicles, drivers, packages] = await Promise.all([
    tripIds.length
      ? fetchAll<any>((from, to) =>
          db.from("trip_expenses").select("trip_id,amount").in("trip_id", tripIds).range(from, to),
        )
      : [],
    tripIds.length
      ? fetchAll<any>((from, to) =>
          db
            .from("trip_other_income")
            .select("trip_id,amount")
            .in("trip_id", tripIds)
            .range(from, to),
        )
      : [],
    vehicleIds.length
      ? fetchAll<any>((from, to) =>
          db.from("vehicles").select("id,registration_number").in("id", vehicleIds).range(from, to),
        )
      : [],
    driverIds.length
      ? fetchAll<any>((from, to) =>
          db.from("drivers").select("id,full_name,driver_code").in("id", driverIds).range(from, to),
        )
      : [],
    consignments.length
      ? fetchAll<any>((from, to) =>
          db
            .from("consignment_package_information")
            .select("consignment_id,weight_kg")
            .in("consignment_id", ids(consignments, "id"))
            .range(from, to),
        )
      : [],
  ]);
  const weights = new Map<string, number>();
  for (const item of packages)
    weights.set(item.consignment_id, (weights.get(item.consignment_id) ?? 0) + num(item.weight_kg));
  const expenseByTrip = new Map<string, number>();
  for (const item of expenses)
    expenseByTrip.set(item.trip_id, (expenseByTrip.get(item.trip_id) ?? 0) + num(item.amount));
  const incomeByTrip = new Map<string, number>();
  for (const item of otherIncome)
    incomeByTrip.set(item.trip_id, (incomeByTrip.get(item.trip_id) ?? 0) + num(item.amount));
  const vehicleMap = new Map(
    vehicles.map((item: any) => [item.id, item.registration_number ?? "—"]),
  );
  const driverMap = new Map(
    drivers.map((item: any) => [item.id, item.full_name || item.driver_code || "—"]),
  );
  const branchMap = new Map(branches.map((item: any) => [item.id, item.branch_name]));
  const eligibleAssigned = (trip: any, consignment: any) => {
    const ownership = String(trip.ownership ?? "").toLowerCase();
    const type = String(consignment.consignment_type ?? "").toLowerCase();
    const mode = String(consignment.movement_mode ?? "").toLowerCase();
    return (
      ownership === "own" ||
      (ownership === "third_party" && type === "third_party" && mode === "drop")
    );
  };
  const eligibleUnassigned = (row: any) => {
    const type = String(row.consignment_type ?? "").toLowerCase();
    const mode = String(row.movement_mode ?? "").toLowerCase();
    return type === "own" || (type === "third_party" && mode === "drop");
  };
  const rows: Record<string, unknown>[] = [];
  for (const trip of trips) {
    const assigned = consignments.filter(
      (row: any) => row.trip_id === trip.id && eligibleAssigned(trip, row),
    );
    if (!assigned.length) continue;
    const tripWeight = assigned.reduce(
      (sum: number, row: any) => sum + (weights.get(row.id) ?? 0),
      0,
    );
    const tripCost = (expenseByTrip.get(trip.id) ?? 0) - (incomeByTrip.get(trip.id) ?? 0);
    for (const consignment of assigned) {
      const consignmentWeight = weights.get(consignment.id) ?? 0;
      rows.push({
        "Trip Number": trip.trip_code,
        Type: trip.ownership === "third_party" ? "Third Party Drop" : "Own",
        "Vehicle Number":
          trip.ownership === "third_party"
            ? trip.third_party_vehicle_number || vehicleMap.get(trip.vehicle_id ?? "") || "—"
            : vehicleMap.get(trip.vehicle_id ?? "") || "—",
        Driver: driverMap.get(trip.driver_id ?? "") || "—",
        Branch: trip.branch?.branch_name ?? "—",
        "Consignment Number": consignment.consignment_number,
        "Trip Date": trip.start_date ?? "—",
        "Consignment Weight": consignmentWeight,
        "Total Trip Weight": tripWeight,
        "Trip Expenditure": tripCost,
        "Consignment Expenditure":
          tripWeight > 0 ? (tripCost / tripWeight) * consignmentWeight : tripCost / assigned.length,
      });
    }
  }
  const tripMap = new Map(trips.map((trip: any) => [trip.id, trip]));
  const assignedIds = new Set(
    consignments
      .filter((row: any) => {
        const trip = row.trip_id ? tripMap.get(row.trip_id) : undefined;
        return Boolean(trip && eligibleAssigned(trip, row));
      })
      .map((row: any) => row.id),
  );
  for (const consignment of consignments) {
    if (consignment.trip_id || assignedIds.has(consignment.id) || !eligibleUnassigned(consignment))
      continue;
    const thirdPartyDrop =
      String(consignment.consignment_type ?? "").toLowerCase() === "third_party";
    rows.push({
      "Trip Number": "Not assigned",
      Type: thirdPartyDrop ? "Third Party Drop" : "Own",
      "Vehicle Number": "—",
      Driver: "—",
      Branch: consignment.branch?.branch_name ?? branchMap.get(consignment.branch_id ?? "") ?? "—",
      "Consignment Number": consignment.consignment_number,
      "Trip Date": "—",
      "Consignment Weight": weights.get(consignment.id) ?? 0,
      "Total Trip Weight": 0,
      "Trip Expenditure": 0,
      "Consignment Expenditure": 0,
    });
  }
  return page("Trip Expenditure", range, input, rows);
}

async function consignmentNet(db: AnyDb, input: QueryInput): Promise<DataResult> {
  const range = resolveRange(input);
  let query = db
    .from("consignments")
    .select(
      "id,consignment_number,branch_id,consignment_date,consignment_type,movement_mode,transport_mode,trip_id,source_id,source_bill_id,transporter_id,transporter_source_id,transporter_bill_id,freight_deduction,additional_freight,loading_deduction,additional_loading,from_pin_code,to_pin_code,to_details",
    )
    .gte("consignment_date", range.from)
    .lte("consignment_date", range.to)
    .order("consignment_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (input.branch_id) query = query.eq("branch_id", input.branch_id);
  const consignments = await fetchAll<any>((from, to) => query.range(from, to));
  const consignmentIds = ids(consignments, "id");
  const branchIds = ids(consignments, "branch_id");
  const sourceIds = ids(consignments, "source_id");
  const transporterIds = ids(consignments, "transporter_id");
  const tripIds = ids(consignments, "trip_id");
  const [
    packages,
    shipments,
    contracts,
    incomeEntries,
    transporterEntries,
    loadingTypes,
    loadingEntries,
    trips,
    tripExpenses,
    tripOtherIncome,
  ] = await Promise.all([
    consignmentIds.length
      ? fetchAll<any>((from, to) =>
          db
            .from("consignment_package_information")
            .select("consignment_id,package_rate_type_id,package_type,basis,quantity,weight_kg")
            .in("consignment_id", consignmentIds)
            .range(from, to),
        )
      : [],
    consignmentIds.length
      ? fetchAll<any>((from, to) =>
          db
            .from("shipments")
            .select("consignment_id,dispatch_from_pin_code,ship_to_pin_code")
            .in("consignment_id", consignmentIds)
            .order("created_at", { ascending: true })
            .range(from, to),
        )
      : [],
    sourceIds.length
      ? fetchAll<any>((from, to) =>
          db.from("contracts").select("id,contract_name").in("id", sourceIds).range(from, to),
        )
      : [],
    sourceIds.length
      ? fetchAll<any>((from, to) =>
          db
            .from("contract_entries")
            .select(
              "id,contract_id,mode,from_location_id,to_location_id,from_pin_code,to_pin_code,freight_route_range_type,freight_route_ranges,loading_route_range_type,loading_route_ranges,per_manifest_amount",
            )
            .in("contract_id", sourceIds)
            .range(from, to),
        )
      : [],
    transporterIds.length
      ? fetchAll<any>((from, to) =>
          db
            .from("ltms_transporter_entries")
            .select(
              "id,transporter_id,source_id,mode,from_location_id,to_location_id,from_pin_code,to_pin_code,freight_route_range_type,freight_route_ranges,loading_route_range_type,loading_route_ranges",
            )
            .in("transporter_id", transporterIds)
            .range(from, to),
        )
      : [],
    branchIds.length
      ? fetchAll<any>((from, to) =>
          db
            .from("package_rate_types")
            .select("id,branch_id,package_type,basis,charge_mode")
            .in("branch_id", branchIds)
            .range(from, to),
        )
      : [],
    branchIds.length
      ? fetchAll<any>((from, to) =>
          db
            .from("package_rate_entries")
            .select("package_rate_type_id,from_value,to_value,amount")
            .eq("rate_kind", "loading")
            .in("branch_id", branchIds)
            .range(from, to),
        )
      : [],
    tripIds.length
      ? fetchAll<any>((from, to) =>
          db
            .from("trips")
            .select(
              "id,ownership,vehicle_id,driver_id,third_party_vehicle_number,expense_hire_charges,expense_toll_charges,expense_toll_cash,expense_fuel,expense_driver_bata,expense_morning,expense_night,expense_sunday,expense_parking,expense_dala,expense_unloading",
            )
            .in("id", tripIds)
            .range(from, to),
        )
      : [],
    tripIds.length
      ? fetchAll<any>((from, to) =>
          db.from("trip_expenses").select("trip_id,amount").in("trip_id", tripIds).range(from, to),
        )
      : [],
    tripIds.length
      ? fetchAll<any>((from, to) =>
          db
            .from("trip_other_income")
            .select("trip_id,amount")
            .in("trip_id", tripIds)
            .range(from, to),
        )
      : [],
  ]);
  const packageMap = new Map<string, any[]>();
  for (const item of packages)
    packageMap.set(item.consignment_id, [...(packageMap.get(item.consignment_id) ?? []), item]);
  const firstShipment = new Map<string, any>();
  for (const row of shipments)
    if (row.consignment_id && !firstShipment.has(row.consignment_id))
      firstShipment.set(row.consignment_id, row);
  const contractMap = new Map(contracts.map((row: any) => [row.id, row]));
  const incomeBySource = new Map<string, any[]>();
  for (const row of incomeEntries)
    incomeBySource.set(row.contract_id, [...(incomeBySource.get(row.contract_id) ?? []), row]);
  const transporterByScope = new Map<string, any[]>();
  for (const row of transporterEntries) {
    const key = String(row.source_id ?? row.transporter_id ?? "");
    transporterByScope.set(key, [...(transporterByScope.get(key) ?? []), row]);
  }
  const loadingTypeMap = new Map(loadingTypes.map((row: any) => [row.id, row]));
  const expenseMap = new Map<string, number>();
  for (const row of tripExpenses)
    expenseMap.set(row.trip_id, (expenseMap.get(row.trip_id) ?? 0) + num(row.amount));
  const otherIncomeMap = new Map<string, number>();
  for (const row of tripOtherIncome)
    otherIncomeMap.set(row.trip_id, (otherIncomeMap.get(row.trip_id) ?? 0) + num(row.amount));
  const tripMap = new Map(trips.map((row: any) => [row.id, row]));
  const tripWeights = new Map<string, number>();
  const tripCounts = new Map<string, number>();
  for (const row of consignments) {
    const trip = row.trip_id ? tripMap.get(row.trip_id) : undefined;
    const eligible = Boolean(
      trip &&
      (String(trip.ownership).toLowerCase() === "own" ||
        (String(row.consignment_type).toLowerCase() === "third_party" &&
          String(row.movement_mode).toLowerCase() === "drop")),
    );
    if (row.trip_id && eligible) {
      tripCounts.set(row.trip_id, (tripCounts.get(row.trip_id) ?? 0) + 1);
      tripWeights.set(
        row.trip_id,
        (tripWeights.get(row.trip_id) ?? 0) +
          (packageMap.get(row.id) ?? []).reduce(
            (sum: number, item: any) => sum + num(item.weight_kg),
            0,
          ),
      );
    }
  }
  const rows = consignments.map((row: any) => {
    const items = packageMap.get(row.id) ?? [];
    const shipment = firstShipment.get(row.id);
    const incomeFrom = shipment?.dispatch_from_pin_code || row.from_pin_code;
    const incomeTo = shipment?.ship_to_pin_code || row.to_pin_code;
    const manifestWeight = items.reduce((sum: number, item: any) => sum + num(item.weight_kg), 0);
    const manifestQuantity = items.reduce((sum: number, item: any) => sum + num(item.quantity), 0);
    const manifest = {
      from_location_id: null,
      to_location_id: null,
      from_pin_code: incomeFrom,
      to_pin_code: incomeTo,
      weight_kg: String(manifestWeight),
      quantity: String(manifestQuantity),
    };
    const incomeEntry = row.source_id
      ? findIncomeEntry(incomeBySource.get(row.source_id) ?? [], {
          ...row,
          from_pin_code: incomeFrom,
          to_pin_code: incomeTo,
        })
      : undefined;
    const income = manifestCharges(
      row.source_id ? (contractMap.get(row.source_id) as ContractLite | undefined) : undefined,
      incomeEntry as EntryLite | undefined,
      manifest,
    );
    const transporterEntry = row.transporter_id
      ? findNetTransporterEntry(
          transporterByScope.get(row.transporter_source_id ?? row.transporter_id) ?? [],
          row,
        )
      : undefined;
    const transporter =
      String(row.consignment_type ?? "").toLowerCase() === "third_party" && transporterEntry
        ? manifestCharges(
            { id: row.transporter_id ?? "", contract_name: "Transporter" },
            transporterEntry as EntryLite,
            {
              ...manifest,
              from_pin_code: row.movement_mode === "drop" ? row.to_pin_code : row.from_pin_code,
              to_pin_code:
                row.movement_mode === "drop"
                  ? (row.to_details?.pincode ?? row.to_pin_code)
                  : row.to_pin_code,
            },
          )
        : null;
    const calculatedLoading = items.reduce(
      (sum: number, item: any) =>
        sum +
        packageSlabCharge(item, loadingTypeMap.get(item.package_rate_type_id), loadingEntries),
      0,
    );
    const loading = Math.max(
      0,
      calculatedLoading - num(row.loading_deduction) + num(row.additional_loading),
    );
    const trip = row.trip_id ? tripMap.get(row.trip_id) : undefined;
    const eligibleTrip = Boolean(
      trip &&
      (String(trip.ownership).toLowerCase() === "own" ||
        (String(row.consignment_type).toLowerCase() === "third_party" &&
          String(row.movement_mode).toLowerCase() === "drop")),
    );
    const tripCost = trip ? (expenseMap.get(trip.id) ?? 0) - (otherIncomeMap.get(trip.id) ?? 0) : 0;
    const tripTotalWeight = tripWeights.get(trip?.id ?? "") ?? 0;
    const tripCount = tripCounts.get(trip?.id ?? "") ?? 0;
    const tripExpenditure =
      eligibleTrip && tripCost > 0 && tripTotalWeight > 0
        ? (tripCost / tripTotalWeight) * manifestWeight
        : eligibleTrip && tripCost > 0 && tripCount > 0
          ? tripCost / tripCount
          : null;
    const transporterExpenditure = transporter
      ? Math.max(
          0,
          transporter.freight - num(row.freight_deduction) + num(row.additional_freight),
        ) +
        Math.max(0, transporter.loading - num(row.loading_deduction) + num(row.additional_loading))
      : null;
    const totalExpenditure = (transporterExpenditure ?? 0) + loading + (tripExpenditure ?? 0);
    const incomeTotal = income.freight + income.loading;
    return {
      "Consignment Number": row.consignment_number,
      Date: row.consignment_date ?? "",
      "Total Income": incomeTotal,
      "Transporter Expenditure": transporterExpenditure,
      "Loading Charges": loading,
      "Trip Expenditure": tripExpenditure,
      "Total Expenditure": totalExpenditure,
      "Net Income/Expenditure": incomeTotal - totalExpenditure,
    };
  });
  return page("Consignment Net", range, input, rows);
}


async function ltmsFinanceEntries(
  db: AnyDb,
  kind: "income" | "expenditure",
  input: QueryInput,
): Promise<DataResult> {
  const range = resolveRange(input);
  const isIncome = kind === "income";
  const table = isIncome ? "incomes" : "expenditures";
  const nameColumn = isIncome ? "income_name" : "expenditure_name";
  const statusColumn = isIncome ? "is_received" : "is_paid";
  const statusDateColumn = isIncome ? "received_date" : "paid_date";
  let query = db
    .from(table)
    .select(
      `${nameColumn},amount,note,entry_date,branch_id,vehicle_id,driver_id,transporter_id,${statusColumn},${statusDateColumn},branch:branches(branch_name),vehicle:vehicles(registration_number),driver:drivers(full_name),transporter:transporters(transporter_name)`,
    )
    .gte("entry_date", range.from)
    .lte("entry_date", range.to)
    .order("entry_date", { ascending: false });
  if (input.branch_id) query = query.eq("branch_id", input.branch_id);
  const entries = await fetchAll<any>((from, to) => query.range(from, to));
  const rows = entries.map((entry: any) => {
    const linkedTo =
      entry.vehicle?.registration_number ??
      entry.driver?.full_name ??
      entry.transporter?.transporter_name ??
      null;
    return {
      [isIncome ? "Income" : "Expenditure"]: entry[nameColumn] ?? "",
      Date: entry.entry_date ?? null,
      Amount: num(entry.amount),
      Branch: entry.branch?.branch_name ?? null,
      "Linked To": linkedTo,
      Status: entry[statusColumn] ? (isIncome ? "Received" : "Paid") : isIncome ? "Not received" : "Unpaid",
      "Status Date": entry[statusDateColumn] || null,
      Note: entry.note || null,
    };
  });
  return page(isIncome ? "LTMS Finance Income" : "LTMS Finance Expenditure", range, input, rows);
}

function registerReadTool(
  server: McpServer,
  db: AnyDb,
  config: {
    name: string;
    title: string;
    description: string;
    schema: z.ZodTypeAny;
    load: (input: any) => Promise<DataResult>;
  },
) {
  server.registerTool(
    config.name,
    {
      title: config.title,
      description: config.description,
      inputSchema: config.schema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input: any) => {
      try {
        const result = await config.load(input);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error) {
        console.error(
          `[ltms-report-mcp] ${config.name} report failed:`,
          error instanceof Error ? error.message : "Unknown error",
        );
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                error instanceof Error && /date|offset|limit/i.test(error.message)
                  ? error.message
                  : "Could not load this report. Try a narrower date range or a later page.",
            },
          ],
        };
      }
    },
  );
}

export function registerLtmsReportTools(server: McpServer, db: AnyDb) {
  registerReadTool(server, db, {
    name: "ltms_finance_income",
    title: "LTMS Finance — Income",
    description:
      "Read-only rows from LTMS Finance → Income. Returns the income name, date, amount, branch name, linked vehicle/driver/transporter display name, receipt status/date, and note; never returns record or system IDs. Optional filters: from_date, to_date, branch_id, limit, offset. Defaults to the current month.",
    schema: BRANCH_SCHEMA,
    load: (input) => ltmsFinanceEntries(db, "income", input),
  });
  registerReadTool(server, db, {
    name: "ltms_finance_expenditure",
    title: "LTMS Finance — Expenditure",
    description:
      "Read-only rows from LTMS Finance → Expenditure. Returns the expenditure name, date, amount, branch name, linked vehicle/driver/transporter display name, payment status/date, and note; never returns record or system IDs. Optional filters: from_date, to_date, branch_id, limit, offset. Defaults to the current month.",
    schema: BRANCH_SCHEMA,
    load: (input) => ltmsFinanceEntries(db, "expenditure", input),
  });
  registerReadTool(server, db, {
    name: "consignment_income",
    title: "Consignment Income report",
    description:
      "Read-only rows from the app's Consignment Income report. Returns only the report columns, with numeric values and inclusive dates. This report has no branch filter in the existing UI. Optional filters: from_date, to_date, source_id, limit, offset. Defaults to the current month.",
    schema: INCOME_SCHEMA,
    load: (input) => consignmentIncome(db, input),
  });
  registerReadTool(server, db, {
    name: "transporter_expenditure",
    title: "Transporter Expenditure report",
    description:
      "Read-only rows from the app's Transporter Expenditure report. Returns only the report columns and applies stored deductions/additions, but does not expose the report's save-adjustment action. This report has no branch filter in the existing UI. Optional filters: from_date, to_date, transporter_id, source_id, limit, offset. Defaults to the current month.",
    schema: TRANSPORTER_SCHEMA,
    load: (input) => transporterExpenditure(db, input),
  });
  registerReadTool(server, db, {
    name: "unloading_income_stock_inward",
    title: "Unloading Income (Stock Inward) report",
    description:
      "Read-only Stock Inward Unloading Income rows. Approval Charges and Source Income are null when the existing report hides those values for the row's additional-income mode. The current Unloading Income report has no branch filter. Optional filters: from_date, to_date, limit, offset. Defaults to the current month.",
    schema: BASE_SCHEMA,
    load: (input) => stockInwardUnloadingIncome(db, input),
  });
  registerReadTool(server, db, {
    name: "workmen_loading",
    title: "Workmen Charges — Loading report",
    description:
      "Read-only workmen loading rows from the existing report. Optional filters: from_date, to_date, branch_id, limit, offset. Defaults to the current month. Final Loading includes the persisted loading deduction/addition and is clamped at zero.",
    schema: BRANCH_SCHEMA,
    load: (input) => workmenLoading(db, input),
  });
  registerReadTool(server, db, {
    name: "workmen_unloading_stock_inward",
    title: "Workmen Charges — Unloading (Stock Inward) report",
    description:
      "Read-only workmen unloading rows from the existing Stock Inward report, as requested. The identifier is Stock Inward No. (not Consignment No.) because the current unloading workmen data source is stock_inward_receipts. Optional filters: from_date, to_date, branch_id, limit, offset. Defaults to the current month.",
    schema: BRANCH_SCHEMA,
    load: (input) => workmenUnloading(db, input),
  });
  registerReadTool(server, db, {
    name: "trip_expenditure",
    title: "Trip Expenditure report",
    description:
      "Read-only rows from the app's Trip Expenditure report. Trip costs are allocated by package weight, with the report's equal-split fallback for zero trip weight. Optional filters: from_date, to_date, branch_id, limit, offset. Defaults to the current month.",
    schema: BRANCH_SCHEMA,
    load: (input) => tripExpenditure(db, input),
  });
  registerReadTool(server, db, {
    name: "consignment_net",
    title: "Consignment Net report",
    description:
      "Read-only rows from the app's Consignment Net report using its source, transporter, loading and trip-allocation calculations. Optional filters: from_date, to_date, branch_id, limit, offset. Defaults to the current month. Null expenditure values are blank/not applicable in the report.",
    schema: BRANCH_SCHEMA,
    load: (input) => consignmentNet(db, input),
  });
}
