import type { RouteRange } from "./contract-ranges";

export type ContractLite = {
  id: string;
  contract_name: string;
  company_name?: string | null;
  gstin?: string | null;
  fixed_monthly_charge?: string | number | null;
  fixed_yearly_charge?: string | number | null;
};

export type EntryLite = {
  id: string;
  contract_id: string;
  from_location_id: string | null;
  to_location_id: string | null;
  from_pin_code: string | null;
  to_pin_code: string | null;
  freight_route_range_type: "weight" | "quantity";
  freight_route_ranges: RouteRange[];
  loading_route_range_type: "weight" | "quantity";
  loading_route_ranges: RouteRange[];
  per_manifest_amount: string | null;
};

export type ManifestLite = {
  from_location_id: string | null;
  to_location_id: string | null;
  from_pin_code: string | null;
  to_pin_code: string | null;
  weight_kg: string | null;
  quantity: string | null;
};

export function num(v: unknown): number {
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function inr(n: number): string {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function findEntry(entries: EntryLite[], m: ManifestLite): EntryLite | undefined {
  const byId = entries.find(
    (e) =>
      e.from_location_id &&
      e.to_location_id &&
      e.from_location_id === m.from_location_id &&
      e.to_location_id === m.to_location_id,
  );
  if (byId) return byId;
  const fp = (m.from_pin_code ?? "").trim();
  const tp = (m.to_pin_code ?? "").trim();
  if (!fp || !tp) return undefined;
  return entries.find(
    (e) => (e.from_pin_code ?? "").trim() === fp && (e.to_pin_code ?? "").trim() === tp,
  );
}

/**
 * Finds the matching slab for a given value.
 * A slab matches when:
 *   - value >= start  (lower bound, inclusive)
 *   - end is empty OR value <= end  (upper bound, inclusive; empty = open-ended ∞)
 * When multiple slabs match, the one with the highest start wins.
 */
function matchRouteRange(ranges: RouteRange[], value: number): RouteRange | undefined {
  const sorted = [...ranges].sort((a, b) => num(a.start) - num(b.start));
  let matched: RouteRange | undefined;
  for (const r of sorted) {
    const startOk = value >= num(r.start);
    const endOk = !r.end || r.end.trim() === "" || value <= num(r.end);
    if (startOk && endOk) matched = r;
  }
  return matched;
}

export type ManifestRateDetail = {
  type: "fixed" | "variable" | "—";
  value: number;
};

export type ManifestChargeDetails = {
  freight: ManifestRateDetail;
  loading: ManifestRateDetail;
  fixed: number;
  matched: boolean;
};

/** Returns the contract/source rate selected for each charge, including the original rate value. */
export function manifestChargeDetails(
  contract: ContractLite | undefined,
  entry: EntryLite | undefined,
  m: ManifestLite,
): ManifestChargeDetails {
  if (!contract || !entry) {
    return {
      freight: { type: "—", value: 0 },
      loading: { type: "—", value: 0 },
      fixed: 0,
      matched: false,
    };
  }

  const pick = (ranges: RouteRange[], rangeType: "weight" | "quantity"): ManifestRateDetail => {
    const value = rangeType === "weight" ? num(m.weight_kg) : num(m.quantity);
    const r = matchRouteRange(ranges ?? [], value);
    if (!r) return { type: "—", value: 0 };
    return {
      type: r.working === "fixed" ? "fixed" : "variable",
      value: num(r.value),
    };
  };

  return {
    freight: pick(entry.freight_route_ranges ?? [], entry.freight_route_range_type ?? "weight"),
    loading: pick(entry.loading_route_ranges ?? [], entry.loading_route_range_type ?? "weight"),
    fixed: num(entry.per_manifest_amount),
    matched: true,
  };
}

export function manifestCharges(
  contract: ContractLite | undefined,
  entry: EntryLite | undefined,
  m: ManifestLite,
): { freight: number; loading: number; fixed: number; matched: boolean } {
  const details = manifestChargeDetails(contract, entry, m);
  const charge = (rate: ManifestRateDetail, rangeType: "weight" | "quantity") => {
    const value = rangeType === "weight" ? num(m.weight_kg) : num(m.quantity);
    return rate.type === "fixed" ? rate.value : rate.type === "variable" ? rate.value * value : 0;
  };
  return {
    freight: charge(details.freight, entry?.freight_route_range_type ?? "weight"),
    loading: charge(details.loading, entry?.loading_route_range_type ?? "weight"),
    fixed: details.fixed,
    matched: details.matched,
  };
}
