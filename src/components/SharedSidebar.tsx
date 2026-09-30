import type { ReactNode, RefObject } from "react";
import { cn } from "@/lib/utils";

export function SharedSidebar({
  children,
  open = true,
  width = "220px",
  label,
  className,
  breakpoint = "lg",
  containerRef,
}: {
  children: ReactNode;
  open?: boolean;
  width?: string;
  label?: string;
  className?: string;
  breakpoint?: "lg" | "xl";
  containerRef?: RefObject<HTMLElement | null>;
}) {
  if (!open) return null;
  return (
    <aside
      ref={containerRef}
      data-app-sidebar-container="true"
      className={cn("app-sidebar-container hidden shrink-0", breakpoint === "xl" ? "xl:block" : "lg:block", className)}
      style={{ width }}
      aria-label={label}
    >
      <nav className="app-sidebar-scroll sticky top-0 h-[calc(100dvh-5rem)] max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain pr-1">
        {children}
      </nav>
    </aside>
  );
}
