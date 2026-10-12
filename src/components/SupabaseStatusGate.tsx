import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Database, RefreshCw } from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import { BrandFooter } from "./BrandFooter";

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
    <div className="auth-abstract-background ltms-app-shell relative isolate flex min-h-screen flex-col bg-background text-foreground">
      <header className="ltms-app-shell-header z-10 flex h-14 shrink-0 items-center border-b-2 border-[#b87333] bg-[#2a2520]">
        <div className="ltms-app-shell-header-inner flex h-full w-full items-center gap-3 px-4">
          <img
            src="/garuda-logo.png"
            alt="Garuda Logistics Solutions"
            className="ltms-app-shell-logo h-10 w-auto object-contain"
          />
          <span className="ltms-app-shell-title hidden sm:inline">Garuda Logistics Solutions</span>
          <span className="ml-auto min-w-0 max-w-[48%] text-right text-[9px] leading-tight text-white/80 sm:max-w-none sm:text-xs sm:whitespace-nowrap">
            <span className="font-semibold text-white">ERP</span> — Enterprise Resource Planning
          </span>
        </div>
      </header>
      <main className="relative z-10 flex flex-1 items-center justify-center overflow-y-auto px-4 py-8">
        <div className="surface-card w-full max-w-md animate-fade-up px-6 py-8 text-center sm:px-8">
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
      </main>
      <BrandFooter />
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
