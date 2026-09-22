import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Building2, ChevronRight, FileText, MapPin, PanelLeftClose, PanelLeftOpen, Truck, User } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { MasterList } from "@/components/masters/MasterList";
import { Contracts } from "@/components/masters/Contracts";
import { VehicleInsuranceSection } from "@/components/masters/VehicleInsuranceSection";
import { VehicleRoadTaxSection } from "@/components/masters/VehicleRoadTaxSection";
import { useSession } from "@/lib/session";
import { isAdminLike } from "@/lib/roles";
import {
  DRIVER_CONFIG,
  DELIVERY_PARTNER_CONFIG,
  LOCATION_CONFIG,
  TRANSPORTER_CONFIG,
  VEHICLE_CONFIG,
} from "@/components/masters/configs";

export const Route = createFileRoute("/masters")({
  head: () => ({
    meta: [
      { title: "Masters — Garuda Logistics Solutions | ORCA DEVS SURF" },
      {
        name: "description",
        content:
          "Manage vehicles, drivers, transporters and locations for Garuda Logistics Solutions with Excel-friendly import and export.",
      },
      { property: "og:title", content: "Masters — Garuda Logistics Solutions" },
      {
        property: "og:description",
        content: "Vehicles, drivers, transporters and locations for Garuda Logistics Solutions.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <MastersPage />
    </RequireAuth>
  ),
});

const ALL_TABS = [
  { id: "vehicle",     label: "Vehicle",    desc: "Fleet & specifications",  icon: Truck,     adminOnly: true  },
  { id: "driver",      label: "Driver",     desc: "Staff & licences",        icon: User,      adminOnly: false },
  { id: "transporter", label: "Transporter",desc: "Owners & brokers",        icon: Building2, adminOnly: false },
  { id: "delivery-partner", label: "Delivery Partners", desc: "Delivery partners", icon: Building2, adminOnly: false },
  { id: "location",    label: "Locations",  desc: "Pickup & drop points",    icon: MapPin,    adminOnly: true  },
  { id: "contract",    label: "Sources",    desc: "Rates & slabs",           icon: FileText,  adminOnly: true  },
] as const;

type TabId = (typeof ALL_TABS)[number]["id"];

function MastersPage() {
  const { user } = useSession();
  const isAdmin = isAdminLike(user?.role);
  const isViewer = user?.role === "viewer";

  // viewer (Manager) sees all tabs except Sources; basic users see non-adminOnly tabs only
  const TABS = isAdmin
    ? ALL_TABS
    : isViewer
      ? ALL_TABS.filter((t) => t.id !== "contract")
      : ALL_TABS.filter((t) => !t.adminOnly);

  const [tab, setTab] = useState<TabId>(isAdmin || isViewer ? "vehicle" : "driver");
  const [navOpen, setNavOpen] = useState(true);

  const active  = TABS.find((t) => t.id === tab) ?? TABS[0];
  const safeTab = active?.id ?? "driver";

  return (
    <AppShell
      breadcrumb={
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/home" className="hover:text-foreground">Workspace</Link>
          <ChevronRight className="size-3.5" />
          <Link to="/tms" className="hover:text-foreground">TMS</Link>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground">Masters</span>
        </span>
      }
      headerEnd={
        <button
          type="button"
          onClick={() => setNavOpen(v => !v)}
          title={navOpen ? "Hide sidebar" : "Show sidebar"}
          className="hidden lg:flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {navOpen
            ? <><PanelLeftClose className="size-3.5" /><span>Hide sidebar</span></>
            : <><PanelLeftOpen  className="size-3.5" /><span>Show sidebar</span></>
          }
        </button>
      }
    >
      <div className={`grid gap-6 ${navOpen ? "lg:grid-cols-[220px_1fr]" : "grid-cols-1"}`}>
        {/* Desktop left nav */}
        {navOpen && (
          <nav className="app-sidebar-scroll hidden lg:block lg:fixed lg:left-[max(1.5rem,calc((100vw-1280px)/2+1.5rem))] lg:top-20 lg:h-[calc(100dvh-5rem)] lg:w-[220px] lg:max-h-[calc(100dvh-5rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
            <p className="mb-3 px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Masters
            </p>
            <ul className="space-y-1">
              {TABS.map((t) => {
                const Icon     = t.icon;
                const isActive = t.id === safeTab;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setTab(t.id)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-200 ${
                        isActive
                          ? "bg-primary-soft text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <Icon className={`size-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
                      <span className="leading-tight min-w-0">
                        <span className="block text-sm font-medium truncate">{t.label}</span>
                        <span className="block text-[11px] opacity-70 truncate">{t.desc}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        {/* Mobile dropdown navigation */}
        <MobileTabDropdown
          tabs={TABS}
          activeId={safeTab}
          label="Masters"
          onChange={setTab}
        />

        <div key={safeTab} className={`animate-fade-in min-w-0 ${navOpen ? "lg:col-start-2" : ""}`}>
          <header className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">{active?.label}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{active?.desc}</p>
          </header>
          {safeTab === "vehicle" ? (
            <MasterList
              config={VEHICLE_CONFIG}
              renderExtraEditSections={isAdmin ? (id, row) => (
                <>
                  <VehicleInsuranceSection
                    vehicleId={id}
                    branchId={(row.branch_id as string | null) ?? null}
                    registrationNumber={String(row.registration_number ?? "")}
                  />
                  <VehicleRoadTaxSection
                    vehicleId={id}
                    branchId={(row.branch_id as string | null) ?? null}
                    registrationNumber={String(row.registration_number ?? "")}
                  />
                </>
              ) : undefined}
            />
          ) : null}
          {safeTab === "driver"      ? <MasterList config={DRIVER_CONFIG} />      : null}
          {safeTab === "transporter" ? <MasterList config={TRANSPORTER_CONFIG} /> : null}
          {safeTab === "delivery-partner" ? <MasterList config={DELIVERY_PARTNER_CONFIG} /> : null}
          {safeTab === "location"    ? <MasterList config={LOCATION_CONFIG} />    : null}
          {safeTab === "contract"    ? <Contracts />                               : null}
        </div>
      </div>
    </AppShell>
  );
}
