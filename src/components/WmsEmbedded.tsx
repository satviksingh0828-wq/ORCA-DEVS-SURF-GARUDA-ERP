import { MemoryRouter } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthProvider, useAuth } from "@/wms/auth.jsx";
import { WarehouseProvider } from "@/wms/warehouse.jsx";
import WmsApp from "@/wms/App.jsx";
import "@/wms/App.scoped.css";

export function WmsEmbedded({ erpSessionToken }: { erpSessionToken: string }) {
  return (
    <MemoryRouter initialEntries={["/"]}>
      <AuthProvider erpSessionToken={erpSessionToken}>
        <WarehouseProvider>
          <WmsEmbeddedContent />
        </WarehouseProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

function WmsEmbeddedContent() {
  const { loading } = useAuth();
  return loading ? <WmsLoadingScreen /> : <WmsApp embedded />;
}

export function WmsLoadingScreen() {
  return (
    <AppShell
      variant="ltms"
      shellTitle="WMS"
      mainClassName="overflow-hidden p-0 sm:p-0"
      headerEnd={
        <div className="flex items-center gap-2" aria-hidden="true">
          <span className="text-xs text-muted-foreground">Warehouse</span>
          <Skeleton className="h-8 w-36 rounded-lg" />
        </div>
      }
    >
      <div
        className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[192px_minmax(0,1fr)]"
        role="status"
        aria-label="Loading WMS workspace"
      >
        <aside className="hidden space-y-3 bg-[#2a2520] p-3 lg:block">
          <Skeleton className="mb-4 h-8 w-full rounded-lg bg-white/10" />
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton
              key={index}
              className={`h-9 rounded-lg bg-white/10 ${index % 3 === 0 ? "w-full" : "w-4/5"}`}
            />
          ))}
        </aside>
        <main className="min-h-0 space-y-5 overflow-y-auto p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-2">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-4 w-64 max-w-[75vw]" />
            </div>
            <Skeleton className="h-9 w-28 rounded-lg" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="rounded-xl border border-border bg-card p-4">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-3 h-7 w-16" />
                <Skeleton className="mt-3 h-3 w-32" />
              </div>
            ))}
          </div>
          <div className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-10 w-full rounded-lg" />
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full rounded-lg" />
            ))}
          </div>
          <span className="sr-only">Loading warehouse data…</span>
        </main>
      </div>
    </AppShell>
  );
}
