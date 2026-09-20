/**
 * VehicleRoadTaxSection
 * Admin-only section inside the vehicle edit form.
 * Lets admins add/delete road tax payments for a vehicle.
 *
 * Monthly expense calculation (day-accurate):
 *   daily_rate  = total_amount / total_days_inclusive
 *   monthly_amt = daily_rate × actual_days_covered_in_that_calendar_month
 * This gives proper 28/29/30/31-day months and handles partial first/last months.
 */

import { useEffect, useState } from "react";
import { FileText, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inr } from "@/lib/trip-calc";
import { useSession } from "@/lib/session";
import { supabase } from "@/integrations/supabase/client";
import {
  MONTH_NAMES,
  serverLoadRoadTax,
  serverSaveRoadTax,
  splitByMonth,
  totalDaysBetween,
  type RoadTaxEntry,
} from "@/lib/vehicle-coverage";

// Generated database types predate the finance ledger columns.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Props = {
  vehicleId: string;
  branchId: string | null;
  registrationNumber: string;
};

type PaymentLedger = { id: string; account_name: string; ledger_type: "cash" | "bank" };

const EMPTY_FORM = {
  startDate: "",
  endDate: "",
  totalAmount: "",
  state: "",
  paymentLedgerId: "",
};

/**
 * Format a YYYY-MM-DD string for display using local-date constructor
 * (explicit y/m/d avoids the UTC-midnight timezone shift from `new Date('YYYY-MM-DD')`).
 */
