/**
 * Transporter master amount in INR, not a posted charge.
 * Accept up to two decimals to match PostgreSQL NUMERIC(12,2).
 */
export function parsePerConsignmentCharges(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new Error("Per Consignment Charges must be a non-negative amount with at most 2 decimals.");
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount > 9999999999.99) {
    throw new Error("Per Consignment Charges exceeds the supported amount.");
  }
  return amount;
}
