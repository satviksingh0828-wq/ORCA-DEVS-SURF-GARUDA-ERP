import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Clock3,
  Link2,
  Loader2,
  Plus,
  Printer,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { serverSaveTripLines } from "@/lib/trip-actions";
import { serverUpdateEwayBillPartB } from "@/lib/ewaybill-partb";
import { logAction } from "@/lib/log-actions";
import { ensureLocationForPin, ensureLocationsForPins } from "@/lib/ensure-location";
import { lookupIndiaPin } from "@/lib/india-post";
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
  rental_id: string | null;
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
  part_b_locked_at?: string | null;
  part_b_locked_by?: string | null;
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

const THIRD_PARTY_EXPENSES = ["Hire Charges"];
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
    rental_id: null,
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
  { id: "movement", label: "Movements" },
  { id: "income", label: "Other Income" },
  { id: "expense", label: "Expenses" },
  { id: "vehicle", label: "Vehicle" },
  { id: "driver", label: "Driver" },
  { id: "transporter", label: "Rental" },
  { id: "summary", label: "Summary" },
] as const;

// Tabs visible to basic users only
const TABS_BASIC = [
  { id: "movement", label: "Movements" },
  { id: "income", label: "Other Income" },
  { id: "expense", label: "Expenses" },
  { id: "vehicle", label: "Vehicle" },
  { id: "driver", label: "Driver" },
  { id: "transporter", label: "Rental" },
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

  const [trip, setTrip] = useState<TripRow>({ ...initial, mode: initial.mode ?? "ROAD" });
  const [saving, setSaving] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [tab, setTab] = useState<TabId>("movement");

  const [vehicles, setVehicles] = useState<AnyRow[]>([]);
  const [drivers, setDrivers] = useState<AnyRow[]>([]);
  const [transporters, setTransporters] = useState<AnyRow[]>([]);
  const [rentals, setRentals] = useState<AnyRow[]>([]);
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
    (trip.ownership === "third_party" ? THIRD_PARTY_EXPENSES : DEFAULT_EXPENSES).map((name) => ({
      name,
      amount: "",
      note: "",
    })),
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
    const [v, d, t, r, c, e] = await Promise.all([
      supabase.from("vehicles").select("*").order("registration_number"),
      supabase.from("drivers").select("*").order("full_name"),
      supabase.from("transporters").select("*").order("transporter_name"),
      supabase.from("rentals").select("*").order("rental_name"),
      supabase.from("contracts").select("*").eq("status", "active").order("contract_name"),
      supabase.from("contract_entries").select("*"),
    ]);
    setVehicles((v.data as AnyRow[]) ?? []);
    setDrivers(((d.data as AnyRow[]) ?? []).filter(isDriverActive));
    setTransporters((t.data as AnyRow[]) ?? []);
    setRentals((r.data as AnyRow[]) ?? []);
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
    setLinkedLrIds(
      ((lrLinks.data as Array<{ lr_id: string }> | null) ?? []).map((row) => row.lr_id),
    );
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
    const allowedExpenses =
      trip.ownership === "third_party" ? THIRD_PARTY_EXPENSES : DEFAULT_EXPENSES;
    const allowedExpenseNames = new Set(allowedExpenses.map((name) => name.trim().toLowerCase()));
    const filteredExpenses = exp.filter((row) =>
      allowedExpenseNames.has(row.name.trim().toLowerCase()),
    );
    setExpenses(
      filteredExpenses.length > 0
        ? filteredExpenses
        : allowedExpenses.map((name) => ({ name, amount: "", note: "" })),
    );
  }
  useEffect(() => {
    if (initial.id) loadChildren(initial.id);
  }, [initial.id]);

  const vehicle = vehicles.find((v) => v.id === trip.vehicle_id);
  const driver = drivers.find((d) => d.id === trip.driver_id);
  const transporter = transporters.find((t) => t.id === trip.transporter_id);
  const rental = rentals.find((r) => r.id === trip.rental_id);

  const isOwn = trip.ownership === "own";
  const isRented = trip.ownership === "third_party";

  const distance =
    isOwn && trip.odometer_start && trip.odometer_end
      ? num(trip.odometer_end) - num(trip.odometer_start)
      : null;

  const lines = manifests.map((m) => {
    const mContract = contracts.find((c) => c.id === m.source_id) as
      | (AnyRow & ContractLite)
      | undefined;
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
    if (isRented && !trip.rental_id) {
      toast.error("Rental is required for rented trips — please select one before saving");
      return null;
    }

    setSaving(true);
    const { id, created_at, reopened_at, ...rest } = trip;
    void created_at;
    void reopened_at;
    let payload = rest;
    if (!id) {
      const branch = allBranches.find((candidate) => candidate.id === trip.branch_id);
      const prefix = String(branch?.trip_series_prefix ?? "")
        .trim()
        .toUpperCase();
      if (!/^[A-Z0-9]{1,10}$/.test(prefix)) {
        setSaving(false);
        toast.error("Trip Series Prefix is mandatory for the selected branch");
        return null;
      }
      const { data: generatedCode, error: numberError } = await supabase.rpc(
        "next_branch_series_number",
        {
          p_branch_id: trip.branch_id,
          p_document_type: "trip",
          p_prefix: prefix,
          p_series_year: Number(String(trip.start_date).slice(0, 4)) || new Date().getFullYear(),
        },
      );
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
      trip.rental_id && (amount > 0 || advance > 0)
        ? {
            trip_code: trip.trip_code,
            rental_id: trip.rental_id,
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
      const fixedExpenses: Record<string, number> = {};
      const expenseColumns: Record<string, string> = {
        "hire charges": "expense_hire_charges",
        "toll charges": "expense_toll_charges",
        "toll cash": "expense_toll_cash",
        fuel: "expense_fuel",
        "driver bata": "expense_driver_bata",
        morning: "expense_morning",
        night: "expense_night",
        sunday: "expense_sunday",
        parking: "expense_parking",
        dala: "expense_dala",
        unloading: "expense_unloading",
      };
      for (const row of expenseRows) {
        const column = expenseColumns[row.expense_name.trim().toLowerCase()];
        if (column) fixedExpenses[column] = num(row.amount);
      }
      const fixedUpdate = await (supabase as any)
        .from("trips")
        .update({
          income_approval_charge: num(
            incomeRows.find((row) => row.income_name.trim().toLowerCase() === "approval charge")
              ?.amount,
          ),
          ...fixedExpenses,
        })
        .eq("id", tripId);
      if (fixedUpdate.error) throw fixedUpdate.error;
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
  const rentalOpts: PickerOption[] = (
    isBasic ? rentals.filter((r) => !trip.branch_id || r.branch_id === trip.branch_id) : rentals
  ).map((r) => ({
    id: r.id,
    label: String(r.rental_name ?? ""),
    sub: String(r.city ?? "") || undefined,
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

      const [company, branch, movementResult] = await Promise.all([
        fetchCompany(),
        fetchBranch(trip.branch_id),
        trip.id
          ? supabase
              .from("consignments")
              .select(
                "consignment_number,movement_mode,consignment_type,transport_mode,from_pin_code,to_pin_code,from_details,to_details,vehicle:vehicles(registration_number),driver:drivers(full_name)",
              )
              .eq("trip_id", trip.id)
              .order("created_at")
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (movementResult.error) {
        toast.error(`Could not load trip movements: ${movementResult.error.message}`);
        return;
      }
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
        transporter: rental
          ? {
              transporter_name: rental.rental_name,
              city: rental.city,
              pan_number: rental.pan,
              gst_number: rental.gstin,
            }
          : null,
        third_party_vehicle_number: trip.third_party_vehicle_number || null,
        trip_qr_data_uri: tripQrDataUri,
        movements: ((movementResult.data ?? []) as Array<Record<string, any>>).map((m) => {
          const from = (m.from_details ?? {}) as Record<string, any>;
          const to = (m.to_details ?? {}) as Record<string, any>;
          const locationName = (details: Record<string, any>, pin: unknown) =>
            details.trade_name || details.legal_name || details.place || pin || null;
          return {
            consignment_number: m.consignment_number,
            movement_mode: m.movement_mode,
            consignment_type: m.consignment_type,
            transport_mode: m.transport_mode,
            vehicle_number:
              (m.vehicle as { registration_number?: string } | null)?.registration_number || null,
            driver_name: (m.driver as { full_name?: string } | null)?.full_name || null,
            from_location_name: locationName(from, m.from_pin_code),
            to_location_name: locationName(to, m.to_pin_code),
            from_pin_code: m.from_pin_code,
            to_pin_code: m.to_pin_code,
          };
        }),
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
    : "movement";

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
                setExpenses(
                  (isThirdParty ? THIRD_PARTY_EXPENSES : DEFAULT_EXPENSES).map((name) => ({
                    name,
                    amount: "",
                    note: "",
                  })),
                );
                const newDefaultIncomes = DEFAULT_INCOMES;
                setIncomes(newDefaultIncomes.map((name) => ({ name, amount: "", note: "" })));
                patch({
                  ownership: v,
                  ...(v === "own"
                    ? { transporter_id: null, rental_id: null }
                    : {
                        vehicle_id: null,
                        driver_id: null,
                        odometer_start: "",
                        odometer_end: "",
                        transporter_id: null,
                      }),
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
            <Select
              value={trip.mode ?? "ROAD"}
              onValueChange={(mode) => patch({ mode: mode as TripRow["mode"] })}
            >
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
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
                disabled={Boolean(trip.part_b_locked_at)}
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

          {/* Rented: rental required; no vehicle/driver/odometer */}
          {isRented ? (
            <>
              <EntityPicker
                label="Rental (required for rented)"
                value={trip.rental_id}
                options={rentalOpts}
                onChange={(id) => patch({ rental_id: id })}
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
            disabled={Boolean(trip.part_b_locked_at)}
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
          {activeTab === "movement" ? (
            <MovementTab
              tripId={trip.id ?? null}
              branchId={trip.branch_id}
              vehicleId={trip.vehicle_id}
              driverId={trip.driver_id}
              requireTripId={requireTripId}
              tripLocked={Boolean(trip.part_b_locked_at)}
              onPartBUpdated={() =>
                setTrip((current) => ({ ...current, part_b_locked_at: new Date().toISOString() }))
              }
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
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
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
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/* ---------------- Movement tab ---------------- */
type MovementOption = {
  id: string;
  consignment_number: string;
  vehicle_id?: string | null;
  driver_id?: string | null;
  trip_id?: string | null;
  vehicle?: { registration_number?: string | null } | null;
  driver?: { full_name?: string | null } | null;
  trip?: { trip_code?: string | null } | null;
  from_pin_code?: string | null;
  to_pin_code?: string | null;
  movement_mode?: string | null;
  consignment_type?: string | null;
  own_transport_mode?: string | null;
  transport_mode?: string | null;
  created_at?: string | null;
  part_b_updated_at?: string | null;
  part_b_vehicle_no?: string | null;
  part_b_from_pin_code?: string | null;
  part_b_from_state?: number | null;
  part_b_from_place?: string | null;
  part_b_transport_mode?: string | null;
  part_b_vehicle_type?: string | null;
  part_b_trans_doc_no?: string | null;
  part_b_trans_doc_date?: string | null;
  part_b_reason_code?: string | null;
  from_details?: {
    trade_name?: string;
    legal_name?: string;
    place?: string;
    pincode?: string;
  } | null;
  to_details?: {
    trade_name?: string;
    legal_name?: string;
    place?: string;
    pincode?: string;
  } | null;
  shipments?: Array<{
    id: string;
    eway_bill_number?: string | null;
    dispatch_from_pin_code?: string | null;
    ship_to_pin_code?: string | null;
  }> | null;
};
const PART_B_REASONS = {
  "1": "Vehicle breakdown",
  "2": "Trans-shipment",
  "3": "Other reason",
  "4": "First Time",
};
const PIN_STATE_CODES: Record<string, number> = {
  RAJASTHAN: 8,
  KARNATAKA: 29,
  GUJARAT: 24,
  MAHARASHTRA: 27,
  DELHI: 7,
  HARYANA: 6,
  "UTTAR PRADESH": 9,
  "MADHYA PRADESH": 23,
  TELANGANA: 36,
  "TAMIL NADU": 33,
  KERALA: 32,
  ODISHA: 21,
  BIHAR: 10,
  ASSAM: 18,
  "WEST BENGAL": 19,
  PUNJAB: 3,
  "ANDHRA PRADESH": 37,
};
function apiDate(value: string | null | undefined) {
  return value ? value.slice(0, 10).split("-").reverse().join("/") : "";
}
function MovementTab({
  tripId,
  branchId,
  vehicleId,
  driverId,
  requireTripId,
  isViewer = false,
  tripLocked = false,
  onPartBUpdated,
}: {
  tripId: string | null;
  branchId: string | null;
  vehicleId: string | null;
  driverId: string | null;
  requireTripId: () => Promise<string | null>;
  isViewer?: boolean;
  tripLocked?: boolean;
  onPartBUpdated?: () => void;
}) {
  const { user } = useSession();
  const [rows, setRows] = useState<MovementOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [movementDate, setMovementDate] = useState("");
  const [updating, setUpdating] = useState<MovementOption | null>(null);
  const [partBHistory, setPartBHistory] = useState<Array<Record<string, any>>>([]);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [form, setForm] = useState({
    vehicleNo: "",
    fromPin: "",
    fromPlace: "",
    stateCode: "",
    transMode: "1",
    vehicleType: "R",
    transDocNo: "",
    transDocDate: "",
    reasonCode: "4",
    reasonRem: "First Part-B update",
  });
  const load = async () => {
    if (!tripId || !branchId) {
      setRows([]);
      setSelected([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("consignments")
      .select(
        "id,consignment_number,vehicle_id,driver_id,trip_id,from_pin_code,to_pin_code,movement_mode,consignment_type,own_transport_mode,transport_mode,created_at,part_b_updated_at,part_b_vehicle_no,part_b_from_pin_code,part_b_from_state,part_b_from_place,part_b_transport_mode,part_b_vehicle_type,part_b_trans_doc_no,part_b_trans_doc_date,part_b_reason_code,from_details,to_details,branch:branches(branch_name,pin_code),vehicle:vehicles(registration_number),driver:drivers(full_name),trip:trips(trip_code),shipments(id,eway_bill_number,dispatch_from_pin_code,ship_to_pin_code)",
      )
      .eq("branch_id", branchId)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    const all = (data ?? []) as MovementOption[];
    const available = all.filter(
      (m) =>
        ((m.consignment_type === "own" && m.movement_mode === "pickup") ||
          (m.consignment_type === "third_party" && m.movement_mode === "drop")) &&
        (m.trip_id === tripId ||
          (!m.trip_id && (!vehicleId || !m.vehicle_id || m.vehicle_id === vehicleId))),
    );
    setRows(available);
    setSelected(available.filter((m) => m.trip_id === tripId).map((m) => m.id));
    setLoading(false);
  };
  useEffect(() => {
    void load();
  }, [branchId, vehicleId, tripId]);
  async function save() {
    const id = await requireTripId();
    if (!id) return;
    setSaving(true);
    const currentIds = rows.filter((m) => m.trip_id === id).map((m) => m.id);
    const removed = currentIds.filter((movementId) => !selected.includes(movementId));
    if (tripLocked && removed.length) {
      setSaving(false);
      return toast.error("Movements cannot be unlinked after Part-B update");
    }
    const selectedRows = rows.filter((m) => selected.includes(m.id));
    const results = await Promise.all([
      ...selectedRows.map((m) =>
        (supabase as any)
          .from("consignments")
          .update({ trip_id: id, vehicle_id: vehicleId, driver_id: driverId })
          .eq("id", m.id),
      ),
      ...removed.map((movementId) =>
        (supabase as any).from("consignments").update({ trip_id: null }).eq("id", movementId),
      ),
    ]);
    const error = results.find((r) => r.error)?.error;
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Trip movements updated");
    await load();
  }
  async function loadPartBHistory(m: MovementOption) {
    const shipmentIds = (m.shipments ?? []).map((shipment) => shipment.id).filter(Boolean);
    if (!shipmentIds.length) {
      setPartBHistory([]);
      return;
    }
    const { data, error } = await (supabase as any)
      .from("shipment_part_b_history")
      .select(
        "id,shipment_id,eway_bill_number,from_place,from_state,vehicle_no,vehicle_type,trans_mode,trans_doc_no,trans_doc_date,reason_code,reason_rem,updated_at",
      )
      .in("shipment_id", shipmentIds)
      .order("updated_at", { ascending: false });
    if (error) toast.error(`Could not load Part-B history: ${error.message}`);
    setPartBHistory((data ?? []) as Array<Record<string, any>>);
  }
  function openPartB(m: MovementOption) {
    void loadPartBHistory(m);
    const first = !m.part_b_updated_at;
    const pin = m.part_b_from_pin_code || m.from_pin_code || "";
    setUpdating(m);
    setForm({
      vehicleNo: m.part_b_vehicle_no || m.vehicle?.registration_number || "",
      fromPin: pin,
      fromPlace:
        m.part_b_from_place ||
        m.from_details?.place ||
        m.from_details?.trade_name ||
        m.from_details?.legal_name ||
        "",
      stateCode: m.part_b_from_state ? String(m.part_b_from_state).padStart(2, "0") : "",
      transMode:
        m.part_b_transport_mode ||
        (m.transport_mode === "Rail"
          ? "2"
          : m.transport_mode === "Air"
            ? "3"
            : m.transport_mode === "Ship"
              ? "4"
              : "1"),
      vehicleType: m.part_b_vehicle_type || "R",
      transDocNo: m.part_b_trans_doc_no || m.consignment_number || "",
      transDocDate: apiDate(m.part_b_trans_doc_date || m.created_at),
      reasonCode: first ? "4" : "1",
      reasonRem: first ? "First Part-B update" : "Vehicle details updated",
    });
  }
  async function lookupPin(pin: string) {
    setForm((f) => ({ ...f, fromPin: pin, stateCode: "" }));
    if (!/^\d{6}$/.test(pin)) return;
    const result = await lookupIndiaPin(pin);
    if (!result) return toast.error("PIN not found; enter a valid Indian PIN");
    const code = PIN_STATE_CODES[result.state.toUpperCase()];
    if (!code) return toast.error(`State code is not configured for ${result.state}`);
    setForm((f) => ({
      ...f,
      fromPin: pin,
      fromPlace: f.fromPlace || result.district,
      stateCode: String(code).padStart(2, "0"),
    }));
  }
  async function updateAllAssignedPartB() {
    if (!user?.sessionToken || !tripId) return toast.error("Save the trip before updating Part-B");
    const assigned = rows.filter((m) => m.trip_id === tripId);
    if (!assigned.length) return toast.error("No movements are assigned to this trip");
    if (!window.confirm(`Update Part-B for all ${assigned.length} assigned movement(s)?`)) return;
    setBulkUpdating(true);
    let updated = 0;
    let failed = 0;
    const messages: string[] = [];
    try {
      for (const m of assigned) {
        const fromPin = (
          m.part_b_from_pin_code ||
          m.from_pin_code ||
          m.from_details?.pincode ||
          m.shipments?.[0]?.dispatch_from_pin_code ||
          ""
        ).trim();
        const fromPlace = (
          m.part_b_from_place ||
          m.from_details?.place ||
          m.from_details?.trade_name ||
          m.from_details?.legal_name ||
          ""
        ).trim();
        const vehicleNo = (m.vehicle?.registration_number || m.part_b_vehicle_no || "").trim();
        if (!vehicleNo || !fromPlace || !/^\d{6}$/.test(fromPin)) {
          failed++;
          messages.push(`${m.consignment_number}: missing Vehicle, From Place or From PIN`);
          continue;
        }
        const state = await lookupIndiaPin(fromPin);
        const stateCode = state ? PIN_STATE_CODES[state.state.toUpperCase()] : undefined;
        if (!stateCode) {
          failed++;
          messages.push(`${m.consignment_number}: could not derive State Code from PIN`);
          continue;
        }
        const result = await serverUpdateEwayBillPartB({
          data: {
            token: user.sessionToken,
            movementId: m.id,
            fromPinCode: fromPin,
            fromPlace,
            vehicleNo,
            vehicleType: (m.part_b_vehicle_type || "R") as "R" | "O",
            transMode: (m.part_b_transport_mode ||
              (m.transport_mode === "Rail"
                ? "2"
                : m.transport_mode === "Air"
                  ? "3"
                  : m.transport_mode === "Ship"
                    ? "4"
                    : "1")) as "1" | "2" | "3" | "4",
            transDocNo: m.part_b_trans_doc_no || m.consignment_number,
            transDocDate: m.part_b_trans_doc_date || apiDate(m.created_at),
            reasonCode: (m.part_b_updated_at ? "1" : "4") as "1" | "2" | "3" | "4",
            reasonRem: m.part_b_updated_at ? "Vehicle details updated" : "First Part-B update",
          },
        });
        if (result.updated) updated += result.updated;
        if (result.failed) {
          failed += result.failed;
          messages.push(
            `${m.consignment_number}: ${(result.results ?? [])
              .filter((item: { ok: boolean; error?: string | null }) => !item.ok)
              .map(
                (item: { ok: boolean; error?: string | null }) =>
                  item.error || "API rejected update",
              )
              .join(", ")}`,
          );
        }
      }
      toast[failed ? "error" : "success"](
        `${updated} E-Way Bill(s) updated; ${failed} failed${messages.length ? ` — ${messages.join(" | ")}` : ""}`,
      );
      if (updated) onPartBUpdated?.();
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update all Part-B records");
    } finally {
      setBulkUpdating(false);
    }
  }

  async function submitPartB() {
    if (!updating || !user?.sessionToken) return;
    const vehicleNo = form.vehicleNo.trim();
    const fromPin = form.fromPin.trim();
    let fromPlace = form.fromPlace.trim();
    let stateCode = form.stateCode.trim();
    // The state field is auto-filled and disabled, so hydrate it synchronously for this submit
    // as well. This prevents a visible PIN/state value from being lost in a stale React update.
    if (/^\d{6}$/.test(fromPin) && (!stateCode || !fromPlace)) {
      const result = await lookupIndiaPin(fromPin);
      if (result) {
        fromPlace = fromPlace || result.district;
        const code = PIN_STATE_CODES[result.state.toUpperCase()];
        if (code) stateCode = String(code).padStart(2, "0");
        setForm((current) => ({ ...current, fromPin, fromPlace, stateCode }));
      }
    }
    if (!vehicleNo || !fromPlace || !/^\d{6}$/.test(fromPin) || !/^\d{2}$/.test(stateCode))
      return toast.error("Vehicle, From Place, From PIN, and State Code are required");
    if (form.transMode !== "1" && !form.transDocNo.trim())
      return toast.error("Transport Document No. is required for non-road movement");
    if (!window.confirm(`Update Part-B for all E-Way Bills of ${updating.consignment_number}?`))
      return;
    setSaving(true);
    try {
      const result = (await serverUpdateEwayBillPartB({
        data: {
          token: user.sessionToken,
          movementId: updating.id,
          fromPinCode: fromPin,
          fromPlace,
          vehicleNo,
          vehicleType: form.vehicleType as "R" | "O",
          transMode: form.transMode as "1" | "2" | "3" | "4",
          transDocNo: form.transDocNo,
          transDocDate: form.transDocDate,
          reasonCode: form.reasonCode as "1" | "2" | "3" | "4",
          reasonRem: form.reasonRem,
        },
      })) as {
        updated: number;
        failed: number;
        results?: Array<{ ewayBillNumber: string; ok: boolean; error?: string | null }>;
      };
      const failures = (result.results ?? [])
        .filter((item: { ok: boolean; error?: string | null }) => !item.ok)
        .map(
          (item) => `${item.ewayBillNumber}: ${item.error || "E-Way Bill API rejected the update"}`,
        );
      if (result.failed) {
        toast.error(
          `${result.updated} E-Way Bill(s) updated; ${result.failed} failed${failures.length ? ` — ${failures.join(" | ")}` : ""}`,
        );
      } else {
        toast.success(`${result.updated} E-Way Bill(s) updated. Trip is locked after success.`);
      }
      if (result.updated) onPartBUpdated?.();
      setUpdating(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update Part-B");
    }
    setSaving(false);
  }
  const pinFrom = (m: MovementOption) =>
    m.from_pin_code || m.from_details?.pincode || m.shipments?.[0]?.dispatch_from_pin_code || "";
  const pinTo = (m: MovementOption) =>
    m.to_pin_code || m.to_details?.pincode || m.shipments?.[0]?.ship_to_pin_code || "";
  const visible = rows.filter(
    (m) =>
      (!search.trim() ||
        `${m.consignment_number} ${m.trip?.trip_code ?? ""}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())) &&
      (!movementDate || String(m.created_at ?? "").slice(0, 10) === movementDate),
  );
  return (
    <div className="space-y-4">
      {!tripId && (
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          Save the trip details first to load movements.
        </p>
      )}
      <div className="flex items-center gap-2">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Trip movements</h3>
          <p className="text-xs text-muted-foreground">
            Only unassigned movements and movements already assigned to this trip are shown.
          </p>
        </div>
        {!isViewer && (
          <>
            <Button
              type="button"
              size="sm"
              className="ml-auto"
              onClick={() => void save()}
              disabled={saving || !tripId}
            >
              {saving ? "Saving…" : "Save movements"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void updateAllAssignedPartB()}
              disabled={bulkUpdating || !tripId || isViewer}
            >
              <Clock3 className="mr-1 size-4" />
              {bulkUpdating ? "Updating Part-B…" : "Update all assigned Part-B"}
            </Button>
          </>
        )}
      </div>
      {tripLocked && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          Part-B has been updated. This trip is locked: movements cannot be unlinked.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search consignment or trip"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Input
          className="w-44"
          type="date"
          value={movementDate}
          onChange={(e) => setMovementDate(e.target.value)}
          aria-label="Movement date"
        />
      </div>
      {loading ? (
        <p className="p-5 text-center text-sm text-muted-foreground">Loading movements…</p>
      ) : !visible.length ? (
        <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
          No movements match this trip.
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3"
            >
              <input
                type="checkbox"
                checked={selected.includes(m.id)}
                disabled={isViewer || tripLocked}
                onChange={(e) =>
                  setSelected((old) =>
                    e.target.checked ? [...old, m.id] : old.filter((id) => id !== m.id),
                  )
                }
              />
              <span className="grid min-w-0 flex-1 gap-1 sm:grid-cols-2 lg:grid-cols-4">
                <strong>{m.consignment_number}</strong>
                <span>
                  {pinFrom(m) || "—"} → {pinTo(m) || "—"}
                </span>
                <span>
                  {m.vehicle?.registration_number || "No vehicle"} ·{" "}
                  {m.driver?.full_name || "No driver"}
                </span>
                <span className="text-muted-foreground">
                  {m.trip?.trip_code ? `Trip: ${m.trip.trip_code}` : "Unassigned"}
                </span>
              </span>
              {m.trip_id === tripId && !isViewer && (
                <Button type="button" variant="outline" size="sm" onClick={() => openPartB(m)}>
                  {m.part_b_updated_at ? "Update Part-B" : "Update Part-B"}
                </Button>
              )}
              {m.part_b_updated_at && (
                <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                  Part-B updated
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}
      <Dialog open={Boolean(updating)} onOpenChange={(open) => !open && setUpdating(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Update Part-B — {updating?.consignment_number}</DialogTitle>
          </DialogHeader>
          {partBHistory.length > 0 && (
            <div className="mb-4 rounded-lg border border-border bg-muted/20 p-3">
              <h4 className="mb-2 text-sm font-semibold">Part-B update history</h4>
              <div className="max-h-40 space-y-2 overflow-y-auto text-xs">
                {partBHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className="grid gap-1 rounded border border-border bg-background p-2 sm:grid-cols-4"
                  >
                    <span>{new Date(entry.updated_at).toLocaleString("en-IN")}</span>
                    <span>EWB: {entry.eway_bill_number || "—"}</span>
                    <span>Vehicle: {entry.vehicle_no || "—"}</span>
                    <span>
                      Reason: {entry.reason_code || "—"} — {entry.reason_rem || "—"}
                    </span>
                    <span className="sm:col-span-4">
                      From: {entry.from_place || "—"} · State {entry.from_state || "—"} · Doc{" "}
                      {entry.trans_doc_no || "—"} ({entry.trans_doc_date || "—"})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {updating && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                This updates all valid E-Way Bills in this movement. Values are auto-filled; you may
                change them before submitting. State Code is always derived from the From PIN.
              </div>
              <Field
                label="Vehicle Number"
                required
                value={form.vehicleNo}
                onChange={(v) => setForm((f) => ({ ...f, vehicleNo: v }))}
              />
              <Field
                label="From Place"
                required
                value={form.fromPlace}
                onChange={(v) => setForm((f) => ({ ...f, fromPlace: v }))}
              />
              <Field
                label="From PIN Code"
                required
                value={form.fromPin}
                onChange={(v) => void lookupPin(v)}
              />
              <Field
                label="From State Code (auto)"
                required
                value={form.stateCode}
                onChange={() => {}}
                disabled
              />
              <div className="space-y-1.5">
                <Label>Transport Mode</Label>
                <Select
                  value={form.transMode}
                  onValueChange={(v) => setForm((f) => ({ ...f, transMode: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Road</SelectItem>
                    <SelectItem value="2">Rail</SelectItem>
                    <SelectItem value="3">Air</SelectItem>
                    <SelectItem value="4">Ship</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Vehicle Type</Label>
                <Select
                  value={form.vehicleType}
                  onValueChange={(v) => setForm((f) => ({ ...f, vehicleType: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="R">Regular</SelectItem>
                    <SelectItem value="O">ODC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Field
                label="Transport Document No."
                value={form.transDocNo}
                onChange={(v) => setForm((f) => ({ ...f, transDocNo: v }))}
              />
              <Field
                label="Transport Document Date"
                type="date"
                value={form.transDocDate ? form.transDocDate.split("/").reverse().join("-") : ""}
                onChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    transDocDate: v ? v.split("-").reverse().join("/") : "",
                  }))
                }
              />
              <div className="space-y-1.5">
                <Label>Reason Code *</Label>
                <Select
                  value={form.reasonCode}
                  onValueChange={(v) => setForm((f) => ({ ...f, reasonCode: v }))}
                  disabled={!updating.part_b_updated_at}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PART_B_REASONS)
                      .filter(([code]) =>
                        updating.part_b_updated_at ? code !== "4" : code === "4",
                      )
                      .map(([code, label]) => (
                        <SelectItem key={code} value={code}>
                          {code} — {label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  First update: code 4 — First Time. Later updates are allowed only after changing
                  the vehicle and must use code 1 (Vehicle breakdown), 2 (Trans-shipment), or 3
                  (Other reason).
                </p>
              </div>
              <Field
                label="Reason Remarks *"
                required
                value={form.reasonRem}
                onChange={(v) => setForm((f) => ({ ...f, reasonRem: v }))}
              />
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button type="button" variant="outline" onClick={() => setUpdating(null)}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => void submitPartB()} disabled={saving}>
                  {saving ? "Updating…" : "Update all E-Way Bills"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
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
                <Input className="h-10" value={r.name} readOnly />
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