function formatDate(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function VehicleRoadTaxSection({ vehicleId, branchId, registrationNumber }: Props) {
  const { user } = useSession();
  const userId = user?.id ?? "";

  const [entries, setEntries] = useState<RoadTaxEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [paymentLedgers, setPaymentLedgers] = useState<PaymentLedger[]>([]);

  async function load() {
    setLoading(true);
    try {
      const rows = await serverLoadRoadTax({ data: { userId, vehicleId } });
      setEntries(rows);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    async function loadPaymentLedgers() {
      if (!branchId) {
        setPaymentLedgers([]);
        return;
      }
      const { data } = await db
        .from("ledger_accounts")
        .select("id,account_name,ledger_type")
        .eq("branch_id", branchId)
        .eq("is_active", true)
        .in("ledger_type", ["cash", "bank"])
        .order("account_name");
      setPaymentLedgers((data ?? []) as PaymentLedger[]);
    }
    void loadPaymentLedgers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  // Live preview calculations (UTC-safe: use totalDaysBetween instead of new Date() comparison)
  const previewDays =
    form.startDate && form.endDate ? Math.max(0, totalDaysBetween(form.startDate, form.endDate)) : 0;
  const previewSlices =
    previewDays > 0 && form.totalAmount
      ? splitByMonth(form.startDate, form.endDate, Number(form.totalAmount))
      : [];
  const dailyRate   = previewDays > 0 && form.totalAmount ? Number(form.totalAmount) / previewDays : 0;

  async function handleSave() {
    if (!form.startDate) return toast.error("Select a start date.");
    if (!form.endDate)   return toast.error("Select an end date.");
    if (totalDaysBetween(form.startDate, form.endDate) < 1) return toast.error("End date must not be before start date.");
    if (!form.totalAmount || Number(form.totalAmount) <= 0) return toast.error("Enter a valid total amount.");
    if (!form.state.trim()) return toast.error("State is required.");
    if (!form.paymentLedgerId) return toast.error("Select the cash or bank account used for payment.");

    setSaving(true);
    try {
      const result = await serverSaveRoadTax({
        data: {
          userId,
          vehicleId,
          branchId,
          registrationNumber,
          startDate: form.startDate,
          endDate: form.endDate,
          totalAmount: Number(form.totalAmount),
          state: form.state.trim(),
          paymentLedgerId: form.paymentLedgerId,
        },
      });
      toast.success(
        `Road tax saved — ${result.totalDays} days, ${result.monthCount} monthly expenditure${result.monthCount !== 1 ? "s" : ""} created.`
      );
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const set = (k: keyof typeof EMPTY_FORM) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  function formatPeriod(e: RoadTaxEntry) {
    if (e.start_date && e.end_date) return `${formatDate(e.start_date)} – ${formatDate(e.end_date)}`;
    return `${MONTH_NAMES[e.start_month - 1]} ${e.start_year} – ${MONTH_NAMES[e.end_month - 1]} ${e.end_year}`;
  }

  function entryDays(e: RoadTaxEntry) {
    if (e.start_date && e.end_date) return totalDaysBetween(e.start_date, e.end_date);
    const mc = (e.end_year * 12 + e.end_month) - (e.start_year * 12 + e.start_month) + 1;
    return mc * 30;
  }

  return (
    <section className="surface-card p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-primary shrink-0" />
          <h3 className="text-sm font-semibold tracking-tight">Road Tax</h3>
        </div>
        {!showForm && (
          <Button type="button" size="sm" variant="outline" onClick={() => setShowForm(true)}>
            <Plus className="size-3.5" />
            Add Road Tax
          </Button>
        )}
      </div>

      {/* Add form */}
      {showForm && (
        <div className="mt-5 space-y-4 rounded-xl border border-border bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Note:</span> The total amount is divided by
            the exact number of days and then multiplied by each month's actual days (28/29/30/31).
          </p>

          {/* Dates */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Start Date <span className="text-destructive">*</span>
              </Label>
              <Input
                type="date"
                className="h-10"
                value={form.startDate}
                onChange={e => set("startDate")(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                End Date <span className="text-destructive">*</span>
              </Label>
              <Input
                type="date"
                className="h-10"
                value={form.endDate}
                min={form.startDate || undefined}
                onChange={e => set("endDate")(e.target.value)}
              />
            </div>
          </div>

          {/* Amount + State */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Total Amount (₹) <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                min="1"
                step="0.01"
                className="h-10"
                value={form.totalAmount}
                onChange={e => set("totalAmount")(e.target.value)}
                placeholder="e.g. 12000"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                State <span className="text-destructive">*</span>
              </Label>
              <Input
                className="h-10"
                value={form.state}
                onChange={e => set("state")(e.target.value)}
                placeholder="e.g. Maharashtra"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Paid From <span className="text-destructive">*</span>
            </Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.paymentLedgerId}
              onChange={e => set("paymentLedgerId")(e.target.value)}
            >
              <option value="">Select cash or bank account</option>
              {paymentLedgers.map(ledger => (
                <option key={ledger.id} value={ledger.id}>
                  {ledger.account_name} ({ledger.ledger_type})
                </option>
              ))}
            </select>
          </div>

          {/* Live preview */}
          {previewSlices.length > 0 && form.totalAmount && (
            <div className="rounded-lg bg-primary/5 px-3 py-2.5 space-y-1.5">
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{previewDays} days</span>
                {" · "}
                <span className="font-semibold text-foreground">{inr(dailyRate)}/day</span>
                {" · "}
                <span className="font-semibold text-foreground">{previewSlices.length} month{previewSlices.length !== 1 ? "s" : ""}</span>
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
                {previewSlices.map(({ month, year, days, amount }) => (
                  <p key={`${month}-${year}`} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {MONTH_NAMES[month - 1].slice(0, 3)} {year}
                    </span>
                    {" "}({days}d) — {inr(amount)}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={saving} onClick={handleSave}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {saving ? "Saving…" : "Save Road Tax"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Entries list */}
      <div className="mt-4">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No road tax entries yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[580px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Period</th>
                  <th className="py-2 pr-3">State</th>
                  <th className="py-2 pr-3">Days</th>
                  <th className="py-2 pr-3 text-right">Total</th>
                  <th className="py-2 pr-3 text-right">Daily Rate</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {entries.map(e => {
                  const days = entryDays(e);
                  return (
                    <tr key={e.id} className="border-b border-border/60">
                      <td className="py-2 pr-3 text-xs">{formatPeriod(e)}</td>
                      <td className="py-2 pr-3">{e.state}</td>
                      <td className="py-2 pr-3 text-xs">{days}</td>
                      <td className="py-2 pr-3 text-right">{inr(e.total_amount)}</td>
                      <td className="py-2 pr-3 text-right text-xs">{inr(e.total_amount / days)}/day</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
