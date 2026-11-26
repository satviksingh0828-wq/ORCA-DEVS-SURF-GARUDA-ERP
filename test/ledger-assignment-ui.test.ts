import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
test("ledger assignment uses native top-layer dialog and independent table action",()=>{
 const s=readFileSync("src/components/accounts/AccountsLedgerPage.tsx","utf8");
 assert.match(s,/event\.stopPropagation\(\); openAssignment\(ledger\.id\)/);
 assert.match(s,/onClick=\{\(\) => openAssignment\(selectedLedger.id\)\}/);
 assert.match(s,/onClick=\{\(\) => openAssignment\(assignmentTarget\)\}/);
 assert.match(s,/<dialog ref=\{assignmentDialog\}/);
 assert.match(s,/element\.showModal\(\)/);
 assert.match(s,/type="checkbox"/);
 assert.match(s,/disabled=\{assignmentSaving \|\| assignmentLoading \|\| Boolean\(assignmentError\)\}/);
 assert.doesNotMatch(s,/Assign Basic users to a ledger/);
});
