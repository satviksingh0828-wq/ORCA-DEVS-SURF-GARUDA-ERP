import { useState } from "react";
import { Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { serverExtendShipmentValidity } from "@/lib/ewaybill-validity";

type ShipmentExpiry = { id: string; eway_bill_number: string; valid_until: string; eway_bill_status: string; approximate_distance_km: string };
type Transport = { vehicle_no: string; trans_mode: string; trans_doc_no: string | null; trans_doc_date: string | null };
type Mode = "1" | "2" | "3" | "4" | "5";
type Reason = "1" | "2" | "4" | "5" | "99";
type Transit = "R" | "W" | "O";

const states = [
  ["01","Jammu and Kashmir"], ["02","Himachal Pradesh"], ["03","Punjab"], ["04","Chandigarh"], ["05","Uttarakhand"], ["06","Haryana"], ["07","Delhi"], ["08","Rajasthan"], ["09","Uttar Pradesh"], ["10","Bihar"], ["11","Sikkim"], ["12","Arunachal Pradesh"], ["13","Nagaland"], ["14","Manipur"], ["15","Mizoram"], ["16","Tripura"], ["17","Meghalaya"], ["18","Assam"], ["19","West Bengal"], ["20","Jharkhand"], ["21","Odisha"], ["22","Chhattisgarh"], ["23","Madhya Pradesh"], ["24","Gujarat"], ["26","Dadra and Nagar Haveli and Daman and Diu"], ["27","Maharashtra"], ["29","Karnataka"], ["30","Goa"], ["31","Lakshadweep"], ["32","Kerala"], ["33","Tamil Nadu"], ["34","Puducherry"], ["35","Andaman and Nicobar Islands"], ["36","Telangana"], ["37","Andhra Pradesh"], ["38","Ladakh"],
];
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

export function ExtendShipmentValidity({ shipment, token, transport, onExtended }: {
  shipment: ShipmentExpiry;
  token?: string;
  transport?: Transport;
  onExtended: (validUntil: string, status: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const initial = () => ({
    fromPlace: "", fromState: "", fromPincode: "", remainingDistance: "",
    transMode: (["1","2","3","4","5"].includes(transport?.trans_mode || "") ? transport!.trans_mode : "1") as Mode,
    vehicleNo: transport?.vehicle_no || "", transDocNo: transport?.trans_doc_no || "",
    transDocDate: transport?.trans_doc_date?.slice(0, 10) || "",
    reasonCode: "99" as Reason, remarks: "", transitType: "W" as Transit,
    addressLine1: "", addressLine2: "", addressLine3: "",
  });
  const [form, setForm] = useState(initial);
  const set = <K extends keyof typeof form,>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const prohibited = /^(cancelled|canceled|cnl|discarded|dis|closed)$/i.test(shipment.eway_bill_status);
  const transit = form.transMode === "5";
  const documentRequired = ["2", "3", "4"].includes(form.transMode);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !token) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await serverExtendShipmentValidity({ data: { ...form, token, shipmentId: shipment.id, remainingDistance: Number(form.remainingDistance) } });
      onExtended(result.validUntil, result.status);
      setOpen(false);
      if (result.warning) toast.error(result.warning, { duration: 15000 });
      else toast.success("E-Way Bill validity extended successfully");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not extend E-Way Bill validity");
    } finally { setBusy(false); }
  }
  return <>
    <Button variant="outline" disabled={!token || prohibited || !/^\d{12}$/.test(shipment.eway_bill_number)} onClick={() => { setForm(initial()); setMessage(""); setOpen(true); }}>
      <Clock className="mr-2 size-4" /> Extend Validity
    </Button>
    <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Extend E-Way Bill Validity</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">E-Way Bill {shipment.eway_bill_number} · Current expiry: {shipment.valid_until ? new Date(shipment.valid_until).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "Not available"} (IST). Extension is generally permitted within 8 hours before or after expiry. GST determines the new expiry from the remaining distance.</p>
        <form className="space-y-4" onSubmit={submit}>
          <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Current place *</Label><Input required maxLength={50} value={form.fromPlace} onChange={(e) => set("fromPlace", e.target.value)} /></div>
            <div className="space-y-1"><Label>Current state *</Label><select className={selectClass} required value={form.fromState} onChange={(e) => set("fromState", e.target.value)}><option value="">Select state</option>{states.map(([code,name]) => <option key={code} value={code}>{name} ({code})</option>)}</select></div>
            <div className="space-y-1"><Label>Current PIN code *</Label><Input required inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} value={form.fromPincode} onChange={(e) => set("fromPincode", e.target.value.replace(/\D/g, "").slice(0,6))} /></div>
            <div className="space-y-1"><Label>Remaining distance (km) *</Label><Input required type="number" min="1" max={Number(shipment.approximate_distance_km) > 0 ? Math.min(4000, Number(shipment.approximate_distance_km)) : 4000} step="1" value={form.remainingDistance} onChange={(e) => set("remainingDistance", e.target.value)} /></div>
            <div className="space-y-1"><Label>Consignment / transport mode *</Label><select className={selectClass} value={form.transMode} onChange={(e) => set("transMode", e.target.value as Mode)}><option value="1">In movement — Road</option><option value="2">In movement — Rail</option><option value="3">In movement — Air</option><option value="4">In movement — Ship</option><option value="5">In transit</option></select></div>
            {transit ? <>
              <div className="space-y-1"><Label>Transit type *</Label><select className={selectClass} value={form.transitType} onChange={(e) => set("transitType", e.target.value as Transit)}><option value="W">Warehouse</option><option value="R">Road</option><option value="O">Other</option></select></div>
              <div className="space-y-1 sm:col-span-2"><Label>Current address line 1 *</Label><Input required maxLength={100} value={form.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} /></div>
              <div className="space-y-1"><Label>Address line 2</Label><Input maxLength={100} value={form.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} /></div>
              <div className="space-y-1"><Label>Address line 3</Label><Input maxLength={100} value={form.addressLine3} onChange={(e) => set("addressLine3", e.target.value)} /></div>
            </> : <>
              {form.transMode === "1" && <div className="space-y-1"><Label>Vehicle number *</Label><Input required maxLength={15} value={form.vehicleNo} onChange={(e) => set("vehicleNo", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} /></div>}
              <div className="space-y-1"><Label>Transport document number {documentRequired ? "*" : ""}</Label><Input required={documentRequired} maxLength={15} value={form.transDocNo} onChange={(e) => set("transDocNo", e.target.value)} /></div>
              <div className="space-y-1"><Label>Transport document date {documentRequired ? "*" : ""}</Label><Input type="date" required={documentRequired} value={form.transDocDate} onChange={(e) => set("transDocDate", e.target.value)} /></div>
            </>}
            <div className="space-y-1 sm:col-span-2"><Label>Extension reason *</Label><select className={selectClass} value={form.reasonCode} onChange={(e) => set("reasonCode", e.target.value as Reason)}><option value="1">Natural calamity</option><option value="2">Law and order situation</option><option value="4">Transshipment</option><option value="5">Accident</option><option value="99">Other</option></select></div>
            <div className="space-y-1 sm:col-span-2"><Label>Detailed reason / remarks *</Label><Textarea required maxLength={100} value={form.remarks} onChange={(e) => set("remarks", e.target.value)} /></div>
          </fieldset>
          {message && <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{message}</p>}
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy && <Loader2 className="mr-2 size-4 animate-spin" />}{busy ? "Extending…" : "Confirm Extension"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
