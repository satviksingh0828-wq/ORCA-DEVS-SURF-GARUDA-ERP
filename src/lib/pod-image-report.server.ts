/* eslint-disable @typescript-eslint/no-explicit-any -- New LTMS records are not in generated DB types. */
import { createServerFn } from "@tanstack/react-start";
import { formatConsignmentReportDate, numberValue } from "@/lib/consignment-report-model";

type Request = {
  sessionToken: string;
  fromDate: string;
  toDate: string;
  branchId?: string;
  sourceId?: string;
  search?: string;
  page?: number;
  exportAll?: boolean;
};
export type PodReportRow = {
  podId: string;
  consignmentNumber: string;
  receivingDate: string;
  source: string;
  destination: string;
  consignor: string;
  consignee: string;
  weight: number;
  packages: number;
  front: boolean;
  back: boolean;
  signature: boolean;
  uploadDocument: boolean | null;
};
export type PodReportResponse = {
  rows: PodReportRow[];
  page: number;
  pageSize: number;
  total: number;
  capped: boolean;
  branches: Array<{ id: string; name: string }>;
  sources: Array<{ id: string; name: string }>;
};

const str = (value: unknown) => String(value ?? "").trim();
const info = (value: any) => Array.isArray(value) ? (value[0] ?? {}) : (value ?? {});
const unique = (values: unknown[]) => [...new Set(values.map(str).filter(Boolean))];
const num = numberValue;
const validDate = (value: unknown) => {
  const v = str(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))
    throw new Error("Select a valid date.");
  return v;
};
async function actor(token: string) {
  const [{ verifyAppToken }, { supabaseAdmin }] = await Promise.all([
    import("@/lib/user-auth"),
    import("@/integrations/supabase/client.server"),
  ]);
  const parsed = await verifyAppToken(token);
  if (!parsed) throw new Error("Your session has expired. Sign in again.");
  const db = supabaseAdmin as any;
  const { data: user, error } = await db.from("app_users")
    .select("id,role,is_active,is_paused").eq("id", parsed.uid).maybeSingle();
  if (error || !user || !user.is_active || user.is_paused || parsed.role !== user.role)
    throw new Error("This user is not authorised.");
  if (!["admin", "semi_admin", "basic", "viewer"].includes(user.role))
    throw new Error("No permission to read POD reports.");
  const { data: session, error: sessionError } = await db.from("user_sessions")
    .select("session_token").eq("user_id", user.id).maybeSingle();
  if (sessionError || !session || session.session_token !== token)
    throw new Error("Your session is no longer active.");
  let branches: string[] | null = null;
  if (user.role === "basic" || user.role === "viewer") {
    const { data: permissions, error: permissionError } = await db
      .from("user_branch_access").select("branch_id").eq("user_id", user.id);
    if (permissionError) throw new Error("Could not confirm branch permissions.");
    branches = unique((permissions ?? []).map((p: any) => p.branch_id));
  }
  return { db, branches };
}

async function listRelated(db: any, table: string, select: string, ids: string[]) {
  const output: any[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    const query = db.from(table).select(select).in("consignment_id", ids.slice(start, start + 100));
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await query.range(offset, offset + 999);
      if (error) throw new Error("Unable to load POD details: " + error.message);
      output.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
  }
  return output;
}

