import { useEffect, useState } from "react";
import { Download, Eye, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/session";
import { isAdminLike } from "@/lib/roles";
import { useBranches } from "@/lib/use-branches";
import {
  serverLoadMisForm,
  serverLoadMisReports,
  serverSaveMisActivities,
  type MisActivity,
  type MisReportRow,
  type MisScheduleType,
} from "@/lib/monthly-mis";
import { exportMisDepotReportExcel } from "@/lib/monthly-mis-excel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type EditorActivity = Pick<
  MisActivity,
  "id" | "activity_name" | "schedule_type" | "schedule_value" | "schedule_value_2"
>;
const monthNow = new Date().toISOString().slice(0, 7);
function submittedDate(value: string | null) {
  return value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "-";
}

export function MonthlyMISReport() {
  const { user } = useSession();
  const isAdmin = isAdminLike(user?.role);
  const branches = useBranches();
  const [month, setMonth] = useState(monthNow);
  const [branchId, setBranchId] = useState("all");
  const [rows, setRows] = useState<MisReportRow[]>([]);
  const [configBranch, setConfigBranch] = useState("");
  const [activities, setActivities] = useState<EditorActivity[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [selected, setSelected] = useState<MisReportRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadReports() {
    if (!user?.sessionToken) return;
    try {
      setRows(await serverLoadMisReports({ data: { token: user.sessionToken, branchId, month } }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }
  useEffect(() => {
    loadReports();
  }, [branchId, month, user?.sessionToken]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openConfig() {
    const target = configBranch || branches[0]?.id;
    if (!target || !user?.sessionToken) return;
    setConfigBranch(target);
    try {
      const form = await serverLoadMisForm({
        data: { token: user.sessionToken, branchId: target, month },
      });
      setActivities(form?.activities ?? []);
      setShowConfig(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function changeConfigBranch(id: string) {
    setConfigBranch(id);
    if (!user?.sessionToken) return;
    const form = await serverLoadMisForm({
      data: { token: user.sessionToken, branchId: id, month },
    });
    setActivities(form?.activities ?? []);
  }

  async function saveConfig() {
    if (!user?.sessionToken || !configBranch) return;
    setBusy(true);
    try {
      await serverSaveMisActivities({
        data: {
          token: user.sessionToken,
          branchId: configBranch,
          activities: activities.map((activity) => ({ ...activity, id: activity.id || undefined })),
        },
      });
      toast.success("Monthly MIS form updated");
      setShowConfig(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const totals = rows.reduce(
    (sum, row) => ({
      due: sum.due + row.due,
      done: sum.done + row.done,
      missed: sum.missed + row.missed,
    }),
    { due: 0, done: 0, missed: 0 },
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>Branch</span>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.branch_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>MIS month</span>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="block h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!rows.length}
            onClick={() => exportMisDepotReportExcel(rows, month)}
          >
            <Download className="size-4" />
            Export depot-wise Excel
          </Button>
          {isAdmin && (
            <Button onClick={openConfig}>
              <Plus className="size-4" />
              Configure depot form
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Due", totals.due],
          ["Done", totals.done],
          ["Missed", totals.missed],
          [
            "Compliance",
            `${totals.due ? ((totals.done / totals.due) * 100).toFixed(1) : "100.0"}%`,
          ],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/60 text-left">
              <th className="px-4 py-3">Depot</th>
              <th className="px-4 py-3">Submitted Date</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Due</th>
              <th className="px-4 py-3 text-right">Done</th>
              <th className="px-4 py-3 text-right">Missed</th>
              <th className="px-4 py-3 text-right">Compliance %</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{row.branch_name}</td>
                  <td className="px-4 py-3">{submittedDate(row.submitted_at)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${row.status === "submitted" ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">{row.due}</td>
                  <td className="px-4 py-3 text-right">{row.done}</td>
                  <td className="px-4 py-3 text-right">{row.missed}</td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {row.compliance.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="ghost" onClick={() => setSelected(row)}>
                      <Eye className="size-4" />
                      View
                    </Button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="px-4 py-14 text-center text-muted-foreground">
                  No saved or submitted Monthly MIS forms for this selection.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={showConfig} onOpenChange={setShowConfig}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configure Monthly MIS form</DialogTitle>
          </DialogHeader>
          <Select value={configBranch} onValueChange={changeConfigBranch}>
            <SelectTrigger>
              <SelectValue placeholder="Select depot" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.branch_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="space-y-2">
            {activities.map((activity, index) => (
              <div
                key={activity.id || index}
                className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[1fr_170px_180px_auto]"
              >
                <Input
                  value={activity.activity_name}
                  placeholder="MIS activity"
                  onChange={(e) =>
                    setActivities((list) =>
                      list.map((a, i) =>
                        i === index ? { ...a, activity_name: e.target.value } : a,
                      ),
                    )
                  }
                />
                <Select
                  value={activity.schedule_type}
                  onValueChange={(value: MisScheduleType) =>
                    setActivities((list) =>
                      list.map((a, i) =>
                        i === index
                          ? {
                              ...a,
                              schedule_type: value,
                              schedule_value: value === "daily" ? null : 1,
                              schedule_value_2: value === "twice_monthly" ? 15 : null,
                            }
                          : a,
                      ),
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Every weekday</SelectItem>
                    <SelectItem value="day_of_month">Day of month</SelectItem>
                    <SelectItem value="twice_monthly">Twice a month</SelectItem>
                  </SelectContent>
                </Select>
                {activity.schedule_type === "daily" ? (
                  <div />
                ) : activity.schedule_type === "weekly" ? (
                  <Select
                    value={String(activity.schedule_value ?? 1)}
                    onValueChange={(v) =>
                      setActivities((list) =>
                        list.map((a, i) => (i === index ? { ...a, schedule_value: Number(v) } : a)),
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(
                        (day, i) => (
                          <SelectItem key={day} value={String(i + 1)}>
                            {day}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                ) : activity.schedule_type === "twice_monthly" ? (
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label="First date"
                      type="number"
                      min={1}
                      max={31}
                      value={activity.schedule_value ?? 1}
                      onChange={(e) =>
                        setActivities((list) =>
                          list.map((a, i) =>
                            i === index ? { ...a, schedule_value: Number(e.target.value) } : a,
                          ),
                        )
                      }
                    />
                    <span className="text-muted-foreground">&</span>
                    <Input
                      aria-label="Second date"
                      type="number"
                      min={1}
                      max={31}
                      value={activity.schedule_value_2 ?? 15}
                      onChange={(e) =>
                        setActivities((list) =>
                          list.map((a, i) =>
                            i === index ? { ...a, schedule_value_2: Number(e.target.value) } : a,
                          ),
                        )
                      }
                    />
                  </div>
                ) : (
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={activity.schedule_value ?? 1}
                    onChange={(e) =>
                      setActivities((list) =>
                        list.map((a, i) =>
                          i === index ? { ...a, schedule_value: Number(e.target.value) } : a,
                        ),
                      )
                    }
                  />
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setActivities((list) => list.filter((_, i) => i !== index))}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex justify-between">
            <Button
              variant="outline"
              onClick={() =>
                setActivities((list) => [
                  ...list,
                  {
                    id: "",
                    activity_name: "",
                    schedule_type: "daily",
                    schedule_value: null,
                    schedule_value_2: null,
                  },
                ])
              }
            >
              <Plus className="size-4" />
              Add activity
            </Button>
            <Button
              disabled={
                busy || !activities.length || activities.some((a) => !a.activity_name.trim())
              }
              onClick={saveConfig}
            >
              <Save className="size-4" />
              Save form
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selected?.branch_name} — Monthly MIS {selected?.mis_month}
            </DialogTitle>
          </DialogHeader>
          {selected?.snapshot ? (
            <div className="space-y-3">
              {selected.snapshot.activities.map((activity) => {
                const entries = selected.snapshot!.entries.filter(
                  (e) => e.activity_id === activity.id,
                );
                return (
                  <div key={activity.id} className="rounded-lg border border-border p-3">
                    <p className="font-medium">{activity.activity_name}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {entries.map((e) => (
                        <span
                          key={e.due_date}
                          className={`rounded px-2 py-1 text-xs ${e.completed ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"}`}
                        >
                          {e.due_date.slice(-2)} {e.completed ? "✓" : "✕"}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              This form is still a draft. Its immutable snapshot will be available after submission.
            </p>
          )}
          <Button variant="outline" onClick={() => setSelected(null)}>
            <X className="size-4" />
            Close
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
