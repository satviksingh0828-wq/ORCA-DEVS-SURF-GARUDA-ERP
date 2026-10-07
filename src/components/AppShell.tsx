import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Database,
  FileText,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Truck,
  User,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useSession } from "@/lib/session";
import { useOrcaAI } from "@/lib/orca-context";
import { MeetTrigger } from "@/components/MeetPanel";
import { NotificationBell } from "@/components/NotificationBell";
import { cn } from "@/lib/utils";
import { isAdminLike } from "@/lib/roles";
import { useTheme } from "@/lib/theme";

let sharedBackgroundVideo: HTMLVideoElement | null = null;
let sharedBackgroundVeil: HTMLDivElement | null = null;
let sharedBackgroundVideoUrl = "";
let sharedBackgroundVideoReady = false;
function ensureSharedBackgroundVideo() {
  if (sharedBackgroundVideo && sharedBackgroundVeil) {
    if (!document.body.contains(sharedBackgroundVideo))
      document.body.appendChild(sharedBackgroundVideo);
    if (!document.body.contains(sharedBackgroundVeil))
      document.body.appendChild(sharedBackgroundVeil);
    return { video: sharedBackgroundVideo, veil: sharedBackgroundVeil };
  }
  const video = document.createElement("video");
  video.className = "background-video-layer";
  video.autoplay = true;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.poster = "/garuda-banner.webp";
  video.setAttribute("aria-hidden", "true");
  video.addEventListener("canplay", () => {
    sharedBackgroundVideoReady = true;
    video.classList.add("background-video-ready");
  });
  const veil = document.createElement("div");
  veil.className = "video-background-veil background-video-veil-layer";
  veil.setAttribute("aria-hidden", "true");
  document.body.append(video, veil);
  sharedBackgroundVideo = video;
  sharedBackgroundVeil = veil;
  return { video, veil };
}

type NavItem = { label: string; to: string; icon: typeof Truck };
type NavGroup = { label: string; items: NavItem[] };
const WORKSPACE_NAV: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { label: "Overview", to: "/home", icon: LayoutDashboard },
      { label: "LTMS", to: "/ltms", icon: Truck },
      { label: "HRMS", to: "/hrms", icon: Users },
      { label: "Accounts", to: "/accounts", icon: WalletCards },
      { label: "Users", to: "/users", icon: User },
      { label: "Settings", to: "/settings", icon: Settings },
    ],
  },
];
const LTMS_NAV: NavGroup[] = [
  {
    label: "LTMS",
    items: [
      { label: "Operations", to: "/ltms/operations", icon: ClipboardList },
      { label: "Finance", to: "/finance", icon: WalletCards },
      { label: "Billing", to: "/ltms/billing", icon: WalletCards },
      { label: "Masters", to: "/ltms/masters", icon: Database },
      { label: "Reports", to: "/ltms/reports", icon: BarChart3 },
    ],
  },
];
const HRMS_NAV: NavGroup[] = [
  {
    label: "HRMS",
    items: [
      { label: "Employees", to: "/employees", icon: Users },
      { label: "Attendance", to: "/attendance", icon: ClipboardList },
      { label: "Payroll", to: "/payroll", icon: WalletCards },
      { label: "Dashboards", to: "/dashboard/employee", icon: BarChart3 },
    ],
  },
];
const ACCOUNTS_NAV: NavGroup[] = [
  {
    label: "Accounts",
    items: [
      { label: "Masters", to: "/accounts/masters", icon: Database },
      { label: "Journal", to: "/accounts/journal", icon: ClipboardList },
      { label: "Ledger", to: "/accounts/ledger", icon: FileText },
      { label: "Final Accounts", to: "/accounts/final", icon: BarChart3 },
    ],
  },
];
const ADMIN_NAV: NavGroup[] = [
  {
    label: "Administration",
    items: [
      { label: "Users", to: "/users", icon: User },
      { label: "Settings", to: "/settings", icon: Settings },
      { label: "System", to: "/system", icon: ShieldCheck },
    ],
  },
];
function Database(props: React.ComponentProps<typeof Truck>) {
  return <WalletCards {...props} />;
}
function FileText(props: React.ComponentProps<typeof Truck>) {
  return <ClipboardList {...props} />;
}
function moduleNavigation(pathname: string): { label: string; groups: NavGroup[] } {
  if (pathname.startsWith("/ltms") || pathname === "/finance")
    return { label: "LTMS", groups: LTMS_NAV };
  if (
    pathname.startsWith("/hrms") ||
    pathname.startsWith("/employees") ||
    pathname.startsWith("/attendance") ||
    pathname.startsWith("/payroll") ||
    pathname.startsWith("/hr-dashboard")
  )
    return { label: "HRMS", groups: HRMS_NAV };
  if (pathname.startsWith("/accounts")) return { label: "Accounts", groups: ACCOUNTS_NAV };
  if (
    pathname.startsWith("/users") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/system")
  )
    return { label: "Administration", groups: ADMIN_NAV };
  return { label: "Workspace", groups: WORKSPACE_NAV };
}

