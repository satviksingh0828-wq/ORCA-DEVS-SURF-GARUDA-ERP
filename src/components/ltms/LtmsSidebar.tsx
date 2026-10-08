// Adapted from the grouped Sidebar component in satviksingh0828-wq/sentry-wms-vercel-admin
// (Apache-2.0, package version 1.37.0). Visual grouping and active-row treatment follow
// that source; routes use this ERP's TanStack Router and existing SharedSidebar.
import { Link } from "@tanstack/react-router";
import { SharedSidebar } from "@/components/SharedSidebar";
import { useSession } from "@/lib/session";
import { isAdminLike } from "@/lib/roles";

export type LtmsSection = "operations" | "billing" | "reports" | "masters" | "finance";

type LtmsRoute =
  "/ltms/operations" | "/ltms/billing" | "/ltms/reports" | "/ltms/masters" | "/ltms/finance";

export type LtmsSidebarItem = { id: string; label: string; to?: string };

export type LtmsSidebarGroup = {
  section: LtmsSection | string;
  label: string;
  items: LtmsSidebarItem[];
};

const ROUTES: Record<LtmsSection, LtmsRoute> = {
  operations: "/ltms/operations",
  billing: "/ltms/billing",
  reports: "/ltms/reports",
  masters: "/ltms/masters",
  finance: "/ltms/finance",
};

const PENDING_TAB_KEY = "ltms.pending-sidebar-tab";

export function queueLtmsTabNavigation(section: LtmsSection, tabId: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PENDING_TAB_KEY, JSON.stringify({ section, tabId }));
  } catch {
    // Ignore storage restrictions; the destination will use its normal default tab.
  }
}

export function consumeLtmsTabNavigation(section: LtmsSection): string | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = window.sessionStorage.getItem(PENDING_TAB_KEY);
    if (!saved) return null;
    const pending = JSON.parse(saved) as { section?: string; tabId?: string };
    if (pending.section !== section || typeof pending.tabId !== "string") return null;
    window.sessionStorage.removeItem(PENDING_TAB_KEY);
    return pending.tabId;
  } catch {
    return null;
  }
}

const NAVIGATION: LtmsSidebarGroup[] = [
  {
    section: "operations",
    label: "Operations",
    items: [
      { id: "trip", label: "Trip" },
      { id: "shipments", label: "Shipments" },
      { id: "consignment", label: "Consignment" },
      { id: "ltms-manifest", label: "Manifest" },
      { id: "outward-pod", label: "Outward POD" },
      { id: "stock-inward", label: "Stock Inward" },
      { id: "admin-mis", label: "ADMIN MIS" },
      { id: "monthly-mis", label: "Monthly MIS" },
      { id: "fastag-report", label: "Fastag Balance" },
      { id: "rental-advance", label: "Rental Advance" },
    ],
  },
  {
    section: "billing",
    label: "Billing",
    items: [
      { id: "trip-billing", label: "Trip Billing" },
      { id: "source-billing", label: "Source Billing" },
      { id: "unloading-received", label: "Unloading Received" },
      { id: "approval-income", label: "Approval Income" },
      { id: "transporter-billing", label: "Transporter Bill" },
      { id: "workmen-billing", label: "Workmen Billing" },
    ],
  },
  {
    section: "reports",
    label: "Reports",
    items: [
      { id: "movements", label: "Movements" },
      { id: "eway-bill", label: "E-Way Bill" },
      { id: "update-consignment", label: "Update Consignment" },
      { id: "consignment-income", label: "Consignment Income" },
      { id: "transporter-expenditure", label: "Transporter Expenditure" },
      { id: "unloading-income", label: "Unloading Income" },
      { id: "loading-charges", label: "Workmen Charges" },
      { id: "trip-expenditure", label: "Trip Expenditure" },
      { id: "consignment-net", label: "Consignment Net" },
      { id: "sources", label: "Sources" },
    ],
  },
  {
    section: "masters",
    label: "Masters",
    items: [
      { id: "vehicle", label: "Vehicle" },
      { id: "driver", label: "Driver" },
      { id: "ltms-transporter", label: "Transporters" },
      { id: "rental", label: "Rentals" },
      { id: "location", label: "Locations" },
      { id: "contract", label: "Sources" },
      { id: "package-rate", label: "Package Rate" },
      { id: "consignor", label: "Consignor" },
      { id: "consignee", label: "Consignee" },
    ],
  },
  {
    section: "finance",
    label: "Finance",
    items: [
      { id: "income", label: "Income" },
      { id: "expenditure", label: "Expenditure" },
      { id: "driver-payroll", label: "Driver Payroll" },
      { id: "fixed-income", label: "Fixed Income" },
      { id: "emi-scheduler", label: "EMI Scheduler" },
      { id: "insurance-expenses", label: "Insurance Premium" },
      { id: "road-tax-expenses", label: "Road Tax" },
    ],
  },
];

