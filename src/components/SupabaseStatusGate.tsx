import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Database, RefreshCw } from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import { OrcaLogo } from "./OrcaLogo";

const HEALTH_CHECK_INTERVAL_MS = 15_000;
const HEALTH_CHECK_TIMEOUT_MS = 8_000;

function isSupabaseAvailableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = "status" in error && typeof error.status === "number" ? error.status : undefined;
  // A successful HTTP response, including an authorization or schema error,
  // proves that the Supabase service is reachable. The app may still need a
  // configuration or permission fix, but it is not a service outage.
  return status === undefined || status >= 500;
}

async function checkSupabaseHealth(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const timeout = new Promise<never>((_, reject) => {
    window.setTimeout(
      () => reject(new Error("Supabase health check timed out")),
      HEALTH_CHECK_TIMEOUT_MS,
    );
  });

  try {
    const result = await Promise.race([
      supabase.from("app_settings").select("id").limit(1).maybeSingle(),
      timeout,
    ]);

    if (result.error) return !isSupabaseAvailableError(result.error);
    return true;
  } catch {
    return false;
  }
}

function ServerUnavailableScreen({
  onRetry,
  checking,
}: {
  onRetry: () => void;
  checking: boolean;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 py-10 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
        <OrcaLogo className="mx-auto mb-6 h-20 w-20 opacity-85" />
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <Database className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Server is not live</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The server is currently unavailable. If you think this is an error, contact the
          administrator.
        </p>
        <button
          type="button"
          onClick={onRetry}
          disabled={checking}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} aria-hidden="true" />
          {checking ? "Checking server..." : "Try again"}
        </button>
      </div>
    </div>
  );
}

export function SupabaseStatusGate({ children }: { children: ReactNode }) {
  const [isLive, setIsLive] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  const runHealthCheck = useCallback(async () => {
    setChecking(true);
    const available = await checkSupabaseHealth();
    setIsLive(available);
    setChecking(false);
  }, []);

  useEffect(() => {
    void runHealthCheck();

    const interval = window.setInterval(() => {
      void runHealthCheck();
    }, HEALTH_CHECK_INTERVAL_MS);
    const handleOnline = () => void runHealthCheck();
    window.addEventListener("online", handleOnline);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", handleOnline);
    };
  }, [runHealthCheck]);

  if (isLive === false) {
    return <ServerUnavailableScreen onRetry={() => void runHealthCheck()} checking={checking} />;
  }

  return <>{children}</>;
}
