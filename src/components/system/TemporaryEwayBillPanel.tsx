import { useMemo, useState } from "react";
import { Copy, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useBranches } from "@/lib/use-branches";
import { useSession } from "@/lib/session";
import { serverGenerateTemporaryEwayBill } from "@/lib/ewaybill-temporary";

const SAMPLE_PAYLOAD = {
  supplyType: "O",
  subSupplyType: "1",
  subSupplyDesc: "",
  docType: "INV",
  docNo: "PJAI260725",
  docDate: "07/09/2026",
  fromGstin: "08AHFPJ5504J1ZD",
  fromTrdName: "Atul Limited - ADH Jaipur depot",
  fromAddr1: "Road No 14, VKIA",
  fromAddr2: "",
  fromPlace: "Jaipur",
  fromPincode: 302013,
  actFromStateCode: 8,
  fromStateCode: 8,
  toGstin: "08AHFPJ5504J1ZD",
  toTrdName: "SHREE JI CHEM, UDAIPUR",
  toAddr1: "3 D.M. MARKET, INSIDE DELHI GATE",
  toAddr2: "SUTHARWADA ROAD",
  toPlace: "Udaipur",
  toPincode: 313001,
  actToStateCode: 8,
  toStateCode: 8,
  transactionType: 1,
  shipToGSTIN: "08AHFPJ5504J1ZD",
  shipToTradeName: "SHREE JI CHEM, UDAIPUR",
  otherValue: 0,
  totalValue: 132082.45,
  cgstValue: 11887.42,
  sgstValue: 11887.42,
  igstValue: 0,
  cessValue: 0,
  cessNonAdvolValue: 0,
  totInvValue: 155857.29,
  transporterId: "",
  transporterName: "KAMAL FREIGHT CARRIER",
  transDocNo: "",
  transMode: "1",
  transDistance: "0",
  transDocDate: "",
  vehicleNo: "RJ14AB1234",
  vehicleType: "R",
  itemList: [
    {
      productName: "POLYGRIP S 709 :: 4 X 5 LTRS (ROUND)",
      productDesc: "POLYGRIP S 709 :: 4 X 5 LTRS (ROUND)",
      hsnCode: 35069190,
      quantity: 120,
      qtyUnit: "LTR",
      cgstRate: 9,
      sgstRate: 9,
      igstRate: 0,
      cessRate: 0,
      cessNonadvol: 0,
      taxableAmount: 30600,
    },
  ],
};

export function TemporaryEwayBillPanel() {
  const { user } = useSession();
  const branches = useBranches();
  const [branchId, setBranchId] = useState("");
  const [json, setJson] = useState(() => JSON.stringify(SAMPLE_PAYLOAD, null, 2));
  const [response, setResponse] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const selectedBranch = useMemo(
    () => branches.find((branch) => branch.id === branchId),
    [branches, branchId],
  );

  async function generate() {
    if (!user?.sessionToken) return toast.error("Your session has expired. Please sign in again.");
    if (!branchId) return toast.error("Select a branch first");
    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(json);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
        throw new Error("JSON must be an object");
      payload = parsed as Record<string, unknown>;
      const itemList = payload.itemList;
      if (!Array.isArray(itemList) || itemList.length === 0) {
        throw new Error("itemList must contain at least one item");
      }
      if (String(payload.transMode ?? "") === "1" && !String(payload.vehicleNo ?? "").trim()) {
        throw new Error("vehicleNo is required when transMode is Road (1)");
      }
      const branchGstin = String(selectedBranch?.gstin ?? "")
        .trim()
        .toUpperCase();
      const payloadFromGstin = String(payload.fromGstin ?? "")
        .trim()
        .toUpperCase();
      if (branchGstin && payloadFromGstin && branchGstin !== payloadFromGstin) {
        throw new Error(
          `fromGstin ${payloadFromGstin} does not match selected branch GSTIN ${branchGstin}`,
        );
      }
      // The GST E-Way Bill master uses PAC (Packs); PKT is not a valid UQC.
      payload = {
        ...payload,
        itemList: itemList.map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return item;
          const row = item as Record<string, unknown>;
          return String(row.qtyUnit ?? "")
            .trim()
            .toUpperCase() === "PKT"
            ? { ...row, qtyUnit: "PAC" }
            : row;
        }),
      };
    } catch (error) {
      return toast.error(
        error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON",
      );
    }
    const docNo = typeof payload.docNo === "string" ? payload.docNo : "without a document number";
    if (
      !window.confirm(
        `Generate a temporary E-Way Bill for ${selectedBranch?.branch_name ?? "this branch"} (${docNo})? This calls the E-Way Bill API and does not save an ORCA shipment.`,
      )
    )
      return;
    setLoading(true);
    setResponse(null);
    try {
      const result = await serverGenerateTemporaryEwayBill({
        data: { token: user.sessionToken, branchId, payload },
      });
      setResponse(result.response);
      toast.success("Temporary E-Way Bill API request completed");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not generate temporary E-Way Bill",
      );
    } finally {
      setLoading(false);
    }
  }

  async function copyResponse() {
    if (response == null) return;
    await navigator.clipboard.writeText(JSON.stringify(response, null, 2));
    toast.success("Response copied");
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-300/60 bg-amber-50/70 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
        Temporary tool only: the JSON is sent to the configured E-Way Bill API and the response is
        shown here. It does not create an ORCA shipment or save the returned E-Way Bill.
      </div>
      <div className="surface-card space-y-5 p-5">
        <div className="space-y-2">
          <Label>Branch *</Label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger>
              <SelectValue placeholder="Select branch" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.branch_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label>Generation JSON *</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setJson(JSON.stringify(SAMPLE_PAYLOAD, null, 2))}
            >
              Load sample
            </Button>
          </div>
          <Textarea
            value={json}
            onChange={(event) => setJson(event.target.value)}
            className="min-h-[520px] font-mono text-xs"
            spellCheck={false}
          />
        </div>
        <Button type="button" onClick={() => void generate()} disabled={loading || !branchId}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Generate temporary E-Way Bill
        </Button>
      </div>
      {response !== null && (
        <div className="surface-card space-y-3 p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">API Response</h3>
            <Button type="button" variant="outline" size="sm" onClick={() => void copyResponse()}>
              <Copy className="size-4" /> Copy
            </Button>
          </div>
          <pre className="max-h-[520px] overflow-auto rounded-lg bg-muted/50 p-4 text-xs leading-5">
            {JSON.stringify(response, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
