/* eslint-disable @typescript-eslint/no-explicit-any -- Schema includes newer LTMS tables. */
import { createServerFn } from "@tanstack/react-start";
import {
  formatConsignmentReportDate,
  numberValue,
  restrictConsignmentReportRecord,
  type ConsignmentReportRecord,
} from "@/lib/consignment-report-model";
import { manifestChargeDetails, manifestCharges, type EntryLite } from "@/lib/trip-calc";

type Params = {
  sessionToken: string;
  fromDate: string;
  toDate: string;
  branchId?: string;
  sourceId?: string;
  search?: string;
  page?: number;
  exportAll?: boolean;
};

export type CompactConsignmentResponse = {
  role: string;
  columns: string[];
  rows: ConsignmentReportRecord[];
  total: number;
  page: number;
  pageSize: number;
  capped: boolean;
  branches: Array<{ id: string; name: string }>;
  sources: Array<{ id: string; name: string }>;
};

const BASE_SELECTION =
  "id,consignment_number,branch_id,consignment_date,source_id,transporter_id," +
  "vehicle_id,part_b_vehicle_no,from_pin_code,to_pin_code,from_details,to_details," +
  "transporter_lr_number,transporter_lr_date," +
  "branch:branches(branch_name),source:contracts(contract_name)," +
  "vehicle:vehicles(registration_number),transporter:ltms_transporters(transporter_name)";
const FINANCE_COLUMNS =
  ",transport_mode,freight_deduction,additional_freight,loading_deduction,additional_loading";

type Consignment = Record<string, any>;
type Shipment = Record<string, any>;
const str = (value: unknown) => String(value ?? "").trim();
const normal = (value: unknown) => str(value).toLowerCase();
const unique = (values: unknown[]) => [...new Set(values.map(str).filter(Boolean))];
const rel = (value: any) => Array.isArray(value) ? (value[0] ?? {}) : (value ?? {});
const n = numberValue;

function dateField(value: unknown) {
  return formatConsignmentReportDate(value);
}
function sumItems(items: Record<string, any>[], field: string) {
  return items.reduce((total, item) => total + n(item[field]), 0);
}
function findMatchingEntry(entries: Array<EntryLite & { mode?: string }>, cn: Consignment,
  fromPin: string, toPin: string) {
  return entries.find((entry) =>
    normal(entry.mode) === normal(cn.transport_mode) &&
    str(entry.from_pin_code) === fromPin && str(entry.to_pin_code) === toPin,
  );
}
function fromDateOrThrow(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error("Select a valid report date.");
  }
  return value;
}

async function readBatches(db: any, table: string, select: string,
  column: string, ids: string[], order?: string) {
  const result: any[] = [];
  for (let from = 0; from < ids.length; from += 150) {
    let query = db.from(table).select(select).in(column, ids.slice(from, from + 150));
    if (order) query = query.order(order, { ascending: true });
    // Multiple rows can belong to the same consignment; paginate each batch.
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await query.range(offset, offset + 999);
      if (error) throw new Error("Unable to load " + table + ": " + error.message);
      const chunk = (data ?? []) as any[];
      result.push(...chunk);
      if (chunk.length < 1000) break;
    }
  }
  return result;
}

/**
 * A server-only, session-verified report. Basic users are filtered BEFORE any
 * shipment/package query and financial columns are not even selected for them.
 * Access is based on persisted user_branch_access, not client-sent branchIds.
 */
