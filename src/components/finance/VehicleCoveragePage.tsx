import { useEffect, useState } from "react";
import { Loader2, Shield, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranches, type BranchOption } from "@/lib/use-branches";
import { useSession } from "@/lib/session";
import { VehicleInsuranceSection } from "@/components/masters/VehicleInsuranceSection";
import { VehicleRoadTaxSection } from "@/components/masters/VehicleRoadTaxSection";

// The generated Supabase types predate the vehicles table.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
type Vehicle = { id: string; registration_number: string | null; nickname: string | null; branch_id: string | null };
type CoverageKind = "insurance" | "road-tax";

export function VehicleCoveragePage({ kind, readOnly = false }: { kind: CoverageKind; readOnly?: boolean }) {
  const { user } = useSession();
  const isBasic = user?.role === "basic";
  const allowedBranchIds = isBasic ? (user?.branchIds ?? []) : null;
  const allowedBranchKey = allowedBranchIds?.join(",") ?? "all";
  const branches = useBranches() as BranchOption[];
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      let query = db.from("vehicles").select("id,registration_number,nickname,branch_id").order("registration_number");
      if (allowedBranchIds !== null) query = query.in("branch_id", allowedBranchIds);
      const { data, error } = await query;
      if (cancelled) return;
      if (error) {
        toast.error(`Could not load vehicles: ${error.message}`);
        setVehicles([]);
      } else {
        setVehicles((data ?? []) as Vehicle[]);
      }
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [allowedBranchKey]);

  const isInsurance = kind === "insurance";
  const title = isInsurance ? "Insurance" : "Road Tax";
  const description = isInsurance ? "Manage insurance policies and monthly expenditure allocation for all vehicles." : "Manage road tax periods and monthly expenditure allocation for all vehicles.";
  const Icon = isInsurance ? Shield : FileText;

  return <div className="space-y-5 animate-fade-up">
    <section className="surface-card p-5"><div className="flex items-start gap-3"><Icon className="mt-0.5 size-5 text-primary" /><div><h2 className="text-lg font-semibold">{title} — All Vehicles</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div></div></section>
    {loading ? <div className="surface-card py-16 text-center"><Loader2 className="mx-auto size-6 animate-spin" /></div> : vehicles.length === 0 ? <div className="surface-card py-12 text-center text-sm text-muted-foreground">No vehicles found.</div> : <div className="space-y-5">{vehicles.map((vehicle) => <section key={vehicle.id} className="surface-card p-4"><div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3"><div><h3 className="font-semibold">{vehicle.registration_number || vehicle.nickname || "Unnamed vehicle"}</h3><p className="text-xs text-muted-foreground">{vehicle.nickname && vehicle.registration_number ? vehicle.nickname : ""}{vehicle.branch_id ? ` · ${branches.find((branch) => branch.id === vehicle.branch_id)?.branch_name ?? "Branch"}` : ""}</p></div></div>{isInsurance ? <VehicleInsuranceSection vehicleId={vehicle.id} branchId={vehicle.branch_id} registrationNumber={vehicle.registration_number ?? vehicle.nickname ?? ""} readOnly={readOnly} /> : <VehicleRoadTaxSection vehicleId={vehicle.id} branchId={vehicle.branch_id} registrationNumber={vehicle.registration_number ?? vehicle.nickname ?? ""} readOnly={readOnly} />}</section>)}</div>}
  </div>;
}
