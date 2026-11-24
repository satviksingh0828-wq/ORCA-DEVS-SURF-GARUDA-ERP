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


/**
 * A master rate is charged once for each third-party consignment assigned
 * to that LTMS transporter, irrespective of route-rate availability.
 * This is a calculated MIS cost, not a posted journal entry.
 */
export function fixedLRChargeForConsignment(
  consignmentType: string | null | undefined,
  transporterId: string | null | undefined,
  masterCharge: unknown,
): number {
  if (String(consignmentType ?? "").toLowerCase() !== "third_party" || !transporterId) return 0;
  const amount = Number(masterCharge ?? 0);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0;
}

/** Total includes the fixed LR amount exactly once; freight/loading are net of adjustments. */
export function transporterExpenditureAmount(
  adjustedFreight: number,
  adjustedLoading: number,
  fixedLRCharge: number,
): number {
  return adjustedFreight + adjustedLoading + fixedLRCharge;
}
