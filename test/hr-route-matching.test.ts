import assert from "node:assert/strict";
import test from "node:test";
import { isHrNavLinkActive } from "../src/lib/hr-route-matching.ts";

test("employee and department pages select their specific HR sidebar entries", () => {
  assert.equal(isHrNavLinkActive("/employees/departments", "/employees"), false);
  assert.equal(isHrNavLinkActive("/employees/departments", "/employees/departments"), true);
  assert.equal(isHrNavLinkActive("/employees/departments/123", "/employees"), false);
  assert.equal(isHrNavLinkActive("/employees/departments/123", "/employees/departments"), true);
});

test("employee and department creation pages do not select their parent list", () => {
  assert.equal(isHrNavLinkActive("/employees/new", "/employees"), false);
  assert.equal(isHrNavLinkActive("/employees/new", "/employees/new"), true);
  assert.equal(isHrNavLinkActive("/employees/departments/new", "/employees"), false);
  assert.equal(isHrNavLinkActive("/employees/departments/new", "/employees/departments"), false);
  assert.equal(isHrNavLinkActive("/employees/departments/new", "/employees/departments/new"), true);
});

test("nested HR attendance and payroll pages keep their parent sub-tab active", () => {
  assert.equal(isHrNavLinkActive("/attendance/history/123", "/attendance/history"), true);
  assert.equal(isHrNavLinkActive("/payroll/history/123", "/payroll/history"), true);
  assert.equal(isHrNavLinkActive("/payroll/history-old", "/payroll/history"), false);
});
