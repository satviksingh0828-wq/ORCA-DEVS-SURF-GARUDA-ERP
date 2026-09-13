import { useEffect } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useSession } from "@/lib/session";
import { PoweredBy } from "@/components/PoweredBy";

type WorkspaceTile = {
  key: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  to: string;
  roles?: readonly ("admin" | "semi_admin" | "basic" | "viewer")[];
};

export function WorkspaceModulePage({
  title,
  description,
  tiles,
  eyebrow,
  allowedRoles = ["admin", "semi_admin", "viewer"],
}: {
  title: string;
  description: string;
  tiles: WorkspaceTile[];
  eyebrow: string;
  allowedRoles?: readonly ("admin" | "semi_admin" | "basic" | "viewer")[];
}) {
  const navigate = useNavigate();
  const { user } = useSession();

  useEffect(() => {
    if (user && !allowedRoles.includes(user.role)) {
      navigate({ to: "/home", replace: true });
    }
  }, [allowedRoles, navigate, user]);

  if (!user || !allowedRoles.includes(user.role)) return null;

  const visibleTiles = tiles.filter((tile) => !tile.roles || tile.roles.includes(user.role));

  return (
    <AppShell
      breadcrumb={
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/home" className="hover:text-foreground">
            Workspace
          </Link>
          <span aria-hidden="true">/</span>
          <span>{title}</span>
          <span aria-hidden="true">/</span>
          <span className="text-foreground">Modules</span>
        </span>
      }
    >
      <div className="animate-fade-up">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-primary">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">{description}</p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {visibleTiles.map((tile, index) => {
          const Icon = tile.icon;
          return (
            <a
              key={tile.key}
              href={tile.to}
              style={{ animationDelay: `${index * 55}ms` }}
              className="group surface-card animate-fade-up relative flex h-40 flex-col items-start p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-lift)]"
            >
              <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors">
                <Icon className="size-5" />
              </span>
              <span className="mt-4 block text-base font-semibold tracking-tight">
                {tile.label}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{tile.desc}</span>
              <ArrowRight className="absolute bottom-6 right-6 size-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-1 group-hover:text-foreground" />
            </a>
          );
        })}
      </div>

      <PoweredBy className="mt-12 text-[10px] uppercase tracking-[0.22em] text-muted-foreground/50" />
    </AppShell>
  );
}
