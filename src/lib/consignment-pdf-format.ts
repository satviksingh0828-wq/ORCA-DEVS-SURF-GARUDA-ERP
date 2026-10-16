/**
 * Keeps the compact reference form readable when no GST is applicable.
 * The reference uses a placeholder instead of printing GST 0.00%.
 */
export function formatConsignmentGst(rate: number): string {
  const normalizedRate = Number(rate) || 0;
  return normalizedRate === 0 ? "---" : `${normalizedRate.toFixed(2)}%`;
}
