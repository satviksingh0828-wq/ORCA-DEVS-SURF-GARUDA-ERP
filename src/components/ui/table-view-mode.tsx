import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  compactCellLayout, tableViewCss, type TableViewColumnPolicy,
} from "@/lib/table-view-mode-style";

/**
 * Compact / Complete for existing reports and account lists.
 * Main-table spans are adjusted to the visible logical columns, so Total
 * rows remain underneath their matching figures instead of shifting right.
 * This does not mutate any stored report data or export data.
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
  const rootRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"compact" | "complete">("compact");
  const keepSignature = compactColumns.join(",");
  const keptColumns = useMemo(() =>
    keepSignature.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0),
  [keepSignature]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !keptColumns.length) return;

    const updateVisibleColumns = () => {
      // Skip nested detail tables. Their own multi-column data remains intact.
      const tables = Array.from(root.querySelectorAll<HTMLTableElement>("table"))
        .filter((table) => !table.parentElement?.closest("table"));
      for (const table of tables) {
        const sections = [
          ...(table.tHead ? [table.tHead] : []),
          ...Array.from(table.tBodies),
          ...(table.tFoot ? [table.tFoot] : []),
        ];
        for (const section of sections) {
          for (const row of Array.from(section.rows)) {
            const cells = Array.from(row.cells);
            const originalSpans = cells.map((cell) => {
              const remembered = Number(cell.dataset.tableViewOriginalSpan);
              if (remembered > 0) return remembered;
              const initial = cell.colSpan || 1;
              cell.dataset.tableViewOriginalSpan = String(initial);
              return initial;
            });
            const layout = compactCellLayout(originalSpans, keptColumns);
            cells.forEach((cell, index) => {
              const span = mode === "compact"
                ? Math.max(1, layout[index].visibleSpan)
                : originalSpans[index];
              if (cell.colSpan !== span) cell.colSpan = span;
              if (mode === "compact" && layout[index].hidden)
                cell.dataset.tableViewHidden = "true";
              else delete cell.dataset.tableViewHidden;
            });
          }
        }
      }
    };

    updateVisibleColumns();
    // Live report filtering/pagination may replace rows after the mode changes.
    // Observe row insertion/removal (not attributes we update ourselves).
    const observer = new MutationObserver(updateVisibleColumns);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [mode, keptColumns]);

  if (!compactColumns.length) return <>{children}</>;
  return (
    <div ref={rootRef} data-table-view-id={id} data-view-mode={mode}
      className="min-w-0 w-full max-w-full space-y-3">
      <style>{tableViewCss(id, compactColumns, maxColumns)}</style>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-1 text-xs text-muted-foreground">Columns</span>
        <div role="group" aria-label={label + " column view"}
          className="flex items-center gap-1 rounded-lg border border-border bg-background p-1">
          <Button type="button" size="sm"
            variant={mode === "compact" ? "secondary" : "ghost"}
            aria-pressed={mode === "compact"}
            onClick={() => setMode("compact")}
            className="h-7 px-3">Compact</Button>
          <Button type="button" size="sm"
            variant={mode === "complete" ? "secondary" : "ghost"}
            aria-pressed={mode === "complete"}
            onClick={() => setMode("complete")}
            className="h-7 px-3">Complete</Button>
        </div>
      </div>
      {children}
    </div>
  );
}
