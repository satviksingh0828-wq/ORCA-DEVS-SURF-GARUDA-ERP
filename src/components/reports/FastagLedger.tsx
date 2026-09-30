import { useState, useEffect, useMemo, Fragment } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  RefreshCw,
  Search,
  Plus,
  CreditCard,
  History,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { inr, num } from "@/lib/trip-calc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { fetchAll } from "@/lib/fetch-all";
import { downloadCsv, toCsv } from "@/lib/csv";
import { financialYearRange } from "@/lib/financial-year";
import { useReportFilters } from "@/lib/report-filters";
import { useSession } from "@/lib/session";

// Generated Supabase types do not yet include the Accounts tables and Fastag payment column.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface Vehicle {
  id: string;
  registration_number: string;
  nickname?: string;
  branch_id: string;
}

interface PaymentAccount {
  id: string;
  branch_id: string;
  account_name: string;
  account_kind: "bank" | "cash";
  ledger_type: "bank" | "cash";
}

interface FastagBalance {
  vehicle_id: string;
  registration_number: string;
  nickname?: string;
  total_recharge: number;
  total_deduction: number;
  balance: number;
}

interface FastagTransaction {
  id: string;
  transaction_type: "recharge" | "deduction";
  transaction_date: string;
  amount: number;
  note: string | null;
  trip_code: string | null;
}

