import { useEffect, useMemo, useState } from "react";
import { Eye, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { serverFetchEwayBillDetails } from "@/lib/ewaybill-details";
import { useBranches, type BranchOption } from "@/lib/use-branches";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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

type Item = Record<string, string | number>;
type Master = { id: string; label: string; pin_code?: string | null; gstin?: string | null };

type ShipmentDraft = {
  eway_bill_number: string;
  eway_bill_date: string;
  eway_bill_status: string;
  valid_until: string;
  document_number: string;
  document_date: string;
  total_value: string;
  total_taxable_value: string;
  total_invoice_value: string;
  generation_mode: string;
  generation_mode_code: string;
  transaction_type: string;
  transaction_type_code: string;
  supply_type: string;
  supply_type_code: string;
  sub_type: string;
  sub_type_code: string;
  supplier_gstin: string;
  supplier_trade_name: string;
  supplier_legal_name: string;
  supplier_address_line_1: string;
  supplier_address_line_2: string;
  supplier_place: string;
  supplier_state: string;
  supplier_pin_code: string;
  recipient_gstin: string;
  recipient_trade_name: string;
  recipient_legal_name: string;
  recipient_address_line_1: string;
  recipient_address_line_2: string;
  recipient_place: string;
  recipient_state: string;
  recipient_pin_code: string;
  dispatch_from_pin_code: string;
  ship_to_pin_code: string;
  items: Item[];
};

type PartnerForm = {
  name: string;
  legalName: string;
  type: string;
  gstin: string;
  pan: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  country: string;
  pin: string;
  contact: string;
  designation: string;
  mobile: string;
  alternateMobile: string;
  email: string;
  telephone: string;
  website: string;
  bankName: string;
  bankBranch: string;
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  upi: string;
};

const emptyPartner = (): PartnerForm => ({
  name: "",
  legalName: "",
  type: "",
  gstin: "",
  pan: "",
  address1: "",
  address2: "",
  city: "",
  state: "",
  country: "India",
  pin: "",
  contact: "",
  designation: "",
  mobile: "",
  alternateMobile: "",
  email: "",
  telephone: "",
  website: "",
  bankName: "",
  bankBranch: "",
  accountHolder: "",
  accountNumber: "",
  ifsc: "",
  upi: "",
});

const read = (source: Record<string, unknown>, key: string) => String(source[key] ?? "");
const readAny = (source: Record<string, unknown>, ...keys: string[]) =>
  keys.map((key) => read(source, key)).find(Boolean) ?? "";
const dateOnly = (value: unknown) => {
  const text = String(value ?? "").trim();
  const indianDate = text.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (indianDate) return `${indianDate[3]}-${indianDate[2]}-${indianDate[1]}`;
  return text.slice(0, 10);
};
const numberValue = (value: unknown) => Number(value || 0);

const generationModeLabel: Record<string, string> = {
  API: "API",
  "1": "Manual",
  "2": "API",
};
const transactionTypeLabel: Record<string, string> = {
  "1": "Regular",
  "2": "Bill To / Ship To",
  "3": "Bill From / Dispatch From",
  "4": "Bill To / Ship To and Bill From / Dispatch From",
};
const supplyTypeLabel: Record<string, string> = {
  O: "Outward",
  I: "Inward",
  Outward: "Outward",
  Inward: "Inward",
};
const subSupplyTypeLabel: Record<string, string> = {
  "1": "Supply",
  "2": "Export",
  "3": "Job Work",
  "4": "SKD / CKD",
  "5": "Recipient Not Known",
  "6": "Exhibition or Fairs",
  "7": "Line Sales",
  "8": "Return",
  "9": "Job Work Returns",
  "10": "Others",
  "11": "For Own Use",
};

const db = supabase as any;

function humanLabel(map: Record<string, string>, value: string, fallback = "Not specified") {
  return (map[value] ?? value) || fallback;
}

function findGoodsList(value: unknown, depth = 0): Array<Record<string, unknown>> {
  if (depth > 5 || value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    if (
      value.some(
        (item) =>
          item &&
          typeof item === "object" &&
          Object.keys(item).some((key) =>
            /product|itemName|hsn|taxable|quantity|qtyUnit/i.test(key),
          ),
      )
    )
      return value as Array<Record<string, unknown>>;
    for (const item of value) {
      const found = findGoodsList(item, depth + 1);
      if (found.length) return found;
    }
    return [];
  }
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some((key) => /product|itemName|hsn|taxable|quantity|qtyUnit/i.test(key)))
    return [object];
  for (const [key, child] of Object.entries(object)) {
    if (/item|goods|product/i.test(key)) {
      const found = findGoodsList(child, depth + 1);
      if (found.length) return found;
    }
  }
  for (const child of Object.values(value)) {
    const found = findGoodsList(child, depth + 1);
    if (found.length) return found;
  }
  return [];
}

function findEwaySource(value: unknown, depth = 0): Record<string, unknown> {
  if (depth > 6 || value === null) return {};
  if (typeof value === "string") {
    try {
      return findEwaySource(JSON.parse(value), depth + 1);
    } catch {
      return {};
    }
  }
  if (typeof value !== "object" || Array.isArray(value)) return {};
  const object = value as Record<string, unknown>;
  if (object.ewbNo || object.ewayBillNo || object.fromGstin || object.itemList) return object;
  for (const key of ["data", "result", "response", "ewayBill", "ewayBillDetails", "details"]) {
    const found = findEwaySource(object[key], depth + 1);
    if (Object.keys(found).length) return found;
  }
  for (const child of Object.values(object)) {
    const found = findEwaySource(child, depth + 1);
    if (Object.keys(found).length) return found;
  }
  return {};
}

