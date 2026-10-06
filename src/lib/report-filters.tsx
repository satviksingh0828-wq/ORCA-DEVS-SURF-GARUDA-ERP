import { createContext, useContext } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { financialYearRange } from "@/lib/financial-year";
import { useSession } from "@/lib/session";

export type ReportFilters = { branchId: string; financialYear: string };
export const ReportFiltersContext = createContext<ReportFilters>({
  branchId: "all",
  financialYear: "none",
});
export function useReportFilters() {
  const filters = useContext(ReportFiltersContext);
  const { user } = useSession();
  if (user?.role === "basic" && user.branchIds.length > 0) {
    return { ...filters, branchId: user.branchIds[0] };
  }
  return filters;
}

export function reportDateRange(
  financialYear: string,
  fallback: () => { start: string; end: string },
) {
  return financialYear === "none" ? fallback() : financialYearRange(Number(financialYear));
}

export async function tripCodesForBranch(
  branchId: string,
  _range?: { start: string; end: string },
) {
  // The caller already filters its report rows by that report's own date field
  // (trip_date, created_at, etc.). Do not additionally filter closed_trips by
  // closed_at: a trip can be logged in the selected period but closed earlier
  // or later, which would incorrectly remove it from branch-scoped reports.
  if (branchId === "all") return null;
  const rows = await fetchAll<{ trip_code: string }>(() =>
    supabase.from("closed_trips").select("trip_code").eq("branch_id", branchId),
  );
  return new Set(rows.map((row) => row.trip_code));
}
