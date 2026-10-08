// Adapted from the grouped Sidebar component in satviksingh0828-wq/sentry-wms-vercel-admin
// (Apache-2.0, package version 1.37.0). Visual grouping and active-row treatment follow
// that source; routes use this ERP's TanStack Router and existing SharedSidebar.
import { Link, useLocation } from "@tanstack/react-router";
import { SharedSidebar } from "@/components/SharedSidebar";

type LtmsRoute =
  "/ltms/operations" | "/ltms/billing" | "/ltms/reports" | "/ltms/masters" | "/finance";

export type LtmsSidebarItem = {
  id: string;
  label: string;
  to?: LtmsRoute;
  active?: boolean;
  onSelect?: () => void;
};

export type LtmsSidebarGroup = {
  label: string;
  items: LtmsSidebarItem[];
};

const ROUTE_LINKS: { label: string; to: LtmsRoute }[] = [
  { label: "Operations", to: "/ltms/operations" },
  { label: "Billing", to: "/ltms/billing" },
  { label: "Reports", to: "/ltms/reports" },
  { label: "Masters", to: "/ltms/masters" },
  { label: "Finance", to: "/finance" },
];

export function LtmsSidebar({
  groups,
  label = "LTMS navigation",
}: {
  groups: LtmsSidebarGroup[];
  label?: string;
}) {
  const { pathname } = useLocation();

  return (
    <>
      <SharedSidebar open width="192px" label={label} className="ltms-reference-sidebar">
        {groups.map((group) => (
          <section key={group.label} className="ltms-reference-sidebar-card">
            <h2 className="ltms-reference-group-label">{group.label}</h2>
            <div className="ltms-reference-sidebar-items">
              {group.items.map((item) => {
                const rowClass = `ltms-reference-sidebar-link${item.active ? " active" : ""}`;
                return item.to ? (
                  <Link
                    key={item.id}
                    to={item.to}
                    className={rowClass}
                    aria-current={item.active ? "page" : undefined}
                  >
                    <span>{item.label}</span>
                  </Link>
                ) : (
                  <button
                    key={item.id}
                    type="button"
                    className={rowClass}
                    onClick={item.onSelect}
                    aria-current={item.active ? "page" : undefined}
                  >
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </SharedSidebar>

      <nav className="ltms-reference-mobile-nav lg:hidden" aria-label="LTMS sections">
        {ROUTE_LINKS.map((item) => {
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`ltms-reference-mobile-link${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
