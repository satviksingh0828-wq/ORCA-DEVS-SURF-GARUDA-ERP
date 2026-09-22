import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";

export type BranchOption = {
  id: string;
  branch_name: string;
  branch_type: string | null;
  trip_series_prefix: string | null;
  lr_series_prefix: string | null;
  pin_code: string | null;
  state_code: string | null;
};

export function useBranches() {
  const [branches, setBranches] = useState<BranchOption[]>([]);
  useEffect(() => {
    (async () => {
      const rows = await fetchAll<BranchOption>(() =>
        supabase
          .from("branches")
          .select("id,branch_name,branch_type,trip_series_prefix,lr_series_prefix,pin_code,state_code")
          .order("branch_name", { ascending: true }),
      );
      setBranches(rows);
    })();
  }, []);
  return branches;
}

export function branchName(branches: BranchOption[], id: string | null | undefined) {
  if (!id) return "";
  return branches.find((b) => b.id === id)?.branch_name ?? "";
}
