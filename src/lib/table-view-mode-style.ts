export type TableViewColumnPolicy = readonly number[];
export type CompactCellLayout = {
  start: number;
  span: number;
  visibleSpan: number;
  hidden: boolean;
};

/** Match a cell's LOGICAL table column, even when preceding cells have colspan. */
export function compactCellLayout(
  spans: readonly number[],
  keep: TableViewColumnPolicy,
): CompactCellLayout[] {
  const included = new Set(keep);
  let cursor = 1;
  return spans.map((raw) => {
    const span = Math.max(1, Math.floor(raw || 1));
    const start = cursor;
    const end = start + span;
    let visibleSpan = 0;
    for (let col = start; col < end; col += 1)
      if (included.has(col)) visibleSpan += 1;
    cursor = end;
    return { start, span, visibleSpan, hidden: visibleSpan === 0 };
  });
}

/**
 * The Compact mode uses real table columns rather than a transformed horizontal
 * strip. Fixed layout and wrapping let reports use their full available width.
 * Hidden/merged-cell alignment is computed by TableViewMode at render time.
 */
export function tableViewCss(scope: string, _keep: TableViewColumnPolicy, _max = 32) {
  const root = '[data-table-view-id="' + scope + '"][data-view-mode="compact"]';
  const main = root + ' table:not(table table)';
  return root + ' { width: 100%; max-width: 100%; min-width: 0; }\n' +
    main + ' { table-layout: fixed !important; width: 100% !important; ' +
    'min-width: 100% !important; max-width: 100% !important; }\n' +
    main + ' > :is(thead,tbody,tfoot) > tr > :is(th,td) { ' +
    'min-width: 0 !important; max-width: none !important; ' +
    'white-space: normal !important; overflow-wrap: anywhere !important; ' +
    'word-break: normal !important; vertical-align: middle; }\n' +
    main + ' > :is(thead,tbody,tfoot) > tr > [data-table-view-hidden="true"] ' +
    '{ display: none !important; }\n' +
    // Keep all footer cells native table cells. Totals use individual blank
    // placeholders (not a multi-column label), so numeric totals stay aligned.
    main + ' > tfoot > tr > td:first-child {' +
    'text-align: left !important; white-space: nowrap !important; }\n' +
    main + ' > tfoot > tr > td:not([data-table-view-hidden="true"]) {' +
    'vertical-align: middle !important; }\n' +
    root + ' [data-table-view-complete-only="true"] { display: none !important; }\n' +
    root + ' [data-table-view-compact-only="true"] { display: inline-block !important; ' +
    'max-width: 100% !important; white-space: nowrap !important; ' +
    'overflow: hidden !important; text-overflow: ellipsis !important; }\n' +
    '[data-table-view-id="' + scope + '"][data-view-mode="complete"] ' +
    '[data-table-view-compact-only="true"] { display: none !important; }\n';
}
