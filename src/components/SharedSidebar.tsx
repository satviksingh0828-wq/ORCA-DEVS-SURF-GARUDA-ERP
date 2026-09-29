import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SharedSidebar({
  children,
  open = true,
  width = "220px",
  label,
  className,
}: {
  children: ReactNode;
  open?: boolean;
  width?: string;
  label?: string;
  className?: string;
}) {
  if (!open) return null;
  return (
    <aside
      className={cn("hidden shrink-0 lg:block", className)}
      style={{ width }}
      aria-label={label}
    >
      <nav className="app-sidebar-scroll sticky top-0 h-[calc(100dvh-5rem)] max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain pr-1">
        {children}
      </nav>
    </aside>
  );
}
