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
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { createIdbPersister } from "../lib/query-persist";
import { initSecurity } from "../lib/security";
import { preloadLogo } from "../lib/logo";

import appCss from "../styles.css?url";
import { SessionProvider } from "../lib/session";
import { ThemeProvider } from "../lib/theme";
import { Toaster } from "../components/ui/sonner";
import { InactivityChallenge } from "../components/InactivityChallenge";
import { OrcaAIProvider } from "../lib/orca-context";
import { OrcaAIPanel } from "../components/OrcaAI";
import { useOrcaAI } from "../lib/orca-context";
import { useSession } from "../lib/session";
import { SplashScreen } from "../components/SplashScreen";
import { OrcaLogo } from "../components/OrcaLogo";
import { PasskeyGate } from "../components/PasskeyGate";
import { ScreenControlWidget } from "../components/ScreenControlWidget";
import { useAppSettings } from "../lib/hooks";

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
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="sky">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
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
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  if (settings?.passkey_protection_enabled !== true) return <>{children}</>;
  return <PasskeyGate>{children}</PasskeyGate>;
}

function OrcaAIPanelMount() {
  const { open } = useOrcaAI();
  const { user } = useSession();

  useEffect(() => {
    if (!open || (user?.role !== "admin" && user?.role !== "semi_admin")) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open, user?.role]);

  if (!open || (user?.role !== "admin" && user?.role !== "semi_admin")) return null;
  return (
    <div className="fixed inset-0 z-[60] h-[100dvh] min-h-[100svh] w-screen max-w-none overflow-hidden bg-card shadow-[-4px_0_32px_rgba(0,0,0,0.12)] lg:inset-y-0 lg:left-auto lg:right-0 lg:h-[100dvh] lg:w-[360px] lg:max-w-[360px]">
      <OrcaAIPanel />
    </div>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [showEntrySplash, setShowEntrySplash] = useState(pathname === "/");
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
      {showEntrySplash && <SplashScreen onComplete={() => setShowEntrySplash(false)} />}
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
        <SessionProvider>
          <ThemeProvider>
            {pathname === "/share" ? (
              <>
                <Outlet />
                <Toaster position="top-right" />
              </>
            ) : (
              <OrcaAIProvider>
                <PasskeyProtectionGate>
                  <SecurityInit />
                  <SessionExpiredListener />
                  <DynamicImportRecovery />
                  <Outlet />
                  <ScreenControlWidget />
                  <InactivityChallenge />
                  <Toaster position="top-right" />
                  <OrcaAIPanelMount />
                </PasskeyProtectionGate>
              </OrcaAIProvider>
            )}
          </ThemeProvider>
        </SessionProvider>
      </PersistQueryClientProvider>
    </>
  );
}
