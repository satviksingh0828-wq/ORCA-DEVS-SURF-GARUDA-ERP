import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Link2, Loader2, Lock, Plus, Printer, Save, Search, Trash2 } from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EntityPicker, type PickerOption } from "@/components/EntityPicker";
import { LocationPinPair } from "@/components/LocationPinPair";
import { LocationPicker } from "@/components/LocationPicker";
import { CsvIO } from "@/components/CsvIO";
import { normalizeImportedDate } from "@/lib/date-input";
import { TransporterQuickCreate } from "./TransporterQuickCreate";
import { DRIVER_CONFIG, TRANSPORTER_CONFIG, VEHICLE_CONFIG } from "@/components/masters/configs";
import { useLocations } from "@/lib/use-locations";
import { isDriverActive } from "@/lib/drivers";
import { useBranches } from "@/lib/use-branches";
import { useSession } from "@/lib/session";
import { isAdminLike } from "@/lib/roles";
import { serverCloseTrip } from "@/lib/close-trip";
import { serverSaveTripLines } from "@/lib/trip-actions";
import { serverRequireTripCheckpointVerification } from "@/lib/driver-checkpoint-status";
import { serverUpdateEwayBillPartB } from "@/lib/ewaybill-partb";
import { invalidManifestDates } from "@/lib/manifest-date-validation";
import { logAction } from "@/lib/log-actions";
import { ensureLocationForPin, ensureLocationsForPins } from "@/lib/ensure-location";
import {
  findEntry,
  inr,
  manifestCharges,
  newTripCode,
  num,
  type ContractLite,
  type EntryLite,
} from "@/lib/trip-calc";
import {
  fetchBranch,
  fetchCompany,
  fetchLocationMap,
  printInternalNote,
  printTripNote,
} from "@/lib/trip-note-pdf";

export type TripRow = {
  id?: string;
  trip_code: string;
  mode: "ROAD" | "RAIL" | "AIR" | "SHIP";
  ownership: string;
  branch_id: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  transporter_id: string | null;
  contract_id: string | null;
  start_location_id: string | null;
  end_location_id: string | null;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  odometer_start: string;
  odometer_end: string;
  third_party_vehicle_number: string;
  notes?: string | null;
  created_at?: string;
  reopened_at?: string | null;
};

export type ManifestRow = {
  id?: string;
  trip_id: string;
  manifest_number: string;
  manifest_date: string | null;
  source_id: string | null;
  from_location_id: string | null;
  from_pin_code: string;
  to_location_id: string | null;
  to_pin_code: string;
  weight_kg: string;
  quantity: string;
};

type LineRow = { id?: string; name: string; amount: string; note: string; advance?: string };

const DEFAULT_EXPENSES = [
  "Fuel Expense",
  "Toll Charges",
  "Toll Charges (paid in cash)",
  "Driver Bata",
  "Morning Exp.",
  "Night Exp.",
  "Sunday",
  "Parking Charges",
  "Dala Charges",
  "Unloading",
];

const THIRD_PARTY_EXPENSES = ["Hire Charges", "Toll Charges (paid in cash)"];
const ALL_EXPENSES = ["Hire Charges", ...DEFAULT_EXPENSES];

const DEFAULT_INCOMES = ["Approval Charge"];
const THIRD_PARTY_DEFAULT_INCOMES = DEFAULT_INCOMES;

function formatDateInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getBasicStartDateBounds() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  return {
    min: formatDateInput(yesterday),
    max: formatDateInput(today),
  };
}

function isBasicStartDateAllowed(startDate: string) {
  const { min, max } = getBasicStartDateBounds();
  return startDate === min || startDate === max;
}

export function emptyTrip(): TripRow {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    trip_code: newTripCode(),
    mode: "ROAD",
    ownership: "own",
    branch_id: null,
    vehicle_id: null,
    driver_id: null,
    transporter_id: null,
    contract_id: null,
    start_location_id: null,
    end_location_id: null,
    start_date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    start_time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    end_date: "",
    end_time: "",
    odometer_start: "",
    odometer_end: "",
    third_party_vehicle_number: "",
  };
}

// Tabs visible to all users
const TABS_ALL = [
  { id: "manifest", label: "LR" },
  { id: "income", label: "Other Income" },
  { id: "expense", label: "Expenses" },
  { id: "vehicle", label: "Vehicle" },
  { id: "driver", label: "Driver" },
  { id: "transporter", label: "Transporter" },
  { id: "summary", label: "Summary" },
] as const;

// Tabs visible to basic users only
const TABS_BASIC = [
  { id: "manifest", label: "LR" },
  { id: "income", label: "Other Income" },
  { id: "expense", label: "Expenses" },
  { id: "vehicle", label: "Vehicle" },
  { id: "driver", label: "Driver" },
  { id: "transporter", label: "Transporter" },
] as const;

type TabId = (typeof TABS_ALL)[number]["id"];

type AnyRow = Record<string, unknown> & { id: string };

