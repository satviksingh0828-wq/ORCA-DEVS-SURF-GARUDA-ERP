import { useEffect, useState } from "react";
import { Loader2, Shield, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranches, type BranchOption } from "@/lib/use-branches";
import { VehicleInsuranceSection } from "@/components/masters/VehicleInsuranceSection";
import { VehicleRoadTaxSection } from "@/components/masters/VehicleRoadTaxSection";

// The generated Supabase types predate the vehicles table.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
type Vehicle = { id: string; registration_number: string | null; nickname: string | null; branch_id: string | null };
type CoverageKind = "insurance" | "road-tax";

export function VehicleCoveragePage({ kind }: { kind: CoverageKind }) {
  const branches = useBranches() as BranchOption[];
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data, error } = await db.from("vehicles").select("id,registration_number,nickname,branch_id").order("registration_number");
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
  }, []);

  const isInsurance = kind === "insurance";
  const title = isInsurance ? "Insurance" : "Road Tax";
  const description = isInsurance ? "Manage insurance policies and monthly expenditure allocation for all vehicles." : "Manage road tax periods and monthly expenditure allocation for all vehicles.";
  const Icon = isInsurance ? Shield : FileText;

  return <div className="space-y-5 animate-fade-up">
    <section className="surface-card p-5"><div className="flex items-start gap-3"><Icon className="mt-0.5 size-5 text-primary" /><div><h2 className="text-lg font-semibold">{title} — All Vehicles</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div></div></section>
    {loading ? <div className="surface-card py-16 text-center"><Loader2 className="mx-auto size-6 animate-spin" /></div> : vehicles.length === 0 ? <div className="surface-card py-12 text-center text-sm text-muted-foreground">No vehicles found.</div> : <div className="space-y-5">{vehicles.map((vehicle) => <section key={vehicle.id} className="surface-card p-4"><div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3"><div><h3 className="font-semibold">{vehicle.registration_number || vehicle.nickname || "Unnamed vehicle"}</h3><p className="text-xs text-muted-foreground">{vehicle.nickname && vehicle.registration_number ? vehicle.nickname : ""}{vehicle.branch_id ? ` · ${branches.find((branch) => branch.id === vehicle.branch_id)?.branch_name ?? "Branch"}` : ""}</p></div></div>{isInsurance ? <VehicleInsuranceSection vehicleId={vehicle.id} branchId={vehicle.branch_id} registrationNumber={vehicle.registration_number ?? vehicle.nickname ?? ""} /> : <VehicleRoadTaxSection vehicleId={vehicle.id} branchId={vehicle.branch_id} registrationNumber={vehicle.registration_number ?? vehicle.nickname ?? ""} />}</section>)}</div>}
  </div>;
}
