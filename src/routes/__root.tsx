import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { createIdbPersister } from "../lib/query-persist";
import { initSecurity } from "../lib/security";
import { preloadLogo } from "../lib/logo";

import appCss from "../styles.css?url";
import { SessionProvider } from "@/lib/session";
import { ThemeProvider, useTheme } from "../lib/theme";
import { WorkspaceBackgroundVideo } from "../components/WorkspaceBackgroundVideo";
import { Toaster } from "../components/ui/sonner";
import { OrcaAIProvider } from "../lib/orca-context";
import { MeetPanel } from "../components/MeetPanel";
import { useOrcaAI } from "../lib/orca-context";
import { useSession } from "../lib/session";
import { SplashScreen } from "../components/SplashScreen";
import { OrcaLogo } from "../components/OrcaLogo";
import { PasskeyGate } from "../components/PasskeyGate";
import { ScreenControlWidget } from "../components/ScreenControlWidget";
import { OrcaAIPanel } from "../components/OrcaAI";
import { useAppSettings } from "../lib/hooks";
import { ModuleLoadingScreen } from "../components/ModuleLoadingScreen";
import { SupabaseStatusGate } from "../components/SupabaseStatusGate";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <OrcaLogo className="mx-auto mb-6 h-20 w-20 text-foreground opacity-80" />
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  console.error("[AppError]", error?.message, error?.stack);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-xl text-center">
        <OrcaLogo className="mx-auto mb-6 h-20 w-20 text-foreground opacity-80" />
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        {error?.message && (
          <pre className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-left text-xs text-destructive overflow-auto max-h-40 whitespace-pre-wrap break-all">
            {error.message}
          </pre>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "author", content: "ORCA DEVS SURF" },
      { property: "og:image", content: "/orca-logo.svg" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:image", content: "/orca-logo.svg" },
      { name: "robots", content: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
      { name: "googlebot", content: "noindex, nofollow" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&display=swap",
      },
      { rel: "icon", href: "/orca-logo.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
    ],
    scripts: [{ src: "https://js.puter.com/v2/", async: true }],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
  shellComponent: RootShell,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="garuda">
      <head>
        <HeadContent />
        {import.meta.env.DEV && (
          <>
            <script dangerouslySetInnerHTML={{ __html: "window.__VIBEDIT_PORT__ = 4242;" }} />
            <script src="/_vibedit/overlay.js" defer />
          </>
        )}
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => {
  try {
    const stored = window.localStorage.getItem("garuda.theme.profile-v2") || window.localStorage.getItem("garuda.theme");
    const validThemes = new Set(["sky", "workspace", "glass", "emerald", "violet", "amber", "rose", "graphite", "garuda", "ocean", "blaze", "tangerine", "copper", "sakura", "arctic", "terra", "vintage", "paper", "kraft", "blueprint", "linen", "chalkboard", "vellum", "cork", "neon", "midnight", "forest", "storm"]);
    let theme = stored;
    let profile = null;
    if (stored && stored.startsWith("orca-theme-v2:") && stored.length <= 5000) {
      try {
        profile = JSON.parse(stored.slice("orca-theme-v2:".length));
        theme = profile.baseTheme;
      } catch { profile = null; theme = "garuda"; }
    }
    if (theme && validThemes.has(theme)) {
      const root = document.documentElement;
      root.setAttribute("data-theme", theme);
      const path = window.location.pathname.toLowerCase();
      const module = /^\\/wms(?:\\/|$)/.test(path) ? "wms"
        : /^\\/(?:accounts|cash-reports)(?:\\/|$)/.test(path) ? "accounts"
        : /^\\/(?:hrms|hr-dashboard|hr-data|dashboard|employees|payroll|attendance)(?:\\/|$)/.test(path) ? "hrms"
        : /^\\/(?:ltms|tms|masters|operations|finance|reports|report-master|import-trips)(?:\\/|$)/.test(path) ? "ltms"
        : "erp";
      const routeTheme = profile && profile.modules && validThemes.has(profile.modules[module])
        ? profile.modules[module] : theme;
      root.classList.toggle("dark", ["neon", "midnight", "forest", "storm"].includes(routeTheme));
      if (profile && profile.colors && typeof profile.colors === "object") {
        const colors = profile.colors;
        const hex = /^#[0-9a-fA-F]{6}$/;
        const set = (name, value) => root.style.setProperty(name, value);
        const tokens = {
          primary: ["--primary"],
          primaryForeground: ["--primary-foreground"],
          background: ["--background", "--ltms-surface"],
          foreground: ["--foreground", "--ltms-content-text"],
          card: ["--card", "--popover"],
          cardForeground: ["--card-foreground"],
          secondary: ["--secondary"],
          secondaryForeground: ["--secondary-foreground"],
          muted: ["--muted"],
          mutedForeground: ["--muted-foreground"],
          popover: ["--popover"],
          popoverForeground: ["--popover-foreground"],
          border: ["--border"],
          input: ["--input"],
          ring: ["--ring"],
          sidebar: ["--sidebar", "--ltms-chrome", "--wms-chrome"],
          sidebarForeground: ["--sidebar-foreground", "--ltms-chrome-text", "--wms-chrome-text"],
          sidebarCard: ["--ltms-chrome-card", "--wms-chrome-card"],
          sidebarAccent: ["--sidebar-accent", "--ltms-chrome-accent", "--wms-copper", "--ltms-branded"],
          sidebarAccentForeground: ["--sidebar-accent-foreground"],
          sidebarBorder: ["--sidebar-border"],
          wmsAccent: ["--wms-accent-override"],
        };
        for (const [key, names] of Object.entries(tokens)) {
          const value = colors[key];
          if (typeof value !== "string" || !hex.test(value)) continue;
          for (const name of names) set(name, value);
        }
        if (hex.test(colors.primary || "")) {
          set("--primary-soft", "color-mix(in oklch, " + colors.primary + " 14%, var(--card))");
          set("--primary-glow", "color-mix(in oklch, " + colors.primary + " 65%, white)");
          if (!colors.ring) set("--ring", colors.primary);
          if (!colors.sidebarAccent) set("--sidebar-primary", colors.primary);
        }
        if (hex.test(colors.primaryForeground || "") && !colors.sidebarAccentForeground) {
          set("--sidebar-primary-foreground", colors.primaryForeground);
        }
        if (hex.test(colors.foreground || "") && !colors.cardForeground) set("--card-foreground", colors.foreground);
        if (hex.test(colors.foreground || "") && !colors.popoverForeground) set("--popover-foreground", colors.foreground);
        if (hex.test(colors.border || "") && !colors.input) set("--input", colors.border);
      }
      if (profile && typeof profile.radius === "number" && profile.radius >= 0 && profile.radius <= 24) {
        root.style.setProperty("--radius", profile.radius + "px");
      }
      if (profile) root.dataset.density = profile.density === "compact" ? "compact" : "comfortable";
    }
  } catch {
    // Local storage may be unavailable; the default theme remains active.
  }
})();`,
          }}
        />
      </head>
      <body>
        <SessionProvider>
          <ThemeProvider>
            <WorkspaceBackgroundVideo />
            <OrcaAIProvider>{children}</OrcaAIProvider>
          </ThemeProvider>
        </SessionProvider>
        <Scripts />
      </body>
    </html>
  );
}

function SecurityInit() {
  useEffect(() => {
    initSecurity();
    void preloadLogo().catch(() => undefined);
  }, []);
  return null;
}

/** Listens for session-expired custom events dispatched by SessionProvider and
 *  shows an appropriate toast so the user knows why they were signed out. */
function SessionExpiredListener() {
  useEffect(() => {
    const handler = (e: Event) => {
      const reason = (e as CustomEvent<{ reason: string }>).detail?.reason;
      if (reason === "elsewhere") {
        toast.warning("You were signed out because your account was opened on another device.", {
          duration: 8000,
        });
      } else {
        toast.info("You were signed out due to inactivity.", { duration: 6000 });
      }
    };
    window.addEventListener("tms:session-expired", handler);
    return () => window.removeEventListener("tms:session-expired", handler);
  }, []);
  return null;
}

/** Recovers from a deploy/cache race where an old HTML document references a
 * chunk that is no longer part of the active deployment. Reload once with a
 * cache-busting query instead of leaving the user on a broken route. */
function DynamicImportRecovery() {
  useEffect(() => {
    const key = "sparrow-dynamic-import-recovery";
    const handleError = (event: ErrorEvent) => {
      const message = String(event.message ?? "");
      const isChunkError =
        /failed to fetch dynamically imported module|importing a module script failed|loading chunk/i.test(
          message,
        );
      if (!isChunkError || sessionStorage.getItem(key) === "1") return;
      sessionStorage.setItem(key, "1");
      const url = new URL(window.location.href);
      url.searchParams.set("_app_reload", String(Date.now()));
      window.location.replace(url.toString());
    };
    window.addEventListener("error", handleError);
    return () => window.removeEventListener("error", handleError);
  }, []);
  return null;
}

/** Renders the SPARROW AI panel — admin only, persists across route changes */
function PasskeyProtectionGate({ children }: { children: ReactNode }) {
  const { data: settings, isLoading } = useAppSettings();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (isLoading) return <ModuleLoadingScreen shellTitle="Garuda Logistics Solutions" />;
  // Picking tickets open in a new tab. The device gate is sessionStorage
  // scoped, so prompting again here would block a print-only WMS page even
  // though the WMS session cookie remains valid.
  if (pathname.startsWith("/picking-tickets")) return <>{children}</>;
  if (settings?.passkey_protection_enabled !== true) return <>{children}</>;
  return <PasskeyGate>{children}</PasskeyGate>;
}

function MeetPanelMount() {
  const { open, expanded, setExpanded } = useOrcaAI();
  const { user } = useSession();

  useEffect(() => {
    if (!open || !user) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open, user]);

  if (!open || !user) return null;
  return (
    <div
      className={
        expanded
          ? "fixed inset-0 z-[70] h-[100dvh] min-h-[100svh] w-screen max-w-none overflow-hidden bg-card shadow-[-4px_0_32px_rgba(0,0,0,0.12)]"
          : "fixed inset-0 z-[60] h-[100dvh] min-h-[100svh] w-screen max-w-none overflow-hidden bg-card shadow-[-4px_0_32px_rgba(0,0,0,0.12)] lg:inset-y-0 lg:left-auto lg:right-0 lg:h-[100dvh] lg:w-[360px] lg:max-w-[360px]"
      }
    >
      <MeetPanel onExpandChange={setExpanded} />
    </div>
  );
}

function OrcaAgentMount() {
  const { agentOpen } = useOrcaAI();
  const { user } = useSession();

  if (!user) return null;
  return (
    <>
      {agentOpen && (
        <div className="fixed bottom-5 right-4 z-[65] h-[min(680px,calc(100dvh-2.5rem))] w-[min(390px,calc(100vw-2rem))] overflow-hidden rounded-2xl shadow-2xl shadow-black/20">
          <OrcaAIPanel />
        </div>
      )}
    </>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { ready: themeReady } = useTheme();
  const [showEntrySplash, setShowEntrySplash] = useState(pathname === "/");
  // Stable callback: theme hydration must not restart the existing splash animation.
  const dismissSplash = useCallback(() => setShowEntrySplash(false), []);
  useEffect(() => {
    setShowEntrySplash(pathname === "/");
  }, [pathname]);
  const persister = useMemo(
    () => (typeof window === "undefined" ? null : createIdbPersister()),
    [],
  );

  // The owner-side WebRTC host has its own branded page, but no ERP shell,
  // screen-control request UI, or controls.
  if (pathname === "/screen-control-host") return <Outlet />;

  return (
    <>
      {showEntrySplash && <SplashScreen onComplete={dismissSplash} />}
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: persister ?? {
            persistClient: async () => {},
            restoreClient: async () => undefined,
            removeClient: async () => {},
          },
          maxAge: 24 * 60 * 60 * 1000,
        }}
      >
        <SupabaseStatusGate>
          {pathname === "/share" ? (
            <>
              <Outlet />
              <Toaster position="top-right" />
            </>
          ) : (
            <PasskeyProtectionGate>
              <SecurityInit />
              <SessionExpiredListener />
              <DynamicImportRecovery />
              {(pathname !== "/" || themeReady) && <Outlet />}
              <ScreenControlWidget />
              <Toaster position="top-right" />
              <MeetPanelMount />
              <OrcaAgentMount />
            </PasskeyProtectionGate>
          )}
        </SupabaseStatusGate>
      </PersistQueryClientProvider>
    </>
  );
}
