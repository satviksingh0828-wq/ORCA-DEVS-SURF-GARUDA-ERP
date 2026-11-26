import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {fixedLRChargeForConsignment,transporterExpenditureAmount} from "../src/lib/transporter-charges.ts";
test("fixed LR is included once, including missing route rates",()=>{
 assert.equal(transporterExpenditureAmount(100,20,fixedLRChargeForConsignment("third_party","T","15")),135);
 assert.equal(transporterExpenditureAmount(0,0,fixedLRChargeForConsignment("third_party","T",15)),15);
 assert.equal(fixedLRChargeForConsignment("own","T",15),0);
});
test("MCP reads saved fixed LR in both reports and keeps pending approvals separate",()=>{
 const s=readFileSync("src/lib/ltms-report-mcp-data.server.ts","utf8");
 const expenditure=s.slice(s.indexOf("async function transporterExpenditure("),s.indexOf("async function stockInwardUnloadingIncome("));
 const net=s.slice(s.indexOf("async function consignmentNet("),s.indexOf("async function ltmsFinanceEntries("));
 for(const report of [expenditure,net]){assert.match(report,/fixed_lr_charges/);assert.match(report,/transporterExpenditureAmount\(/);}
 assert.match(net,/Fixed LR Charges \(included in Transporter Expenditure\)/);
 assert.match(s,/name: "finance_approval_requests"/);
 assert.match(s,/name: "transporter_bills"/);
 assert.match(s,/readOnlyHint: true/);
 assert.match(s,/not ledger balances/);
});
