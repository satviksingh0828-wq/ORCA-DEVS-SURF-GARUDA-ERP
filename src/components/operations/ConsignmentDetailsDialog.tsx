import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Details = Record<string, any>;

export function ConsignmentDetailsDialog({
  consignmentId,
  open,
  onOpenChange,
}: {
  consignmentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [row, setRow] = useState<Details | null>(null);
  const [shipments, setShipments] = useState<Details[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !consignmentId) return;
    setLoading(true);
    void Promise.all([
      supabase
        .from("consignments")
        .select(
          "id,consignment_number,consignment_date,consignment_type,movement_mode,transport_mode,from_pin_code,to_pin_code,delivery_date,transporter_lr_number,transporter_lr_date,source:contracts(contract_name),branch:branches(branch_name),transporter:ltms_transporters(transporter_name)",
        )
        .eq("id", consignmentId)
        .single(),
      supabase
        .from("shipments")
        .select(
          "id,eway_bill_number,eway_bill_date,valid_until,total_invoice_value,eway_bill_status,recipient_trade_name,recipient_pin_code",
        )
        .eq("consignment_id", consignmentId)
        .order("eway_bill_date", { ascending: false }),
    ]).then(([consignmentResult, shipmentResult]) => {
      if (consignmentResult.error) toast.error(consignmentResult.error.message);
      else setRow(consignmentResult.data as Details);
      if (shipmentResult.error) toast.error(shipmentResult.error.message);
      else setShipments((shipmentResult.data ?? []) as Details[]);
      setLoading(false);
    });
  }, [open, consignmentId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Consignment Details {row?.consignment_number ? `— ${row.consignment_number}` : ""}
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center p-10">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : row ? (
          <div className="space-y-5">
            <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Consignment No." value={row.consignment_number} />
              <Field label="Branch" value={row.branch?.branch_name} />
              <Field label="Consignment Date" value={row.consignment_date} />
              <Field label="Source" value={row.source?.contract_name} />
              <Field
                label="Type"
                value={row.consignment_type === "third_party" ? "Third Party" : "Own"}
              />
              <Field label="Movement" value={row.movement_mode} />
              <Field label="Transport Mode" value={row.transport_mode} />
              <Field label="Transporter" value={row.transporter?.transporter_name} />
              <Field label="From PIN" value={row.from_pin_code} />
              <Field label="To PIN" value={row.to_pin_code} />
              <Field label="Delivery Date" value={row.delivery_date} />
              <Field label="Transporter LR Number" value={row.transporter_lr_number} />
              <Field label="Transporter LR Date" value={row.transporter_lr_date} />
            </div>
            <section>
              <h3 className="mb-2 text-sm font-semibold">E-Way Bills ({shipments.length})</h3>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">EWB No.</th>
                      <th className="px-3 py-2">EWB Date</th>
                      <th className="px-3 py-2">Valid Until</th>
                      <th className="px-3 py-2">Recipient</th>
                      <th className="px-3 py-2">Total Invoice Value</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shipments.map((shipment) => (
                      <tr key={shipment.id} className="border-t border-border">
                        <td className="px-3 py-2 font-medium">
                          {shipment.eway_bill_number || "—"}
                        </td>
                        <td className="px-3 py-2">{shipment.eway_bill_date || "—"}</td>
                        <td className="px-3 py-2">{shipment.valid_until || "—"}</td>
                        <td className="px-3 py-2">
                          {shipment.recipient_trade_name || shipment.recipient_pin_code || "—"}
                        </td>
                        <td className="px-3 py-2">{shipment.total_invoice_value || "—"}</td>
                        <td className="px-3 py-2">{shipment.eway_bill_status || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Consignment details could not be loaded.
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value?: unknown }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-muted-foreground">{label}</div>
      <Input readOnly value={String(value || "—")} className="h-8 bg-background text-xs" />
    </div>
  );
}
