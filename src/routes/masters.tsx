import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Building2,
  ChevronRight,
  FileText,
  MapPin,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Truck,
  User,
} from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { SharedSidebar } from "@/components/SharedSidebar";
import { LtmsSidebar } from "@/components/ltms/LtmsSidebar";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { MasterList } from "@/components/masters/MasterList";
import { Contracts } from "@/components/masters/Contracts";
import { VehicleInsuranceSection } from "@/components/masters/VehicleInsuranceSection";
import { VehicleRoadTaxSection } from "@/components/masters/VehicleRoadTaxSection";
import { PartyMaster } from "@/components/masters/PartyMaster";
import { PackageRates } from "@/components/masters/PackageRates";
import { TransporterEntries } from "@/components/masters/TransporterEntries";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";
import { isAdminLike } from "@/lib/roles";
import {
  DRIVER_CONFIG,
  DELIVERY_PARTNER_CONFIG,
  LTMS_TRANSPORTER_CONFIG,
  LOCATION_CONFIG,
  RENTAL_CONFIG,
  TRANSPORTER_CONFIG,
  VEHICLE_CONFIG,
} from "@/components/masters/configs";

export const Route = createFileRoute("/masters")({
  head: () => ({
    meta: [
      { title: "Masters — ORCA DEVS SURF" },
      {
        name: "description",
        content:
          "Manage vehicles, drivers, transporters and locations for ORCA DEVS SURF with Excel-friendly import and export.",
      },
      { property: "og:title", content: "Masters — ORCA DEVS SURF" },
      {
        property: "og:description",
        content: "Vehicles, drivers, transporters and locations for ORCA DEVS SURF.",
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
  { id: "vehicle", label: "Vehicle", desc: "Fleet & specifications", icon: Truck, adminOnly: true },
  { id: "driver", label: "Driver", desc: "Staff & licences", icon: User, adminOnly: false },
  {
    id: "transporter",
    label: "Transporter",
    desc: "Owners & brokers",
    icon: Building2,
    adminOnly: false,
  },
  {
    id: "ltms-transporter",
    label: "Transporters",
    desc: "LTMS owners & brokers",
    icon: Building2,
    adminOnly: false,
  },
  {
    id: "rental",
    label: "Rentals",
    desc: "Rental vehicle providers",
    icon: Truck,
    adminOnly: false,
  },
  {
    id: "delivery-partner",
    label: "Delivery Partners",
    desc: "Delivery partners",
    icon: Building2,
    adminOnly: false,
  },
  {
    id: "location",
    label: "Locations",
    desc: "Pickup & drop points",
    icon: MapPin,
    adminOnly: true,
  },
  { id: "contract", label: "Sources", desc: "Rates & slabs", icon: FileText, adminOnly: true },
  {
    id: "package-rate",
    label: "Package Rate",
    desc: "Branch package slabs",
    icon: Package,
    adminOnly: true,
  },
  {
    id: "consignor",
    label: "Consignor",
    desc: "From-party GSTIN master",
    icon: Building2,
    adminOnly: false,
  },
  {
    id: "consignee",
    label: "Consignee",
    desc: "To-party GSTIN master",
    icon: Building2,
    adminOnly: false,
  },
] as const;

type TabId = (typeof ALL_TABS)[number]["id"];

export function MastersPage({ ltmsMode = false }: { ltmsMode?: boolean } = {}) {
  const { user } = useSession();
  const isAdmin = isAdminLike(user?.role);
  const isViewer = user?.role === "viewer";

  // Managers and basic users see every master except Sources; admin keeps all masters.
  const roleTabs = isAdmin
    ? ALL_TABS
    : isViewer || user?.role === "basic"
      ? ALL_TABS.filter((t) => t.id !== "contract")
      : ALL_TABS.filter((t) => !t.adminOnly);
  const TABS = ltmsMode
    ? roleTabs.filter((t) => t.id !== "transporter" && t.id !== "delivery-partner")
    : roleTabs.filter((t) => t.id !== "ltms-transporter");

  const [tab, setTab] = useState<TabId>(isAdmin || isViewer ? "vehicle" : "driver");
  const [navOpen, setNavOpen] = useState(true);
  const [openTransporter, setOpenTransporter] = useState<{
    id: string;
    transporter_name: string;
    branch_id: string | null;
  } | null>(null);

  const active = TABS.find((t) => t.id === tab) ?? TABS[0];
  const safeTab = active?.id ?? "driver";
  const sidebarOpen = ltmsMode || navOpen;
  const ltmsSidebarGroups = [
    {
      label: "Operations of LTMS",
      items: [{ id: "operations", label: "Operations", to: "/ltms/operations" as const }],
    },
    {
      label: "Billing",
      items: [{ id: "billing", label: "Billing", to: "/ltms/billing" as const }],
    },
    {
      label: "Reports",
      items: [{ id: "reports", label: "Reports", to: "/ltms/reports" as const }],
    },
    {
      label: "Masters",
      items: TABS.map((item) => ({
        id: item.id,
        label: item.label,
        active: item.id === safeTab,
        onSelect: () => setTab(item.id),
      })),
    },
    { label: "Finance", items: [{ id: "finance", label: "Finance", to: "/finance" as const }] },
  ];

  return (
    <AppShell
      variant={ltmsMode ? "ltms" : "default"}
      breadcrumb={
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/home" className="hover:text-foreground">
            Workspace
          </Link>
          <ChevronRight className="size-3.5" />
          <Link to={ltmsMode ? "/ltms" : "/tms"} className="hover:text-foreground">
            {ltmsMode ? "LTMS" : "TMS"}
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground">Masters</span>
        </span>
      }
      headerEnd={
        ltmsMode ? undefined : (
          <button
            type="button"
            onClick={() => setNavOpen((v) => !v)}
            title={navOpen ? "Hide sidebar" : "Show sidebar"}
            className="hidden lg:flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {navOpen ? (
              <>
                <PanelLeftClose className="size-3.5" />
                <span>Hide sidebar</span>
              </>
            ) : (
              <>
                <PanelLeftOpen className="size-3.5" />
                <span>Show sidebar</span>
              </>
            )}
          </button>
        )
      }
    >
      <div
        className={`grid gap-6 ${sidebarOpen ? (ltmsMode ? "lg:grid-cols-[192px_minmax(0,1fr)]" : "lg:grid-cols-[220px_minmax(0,1fr)]") : "grid-cols-1"} ${ltmsMode ? "ltms-reference-shell" : ""}`}
      >
        {/* Desktop left nav */}
        {sidebarOpen &&
          (ltmsMode ? (
            <LtmsSidebar groups={ltmsSidebarGroups} label="LTMS masters" />
          ) : (
            <SharedSidebar open={navOpen} width="220px" label="Masters">
              <ul className="space-y-1">
                {TABS.map((t) => {
                  const Icon = t.icon;
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
            </SharedSidebar>
          ))}

        {/* Mobile dropdown navigation */}
        <MobileTabDropdown tabs={TABS} activeId={safeTab} label="Masters" onChange={setTab} />

        <div
          key={safeTab}
          className={`animate-fade-in min-w-0 ${ltmsMode ? "ltms-reference-content" : ""}`}
        >
          <header className={`mb-6 ${ltmsMode ? "ltms-reference-page-header" : ""}`}>
            <h1 className="text-2xl font-semibold tracking-tight">{active?.label}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{active?.desc}</p>
          </header>
          {safeTab === "vehicle" ? (
            <MasterList
              config={VEHICLE_CONFIG}
              renderExtraEditSections={
                isAdmin
                  ? (id, row) => (
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
                    )
                  : undefined
              }
            />
          ) : null}
          {safeTab === "driver" ? <MasterList config={DRIVER_CONFIG} /> : null}
          {safeTab === "transporter" ? <MasterList config={TRANSPORTER_CONFIG} /> : null}
          {safeTab === "ltms-transporter" ? (
            openTransporter ? (
              <TransporterEntries
                transporter={openTransporter}
                onBack={() => setOpenTransporter(null)}
              />
            ) : (
              <MasterList
                config={LTMS_TRANSPORTER_CONFIG}
                renderRowActions={(row) => (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() =>
                      setOpenTransporter({
                        id: String(row.id),
                        transporter_name: String(row.transporter_name ?? ""),
                        branch_id: (row.branch_id as string | null) ?? null,
                      })
                    }
                  >
                    Open
                  </Button>
                )}
              />
            )
          ) : null}
          {safeTab === "rental" ? <MasterList config={RENTAL_CONFIG} /> : null}
          {safeTab === "delivery-partner" ? <MasterList config={DELIVERY_PARTNER_CONFIG} /> : null}
          {safeTab === "location" ? <MasterList config={LOCATION_CONFIG} /> : null}
          {safeTab === "contract" ? <Contracts /> : null}
          {safeTab === "package-rate" ? <PackageRates /> : null}
          {safeTab === "consignor" ? <PartyMaster partyType="consignor" /> : null}
          {safeTab === "consignee" ? <PartyMaster partyType="consignee" /> : null}
        </div>
      </div>
    </AppShell>
  );
}
