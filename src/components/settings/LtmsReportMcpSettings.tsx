import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/session";
import {
  serverCreateLtmsReportMcpKey,
  serverListLtmsReportMcpKeys,
  serverRevokeLtmsReportMcpKey,
  type LtmsReportMcpKey,
} from "@/lib/ltms-report-mcp-settings";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "MCP key operation failed.";
}

function dateLabel(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Unknown"
    : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function LtmsReportMcpSettings() {
  const { user } = useSession();
  const sessionToken = user?.sessionToken ?? "";
  const [keys, setKeys] = useState<LtmsReportMcpKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [newSecret, setNewSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const endpoint =
    typeof window === "undefined"
      ? "/api/mcp/ltms-reports"
      : `${window.location.origin}/api/mcp/ltms-reports`;

  const reload = useCallback(async () => {
    if (!sessionToken) return;
    setLoading(true);
    try {
      setKeys(await serverListLtmsReportMcpKeys({ data: { sessionToken } }));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function createKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionToken || !displayName.trim()) return;
    setCreating(true);
    setNewSecret("");
    setCopied(false);
    try {
      const result = await serverCreateLtmsReportMcpKey({
        data: { sessionToken, displayName: displayName.trim() },
      });
      setKeys((current) => [result.key, ...current]);
      setNewSecret(result.secret);
      setDisplayName("");
      toast.success("Read-only MCP key created. Copy it now; it cannot be shown again.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setCreating(false);
    }
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} copied.`);
    } catch {
      toast.error("Clipboard access was blocked. Select and copy the value manually.");
    }
  }

  async function revokeKey(key: LtmsReportMcpKey) {
    if (!sessionToken || key.revoked_at) return;
    const confirmed = window.confirm(
      `Revoke “${key.display_name}”? Any AI client using this key will immediately lose MCP report access.`,
    );
    if (!confirmed) return;
    setRevokingId(key.id);
    try {
      await serverRevokeLtmsReportMcpKey({ data: { sessionToken, keyId: key.id } });
      setKeys((current) =>
        current.map((item) =>
          item.id === key.id ? { ...item, revoked_at: new Date().toISOString() } : item,
        ),
      );
      toast.success("MCP key revoked.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="animate-fade-up space-y-5">
      <section className="surface-card space-y-4 p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <KeyRound className="size-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold">AI Read-only Report MCP</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect a remote MCP-compatible client, such as ChatGPT or Claude, to the LTMS report
              values shown in this app.
            </p>
          </div>
        </div>

        <div className="rounded-lg border bg-muted/20 p-4 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <ShieldCheck className="size-4 text-emerald-600" /> Read-only scope
          </div>
          <p className="mt-2 text-muted-foreground">
            Keys can query read-only LTMS finance and operations reports, accounting journal entries, ledger accounts, period ledgers and as-of balances, plus HRMS payroll and payment history, loans and installments, advances and installments, deductions,
            incentives, paid-leave accrual/usage, attendance history, and check-in events. They cannot create, edit, delete,
            or post ERP data. HRMS reports include sensitive staff and compensation information and
            are available only through MCP keys issued by active administrators. Report calls can be limited by date and,
            where that report supports it, branch. An administrator-level key can read every branch.
            MCP returns persisted report values; unsaved browser-only edits are not visible.
          </p>
        </div>

        <div className="rounded-lg border p-4 text-sm">
          <h2 className="font-medium">Connect ChatGPT</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>In ChatGPT, use OAuth and retry discovery for the endpoint above.</li>
            <li>For client registration, choose Dynamic Client Registration (DCR).</li>
            <li>If ChatGPT asks for Base scopes, enter reports:read and offline_access.</li>
            <li>
              When the ORCA authorization page opens, paste the MCP key below and approve read-only
              access.
            </li>
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">
            Do not put the MCP key in OAuth Client ID/Secret fields or enter example.com endpoints.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="ltms-mcp-url">
            Streamable HTTP MCP endpoint
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id="ltms-mcp-url" value={endpoint} readOnly className="font-mono text-xs" />
            <Button
              type="button"
              variant="outline"
              onClick={() => void copyText(endpoint, "Endpoint URL")}
            >
              <Copy className="mr-2 size-4" /> Copy URL
            </Button>
          </div>
        </div>

        {newSecret && (
          <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
            <div>
              <p className="font-medium">Copy this key now</p>
              <p className="mt-1 text-sm text-muted-foreground">
                This secret is shown once only. Anyone who has it can read the listed reports across
                all branches. Store it securely. For ChatGPT, enter it only on the ORCA-hosted OAuth
                authorization page—not in a chat or ChatGPT's OAuth client fields.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label="New MCP secret"
                value={newSecret}
                readOnly
                className="font-mono text-xs"
              />
              <Button type="button" onClick={() => void copyText(newSecret, "MCP key")}>
                {copied ? <Check className="mr-2 size-4" /> : <Copy className="mr-2 size-4" />}
                Copy key
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              For MCP clients that accept Bearer tokens: Authorization: Bearer &lt;key&gt;
            </p>
          </div>
        )}
      </section>

      <section className="surface-card space-y-4 p-6">
        <div>
          <h2 className="font-semibold">Create a read-only key</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create one key per MCP client so you can revoke a single connection without affecting
            others.
          </p>
        </div>
        <form onSubmit={createKey} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 space-y-1 text-xs font-medium text-muted-foreground">
            Key name
            <Input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={80}
              placeholder="e.g. Claude report access"
              required
              className="mt-1"
            />
          </label>
          <Button type="submit" disabled={creating || !displayName.trim()}>
            {creating ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Plus className="mr-2 size-4" />
            )}
            Generate key
          </Button>
        </form>
      </section>

      <section className="surface-card space-y-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">MCP keys</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Secrets are never stored in recoverable form or shown again after creation.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void reload()}
            disabled={loading}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : "Refresh"}
          </Button>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading keys…
          </div>
        ) : keys.length === 0 ? (
          <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
            No MCP keys yet. Generate a separate read-only key for each AI client.
          </p>
        ) : (
          <div className="space-y-3">
            {keys.map((key) => (
              <div
                key={key.id}
                className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{key.display_name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Created {dateLabel(key.created_at)} · Last used {dateLabel(key.last_used_at)}
                  </p>
                  <p
                    className={`mt-1 text-xs font-medium ${key.revoked_at ? "text-destructive" : "text-emerald-600"}`}
                  >
                    {key.revoked_at
                      ? `Revoked ${dateLabel(key.revoked_at)}`
                      : "Active · report read-only"}
                  </p>
                </div>
                {!key.revoked_at && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={revokingId === key.id}
                    onClick={() => void revokeKey(key)}
                    className="shrink-0"
                  >
                    {revokingId === key.id ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 size-4" />
                    )}
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
