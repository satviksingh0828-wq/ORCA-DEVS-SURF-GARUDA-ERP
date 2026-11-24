export type TableViewColumnPolicy = readonly number[];

/** One-indexed column visibility for primary tables only. */
export function tableViewCss(scope: string, keep: TableViewColumnPolicy, max = 32) {
  const visible = new Set(keep);
  const root = '[data-table-view-id="' + scope + '"][data-view-mode="compact"]';
  const main = root + ' table:not(table table)';
  const hidden = Array.from({ length: max }, (_, i) => i + 1)
    .filter((index) => !visible.has(index));
  const selectors = hidden.flatMap((index) => [
    main + ' > thead > tr > th:nth-child(' + index + ')',
    main + ' > tbody > tr:not(:has(> td[colspan])) > td:nth-child(' + index + ')',
    main + ' > tfoot > tr:not(:has(> td[colspan])) > td:nth-child(' + index + ')',
  ]);
  return selectors.join(",\n") + " { display: none !important; }\n" +
    main + " { min-width: 100% !important; width: 100% !important; }\n" +
    main + " > :is(thead,tbody,tfoot) > tr > :is(th,td):not([colspan]) {" +
    "max-width: 320px; overflow-wrap: anywhere; }\n";
}