export const fetchCompactConsignmentReport = createServerFn({ method: "POST" })
  .validator((data: Params) => data)
  .handler(async ({ data }): Promise<CompactConsignmentResponse> => {
    const [{ verifyAppToken }, { supabaseAdmin }, model] = await Promise.all([
      import("@/lib/user-auth"),
      import("@/integrations/supabase/client.server"),
      import("@/lib/consignment-report-model"),
    ]);
    const session = await verifyAppToken(data.sessionToken);
    if (!session) throw new Error("Session expired. Please sign in again.");
    const db = supabaseAdmin as any;
    const { data: account, error: userError } = await db.from("app_users")
      .select("id,role,is_active,is_paused")
      .eq("id", session.uid).maybeSingle();
    if (userError || !account || !account.is_active || account.is_paused)
      throw new Error("Your account is not authorised to access this report.");

    const { data: activeSession, error: sessionError } = await db.from("user_sessions")
      .select("session_token").eq("user_id", account.id).maybeSingle();
    if (sessionError || !activeSession || activeSession.session_token !== data.sessionToken)
      throw new Error("This session is no longer active. Sign in again.");

    const role = str(account.role);
    if (!["admin", "semi_admin", "basic", "viewer"].includes(role))
      throw new Error("Your role has no permission to access this report.");
    const fullAccess = model.canSeeConsignmentReportFinancials(role);
    let allowedBranchIds: string[] | null = null;
    if (!fullAccess) {
      const { data: access, error: accessError } = await db.from("user_branch_access")
        .select("branch_id").eq("user_id", account.id);
      if (accessError) throw new Error("Could not verify branch permissions.");
      allowedBranchIds = unique((access ?? []).map((item: any) => item.branch_id));
    }

    const fromDate = fromDateOrThrow(data.fromDate);
    const toDate = fromDateOrThrow(data.toDate);
    if (fromDate > toDate) throw new Error("From date cannot be after To date.");
    const branchId = str(data.branchId) || "all";
    if (!fullAccess && branchId !== "all" && !allowedBranchIds!.includes(branchId))
      throw new Error("This branch is not assigned to your account.");

    const { data: branchData, error: branchError } = await db.from("branches")
      .select("id,branch_name")
      .order("branch_name", { ascending: true });
    if (branchError) throw new Error("Could not load report branches.");
    const branches = (branchData ?? [])
      .filter((branch: any) => fullAccess || allowedBranchIds!.includes(branch.id))
      .map((branch: any) => ({ id: str(branch.id), name: str(branch.branch_name) }));

    const columns = model.columnsForConsignmentRole(role);
    const pageSize = data.exportAll ? 5000 : 50;
    const page = data.exportAll ? 0 : Math.max(0, Math.floor(n(data.page)));
    const empty: CompactConsignmentResponse = {
      role, columns, rows: [], total: 0, page, pageSize,
      capped: false, branches, sources: [],
    };
    if (allowedBranchIds && allowedBranchIds.length === 0) return empty;

    const baseQuery = () => {
      let query = db.from("consignments")
        .select(BASE_SELECTION + (fullAccess ? FINANCE_COLUMNS : ""), { count: "exact" })
        .gte("consignment_date", fromDate).lte("consignment_date", toDate)
        .order("consignment_date", { ascending: false })
        .order("consignment_number", { ascending: false });
      if (allowedBranchIds) query = query.in("branch_id", allowedBranchIds);
      if (branchId !== "all") query = query.eq("branch_id", branchId);
      if (data.sourceId && data.sourceId !== "all") query = query.eq("source_id", data.sourceId);
      const search = str(data.search).slice(0, 100).replace(/[%_]/g, "");
      if (search) query = query.ilike("consignment_number", "%" + search + "%");
      return query;
    };
    const { data: consignmentData, error: consignmentError, count } =
      await baseQuery().range(page * pageSize, page * pageSize + pageSize - 1);
    if (consignmentError) throw new Error("Could not load consignment report: " + consignmentError.message);
    const consignments: Consignment[] = consignmentData ?? [];
    const ids = consignments.map((row) => str(row.id));
    const sourceOptions = unique(consignments.map((row) => row.source_id))
      .map((id) => ({
        id,
        name: str(rel(consignments.find((row) => str(row.source_id) === id)?.source).contract_name),
      }));
    if (!ids.length) return { ...empty, total: count ?? 0, sources: sourceOptions };

    // Shipment fields are nonfinancial. Only count/weight fields are selected
    // from nested items, even for admins.
    const shipments: Shipment[] = await readBatches(db, "shipments",
      "id,consignment_id,document_number,document_date,recipient_trade_name," +
      "recipient_legal_name,recipient_place,recipient_pin_code,recipient_state," +
      "ship_to_place,ship_to_pin_code,ship_to_state,dispatch_from_pin_code," +
      "eway_bill_number,shipment_items(quantity,weight_kg)",
      "consignment_id", ids, "created_at");
    const packages: any[] = await readBatches(db, "consignment_package_information",
      "consignment_id,quantity,weight_kg", "consignment_id", ids);

    const byConsignment = new Map<string, Shipment[]>();
    for (const shipment of shipments) {
      const id = str(shipment.consignment_id);
      const group = byConsignment.get(id) ?? [];
      group.push(shipment);
      byConsignment.set(id, group);
    }
    const packageMap = new Map<string, { count: number; weight: number }>();
    for (const pkg of packages) {
      const id = str(pkg.consignment_id);
      const current = packageMap.get(id) ?? { count: 0, weight: 0 };
      current.count += n(pkg.quantity);
      current.weight += n(pkg.weight_kg);
      packageMap.set(id, current);
    }

    const financialSources = fullAccess
      ? unique(consignments.map((row) => row.source_id)) : [];
    const entries: any[] = financialSources.length
      ? await readBatches(db, "contract_entries",
          "id,contract_id,mode,from_location_id,to_location_id,from_pin_code,to_pin_code," +
          "freight_route_range_type,freight_route_ranges,loading_route_range_type," +
          "loading_route_ranges,per_manifest_amount", "contract_id", financialSources)
      : [];
    const entriesBySource = new Map<string, any[]>();
    for (const entry of entries) {
      const group = entriesBySource.get(str(entry.contract_id)) ?? [];
      group.push(entry);
      entriesBySource.set(str(entry.contract_id), group);
    }

    const result: ConsignmentReportRecord[] = consignments.map((cn, index) => {
      const linked = byConsignment.get(str(cn.id)) ?? [];
      const first = linked[0] ?? {};
      const shipmentItems = linked.flatMap((shipment) =>
        Array.isArray(shipment.shipment_items) ? shipment.shipment_items : []);
      const actualWeight = sumItems(shipmentItems, "weight_kg");
      const actualPackages = sumItems(shipmentItems, "quantity");
      const packageTotals = packageMap.get(str(cn.id)) ?? { count: 0, weight: 0 };
      const pkgs = packageTotals.count || actualPackages;
      const chargedWeight = packageTotals.weight || actualWeight;
      const destination = str(first.ship_to_place) || str(first.recipient_place);
      const destinationPin = str(first.ship_to_pin_code) || str(cn.to_pin_code);
      const destinationState = str(first.ship_to_state) || str(first.recipient_state);
      const consigneePin = str(first.recipient_pin_code);
      const consigneeState = str(first.recipient_state);
      const invoiceNumbers = unique(linked.map((row) => row.document_number)).join(", ");
      const invoiceDates = unique(linked.map((row) => dateField(row.document_date))).join(", ");
      const toDetails = (cn.to_details && typeof cn.to_details === "object") ? cn.to_details : {};
      const fromDetails = (cn.from_details && typeof cn.from_details === "object") ? cn.from_details : {};
      const loadType = str(toDetails.load_type) || str(fromDetails.load_type);
      const resultRow: ConsignmentReportRecord = {
        "SNO": page * pageSize + index + 1,
        "Branch": str(rel(cn.branch).branch_name),
        "Source": str(rel(cn.source).contract_name),
        "Cnmt No.": str(cn.consignment_number),
        "Cnmt Date": dateField(cn.consignment_date),
        "Consignee": str(first.recipient_trade_name || first.recipient_legal_name),
        "Destination": destination,
        "Destination Pincode": destinationPin,
        "Destination State": destinationState,
        "Consignee Pincode": consigneePin,
        "Consignee State": consigneeState,
        "Load Type": loadType,
        "Vehicle No.": str(cn.part_b_vehicle_no || rel(cn.vehicle).registration_number),
        "Pkgs": pkgs,
        "A. Weight": Number(actualWeight.toFixed(3)),
        "C. Weight": Number(chargedWeight.toFixed(3)),
        "Transporter Name": str(rel(cn.transporter).transporter_name),
        "Invoice No.": invoiceNumbers,
        "Invoice Date": invoiceDates,
        "Ref. No.": str(cn.transporter_lr_number),
        "Ref. Date": dateField(cn.transporter_lr_date),
        "Mark No.": str(toDetails.mark_no || fromDetails.mark_no),
      };
      if (fullAccess) {
        const fromPin = str(first.dispatch_from_pin_code || cn.from_pin_code);
        const toPin = str(first.ship_to_pin_code || cn.to_pin_code);
        const entry = findMatchingEntry(entriesBySource.get(str(cn.source_id)) ?? [],
          cn, fromPin, toPin);
        const manifest = {
          from_location_id: null, to_location_id: null, from_pin_code: fromPin,
          to_pin_code: toPin, weight_kg: String(chargedWeight), quantity: String(pkgs),
        };
        const contract = cn.source_id
          ? { id: str(cn.source_id), contract_name: str(rel(cn.source).contract_name) } : undefined;
        const details = manifestChargeDetails(contract, entry, manifest);
        const charge = manifestCharges(contract, entry, manifest);
        const rateAvailable = details.freight.type !== "—";
        const hasCharges = Boolean(entry);
        resultRow["Rate"] = rateAvailable ? details.freight.value : "";
        resultRow["Rate Calculate On"] = rateAvailable
          ? details.freight.type === "fixed" ? "FIXED" :
            str(entry?.freight_route_range_type).toUpperCase() : "";
        resultRow["Freight"] = hasCharges
          ? Number(Math.max(0, charge.freight - n(cn.freight_deduction) +
              n(cn.additional_freight)).toFixed(2)) : "";
        resultRow["Others Charges"] = hasCharges
          ? Number(Math.max(0, charge.loading - n(cn.loading_deduction) +
              n(cn.additional_loading)).toFixed(2)) : "";
      }
      return restrictConsignmentReportRecord(resultRow, role);
    });
    return {
      ...empty,
      columns,
      rows: result,
      total: count ?? result.length,
      capped: Boolean(data.exportAll && (count ?? 0) > pageSize),
      sources: sourceOptions,
    };
  });