export function TripForm({
  initial,
  onBack,
  onSaved,
}: {
  initial: TripRow;
  onBack: () => void;
  onSaved: () => void;
}) {
  const { user } = useSession();
  const isAdmin = isAdminLike(user?.role);
  const isBasic = user?.role === "basic";
  // Viewers may operate on existing trips; New trip creation remains blocked in Trips.tsx.
  const isViewer = false;
  const allowedBranchIds = isBasic ? (user?.branchIds ?? []) : null;

  const TABS = isBasic ? TABS_BASIC : TABS_ALL;
  const basicStartDateBounds = getBasicStartDateBounds();

  const [trip, setTrip] = useState<TripRow>({ mode: "ROAD", ...initial });
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [tab, setTab] = useState<TabId>("manifest");

  const [vehicles, setVehicles] = useState<AnyRow[]>([]);
  const [drivers, setDrivers] = useState<AnyRow[]>([]);
  const [transporters, setTransporters] = useState<AnyRow[]>([]);
  const [contracts, setContracts] = useState<AnyRow[]>([]);
  const [allEntries, setAllEntries] = useState<EntryLite[]>([]);
  const [showTransporterForm, setShowTransporterForm] = useState(false);

  const [manifests, setManifests] = useState<ManifestRow[]>([]);
  const [linkedLrIds, setLinkedLrIds] = useState<string[]>([]);
  const defaultIncomeList = DEFAULT_INCOMES;
  const [incomes, setIncomes] = useState<LineRow[]>(
    defaultIncomeList.map((name) => ({ name, amount: "", note: "" })),
  );
  const defaultExpenseList =
    trip.ownership === "third_party" ? THIRD_PARTY_EXPENSES : DEFAULT_EXPENSES;
  const [expenses, setExpenses] = useState<LineRow[]>(
    ALL_EXPENSES.map((name) => ({ name, amount: "", note: "" })),
  );

  const { locations } = useLocations();
  const allBranches = useBranches();
  const locationIdByPin = useMemo(
    () =>
      new Map(
        locations
          .filter((l) => (l.pin_code ?? "").trim() !== "")
          .map((l) => [(l.pin_code ?? "").trim(), l.id]),
      ),
    [locations],
  );
  const patch = (p: Partial<TripRow>) => setTrip((t) => ({ ...t, ...p }));

  async function loadMasters() {
    const [v, d, t, c, e] = await Promise.all([
      supabase.from("vehicles").select("*").order("registration_number"),
      supabase.from("drivers").select("*").order("full_name"),
      supabase.from("transporters").select("*").order("transporter_name"),
      supabase.from("contracts").select("*").eq("status", "active").order("contract_name"),
      supabase.from("contract_entries").select("*"),
    ]);
    setVehicles((v.data as AnyRow[]) ?? []);
    setDrivers(((d.data as AnyRow[]) ?? []).filter(isDriverActive));
    setTransporters((t.data as AnyRow[]) ?? []);
    setContracts((c.data as AnyRow[]) ?? []);
    setAllEntries((e.data as unknown as EntryLite[]) ?? []);
  }
  useEffect(() => {
    loadMasters();
  }, []);

  async function branchLocationId(branchId: string | null): Promise<string | null> {
    const pin = allBranches.find((b) => b.id === branchId)?.pin_code?.trim() ?? "";
    if (!/^\d{6}$/.test(pin)) return null;
    return locationIdByPin.get(pin) ?? ensureLocationForPin(pin);
  }

  async function applyBranchStartLocationDefault(branchId: string | null, force = false) {
    const locationId = await branchLocationId(branchId);
    if (!locationId) return;
    setTrip((t) => ({
      ...t,
      ...(force || !t.start_location_id ? { start_location_id: locationId } : {}),
    }));
  }

  // Auto-update trip_code prefix and start-location defaults when branch data becomes available
  // (covers basic users with a single auto-filled branch on new trips).
  useEffect(() => {
    if (!initial.id && trip.branch_id && allBranches.length > 0) {
      const prefix = allBranches.find((b) => b.id === trip.branch_id)?.trip_series_prefix ?? null;
      if (prefix) {
        setTrip((t) => ({ ...t, trip_code: newTripCode(prefix) }));
      }
      void applyBranchStartLocationDefault(trip.branch_id);
    }
    // Run only when allBranches first becomes available (or branch_id changes on new trips)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allBranches, trip.branch_id, locationIdByPin]);

  async function loadChildren(tripId: string) {
    const [m, i, e, lrLinks, approvalAdvance] = await Promise.all([
      supabase.from("trip_manifests").select("*").eq("trip_id", tripId).order("created_at"),
      supabase.from("trip_other_income").select("*").eq("trip_id", tripId).order("created_at"),
      supabase.from("trip_expenses").select("*").eq("trip_id", tripId).order("sort_order"),
      supabase.from("trip_lorry_receipts").select("lr_id").eq("trip_id", tripId),
      supabase
        .from("approval_charge_advances" as never)
        .select("advance")
        .eq("trip_id", tripId)
        .maybeSingle(),
    ]);
    if (m.error || i.error || e.error || approvalAdvance.error) {
      toast.error(
        m.error?.message ??
          i.error?.message ??
          e.error?.message ??
          approvalAdvance.error?.message ??
          "Could not load trip details",
      );
      return;
    }
    setManifests((m.data as unknown as ManifestRow[]) ?? []);
    setLinkedLrIds(((lrLinks.data as Array<{ lr_id: string }> | null) ?? []).map((row) => row.lr_id));
    const savedApprovalAdvance = String(
      ((approvalAdvance.data as { advance?: string | number } | null)?.advance ?? "") || "",
    );
    const incRows = (
      (i.data as unknown as { id: string; income_name: string; amount: string; note: string }[]) ??
      []
    ).map((r) => ({
      id: r.id,
      name: r.income_name,
      amount: r.amount ?? "",
      note: r.note ?? "",
    }));
    const incDefList = DEFAULT_INCOMES;
    setIncomes(
      incRows.length > 0 ? incRows : incDefList.map((name) => ({ name, amount: "", note: "" })),
    );
    const exp = (
      (e.data as unknown as { id: string; expense_name: string; amount: string; note: string }[]) ??
      []
    ).map((r) => ({
      id: r.id,
      name: r.expense_name,
      amount: r.amount ?? "",
      note: r.note ?? "",
      ...(r.expense_name?.trim().toLowerCase() === "hire charges"
        ? { advance: savedApprovalAdvance }
        : {}),
    }));
    const ownDefList = ALL_EXPENSES;
    setExpenses(exp.length > 0 ? exp : ownDefList.map((name) => ({ name, amount: "", note: "" })));
  }
  useEffect(() => {
    if (initial.id) loadChildren(initial.id);
  }, [initial.id]);

  const vehicle = vehicles.find((v) => v.id === trip.vehicle_id);
  const driver = drivers.find((d) => d.id === trip.driver_id);
  const transporter = transporters.find((t) => t.id === trip.transporter_id);

  const isOwn = trip.ownership === "own";
  const isRented = trip.ownership === "third_party";

  const distance =
    isOwn && trip.odometer_start && trip.odometer_end
      ? num(trip.odometer_end) - num(trip.odometer_start)
      : null;

  const lines = manifests.map((m) => {
    const mContract = contracts.find((c) => c.id === m.source_id) as
      (AnyRow & ContractLite) | undefined;
    const mEntries = allEntries.filter((e) => e.contract_id === m.source_id);
    return {
      m,
      ...manifestCharges(mContract, findEntry(mEntries, m), m),
    };
  });
  const manifestTotal = lines.reduce((s, l) => s + l.freight + l.loading + l.fixed, 0);
  const otherIncomeTotal = incomes.reduce((s, r) => s + num(r.amount), 0);
  const expenseTotal = expenses.reduce((s, r) => s + num(r.amount), 0);
  const totalWeight = manifests.reduce((s, m) => s + num(m.weight_kg), 0);
  const payload = vehicle ? num(vehicle.payload_capacity_kg) : 0;
  const deadWeight = isOwn && payload > 0 ? payload - totalWeight : null;

  async function saveTrip(e?: React.FormEvent): Promise<string | null> {
    e?.preventDefault();
    if (saving) return null;

    // ── Validation ──────────────────────────────────────────────────────────
    if (!trip.start_date) {
      toast.error("Start date is required");
      return null;
    }
    if (isBasic && !isBasicStartDateAllowed(trip.start_date)) {
      toast.error("Basic users can select only today or yesterday as the trip start date");
      return null;
    }
    if (!trip.start_time) {
      toast.error("Start time is required");
      return null;
    }
    if (!trip.branch_id) {
      toast.error("Branch is required");
      return null;
    }
    if (isOwn) {
      if (!trip.vehicle_id) {
        toast.error("Vehicle is required for own-vehicle trips");
        return null;
      }
      if (!trip.driver_id) {
        toast.error("Driver is required for own-vehicle trips");
        return null;
      }
      if (!trip.odometer_start) {
        toast.error("Odometer start is required for own-vehicle trips");
        return null;
      }
    }
    if (isRented && !trip.transporter_id) {
      toast.error("Transporter is required for rented trips — please select one before saving");
      return null;
    }

    setSaving(true);
    const { id, created_at, reopened_at, ...rest } = trip;
    void created_at;
    void reopened_at;
    let payload = rest;
    if (!id) {
      const branch = allBranches.find((candidate) => candidate.id === trip.branch_id);
      const prefix = String(branch?.trip_series_prefix ?? "").trim().toUpperCase();
      if (!/^[A-Z0-9]{1,10}$/.test(prefix)) {
        setSaving(false);
        toast.error("Trip Series Prefix is mandatory for the selected branch");
        return null;
      }
      const { data: generatedCode, error: numberError } = await supabase.rpc("next_branch_series_number", {
        p_branch_id: trip.branch_id,
        p_document_type: "trip",
        p_prefix: prefix,
        p_series_year: Number(String(trip.start_date).slice(0, 4)) || new Date().getFullYear(),
      });
      if (numberError || !generatedCode) {
        setSaving(false);
        toast.error(numberError?.message ?? "Could not generate trip number");
        return null;
      }
      payload = { ...rest, trip_code: generatedCode };
    }
    const res = id
      ? await supabase
          .from("trips")
          .update(rest as never)
          .eq("id", id)
          .select("id")
          .single()
      : await supabase
          .from("trips")
          .insert(payload as never)
          .select("id")
          .single();
    setSaving(false);
    if (res.error) {
      toast.error(res.error.message);
      return null;
    }
    const newId = (res.data as { id: string }).id;
    if (!id) setTrip((t) => ({ ...t, id: newId }));
    const isNew = !id;
    logAction(isNew ? "created" : "updated", "trip", {
      entityId: newId,
      entityLabel: String(payload.trip_code ?? trip.trip_code),
      details: { ownership: trip.ownership, branch_id: trip.branch_id ?? "" },
    });
    toast.success(id ? "Trip updated" : "Trip created");
    onSaved();
    return newId;
  }

  async function requireTripId(): Promise<string | null> {
    if (trip.id) return trip.id;
    const id = await saveTrip();
    return typeof id === "string" ? id : null;
  }

  async function saveLines(
    table: "trip_other_income" | "trip_expenses",
    rows: LineRow[],
    _nameCol: "income_name" | "expense_name",
    silent = false,
  ): Promise<boolean> {
    const tripId = await requireTripId();
    if (!tripId || !user?.sessionToken) {
      toast.error("Your session has expired. Please sign in again.");
      return false;
    }

    const incomeRows = (table === "trip_other_income" ? rows : incomes)
      .filter((row) => row.name.trim() !== "")
      .map((row) => ({ income_name: row.name, amount: row.amount, note: row.note }));
    const expenseRows = (table === "trip_expenses" ? rows : expenses)
      .filter((row) => row.name.trim() !== "")
      .map((row, index) => ({
        expense_name: row.name,
        amount: row.amount,
        note: row.note,
        sort_order: index,
      }));
    const hireChargeRow = expenseRows.find(
      (row) => row.expense_name.trim().toLowerCase() === "hire charges",
    );
    const amount = hireChargeRow ? num(hireChargeRow.amount) : 0;
    const advance = hireChargeRow
      ? num(
          (table === "trip_expenses" ? rows : expenses).find(
            (row) => row.name.trim().toLowerCase() === "hire charges",
          )?.advance ?? "",
        )
      : 0;
    const approval =
      trip.transporter_id && (amount > 0 || advance > 0)
        ? {
            trip_code: trip.trip_code,
            transporter_id: trip.transporter_id,
            advance,
            balance: Math.max(amount - advance, 0),
          }
        : null;

    try {
      await serverSaveTripLines({
        data: {
          sessionToken: user.sessionToken,
          tripId,
          income: incomeRows,
          expenses: expenseRows,
          approval,
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save trip details");
      return false;
    }
    logAction("updated", "trip", {
      entityId: tripId,
      entityLabel: trip.trip_code,
      details: { section: table },
    });
    if (!silent) toast.success("Saved");
    await loadChildren(tripId);
    return true;
  }

  async function handleClose() {
    if (!trip.id) return toast.error("Save the trip before closing it");

    if (isBasic) {
      const invalid = invalidManifestDates(trip.start_date, manifests);
      if (invalid.length > 0) {
        const labels = invalid.map(
          (manifest, index) => manifest.manifest_number?.trim() || `Manifest ${index + 1}`,
        );
        window.alert(
          `Manifest date outside allowed past-day limit\n\n${labels.join(", ")} ${invalid.length === 1 ? "has" : "have"} a missing date or a date older than the allowed two-day limit. Correct the manifest date, or ask an administrator to close this trip.`,
        );
        return;
      }
    }

    // ── Close validation ─────────────────────────────────────────────────────
    if (!trip.end_date) {
      toast.error("End date is required to close the trip");
      return;
    }
    if (!trip.end_time) {
      toast.error("End time is required to close the trip");
      return;
    }
    if (
      trip.end_date < trip.start_date ||
      (trip.end_date === trip.start_date && trip.end_time < trip.start_time)
    ) {
      toast.error("End date/time cannot be before start date/time");
      return;
    }
    if (isOwn) {
      const startOdo = Number(trip.odometer_start);
      const endOdo = Number(trip.odometer_end);
      if (!trip.odometer_end) {
        toast.error("Odometer end reading is required to close an own-vehicle trip");
        return;
      }
      if (!Number.isFinite(startOdo) || startOdo < 0 || !Number.isFinite(endOdo) || endOdo < 0) {
        toast.error("Odometer readings must be non-negative numbers");
        return;
      }
      if (endOdo < startOdo) {
        toast.error("Odometer end cannot be less than odometer start");
        return;
      }
    }
    if (isRented && !trip.third_party_vehicle_number?.trim()) {
      toast.error("Vehicle Number (3rd party) is required to close a rented trip");
      return;
    }

    // Save any unsaved changes first (e.g. end_date/end_time just entered).
    // Do not close if this write fails; otherwise closeTrip would snapshot stale dates.
    const savedId = await saveTrip();
    if (!savedId) return;
    // Silently flush both income and expense lines so closeTrip reads the latest values
    await saveLines("trip_other_income", incomes, "income_name", true);
    await saveLines("trip_expenses", expenses, "expense_name", true);

    if (
      !window.confirm(
        "Close this trip? A full snapshot is archived and the live trip is removed. This cannot be undone.",
      )
    )
      return;
    setClosing(true);
    try {
      if (isOwn) {
        if (!user?.sessionToken)
          throw new Error(
            "Your session has expired. Please sign in again before verifying driver checkpoints.",
          );
        await serverRequireTripCheckpointVerification({
          data: { sessionToken: user.sessionToken, tripId: trip.id },
        });
      }
      if (!user?.sessionToken)
        throw new Error("Your session has expired. Please sign in again before closing this trip.");
      await serverCloseTrip({ data: { sessionToken: user.sessionToken, tripId: trip.id } });
      logAction("closed", "trip", { entityId: trip.id, entityLabel: trip.trip_code });
      toast.success("Trip closed and archived");
      onSaved();
      onBack();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not close trip");
    } finally {
      setClosing(false);
    }
  }

  // Filter vehicles: by selected branch (if any), plus basic-user branch restriction
  const filteredVehicles = useMemo(() => {
    let list = vehicles;
    if (trip.branch_id) {
      list = list.filter((v) => v.branch_id === trip.branch_id);
    } else if (allowedBranchIds !== null) {
      list = list.filter(
        (v) => v.branch_id === null || allowedBranchIds.includes(v.branch_id as string),
      );
    }
    return list;
  }, [vehicles, trip.branch_id, allowedBranchIds]);

  // Filter drivers: by selected branch (if any), plus basic-user branch restriction
  const filteredDrivers = useMemo(() => {
    let list = drivers;
    if (trip.branch_id) {
      list = list.filter((d) => d.branch_id === trip.branch_id);
    } else if (allowedBranchIds !== null) {
      list = list.filter(
        (d) => d.branch_id === null || allowedBranchIds.includes(d.branch_id as string),
      );
    }
    return list;
  }, [drivers, trip.branch_id, allowedBranchIds]);

  // A basic user may only choose sources belonging to the trip's branch (or,
  // before a branch is selected, one of the branches assigned to the user).
  const selectableContracts = useMemo(() => {
    if (!isBasic) return contracts;
    if (trip.branch_id) {
      return contracts.filter((contract) => contract.branch_id === trip.branch_id);
    }
    return contracts.filter(
      (contract) =>
        typeof contract.branch_id === "string" &&
        (allowedBranchIds ?? []).includes(contract.branch_id),
    );
  }, [contracts, isBasic, trip.branch_id, allowedBranchIds]);

  const vehicleOpts: PickerOption[] = filteredVehicles.map((v) => ({
    id: v.id,
    label: String(v.registration_number ?? ""),
    sub: [v.manufacturer, v.model].filter(Boolean).join(" ") || undefined,
  }));
  const driverOpts: PickerOption[] = filteredDrivers.map((d) => ({
    id: d.id,
    label: String(d.full_name ?? ""),
    sub: String(d.mobile_number ?? "") || undefined,
  }));
  const filteredTransporters = isBasic
    ? transporters.filter((t) => {
        if (trip.branch_id) return t.branch_id === trip.branch_id;
        return typeof t.branch_id === "string" && (allowedBranchIds ?? []).includes(t.branch_id);
      })
    : transporters;
  const transporterOpts: PickerOption[] = filteredTransporters.map((t) => ({
    id: t.id,
    label: String(t.transporter_name ?? ""),
    sub: String(t.city ?? "") || undefined,
  }));
  // Branch options: basic users only see their allowed branches
  const branchOpts: PickerOption[] = (
    allowedBranchIds !== null
      ? allBranches.filter((b) => allowedBranchIds.includes(b.id))
      : allBranches
  ).map((b) => ({
    id: b.id,
    label: b.branch_name,
    sub: b.branch_type ?? undefined,
  }));

  async function handleTripNote(internal = false) {
    setGeneratingPdf(true);
    try {
      let tripQrDataUri: string | null = null;
      if (trip.ownership === "own" && trip.id) {
        const { data: qrData, error: qrError } = await supabase.rpc(
          "issue_driver_trip_qr" as never,
          { p_trip_id: trip.id } as never,
        );
        if (qrError) {
          toast.error(qrError.message || "Could not create the Trip QR Code");
          return;
        }
        const qr = qrData as unknown as { token?: string; trip_code?: string };
        if (!qr?.token) {
          toast.error("Supabase returned an invalid Trip QR Code response");
          return;
        }
        tripQrDataUri = await QRCode.toDataURL(
          JSON.stringify({ type: "garuda-driver-trip", token: qr.token, tripCode: qr.trip_code }),
          { width: 240, margin: 1, errorCorrectionLevel: "M" },
        );
      }

      // Resolve insurance number for the trip's start-date month (own vehicles only)
      let insuranceNumber: string | null = null;
      if (vehicle && trip.ownership === "own" && trip.start_date) {
        try {
          const { serverFetchInsuranceForMonth } = await import("@/lib/vehicle-coverage");
          const startD = new Date(trip.start_date);
          insuranceNumber = await serverFetchInsuranceForMonth({
            data: {
              userId: user?.id ?? "",
              vehicleId: vehicle.id as string,
              month: startD.getMonth() + 1,
              year: startD.getFullYear(),
            },
          });
        } catch {
          // Non-critical — proceed without insurance number
        }
      }

      const [company, branch, locMap] = await Promise.all([
        fetchCompany(),
        fetchBranch(trip.branch_id),
        fetchLocationMap(),
      ]);
      if (!company) {
        toast.error("Company details not configured — add them in Settings first.");
        return;
      }
      const fromLoc = locations.find((l) => l.id === trip.start_location_id);
      const toLoc = locations.find((l) => l.id === trip.end_location_id);
      const pdfData = {
        company,
        branch,
        trip: {
          id: trip.id ?? null,
          trip_code: trip.trip_code,
          start_date: trip.start_date,
          end_date: trip.end_date,
          start_time: trip.start_time,
          ownership: trip.ownership,
          from_location:
            ((fromLoc as Record<string, unknown>)?.location_name as string | null) ?? null,
          to_location: ((toLoc as Record<string, unknown>)?.location_name as string | null) ?? null,
        },
        vehicle: vehicle
          ? {
              registration_number: vehicle.registration_number,
              internal_code: vehicle.internal_code,
              nickname: vehicle.nickname,
              manufacturer: vehicle.manufacturer,
              model: vehicle.model,
              year_of_manufacture: vehicle.year_of_manufacture,
              fuel_type: vehicle.fuel_type,
              payload_capacity_kg: vehicle.payload_capacity_kg,
              purchase_date: vehicle.purchase_date,
              purchase_cost: vehicle.purchase_cost,
              insurance_number: insuranceNumber,
            }
          : null,
        driver: driver
          ? {
              driver_code: driver.driver_code,
              full_name: driver.full_name,
              guardian_name: driver.guardian_name,
              date_of_birth: driver.date_of_birth,
              gender: driver.gender,
              blood_group: driver.blood_group,
              mobile_number: driver.mobile_number,
              alternate_mobile: driver.alternate_mobile,
              licence_number: driver.licence_number,
              licence_type: driver.licence_type,
              licence_authority: driver.licence_authority,
              licence_issue_date: driver.licence_issue_date,
              licence_expiry_date: driver.licence_expiry_date,
            }
          : null,
        transporter: transporter
          ? {
              transporter_name: transporter.transporter_name,
              city: transporter.city,
              pan_number: transporter.pan_number,
              gst_number: transporter.gst_number,
            }
          : null,
        third_party_vehicle_number: trip.third_party_vehicle_number || null,
        trip_qr_data_uri: tripQrDataUri,
        manifests: manifests.map((m) => ({
          manifest_number: m.manifest_number,
          quantity: m.quantity,
          weight_kg: m.weight_kg,
          from_location_name: locMap.get(m.from_location_id ?? "") || m.from_pin_code || null,
          to_location_name: locMap.get(m.to_location_id ?? "") || m.to_pin_code || null,
        })),
      };
      if (internal) {
        await printInternalNote(pdfData, expenses);
      } else {
        await printTripNote(pdfData);
      }
    } finally {
      setGeneratingPdf(false);
    }
  }

  // Ensure selected tab exists in TABS (e.g. basic user was on "summary")
  const activeTab = (TABS as readonly { id: string; label: string }[]).find((t) => t.id === tab)
    ? tab
    : "manifest";

  return (
    <div className="animate-fade-up space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
          Back to trips
        </Button>
        <h2 className="text-lg font-semibold tracking-tight">{trip.trip_code}</h2>
        {trip.reopened_at ? (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            Reopened
          </span>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => handleTripNote(false)}
          disabled={generatingPdf}
          title="Generate Trip Note PDF"
        >
          {generatingPdf ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Printer className="size-4" />
          )}
          Trip Note
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleTripNote(true)}
          disabled={generatingPdf}
          title="Generate Internal Note PDF with expenses"
        >
          {generatingPdf ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Printer className="size-4" />
          )}
          Internal Note
        </Button>
        {!isViewer && (
          <Button onClick={() => saveTrip()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {trip.id ? "Update trip" : "Save trip"}
          </Button>
        )}
        {!isViewer && (
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={closing || !trip.id}
            title="Archive a snapshot of this trip and remove it from live records"
          >
            {closing ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
            {closing ? "Verifying checkpoints…" : "Close trip"}
          </Button>
        )}
      </div>

      <form onSubmit={saveTrip} className="surface-card space-y-5 p-6">
        <h3 className="text-sm font-semibold tracking-tight">Trip details</h3>
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Trip ID</Label>
            <Input className="h-10" value={trip.trip_code} readOnly />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Contract Ownership <span className="text-destructive">*</span>
            </Label>
            <Select
              value={trip.ownership}
              onValueChange={(v) => {
                const isThirdParty = v === "third_party";
                const newDefaultExpenses = ALL_EXPENSES;
                setExpenses(newDefaultExpenses.map((name) => ({ name, amount: "", note: "" })));
                const newDefaultIncomes = DEFAULT_INCOMES;
                setIncomes(newDefaultIncomes.map((name) => ({ name, amount: "", note: "" })));
                patch({
                  ownership: v,
                  ...(v === "own"
                    ? { transporter_id: null }
                    : { vehicle_id: null, driver_id: null, odometer_start: "", odometer_end: "" }),
                });
              }}
            >
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="own">Own vehicle</SelectItem>
                <SelectItem value="third_party">Rented (Third party)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Transport Mode <span className="text-destructive">*</span>
            </Label>
            <Select value={trip.mode ?? "ROAD"} onValueChange={(mode) => patch({ mode: mode as TripRow["mode"] })}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ROAD">Road</SelectItem>
                <SelectItem value="RAIL">Rail</SelectItem>
                <SelectItem value="AIR">Air</SelectItem>
                <SelectItem value="SHIP">Ship</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Own vehicle: vehicle + driver + odometer required */}
          {isOwn ? (
            <>
              <EntityPicker
                label="Vehicle (required)"
                value={trip.vehicle_id}
                options={vehicleOpts}
                onChange={(id) => patch({ vehicle_id: id })}
              />
              <EntityPicker
                label="Driver (required)"
                value={trip.driver_id}
                options={driverOpts}
                onChange={(id) => patch({ driver_id: id })}
              />
            </>
          ) : null}

          {/* Rented: transporter required; no vehicle/driver/odometer */}
          {isRented ? (
            <>
              <EntityPicker
                label="Transporter (required for rented)"
                value={trip.transporter_id}
                options={transporterOpts}
                onChange={(id) => patch({ transporter_id: id })}
                onAdd={() => setShowTransporterForm(true)}
                addLabel="Add new transporter"
              />
              <Field
                label="Vehicle Number (3rd party)"
                value={trip.third_party_vehicle_number}
                onChange={(v) => patch({ third_party_vehicle_number: v })}
              />
            </>
          ) : null}

          <EntityPicker
            label="Branch (required)"
            value={trip.branch_id}
            options={branchOpts}
            onChange={(id) => {
              const prefix = allBranches.find((b) => b.id === id)?.trip_series_prefix ?? null;
              // Clear vehicle/driver if they belong to a different branch
              const vehicleStillValid =
                !trip.vehicle_id ||
                vehicles.find((v) => v.id === trip.vehicle_id)?.branch_id === id;
              const driverStillValid =
                !trip.driver_id || drivers.find((d) => d.id === trip.driver_id)?.branch_id === id;
              patch({
                branch_id: id,
                // Regenerate trip code on new trips
                ...(!trip.id ? { trip_code: newTripCode(prefix) } : {}),
                ...(!vehicleStillValid ? { vehicle_id: null } : {}),
                ...(!driverStillValid ? { driver_id: null } : {}),
              });
              void applyBranchStartLocationDefault(id, true);
            }}
          />

          <LocationPicker
            label="Starting Location"
            value={trip.start_location_id}
            onChange={(id) => patch({ start_location_id: id })}
          />
          <LocationPicker
            label="Ending Location"
            value={trip.end_location_id}
            onChange={(id) => patch({ end_location_id: id })}
          />

          {/* Start date & time — required */}
          <Field
            label="Start Date (required)"
            type="date"
            value={trip.start_date}
            onChange={(v) => patch({ start_date: v })}
            min={isBasic ? basicStartDateBounds.min : undefined}
            max={isBasic ? basicStartDateBounds.max : undefined}
          />
          <Field
            label="Start Time (required)"
            type="time"
            value={trip.start_time}
            onChange={(v) => patch({ start_time: v })}
          />

          {/* End date & time — required to close for every trip */}
          <>
            <Field
              label="End Date (required to close)"
              type="date"
              value={trip.end_date}
              onChange={(v) => patch({ end_date: v })}
            />
            <Field
              label="End Time (required to close)"
              type="time"
              value={trip.end_time}
              onChange={(v) => patch({ end_time: v })}
            />
          </>

          {/* Odometer — only shown & required for own vehicle */}
          {isOwn ? (
            <>
              <Field
                label="Odometer Start (required)"
                type="number"
                value={trip.odometer_start}
                onChange={(v) => patch({ odometer_start: v })}
              />
              <Field
                label="Odometer End (required to close)"
                type="number"
                value={trip.odometer_end}
                onChange={(v) => patch({ odometer_end: v })}
              />
              <div className="rounded-xl bg-muted px-4 py-3 text-sm sm:col-span-2">
                Distance travelled:{" "}
                <span className="font-semibold">
                  {distance === null ? "—" : `${distance.toLocaleString("en-IN")} km`}
                </span>
              </div>
            </>
          ) : null}
        </div>
      </form>

      <div className="surface-card overflow-hidden">
        <div className="flex flex-wrap gap-1 border-b border-border p-2">
          {(TABS as readonly { id: string; label: string }[]).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as TabId)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                activeTab === t.id
                  ? "bg-primary-soft font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="p-6">
          {activeTab === "manifest" ? (
            <LrTab
              tripId={trip.id ?? null}
              branchId={trip.branch_id}
              tripCode={trip.trip_code}
              startPlace={locations.find((location) => location.id === trip.start_location_id)?.city || locations.find((location) => location.id === trip.start_location_id)?.location_name || ""}
              startLocationId={trip.start_location_id}
              startStateCode={allBranches.find((branch) => branch.id === trip.branch_id)?.state_code ?? ""}
              vehicleNumber={isOwn ? String(vehicle?.registration_number ?? "") : trip.third_party_vehicle_number}
              requireTripId={requireTripId}
              selectedIds={linkedLrIds}
              onSaved={(ids) => setLinkedLrIds(ids)}
              isViewer={isViewer}
            />
          ) : null}
          {activeTab === "income" ? (
            <LineTab
              title="Other income"
              nameLabel="Income name"
              rows={incomes}
              setRows={setIncomes}
              total={otherIncomeTotal}
              onSave={() => saveLines("trip_other_income", incomes, "income_name")}
              isViewer={isViewer}
            />
          ) : null}
          {activeTab === "expense" ? (
            <LineTab
              title="Expenses"
              nameLabel="Expense name"
              rows={expenses}
              setRows={setExpenses}
              total={expenseTotal}
              onSave={() => saveLines("trip_expenses", expenses, "expense_name")}
              isViewer={isViewer}
              showHireChargeFields={isRented}
            />
          ) : null}
          {activeTab === "vehicle" ? (
            <Details
              record={vehicle}
              sections={VEHICLE_CONFIG.sections}
              empty="No vehicle selected."
            />
          ) : null}
          {activeTab === "driver" ? (
            <Details
              record={driver}
              sections={DRIVER_CONFIG.sections}
              empty="No driver selected."
            />
          ) : null}
          {activeTab === "transporter" ? (
            <Details
              record={transporter}
              sections={TRANSPORTER_CONFIG.sections}
              empty="No transporter selected."
            />
          ) : null}
          {activeTab === "summary" && isAdmin ? (
            <Summary
              manifestTotal={manifestTotal}
              otherIncomeTotal={otherIncomeTotal}
              expenseTotal={expenseTotal}
              totalWeight={totalWeight}
              payload={payload}
              deadWeight={deadWeight}
              manifestCount={manifests.length}
              distance={distance}
            />
          ) : null}
        </div>
      </div>

      <TransporterQuickCreate
        open={showTransporterForm}
        onOpenChange={setShowTransporterForm}
        onCreated={async (id) => {
          await loadMasters();
          patch({ transporter_id: id });
        }}
      />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  min,
  max,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  min?: string;
  max?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </Label>
      <Input
        className="h-10"
        type={type}
        value={value ?? ""}
        min={min}
        max={max}
        required={required}
        aria-required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/* ---------------- LR tab ---------------- */

type LrOption = {
  id: string;
  lr_number: string;
  mode?: "ROAD" | "RAIL" | "AIR" | "SHIP";
  source?: { contract_name?: string } | null;
  transporter?: { transporter_name?: string } | null;
  calculated_income?: number | string | null;
  linked_trip_id?: string | null;
  linked_trip_code?: string | null;
  created_at?: string | null;
  part_b_updated_at?: string | null;
};

function LrTab({
  tripId,
  branchId,
  tripCode,
  startPlace,
  startLocationId,
  startStateCode,
  vehicleNumber,
  requireTripId,
  selectedIds,
  onSaved,
  isViewer = false,
}: {
  tripId: string | null;
  branchId: string | null;
  tripCode: string;
  startPlace: string;
  startLocationId: string | null;
  startStateCode: string;
  vehicleNumber: string;
  requireTripId: () => Promise<string | null>;
  selectedIds: string[];
  onSaved: (ids: string[]) => void;
  isViewer?: boolean;
}) {
  const { user } = useSession();
  const [rows, setRows] = useState<LrOption[]>([]);
  const [selected, setSelected] = useState<string[]>(selectedIds);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [date, setDate] = useState("");
  const [assignment, setAssignment] = useState("all");
  const [partBUpdating, setPartBUpdating] = useState<string | null>(null);
  useEffect(() => setSelected(selectedIds), [selectedIds]);
  useEffect(() => {
    void (async () => {
      const db = supabase as any;
      const [{ data, error }, { data: links, error: linkError }] = await Promise.all([
        db
          .from("lorry_receipts")
          .select("id,branch_id,lr_number,created_at,part_b_updated_at,mode,calculated_income,source:contracts(contract_name),transporter:transporters(transporter_name)")
          .eq("branch_id", branchId)
          .order("created_at", { ascending: false }),
        db.from("trip_lorry_receipts").select("lr_id,trip_id,trip:trips(trip_code)"),
      ]);
      if (error || linkError) {
        toast.error(error?.message ?? linkError?.message ?? "Could not load LR links");
        return;
      }
      const linkByLr = new Map(
        ((links ?? []) as Array<{ lr_id: string; trip_id: string; trip?: { trip_code?: string } | null }>).map((link) => [
          link.lr_id,
          { tripId: link.trip_id, tripCode: link.trip?.trip_code ?? link.trip_id },
        ]),
      );
      setRows(
        ((data ?? []) as LrOption[]).map((row) => ({
          ...row,
          linked_trip_id: linkByLr.get(row.id)?.tripId ?? null,
          linked_trip_code: linkByLr.get(row.id)?.tripCode ?? null,
        })),
      );
    })();
  }, [branchId]);
  async function save() {
    const id = await requireTripId();
    if (!id) return;
    setSaving(true);
    const db = supabase as any;
    const { error: deleteError } = await db.from("trip_lorry_receipts").delete().eq("trip_id", id);
    if (!deleteError && selected.length) {
      const { error } = await db.from("trip_lorry_receipts").insert(selected.map((lrId) => ({ trip_id: id, lr_id: lrId })));
      if (error) toast.error(error.message);
      else { onSaved(selected); toast.success("LR linked to trip"); }
    } else if (deleteError) toast.error(deleteError.message);
    else { onSaved([]); toast.success("Trip LR links updated"); }
    setSaving(false);
  }
  async function updatePartB(row: LrOption) {
    if (!branchId) return toast.error("Select a trip branch first");
    if (!user?.sessionToken) return toast.error("Your session has expired. Please sign in again.");
    if (!/^\d+$/.test(startStateCode) || Number(startStateCode) < 1) return toast.error("Set a valid branch state code before updating Part-B");
    if (!vehicleNumber.trim()) return toast.error("Set the trip vehicle number before updating Part-B");
    setPartBUpdating(row.id);
    try {
      const db = supabase as any;
      let resolvedStartPlace = startPlace.trim();
      if (!resolvedStartPlace && startLocationId) {
        const { data: location, error: locationError } = await db.from("locations").select("location_name,city").eq("id", startLocationId).maybeSingle();
        if (locationError) throw locationError;
        resolvedStartPlace = String(location?.city || location?.location_name || "").trim();
      }
      if (!resolvedStartPlace) throw new Error("Set the trip starting location before updating Part-B");
      const { data: linked, error } = await db.from("lr_shipments").select("shipment:shipments(eway_bill_number)").eq("lr_id", row.id);
      if (error) throw error;
      const ewayBillNumbers = ((linked ?? []) as Array<{ shipment?: { eway_bill_number?: string } | null }>)
        .map((item) => String(item.shipment?.eway_bill_number ?? ""))
        .filter((number) => /^\d{12}$/.test(number));
      if (!ewayBillNumbers.length) throw new Error("No valid E-Way Bills are linked to this LR");
      const created = new Date(row.created_at ?? "");
      const transDocDate = Number.isNaN(created.getTime()) ? "" : `${String(created.getDate()).padStart(2, "0")}/${String(created.getMonth() + 1).padStart(2, "0")}/${created.getFullYear()}`;
      if (!transDocDate) throw new Error("LR date is missing");
      const result = await serverUpdateEwayBillPartB({
        data: {
          token: user.sessionToken,
          branchId,
          ewayBillNumbers,
          fromPlace: resolvedStartPlace,
          fromState: Number(startStateCode),
          vehicleNo: vehicleNumber.trim().toUpperCase(),
          transMode: "1",
          transDocNo: row.lr_number,
          transDocDate,
        },
      });
      const { error: markError } = await db.from("lorry_receipts").update({ part_b_updated_at: new Date().toISOString() }).eq("id", row.id);
      if (markError) throw markError;
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, part_b_updated_at: new Date().toISOString() } : item));
      toast.success(`Part-B updated for ${result.updated} E-Way Bill${result.updated === 1 ? "" : "s"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update Part-B");
    }
    setPartBUpdating(null);
  }
  const total = rows.filter((row) => selected.includes(row.id)).reduce((sum, row) => sum + num(row.calculated_income), 0);
  return <div className="space-y-4">
    <div className="flex items-center gap-2"><div><h3 className="text-sm font-semibold tracking-tight">Linked LR</h3><p className="text-xs text-muted-foreground">Select an LR to link it to this trip. Source, transporter, mode and calculated income come from the LR.</p></div>{!isViewer && <Button type="button" size="sm" onClick={() => void save()} disabled={saving} className="ml-auto"><Link2 className="size-4" />{saving ? "Saving…" : "Save links"}</Button>}</div>
    <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-3">
      <div className="relative min-w-56 flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search LR number" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <Input className="w-44" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="LR date" />
      <Select value={assignment} onValueChange={setAssignment}><SelectTrigger className="w-40"><SelectValue placeholder="Assignment" /></SelectTrigger><SelectContent><SelectItem value="all">All LR</SelectItem><SelectItem value="assigned">Assigned</SelectItem><SelectItem value="unsigned">Unsigned</SelectItem></SelectContent></Select>
    </div>
    <div className="space-y-2">{rows.length === 0 ? <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">No LR records found for this branch.</p> : rows.filter((row) => (!search.trim() || row.lr_number.toLowerCase().includes(search.trim().toLowerCase())) && (!date || String((row as any).created_at ?? "").slice(0, 10) === date) && (assignment === "all" || (assignment === "assigned" ? Boolean(row.linked_trip_id) : !row.linked_trip_id))).map((row) => {
      const linkedToAnotherTrip = Boolean(row.linked_trip_id && !selected.includes(row.id));
      return <div key={row.id} className={`flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3 ${linkedToAnotherTrip ? "opacity-60" : ""}`}><label className={`flex min-w-0 flex-1 items-center gap-3 ${linkedToAnotherTrip ? "cursor-not-allowed" : "cursor-pointer"}`}><input type="checkbox" checked={selected.includes(row.id)} disabled={isViewer || linkedToAnotherTrip} onChange={(event) => setSelected((old) => event.target.checked ? [...old, row.id] : old.filter((id) => id !== row.id))} /><span className="grid min-w-0 flex-1 gap-1 sm:grid-cols-2 lg:grid-cols-6"><strong>{row.lr_number}</strong><span>{row.source?.contract_name ?? "—"}</span><span>{row.transporter?.transporter_name ?? "—"}</span><span>{row.mode ?? "ROAD"}</span><span className="text-right font-medium">{inr(num(row.calculated_income))}</span><span className="text-right text-muted-foreground">Trip: {row.linked_trip_code ?? "Not linked"}</span></span></label>{selected.includes(row.id) ? (row.part_b_updated_at ? <span className="shrink-0 text-xs text-emerald-600">Part-B updated</span> : <Button type="button" size="sm" variant="outline" disabled={isViewer || linkedToAnotherTrip || partBUpdating === row.id} onClick={() => void updatePartB(row)}>{partBUpdating === row.id ? "Updating…" : "Update Part-B"}</Button>) : null}</div>;
    })}</div>
    <div className="flex justify-end border-t border-border pt-3 text-sm font-semibold">Linked LR income: {inr(total)}</div>
  </div>;
}

/* ---------------- Manifest tab ---------------- */

type Line = {
  m: ManifestRow;
  freight: number;
  loading: number;
  fixed: number;
  matched: boolean;
};

function emptyManifest(tripId: string): ManifestRow {
  return {
    trip_id: tripId,
    manifest_number: "",
    manifest_date: null,
    source_id: null,
    from_location_id: null,
    from_pin_code: "",
    to_location_id: null,
    to_pin_code: "",
    weight_kg: "",
    quantity: "",
  };
}

function ManifestTab({
  tripId,
  requireTripId,
  manifests,
  lines,
  total,
  locations,
  startLocationId,
  reload,
  isAdmin,
  isViewer = false,
  otherIncomeTotal,
  expenseTotal,
  totalWeight,
  contracts,
}: {
  tripId: string | null;
  requireTripId: () => Promise<string | null>;
  manifests: ManifestRow[];
  lines: Line[];
  total: number;
  locations: { id: string; location_name: string; pin_code: string | null }[];
  /** Trip's start location — pre-filled as "From" on new manifests */
  startLocationId: string | null;
  reload: (tripId: string) => void;
  isAdmin: boolean;
  isViewer?: boolean;
  otherIncomeTotal: number;
  expenseTotal: number;
  totalWeight: number;
  contracts: AnyRow[];
}) {
  const [editing, setEditing] = useState<ManifestRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [validationAttempted, setValidationAttempted] = useState(false);

  const csvColumns = [
    "Cnmt No.",
    "Date",
    "source",
    "from_location",
    "from_pin_code",
    "to_location",
    "to_pin_code",
    "weight_kg",
    "quantity",
  ];
  const nameById = useMemo(
    () => new Map(locations.map((l) => [l.id, l.location_name])),
    [locations],
  );
  const idByName = useMemo(
    () => new Map(locations.map((l) => [l.location_name.toLowerCase(), l.id])),
    [locations],
  );
  const idByPin = useMemo(
    () =>
      new Map(
        locations
          .filter((l) => (l.pin_code ?? "").trim() !== "")
          .map((l) => [(l.pin_code ?? "").trim(), l.id]),
      ),
    [locations],
  );
  const sourceNameById = useMemo(
    () => new Map(contracts.map((c) => [c.id as string, String(c.contract_name ?? "")])),
    [contracts],
  );
  const sourceIdByName = useMemo(
    () =>
      new Map(contracts.map((c) => [String(c.contract_name ?? "").toLowerCase(), c.id as string])),
    [contracts],
  );

  const csvRows = manifests.map((m) => ({
    "Cnmt No.": m.manifest_number,
    Date: m.manifest_date ?? "",
    source: m.source_id ? (sourceNameById.get(m.source_id) ?? "") : "",
    from_location: nameById.get(m.from_location_id ?? "") ?? "",
    from_pin_code: m.from_pin_code,
    to_location: nameById.get(m.to_location_id ?? "") ?? "",
    to_pin_code: m.to_pin_code,
    weight_kg: m.weight_kg,
    quantity: m.quantity,
  }));

  async function openNew() {
    const id = await requireTripId();
    if (!id) return;
    // Pre-fill "From" with the trip's start location so the user doesn't have
    // to re-enter it for every manifest on the same trip.
    const startLoc = startLocationId ? locations.find((l) => l.id === startLocationId) : null;
    setValidationAttempted(false);
    setEditing({
      ...emptyManifest(id),
      from_location_id: startLocationId ?? null,
      from_pin_code: startLoc?.pin_code ?? "",
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;

    const missingDate = !editing.manifest_date?.trim();
    const missingSource = !editing.source_id?.trim();
    if (missingDate || missingSource) {
      setValidationAttempted(true);
      toast.error("Manifest date and source are required before saving.");
      return;
    }

    setValidationAttempted(false);
    setSaving(true);
    const { id, ...rest } = editing;
    const res = id
      ? await supabase
          .from("trip_manifests")
          .update(rest as never)
          .eq("id", id)
      : await supabase.from("trip_manifests").insert(rest as never);
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    toast.success(id ? "Manifest updated" : "Manifest added");
    setEditing(null);
    reload(rest.trip_id);
  }

  async function remove(id: string) {
    const { error } = await supabase.from("trip_manifests").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (tripId) reload(tripId);
  }

  async function onImport(rows: Record<string, string>[]) {
    const id = await requireTripId();
    if (!id) return { inserted: 0, failed: rows.length };

    // Collect all pins from the CSV and auto-create any that are missing
    const allPins = rows.flatMap((r) => [
      (r.from_pin_code ?? "").trim(),
      (r.to_pin_code ?? "").trim(),
    ]);
    const pinToId = await ensureLocationsForPins(allPins, idByPin);

    const invalidRows = rows.filter((r) => {
      const manifestDate = normalizeImportedDate(r.Date ?? r.date ?? r.manifest_date);
      const sourceName = (r.source ?? "").trim().toLowerCase();
      const sourceId = sourceName ? sourceIdByName.get(sourceName) : null;
      return !manifestDate || !sourceId;
    });
    if (invalidRows.length > 0) {
      toast.error("Every imported manifest must include a valid date and source.");
      return { inserted: 0, failed: rows.length };
    }

    const payload = rows.map((r) => ({
      trip_id: id,
      manifest_number: r["Cnmt No."] ?? r.manifest_number ?? "",
      manifest_date: normalizeImportedDate(r.Date ?? r.date ?? r.manifest_date) || null,
      source_id: r.source ? (sourceIdByName.get(r.source.trim().toLowerCase()) ?? null) : null,
      from_location_id:
        idByName.get((r.from_location ?? "").toLowerCase()) ??
        pinToId.get((r.from_pin_code ?? "").trim()) ??
        null,
      from_pin_code: r.from_pin_code ?? "",
      to_location_id:
        idByName.get((r.to_location ?? "").toLowerCase()) ??
        pinToId.get((r.to_pin_code ?? "").trim()) ??
        null,
      to_pin_code: r.to_pin_code ?? "",
      weight_kg: r.weight_kg ?? "",
      quantity: r.quantity ?? "",
    }));
    const { error } = await supabase.from("trip_manifests").insert(payload as never);
    if (error) {
      toast.error(error.message);
      return { inserted: 0, failed: rows.length };
    }
    reload(id);
    return { inserted: payload.length, failed: 0 };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {!isViewer && (
          <Button type="button" size="sm" onClick={openNew}>
            <Plus className="size-4" />
            Create manifest
          </Button>
        )}
        <div className={isViewer ? "" : "ml-auto"}>
          <CsvIO
            entityLabel="Manifests"
            filename="manifests"
            columns={csvColumns}
            rows={csvRows}
            onImport={onImport}
            readOnly={isViewer}
          />
        </div>
      </div>

      {manifests.length === 0 ? (
        <p className="rounded-xl bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
          No manifests yet. Freight, loading and fixed charges are calculated from the source
          selected on each manifest line.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: isAdmin ? 1100 : 800 }}>
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">Cnmt No.</th>
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3">From</th>
                <th className="py-2 pr-3">To</th>
                <th className="py-2 pr-3 text-right">Weight</th>
                <th className="py-2 pr-3 text-right">Qty</th>
                <th className="py-2 pr-3 text-right">Wtd. Income</th>
                <th className="py-2 pr-3 text-right">Wtd. Expense</th>
                {isAdmin ? (
                  <>
                    <th className="py-2 pr-3 text-right">Freight</th>
                    <th className="py-2 pr-3 text-right">Loading</th>
                    <th className="py-2 pr-3 text-right">Gross</th>
                    <th className="py-2 pr-3 text-right">Net</th>
                  </>
                ) : null}
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const wt = num(l.m.weight_kg);
                const wi = totalWeight === 0 ? 0 : (otherIncomeTotal / totalWeight) * wt;
                const we = totalWeight === 0 ? 0 : (expenseTotal / totalWeight) * wt;
                const gross = l.freight + l.loading + l.fixed;
                const net = gross + wi - we;
                return (
                  <tr key={l.m.id} className="border-b border-border/60">
                    <td className="py-2 pr-3 font-medium">{l.m.manifest_number || "—"}</td>
                    <td className="py-2 pr-3">{l.m.manifest_date || "—"}</td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {l.m.source_id ? (sourceNameById.get(l.m.source_id) ?? "—") : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      {nameById.get(l.m.from_location_id ?? "") ?? (l.m.from_pin_code || "—")}
                    </td>
                    <td className="py-2 pr-3">
                      {nameById.get(l.m.to_location_id ?? "") ?? (l.m.to_pin_code || "—")}
                    </td>
                    <td className="py-2 pr-3 text-right">{l.m.weight_kg || "—"}</td>
                    <td className="py-2 pr-3 text-right">{l.m.quantity || "—"}</td>
                    <td className="py-2 pr-3 text-right">{inr(wi)}</td>
                    <td className="py-2 pr-3 text-right">{inr(we)}</td>
                    {isAdmin ? (
                      <>
                        <td className="py-2 pr-3 text-right">{inr(l.freight)}</td>
                        <td className="py-2 pr-3 text-right">{inr(l.loading)}</td>
                        <td className="py-2 pr-3 text-right font-semibold">{inr(gross)}</td>
                        <td className="py-2 pr-3 text-right font-semibold">{inr(net)}</td>
                      </>
                    ) : null}
                    <td className="py-2 text-right">
                      {!isViewer && (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing(l.m)}
                          >
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => l.m.id && remove(l.m.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td
                  colSpan={7}
                  className="py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Totals
                </td>
                <td className="py-3 pr-3 text-right font-semibold">{inr(otherIncomeTotal)}</td>
                <td className="py-3 pr-3 text-right font-semibold">{inr(expenseTotal)}</td>
                {isAdmin ? (
                  <>
                    <td />
                    <td />
                    <td className="py-3 pr-3 text-right font-semibold">{inr(total)}</td>
                    <td className="py-3 pr-3 text-right font-semibold">
                      {inr(total + otherIncomeTotal - expenseTotal)}
                    </td>
                  </>
                ) : null}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit manifest" : "New manifest"}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <form onSubmit={save} className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs font-medium text-muted-foreground">Cnmt No.</Label>
                <Input
                  className="h-10"
                  value={editing.manifest_number}
                  onChange={(e) => setEditing({ ...editing, manifest_number: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Field
                  label="Date"
                  type="date"
                  value={editing.manifest_date ?? ""}
                  required
                  onChange={(v) => setEditing({ ...editing, manifest_date: v || null })}
                />
                {validationAttempted && !editing.manifest_date?.trim() ? (
                  <p className="text-xs text-destructive" role="alert">
                    Manifest date is required.
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs font-medium text-muted-foreground">Source *</Label>
                <Select
                  value={editing.source_id ?? ""}
                  onValueChange={(v) => setEditing({ ...editing, source_id: v || null })}
                >
                  <SelectTrigger
                    className="h-10"
                    aria-required="true"
                    aria-invalid={validationAttempted && !editing.source_id?.trim()}
                  >
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    {contracts.map((c) => (
                      <SelectItem key={c.id as string} value={c.id as string}>
                        {String(c.contract_name ?? "")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {validationAttempted && !editing.source_id?.trim() ? (
                  <p className="text-xs text-destructive" role="alert">
                    Source is required.
                  </p>
                ) : null}
              </div>
              <LocationPinPair
                label="From"
                locationId={editing.from_location_id}
                pinCode={editing.from_pin_code}
                onChange={(n) =>
                  setEditing({
                    ...editing,
                    from_location_id: n.location_id,
                    from_pin_code: n.pin_code,
                  })
                }
              />
              <LocationPinPair
                label="To"
                locationId={editing.to_location_id}
                pinCode={editing.to_pin_code}
                onChange={(n) =>
                  setEditing({
                    ...editing,
                    to_location_id: n.location_id,
                    to_pin_code: n.pin_code,
                  })
                }
              />
              <Field
                label="Weight (kg)"
                type="number"
                value={editing.weight_kg}
                onChange={(v) => setEditing({ ...editing, weight_kg: v })}
              />
              <Field
                label="Quantity (units)"
                type="number"
                value={editing.quantity}
                onChange={(v) => setEditing({ ...editing, quantity: v })}
              />
              <DialogFooter className="sm:col-span-2">
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                  Save manifest
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------- Income / expense tab ---------------- */

function LineTab({
  title,
  nameLabel,
  rows,
  setRows,
  total,
  onSave,
  isViewer = false,
  showHireChargeFields = false,
}: {
  title: string;
  nameLabel: string;
  rows: LineRow[];
  setRows: (r: LineRow[]) => void;
  total: number;
  onSave: () => void;
  isViewer?: boolean;
  showHireChargeFields?: boolean;
}) {
  const update = (i: number, p: Partial<LineRow>) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {!isViewer && (
          <>
            <Button type="button" size="sm" onClick={onSave}>
              <Save className="size-4" />
              Save
            </Button>
          </>
        )}
      </div>

      <div className="space-y-3">
        {rows.map((r, i) => {
          const isHireCharge =
            showHireChargeFields && r.name.trim().toLowerCase() === "hire charges";
          const balance = Math.max(num(r.amount) - num(r.advance ?? ""), 0);
          return (
            <div
              key={i}
              className="grid grid-cols-1 items-end gap-3 rounded-xl bg-muted/50 p-3 sm:grid-cols-[1.2fr_0.8fr_1.4fr_auto]"
            >
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">{nameLabel}</Label>
                <Input
                  className="h-10"
                  value={r.name}
                  readOnly
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Amount (₹)</Label>
                <Input
                  className="h-10"
                  type="number"
                  value={r.amount}
                  readOnly={isViewer}
                  onChange={(e) => !isViewer && update(i, { amount: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Note</Label>
                <Input
                  className="h-10"
                  value={r.note}
                  readOnly={isViewer}
                  onChange={(e) => !isViewer && update(i, { note: e.target.value })}
                />
              </div>

              {isHireCharge ? (
                <div className="grid grid-cols-1 gap-3 sm:col-span-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Advance (₹)</Label>
                    <Input
                      className="h-10"
                      type="number"
                      value={r.advance ?? ""}
                      readOnly={isViewer}
                      onChange={(e) => !isViewer && update(i, { advance: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Balance (₹)</Label>
                    <Input className="h-10" value={balance} readOnly />
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end border-t border-border pt-3 text-sm font-semibold">
        Total: {inr(total)}
      </div>
    </div>
  );
}

/* ---------------- Detail tabs ---------------- */

function Details({
  record,
  sections,
  empty,
}: {
  record: Record<string, unknown> | undefined;
  sections: { title: string; fields: { key: string; label: string }[] }[];
  empty: string;
}) {
  if (!record) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-5">
      {sections.map((s) => {
        const filled = s.fields.filter((f) => String(record[f.key] ?? "").trim() !== "");
        if (filled.length === 0) return null;
        return (
          <section key={s.title}>
            <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {s.title}
            </h4>
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              {filled.map((f) => (
                <div key={f.key} className="flex justify-between gap-4 text-sm">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="text-right font-medium">{String(record[f.key])}</dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </div>
  );
}

function ContractDetails({
  contract,
  entryCount,
  monthlyCharges,
}: {
  contract: (Record<string, unknown> & ContractLite) | undefined;
  entryCount: number;
  monthlyCharges: number;
}) {
  if (!contract) return <p className="text-sm text-muted-foreground">No contract selected.</p>;
  const monthly = num(contract.fixed_monthly_charge as unknown);
  const yearly = num(contract.fixed_yearly_charge as unknown);
  const monthlyEquivalent = monthly + yearly / 12;

  const rows: [string, string][] = [
    ["Contract name", contract.contract_name],
    ["Company", String(contract.company_name ?? "")],
    ["GSTIN", String(contract.gstin ?? "")],
    ["Rate entries (routes)", String(entryCount)],
    ...(monthlyEquivalent > 0
      ? ([["Monthly fixed cost", inr(monthlyEquivalent)]] as [string, string][])
      : []),
  ];
  void monthlyCharges;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {rows
        .filter(([, v]) => v.trim() !== "")
        .map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 text-sm">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
    </dl>
  );
}

function Summary({
  manifestTotal,
  otherIncomeTotal,
  expenseTotal,
  totalWeight,
  payload,
  deadWeight,
  manifestCount,
  distance,
}: {
  manifestTotal: number;
  otherIncomeTotal: number;
  expenseTotal: number;
  totalWeight: number;
  payload: number;
  deadWeight: number | null;
  manifestCount: number;
  distance: number | null;
}) {
  const income = manifestTotal + otherIncomeTotal;
  const net = income - expenseTotal;
  const cards: { label: string; value: string; strong?: boolean }[] = [
    { label: "Manifests", value: String(manifestCount) },
    { label: "Manifest income", value: inr(manifestTotal) },
    { label: "Other income", value: inr(otherIncomeTotal) },
    { label: "Total income", value: inr(income), strong: true },
    { label: "Total expense", value: inr(expenseTotal) },
    { label: "Net income", value: inr(net), strong: true },
    { label: "Total weight", value: `${totalWeight.toLocaleString("en-IN")} kg` },
    {
      label: "Vehicle payload",
      value: payload > 0 ? `${payload.toLocaleString("en-IN")} kg` : "—",
    },
    {
      label: "Dead weight",
      value: deadWeight === null ? "—" : `${deadWeight.toLocaleString("en-IN")} kg`,
    },
    {
      label: "Distance",
      value: distance === null ? "—" : `${distance.toLocaleString("en-IN")} km`,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl bg-muted/60 p-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{c.label}</p>
          <p className={`mt-1 ${c.strong ? "text-lg font-semibold" : "text-base font-medium"}`}>
            {c.value}
          </p>
        </div>
      ))}
    </div>
  );
}
