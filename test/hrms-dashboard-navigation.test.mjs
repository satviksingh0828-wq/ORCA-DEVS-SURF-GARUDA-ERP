import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("HRMS Dashboard is the first sidebar group and Attendance Dashboard its first item", () => {
  const s = readFileSync("src/components/hr/HrShell.tsx", "utf8");
  assert.match(s, /HR_SIDEBAR_GROUPS: LtmsSidebarGroup\[\] = \[\s*\{\s*section: "hr-dashboard",\s*label: "HRMS Dashboard"/);
  const dashboardGroup = s.slice(s.indexOf('section: "hr-dashboard"'), s.indexOf('section: "hr-master"'));
  assert.ok(dashboardGroup.indexOf('id: "attendance-dashboard"') < dashboardGroup.indexOf('id: "employee-dashboard"'));
});

test("HRMS root goes to attendance but preserves Basic user access", () => {
  const s = readFileSync("src/routes/hrms.tsx", "utf8");
  assert.match(s, /user\?\.role === "basic" \? "\/employees" : "\/dashboard\/attendance"/);
});

test("HRMS dashboard defaults to Attendance while direct links still select their own tabs", () => {
  const s = readFileSync("src/routes/dashboard.index.tsx", "utf8");
  assert.match(s, /scope === "hr" \? "attendance" : "pnl"/);
  assert.match(s, /const requestedTab = initialTab \?\? fallbackTab/);
  const page = readFileSync("src/components/hr/HrDashboardPage.tsx", "utf8");
  assert.match(page, /initialTab=\{tab\}/);
});
