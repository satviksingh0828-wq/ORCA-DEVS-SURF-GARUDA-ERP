/** Format the goods GST rate using actual ERP tax data when present. */
export function formatConsignmentGst(rate?: number): string {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return "---";
  return rate.toFixed(2) + "%";
}