function visibleGroups(role: string | undefined): LtmsSidebarGroup[] {
  const isAdmin = isAdminLike(role);
  const isViewer = role === "viewer";
  const isBasic = role === "basic";
  const isStandardManager = !isAdmin && !isViewer && !isBasic;

  return NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (group.section === "operations") return !(isBasic && item.id === "admin-mis");
      if (group.section === "billing") return !(isBasic && item.id === "source-billing");
      if (group.section === "reports")
        return !(isBasic && ["consignment-income", "consignment-net"].includes(item.id));
      if (group.section === "masters") {
        if (item.id === "contract" && !isAdmin) return false;
        const adminOnly = ["vehicle", "location", "package-rate", "contract"].includes(item.id);
        return !isStandardManager || !adminOnly;
      }
      if (group.section === "finance") {
        if (isAdmin || isViewer) return true;
        return isBasic && ["income", "expenditure", "driver-payroll"].includes(item.id);
      }
      return true;
    }),
  }));
}

export function LtmsSidebar({
  section,
  activeTabId,
  onSelectTab,
  label = "LTMS navigation",
  open = true,
  groups: customGroups,
}: {
  section?: LtmsSection | string;
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  label?: string;
  open?: boolean;
  groups?: LtmsSidebarGroup[];
}) {
  const { user } = useSession();
  const groups = customGroups ?? visibleGroups(user?.role);
  const isCustom = Boolean(customGroups);
  return (
    <>
      <SharedSidebar open={open} width="192px" label={label} className="ltms-reference-sidebar">
        {groups.map((group) => (
          <section key={group.section} className="ltms-reference-sidebar-card">
            <h2 className="ltms-reference-group-label">{group.label}</h2>
            <div className="ltms-reference-sidebar-items">
              {group.items.map((item) => {
                const isActive = group.section === section && item.id === activeTabId;
                const rowClass = `ltms-reference-sidebar-link${isActive ? " active" : ""}`;
                if (isCustom && item.to) {
                  return (
                    <a
                      key={item.id}
                      href={item.to}
                      className={rowClass}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <span>{item.label}</span>
                    </a>
                  );
                }
                if (group.section === section) {
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={rowClass}
                      onClick={() => onSelectTab(item.id)}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <span>{item.label}</span>
                    </button>
                  );
                }
                const targetSection = group.section as LtmsSection;
                return (
                  <Link
                    key={item.id}
                    to={ROUTES[targetSection]}
                    className={rowClass}
                    onClick={() => queueLtmsTabNavigation(targetSection, item.id)}
                  >
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </SharedSidebar>
      {isCustom ? (
        <nav className="ltms-reference-mobile-nav lg:hidden" aria-label={label}>
          {groups.map((group) => {
            const firstRoute = group.items.find((item) => item.to)?.to;
            if (!firstRoute) return null;
            const isActive = group.section === section;
            return (
              <a
                key={group.section}
                href={firstRoute}
                className={`ltms-reference-mobile-link${isActive ? " active" : ""}`}
                aria-current={isActive ? "page" : undefined}
              >
                {group.label}
              </a>
            );
          })}
        </nav>
      ) : (
        <nav className="ltms-reference-mobile-nav lg:hidden" aria-label="LTMS sections">
          {(Object.keys(ROUTES) as LtmsSection[]).map((targetSection) => {
            const group = NAVIGATION.find((item) => item.section === targetSection);
            const isActive = targetSection === section;
            return (
              <Link
                key={targetSection}
                to={ROUTES[targetSection]}
                className={`ltms-reference-mobile-link${isActive ? " active" : ""}`}
                aria-current={isActive ? "page" : undefined}
              >
                {group?.label ?? targetSection}
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}
