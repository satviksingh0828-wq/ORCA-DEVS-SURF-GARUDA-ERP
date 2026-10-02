/**
 * TripImport — standalone admin-only page at /import-trips
 *
 * Allows bulk import of historical trips (as live trips) from up to 4 CSV files:
 *   1. trips.csv        (required)
 *   2. manifests.csv    (optional)
 *   3. expenses.csv     (optional)
 *   4. other_income.csv (optional)
 *
 * No navigation links point here — access directly by URL.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Download, Loader2, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { isAdminLike } from "@/lib/roles";
import { isDriverActive } from "@/lib/drivers";
import { readCsvFile, downloadCsv, toCsv } from "@/lib/csv";
import { ensureLocationsForPins } from "@/lib/ensure-location";
import { normalizeImportedDate } from "@/lib/date-input";
import { Button } from "@/components/ui/button";

// ── Types ──────────────────────────────────────────────────────────────────

type MasterMaps = {
  branches: Map<string, string>; // lower(branch_name) → id
  branchPrefixes: Map<string, string>; // lower(branch_name) → trip series prefix
  vehicles: Map<string, string>; // lower(registration_number) → id
  drivers: Map<string, string>; // lower(full_name) → id
  transporters: Map<string, string>; // lower(transporter_name) → id
  sources: Map<string, string>; // lower(contract_name) → id
  locationsByPin: Map<string, string>; // pin_code → id
};

type ValidatedTrip = {
  rowNum: number;
  raw: Record<string, string>;
  // resolved
  trip_code: string;
  ownership: string;
  branch_id: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  transporter_id: string | null;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  odometer_start: string;
  odometer_end: string;
  third_party_vehicle_number: string;
  errors: string[];
  ok: boolean;
};

// ── CSV column definitions (for template download) ─────────────────────────

const TRIPS_COLS = [
  "trip_code","ownership","branch_name","vehicle_number","driver_name",
  "transporter_name","start_pin_code","end_pin_code","start_date","start_time","end_date","end_time",
  "odometer_start","odometer_end","third_party_vehicle_number",
];
const MANIFESTS_COLS = ["trip_code","manifest_number","manifest_date","source","from_pin_code","to_pin_code","weight_kg","quantity"];
const EXPENSES_COLS  = ["trip_code","expense_name","amount","note"];
const INCOME_COLS    = ["trip_code","income_name","amount","note"];

// ── Helpers ────────────────────────────────────────────────────────────────

function norm(s: string) { return (s ?? "").trim().toLowerCase(); }

function normalizeDate(raw: string | undefined): string {
  return normalizeImportedDate(raw);
}

async function validate(
  rows: Record<string, string>[],
  maps: MasterMaps,
): Promise<ValidatedTrip[]> {
  const seen = new Set<string>();
  const validated: ValidatedTrip[] = [];
  for (const [i, raw] of rows.entries()) {
    const errors: string[] = [];

    const ownership = norm(raw.ownership) === "rented" ? "rented" : "own";

    const branchId = maps.branches.get(norm(raw.branch_name ?? "")) ?? null;
    if (!raw.branch_name?.trim()) errors.push("branch_name required");
    else if (!branchId) errors.push(`Branch "${raw.branch_name}" not found`);

    const vehicleId = raw.vehicle_number?.trim()
      ? (maps.vehicles.get(norm(raw.vehicle_number)) ?? null)
      : null;
    if (ownership === "own") {
      if (!raw.vehicle_number?.trim()) errors.push("vehicle_number required for own trips");
      else if (!vehicleId) errors.push(`Vehicle "${raw.vehicle_number}" not found`);
    }

    const driverId = raw.driver_name?.trim()
      ? (maps.drivers.get(norm(raw.driver_name)) ?? null)
      : null;
    if (ownership === "own" && !raw.driver_name?.trim()) {
      errors.push("driver_name required for own trips");
    } else if (raw.driver_name?.trim() && !driverId) {
      errors.push(`Driver "${raw.driver_name}" not found`);
    }

    const transporterId = raw.transporter_name?.trim()
      ? (maps.transporters.get(norm(raw.transporter_name)) ?? null)
      : null;
    if (ownership === "rented" && !raw.transporter_name?.trim()) {
      errors.push("transporter_name required for rented trips");
    } else if (raw.transporter_name?.trim() && !transporterId) {
      errors.push(`Transporter "${raw.transporter_name}" not found`);
    }

    const startPin = (raw.start_pin_code ?? "").trim();
    const endPin = (raw.end_pin_code ?? "").trim();
    if (startPin && !/^\d{6}$/.test(startPin)) errors.push("start_pin_code must be a 6-digit PIN");
    if (endPin && !/^\d{6}$/.test(endPin)) errors.push("end_pin_code must be a 6-digit PIN");

    const startDate = normalizeDate(raw.start_date);
    if (!startDate) errors.push("start_date required (YYYY-MM-DD or DD/MM/YYYY)");
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) errors.push("start_date must be YYYY-MM-DD or DD/MM/YYYY");

    let tripCode = raw.trip_code?.trim() ?? "";
    if (!tripCode && errors.length === 0) {
      const prefix =
        maps.branchPrefixes
          .get(norm(raw.branch_name ?? ""))
          ?.trim()
          .toUpperCase() ?? "";
      if (!branchId) {
        errors.push("Branch is required to assign a Trip number");
      } else if (!/^[A-Z0-9]{1,10}$/.test(prefix)) {
        errors.push("A valid Trip Series Prefix is required to assign a Trip number");
      } else {
        const { data: generatedCode, error: numberError } = await supabase.rpc(
          "next_branch_series_number" as never,
          {
            p_branch_id: branchId,
            p_document_type: "trip",
            p_prefix: prefix,
            p_series_year: Number(startDate.slice(0, 4)) || new Date().getFullYear(),
          } as never,
        );
        if (numberError || !generatedCode) {
          errors.push(numberError?.message ?? "Could not generate Trip number");
        } else {
          tripCode = String(generatedCode);
        }
      }
    }
    if (!tripCode) tripCode = `PENDING-ROW-${i + 2}`;
    if (seen.has(tripCode)) errors.push(`Duplicate trip_code "${tripCode}" in file`);
    seen.add(tripCode);

    validated.push({
      rowNum: i + 2, // +2 because row 1 is header
      raw,
      trip_code: tripCode,
      ownership,
      branch_id: branchId,
      vehicle_id: vehicleId,
      driver_id: driverId,
      transporter_id: transporterId,
      start_date: startDate,
      start_time: raw.start_time?.trim() ?? "",
      end_date: "",
      end_time: raw.end_time?.trim() ?? "",
      odometer_start: raw.odometer_start?.trim() ?? "",
      odometer_end: raw.odometer_end?.trim() ?? "",
      third_party_vehicle_number: raw.third_party_vehicle_number?.trim() ?? "",
      errors,
      ok: errors.length === 0,
    });
  }
  return validated;
}

// ── File upload card ───────────────────────────────────────────────────────

function FileCard({
  label, hint, filename, cols, required: req, file, onFile,
}: {
  label: string; hint: string; filename: string; cols: string[];
  required?: boolean; file: File | null;
  onFile: (f: File | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {label} {req && <span className="text-destructive">*</span>}
          </p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-primary hover:underline"
          onClick={() => { downloadCsv(toCsv([], cols), `${filename}-template.csv`); }}
        >
          <Download className="size-3" /> template
        </button>
      </div>
      <div
        className={`flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 cursor-pointer transition-colors
          ${file ? "border-primary/60 bg-primary/5" : "border-border hover:border-primary/40"}`}
        onClick={() => ref.current?.click()}
      >
        <Upload className="size-4 text-muted-foreground shrink-0" />
        <span className="text-xs truncate text-muted-foreground">
          {file ? file.name : "Click to upload CSV"}
        </span>
        {file && (
          <button
            type="button"
            className="ml-auto text-xs text-destructive hover:underline shrink-0"
            onClick={(e) => { e.stopPropagation(); onFile(null); if (ref.current) ref.current.value = ""; }}
          >
            Remove
          </button>
        )}
      </div>
      <input
        ref={ref} type="file" accept=".csv,text/csv" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; onFile(f); }}
      />
    </div>
  );
}

// ── README section ─────────────────────────────────────────────────────────

function ReadMe() {
  return (
    <div className="mt-10 rounded-xl border border-border bg-muted/30 p-6 space-y-5 text-sm">
      <h2 className="text-base font-bold tracking-tight">📖 READ ME — How to use Trip Import</h2>

      <section className="space-y-2">
        <h3 className="font-semibold text-foreground">What this does</h3>
        <p className="text-muted-foreground">
          Imports historical trips directly into the live Trips list. After import each trip
          appears as a normal live trip — you can open it, edit details, and close it the usual way
          (which enforces end date / end time / odometer validation).
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold text-foreground">Step-by-step</h3>
        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
          <li>Click the <strong className="text-foreground">template</strong> link on any card to download a blank CSV for that type.</li>
          <li>Fill in your data (see column guide below).</li>
          <li>Upload <code className="rounded bg-muted px-1">trips.csv</code> (required). Upload manifests / expenses / other-income files if you have them.</li>
          <li>Click <strong className="text-foreground">Validate &amp; Preview</strong> — each row shows ✅ Ready or ❌ with the exact error.</li>
          <li>Fix any errors in your CSV, re-upload, and validate again.</li>
          <li>Click <strong className="text-foreground">Import X trips</strong>. Done.</li>
        </ol>
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold text-foreground">trips.csv — columns</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1.5 pr-4 font-medium">Column</th>
                <th className="py-1.5 pr-4 font-medium">Required?</th>
                <th className="py-1.5 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              {[
                ["trip_code",                  "No",  "Leave blank to assign the next branch number during validation"],
                ["ownership",                  "Yes", "'own' for your vehicle, 'rented' for hired transport"],
                ["branch_name",                "Yes", "Must exactly match a branch name in Settings"],
                ["start_pin_code",           "No",  "6-digit PIN code; importer finds or creates the Starting Location from this PIN"],
                ["end_pin_code",             "No",  "6-digit PIN code; importer finds or creates the Ending Location from this PIN"],
                ["vehicle_number",             "own trips", "Registration number — must exist in Masters → Vehicles"],
                ["driver_name",                "own trips", "Full name — must exist in Masters → Drivers"],
                ["transporter_name",           "rented trips", "Must exist in Masters → Transporters"],
                ["start_date",                 "Yes", "Format: YYYY-MM-DD or DD/MM/YYYY. Excel serial dates are also converted."],
                ["start_time",                 "No",  "Format: HH:MM  e.g. 08:30"],
                ["end_date",                   "Ignored",  "Trip Import keeps every trip open, so end date is not saved during import."],
                ["end_time",                   "Ignored",  "Trip Import keeps every trip open, so end time is not saved during import."],
                ["odometer_start",             "No",  "Numbers only, e.g. 45200"],
                ["odometer_end",               "Ignored", "Trip Import keeps every trip open, so closing odometer is not saved during import."],
                ["third_party_vehicle_number", "No",  "Rented trips only — the hired vehicle's number"],
              ].map(([col, req, note]) => (
                <tr key={col} className="border-b border-border/50">
                  <td className="py-1.5 pr-4 font-mono text-foreground">{col}</td>
                  <td className="py-1.5 pr-4">{req}</td>
                  <td className="py-1.5">{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold text-foreground">manifests.csv — columns</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1.5 pr-4 font-medium">Column</th>
                <th className="py-1.5 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              {[
                ["trip_code",       "Must match the trip_code in trips.csv exactly"],
                ["manifest_number", "Your manifest / LR number"],
                ["manifest_date",   "Manifest date. Excel serial dates, YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY and month-name formats are accepted."],
                ["source",          "Contract/source name used to calculate freight and loading. Must exactly match an active source in Masters → Contracts. Leave blank if charges should stay zero until you edit the manifest."],
                ["from_pin_code",   "6-digit PIN code of pickup location"],
                ["to_pin_code",     "6-digit PIN code of delivery location"],
                ["weight_kg",       "Payload weight in kg"],
                ["quantity",        "Number of units / packages"],
              ].map(([col, note]) => (
                <tr key={col} className="border-b border-border/50">
                  <td className="py-1.5 pr-4 font-mono text-foreground">{col}</td>
                  <td className="py-1.5">{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold text-foreground">expenses.csv — columns</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[400px] text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1.5 pr-4 font-medium">Column</th>
                <th className="py-1.5 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              {[
                ["trip_code",    "Must match the trip_code in trips.csv"],
                ["expense_name", "e.g. Fuel Expense, Toll Charges, Toll Charges (paid in cash), Driver Bata"],
                ["amount",       "Numeric, e.g. 4500"],
                ["note",         "Optional note"],
              ].map(([col, note]) => (
                <tr key={col} className="border-b border-border/50">
                  <td className="py-1.5 pr-4 font-mono text-foreground">{col}</td>
                  <td className="py-1.5">{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold text-foreground">other-income.csv — columns</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[400px] text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1.5 pr-4 font-medium">Column</th>
                <th className="py-1.5 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              {[
                ["trip_code",   "Must match the trip_code in trips.csv"],
                ["income_name", "e.g. Detention Charges, Loading Charges"],
                ["amount",      "Numeric, e.g. 1200"],
                ["note",        "Optional note"],
              ].map(([col, note]) => (
                <tr key={col} className="border-b border-border/50">
                  <td className="py-1.5 pr-4 font-mono text-foreground">{col}</td>
                  <td className="py-1.5">{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold text-foreground">Common errors & fixes</h3>
        <ul className="space-y-1 text-muted-foreground list-disc list-inside">
          <li><strong className="text-foreground">Branch "X" not found</strong> — check spelling matches exactly what's in Settings → Branches</li>
          <li><strong className="text-foreground">Vehicle "X" not found</strong> — check registration number matches exactly in Masters → Vehicles</li>
          <li><strong className="text-foreground">Driver "X" not found</strong> — check full name matches exactly in Masters → Drivers</li>
          <li><strong className="text-foreground">Duplicate trip_code</strong> — two rows in your CSV share the same trip code; each must be unique</li>
          <li><strong className="text-foreground">start_date required</strong> — date must be in YYYY-MM-DD format (not DD/MM/YYYY)</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold text-foreground">After import</h3>
        <p className="text-muted-foreground">
          Imported trips appear in the <strong className="text-foreground">Trip</strong> tab as open live trips.
          End date, end time, and closing odometer values are intentionally not imported.
          Open each one → fill in the closing details when ready → click
          <strong className="text-foreground"> Close trip</strong> to archive it. The close button
          in the trip form validates all required fields before archiving.
        </p>
      </section>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function TripImport({ embedded = false }: { embedded?: boolean }) {
  const { user, loading: sessionLoading } = useSession();
  const navigate = useNavigate();

  // redirect non-admins only in standalone mode
  useEffect(() => {
    if (embedded) return;
    if (!sessionLoading && (!user || !isAdminLike(user.role))) {
      navigate({ to: "/home", replace: true });
    }
  }, [user, sessionLoading, navigate, embedded]);

  const [masters, setMasters] = useState<MasterMaps | null>(null);
  const [loadingMasters, setLoadingMasters] = useState(false);

  const [tripsFile,     setTripsFile]     = useState<File | null>(null);
  const [manifestsFile, setManifestsFile] = useState<File | null>(null);
  const [expensesFile,  setExpensesFile]  = useState<File | null>(null);
  const [incomeFile,    setIncomeFile]    = useState<File | null>(null);

  const [validated, setValidated] = useState<ValidatedTrip[] | null>(null);
  const [manifests, setManifests] = useState<Record<string, string>[]>([]);
  const [expenses,  setExpenses]  = useState<Record<string, string>[]>([]);
  const [otherIncome, setOtherIncome] = useState<Record<string, string>[]>([]);

  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ ok: number; skipped: number } | null>(null);

  // Load masters once on mount
  useEffect(() => {
    if (!user || !isAdminLike(user.role)) return;
    setLoadingMasters(true);
    Promise.all([
      supabase.from("branches").select("id,branch_name,trip_series_prefix" as never),
      supabase.from("vehicles").select("id,registration_number"),
      supabase.from("drivers").select("id,full_name,ending_date"),
      supabase.from("transporters").select("id,transporter_name"),
      supabase.from("contracts").select("id,contract_name").eq("status", "active"),
      supabase.from("locations").select("id,pin_code"),
    ])
      .then(([b, v, d, t, c, l]) => {
        const branchRows = (b.data ?? []) as unknown as Array<{
          id: string;
          branch_name: string;
          trip_series_prefix: string | null;
        }>;
        setMasters({
          branches: new Map(branchRows.map((r) => [norm(r.branch_name), r.id])),
          branchPrefixes: new Map(
            branchRows.map((r) => [norm(r.branch_name), r.trip_series_prefix ?? ""]),
          ),
          vehicles: new Map((v.data ?? []).map((r) => [norm(r.registration_number), r.id])),
          drivers: new Map(
            (d.data ?? []).filter(isDriverActive).map((r) => [norm(r.full_name), r.id]),
          ),
          transporters: new Map((t.data ?? []).map((r) => [norm(r.transporter_name), r.id])),
          sources: new Map((c.data ?? []).map((r) => [norm(r.contract_name), r.id])),
          locationsByPin: new Map(
            (l.data ?? [])
              .filter((r) => (r.pin_code ?? "").trim())
              .map((r) => [(r.pin_code ?? "").trim(), r.id]),
          ),
        });
      })
      .catch(() => toast.error("Could not load master data"))
      .finally(() => setLoadingMasters(false));
  }, [user]);

  async function handleValidate() {
    if (!tripsFile) return toast.error("trips.csv is required");
    if (!masters)   return toast.error("Master data not loaded yet, please wait");

    try {
      const [tripRows, mfRows, exRows, incRows] = await Promise.all([
        readCsvFile(tripsFile),
        manifestsFile ? readCsvFile(manifestsFile) : Promise.resolve([]),
        expensesFile  ? readCsvFile(expensesFile)  : Promise.resolve([]),
        incomeFile    ? readCsvFile(incomeFile)     : Promise.resolve([]),
      ]);
      if (tripRows.length === 0) return toast.error("trips.csv has no data rows");

      const unknownSources = mfRows
        .map((row, i) => ({ rowNum: i + 2, source: row.source?.trim() ?? "" }))
        .filter((row) => row.source && !masters.sources.has(norm(row.source)));
      if (unknownSources.length > 0) {
        return toast.error(
          `Unknown manifest source on row ${unknownSources[0].rowNum}: ${unknownSources[0].source}. Match an active contract/source name exactly.`,
        );
      }

      setValidated(await validate(tripRows, masters));
      setManifests(mfRows);
      setExpenses(exRows);
      setOtherIncome(incRows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not parse CSV");
    }
  }

  async function handleImport() {
    if (!validated) return;
    const good = validated.filter(v => v.ok);
    if (good.length === 0) return toast.error("No valid rows to import");

    setImporting(true);
    let inserted = 0;

    const tripPins = good.flatMap((t) => [t.raw.start_pin_code ?? "", t.raw.end_pin_code ?? ""]);
    const tripLocationIdsByPin = await ensureLocationsForPins(tripPins, masters.locationsByPin);

    for (const t of good) {
      try {
        // 1. Insert trip
        const { data: tripData, error: tripErr } = await supabase
          .from("trips")
          .insert({
            trip_code:    t.trip_code,
            ownership:    t.ownership,
            branch_id:    t.branch_id,
            vehicle_id:   t.vehicle_id,
            driver_id:    t.driver_id,
            transporter_id: t.transporter_id,
            start_location_id: tripLocationIdsByPin.get((t.raw.start_pin_code ?? "").trim()) ?? null,
            end_location_id: tripLocationIdsByPin.get((t.raw.end_pin_code ?? "").trim()) ?? null,
            start_date:   t.start_date || null,
            start_time:   t.start_time || null,
            // Imported trips must remain open/live. End details are filled manually before closing.
            end_date:     null,
            end_time:     null,
            odometer_start: t.odometer_start || null,
            odometer_end:   null,
            notes: "IMPORT_OPEN_TRIP",
            third_party_vehicle_number: t.third_party_vehicle_number || null,
          } as never)
          .select("id")
          .single();

        if (tripErr || !tripData) throw new Error(tripErr?.message ?? "Insert failed");
        const tripId = (tripData as Record<string, string>).id;

        // 2. Manifests for this trip
        const mfRows = manifests.filter(m => norm(m.trip_code) === norm(t.trip_code));
        if (mfRows.length > 0) {
          await supabase.from("trip_manifests").insert(
            mfRows.map(m => ({
              trip_id: tripId,
              manifest_number: m.manifest_number?.trim() ?? "",
              manifest_date: normalizeImportedDate(m.manifest_date) || null,
              source_id: m.source?.trim() ? (masters.sources.get(norm(m.source)) ?? null) : null,
              from_location_id: null,
              from_pin_code: m.from_pin_code?.trim() ?? "",
              to_location_id: null,
              to_pin_code: m.to_pin_code?.trim() ?? "",
              weight_kg: m.weight_kg?.trim() ?? "",
              quantity: m.quantity?.trim() ?? "",
            })) as never
          );
        }

        // 3. Expenses for this trip
        const exRows = expenses.filter(e => norm(e.trip_code) === norm(t.trip_code));
        if (exRows.length > 0) {
          await supabase.from("trip_expenses").insert(
            exRows.map((e, idx) => ({
              trip_id: tripId,
              expense_name: e.expense_name?.trim() ?? "",
              amount: e.amount?.trim() ?? "",
              note: e.note?.trim() ?? "",
              sort_order: idx,
            })) as never
          );
        }

        // 4. Other income for this trip
        const incRows = otherIncome.filter(r => norm(r.trip_code) === norm(t.trip_code));
        if (incRows.length > 0) {
          await supabase.from("trip_other_income").insert(
            incRows.map(r => ({
              trip_id: tripId,
              income_name: r.income_name?.trim() ?? "",
              amount: r.amount?.trim() ?? "",
              note: r.note?.trim() ?? "",
            })) as never
          );
        }

        inserted++;
      } catch (err) {
        toast.error(`Row ${t.rowNum} (${t.trip_code}): ${err instanceof Error ? err.message : "failed"}`);
      }
    }

    setImporting(false);
    setResult({ ok: inserted, skipped: validated.length - good.length });
    if (inserted > 0) toast.success(`${inserted} trip${inserted > 1 ? "s" : ""} imported`);
  }

  function reset() {
    setTripsFile(null); setManifestsFile(null);
    setExpensesFile(null); setIncomeFile(null);
    setValidated(null); setResult(null);
  }

  // In embedded mode show inline spinner; standalone shows full-screen
  if (loadingMasters || (!embedded && sessionLoading)) {
    return embedded ? (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    ) : (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!embedded && (!user || !isAdminLike(user.role))) return null;

  const goodCount = validated?.filter(v => v.ok).length ?? 0;
  const badCount  = validated?.filter(v => !v.ok).length ?? 0;

  const content = (
    <div className="space-y-6">
      {/* Header — only shown in standalone mode; Operations already shows the tab title */}
      {!embedded && (
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">Trip Import</h1>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
              Admin only
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Import historical trips as live trips. Matches vehicle/driver/transporter by name — they must already exist in Masters.
          </p>
        </div>
      )}

      {/* Done state */}
      {result ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center space-y-4">
          <CheckCircle2 className="mx-auto size-10 text-green-500" />
          <div>
            <p className="text-lg font-semibold">{result.ok} trip{result.ok !== 1 ? "s" : ""} imported</p>
            {result.skipped > 0 && (
              <p className="text-sm text-muted-foreground">{result.skipped} row{result.skipped !== 1 ? "s" : ""} skipped due to validation errors</p>
            )}
          </div>
          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={reset}>Import more</Button>
            {!embedded && (
              <Button onClick={() => navigate({ to: "/operations" })}>Go to Operations</Button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Upload cards */}
          {!validated && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FileCard label="Trips" hint="One row per trip" filename="trips" cols={TRIPS_COLS} required file={tripsFile} onFile={setTripsFile} />
              <FileCard label="Manifests" hint="One row per manifest (optional)" filename="manifests" cols={MANIFESTS_COLS} file={manifestsFile} onFile={setManifestsFile} />
              <FileCard label="Expenses" hint="One row per expense line (optional)" filename="expenses" cols={EXPENSES_COLS} file={expensesFile} onFile={setExpensesFile} />
              <FileCard label="Other Income" hint="One row per income entry (optional)" filename="other-income" cols={INCOME_COLS} file={incomeFile} onFile={setIncomeFile} />
            </div>
          )}

          {/* Masters summary */}
          {masters && !validated && (
            <p className="text-xs text-muted-foreground">
              Masters loaded — {masters.branches.size} branches · {masters.vehicles.size} vehicles · {masters.drivers.size} drivers · {masters.transporters.size} transporters · {masters.sources.size} active sources · {masters.locationsByPin.size} locations
            </p>
          )}

          {/* Validate button */}
          {!validated && (
            <Button onClick={handleValidate} disabled={!tripsFile || !masters}>
              Validate &amp; Preview
            </Button>
          )}

          {/* Preview table */}
          {validated && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 text-sm">
                  <CheckCircle2 className="size-4 text-green-500" />
                  <span className="font-semibold">{goodCount}</span> ready
                </div>
                {badCount > 0 && (
                  <div className="flex items-center gap-1.5 text-sm">
                    <XCircle className="size-4 text-destructive" />
                    <span className="font-semibold">{badCount}</span> with errors (will be skipped)
                  </div>
                )}
                <div className="ml-auto flex gap-2">
                  <Button variant="outline" size="sm" onClick={reset}>Start over</Button>
                  <Button
                    size="sm"
                    disabled={goodCount === 0 || importing}
                    onClick={handleImport}
                  >
                    {importing ? <><Loader2 className="size-4 animate-spin" /> Importing…</> : `Import ${goodCount} trip${goodCount !== 1 ? "s" : ""}`}
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[700px] text-xs">
                  <thead className="border-b border-border bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Row</th>
                      <th className="px-3 py-2 text-left font-medium">Trip Code</th>
                      <th className="px-3 py-2 text-left font-medium">Type</th>
                      <th className="px-3 py-2 text-left font-medium">Branch</th>
                      <th className="px-3 py-2 text-left font-medium">Vehicle / Transporter</th>
                      <th className="px-3 py-2 text-left font-medium">Driver</th>
                      <th className="px-3 py-2 text-left font-medium">Start Date</th>
                      <th className="px-3 py-2 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validated.map((v) => (
                      <tr
                        key={v.rowNum}
                        className={`border-b border-border/50 ${v.ok ? "" : "bg-destructive/5"}`}
                      >
                        <td className="px-3 py-2 text-muted-foreground">{v.rowNum}</td>
                        <td className="px-3 py-2 font-mono font-medium">{v.trip_code}</td>
                        <td className="px-3 py-2 capitalize">{v.ownership}</td>
                        <td className="px-3 py-2">{v.raw.branch_name || "—"}</td>
                        <td className="px-3 py-2">
                          {v.ownership === "own"
                            ? (v.raw.vehicle_number || "—")
                            : (v.raw.transporter_name || "—")}
                        </td>
                        <td className="px-3 py-2">{v.raw.driver_name || "—"}</td>
                        <td className="px-3 py-2">{v.start_date || "—"}</td>
                        <td className="px-3 py-2">
                          {v.ok ? (
                            <span className="flex items-center gap-1 text-green-600">
                              <CheckCircle2 className="size-3.5" /> Ready
                            </span>
                          ) : (
                            <span className="text-destructive" title={v.errors.join("\n")}>
                              <XCircle className="inline size-3.5 mr-1" />
                              {v.errors[0]}{v.errors.length > 1 ? ` +${v.errors.length - 1}` : ""}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {manifests.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {manifests.length} manifest row{manifests.length !== 1 ? "s" : ""} · {expenses.length} expense row{expenses.length !== 1 ? "s" : ""} · {otherIncome.length} other-income row{otherIncome.length !== 1 ? "s" : ""} will be linked by trip_code on import.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* README always visible at the bottom */}
      <ReadMe />
    </div>
  );

  // Standalone: wrap in full-page shell; embedded: render directly
  if (embedded) return content;

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-10">
      <div className="mx-auto max-w-4xl">
        {content}
      </div>
    </div>
  );
}
