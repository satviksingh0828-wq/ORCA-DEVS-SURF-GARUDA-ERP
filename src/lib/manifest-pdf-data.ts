/** Consignment-sourced values for the Manifest Auto printout. */
export type VehicleChoice = {
  consignmentId: string;
  vehicleNumber: string | null | undefined;
};

const normal = (value: string) => value.toUpperCase().replace(/[\s-]/g, "");

export function mostCommonManifestVehicle(entries: VehicleChoice[]): string {
  const counted = new Set<string>();
  const tally = new Map<string, { count: number; display: string }>();
  for (const { consignmentId, vehicleNumber } of entries) {
    const displayed = String(vehicleNumber ?? "").trim().toUpperCase();
    if (!displayed || !consignmentId) continue;
    // A consignment with multiple E-Way Bills only counts once.
    if (counted.has(consignmentId)) continue;
    counted.add(consignmentId);
    const key = normal(displayed);
    const previous = tally.get(key);
    tally.set(key, {
      count: (previous?.count ?? 0) + 1,
      display: previous?.display ?? displayed,
    });
  }
  let choice = "";
  let max = 0;
  for (const candidate of tally.values()) {
    if (candidate.count > max) {
      choice = candidate.display;
      max = candidate.count;
    }
  }
  return choice;
}

export type ManifestPackageLine = {
  consignment_id: string;
  shipment_id: string | null;
  quantity: number | string | null;
  weight_kg: number | string | null;
};

export type PackageTotals = { quantity: number; weightKg: number };
const toNumber = (value: unknown) => Number(value ?? 0) || 0;

/**
 * Count real saved consignment package information by its exact shipment.
 * Never multiply a complete consignment total across every linked E-Way Bill.
 */
export function manifestPackageTotals(lines: ManifestPackageLine[]) {
  const map = new Map<string, PackageTotals>();
  for (const line of lines) {
    if (!line.shipment_id) continue;
    const key = String(line.consignment_id) + ":" + String(line.shipment_id);
    const prior = map.get(key) ?? { quantity: 0, weightKg: 0 };
    map.set(key, {
      quantity: prior.quantity + toNumber(line.quantity),
      weightKg: prior.weightKg + toNumber(line.weight_kg),
    });
  }
  return map;
}
