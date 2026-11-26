/** A single chronological statement for the app and PDF. All arithmetic is in paise. */
export type StatementLine = {
  id: string;
  line_no?: number | null;
  debit: number | string | null;
  credit: number | string | null;
  line_description: string | null;
  journal_entry?: { id: string; voucher_number: string; entry_date: string; description: string; reference: string | null } | null;
};
const paise = (n: unknown) => {
  const amount = Number(n ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
};
export function ledgerBalanceLabel(amount: number, format: (n: number) => string): string {
  return format(Math.abs(amount)) + (amount > 0 ? " Dr" : amount < 0 ? " Cr" : "");
}
export function buildLedgerStatement(lines: readonly StatementLine[], openingNet: number) {
  let running = paise(openingNet), debitTotal = 0, creditTotal = 0;
  const ordered = [...lines].sort((a, b) =>
    String(a.journal_entry?.entry_date ?? "").localeCompare(String(b.journal_entry?.entry_date ?? "")) ||
    String(a.journal_entry?.voucher_number ?? "").localeCompare(String(b.journal_entry?.voucher_number ?? ""), "en", {numeric:true}) ||
    String(a.journal_entry?.id ?? "").localeCompare(String(b.journal_entry?.id ?? "")) ||
    Number(a.line_no ?? 0) - Number(b.line_no ?? 0) ||
    a.id.localeCompare(b.id)
  );
  const rows = ordered.map(line => {
    const debit = paise(line.debit), credit = paise(line.credit);
    debitTotal += debit;
    creditTotal += credit;
    running += debit - credit;
    return {
      id: line.id, date: line.journal_entry?.entry_date ?? "",
      voucher: line.journal_entry?.voucher_number ?? "—",
      particulars: line.line_description || line.journal_entry?.description || "—",
      reference: line.journal_entry?.reference ?? null,
      debit: debit / 100, credit: credit / 100, balance: running / 100,
      balanceDr: Math.max(running, 0) / 100, balanceCr: Math.max(-running, 0) / 100,
    };
  });
  return {openingNet: paise(openingNet)/100, rows, totalDebit: debitTotal/100, totalCredit: creditTotal/100, closing: running/100};
}
