import { useEffect, useState } from "react";
import { ArrowLeft, Building2, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BranchSelect } from "@/components/BranchSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/session";

type PartyType = "consignor" | "consignee";
type Party = {
  id: string;
  party_type: PartyType;
  branch_id: string | null;
  gstin: string;
  phone_number: string;
  trade_name: string;
  legal_name: string;
  address_1: string;
  address_2: string;
  place: string;
  pincode: string;
  state: string;
};

const fields = [
  ["gstin", "GSTIN", true],
  ["phone_number", "Phone Number", false],
  ["trade_name", "Trade Name", false],
  ["legal_name", "Legal Name", false],
  ["address_1", "Address 1", false],
  ["address_2", "Address 2", false],
  ["place", "Place", false],
  ["pincode", "Pincode", false],
  ["state", "State", false],
] as const;

const empty = (): Omit<Party, "id" | "party_type"> => ({
  branch_id: null,
  gstin: "",
  phone_number: "",
  trade_name: "",
  legal_name: "",
  address_1: "",
  address_2: "",
  place: "",
  pincode: "",
  state: "",
});

export function PartyMaster({ partyType }: { partyType: PartyType }) {
  const { user } = useSession();
  // The repository's generated Supabase types predate the party_masters migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const [rows, setRows] = useState<Party[]>([]);
  const [search, setSearch] = useState("");
  const [branchId, setBranchId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Party | null>(null);
  const [saving, setSaving] = useState(false);
  const PAGE_SIZE = 25;
  const title = partyType === "consignor" ? "Consignor" : "Consignee";

  async function load(reset = true) {
    setLoading(true);
    const from = reset ? 0 : offset;
    let query = db
      .from("party_masters")
      .select("*")
      .eq("party_type", partyType)
      .order("updated_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (branchId) query = query.eq("branch_id", branchId);
    if (search.trim()) query = query.ilike("gstin", `%${search.trim().toUpperCase()}%`);
    const { data, error } = await query;
    if (error) toast.error(error.message);
    const page = (data ?? []) as Party[];
    setRows((current) => (reset ? page : [...current, ...page]));
    setOffset(from + page.length);
    setHasMore(page.length === PAGE_SIZE);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // Search is intentionally submitted by the filter form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyType, branchId]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editing?.branch_id) return toast.error("Branch is required");
    if (!editing.gstin.trim()) return toast.error("GSTIN is required");
    setSaving(true);
    const { id, ...rest } = editing;
    const payload = {
      ...rest,
      party_type: partyType,
      gstin: rest.gstin.trim().toUpperCase(),
      phone_number: rest.phone_number.trim(),
      source: "manual",
    };
    const result = id
      ? await db.from("party_masters").update(payload).eq("id", id)
      : await db.from("party_masters").insert(payload);
    setSaving(false);
    if (result.error)
      return toast.error(
        result.error.message.includes("duplicate")
          ? "This GSTIN already exists in this branch's master"
          : result.error.message,
      );
    toast.success(`${title} saved`);
    setEditing(null);
    void load();
  }

  if (editing)
    return (
      <form onSubmit={save} className="space-y-5 animate-fade-up">
        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
            <ArrowLeft className="size-4" /> Back
          </Button>
          <h2 className="text-lg font-semibold">
            {editing.id ? "Edit" : "New"} {title}
          </h2>
        </div>
        <section className="surface-card grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <BranchSelect
            value={editing.branch_id}
            onChange={(value) => setEditing({ ...editing, branch_id: value })}
            label="Branch *"
          />
          {fields.map(([key, label, required]) => (
            <div key={key} className="space-y-1.5">
              <Label>
                {label}
                {required ? " *" : ""}
              </Label>
              <Input
                required={required}
                type={key === "phone_number" ? "tel" : "text"}
                value={String(editing[key] ?? "")}
                onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
              />
            </div>
          ))}
        </section>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setEditing(null)}>
            Cancel
          </Button>
          <Button disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
          </Button>
        </div>
      </form>
    );

  return (
    <div className="space-y-5 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            GSTIN and branch-indexed {title.toLowerCase()} details used by E-Way Bills and manual
            shipments.
          </p>
        </div>
        <Button
          onClick={() =>
            setEditing({ party_type: partyType, ...empty(), branch_id: branchId } as Party)
          }
        >
          <Plus className="size-4" /> New {title}
        </Button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setOffset(0);
          void load(true);
        }}
        className="surface-card flex flex-wrap items-end gap-3 p-3"
      >
        <div className="min-w-[240px] flex-1">
          <BranchSelect value={branchId} onChange={setBranchId} label="Filter by Branch" />
        </div>
        <div className="flex min-w-[240px] flex-1 items-center gap-2">
          <Search className="size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by GSTIN number"
          />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
        {search && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSearch("");
              setOffset(0);
              setTimeout(() => void load(true), 0);
            }}
          >
            Clear
          </Button>
        )}
      </form>
      {loading ? (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="surface-card flex flex-col items-center py-14 text-center">
          <Building2 className="size-10 text-muted-foreground" />
          <p className="mt-3 font-medium">No {title.toLowerCase()} records found</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  {[
                    "GSTIN",
                    "Phone",
                    "Trade Name",
                    "Legal Name",
                    "Place",
                    "State",
                    "Pincode",
                    "Actions",
                  ].map((heading) => (
                    <th key={heading} className="px-4 py-3">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-4 py-3 font-medium">{row.gstin}</td>
                    <td className="px-4 py-3">{row.phone_number || "—"}</td>
                    <td className="px-4 py-3">{row.trade_name || "—"}</td>
                    <td className="px-4 py-3">{row.legal_name || "—"}</td>
                    <td className="px-4 py-3">{row.place || "—"}</td>
                    <td className="px-4 py-3">{row.state || "—"}</td>
                    <td className="px-4 py-3">{row.pincode || "—"}</td>
                    <td className="px-4 py-3">
                      <Button size="sm" variant="outline" onClick={() => setEditing(row)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          if (!window.confirm(`Delete this ${title.toLowerCase()}?`)) return;
                          const { error } = await db
                            .from("party_masters")
                            .delete()
                            .eq("id", row.id);
                          if (error) toast.error(error.message);
                          else void load();
                        }}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => void load(false)}>
                Load More (next 25)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