function mapEway(raw: unknown): ShipmentDraft {
  const source = findEwaySource(raw);
  const from1 = read(source, "fromAddr1");
  const from2 = read(source, "fromAddr2");
  const to1 = read(source, "toAddr1");
  const to2 = read(source, "toAddr2");
  const ship1 = read(source, "shipToAddr1") || to1;
  const ship2 = read(source, "shipToAddr2") || to2;
  const transactionCode = read(source, "transactionType");
  const supplyCode = read(source, "supplyType");
  const subSupplyCode = read(source, "subSupplyType") || read(source, "subType");
  const generationCode = read(source, "genMode") || read(source, "generatedBy") || "API";
  const itemList = findGoodsList(source);
  const itemInvoiceTotal = itemList.reduce(
    (total, item) =>
      total +
      numberValue(
        readAny(
          item,
          "totalInvoiceValue",
          "total_invoice_value",
          "taxableAmount",
          "taxable_amount",
        ),
      ),
    0,
  );
  const totalInvoiceValue =
    readAny(source, "totInvValue", "totalInvoiceValue", "total_invoice_value") ||
    (itemInvoiceTotal ? String(itemInvoiceTotal) : "0");
  const totalTaxableValue =
    readAny(source, "totalTaxableValue", "total_taxable_value", "taxableValue", "taxable_value") ||
    (itemInvoiceTotal ? String(itemInvoiceTotal) : "0");
  return {
    eway_bill_number: read(source, "ewbNo") || read(source, "ewayBillNo"),
    eway_bill_date: dateOnly(source.ewayBillDate || source.ewayBillDateStr),
    eway_bill_status: read(source, "status") || "Active",
    valid_until: dateOnly(source.validUpto || source.validUntil),
    document_number: read(source, "docNo"),
    document_date:
      dateOnly(source.docDate) || dateOnly(source.ewayBillDate || source.ewayBillDateStr),
    total_value: readAny(source, "totalValue", "total_value", "valueOfGoods") || totalTaxableValue,
    total_taxable_value: totalTaxableValue,
    total_invoice_value: totalInvoiceValue,
    generation_mode_code: generationCode,
    generation_mode: humanLabel(generationModeLabel, generationCode, "API"),
    transaction_type_code: transactionCode,
    transaction_type: humanLabel(transactionTypeLabel, transactionCode),
    supply_type_code: supplyCode,
    supply_type: humanLabel(supplyTypeLabel, supplyCode),
    sub_type_code: subSupplyCode,
    sub_type: humanLabel(subSupplyTypeLabel, subSupplyCode),
    supplier_gstin: read(source, "fromGstin") || "URP",
    supplier_trade_name: read(source, "fromTrdName"),
    supplier_legal_name: read(source, "fromLegalName") || read(source, "fromTrdName"),
    supplier_address_line_1: from1,
    supplier_address_line_2: from2,
    supplier_place: read(source, "fromPlace"),
    supplier_state: read(source, "fromStateCode"),
    supplier_pin_code: read(source, "fromPincode"),
    recipient_gstin: read(source, "toGstin") || "URP",
    recipient_trade_name: read(source, "toTrdName"),
    recipient_legal_name: read(source, "toLegalName") || read(source, "toTrdName"),
    recipient_address_line_1: to1,
    recipient_address_line_2: to2,
    recipient_place: read(source, "toPlace"),
    recipient_state: read(source, "toStateCode"),
    recipient_pin_code: read(source, "toPincode"),
    dispatch_from_pin_code: read(source, "fromPincode"),
    ship_to_pin_code: read(source, "shipToPincode") || read(source, "toPincode"),
    items: itemList.map((item) => ({
      product_name: readAny(item, "productName", "product_name", "itemName", "item_name"),
      description: readAny(
        item,
        "productDesc",
        "product_desc",
        "itemDescription",
        "item_description",
        "productName",
        "product_name",
      ),
      hsn_code: readAny(item, "hsnCode", "hsn_code", "hsn"),
      quantity: readAny(item, "quantity", "qty"),
      unit: readAny(item, "qtyUnit", "qty_unit", "unit") || "NOS",
      weight_kg: readAny(
        item,
        "itemWeight",
        "item_weight",
        "weight",
        "weightKg",
        "weight_kg",
        "quantity",
      ),
      taxable_value: readAny(item, "taxableAmount", "taxable_amount"),
      cgst_rate: readAny(item, "cgstRate", "cgst_rate"),
      sgst_rate: readAny(item, "sgstRate", "sgst_rate"),
      igst_rate: readAny(item, "igstRate", "igst_rate"),
      cess_rate: readAny(item, "cessRate", "cess_rate"),
      cess_nonadvol: readAny(item, "cessNonadvol", "cess_nonadvol"),
      gst_rate:
        numberValue(readAny(item, "cgstRate", "cgst_rate")) +
        numberValue(readAny(item, "sgstRate", "sgst_rate")) +
        numberValue(readAny(item, "igstRate", "igst_rate")),
      cgst: readAny(item, "cgstValue", "cgst_value"),
      sgst_utgst: readAny(item, "sgstValue", "sgst_value"),
      igst: readAny(item, "igstValue", "igst_value"),
      cess: readAny(item, "cessValue", "cess_value"),
      other_tax_charges: readAny(item, "cessNonadvol", "cess_nonadvol"),
      total_invoice_value: readAny(item, "taxableAmount", "taxable_amount"),
    })),
  };
}

