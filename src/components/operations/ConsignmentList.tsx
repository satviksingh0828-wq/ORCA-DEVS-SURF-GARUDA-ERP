import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
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
  valid_from: string;
  valid_until: string;
  document_type: string;
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
  supplier_address: string;
  supplier_place: string;
  supplier_state: string;
  supplier_pin_code: string;
  recipient_gstin: string;
  recipient_trade_name: string;
  recipient_legal_name: string;
  recipient_address_line_1: string;
  recipient_address_line_2: string;
  recipient_address: string;
  recipient_place: string;
  recipient_state: string;
  recipient_pin_code: string;
  dispatch_from_pin_code: string;
  dispatch_from_address: string;
  dispatch_from_address_line_1: string;
  dispatch_from_address_line_2: string;
  dispatch_from_place: string;
  dispatch_from_state: string;
  ship_to_pin_code: string;
  ship_to_address: string;
  ship_to_address_line_1: string;
  ship_to_address_line_2: string;
  ship_to_place: string;
  ship_to_state: string;
  transporter_id: string;
  approximate_distance_km: string;
  cgst_value: string;
  sgst_value: string;
  igst_value: string;
  cess_value: string;
  cess_non_advol_value: string;
  other_value: string;
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

function emptyShipmentItem(): Item {
  return {
    product_name: "",
    description: "",
    hsn_code: "",
    quantity: "1",
    weight_kg: "",
    unit: "NOS",
    taxable_value: "",
    cgst_rate: "",
    sgst_rate: "",
    igst_rate: "",
    cess_rate: "",
    cess_nonadvol: "",
    gst_rate: "",
    cgst: "",
    sgst_utgst: "",
    igst: "",
    cess: "",
    other_tax_charges: "",
    total_invoice_value: "",
  };
}

function emptyManualShipment(ewayBillNumber = ""): ShipmentDraft {
  const today = new Date().toISOString().slice(0, 10);
  return {
    eway_bill_number: ewayBillNumber,
    eway_bill_date: today,
    eway_bill_status: "Active",
    valid_from: "",
    valid_until: "",
    document_type: "Tax Invoice",
    document_number: "",
    document_date: today,
    total_value: "",
    total_taxable_value: "",
    total_invoice_value: "",
    generation_mode: "Manual",
    generation_mode_code: "1",
    transaction_type: "Regular",
    transaction_type_code: "1",
    supply_type: "Outward",
    supply_type_code: "O",
    sub_type: "Supply",
    sub_type_code: "1",
    supplier_gstin: "URP",
    supplier_trade_name: "",
    supplier_legal_name: "",
    supplier_address_line_1: "",
    supplier_address_line_2: "",
    supplier_address: "",
    supplier_place: "",
    supplier_state: "",
    supplier_pin_code: "",
    recipient_gstin: "URP",
    recipient_trade_name: "",
    recipient_legal_name: "",
    recipient_address_line_1: "",
    recipient_address_line_2: "",
    recipient_address: "",
    recipient_place: "",
    recipient_state: "",
    recipient_pin_code: "",
    dispatch_from_pin_code: "",
    dispatch_from_address: "",
    dispatch_from_address_line_1: "",
    dispatch_from_address_line_2: "",
    dispatch_from_place: "",
    dispatch_from_state: "",
    ship_to_pin_code: "",
    ship_to_address: "",
    ship_to_address_line_1: "",
    ship_to_address_line_2: "",
    ship_to_place: "",
    ship_to_state: "",
    transporter_id: "",
    approximate_distance_km: "",
    cgst_value: "",
    sgst_value: "",
    igst_value: "",
    cess_value: "",
    cess_non_advol_value: "",
    other_value: "",
    items: [emptyShipmentItem()],
  };
}

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
  const fromAddress = [from1, from2].filter(Boolean).join(", ");
  const toAddress = [to1, to2].filter(Boolean).join(", ");
  const shipAddress = [ship1, ship2].filter(Boolean).join(", ");
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
    valid_from: dateOnly(source.ewayBillDate || source.ewayBillDateStr),
    valid_until: dateOnly(source.validUpto || source.validUntil),
    document_type:
      read(source, "docType") === "INV" ? "Tax Invoice" : read(source, "docType") || "Tax Invoice",
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
    supplier_address: fromAddress,
    supplier_place: read(source, "fromPlace"),
    supplier_state: read(source, "fromStateCode"),
    supplier_pin_code: read(source, "fromPincode"),
    recipient_gstin: read(source, "toGstin") || "URP",
    recipient_trade_name: read(source, "toTrdName"),
    recipient_legal_name: read(source, "toLegalName") || read(source, "toTrdName"),
    recipient_address_line_1: to1,
    recipient_address_line_2: to2,
    recipient_address: toAddress,
    recipient_place: read(source, "toPlace"),
    recipient_state: read(source, "toStateCode"),
    recipient_pin_code: read(source, "toPincode"),
    dispatch_from_pin_code: read(source, "fromPincode"),
    dispatch_from_address: fromAddress,
    dispatch_from_address_line_1: from1,
    dispatch_from_address_line_2: from2,
    dispatch_from_place: read(source, "fromPlace"),
    dispatch_from_state: read(source, "fromStateCode"),
    ship_to_pin_code: read(source, "shipToPincode") || read(source, "toPincode"),
    ship_to_address: shipAddress,
    ship_to_address_line_1: ship1,
    ship_to_address_line_2: ship2,
    ship_to_place: read(source, "shipToPlace") || read(source, "toPlace"),
    ship_to_state: read(source, "shipToStateCode") || read(source, "toStateCode"),
    transporter_id: read(source, "transporterId"),
    approximate_distance_km: read(source, "transDistance"),
    cgst_value: readAny(source, "cgstValue", "cgst_value"),
    sgst_value: readAny(source, "sgstValue", "sgst_value"),
    igst_value: readAny(source, "igstValue", "igst_value"),
    cess_value: readAny(source, "cessValue", "cess_value"),
    cess_non_advol_value: readAny(source, "cessNonAdvolValue", "cess_non_advol_value"),
    other_value: readAny(source, "otherValue", "other_value"),
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