export function FastagLedger() {
  const { branchId, financialYear } = useReportFilters();
  const { user } = useSession();
  const isBasic = user?.role === "basic";
  const assignedBranchIds = user?.branchIds ?? [];
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([]);
  const [balances, setBalances] = useState<FastagBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  // Recharge Modal State
  const [isRechargeOpen, setIsRechargeOpen] = useState(false);
  const [rechargeVehicleId, setRechargeVehicleId] = useState("");
  const [rechargeAmount, setRechargeAmount] = useState("");
  const [rechargePaymentLedgerId, setRechargePaymentLedgerId] = useState("");
  const [rechargeDate, setRechargeDate] = useState(new Date().toISOString().split("T")[0]);
  const [rechargeNote, setRechargeNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // History State
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [history, setHistory] = useState<FastagTransaction[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      // Basic users may view and recharge only vehicles assigned to their branches.
      // Do not fall back to all vehicles when their account has no branch assignment.
      if (isBasic && assignedBranchIds.length === 0) {
        setVehicles([]);
        setBalances([]);
        return;
      }

      const branchIds = isBasic
        ? branchId === "all"
          ? assignedBranchIds
          : assignedBranchIds.includes(branchId)
            ? [branchId]
            : []
        : branchId === "all"
          ? null
          : [branchId];

      if (branchIds?.length === 0) {
        setVehicles([]);
        setBalances([]);
        return;
      }

      // 1. Load all vehicles
      const vehiclesData = await fetchAll<any>(() => {
        let query = supabase
          .from("vehicles")
          .select("id,registration_number,nickname,branch_id")
          .order("registration_number");
        if (branchIds) query = query.in("branch_id", branchIds);
        return query;
      });
      setVehicles(vehiclesData);
      const paymentAccountsData = await fetchAll<PaymentAccount>(() => {
        let query = db
          .from("ledger_accounts")
          .select("id,branch_id,account_name,account_kind,ledger_type")
          .eq("is_active", true)
          .in("ledger_type", ["bank", "cash"])
          .order("account_name");
        if (branchIds) query = query.in("branch_id", branchIds);
        return query;
      });
      setPaymentAccounts(paymentAccountsData);

      // 2. Load all transactions from standalone table
      const transactions = await fetchAll<any>(() => {
        let query = supabase
          .from("fastag_transactions")
          .select("vehicle_id,transaction_type,amount,trip_code,transaction_date");
        if (financialYear !== "none") {
          const range = financialYearRange(Number(financialYear));
          query = query.gte("transaction_date", range.start).lt("transaction_date", range.end);
        }
        return query;
      });
      const vehicleBalances: Record<string, { recharge: number; deduction: number }> = {};

      vehiclesData.forEach((v) => {
        vehicleBalances[v.id] = { recharge: 0, deduction: 0 };
      });

      // Aggregate from standalone table
      transactions.forEach((t) => {
        if (t.vehicle_id && vehicleBalances[t.vehicle_id]) {
          if (t.transaction_type === "recharge") {
            vehicleBalances[t.vehicle_id].recharge += Number(t.amount);
          } else {
            vehicleBalances[t.vehicle_id].deduction += Number(t.amount);
          }
        }
      });

      const finalBalances: FastagBalance[] = vehiclesData.map((v) => ({
        vehicle_id: v.id,
        registration_number: v.registration_number,
        nickname: v.nickname,
        total_recharge: vehicleBalances[v.id].recharge,
        total_deduction: vehicleBalances[v.id].deduction,
        balance: vehicleBalances[v.id].recharge - vehicleBalances[v.id].deduction,
      }));

      setBalances(finalBalances);
    } catch (err: any) {
      toast.error("Failed to load Fastag data: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory(vehicleId: string) {
    setLoadingHistory(true);
    setSelectedVehicleId(vehicleId);
    try {
      const { data, error } = await supabase
        .from("fastag_transactions")
        .select("*")
        .eq("vehicle_id", vehicleId)
        .order("transaction_date", { ascending: false });

      if (error) throw error;
      const range = financialYear !== "none" ? financialYearRange(Number(financialYear)) : null;
      setHistory(
        (data as any[]).filter(
          (row) =>
            !range || (row.transaction_date >= range.start && row.transaction_date < range.end),
        ),
      );
    } catch (err: any) {
      toast.error("Failed to load history: " + err.message);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function handleAddRecharge() {
    if (!rechargeVehicleId || !rechargeAmount || !rechargeDate || !rechargePaymentLedgerId) {
      return toast.error("Please fill all required fields");
    }
    setSubmitting(true);
    try {
      const { error } = await db.from("fastag_transactions").insert({
        vehicle_id: rechargeVehicleId,
        amount: Number(rechargeAmount),
        transaction_date: rechargeDate,
        transaction_type: "recharge",
        note: rechargeNote,
        payment_ledger_id: rechargePaymentLedgerId,
      });

      if (error) throw error;

      toast.success("Recharge added successfully");
      setIsRechargeOpen(false);
      setRechargeAmount("");
      setRechargeNote("");
      setRechargePaymentLedgerId("");
      loadData();
    } catch (err: any) {
      toast.error("Failed to add recharge: " + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [branchId, financialYear, isBasic, assignedBranchIds.join(",")]);

  const filteredBalances = useMemo(() => {
    const s = search.toLowerCase();
    return balances.filter(
      (b) =>
        b.registration_number.toLowerCase().includes(s) ||
        (b.nickname || "").toLowerCase().includes(s),
    );
  }, [balances, search]);

  const rechargeVehicle = vehicles.find((vehicle) => vehicle.id === rechargeVehicleId);
  const rechargePaymentAccounts = paymentAccounts.filter(
    (account) => account.branch_id === rechargeVehicle?.branch_id,
  );

  function handleExport() {
    const csv = toCsv(
      filteredBalances.map((b) => ({
        Vehicle: b.registration_number,
        Nickname: b.nickname || "—",
        "Total Recharge": b.total_recharge,
        "Total Deduction": b.total_deduction,
        Balance: b.balance,
      })),
      ["Vehicle", "Nickname", "Total Recharge", "Total Deduction", "Balance"],
    );
    downloadCsv(
      csv,
      `fastag_balances_${financialYear === "none" ? new Date().toISOString().split("T")[0] : `FY-${financialYear}-${Number(financialYear) + 1}`}.csv`,
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 p-3">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search vehicle..."
            className="h-9 pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Dialog open={isRechargeOpen} onOpenChange={setIsRechargeOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-9 gap-2">
                <Plus className="size-4" />
                Add Recharge
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Fastag Recharge</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Vehicle</Label>
                  <Select
                    value={rechargeVehicleId}
                    onValueChange={(value) => {
                      setRechargeVehicleId(value);
                      setRechargePaymentLedgerId("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select Vehicle" />
                    </SelectTrigger>
                    <SelectContent>
                      {vehicles.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.registration_number} {v.nickname ? `(${v.nickname})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Payment Account (Cash / Bank)</Label>
                  <Select
                    value={rechargePaymentLedgerId}
                    onValueChange={setRechargePaymentLedgerId}
                    disabled={!rechargeVehicleId || rechargePaymentAccounts.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select cash or bank account" />
                    </SelectTrigger>
                    <SelectContent>
                      {rechargePaymentAccounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.account_name} ({account.account_kind})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {rechargeVehicleId && rechargePaymentAccounts.length === 0 && (
                    <p className="text-xs text-destructive">
                      No active cash or bank account is configured for this vehicle&apos;s branch.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Amount (₹)</Label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={rechargeAmount}
                    onChange={(e) => setRechargeAmount(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={rechargeDate}
                    onChange={(e) => setRechargeDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Note (Optional)</Label>
                  <Input
                    placeholder="Transaction ID, bank name, etc."
                    value={rechargeNote}
                    onChange={(e) => setRechargeNote(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsRechargeOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddRecharge} disabled={submitting}>
                  {submitting ? "Saving..." : "Save Recharge"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Button variant="outline" size="sm" onClick={handleExport} className="h-9 gap-2">
            <Download className="size-4" />
            Export
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={loadData}
            disabled={loading}
            className="h-9 w-9"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Balance Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="w-10 px-4 py-3"></th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Nickname</th>
                <th className="px-4 py-3 text-right">Total Recharge</th>
                <th className="px-4 py-3 text-right">Total Deduction</th>
                <th className="px-4 py-3 text-right">Current Balance</th>
                <th className="px-4 py-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    <RefreshCw className="mx-auto mb-2 size-6 animate-spin opacity-20" />
                    Calculating balances...
                  </td>
                </tr>
              ) : filteredBalances.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    No vehicles found.
                  </td>
                </tr>
              ) : (
                filteredBalances.map((row) => {
                  const isExpanded = selectedVehicleId === row.vehicle_id;
                  return (
                    <Fragment key={row.vehicle_id}>
                      <tr className="transition-colors hover:bg-muted/30">
                        <td className="px-4 py-3 text-center text-muted-foreground">
                          <CreditCard className="size-4" />
                        </td>
                        <td className="px-4 py-3 font-medium">{row.registration_number}</td>
                        <td className="px-4 py-3 text-muted-foreground">{row.nickname || "—"}</td>
                        <td className="px-4 py-3 text-right text-green-600 font-medium">
                          +{inr(row.total_recharge)}
                        </td>
                        <td className="px-4 py-3 text-right text-red-600 font-medium">
                          -{inr(row.total_deduction)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-bold ${row.balance < 500 ? "text-orange-600" : "text-foreground"}`}
                        >
                          {inr(row.balance)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1 text-xs"
                            onClick={() =>
                              isExpanded ? setSelectedVehicleId(null) : loadHistory(row.vehicle_id)
                            }
                          >
                            <History className="size-3" />
                            {isExpanded ? "Hide History" : "View History"}
                          </Button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-muted/10 border-b border-border">
                          <td colSpan={7} className="p-0">
                            <div className="max-h-[300px] overflow-y-auto p-4">
                              <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Transaction History
                              </h4>
                              {loadingHistory ? (
                                <div className="py-4 text-center text-muted-foreground">
                                  Loading history...
                                </div>
                              ) : history.length === 0 ? (
                                <div className="py-4 text-center text-muted-foreground">
                                  No transactions yet.
                                </div>
                              ) : (
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-muted-foreground border-b border-border">
                                      <th className="pb-2 font-semibold text-left">Date</th>
                                      <th className="pb-2 font-semibold text-left">Type</th>
                                      <th className="pb-2 font-semibold text-left">Note</th>
                                      <th className="pb-2 text-right font-semibold">Amount</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border/50">
                                    {history.map((txn) => (
                                      <tr key={txn.id}>
                                        <td className="py-2">{txn.transaction_date}</td>
                                        <td className="py-2 capitalize">
                                          <span
                                            className={
                                              txn.transaction_type === "recharge"
                                                ? "text-green-600"
                                                : "text-red-600"
                                            }
                                          >
                                            {txn.transaction_type}
                                          </span>
                                        </td>
                                        <td className="py-2 text-muted-foreground">
                                          {txn.note}
                                          {txn.trip_code && ` (Trip ${txn.trip_code})`}
                                        </td>
                                        <td
                                          className={`py-2 text-right font-medium ${txn.transaction_type === "recharge" ? "text-green-600" : "text-red-600"}`}
                                        >
                                          {txn.transaction_type === "recharge" ? "+" : "-"}
                                          {inr(Number(txn.amount))}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