function ReadonlyField({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 min-h-9 rounded-md border border-input bg-muted/30 px-3 py-2 text-sm">
        {String(value || "—")}
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Master[];
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger disabled={disabled}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ConsignmentList({
  onSidebarVisibilityChange,
  onCreateModeChange,
}: {
  onSidebarVisibilityChange?: (visible: boolean) => void;
  onCreateModeChange?: (open: boolean) => void;
}) {
  const branches = useBranches();
  const { user } = useSession();
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [screen, setScreen] = useState<"list" | "create" | "view">("list");
  const [view, setView] = useState<Record<string, any> | null>(null);
  const [viewShipments, setViewShipments] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7));
  const [branchId, setBranchId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [type, setType] = useState("own");
  const [ownTransportMode, setOwnTransportMode] = useState("own_vehicle");
  const [movement, setMovement] = useState("pickup");
  const [transportMode, setTransportMode] = useState("Road");
  const [vehicleId, setVehicleId] = useState("");
  const [rentalId, setRentalId] = useState("");
  const [transporterId, setTransporterId] = useState("");
  const [fromPin, setFromPin] = useState("");
  const [toPin, setToPin] = useState("");
  const [previewNumber, setPreviewNumber] = useState("");
  const [ewayNo, setEwayNo] = useState("");
  const [fetching, setFetching] = useState(false);
  const [drafts, setDrafts] = useState<ShipmentDraft[]>([]);
  const [contracts, setContracts] = useState<Master[]>([]);
  const [vehicles, setVehicles] = useState<Master[]>([]);
  const [rentals, setRentals] = useState<Master[]>([]);
  const [transporters, setTransporters] = useState<Master[]>([]);
  const [partnerDialog, setPartnerDialog] = useState<"rental" | "transporter" | null>(null);
  const [partnerForm, setPartnerForm] = useState<PartnerForm>(emptyPartner());

  const branch = branches.find((item) => item.id === branchId);
  const common = drafts[0];
  const selectedTransporter = transporters.find((item) => item.id === transporterId);
  const filteredRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          (branchFilter === "all" || row.branch_id === branchFilter) &&
          (typeFilter === "all" || row.consignment_type === typeFilter) &&
          (monthFilter === "all" || String(row.created_at ?? "").startsWith(monthFilter)) &&
          (!search.trim() ||
            String(row.consignment_number).toLowerCase().includes(search.trim().toLowerCase())),
      ),
    [rows, search, branchFilter, typeFilter, monthFilter],
  );

  async function loadRows() {
    setLoading(true);
    const { data, error } = await db
      .from("consignments")
      .select(
        "*, branch:branches(branch_name), source:contracts(contract_name), vehicle:vehicles(registration_number,nickname), rental:rentals(rental_name), transporter:ltms_transporters(transporter_name,gstin,pin_code)",
      )
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data ?? []) as Record<string, any>[]);
    setLoading(false);
  }

  async function loadMasters() {
    const [sourceResult, vehicleResult, rentalResult, transporterResult] = await Promise.all([
      db.from("contracts").select("id,contract_name").eq("status", "active").order("contract_name"),
      db.from("vehicles").select("id,registration_number").order("registration_number"),
      db.from("rentals").select("id,rental_name,pin_code,gstin").order("rental_name"),
      db
        .from("ltms_transporters")
        .select("id,transporter_name,pin_code,gstin")
        .order("transporter_name"),
    ]);
    setContracts(
      (sourceResult.data ?? []).map((row: any) => ({ id: row.id, label: row.contract_name })),
    );
    setVehicles(
      (vehicleResult.data ?? []).map((row: any) => ({
        id: row.id,
        label: row.registration_number,
      })),
    );
    setRentals(
      (rentalResult.data ?? []).map((row: any) => ({
        id: row.id,
        label: `${row.rental_name}${row.details_pending ? " (Update Later)" : ""}`,
        pin_code: row.pin_code,
        gstin: row.gstin,
      })),
    );
    setTransporters(
      (transporterResult.data ?? []).map((row: any) => ({
        id: row.id,
        label: row.transporter_name,
        pin_code: row.pin_code,
        gstin: row.gstin,
      })),
    );
  }

  async function loadPreview(id: string) {
    const selected = branches.find((item) => item.id === id);
    if (!selected) return setPreviewNumber("");
    const { data } = await db.rpc("preview_branch_series_number", {
      p_branch_id: id,
      p_document_type: "consignment",
      p_prefix: selected.lr_series_prefix || "LR",
    });
    setPreviewNumber(
      String(data ?? `${selected.lr_series_prefix || "LR"}${new Date().getFullYear()}000001`),
    );
  }

  useEffect(() => {
    void loadRows();
  }, []);
  useEffect(() => {
    if (branchId) {
      setFromPin(branch?.pin_code ?? "");
      void loadPreview(branchId);
    }
  }, [branchId, branch?.pin_code]);
  useEffect(() => {
    if (type === "third_party" && movement === "drop") {
      setToPin(selectedTransporter?.pin_code ?? "");
    } else {
      setToPin("");
    }
  }, [type, movement, selectedTransporter?.pin_code]);

  function openCreate() {
    setScreen("create");
    onSidebarVisibilityChange?.(false);
    onCreateModeChange?.(true);
    setBranchId(branches.length === 1 ? branches[0].id : "");
    setSourceId("");
    setType("own");
    setOwnTransportMode("own_vehicle");
    setMovement("pickup");
    setTransportMode("Road");
    setVehicleId("");
    setRentalId("");
    setTransporterId("");
    setFromPin("");
    setToPin("");
    setPreviewNumber("");
    setEwayNo("");
    setDrafts([]);
    void loadMasters();
  }

  async function addEway() {
    if (!/^\d{12}$/.test(ewayNo))
      return toast.error("E-Way Bill Number must contain exactly 12 digits");
    if (!branchId || !user?.sessionToken) return toast.error("Select a branch and sign in again");
    if (drafts.some((item) => item.eway_bill_number === ewayNo))
      return toast.error("This E-Way Bill is already added");
    const existing = await db
      .from("shipments")
      .select("id")
      .eq("eway_bill_number", ewayNo)
      .maybeSingle();
    if (existing.data) return toast.error("This E-Way Bill is already used");
    setFetching(true);
    try {
      const raw = await serverFetchEwayBillDetails({
        data: { token: user.sessionToken, branchId, ewayBillNumber: ewayNo },
      });
      const draft = mapEway(raw);
      if (!draft.eway_bill_number) draft.eway_bill_number = ewayNo;
      if (!draft.items.length) throw new Error("The E-Way Bill has no goods details");
      if (drafts.length) {
        const first = drafts[0];
        const mismatch =
          first.supplier_gstin.toUpperCase() !== draft.supplier_gstin.toUpperCase() ||
          first.recipient_gstin.toUpperCase() !== draft.recipient_gstin.toUpperCase() ||
          first.dispatch_from_pin_code !== draft.dispatch_from_pin_code ||
          first.ship_to_pin_code !== draft.ship_to_pin_code;
        if (mismatch)
          throw new Error("Every E-Way Bill must have the same From/To GSTINs and Pincodes");
      }
      setDrafts((items) => [...items, draft]);
      setEwayNo("");
      toast.success("E-Way Bill fetched and added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not fetch E-Way Bill details");
    } finally {
      setFetching(false);
    }
  }

  async function savePartner(updateLater = false) {
    const table = partnerDialog === "rental" ? "rentals" : "ltms_transporters";
    const nameColumn = partnerDialog === "rental" ? "rental_name" : "transporter_name";
    if (!partnerForm.name.trim())
      return toast.error(
        `${partnerDialog === "rental" ? "Rental" : "Transporter"} name is required`,
      );
    if (!updateLater && !partnerForm.gstin.trim())
      return toast.error("GSTIN is mandatory for Transporters and Rentals");
    if (!updateLater && !partnerForm.pin.trim())
      return toast.error("PIN Code is mandatory for Transporters and Rentals");
    const payload = {
      [nameColumn]: partnerForm.name.trim(),
      legal_business_name: partnerForm.legalName,
      [partnerDialog === "rental" ? "rental_type" : "transporter_type"]: partnerForm.type,
      gstin: partnerForm.gstin.toUpperCase(),
      pan: partnerForm.pan.toUpperCase(),
      address_line1: partnerForm.address1,
      address_line2: partnerForm.address2,
      city: partnerForm.city,
      state: partnerForm.state,
      country: partnerForm.country,
      pin_code: partnerForm.pin,
      primary_contact_name: partnerForm.contact,
      primary_contact_designation: partnerForm.designation,
      mobile_number: partnerForm.mobile,
      alternate_mobile: partnerForm.alternateMobile,
      email: partnerForm.email,
      telephone: partnerForm.telephone,
      website: partnerForm.website,
      bank_name: partnerForm.bankName,
      bank_branch: partnerForm.bankBranch,
      bank_account_holder: partnerForm.accountHolder,
      bank_account_number: partnerForm.accountNumber,
      bank_ifsc: partnerForm.ifsc,
      upi_id: partnerForm.upi,
      branch_id: branchId || null,
      ...(partnerDialog === "rental" ? { details_pending: updateLater } : {}),
    };
    const { data, error } = await db.from(table).insert(payload).select("id").single();
    if (error) return toast.error(error.message);
    await loadMasters();
    if (partnerDialog === "rental") setRentalId(data.id);
    else setTransporterId(data.id);
    setPartnerDialog(null);
    setPartnerForm(emptyPartner());
    toast.success(
      `${partnerDialog === "rental" ? "Rental" : "Transporter"} ${updateLater ? "saved for later update and selected" : "created and selected"}`,
    );
  }

  async function save() {
    const needsOwnVehicle =
      type === "third_party" ? movement === "drop" : ownTransportMode === "own_vehicle";
    const needsRental = type === "own" && ownTransportMode === "rental";
    const needsTransporter = type === "third_party";
    if (!branchId || !sourceId || drafts.length < 1)
      return toast.error("Branch, Source and at least one E-Way Bill are required");
    if (needsOwnVehicle && !vehicleId) return toast.error("Vehicle is required for this movement");
    if (needsRental && !rentalId) return toast.error("Select a Rental provider");
    if (needsTransporter && !transporterId) return toast.error("Select a Transporter");
    if (movement === "drop" && (!/^\d{6}$/.test(fromPin) || !/^\d{6}$/.test(toPin)))
      return toast.error("Drop mode requires valid From and To Pincodes");
    if (!common) return toast.error("Add at least one E-Way Bill");
    const payload = {
      branch_id: branchId,
      source_id: sourceId,
      consignment_type: type,
      movement_mode: movement,
      transport_mode: transportMode,
      vehicle_id: needsOwnVehicle ? vehicleId : "",
      transporter_id: needsTransporter ? transporterId : "",
      from_pin_code: fromPin,
      to_pin_code: toPin,
      from_gstin: common.supplier_gstin,
      to_gstin: common.recipient_gstin,
      generation_mode: common.generation_mode,
      transaction_type: common.transaction_type,
      supply_type: common.supply_type,
      sub_supply_type: common.sub_type,
      from_details: {
        gstin: common.supplier_gstin,
        trade_name: common.supplier_trade_name,
        legal_name: common.supplier_legal_name,
        address1: common.supplier_address_line_1,
        address2: common.supplier_address_line_2,
        place: common.supplier_place,
        pincode: common.supplier_pin_code,
        state: common.supplier_state,
      },
      to_details: {
        gstin: common.recipient_gstin,
        trade_name: common.recipient_trade_name,
        legal_name: common.recipient_legal_name,
        address1: common.recipient_address_line_1,
        address2: common.recipient_address_line_2,
        place: common.recipient_place,
        pincode: common.recipient_pin_code,
        state: common.recipient_state,
      },
      created_by: user?.id ?? null,
    };
    setLoading(true);
    const { data, error } = await db.rpc("create_consignment_with_shipments", {
      p_consignment: payload,
      p_shipments: drafts.map((draft) => ({
        ...draft,
        items: draft.items.map((item, index) => ({ ...item, item_no: index + 1 })),
      })),
    });
    if (error) {
      setLoading(false);
      return toast.error(error.message);
    }
    const { error: updateError } = await db
      .from("consignments")
      .update({
        own_transport_mode: type === "own" ? ownTransportMode : "own_vehicle",
        rental_id: needsRental ? rentalId : null,
      })
      .eq("id", data.id);
    setLoading(false);
    if (updateError) return toast.error(updateError.message);
    toast.success(
      `Consignment ${data.consignment_number} created with ${data.shipment_count} Shipment(s)`,
    );
    setScreen("list");
    onSidebarVisibilityChange?.(true);
    onCreateModeChange?.(false);
    await loadRows();
  }

  async function openView(row: Record<string, any>) {
    const { data, error } = await db
      .from("shipments")
      .select("*, shipment_items(*)")
      .eq("consignment_id", row.id)
      .order("eway_bill_date", { ascending: false });
    if (error) return toast.error(error.message);
    setView(row);
    setViewShipments((data ?? []) as Record<string, any>[]);
    setScreen("view");
  }

  async function deleteRow(row: Record<string, any>) {
    if (
      !window.confirm(
        `Delete Consignment ${row.consignment_number}? All generated Shipments will also be deleted.`,
      )
    )
      return;
    const { error } = await db.from("consignments").delete().eq("id", row.id);
    if (error) return toast.error(error.message);
    toast.success("Consignment and generated Shipments deleted");
    await loadRows();
  }

  if (screen === "view" && view)
    return (
      <ConsignmentView
        row={view}
        shipments={viewShipments}
        onBack={() => {
          setScreen("list");
          onSidebarVisibilityChange?.(true);
          onCreateModeChange?.(false);
        }}
      />
    );
  if (screen === "create")
    return (
      <>
        <ConsignmentForm
          {...{
            branches,
            branch,
            branchId,
            setBranchId,
            previewNumber,
            contracts,
            sourceId,
            setSourceId,
            type,
            setType,
            ownTransportMode,
            setOwnTransportMode,
            movement,
            setMovement,
            transportMode,
            setTransportMode,
            vehicles,
            vehicleId,
            setVehicleId,
            rentals,
            rentalId,
            setRentalId,
            transporters,
            transporterId,
            setTransporterId,
            fromPin,
            setFromPin,
            toPin,
            setToPin,
            selectedTransporter,
            ewayNo,
            setEwayNo,
            addEway,
            fetching,
            drafts,
            setDrafts,
            save,
            loading,
            openPartner: (kind: "rental" | "transporter") => {
              setPartnerForm(emptyPartner());
              setPartnerDialog(kind);
            },
            onBack: () => {
              setScreen("list");
              onSidebarVisibilityChange?.(true);
              onCreateModeChange?.(false);
            },
          }}
        />
        {partnerDialog && (
          <PartnerDialog
            kind={partnerDialog}
            form={partnerForm}
            setForm={setPartnerForm}
            onClose={() => setPartnerDialog(null)}
            onSave={(updateLater) => void savePartner(updateLater)}
          />
        )}
      </>
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Consignment</h2>
          <p className="text-sm text-muted-foreground">
            One Consignment contains one or more matching E-Way Bills and view-only Shipments.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-1 size-4" /> Create Consignment
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-muted/20 p-3">
        <div className="min-w-[220px] space-y-1.5">
          <Label>Search Consignment</Label>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ABC202600001"
          />
        </div>
        <div className="min-w-[180px] space-y-1.5">
          <Label>Consignment month</Label>
          <Input
            type="month"
            value={monthFilter === "all" ? "" : monthFilter}
            onChange={(event) => setMonthFilter(event.target.value || "all")}
          />
        </div>
        <div className="min-w-[180px] space-y-1.5">
          <Label>Branch</Label>
          <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {branches.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.branch_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[160px] space-y-1.5">
          <Label>Type</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="own">Own</SelectItem>
              <SelectItem value="third_party">Third Party</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Consignment No.</th>
              <th className="px-4 py-3">Branch</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Movement</th>
              <th className="px-4 py-3">Transporter Update</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && !filteredRows.length && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  No consignments found.
                </td>
              </tr>
            )}
            {filteredRows.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="px-4 py-3 font-medium">{row.consignment_number}</td>
                <td className="px-4 py-3">{row.branch?.branch_name ?? "—"}</td>
                <td className="px-4 py-3">
                  <Badge variant="outline">
                    {row.consignment_type === "third_party" ? "Third Party" : "Own"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {row.movement_mode} · {row.transport_mode}
                </td>
                <td className="px-4 py-3">
                  {row.consignment_type === "third_party" ? (
                    <Badge variant="outline">
                      {row.transporter_update_status === "updated"
                        ? "Transporter Updated"
                        : row.transporter_update_status === "partial"
                          ? "Partially Updated — Retry"
                          : "Transporter Update Pending"}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3">
                  {new Date(row.created_at).toLocaleDateString("en-IN")}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button variant="ghost" size="sm" onClick={() => void openView(row)}>
                    <Eye className="mr-1 size-4" /> View
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void deleteRow(row)}>
                    <Trash2 className="mr-1 size-4 text-destructive" /> Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ConsignmentForm(props: any) {
  const {
    branches,
    branch,
    branchId,
    setBranchId,
    previewNumber,
    contracts,
    sourceId,
    setSourceId,
    type,
    setType,
    ownTransportMode,
    setOwnTransportMode,
    movement,
    setMovement,
    transportMode,
    setTransportMode,
    vehicles,
    vehicleId,
    setVehicleId,
    rentals,
    rentalId,
    setRentalId,
    transporters,
    transporterId,
    setTransporterId,
    fromPin,
    setFromPin,
    toPin,
    setToPin,
    selectedTransporter,
    ewayNo,
    setEwayNo,
    addEway,
    fetching,
    drafts,
    setDrafts,
    save,
    loading,
    openPartner,
    onBack,
  } = props;
  const common = drafts[0] as ShipmentDraft | undefined;
  const needsOwnVehicle =
    type === "third_party" ? movement === "drop" : ownTransportMode === "own_vehicle";
  const needsRental = type === "own" && ownTransportMode === "rental";
  const needsTransporter = type === "third_party";
  return (
    <div className="w-full min-w-0 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="shrink-0 text-base font-semibold">Consignment</h2>
          <p className="truncate text-sm text-muted-foreground">
            Create shipments from E-Way Bills
          </p>
        </div>
        <Button variant="outline" onClick={onBack}>
          <X className="mr-1 size-4" /> Cancel
        </Button>
      </div>
      <section className="space-y-1.5 border border-primary/30 bg-primary/[0.02] p-1.5">
        <h3 className="font-semibold">Consignment Details</h3>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-6">
          <ReadonlyField label="Document Type" value="Consignment" />
          <div className="space-y-1.5">
            <Label>Type *</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="own">Own</SelectItem>
                <SelectItem value="third_party">Third Party</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ReadonlyField
            label="Consignment No."
            value={previewNumber ? `${previewNumber} (preview)` : "Select branch to preview number"}
          />
          <SelectField
            label="Branch *"
            value={branchId}
            onChange={setBranchId}
            options={branches.map((item: BranchOption) => ({
              id: item.id,
              label: item.branch_name,
            }))}
            placeholder="Select branch"
          />
          <SelectField
            label="Source *"
            value={sourceId}
            onChange={setSourceId}
            options={contracts}
            placeholder="Select source"
          />
          <ReadonlyField label="Consignment From PIN" value={common?.supplier_pin_code} />
          <ReadonlyField label="Consignment To PIN" value={common?.recipient_pin_code} />
          <div className="space-y-1.5">
            <Label>Mode *</Label>
            <Select value={transportMode} onValueChange={setTransportMode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["Road", "Rail", "Air", "Ship"].map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1.5 sm:col-span-2">
            <Label>E-Way Bill No. *</Label>
            <div className="flex min-w-0 gap-1">
              <Input
                value={ewayNo}
                onChange={(event) => setEwayNo(event.target.value.replace(/\D/g, "").slice(0, 12))}
                placeholder="12-digit E-Way Bill Number"
              />
              <Button type="button" onClick={() => void addEway()} disabled={fetching}>
                {fetching ? "Fetching…" : "Add"}
              </Button>
            </div>
          </div>
        </div>
        <CommonEwayDetails draft={common} />
      </section>
      <section className="space-y-1.5 border border-border p-1.5">
        <h3 className="font-semibold">Transport Assignment</h3>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-6 lg:grid-cols-12">
          <div
            className={`space-y-1.5 sm:col-span-2 lg:col-span-2 ${type !== "own" ? "opacity-60" : ""}`}
          >
            <Label>Own Transport Option *</Label>
            <Select
              value={ownTransportMode}
              onValueChange={setOwnTransportMode}
              disabled={type !== "own"}
            >
              <SelectTrigger disabled={type !== "own"}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="own_vehicle">Own Vehicle</SelectItem>
                <SelectItem value="rental">Rental Vehicle</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div
            className={`space-y-1.5 sm:col-span-2 lg:col-span-2 ${type !== "third_party" ? "opacity-60" : ""}`}
          >
            <Label>Movement *</Label>
            <Select value={movement} onValueChange={setMovement} disabled={type !== "third_party"}>
              <SelectTrigger disabled={type !== "third_party"}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pickup">Pickup — transporter collects from us</SelectItem>
                <SelectItem value="drop">Drop — our vehicle delivers to transporter</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2 lg:col-span-2">
            <SelectField
              label="Vehicle *"
              value={vehicleId}
              onChange={setVehicleId}
              options={vehicles}
              placeholder="Select company vehicle"
              disabled={!needsOwnVehicle}
            />
          </div>
          <div className="col-span-2 min-w-0 space-y-1.5 sm:col-span-3 lg:col-span-3">
            <Label>Rental *</Label>
            <div className="flex min-w-0 gap-2">
              <div className="min-w-0 flex-1">
                <Select value={rentalId} onValueChange={setRentalId} disabled={!needsRental}>
                  <SelectTrigger className="w-full min-w-0" disabled={!needsRental}>
                    <SelectValue placeholder="Select rental provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {rentals.map((item: Master) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => openPartner("rental")}
                disabled={!needsRental}
                className="shrink-0 whitespace-nowrap px-2"
              >
                Create New Rental
              </Button>
            </div>
          </div>
          <div className="col-span-2 min-w-0 space-y-1.5 sm:col-span-3 lg:col-span-3">
            <Label>Transporter *</Label>
            <div className="flex min-w-0 gap-2">
              <div className="min-w-0 flex-1">
                <Select
                  value={transporterId}
                  onValueChange={setTransporterId}
                  disabled={!needsTransporter}
                >
                  <SelectTrigger className="w-full min-w-0" disabled={!needsTransporter}>
                    <SelectValue placeholder="Select transporter" />
                  </SelectTrigger>
                  <SelectContent>
                    {transporters.map((item: Master) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => openPartner("transporter")}
                disabled={!needsTransporter}
                className="shrink-0 whitespace-nowrap px-2"
              >
                Create New
              </Button>
            </div>
          </div>
        </div>
      </section>
      <section className="space-y-1.5 border border-border p-1.5">
        <h3 className="font-semibold">Pincodes</h3>
        <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-6">
          <div className="lg:col-span-3">
            <Label>From Pincode</Label>
            <Input
              value={fromPin}
              onChange={(event) => setFromPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder={branch?.pin_code ?? "Branch pincode"}
            />
          </div>
          <div className="lg:col-span-3">
            <Label>To Pincode *</Label>
            <Input
              value={toPin}
              disabled={type !== "third_party" || movement !== "drop"}
              onChange={(event) => setToPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="Transporter pincode"
            />
          </div>
        </div>
      </section>
      <section className="space-y-1.5 border border-border p-1.5">
        <h3 className="font-semibold">E-Way Bills</h3>
        <EwayTable
          drafts={drafts}
          remove={(index) =>
            setDrafts((items: ShipmentDraft[]) =>
              items.filter((_, itemIndex) => itemIndex !== index),
            )
          }
        />
      </section>
      <section className="space-y-1.5 border border-border p-1.5">
        <h3 className="font-semibold">Goods from all E-Way Bills</h3>
        <GoodsTable drafts={drafts} />
      </section>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onBack}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={loading || drafts.length === 0}>
          {loading ? "Saving…" : "Create Consignment"}
        </Button>
      </div>
    </div>
  );
}

function EwayTable({
  drafts,
  remove,
  readOnly = false,
}: {
  drafts: ShipmentDraft[];
  remove?: (index: number) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            {[
              "EWB No.",
              "Invoice",
              "Generated By",
              "Destination",
              "Valid Until",
              "Status",
              ...(readOnly ? [] : ["Action"]),
            ].map((heading) => (
              <th key={heading} className="px-3 py-2">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {drafts.length === 0 ? (
            <tr>
              <td
                colSpan={readOnly ? 6 : 7}
                className="px-3 py-8 text-center text-muted-foreground"
              >
                Add an E-Way Bill to begin.
              </td>
            </tr>
          ) : (
            drafts.map((draft, index) => (
              <tr key={draft.eway_bill_number} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{draft.eway_bill_number}</td>
                <td className="px-3 py-2">{draft.document_number || "—"}</td>
                <td className="px-3 py-2">{draft.generation_mode}</td>
                <td className="px-3 py-2">{draft.recipient_place || "—"}</td>
                <td className="px-3 py-2">{draft.valid_until || "—"}</td>
                <td className="px-3 py-2">{draft.eway_bill_status || "—"}</td>
                {!readOnly && (
                  <td className="px-3 py-2">
                    <Button variant="ghost" size="sm" onClick={() => remove?.(index)}>
                      Remove
                    </Button>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function CommonEwayDetails({ draft }: { draft?: ShipmentDraft }) {
  return (
    <section className="space-y-1.5 border-t border-border pt-1.5">
      <h3 className="font-semibold">Common E-Way Bill Details</h3>
      <p className="text-xs text-muted-foreground">
        These values apply to every E-Way Bill in this Consignment and are shown once.
      </p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
        <ReadonlyField label="Generation Mode" value={draft?.generation_mode} />
        <ReadonlyField label="Transaction Type" value={draft?.transaction_type} />
        <ReadonlyField label="Supply Type" value={draft?.supply_type} />
        <ReadonlyField label="Sub-Supply Type" value={draft?.sub_type} />
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
        <ReadonlyField label="From GSTIN" value={draft?.supplier_gstin} />
        <ReadonlyField label="From Trade Name" value={draft?.supplier_trade_name} />
        <ReadonlyField label="From Legal Name" value={draft?.supplier_legal_name} />
        <ReadonlyField label="From Address 1" value={draft?.supplier_address_line_1} />
        <ReadonlyField label="From Address 2" value={draft?.supplier_address_line_2} />
        <ReadonlyField label="From Place" value={draft?.supplier_place} />
        <ReadonlyField label="From Pincode" value={draft?.supplier_pin_code} />
        <ReadonlyField label="From State" value={draft?.supplier_state} />
        <ReadonlyField label="To GSTIN" value={draft?.recipient_gstin} />
        <ReadonlyField label="To Trade Name" value={draft?.recipient_trade_name} />
        <ReadonlyField label="To Legal Name" value={draft?.recipient_legal_name} />
        <ReadonlyField label="To Address 1" value={draft?.recipient_address_line_1} />
        <ReadonlyField label="To Address 2" value={draft?.recipient_address_line_2} />
        <ReadonlyField label="To Place" value={draft?.recipient_place} />
        <ReadonlyField label="To Pincode" value={draft?.recipient_pin_code} />
        <ReadonlyField label="To State" value={draft?.recipient_state} />
      </div>
    </section>
  );
}

function GoodsTable({ drafts }: { drafts: ShipmentDraft[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[1100px] text-xs">
        <thead className="bg-muted/40 text-left">
          <tr>
            {[
              "EWB No.",
              "Product",
              "Description",
              "HSN",
              "Quantity",
              "Unit",
              "Weight",
              "Taxable Value",
              "CGST",
              "SGST",
              "IGST",
              "Cess",
              "Total",
            ].map((heading) => (
              <th key={heading} className="px-2 py-2">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {drafts.length === 0 ? (
            <tr>
              <td colSpan={13} className="px-3 py-8 text-center text-muted-foreground">
                Goods will appear here after an E-Way Bill is added.
              </td>
            </tr>
          ) : (
            drafts.flatMap((draft) =>
              draft.items.map((item, index) => (
                <tr key={`${draft.eway_bill_number}-${index}`} className="border-t border-border">
                  <td className="px-2 py-2">{draft.eway_bill_number}</td>
                  <td className="px-2 py-2">{item.product_name || "—"}</td>
                  <td className="px-2 py-2">{item.description || "—"}</td>
                  <td className="px-2 py-2">{item.hsn_code || "—"}</td>
                  <td className="px-2 py-2">{item.quantity || "—"}</td>
                  <td className="px-2 py-2">{item.unit || "—"}</td>
                  <td className="px-2 py-2">{item.weight_kg || "—"}</td>
                  <td className="px-2 py-2">{item.taxable_value || "—"}</td>
                  <td className="px-2 py-2">{item.cgst || "—"}</td>
                  <td className="px-2 py-2">{item.sgst_utgst || "—"}</td>
                  <td className="px-2 py-2">{item.igst || "—"}</td>
                  <td className="px-2 py-2">{item.cess || "—"}</td>
                  <td className="px-2 py-2">{item.total_invoice_value || "—"}</td>
                </tr>
              )),
            )
          )}
        </tbody>
      </table>
    </div>
  );
}

function PartnerDialog({
  kind,
  form,
  setForm,
  onClose,
  onSave,
}: {
  kind: "rental" | "transporter";
  form: PartnerForm;
  setForm: (value: PartnerForm) => void;
  onClose: () => void;
  onSave: (updateLater?: boolean) => void;
}) {
  const update = (key: keyof PartnerForm, value: string) => setForm({ ...form, [key]: value });
  const field = (key: keyof PartnerForm, label: string, type = "text", required = false) => (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <Input
        type={type}
        value={form[key]}
        required={required}
        onChange={(event) => update(key, event.target.value)}
      />
    </div>
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create {kind === "rental" ? "Rental" : "Transporter"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            {field("name", `${kind === "rental" ? "Rental" : "Transporter"} Name *`)}
            {field("legalName", "Legal Business Name")}
            {field("type", "Type")}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {field("gstin", "GSTIN", "text", true)}
            {field("pan", "PAN")}
            {field("pin", "PIN Code", "text", true)}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {field("address1", "Address Line 1")}
            {field("address2", "Address Line 2")}
            {field("city", "City")}
            {field("state", "State")}
            {field("country", "Country")}
            {field("contact", "Primary Contact Person")}
            {field("designation", "Designation")}
            {field("mobile", "Mobile Number")}
            {field("alternateMobile", "Alternate Mobile")}
            {field("email", "Email", "email")}
            {field("telephone", "Telephone")}
            {field("website", "Website")}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {field("bankName", "Bank Name")}
            {field("bankBranch", "Bank Branch")}
            {field("accountHolder", "Account Holder")}
            {field("accountNumber", "Account Number")}
            {field("ifsc", "IFSC")}
            {field("upi", "UPI ID")}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {kind === "rental" && (
            <Button type="button" variant="secondary" onClick={() => onSave(true)}>
              Update Later
            </Button>
          )}
          <Button onClick={() => onSave()}>Save and Select</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConsignmentView({
  row,
  shipments,
  onBack,
}: {
  row: Record<string, any>;
  shipments: Record<string, any>[];
  onBack: () => void;
}) {
  const drafts = shipments.map((shipment) => ({
    ...shipment,
    items: shipment.shipment_items ?? [],
  })) as ShipmentDraft[];
  const totalWeight = drafts.reduce(
    (total, draft) =>
      total + draft.items.reduce((sum, item) => sum + Number(item.weight_kg || 0), 0),
    0,
  );
  const totalQuantity = drafts.reduce(
    (total, draft) =>
      total + draft.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    0,
  );
  const isThirdPartyDrop = row.consignment_type === "third_party" && row.movement_mode === "drop";
  const fromDetails = row.from_details ?? {};
  const toDetails = row.to_details ?? {};
  const commonFromPin = drafts[0]?.supplier_pin_code || fromDetails.pincode || row.from_pin_code;
  const commonToPin = drafts[0]?.recipient_pin_code || toDetails.pincode || row.to_pin_code;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Consignment {row.consignment_number}</h2>
          <p className="text-sm text-muted-foreground">
            View-only Consignment and generated Shipments
          </p>
        </div>
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
      </div>
      <div className="grid gap-3 rounded-xl border border-border p-4 md:grid-cols-4">
        <ReadonlyField label="Document Type" value="Consignment" />
        <ReadonlyField label="Consignment No." value={row.consignment_number} />
        <ReadonlyField label="Branch" value={row.branch?.branch_name} />
        <ReadonlyField
          label="Source / Contract"
          value={row.source?.contract_name || row.source_id}
        />
        <ReadonlyField
          label="Type"
          value={row.consignment_type === "third_party" ? "Third Party" : "Own"}
        />
        <ReadonlyField label="Transport Mode" value={row.transport_mode} />
        <ReadonlyField label="Consignment From PIN" value={commonFromPin} />
        <ReadonlyField label="Consignment To PIN" value={commonToPin} />
      </div>
      <CommonEwayDetails draft={drafts[0]} />
      <section className="space-y-4 rounded-xl border border-border p-4">
        <h3 className="font-semibold">Transport Assignment</h3>
        <div className="grid gap-3 md:grid-cols-3">
          {row.consignment_type === "own" ? (
            <ReadonlyField
              label="Own Transport Option"
              value={row.own_transport_mode === "rental" ? "Rental Vehicle" : "Own Vehicle"}
            />
          ) : (
            <ReadonlyField
              label="Movement"
              value={
                row.movement_mode === "drop"
                  ? "Drop — our vehicle delivers to transporter"
                  : "Pickup — transporter collects from us"
              }
            />
          )}
          <ReadonlyField
            label="Vehicle"
            value={
              row.vehicle
                ? [row.vehicle.registration_number, row.vehicle.nickname]
                    .filter(Boolean)
                    .join(" · ")
                : "—"
            }
          />
          <ReadonlyField
            label="Rental"
            value={
              row.rental
                ? `${row.rental.rental_name}${row.rental.details_pending ? " (Update Later)" : ""}`
                : undefined
            }
          />
          <ReadonlyField label="Transporter" value={row.transporter?.transporter_name} />
          <ReadonlyField label="Transporter GSTIN" value={row.transporter?.gstin} />
          <ReadonlyField label="Transporter PIN Code" value={row.transporter?.pin_code} />
          {row.consignment_type === "third_party" && (
            <ReadonlyField
              label="Transporter Update Status"
              value={
                row.transporter_update_status === "updated"
                  ? "Transporter Updated"
                  : row.transporter_update_status === "partial"
                    ? "Partially Updated — Retry"
                    : "Transporter Update Pending"
              }
            />
          )}
        </div>
      </section>
      <section className="space-y-4 rounded-xl border border-border p-4">
        <h3 className="font-semibold">Pincodes</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <ReadonlyField label="From Pincode" value={row.from_pin_code} />
          {isThirdPartyDrop && <ReadonlyField label="To Pincode" value={row.to_pin_code} />}
        </div>
      </section>
      <section className="space-y-4 rounded-xl border border-border p-4">
        <h3 className="font-semibold">E-Way Bills</h3>
        <EwayTable drafts={drafts} readOnly />
      </section>
      <section className="space-y-3 rounded-xl border border-border p-4">
        <h3 className="font-semibold">Goods from all E-Way Bills</h3>
        <GoodsTable drafts={drafts} />
      </section>
      <section className="space-y-3 rounded-xl border border-border p-4">
        <h3 className="font-semibold">Details</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <ReadonlyField label="Consignment Number" value={row.consignment_number} />
          <ReadonlyField label="Total Weight" value={`${totalWeight.toLocaleString("en-IN")} kg`} />
          <ReadonlyField label="Total Quantity" value={totalQuantity.toLocaleString("en-IN")} />
          <ReadonlyField
            label="Consignment From"
            value={`${fromDetails.trade_name || fromDetails.legal_name || row.from_gstin || "—"} · ${commonFromPin || "—"}`}
          />
          <ReadonlyField
            label="Consignment To"
            value={`${toDetails.trade_name || toDetails.legal_name || row.to_gstin || "—"} · ${commonToPin || "—"}`}
          />
          <ReadonlyField
            label="Transporter From"
            value={isThirdPartyDrop ? row.branch?.branch_name || "—" : "—"}
          />
          <ReadonlyField
            label="Transporter To"
            value={isThirdPartyDrop ? row.transporter?.transporter_name || "—" : "—"}
          />
        </div>
      </section>
    </div>
  );
}

export { PartnerDialog };
