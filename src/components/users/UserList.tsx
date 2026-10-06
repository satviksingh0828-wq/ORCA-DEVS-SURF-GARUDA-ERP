import { useEffect, useState } from "react";
import {
  ArrowLeft,
  LogOut,
  Loader2,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Unlock,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBranches } from "@/lib/use-branches";
import {
  serverListUsers,
  serverGetUserBranches,
  serverSaveUser,
  serverDeleteUser,
  serverForceLogout,
  serverUnpauseUser,
  type AppUserPublic,
  type SaveUserInput,
} from "@/lib/user-auth";
import { logAction } from "@/lib/log-actions";
import type { AppRole } from "@/lib/roles";

type EditingUser = SaveUserInput;

function emptyUser(): EditingUser {
  return {
    username: "",
    full_name: "",
    password: "",
    role: "basic",
    is_active: true,
    branchIds: [],
  };
}

type UnpauseDialog = { user: AppUserPublic; code: string; busy: boolean } | null;

export function UserList() {
  const [users, setUsers] = useState<AppUserPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditingUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [unpauseDialog, setUnpauseDialog] = useState<UnpauseDialog>(null);
  const branches = useBranches();

  async function load() {
    setLoading(true);
    try {
      const rows = await serverListUsers();
      setUsers(rows);
    } catch {
      toast.error("Could not load users");
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function startEdit(u: AppUserPublic) {
    const branchIds = await serverGetUserBranches({ data: u.id });
    setEditing({
      id: u.id,
      username: u.username,
      full_name: u.full_name,
      password: "", // blank = keep existing
      role: u.role,
      is_active: u.is_active,
      branchIds,
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (!editing.username.trim()) return toast.error("Username is required");
    if (!editing.id && !editing.password.trim())
      return toast.error("Password is required for new users");
    setSaving(true);

    const result = await serverSaveUser({ data: editing });
    setSaving(false);

    if (result.error) return toast.error(result.error);

    const isNew = !editing.id;
    logAction(isNew ? "created" : "updated", "user", {
      entityId: result.id,
      entityLabel: editing.username,
      details: { role: editing.role, is_active: editing.is_active },
    });

    toast.success(editing.id ? "User updated" : "User created");
    setEditing(null);
    load();
  }

  async function remove(u: AppUserPublic) {
    if (!window.confirm("Delete this user? This cannot be undone.")) return;
    const result = await serverDeleteUser({ data: u.id });
    if (result.error) return toast.error(result.error);
    logAction("deleted", "user", { entityId: u.id, entityLabel: u.username });
    toast.success("User removed");
    load();
  }

  async function forceLogout(u: AppUserPublic) {
    if (
      !window.confirm(
        `Force-logout ${u.full_name || u.username}? They will be signed out within ~30 seconds.`,
      )
    )
      return;
    const result = await serverForceLogout({ data: u.id });
    if (result.error) return toast.error(result.error);
    logAction("updated", "user", {
      entityId: u.id,
      entityLabel: u.username,
      details: { action: "force_logout" },
    });
    toast.success(`${u.full_name || u.username} has been logged out`);
  }

  function startUnpause(u: AppUserPublic) {
    if (u.role === "admin" || u.role === "semi_admin") {
      // Admin accounts require the emailed code — open the dialog
      setUnpauseDialog({ user: u, code: "", busy: false });
    } else {
      // Basic users — unpause directly
      doUnpause(u.id, u.full_name || u.username, undefined);
    }
  }

  async function doUnpause(userId: string, label: string, code: string | undefined) {
    if (unpauseDialog) setUnpauseDialog({ ...unpauseDialog, busy: true });
    const result = await serverUnpauseUser({ data: { userId, code } });
    if (unpauseDialog) setUnpauseDialog(null);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    logAction("updated", "user", {
      entityId: userId,
      entityLabel: label,
      details: { action: "unpause" },
    });
    toast.success(`${label} has been unpaused`);
    load();
  }

  function toggleBranch(bid: string) {
    if (!editing) return;
    const has = editing.branchIds.includes(bid);
    setEditing({
      ...editing,
      branchIds: has ? editing.branchIds.filter((b) => b !== bid) : [...editing.branchIds, bid],
    });
  }

  // ── Edit / Create form ────────────────────────────────────────────────────

  if (editing) {
    return (
      <form onSubmit={onSubmit} className="animate-fade-up space-y-5">
        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
            <ArrowLeft className="size-4" />
            Back to users
          </Button>
          <h2 className="text-lg font-semibold tracking-tight">
            {editing.id ? "Edit user" : "New user"}
          </h2>
        </div>

        {/* Basic info */}
        <section className="surface-card p-6">
          <h3 className="text-sm font-semibold tracking-tight">Account details</h3>
          <div className="mt-5 grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Username <span className="text-destructive">*</span>
              </Label>
              <Input
                className="h-10"
                value={editing.username}
                onChange={(e) => setEditing({ ...editing, username: e.target.value })}
                placeholder="e.g. john.doe"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Full name</Label>
              <Input
                className="h-10"
                value={editing.full_name}
                onChange={(e) => setEditing({ ...editing, full_name: e.target.value })}
                placeholder="e.g. John Doe"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Password{" "}
                {editing.id ? (
                  <span className="text-muted-foreground">(blank = keep current)</span>
                ) : (
                  <span className="text-destructive">*</span>
                )}
              </Label>
              <Input
                className="h-10"
                type="password"
                value={editing.password}
                onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                placeholder={editing.id ? "Leave blank to keep" : "Set a password"}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Role</Label>
              <Select
                value={editing.role}
                onValueChange={(v) => setEditing({ ...editing, role: v as AppRole })}
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin — full access</SelectItem>
                  <SelectItem value="basic">Basic user — branch-restricted</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Status</Label>
              <Select
                value={editing.is_active ? "active" : "inactive"}
                onValueChange={(v) => setEditing({ ...editing, is_active: v === "active" })}
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive (cannot log in)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        {/* Branch access — relevant for basic users only; viewers see all branches */}
        {editing.role === "basic" && (
          <section className="surface-card p-6">
            <h3 className="text-sm font-semibold tracking-tight">Branch access</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Select which branches this user can see and work with. They will only see data
              belonging to these branches in Masters and Operations.
            </p>
            {branches.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No branches found. Create branches in Settings first.
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {branches.map((b) => {
                  const checked = editing.branchIds.includes(b.id);
                  return (
                    <li key={b.id}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted">
                        <input
                          type="checkbox"
                          className="size-4 rounded accent-primary"
                          checked={checked}
                          onChange={() => toggleBranch(b.id)}
                        />
                        <span className="text-sm font-medium">{b.branch_name}</span>
                        {b.branch_type ? (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({b.branch_type})
                          </span>
                        ) : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setEditing(null)}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving} className="h-10">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {saving ? "Saving…" : "Save user"}
          </Button>
        </div>
      </form>
    );
  }

  // ── Unpause code dialog (admin accounts only) ────────────────────────────

  if (unpauseDialog) {
    const { user: pu, code, busy } = unpauseDialog;
    return (
      <div className="animate-fade-up flex items-center justify-center py-16">
        <div className="surface-card w-full max-w-sm space-y-5 p-6">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600">
              <Unlock className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">Unpause admin account</p>
              <p className="text-xs text-muted-foreground">{pu.full_name || pu.username}</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This is an admin account. Enter the 6-character verification code that was sent to the
            alert email when the account was paused.
          </p>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Verification code</Label>
            <Input
              className="h-10 font-mono tracking-widest uppercase text-center text-base"
              placeholder="A3FX9K"
              maxLength={6}
              value={code}
              onChange={(e) =>
                setUnpauseDialog({ ...unpauseDialog, code: e.target.value.toUpperCase() })
              }
              autoFocus
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setUnpauseDialog(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={code.trim().length < 6 || busy}
              className="bg-amber-500 hover:bg-amber-600 text-white"
              onClick={() => doUnpause(pu.id, pu.full_name || pu.username, code.trim())}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Unlock className="size-4" />}
              {busy ? "Verifying…" : "Unpause account"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── User list ─────────────────────────────────────────────────────────────

  return (
    <div className="animate-fade-up space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Users</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage operator accounts and their branch access.
          </p>
        </div>
        <Button onClick={() => setEditing(emptyUser())}>
          <Plus className="size-4" />
          New user
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="surface-card flex flex-col items-center justify-center px-6 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <User className="size-6" />
          </span>
          <p className="mt-4 text-sm font-medium">No users yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Create users to give others access.</p>
          <Button className="mt-5" onClick={() => setEditing(emptyUser())}>
            <Plus className="size-4" />
            New user
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {users.map((u, i) => (
            <li
              key={u.id}
              style={{ animationDelay: `${i * 40}ms` }}
              className="surface-card animate-fade-up flex items-center gap-4 p-4 transition-shadow hover:shadow-[var(--shadow-lift)]"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                {u.role === "admin" || u.role === "semi_admin" ? (
                  <ShieldCheck className="size-5" />
                ) : (
                  <User className="size-5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{u.full_name || u.username}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {u.username} ·{" "}
                  <span
                    className={
                      u.role === "admin" || u.role === "semi_admin"
                        ? "font-medium text-primary"
                        : "text-muted-foreground"
                    }
                  >
                    {u.role === "admin"
                      ? "Admin"
                      : u.role === "semi_admin"
                        ? "Semi-Admin"
                        : u.role === "viewer"
                          ? "Manager"
                          : "Basic user"}
                  </span>
                  {u.is_paused ? (
                    <span className="ml-2 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                      Paused
                    </span>
                  ) : !u.is_active ? (
                    <span className="ml-2 rounded-full bg-destructive/10 px-1.5 text-destructive">
                      Inactive
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {u.is_paused ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-amber-400 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950"
                    onClick={() => startUnpause(u)}
                  >
                    <Unlock className="size-3.5" />
                    Unpause
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Force logout"
                    onClick={() => forceLogout(u)}
                  >
                    <LogOut className="size-4 text-muted-foreground" />
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => startEdit(u)}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => remove(u)}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