export function AppShell({
  children,
  breadcrumb,
  headerEnd,
  mainClassName,
  showSidebar = true,
}: {
  children: ReactNode;
  breadcrumb?: ReactNode;
  headerEnd?: ReactNode;
  mainClassName?: string;
  showSidebar?: boolean;
}) {
  const { signOut, user } = useSession();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { open, expanded } = useOrcaAI();
  const { backgroundVideoEnabled, backgroundVideoUrl, videoGlassAppearance } = useTheme();
  const isAdmin = isAdminLike(user?.role);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const previousAttribute = root.getAttribute("data-video-background");
    const properties = [
      "--video-glass-opacity",
      "--video-background-veil",
      "--video-glass-text-color",
    ];
    const previousStyles = properties.map((property) => ({
      property,
      value: root.style.getPropertyValue(property),
      priority: root.style.getPropertyPriority(property),
    }));
    if (backgroundVideoEnabled) root.setAttribute("data-video-background", "on");
    else root.removeAttribute("data-video-background");
    root.style.setProperty("--video-glass-opacity", `${videoGlassAppearance.surfaceOpacity}%`);
    root.style.setProperty("--video-background-veil", `${videoGlassAppearance.backgroundVeil}%`);
    root.style.setProperty("--video-glass-text-color", videoGlassAppearance.textColor);
    return () => {
      if (previousAttribute === null) root.removeAttribute("data-video-background");
      else root.setAttribute("data-video-background", previousAttribute);
      previousStyles.forEach(({ property, value, priority }) =>
        value
          ? root.style.setProperty(property, value, priority)
          : root.style.removeProperty(property),
      );
    };
  }, [backgroundVideoEnabled, videoGlassAppearance]);
  useEffect(() => {
    const { video, veil } = ensureSharedBackgroundVideo();
    video.style.display = backgroundVideoEnabled ? "block" : "none";
    veil.style.display = backgroundVideoEnabled ? "block" : "none";
    if (!backgroundVideoEnabled) return;
    if (sharedBackgroundVideoUrl !== backgroundVideoUrl) {
      sharedBackgroundVideoUrl = backgroundVideoUrl;
      sharedBackgroundVideoReady = false;
      video.classList.remove("background-video-ready");
      video.src = backgroundVideoUrl;
      video.load();
    }
    if (sharedBackgroundVideoReady) video.classList.add("background-video-ready");
    if (document.body.dataset.screenControlActive !== "true")
      void video.play().catch(() => undefined);
  }, [backgroundVideoEnabled, backgroundVideoUrl]);
  useEffect(
    () => () => {
      if (sharedBackgroundVideo) sharedBackgroundVideo.style.display = "none";
      if (sharedBackgroundVeil) sharedBackgroundVeil.style.display = "none";
    },
    [],
  );
  const module = moduleNavigation(pathname);
  const isActive = (to: string) =>
    to === "/home" ? pathname === "/home" : pathname === to || pathname.startsWith(`${to}/`);

  return (
    <div
      data-video-background={backgroundVideoEnabled ? "on" : "off"}
      style={
        {
          "--video-glass-opacity": `${videoGlassAppearance.surfaceOpacity}%`,
          "--video-background-veil": `${videoGlassAppearance.backgroundVeil}%`,
          "--video-glass-text-color": videoGlassAppearance.textColor,
        } as CSSProperties
      }
      className={cn(
        "relative flex h-screen flex-col overflow-hidden transition-all duration-300",
        backgroundVideoEnabled ? "bg-transparent" : "bg-background",
        user && open && !expanded ? "lg:mr-[360px]" : "",
      )}
    >
      <header className="erp-topbar relative z-40 shrink-0">
        <div className="flex h-14 w-full items-center gap-3 px-3 sm:px-5">
          {showSidebar && (
            <button
              type="button"
              className="erp-mobile-menu lg:hidden"
              aria-label="Open navigation"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu className="size-4" />
            </button>
          )}
          <Link to="/home" className="erp-brand shrink-0">
            <span className="erp-brand-mark">
              <Truck className="size-4" />
            </span>
            <span className="hidden sm:inline">Garuda ERP</span>
            <span className="erp-version hidden md:inline">v2.0</span>
          </Link>
          {breadcrumb && (
            <div className="erp-breadcrumb ml-2 hidden min-w-0 items-center gap-2 md:flex">
              {breadcrumb}
            </div>
          )}
          {headerEnd && <div className="ml-2 hidden lg:block">{headerEnd}</div>}
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <div
              data-app-shell-header-actions
              className="flex shrink-0 items-center gap-1.5 sm:gap-2"
            />
            <button type="button" className="erp-help hidden sm:inline-flex" title="Help">
              <CircleHelp className="size-4" />
            </button>
            {isAdmin && (
              <Link to="/system" title="System" className="erp-topbar-icon hidden sm:inline-flex">
                <ShieldCheck className="size-4" />
              </Link>
            )}
            {(isAdmin || user?.role === "viewer" || user?.role === "basic") && <NotificationBell />}
            {user && <MeetTrigger />}
            <div className="relative">
              <button
                type="button"
                className="erp-profile"
                onClick={() => setProfileOpen((value) => !value)}
                aria-expanded={profileOpen}
              >
                <span className="erp-avatar">
                  {(user?.fullName ?? user?.username ?? "G").slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden max-w-[140px] truncate text-left sm:block">
                  <strong>{user?.fullName ?? user?.username}</strong>
                  <small>{isAdmin ? "Administrator" : "Operator"}</small>
                </span>
                <ChevronDown className="hidden size-3.5 sm:block" />
              </button>
              {profileOpen && (
                <div className="erp-profile-menu">
                  <div className="erp-profile-heading">
                    {user?.fullName ?? user?.username}
                    <small>{user?.role}</small>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      signOut();
                      navigate({ to: "/", replace: true });
                    }}
                  >
                    <LogOut className="size-4" /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      <div className="erp-shell-body relative z-10 min-h-0 flex-1">
        {showSidebar && (
          <aside className={cn("erp-sidebar", mobileNavOpen && "is-open")}>
            <div className="erp-sidebar-mobile-close lg:hidden">
              <span>Navigation</span>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="erp-sidebar-context">
              <span className="erp-context-dot" /> {module.label}
            </div>
            {module.groups.map((group) => (
              <div key={group.label} className="erp-nav-group">
                <p>{group.label}</p>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.to);
                  return (
                    <a
                      key={item.to}
                      href={item.to}
                      className={cn("erp-nav-item", active && "active")}
                      onClick={() => setMobileNavOpen(false)}
                    >
                      <Icon className="size-4" />
                      <span>{item.label}</span>
                      {active && <span className="erp-nav-active-dot" />}
                    </a>
                  );
                })}
              </div>
            ))}
          </aside>
        )}
        {showSidebar && mobileNavOpen && (
          <button
            type="button"
            className="erp-sidebar-backdrop lg:hidden"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          />
        )}
        <main
          className={cn(
            "relative min-h-0 w-full max-w-none overflow-x-hidden overflow-y-auto [overflow-anchor:none] px-3 py-5 sm:px-6 sm:py-7 lg:px-8",
            mainClassName,
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
