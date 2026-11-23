/** Exact 26-column order from JAIPUR REPORTS.xls and Freight_Value.xls. */
export const CONSIGNMENT_REPORT_COLUMNS = [
  "SNO", "Branch", "Source", "Cnmt No.", "Cnmt Date", "Consignee",
  "Destination", "Destination Pincode", "Destination State",
  "Consignee Pincode", "Consignee State", "Load Type", "Vehicle No.",
  "Pkgs", "A. Weight", "C. Weight", "Transporter Name", "Invoice No.",
  "Invoice Date", "Ref. No.", "Ref. Date", "Mark No.", "Rate",
  "Rate Calculate On", "Freight", "Others Charges",
] as const;

export type ConsignmentColumn = (typeof CONSIGNMENT_REPORT_COLUMNS)[number];
export type ReportCell = string | number;
export type ConsignmentReportRecord = Partial<Record<ConsignmentColumn, ReportCell>>;

export const CONSIGNMENT_FINANCIAL_COLUMNS = [
  "Rate", "Rate Calculate On", "Freight", "Others Charges",
] as const satisfies ReadonlyArray<ConsignmentColumn>;

/** Admin/semi-admin have financial access. Viewer and Basic are read-only, restricted. */
export function canSeeConsignmentReportFinancials(role: string | null | undefined) {
  return role === "admin" || role === "semi_admin";
}
export function columnsForConsignmentRole(role: string | null | undefined): ConsignmentColumn[] {
  return canSeeConsignmentReportFinancials(role)
    ? [...CONSIGNMENT_REPORT_COLUMNS]
    : CONSIGNMENT_REPORT_COLUMNS.filter(
        (column) => !(CONSIGNMENT_FINANCIAL_COLUMNS as readonly string[]).includes(column),
      );
}
/** Security boundary: construct a NEW object with allowed keys only. */
export function restrictConsignmentReportRecord(
  record: ConsignmentReportRecord,
  role: string | null | undefined,
): ConsignmentReportRecord {
  const result: ConsignmentReportRecord = {};
  for (const column of columnsForConsignmentRole(role))
    result[column] = record[column] ?? "";
  return result;
}
export function formatConsignmentReportDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return match ? match[3] + "/" + match[2] + "/" + match[1] : raw;
}
export function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
export function reportSummary(rows: ConsignmentReportRecord[]) {
  return rows.reduce(
    (total, row) => ({
      packages: total.packages + numberValue(row["Pkgs"]),
      actualWeight: total.actualWeight + numberValue(row["A. Weight"]),
      chargedWeight: total.chargedWeight + numberValue(row["C. Weight"]),
      freight: total.freight + numberValue(row["Freight"]),
      otherCharges: total.otherCharges + numberValue(row["Others Charges"]),
    }),
    { packages: 0, actualWeight: 0, chargedWeight: 0, freight: 0, otherCharges: 0 },
  );
}
