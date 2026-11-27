import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(p,"utf8");
test("pending cash and bill rows are rendered in the ordinary list tables",()=>{
 const cash=read("src/components/accounts/AccountsFinancePage.tsx");
 const workmen=read("src/components/reports/WorkmenBilling.tsx");
 const transporter=read("src/components/reports/TransporterBilling.tsx");
 assert.match(cash,/<tbody>\s*<FinanceApprovalQueue[^\n]+inline /);
 assert.match(workmen,/<tbody>\s*<WorkmenApprovalQueue/);
 assert.match(transporter,/<tbody className="divide-y divide-border">\s*<TransporterApprovalQueue/);
});
test("debit and credit note submission is server-authorized and inline",()=>{
 const notes=read("src/components/reports/LtmsAccountingBilling.tsx");
 assert.match(notes,/serverSubmitNoteApproval\(\{data:/);
 assert.match(notes,/<tbody>\s*\{visiblePending.map/);
 assert.doesNotMatch(notes,/db.rpc\("create_ltms_accounting_note"/);
});
test("reject deletes only pending records and edits do not post",()=>{
 const sql=read("supabase/migrations/20261127115000_inline_finance_approval_actions.sql");
 assert.match(sql,/role='admin' AND is_active AND NOT is_paused/);
 for(const table of ["account_finance_requests","workmen_bill_approval_requests","transporter_bill_approval_requests","ltms_note_approval_requests"]) assert.ok(sql.includes("IF p_action='reject' THEN DELETE FROM public."+table+" WHERE id=p_id"));
 assert.match(sql,/REVOKE EXECUTE ON FUNCTION[\s\S]+FROM PUBLIC,anon,authenticated/);
 const actions=read("src/components/accounts/PendingApprovalActions.tsx");
 for(const action of ["approve","reject","edit"]) assert.ok(actions.includes('act("'+action+'"'));
 assert.match(actions,/Saving does not post accounts/);
});
