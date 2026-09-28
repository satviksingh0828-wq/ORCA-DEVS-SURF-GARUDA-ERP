import { useState } from "react";
import { Loader2, Pencil, Search } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type SourceOption = { id: string; contract_name: string };
type ConsignmentRow = {
  id: string;
  consignment_number: string;
  branch?: { branch_name?: string | null } | null;
  consignment_type: string;
  delivery_date: string | null;
  transporter_lr_number: string | null;
  transporter_lr_date: string | null;
  transporter?: { transporter_name?: string | null } | null;
  source?: { contract_name?: string | null } | null;
};

type EditValues = {
  delivery_date: string;
  transporter_lr_number: string;
  transporter_lr_date: string;
};

export function UpdateConsignmentReport() {
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [sourceId, setSourceId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [rows, setRows] = useState<ConsignmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<ConsignmentRow | null>(null);
  const [values, setValues] = useState<EditValues>({
    delivery_date: "",
    transporter_lr_number: "",
    transporter_lr_date: "",
  });
  const [saving, setSaving] = useState(false);

  async function loadSources() {
    const { data, error } = await supabase
      .from("contracts")
      .select("id,contract_name")
      .eq("status", "active")
      .order("contract_name");
    if (error) return toast.error(error.message);
    setSources((data ?? []) as SourceOption[]);
  }

  async function loadConsignments() {
    setLoading(true);
    let query = supabase
      .from("consignments")
      .select(
        "id,consignment_number,consignment_type,delivery_date,transporter_lr_number,transporter_lr_date,source_id,branch:branches(branch_name),source:contracts(contract_name),transporter:ltms_transporters(transporter_name)",
      )
      .order("consignment_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (sourceId !== "all") query = query.eq("source_id", sourceId);
    if (fromDate) query = query.gte("consignment_date", fromDate);
    if (toDate) query = query.lte("consignment_date", toDate);
    const { data, error } = await query;
    if (error) toast.error(error.message);
    else setRows((data ?? []) as ConsignmentRow[]);
    setLoaded(true);
    setLoading(false);
  }

  function openEdit(row: ConsignmentRow) {
    setEditing(row);
    setValues({
      delivery_date: row.delivery_date ?? "",
      transporter_lr_number: row.transporter_lr_number ?? "",
      transporter_lr_date: row.transporter_lr_date ?? "",
    });
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    const isThirdParty = editing.consignment_type === "third_party";
    const { data, error } = await supabase
      .from("consignments")
      .update({
        transporter_lr_number: isThirdParty ? values.transporter_lr_number.trim() || null : null,
      })
      .eq("id", editing.id)
      .select(
        "id,consignment_number,consignment_type,delivery_date,transporter_lr_number,transporter_lr_date,branch:branches(branch_name),source:contracts(contract_name),transporter:ltms_transporters(transporter_name)",
      )
      .single();
    setSaving(false);
    if (error) return toast.error(error.message);
    setRows((current) =>
      current.map((row) => (row.id === editing.id ? (data as ConsignmentRow) : row)),
    );
    setEditing(null);
    toast.success("Consignment updated");
  }

  function formatType(value: string) {
    return value === "third_party" ? "Third Party" : "Own";
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold">Load Consignments</h2>
          <p className="text-xs text-muted-foreground">
            Filter by Source and the stored Consignment Date, then update delivery and transporter
            LR details.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Source</label>
            <Select
              value={sourceId}
              onValueChange={setSourceId}
              onOpenChange={(open) => open && sources.length === 0 && void loadSources()}
            >
              <SelectTrigger>
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {sources.map((source) => (
                  <SelectItem key={source.id} value={source.id}>
                    {source.contract_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Consignment Date From
            </label>
            <Input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Consignment Date To</label>
            <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              className="w-full"
              onClick={() => void loadConsignments()}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Search className="mr-2 size-4" />
              )}
              {loading ? "Loading…" : "Load"}
            </Button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Consignments ({rows.length})</h2>
          {!loaded && (
            <span className="text-xs text-muted-foreground">Choose filters and press Load</span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Consignment No.</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Delivery Date</th>
                <th className="px-4 py-3">Transporter LR Number</th>
                <th className="px-4 py-3">Transporter LR Date</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 font-medium">{row.consignment_number}</td>
                  <td className="px-4 py-3">{row.branch?.branch_name || "—"}</td>
                  <td className="px-4 py-3">{formatType(row.consignment_type)}</td>
                  <td className="px-4 py-3">{row.delivery_date || "—"}</td>
                  <td className="px-4 py-3">{row.transporter_lr_number || "—"}</td>
                  <td className="px-4 py-3">{row.transporter_lr_date || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <Button type="button" variant="outline" size="sm" onClick={() => openEdit(row)}>
                      <Pencil className="mr-1.5 size-3.5" /> Update
                    </Button>
                  </td>
                </tr>
              ))}
              {loaded && !rows.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No consignments found for these filters.
                  </td>
                </tr>
              )}
              {!loaded && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No consignments loaded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Update Consignment — {editing?.consignment_number}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div className="font-medium">{editing.branch?.branch_name || "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {formatType(editing.consignment_type)} ·{" "}
                  {editing.source?.contract_name || "No source"}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Transporter Name
                </label>
                <Input
                  value={editing.transporter?.transporter_name || "—"}
                  readOnly
                  className="bg-muted/40"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Delivery Date (Read Only)
                </label>
                <Input type="date" value={values.delivery_date} readOnly className="bg-muted/40" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Transporter LR Number
                  {editing.consignment_type !== "third_party" ? " (Third Party Only)" : ""}
                </label>
                <Input
                  value={values.transporter_lr_number}
                  disabled={editing.consignment_type !== "third_party"}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      transporter_lr_number: event.target.value,
                    }))
                  }
                  placeholder={
                    editing.consignment_type === "third_party"
                      ? "Enter LR number"
                      : "Not applicable for Own"
                  }
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Transporter LR Date (Read Only)
                </label>
                <Input
                  type="date"
                  value={values.transporter_lr_date}
                  readOnly
                  className="bg-muted/40"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveEdit()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Save Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
