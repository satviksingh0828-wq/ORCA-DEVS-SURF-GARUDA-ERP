import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, Server, ShieldCheck, User } from "lucide-react";
import type { ReactNode } from "react";
import { useSession } from "@/lib/session";
import { useOrcaAI } from "@/lib/orca-context";
import { Button } from "@/components/ui/button";
import { OrcaAITrigger } from "@/components/OrcaAI";
import { NotificationBell } from "@/components/NotificationBell";
import { cn } from "@/lib/utils";
import { isAdminLike } from "@/lib/roles";

export function AppShell({
  children,
  breadcrumb,
  headerEnd,
}: {
  children: ReactNode;
  breadcrumb?: ReactNode;
  /** Extra content rendered between the breadcrumb and the user area (e.g. sidebar toggle) */
  headerEnd?: ReactNode;
}) {
  const { signOut, user } = useSession();
  const navigate = useNavigate();
  const { open } = useOrcaAI();
  const isAdmin = isAdminLike(user?.role);
  const isViewer = user?.role === "viewer";

  return (
    <div className={cn("min-h-screen bg-background transition-all duration-300", isAdmin && open ? "lg:mr-[360px]" : "")}>
      <header className="sticky top-0 z-30 border-b border-border bg-card/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-screen-xl items-center gap-1.5 px-3 sm:gap-3 sm:px-6">
          <Link to="/home" className="shrink-0">
            <img src="/garuda-logo.png" alt="Garuda Logistics Solution" className="h-8 w-auto sm:h-10" />
          </Link>
          {breadcrumb && <div className="ml-2 hidden md:block shrink-0">{breadcrumb}</div>}
          {headerEnd && <div className="ml-2 hidden lg:block">{headerEnd}</div>}
          <div data-app-shell-header-actions className="contents" />
          <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-3">
            {isAdmin && (
              <Link
                to="/system"
                title="System"
                className="relative flex size-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Server className="size-4" />
              </Link>
            )}
            {(isAdmin || user?.role === "viewer") && <NotificationBell />}
            {isAdmin && <OrcaAITrigger />}
            <span className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex min-w-0">
              {isAdmin ? (
                <ShieldCheck className="size-3.5 text-primary shrink-0" />
              ) : (
                <User className="size-3.5 shrink-0" />
              )}
              <span className="font-medium text-foreground truncate max-w-[120px]">
                {user?.fullName ?? user?.username}
              </span>
              <span className="hidden md:inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide shrink-0">
                {isAdmin ? (user?.role === "semi_admin" ? "Semi-Admin" : "Admin") : isViewer ? "Viewer" : "User"}
              </span>
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                signOut();
                navigate({ to: "/", replace: true });
              }}
              className="shrink-0"
            >
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto min-w-0 max-w-screen-xl overflow-x-hidden [overflow-anchor:none] px-3 py-5 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
