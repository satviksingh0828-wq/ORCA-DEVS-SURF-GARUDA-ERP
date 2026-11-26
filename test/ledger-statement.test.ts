import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {buildLedgerStatement, ledgerBalanceLabel} from "../src/lib/ledger-statement.ts";
const entry=(id:string,date:string,voucher:string,debit:number,credit:number,line_no=1)=>({id,line_no,debit,credit,line_description:null,journal_entry:{id:voucher,entry_date:date,voucher_number:voucher,description:"Test",reference:null}});
test("running ledger balances follow chronological order and cross Dr/Cr",()=>{
 const r=buildLedgerStatement([entry("c","2026-11-05","JV-3",0,70),entry("a","2026-11-03","JV-1",50,0),entry("b","2026-11-04","JV-2",0,100)],100);
 assert.deepEqual(r.rows.map(x=>x.balance),[150,50,-20]);
 assert.equal(r.totalDebit,50);assert.equal(r.totalCredit,170);assert.equal(r.closing,-20);
 assert.equal(ledgerBalanceLabel(r.closing,String),"20 Cr");
 assert.equal(ledgerBalanceLabel(0,String),"0");
});
test("same-day order is deterministic and decimals are exact",()=>{
 const r=buildLedgerStatement([entry("b","2026-11-01","JV-2",0.2,0),entry("a","2026-11-01","JV-1",0.1,0)],0);
 assert.deepEqual(r.rows.map(x=>x.balance),[0.1,0.3]);
 assert.equal(r.closing,0.3);
 assert.equal(buildLedgerStatement([],-500).closing,-500);
});
test("app and portrait PDF share the running ledger model",()=>{
 const s=readFileSync("src/components/accounts/AccountsLedgerPage.tsx","utf8");
 assert.match(s,/buildLedgerStatement\(period, openingNet\)/);
 assert.match(s,/buildLedgerStatement\(rows, openingNet\)/);
 const pdf=s.slice(s.indexOf("async function exportViewPdf"),s.indexOf("  return (\n    <AppShell"));
 assert.match(pdf,/orientation: "portrait"/);
 assert.match(pdf,/columns: \["Date", "Voucher", "Particulars", "Debit \(Rs\.\)", "Credit \(Rs\.\)", "Balance \(Rs\.\)"\]/);
 assert.match(pdf,/balance\(row.balance\)/);
});
