import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { tableViewCss, type TableViewColumnPolicy } from "@/lib/table-view-mode-style";

/**
 * Reusable Compact / Complete view. Only changes on-screen main-table columns;
 * expanded details, exports, queries and role permissions remain unchanged.
 */
export function TableViewMode({
  children,
  compactColumns,
  label = "Table",
  maxColumns = 32,
}: {
  children: ReactNode;
  compactColumns: TableViewColumnPolicy;
  label?: string;
  maxColumns?: number;
}) {
  const id = useId();
  const [mode, setMode] = useState<"compact" | "complete">("compact");
  if (!compactColumns.length) return <>{children}</>;
  return (
    <div data-table-view-id={id} data-view-mode={mode} className="min-w-0 space-y-3">
      <style>{tableViewCss(id, compactColumns, maxColumns)}</style>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-1 text-xs text-muted-foreground">Columns</span>
        <div role="group" aria-label={label + " column view"}
          className="flex items-center gap-1 rounded-lg border border-border bg-background p-1">
          <Button type="button" size="sm"
            variant={mode === "compact" ? "secondary" : "ghost"}
            aria-pressed={mode === "compact"} onClick={() => setMode("compact")}
            className="h-7 px-3">Compact</Button>
          <Button type="button" size="sm"
            variant={mode === "complete" ? "secondary" : "ghost"}
            aria-pressed={mode === "complete"} onClick={() => setMode("complete")}
            className="h-7 px-3">Complete</Button>
        </div>
      </div>
      {children}
    </div>
  );
}
