import { createPortal } from "react-dom";
import { useEffect, useState, type ReactNode, type RefObject } from "react";
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
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (open) setSlot(document.querySelector<HTMLElement>("[data-module-sidebar-slot]"));
  }, [open]);

  if (!open) return null;
  if (slot) {
    return (
      <>
        {createPortal(
          <nav className={cn("erp-sidebar-subnav", className)} aria-label={label}>
            {children}
          </nav>,
          slot,
        )}
        <div className="app-sidebar-portal-placeholder" aria-hidden="true" />
      </>
    );
  }

  return (
    <aside
      ref={containerRef}
      data-app-sidebar-container="true"
      className={cn(
        "app-sidebar-container hidden shrink-0",
        breakpoint === "xl" ? "xl:block" : "lg:block",
        className,
      )}
      style={{ width }}
      aria-label={label}
    >
      <nav className="app-sidebar-scroll sticky top-0 h-[calc(100dvh-5rem)] max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain pr-1">
        {children}
      </nav>
    </aside>
  );
}
