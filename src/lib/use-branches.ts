import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { useSession } from "@/lib/session";

export type BranchOption = {
  id: string;
  branch_name: string;
  branch_type: string | null;
  trip_series_prefix: string | null;
  lr_series_prefix: string | null;
  manifest_series_prefix: string | null;
  pin_code: string | null;
  state_code: string | null;
  gstin: string | null;
  wms_enabled: boolean;
  wms_warehouse_id: number | null;
};

export function useBranches() {
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const { user } = useSession();
  useEffect(() => {
    (async () => {
      const rows = await fetchAll<BranchOption>(() =>
        supabase
          .from("branches")
          .select(
            "id,branch_name,branch_type,trip_series_prefix,lr_series_prefix,manifest_series_prefix,pin_code,state_code,gstin,wms_enabled,wms_warehouse_id",
          )
          .order("branch_name", { ascending: true }),
      );
      setBranches(
        user?.role === "basic" ? rows.filter((branch) => user.branchIds.includes(branch.id)) : rows,
      );
    })();
  }, [user?.role, user?.branchIds]);
  return branches;
}

export function branchName(branches: BranchOption[], id: string | null | undefined) {
  if (!id) return "";
  return branches.find((b) => b.id === id)?.branch_name ?? "";
}