/** Fetch only the POD rows and branches authorised for the signed-in user. */
export const fetchPodImageReport = createServerFn({ method: "POST" })
  .validator((data: Request) => data)
  .handler(async ({ data }): Promise<PodReportResponse> => {
    const { db, branches: allowedBranches } = await actor(data.sessionToken);
    const from = validDate(data.fromDate);
    const to = validDate(data.toDate);
    if (from > to) throw new Error("From Date cannot be later than To Date.");
    const branchId = str(data.branchId) || "all";
    if (allowedBranches && branchId !== "all" && !allowedBranches.includes(branchId))
      throw new Error("This branch is not assigned to your account.");
    const { data: branchRows, error: branchError } = await db
      .from("branches").select("id,branch_name").order("branch_name");
    if (branchError) throw new Error("Could not load branches.");
    const branches = (branchRows ?? [])
      .filter((branch: any) => allowedBranches === null || allowedBranches.includes(branch.id))
      .map((branch: any) => ({ id: str(branch.id), name: str(branch.branch_name) }));
    const page = data.exportAll ? 0 : Math.max(0, Math.floor(num(data.page)));
    const pageSize = data.exportAll ? 5000 : 50;
    const empty: PodReportResponse = {
      rows: [], page, pageSize, total: 0, capped: false, branches, sources: [],
    };
    if (allowedBranches?.length === 0) return empty;

    let query = db.from("outward_pods")
      .select(
        "id,delivery_date,front_copy_path,back_copy_path,signature_copy_path,created_at," +
        "consignment:consignments!inner(id,branch_id,consignment_number,source_id,from_details,to_details," +
        "source:contracts(contract_name))",
        { count: "exact" },
      )
      .gte("delivery_date", from).lte("delivery_date", to)
      .order("delivery_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (allowedBranches) query = query.in("consignment.branch_id", allowedBranches);
    if (branchId !== "all") query = query.eq("consignment.branch_id", branchId);
    if (data.sourceId && data.sourceId !== "all")
      query = query.eq("consignment.source_id", data.sourceId);
    const search = str(data.search).replace(/[%_]/g, "").slice(0, 100);
    if (search) query = query.ilike("consignment.consignment_number", "%" + search + "%");
    const { data: pods, error, count } =
      await query.range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw new Error("Could not load POD image report: " + error.message);
    const selected = (pods ?? []) as any[];
    const consignmentIds = unique(selected.map((pod) => info(pod.consignment).id));
    const [shipments, packages] = await Promise.all([
      listRelated(db, "shipments",
        "consignment_id,document_number,supplier_trade_name,supplier_legal_name,recipient_trade_name," +
        "recipient_legal_name,recipient_place,ship_to_place,shipment_items(quantity,weight_kg)",
        consignmentIds),
      listRelated(db, "consignment_package_information",
        "consignment_id,quantity,weight_kg",
        consignmentIds),
    ]);
    const shipmentMap = new Map<string, any[]>();
    const packageMap = new Map<string, { count: number; weight: number }>();
    for (const shipment of shipments) {
      const key = str(shipment.consignment_id);
      const group = shipmentMap.get(key) ?? [];
      group.push(shipment);
      shipmentMap.set(key, group);
    }
    for (const pkg of packages) {
      const key = str(pkg.consignment_id);
      const total = packageMap.get(key) ?? { count: 0, weight: 0 };
      total.count += num(pkg.quantity);
      total.weight += num(pkg.weight_kg);
      packageMap.set(key, total);
    }
    const rows: PodReportRow[] = selected.map((pod) => {
      const cn = info(pod.consignment);
      const linked = shipmentMap.get(str(cn.id)) ?? [];
      const first = linked[0] ?? {};
      const goods = linked.flatMap((s: any) =>
        Array.isArray(s.shipment_items) ? s.shipment_items : []);
      const totals = packageMap.get(str(cn.id));
      const fromDetails = info(cn.from_details);
      const toDetails = info(cn.to_details);
      return {
        podId: str(pod.id),
        consignmentNumber: str(cn.consignment_number),
        receivingDate: formatConsignmentReportDate(pod.delivery_date),
        source: str(info(cn.source).contract_name),
        destination: str(first.ship_to_place || first.recipient_place ||
          toDetails.place || toDetails.recipient_place),
        consignor: str(first.supplier_trade_name || first.supplier_legal_name ||
          fromDetails.supplier_trade_name || fromDetails.trade_name),
        consignee: str(first.recipient_trade_name || first.recipient_legal_name ||
          toDetails.recipient_trade_name || toDetails.trade_name),
        weight: Number((totals?.weight || goods.reduce((sum: number, item: any) =>
          sum + num(item.weight_kg), 0)).toFixed(3)),
        packages: totals?.count || goods.reduce((sum: number, item: any) =>
          sum + num(item.quantity), 0),
        front: Boolean(pod.front_copy_path),
        back: Boolean(pod.back_copy_path),
        signature: Boolean(pod.signature_copy_path),
        // The source spreadsheet's "Upload Document" is a separate field; the
        // existing Outward POD schema has no equivalent, so do not fabricate it.
        uploadDocument: null,
      };
    });
    const sources = unique(selected.map((pod) => info(pod.consignment).source_id))
      .map((id) => {
        const cn = info(selected.find((pod) => info(pod.consignment).source_id === id)?.consignment);
        return { id, name: str(info(cn.source).contract_name) };
      });
    return {
      ...empty, rows, total: count ?? rows.length, sources,
      capped: Boolean(data.exportAll && (count ?? 0) > pageSize),
    };
  });

/** Create short-lived links only after checking user session and POD branch. */
export const getPodImageReportLinks = createServerFn({ method: "POST" })
  .validator((data: { sessionToken: string; podId: string }) => data)
  .handler(async ({ data }): Promise<{
    front: string | null; back: string | null; signature: string | null;
  }> => {
    const { db, branches } = await actor(data.sessionToken);
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(data.podId))
      throw new Error("Invalid POD reference.");
    const { data: pod, error } = await db.from("outward_pods")
      .select("id,front_copy_path,back_copy_path,signature_copy_path," +
        "consignment:consignments!inner(id,branch_id)")
      .eq("id", data.podId).maybeSingle();
    if (error || !pod) throw new Error("POD not found.");
    const cn = info(pod.consignment);
    if (branches && !branches.includes(str(cn.branch_id)))
      throw new Error("You are not authorised to view this consignment.");
    const bucket = db.storage.from("outward-pod-documents");
    const result: { front: string | null; back: string | null; signature: string | null } = {
      front: null, back: null, signature: null,
    };
    for (const [key, path] of [
      ["front", pod.front_copy_path], ["back", pod.back_copy_path],
      ["signature", pod.signature_copy_path],
    ] as const) {
      if (!path) continue;
      const { data: signed, error: signingError } = await bucket.createSignedUrl(path, 120);
      if (signingError || !signed?.signedUrl)
        throw new Error("POD document is temporarily unavailable.");
      result[key] = signed.signedUrl;
    }
    return result;
  });