function ReadonlyField({
  label,
  value,
  dense = false,
}: {
  label: string;
  value: unknown;
  dense?: boolean;
}) {
  return (
    <div className={dense ? "min-w-0 space-y-1" : "min-w-0"}>
      <Label className={dense ? "text-xs font-semibold" : undefined}>{label}</Label>
      <div
        className={
          dense
            ? "mt-1 min-h-8 break-words whitespace-normal border border-input border-l-2 border-l-sky-600 bg-background px-2 py-1.5 text-xs text-foreground"
            : "mt-1 min-h-9 rounded-md border border-input bg-muted/30 px-3 py-2 text-sm"
        }
      >
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
    <div className="min-w-0 space-y-1">
      <Label className="text-xs font-semibold">{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          className="h-8 rounded-none border-l-2 border-l-sky-600 px-2 text-xs"
          disabled={disabled}
        >
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

  async function addEway(ewayBillNumber = ewayNo): Promise<boolean> {
    const number = ewayBillNumber.trim();
    if (!/^\d{12}$/.test(number))
      return (toast.error("E-Way Bill Number must contain exactly 12 digits"), false);
    if (!branchId || !user?.sessionToken)
      return (toast.error("Select a branch and sign in again"), false);
    if (drafts.some((item) => item.eway_bill_number === number))
      return (toast.error("This E-Way Bill is already added"), false);
    setFetching(true);
    try {
      const existing = await db
        .from("shipments")
        .select("id")
        .eq("eway_bill_number", number)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) throw new Error("This E-Way Bill is already used");
      const raw = await serverFetchEwayBillDetails({
        data: { token: user.sessionToken, branchId, ewayBillNumber: number },
      });
      const draft = mapEway(raw);
      if (!draft.eway_bill_number) draft.eway_bill_number = number;
      const partyRows = [
        {
          party_type: "consignor",
          gstin: draft.supplier_gstin.toUpperCase(),
          trade_name: draft.supplier_trade_name,
          legal_name: draft.supplier_legal_name,
          address_1: draft.supplier_address_line_1,
          address_2: draft.supplier_address_line_2,
          place: draft.supplier_place,
          pincode: draft.supplier_pin_code,
          state: draft.supplier_state,
          branch_id: branchId,
          source: "eway_bill",
        },
        {
          party_type: "consignee",
          gstin: draft.recipient_gstin.toUpperCase(),
          trade_name: draft.recipient_trade_name,
          legal_name: draft.recipient_legal_name,
          address_1: draft.recipient_address_line_1,
          address_2: draft.recipient_address_line_2,
          place: draft.recipient_place,
          pincode: draft.recipient_pin_code,
          state: draft.recipient_state,
          branch_id: branchId,
          source: "eway_bill",
        },
      ].filter((party) => party.gstin && party.gstin !== "URP");
      if (partyRows.length) {
        const { error: partyError } = await db
          .from("party_masters")
          .upsert(partyRows, { onConflict: "party_type,gstin" });
        if (partyError) throw partyError;
      }
      if (!draft.items.length) throw new Error("The E-Way Bill has no goods details");
      for (const item of draft.items) {
        const productName = item.product_name.trim();
        if (!productName) continue;
        const product = {
          product_name: productName,
          description: item.description || productName,
          hsn_code: item.hsn_code || "",
          unit: item.unit || "NOS",
          default_quantity: numberValue(item.quantity) || 1,
          default_weight_kg: numberValue(item.weight_kg),
        };
        const existingProduct = await db
          .from("products")
          .select("id")
          .eq("product_name", productName)
          .maybeSingle();
        if (existingProduct.error) throw existingProduct.error;
        const productResult = existingProduct.data
          ? await db.from("products").update(product).eq("id", existingProduct.data.id)
          : await db.from("products").insert(product);
        if (productResult.error) throw productResult.error;
      }
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
      if (!drafts.length) setEwayNo(number);
      toast.success("E-Way Bill fetched and added");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not fetch E-Way Bill details");
      return false;
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
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState<ShipmentDraft>(() => emptyManualShipment());
  const [manualSaving, setManualSaving] = useState(false);
  const [additionalEwayNo, setAdditionalEwayNo] = useState("");
  const common = drafts[0] as ShipmentDraft | undefined;
  const needsOwnVehicle =
    type === "third_party" ? movement === "drop" : ownTransportMode === "own_vehicle";
  const needsRental = type === "own" && ownTransportMode === "rental";
  const needsTransporter = type === "third_party";

  function openManualShipment(number = drafts.length ? "" : ewayNo) {
    setManualDraft({
      ...emptyManualShipment(number),
      transporter_id: branch?.gstin ?? "",
    });
    setManualOpen(true);
  }

  async function addManualShipment() {
    const number = manualDraft.eway_bill_number.trim();
    if (!/^\d{12}$/.test(number)) return toast.error("Enter a valid 12-digit E-Way Bill Number");
    if (!branchId) return toast.error("Select a branch before adding a shipment");
    if (drafts.some((item: ShipmentDraft) => item.eway_bill_number === number))
      return toast.error("This E-Way Bill is already added");
    if (!manualDraft.document_number.trim() || !manualDraft.document_type.trim())
      return toast.error("Document Type and Document Number are required");
    if (!manualDraft.eway_bill_date || !manualDraft.document_date)
      return toast.error("E-Way Bill Date and Document Date are required");
    const items = manualDraft.items.filter((item) =>
      String(item.description || item.product_name || "").trim(),
    );
    if (!items.length) return toast.error("Add at least one product with a description");

    setManualSaving(true);
    try {
      const existing = await db
        .from("shipments")
        .select("id")
        .eq("eway_bill_number", number)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) throw new Error("This E-Way Bill is already used");
      const first = drafts[0] as ShipmentDraft | undefined;
      if (
        first &&
        (first.supplier_gstin.toUpperCase() !== manualDraft.supplier_gstin.toUpperCase() ||
          first.recipient_gstin.toUpperCase() !== manualDraft.recipient_gstin.toUpperCase() ||
          first.dispatch_from_pin_code !== manualDraft.dispatch_from_pin_code ||
          first.ship_to_pin_code !== manualDraft.ship_to_pin_code)
      )
        throw new Error("Every E-Way Bill must have the same From/To GSTINs and Pincodes");

      const taxableTotal = items.reduce((sum, item) => sum + numberValue(item.taxable_value), 0);
      const invoiceTotal = items.reduce(
        (sum, item) => sum + numberValue(item.total_invoice_value),
        0,
      );
      const itemTaxTotal = (key: string) =>
        items.reduce((sum, item) => sum + numberValue(item[key]), 0);
      const shipment: ShipmentDraft = {
        ...manualDraft,
        eway_bill_number: number,
        generation_mode: "Manual",
        generation_mode_code: "1",
        supplier_address: [manualDraft.supplier_address_line_1, manualDraft.supplier_address_line_2]
          .filter(Boolean)
          .join(", "),
        recipient_address: [
          manualDraft.recipient_address_line_1,
          manualDraft.recipient_address_line_2,
        ]
          .filter(Boolean)
          .join(", "),
        dispatch_from_address: [
          manualDraft.dispatch_from_address_line_1,
          manualDraft.dispatch_from_address_line_2,
        ]
          .filter(Boolean)
          .join(", "),
        ship_to_address: [manualDraft.ship_to_address_line_1, manualDraft.ship_to_address_line_2]
          .filter(Boolean)
          .join(", "),
        total_taxable_value: manualDraft.total_taxable_value || String(taxableTotal),
        total_invoice_value: manualDraft.total_invoice_value || String(invoiceTotal),
        total_value: manualDraft.total_value || String(invoiceTotal),
        cgst_value: manualDraft.cgst_value || String(itemTaxTotal("cgst")),
        sgst_value: manualDraft.sgst_value || String(itemTaxTotal("sgst_utgst")),
        igst_value: manualDraft.igst_value || String(itemTaxTotal("igst")),
        cess_value: manualDraft.cess_value || String(itemTaxTotal("cess")),
        cess_non_advol_value:
          manualDraft.cess_non_advol_value || String(itemTaxTotal("cess_nonadvol")),
        other_value: manualDraft.other_value || String(itemTaxTotal("other_tax_charges")),
        items: items.map((item) => ({
          ...item,
          gst_rate:
            item.gst_rate ||
            String(
              numberValue(item.cgst_rate) +
                numberValue(item.sgst_rate) +
                numberValue(item.igst_rate),
            ),
        })),
      };
      setDrafts((current: ShipmentDraft[]) => [...current, shipment]);
      if (!drafts.length) {
        setEwayNo(number);
        setFromPin(shipment.supplier_pin_code);
      }
      setManualOpen(false);
      toast.success("Manual shipment added; no E-Way Bill API was called");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add manual shipment");
    } finally {
      setManualSaving(false);
    }
  }

  async function addAdditionalEway() {
    if (await props.addEway(additionalEwayNo)) setAdditionalEwayNo("");
  }

  function removeEway(index: number) {
    const remaining = (drafts as ShipmentDraft[]).filter((_, itemIndex) => itemIndex !== index);
    setDrafts(remaining);
    setEwayNo(remaining[0]?.eway_bill_number ?? "");
  }

  return (
    <>
      <div className="consignment-entry w-full min-w-0 space-y-0 bg-background p-3 text-foreground">
        <div className="-mx-3 -mt-3 mb-3 flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/70 px-4 py-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="shrink-0 text-base font-semibold">Consignment / Create</h2>
            <p className="truncate text-xs text-muted-foreground">
              Create consignment from E-Way Bills
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => void save()} disabled={loading || drafts.length === 0}>
              {loading ? "Saving…" : "Create Consignment"}
            </Button>
            <Button variant="outline" onClick={onBack}>
              <X className="mr-1 size-4" /> Discard
            </Button>
          </div>
        </div>
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Four-column entry layout · E-Way Bill details are populated from the added bill.
          </span>
          <span>{branch?.branch_name ?? "Select branch"}</span>
        </div>
        <section className="consignment-section space-y-3 border-t-2 border-sky-700 pt-3">
          <h3 className="text-sm font-semibold text-sky-800">Consignment Details</h3>
          <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            <ReadonlyField dense label="Document Type" value="Consignment" />
            <div className="min-w-0 space-y-1">
              <Label className="text-xs font-semibold">Type *</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="h-8 rounded-none border-l-2 border-l-sky-600 px-2 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="own">Own</SelectItem>
                  <SelectItem value="third_party">Third Party</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <ReadonlyField
              dense
              label="Consignment No."
              value={
                previewNumber ? `${previewNumber} (preview)` : "Select branch to preview number"
              }
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
            <ReadonlyField dense label="Consignment From PIN" value={common?.supplier_pin_code} />
            <ReadonlyField dense label="Consignment To PIN" value={common?.recipient_pin_code} />
            <div className="min-w-0 space-y-1">
              <Label className="text-xs font-semibold">Mode *</Label>
              <Select value={transportMode} onValueChange={setTransportMode}>
                <SelectTrigger className="h-8 rounded-none border-l-2 border-l-sky-600 px-2 text-xs">
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
            <div className="min-w-0 space-y-1 xl:col-span-2">
              <Label className="text-xs font-semibold">E-Way Bill No. *</Label>
              <div className="flex min-w-0 flex-wrap gap-1">
                <Input
                  value={ewayNo}
                  onChange={(event) =>
                    setEwayNo(event.target.value.replace(/\D/g, "").slice(0, 12))
                  }
                  placeholder="12-digit E-Way Bill Number"
                  className="h-8 rounded-none border-l-2 border-l-sky-600 text-xs"
                  readOnly={drafts.length > 0}
                />
                <Button
                  type="button"
                  onClick={() => void addEway(ewayNo)}
                  disabled={fetching || drafts.length > 0}
                >
                  {fetching ? "Fetching…" : "Verify / Add"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => openManualShipment()}
                  disabled={drafts.length > 0}
                >
                  Add Manually
                </Button>
              </div>
            </div>
          </div>
          <CommonEwayDetails draft={common} />
        </section>
        <section className="consignment-section mt-5 space-y-3 border-t-2 border-sky-700 pt-3">
          <h3 className="text-sm font-semibold text-sky-800">Transport Assignment</h3>
          <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className={`min-w-0 space-y-1 ${type !== "own" ? "opacity-60" : ""}`}>
              <Label className="text-xs font-semibold">Own Transport Option *</Label>
              <Select
                value={ownTransportMode}
                onValueChange={setOwnTransportMode}
                disabled={type !== "own"}
              >
                <SelectTrigger
                  className="h-8 rounded-none border-l-2 border-l-sky-600 px-2 text-xs"
                  disabled={type !== "own"}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="own_vehicle">Own Vehicle</SelectItem>
                  <SelectItem value="rental">Rental Vehicle</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className={`min-w-0 space-y-1 ${type !== "third_party" ? "opacity-60" : ""}`}>
              <Label className="text-xs font-semibold">Movement *</Label>
              <Select
                value={movement}
                onValueChange={setMovement}
                disabled={type !== "third_party"}
              >
                <SelectTrigger
                  className="h-8 rounded-none border-l-2 border-l-sky-600 px-2 text-xs"
                  disabled={type !== "third_party"}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pickup">Pickup — transporter collects from us</SelectItem>
                  <SelectItem value="drop">Drop — our vehicle delivers to transporter</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <SelectField
                label="Vehicle *"
                value={vehicleId}
                onChange={setVehicleId}
                options={vehicles}
                placeholder="Select company vehicle"
                disabled={!needsOwnVehicle}
              />
            </div>
            <div className="col-span-1 min-w-0 space-y-1 sm:col-span-2 xl:col-span-2">
              <Label className="text-xs font-semibold">Rental *</Label>
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
            <div className="col-span-1 min-w-0 space-y-1 sm:col-span-2 xl:col-span-2">
              <Label className="text-xs font-semibold">Transporter *</Label>
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
        <section className="consignment-section mt-5 space-y-3 border-t-2 border-sky-700 pt-3">
          <h3 className="text-sm font-semibold text-sky-800">Pincodes</h3>
          <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <Label className="text-xs font-semibold">From Pincode</Label>
              <Input
                className="h-8 rounded-none border-l-2 border-l-sky-600 text-xs"
                value={fromPin}
                onChange={(event) => setFromPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder={branch?.pin_code ?? "Branch pincode"}
              />
            </div>
            <div className="min-w-0 space-y-1">
              <Label className="text-xs font-semibold">To Pincode *</Label>
              <Input
                className="h-8 rounded-none border-l-2 border-l-sky-600 text-xs"
                value={toPin}
                disabled={type !== "third_party" || movement !== "drop"}
                onChange={(event) => setToPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="Transporter pincode"
              />
            </div>
          </div>
        </section>
        <section className="consignment-section mt-5 space-y-3 border-t-2 border-sky-700 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-sky-800">E-Way Bills</h3>
            <Button type="button" variant="outline" onClick={() => openManualShipment()}>
              <Plus className="mr-1 size-4" /> Add Manually
            </Button>
          </div>
          <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0 space-y-1">
              <Label className="text-xs font-semibold">Add Another E-Way Bill No.</Label>
              <Input
                value={additionalEwayNo}
                onChange={(event) =>
                  setAdditionalEwayNo(event.target.value.replace(/\D/g, "").slice(0, 12))
                }
                placeholder="12-digit E-Way Bill Number"
                className="h-8 rounded-none border-l-2 border-l-sky-600 text-xs"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void addAdditionalEway()}
              disabled={fetching || !additionalEwayNo}
            >
              {fetching ? "Fetching…" : "Verify / Add"}
            </Button>
          </div>
          <EwayTable drafts={drafts} remove={removeEway} />
        </section>
        <section className="consignment-section mt-5 space-y-3 border-t-2 border-sky-700 pt-3">
          <h3 className="text-sm font-semibold text-sky-800">Goods from all E-Way Bills</h3>
          <GoodsTable drafts={drafts} />
        </section>
        <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onBack}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={loading || drafts.length === 0}>
            {loading ? "Saving…" : "Create Consignment"}
          </Button>
        </div>
      </div>
      <ManualShipmentDialog
        open={manualOpen}
        draft={manualDraft}
        setDraft={setManualDraft}
        saving={manualSaving}
        onClose={() => setManualOpen(false)}
        onSave={() => void addManualShipment()}
      />
    </>
  );
}

type EditableShipmentField = Exclude<keyof ShipmentDraft, "items">;

function ManualShipmentDialog({
  open,
  draft,
  setDraft,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  draft: ShipmentDraft;
  setDraft: Dispatch<SetStateAction<ShipmentDraft>>;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const [partyLoading, setPartyLoading] = useState<"consignor" | "consignee" | null>(null);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productPickerIndex, setProductPickerIndex] = useState(0);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(() => new Set([0]));
  const [productCreateOpen, setProductCreateOpen] = useState(false);
  const [products, setProducts] = useState<Array<Record<string, any>>>([]);
  const [productSearch, setProductSearch] = useState("");
  const [newProduct, setNewProduct] = useState({
    product_name: "",
    description: "",
    hsn_code: "",
    unit: "NOS",
    default_quantity: "1",
    default_weight_kg: "",
  });
  const setField = (key: EditableShipmentField, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const setItem = (index: number, key: string, value: string) =>
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    }));
  useEffect(() => {
    const items = draft.items;
    const totalTaxable = items.reduce((sum, item) => sum + numberValue(item.taxable_value), 0);
    const totalInvoice = items.reduce(
      (sum, item) => sum + numberValue(item.total_invoice_value),
      0,
    );
    const taxTotal = (key: string) => items.reduce((sum, item) => sum + numberValue(item[key]), 0);
    setDraft((current) => ({
      ...current,
      total_value: String(
        totalTaxable +
          taxTotal("cgst") +
          taxTotal("sgst_utgst") +
          taxTotal("igst") +
          taxTotal("cess") +
          taxTotal("other_tax_charges"),
      ),
      total_taxable_value: String(totalTaxable),
      total_invoice_value: String(totalInvoice),
      cgst_value: String(taxTotal("cgst")),
      sgst_value: String(taxTotal("sgst_utgst")),
      igst_value: String(taxTotal("igst")),
      cess_value: String(taxTotal("cess")),
      cess_non_advol_value: String(taxTotal("cess_nonadvol")),
      other_value: String(taxTotal("other_tax_charges")),
    }));
  }, [draft.items, setDraft]);
  const field = (key: EditableShipmentField, label: string, type = "text", required = false) => (
    <div className="min-w-0 space-y-1">
      <Label className="text-xs font-semibold">
        {label}
        {required ? " *" : ""}
      </Label>
      <Input
        className="h-8 rounded-none border-l-2 border-l-sky-600 text-xs"
        type={type}
        required={required}
        value={draft[key]}
        onChange={(event) => setField(key, event.target.value)}
      />
    </div>
  );
  async function fetchParty(kind: "consignor" | "consignee") {
    const gstinKey = kind === "consignor" ? "supplier_gstin" : "recipient_gstin";
    const gstin = draft[gstinKey].trim().toUpperCase();
    if (!gstin) return toast.error("Enter a GSTIN first");
    setPartyLoading(kind);
    const { data, error } = await db
      .from("party_masters")
      .select("*")
      .eq("party_type", kind)
      .eq("gstin", gstin)
      .maybeSingle();
    setPartyLoading(null);
    if (error) return toast.error(error.message);
    if (!data) return toast.info(`No ${kind} master found for ${gstin}. Create it from Masters.`);
    const prefix = kind === "consignor" ? "supplier" : "recipient";
    const updates: Record<string, string> = {
      [`${prefix}_gstin`]: data.gstin ?? gstin,
      [`${prefix}_trade_name`]: data.trade_name ?? "",
      [`${prefix}_legal_name`]: data.legal_name ?? "",
      [`${prefix}_address_line_1`]: data.address_1 ?? "",
      [`${prefix}_address_line_2`]: data.address_2 ?? "",
      [`${prefix}_place`]: data.place ?? "",
      [`${prefix}_state`]: data.state ?? "",
      [`${prefix}_pin_code`]: data.pincode ?? "",
    };
    if (kind === "consignor")
      Object.assign(updates, {
        dispatch_from_address_line_1: data.address_1 ?? "",
        dispatch_from_address_line_2: data.address_2 ?? "",
        dispatch_from_place: data.place ?? "",
        dispatch_from_state: data.state ?? "",
        dispatch_from_pin_code: data.pincode ?? "",
      });
    else
      Object.assign(updates, {
        ship_to_address_line_1: data.address_1 ?? "",
        ship_to_address_line_2: data.address_2 ?? "",
        ship_to_place: data.place ?? "",
        ship_to_state: data.state ?? "",
        ship_to_pin_code: data.pincode ?? "",
      });
    setDraft((current) => ({ ...current, ...updates }));
    toast.success(`${kind === "consignor" ? "Consignor" : "Consignee"} details fetched`);
  }
  async function openProductPicker(index = 0) {
    const { data, error } = await db.from("products").select("*").order("product_name").limit(200);
    if (error) return toast.error(error.message);
    setProducts(data ?? []);
    setProductPickerIndex(index);
    setProductPickerOpen(true);
  }
  function chooseProduct(product: Record<string, any>, index: number) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              product_name: product.product_name ?? "",
              description: product.description || product.product_name || "",
              hsn_code: product.hsn_code ?? "",
              unit: product.unit || "NOS",
              quantity: String(product.default_quantity ?? 1),
              weight_kg: String(product.default_weight_kg ?? ""),
            }
          : item,
      ),
    }));
    setProductPickerOpen(false);
  }
  async function createProduct() {
    if (!newProduct.product_name.trim()) return toast.error("Product name is required");
    const { data, error } = await db
      .from("products")
      .insert({
        ...newProduct,
        default_quantity: Number(newProduct.default_quantity || 1),
        default_weight_kg: Number(newProduct.default_weight_kg || 0),
      })
      .select("*")
      .single();
    if (error) return toast.error(error.message);
    setProducts((current) => [...current, data]);
    setNewProduct({
      product_name: "",
      description: "",
      hsn_code: "",
      unit: "NOS",
      default_quantity: "1",
      default_weight_kg: "",
    });
    setProductCreateOpen(false);
    toast.success("Product created");
  }
  const partyField = (kind: "consignor" | "consignee") => {
    const key = kind === "consignor" ? "supplier_gstin" : "recipient_gstin";
    return (
      <div className="min-w-0 space-y-1">
        <Label className="text-xs font-semibold">
          {kind === "consignor" ? "Consignor" : "Consignee"} GSTIN
        </Label>
        <div className="flex gap-1">
          <Input
            className="h-8 rounded-none border-l-2 border-l-sky-600 text-xs"
            value={draft[key]}
            onChange={(event) => setField(key, event.target.value.toUpperCase())}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void fetchParty(kind)}
            disabled={partyLoading !== null}
          >
            {partyLoading === kind ? "Fetching…" : "Fetch"}
          </Button>
        </div>
      </div>
    );
  };
  const itemField = (
    index: number,
    key: string,
    label: string,
    type = "text",
    required = false,
  ) => (
    <div className="min-w-0 space-y-1">
      <Label className="text-xs font-semibold">
        {label}
        {required ? " *" : ""}
      </Label>
      <Input
        className="h-8 rounded-none border-l-2 border-l-sky-600 text-xs"
        type={type}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? "any" : undefined}
        required={required}
        value={String(draft.items[index]?.[key] ?? "")}
        onChange={(event) => setItem(index, key, event.target.value)}
      />
    </div>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
        <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Shipment Manually</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Complete the bill, both parties and product lines. No E-Way Bill service call will be
              made.
            </p>
          </DialogHeader>
          <div className="space-y-5 py-1">
            <section className="consignment-section space-y-3 border-t-2 border-sky-700 pt-3">
              <h3 className="text-sm font-semibold text-sky-800">
                E-Way Bill and Document Details
              </h3>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
                {field("eway_bill_number", "E-Way Bill Number", "text", true)}
                {field("eway_bill_date", "E-Way Bill Date", "date", true)}
                {field("eway_bill_status", "E-Way Bill Status")}
                {field("valid_from", "Valid From", "date")}
                {field("valid_until", "Valid Until", "date")}
                {field("document_type", "Document Type", "text", true)}
                {field("document_number", "Document Number", "text", true)}
                {field("document_date", "Document Date", "date", true)}
                <ReadonlyField dense label="Generation Mode" value="Manual" />
                {field("transaction_type", "Transaction Type")}
                {field("supply_type", "Supply Type")}
                {field("sub_type", "Sub-Supply Type")}
                {field("total_value", "Total Value", "number")}
                {field("total_taxable_value", "Total Taxable Value", "number")}
                {field("total_invoice_value", "Total Invoice Value", "number")}
                {field("cgst_value", "Total CGST", "number")}
                {field("sgst_value", "Total SGST / UTGST", "number")}
                {field("igst_value", "Total IGST", "number")}
                {field("cess_value", "Total Cess", "number")}
                {field("cess_non_advol_value", "Total Cess Non-Advol", "number")}
                {field("other_value", "Other Charges", "number")}
                {field("transporter_id", "Transporter GSTIN / ID")}
                {field("approximate_distance_km", "Approx. Distance (KM)", "number")}
              </div>
            </section>
            <section className="consignment-section space-y-3 border-t-2 border-sky-700 pt-3">
              <h3 className="text-sm font-semibold text-sky-800">Consignor / From Party</h3>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
                {partyField("consignor")}
                {field("supplier_trade_name", "Consignor Trade Name")}
                {field("supplier_legal_name", "Consignor Legal Name")}
                {field("supplier_address_line_1", "Consignor Address 1")}
                {field("supplier_address_line_2", "Consignor Address 2")}
                {field("supplier_place", "Consignor Place")}
                {field("supplier_state", "Consignor State")}
                {field("supplier_pin_code", "Consignor PIN Code")}
              </div>
            </section>
            <section className="consignment-section space-y-3 border-t-2 border-sky-700 pt-3">
              <h3 className="text-sm font-semibold text-sky-800">Consignee / To Party</h3>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
                {partyField("consignee")}
                {field("recipient_trade_name", "Consignee Trade Name")}
                {field("recipient_legal_name", "Consignee Legal Name")}
                {field("recipient_address_line_1", "Consignee Address 1")}
                {field("recipient_address_line_2", "Consignee Address 2")}
                {field("recipient_place", "Consignee Place")}
                {field("recipient_state", "Consignee State")}
                {field("recipient_pin_code", "Consignee PIN Code")}
              </div>
            </section>
            <section className="consignment-section space-y-3 border-t-2 border-sky-700 pt-3">
              <h3 className="text-sm font-semibold text-sky-800">Dispatch From / Ship To</h3>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
                {field("dispatch_from_address_line_1", "Dispatch From Address 1")}
                {field("dispatch_from_address_line_2", "Dispatch From Address 2")}
                {field("dispatch_from_place", "Dispatch From Place")}
                {field("dispatch_from_state", "Dispatch From State")}
                {field("dispatch_from_pin_code", "Dispatch From PIN")}
                {field("ship_to_address_line_1", "Ship To Address 1")}
                {field("ship_to_address_line_2", "Ship To Address 2")}
                {field("ship_to_place", "Ship To Place")}
                {field("ship_to_state", "Ship To State")}
                {field("ship_to_pin_code", "Ship To PIN")}
              </div>
            </section>
            <section className="consignment-section space-y-3 border-t-2 border-sky-700 pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-sky-800">Products / Goods</h3>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => void openProductPicker(0)}>
                    <Search className="mr-1 size-4" /> Products / Goods List
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setProductCreateOpen(true)}
                  >
                    Create Product
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setDraft((current) => ({
                        ...current,
                        items: [...current.items, emptyShipmentItem()],
                      }));
                      setExpandedItems((current) => new Set([...current, draft.items.length]));
                    }}
                  >
                    <Plus className="mr-1 size-4" /> Add Product
                  </Button>
                </div>
              </div>
              {draft.items.map((item, index) => {
                const expanded = expandedItems.has(index);
                return (
                  <div key={index} className="overflow-hidden rounded-lg border border-border">
                    <div className="flex items-center gap-2 bg-muted/30 p-2">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded px-2 py-2 text-left hover:bg-muted"
                        onClick={() =>
                          setExpandedItems((current) => {
                            const next = new Set(current);
                            if (next.has(index)) next.delete(index);
                            else next.add(index);
                            return next;
                          })
                        }
                        aria-expanded={expanded}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="text-xs font-bold uppercase tracking-wide text-sky-800">
                            Product {index + 1}
                          </span>
                          <span className="truncate text-sm font-medium">
                            {String(item.product_name || item.description || "Unnamed product")}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold">
                          Invoice Value: ₹
                          {numberValue(item.total_invoice_value).toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                          })}
                          <span className="ml-2 text-muted-foreground">{expanded ? "▲" : "▼"}</span>
                        </span>
                      </button>
                      {draft.items.length > 1 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setDraft((current) => ({
                              ...current,
                              items: current.items.filter((_, itemIndex) => itemIndex !== index),
                            }))
                          }
                          aria-label={`Remove product ${index + 1}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                    {expanded && (
                      <div className="grid grid-cols-1 gap-x-4 gap-y-3 border-t border-border p-3 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="flex items-end gap-1">
                          <div className="min-w-0 flex-1">
                            {itemField(index, "product_name", "Product Name")}
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void openProductPicker(index)}
                          >
                            List
                          </Button>
                        </div>
                        {itemField(index, "description", "Description", "text", true)}
                        {itemField(index, "hsn_code", "HSN Code", "text", true)}
                        {itemField(index, "quantity", "Quantity", "number")}
                        {itemField(index, "unit", "Unit")}
                        {itemField(index, "weight_kg", "Weight (KG)", "number")}
                        {itemField(index, "taxable_value", "Taxable Value", "number")}
                        {itemField(index, "cgst_rate", "CGST %", "number")}
                        {itemField(index, "sgst_rate", "SGST %", "number")}
                        {itemField(index, "igst_rate", "IGST %", "number")}
                        {itemField(index, "cess_rate", "Cess %", "number")}
                        {itemField(index, "cess_nonadvol", "Cess Non-Advol", "number")}
                        {itemField(index, "cgst", "CGST Amount", "number")}
                        {itemField(index, "sgst_utgst", "SGST Amount", "number")}
                        {itemField(index, "igst", "IGST Amount", "number")}
                        {itemField(index, "cess", "Cess Amount", "number")}
                        {itemField(index, "other_tax_charges", "Other Tax Charges", "number")}
                        {itemField(index, "total_invoice_value", "Invoice Value", "number")}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={onSave} disabled={saving}>
              {saving ? "Adding…" : "Add Manual Shipment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={productPickerOpen} onOpenChange={setProductPickerOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Products / Goods</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Search products"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
          />
          <div className="max-h-[50vh] overflow-y-auto rounded border">
            {products
              .filter(
                (p) =>
                  !productSearch ||
                  String(p.product_name).toLowerCase().includes(productSearch.toLowerCase()) ||
                  String(p.hsn_code).includes(productSearch),
              )
              .map((product) => (
                <button
                  type="button"
                  key={product.id}
                  className="flex w-full items-center justify-between border-b p-3 text-left hover:bg-muted"
                  onClick={() => chooseProduct(product, productPickerIndex)}
                >
                  <span className="font-medium">{product.product_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {product.hsn_code || "No HSN"} · {product.unit}
                  </span>
                </button>
              ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={productCreateOpen} onOpenChange={setProductCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Product</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["product_name", "Product Name"],
                ["description", "Description"],
                ["hsn_code", "HSN Code"],
                ["unit", "Unit"],
                ["default_quantity", "Default Quantity"],
                ["default_weight_kg", "Default Weight (KG)"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-1.5">
                <Label>{label}</Label>
                <Input
                  type={key.includes("quantity") || key.includes("weight") ? "number" : "text"}
                  value={newProduct[key]}
                  onChange={(e) => setNewProduct({ ...newProduct, [key]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void createProduct()}>Create Product</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
        <thead className="bg-sky-800 text-left text-xs text-white">
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
    <section className="consignment-section mt-5 space-y-3 border-t-2 border-sky-700 pt-3">
      <h3 className="text-sm font-semibold text-sky-800">Common E-Way Bill Details</h3>
      <p className="-mt-2 text-xs text-muted-foreground">
        These values apply to every E-Way Bill in this Consignment and are shown once.
      </p>
      <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
        <ReadonlyField dense label="Generation Mode" value={draft?.generation_mode} />
        <ReadonlyField dense label="Transaction Type" value={draft?.transaction_type} />
        <ReadonlyField dense label="Supply Type" value={draft?.supply_type} />
        <ReadonlyField dense label="Sub-Supply Type" value={draft?.sub_type} />
      </div>
      <div className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wide text-foreground">
          Consignor / From Party
        </h4>
        <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
          <ReadonlyField dense label="Consignor GSTIN" value={draft?.supplier_gstin} />
          <ReadonlyField dense label="Consignor Trade Name" value={draft?.supplier_trade_name} />
          <ReadonlyField dense label="Consignor Legal Name" value={draft?.supplier_legal_name} />
          <ReadonlyField dense label="Consignor Address 1" value={draft?.supplier_address_line_1} />
          <ReadonlyField dense label="Consignor Address 2" value={draft?.supplier_address_line_2} />
          <ReadonlyField dense label="Consignor Place" value={draft?.supplier_place} />
          <ReadonlyField dense label="Consignor Pincode" value={draft?.supplier_pin_code} />
          <ReadonlyField dense label="Consignor State" value={draft?.supplier_state} />
        </div>
        <h4 className="pt-1 text-xs font-bold uppercase tracking-wide text-foreground">
          Consignee / To Party
        </h4>
        <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
          <ReadonlyField dense label="Consignee GSTIN" value={draft?.recipient_gstin} />
          <ReadonlyField dense label="Consignee Trade Name" value={draft?.recipient_trade_name} />
          <ReadonlyField dense label="Consignee Legal Name" value={draft?.recipient_legal_name} />
          <ReadonlyField
            dense
            label="Consignee Address 1"
            value={draft?.recipient_address_line_1}
          />
          <ReadonlyField
            dense
            label="Consignee Address 2"
            value={draft?.recipient_address_line_2}
          />
          <ReadonlyField dense label="Consignee Place" value={draft?.recipient_place} />
          <ReadonlyField dense label="Consignee Pincode" value={draft?.recipient_pin_code} />
          <ReadonlyField dense label="Consignee State" value={draft?.recipient_state} />
        </div>
      </div>
    </section>
  );
}

function GoodsTable({ drafts }: { drafts: ShipmentDraft[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[1100px] text-xs">
        <thead className="bg-sky-800 text-left text-white">
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
