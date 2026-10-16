/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { FilePlus2, Search } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { AccountsAccessGuard } from "@/components/accounts/AccountsAccessGuard";
import { AccountsMobileNav, AccountsSidebar } from "@/components/accounts/AccountsSectionNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { supabase } from "@/integrations/supabase/client";
import { useBranches } from "@/lib/use-branches";
import { useSession } from "@/lib/session";

const db = supabase as any;
const gstRates = [0, 0.1, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 5, 6, 7.5, 9, 12, 14, 18, 28];
type Slab = {
  id: string;
  branch_id: string;
  slab_name: string;
  igst_rate: number;
  cgst_rate: number;
  sgst_rate: number;
  created_at: string;
  branch?: { branch_name?: string } | null;
};
const labelRate = (v: number | string) => `${Number(v)}%`;

export const AccountsGstRoute = () => (
  <RequireAuth>
    <AccountsAccessGuard allowBasicFinance>
      <AccountsGstPage />
    </AccountsAccessGuard>
  </RequireAuth>
);
export function AccountsGstPage() {
  const { user } = useSession();
  const allBranches = useBranches();
  const branches =
    user?.role === "basic"
      ? allBranches.filter((b) => (user.branchIds ?? []).includes(b.id))
      : allBranches;
  const [subTab, setSubTab] = useState<"gst-master" | "create">("gst-master");
  const [branch, setBranch] = useState("all");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Slab[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ branch: "", igst: "0", cgst: "0", sgst: "0" });
  const assigned = useMemo(() => new Set(branches.map((item) => item.id)), [branches]);
  const load = useCallback(async () => {
    let q = db
      .from("account_gst_slabs")
      .select("*,branch:branches(branch_name)")
      .order("slab_name");
    if (user?.role === "basic")
      q = q.in(
        "branch_id",
        user.branchIds?.length ? user.branchIds : ["00000000-0000-0000-0000-000000000000"],
      );
    if (branch !== "all") q = q.eq("branch_id", branch);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    else setRows(data ?? []);
  }, [branch, user?.role, user?.branchIds]);
  useEffect(() => {
    void load();
  }, [load]);
  const filtered = rows.filter((row) =>
    `${row.slab_name} ${row.branch?.branch_name ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const slabName = `IGST ${labelRate(form.igst)} + CGST ${labelRate(form.cgst)} + SGST ${labelRate(form.sgst)}`;
  async function createSlab(event: React.FormEvent) {
    event.preventDefault();
    if (!form.branch || !assigned.has(form.branch))
      return toast.error("Choose a branch you are allowed to access.");
    setSaving(true);
    const { error } = await db.rpc("create_account_gst_slab", {
      p_branch_id: form.branch,
      p_igst_rate: Number(form.igst),
      p_cgst_rate: Number(form.cgst),
      p_sgst_rate: Number(form.sgst),
      p_created_by: user?.id,
    });
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("GST slab created. GST slabs are view-only after creation.");
      setSubTab("gst-master");
      await load();
    }
  }
  return (
    <AppShell
      variant="ltms"
      shellTitle="Accounts"
      breadcrumb={
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/home">Workspace</Link>
          <span>/</span>
          <Link to="/accounts">Accounts</Link>
          <span>/</span>
          <span className="text-foreground">GST</span>
        </span>
      }
    >
      <div className="ltms-reference-shell accounts-reference-shell grid grid-cols-1 lg:grid-cols-[192px_minmax(0,1fr)]">
        <AccountsSidebar
          desktop
          mode="gst"
          activeTabId={subTab}
          onSelectTab={(id) => setSubTab(id as "gst-master" | "create")}
        />
        <div className="ltms-reference-content min-w-0">
          <AccountsMobileNav pathname="/accounts/gst" />
          <div className="lg:hidden">
            <MobileTabDropdown
              tabs={[
                { id: "gst-master", label: "GST Master", desc: "View GST slabs", icon: Search },
                { id: "create", label: "Create Slab", desc: "Create GST slab", icon: FilePlus2 },
              ]}
              activeId={subTab}
              label="GST tabs"
              compact
              onChange={(id) => setSubTab(id as "gst-master" | "create")}
            />
          </div>
          {subTab === "gst-master" && (
            <section className="space-y-4">
              <div className="flex justify-end">
                <Button
                  onClick={() => {
                    setForm((prev) => ({ ...prev, branch: branches[0]?.id ?? "" }));
                    setSubTab("create");
                  }}
                >
                  <FilePlus2 className="mr-2 size-4" />
                  Create GST Slab
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  <span>Branch</span>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                  >
                    <option value="all">All branches</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.branch_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="relative space-y-1 text-xs font-medium text-muted-foreground">
                  <span>Name search</span>
                  <Search className="absolute left-2 top-7 size-4" />
                  <Input
                    className="pl-8"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search GST slab"
                  />
                </label>
              </div>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[800px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      {["GST slab name", "Branch", "IGST", "CGST", "SGST", "Created"].map(
                        (item) => (
                          <th className="px-3 py-3" key={item}>
                            {item}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <tr key={row.id} className="border-t border-border">
                        <td className="px-3 py-3 font-medium">{row.slab_name}</td>
                        <td className="px-3 py-3">{row.branch?.branch_name ?? "—"}</td>
                        <td className="px-3 py-3">{labelRate(row.igst_rate)}</td>
                        <td className="px-3 py-3">{labelRate(row.cgst_rate)}</td>
                        <td className="px-3 py-3">{labelRate(row.sgst_rate)}</td>
                        <td className="px-3 py-3">
                          {new Date(row.created_at).toLocaleDateString("en-IN")}
                        </td>
                      </tr>
                    ))}
                    {!filtered.length && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-muted-foreground">
                          No GST slabs found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                GST slabs are immutable after creation. To change a rate, create a separate slab.
              </p>
            </section>
          )}
          {subTab === "create" && (
            <section className="surface-card mt-4 space-y-4 p-5">
              <form onSubmit={createSlab} className="space-y-4" aria-label="Create GST slab">
                <div>
                  <h2 className="text-lg font-semibold">Create GST Slab</h2>
                  <p className="text-sm text-muted-foreground">
                    Select output GST rates. The generated slab name is read-only.
                  </p>
                </div>
                <label className="block space-y-1 text-xs font-medium text-muted-foreground">
                  <span>Branch *</span>
                  <select
                    required
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={form.branch}
                    onChange={(e) => setForm({ ...form, branch: e.target.value })}
                  >
                    <option value="">Select branch</option>
                    {branches.map((b) => (
                      <option value={b.id} key={b.id}>
                        {b.branch_name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-3 sm:grid-cols-3">
                  {(["igst", "cgst", "sgst"] as const).map((key) => (
                    <label
                      key={key}
                      className="space-y-1 text-xs font-medium text-muted-foreground"
                    >
                      <span>Output {key.toUpperCase()} rate</span>
                      <select
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={form[key]}
                        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      >
                        {gstRates.map((rate) => (
                          <option value={rate} key={rate}>
                            {labelRate(rate)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <label className="block space-y-1 text-xs font-medium text-muted-foreground">
                  <span>GST slab name</span>
                  <Input readOnly value={slabName} />
                </label>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setSubTab("gst-master")}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? "Creating…" : "Create"}
                  </Button>
                </div>
              </form>
            </section>
          )}
        </div>
      </div>
    </AppShell>
  );
}
