import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
test("ledger assignment opens a shared dialog from both list and view",()=>{
 const s=readFileSync("src/components/accounts/AccountsLedgerPage.tsx","utf8");
 assert.match(s,/onClick=\{\(\) => openAssignment\(ledger.id\)\}/);
 assert.match(s,/onClick=\{\(\) => openAssignment\(selectedLedger.id\)\}/);
 assert.match(s,/<Dialog open=\{isAdmin && assignmentLedgerId !== null\}/);
 assert.match(s,/type="checkbox"/);
 assert.match(s,/disabled=\{assignmentSaving \|\| assignmentLoading \|\| Boolean\(assignmentError\)\}/);
 assert.doesNotMatch(s,/Assign Basic users to a ledger/);
});
