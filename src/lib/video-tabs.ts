import { useSyncExternalStore } from "react";

/**
 * The ERP route stays unchanged while its LTMS and embedded Sentry tabs change.
 * This small external store tells the shared video layer and header which tab
 * is visible, without changing route URLs or business logic.
 */
type ActiveTab = { pathname: string; key: string };
const listeners = new Set<() => void>();
let activeTab: ActiveTab | null = null;

export type VideoTabOption = { key: string; label: string };
export type VideoTabGroup = { title: string; options: VideoTabOption[] };

export const VIDEO_TAB_GROUPS: VideoTabGroup[] = [
  { title: "Start & security", options: [
    { key: "login", label: "Login" },
    { key: "home", label: "Home" },
    { key: "passkey", label: "Passkey verification" },
  ] },
  { title: "ERP settings & users", options: [
    { key: "settings:appearance", label: "Appearance & Themes" },
    { key: "settings:company", label: "Company" },
    { key: "settings:branch", label: "Branch" },
    { key: "settings:passkey", label: "Passkey settings" },
    { key: "settings:wms", label: "WMS settings tabs" },
    { key: "users", label: "Users" },
  ] },
  { title: "LTMS dashboards, operations & reports", options: [
    { key: "ltms:dashboard:data", label: "Dashboard" },
    { key: "ltms:dashboard:comparison", label: "Comparison" },
    { key: "ltms:operations:trip", label: "Trips" },
    { key: "ltms:operations:shipments", label: "Shipments" },
    { key: "ltms:operations:consignment", label: "Consignments" },
    { key: "ltms:operations:lr", label: "Lorry receipts" },
    { key: "ltms:operations:manifest", label: "Manifests" },
    { key: "ltms:operations:ltms-manifest", label: "LTMS manifests" },
    { key: "ltms:operations:stock-inward", label: "Stock inward" },
    { key: "ltms:operations:stock-outward", label: "Stock outward" },
    { key: "ltms:billing", label: "Billing (other tabs can be enabled from their header)" },
    { key: "ltms:reports", label: "Reports (other tabs can be enabled from their header)" },
    { key: "ltms:masters", label: "Masters (other tabs can be enabled from their header)" },
    { key: "ltms:finance", label: "Finance (other tabs can be enabled from their header)" },
  ] },
  { title: "Other modules", options: [
    { key: "route:accounts", label: "Accounts" },
    { key: "route:hrms", label: "HRMS" },
    { key: "route:employees", label: "Employees" },
    { key: "route:payroll", label: "Payroll" },
    { key: "route:attendance", label: "Attendance" },
  ] },
  { title: "Sentry / WMS tabs", options: [
    { key: "wms:dashboard", label: "WMS dashboard" },
    { key: "wms:inventory", label: "Inventory" },
    { key: "wms:cycle-counts", label: "Cycle counts" },
    { key: "wms:count-approvals", label: "Count approvals" },
    { key: "wms:purchase-orders", label: "Purchase orders" },
    { key: "wms:receiving", label: "Receiving" },
    { key: "wms:putaway", label: "Put-away" },
    { key: "wms:sales-orders", label: "Sales orders" },
    { key: "wms:pos-activity", label: "POS activity" },
    { key: "wms:fraud", label: "Fraud" },
    { key: "wms:backorders", label: "Backorders" },
    { key: "wms:picking-tickets", label: "Picking tickets" },
    { key: "wms:picking-batches", label: "Picking batches" },
    { key: "wms:returns/rma", label: "Returns / RMA" },
    { key: "wms:returns/refunds", label: "Returns / refunds" },
    { key: "wms:items", label: "Items" },
    { key: "wms:vendors", label: "Vendors" },
    { key: "wms:adjustments", label: "Adjustments" },
    { key: "wms:data/warehouses", label: "Warehouses" },
    { key: "wms:data/bins", label: "Bins" },
    { key: "wms:data/zones", label: "Zones" },
    { key: "wms:data/preferred-bins", label: "Preferred bins" },
    { key: "wms:inter-warehouse-transfers", label: "Inventory transfers" },
    { key: "wms:transfer-orders", label: "Transfer orders" },
    { key: "wms:users", label: "WMS users" },
    { key: "wms:api-tokens", label: "WMS API tokens" },
    { key: "wms:inbound", label: "Inbound activity" },
    { key: "wms:consumer-groups", label: "Consumer groups" },
    { key: "wms:webhooks", label: "Webhooks" },
    { key: "wms:channels", label: "Channels" },
    { key: "wms:notifications", label: "Notifications" },
    { key: "wms:audit-log", label: "Audit log" },
    { key: "wms:settings", label: "Standalone WMS settings" },
    { key: "wms:imports", label: "WMS imports" },
    { key: "wms:integrations", label: "WMS integrations" },
    { key: "wms:change-password", label: "Password changes" },
  ] },
];

const DEFAULT_ENABLED = new Set(["home", "login", "passkey"]);
export const isVideoTabKey = (key: unknown): key is string =>
  typeof key === "string" && key.length > 0 && key.length <= 96 &&
  /^[a-z0-9:/_-]+$/.test(key);

/** Everything other than Home, Login and Passkey is video-off initially. */
export function videoEnabledForTab(overrides: Record<string, boolean> | undefined, key: string): boolean {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) {
    return overrides[key] === true;
  }
  // A section-level choice can set the default for its child tabs.
  // Explicit child choices always take precedence.
  const parent = key.lastIndexOf(":");
  if (parent > 0) {
    const ancestor = key.slice(0, parent);
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, ancestor)) return overrides[ancestor] === true;
  }
  return DEFAULT_ENABLED.has(key);
}

export function videoTabFromPath(pathname: string): string {
  const clean = pathname.toLowerCase().replace(/\/+$/, "") || "/";
  if (clean === "/") return "login";
  if (clean === "/home") return "home";
  if (clean === "/wms") return "wms:dashboard";
  if (clean === "/users") return "users";
  if (clean === "/settings") return "settings:appearance";
  const segment = clean.split("/")[1] || "";
  if (["ltms", "tms", "masters", "operations", "reports", "billing", "finance"].includes(segment)) {
    const section = segment === "ltms" ? clean.split("/")[2] || "dashboard" : segment;
    return `ltms:${section}`;
  }
  const key = "route:" + clean.replace(/^\//, "").replace(/[^a-z0-9:/_-]/g, "").slice(0, 82);
  return isVideoTabKey(key) ? key : "route:other";
}

export function videoTabFromWmsPath(pathname: string): string {
  const name = pathname.toLowerCase().replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9/_-]/g, "").slice(0, 86);
  return name ? "wms:" + name : "wms:dashboard";
}

export function reportActiveVideoTab(key: string, pathname?: string): () => void {
  if (typeof window === "undefined" || !isVideoTabKey(key)) return () => undefined;
  const atPath = pathname || window.location.pathname;
  activeTab = { key, pathname: atPath };
  listeners.forEach((notify) => notify());
  return () => {
    if (activeTab?.key !== key || activeTab.pathname !== atPath) return;
    activeTab = null;
    listeners.forEach((notify) => notify());
  };
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}
function getTab(pathname: string) {
  return activeTab?.pathname === pathname ? activeTab.key : videoTabFromPath(pathname);
}
/** React-safe shared snapshot: works for embedded MemoryRouter WMS tabs. */
export function useCurrentVideoTab(pathname: string) {
  return useSyncExternalStore(
    subscribe,
    () => getTab(pathname),
    () => videoTabFromPath(pathname),
  );
}
