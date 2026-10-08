// Adapted from the grouped Sidebar component in satviksingh0828-wq/sentry-wms-vercel-admin
// (Apache-2.0, package version 1.37.0). The visual grouping, collapsible headers,
// keyboard behavior, and active-row treatment follow that source; routing is
// intentionally wired to this ERP's TanStack Router and existing SharedSidebar.
import { useState } from "react";
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
  open = true,
  label = "LTMS navigation",
}: {
  groups: LtmsSidebarGroup[];
  open?: boolean;
  label?: string;
}) {
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const stored: unknown = JSON.parse(
        window.localStorage.getItem("ltms.sidebar.collapsed") || "{}",
      );
      return stored && typeof stored === "object" && !Array.isArray(stored)
        ? (stored as Record<string, boolean>)
        : {};
    } catch {
      return {};
    }
  });

  function toggleGroup(groupLabel: string) {
    setCollapsed((current) => {
      const next = { ...current, [groupLabel]: !current[groupLabel] };
      try {
        window.localStorage.setItem("ltms.sidebar.collapsed", JSON.stringify(next));
      } catch {
        // Ignore storage failures (private browsing or quota limits).
      }
      return next;
    });
  }

  return (
    <>
      <SharedSidebar open={open} width="192px" label={label} className="ltms-reference-sidebar">
        {groups.map((group) => {
          const isCollapsed = !!collapsed[group.label];
          return (
            <section key={group.label} className="ltms-reference-sidebar-card">
              <button
                type="button"
                className="ltms-reference-group-label"
                aria-expanded={!isCollapsed}
                onClick={() => toggleGroup(group.label)}
              >
                <span>{group.label}</span>
                <span className="ltms-reference-caret" aria-hidden="true">
                  {isCollapsed ? "▸" : "▾"}
                </span>
              </button>
              {!isCollapsed && (
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
              )}
            </section>
          );
        })}
      </SharedSidebar>

      {open && (
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
      )}
    </>
  );
}
