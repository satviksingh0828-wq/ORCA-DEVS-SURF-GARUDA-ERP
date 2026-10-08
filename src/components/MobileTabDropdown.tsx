import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type MobileTab = {
  id: string;
  label: string;
  desc: string;
  icon: LucideIcon;
};

/** Compact navigation for small screens; desktop sidebars remain unchanged. */
export function MobileTabDropdown<T extends MobileTab>({
  tabs,
  activeId,
  label,
  onChange,
  compact = false,
}: {
  tabs: readonly T[];
  activeId: T["id"];
  label: string;
  onChange: (id: T["id"]) => void;
  compact?: boolean;
}) {
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  if (!active) return null;

  const ActiveIcon = active.icon;

  return (
    <nav aria-label={`${label} sections`} className="lg:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3.5 text-left shadow-sm outline-none transition-all hover:border-primary/30 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring ${compact ? "min-h-11 py-2" : "min-h-14 py-2.5"}`}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ActiveIcon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              {!compact && (
                <span className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {label} section
                </span>
              )}
              <span className="block truncate text-sm font-semibold">{active.label}</span>
            </span>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <ChevronDown className="size-4" />
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="max-h-[min(70dvh,var(--radix-dropdown-menu-content-available-height))] w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto overscroll-contain rounded-2xl border-border p-1.5 shadow-xl"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const selected = tab.id === activeId;
            return (
              <DropdownMenuItem
                key={tab.id}
                onSelect={() => onChange(tab.id)}
                className={`min-h-12 flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2.5 ${selected ? "bg-primary/10" : ""}`}
              >
                <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{tab.label}</span>
                  {!compact && <span className="block text-xs leading-snug text-muted-foreground">{tab.desc}</span>}
                </span>
                {selected && <Check className="size-4 shrink-0 text-primary" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
