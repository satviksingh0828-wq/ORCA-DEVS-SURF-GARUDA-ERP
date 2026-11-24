import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("Accounts navigation starts with Final Accounts on desktop and mobile", () => {
  const source = readFileSync("src/components/accounts/AccountsSectionNav.tsx", "utf8");
  assert.match(source, /accountModules = \[\s*\{ id: "final", label: "Final Accounts"/);
  assert.match(source, /ACCOUNTS_SIDEBAR_GROUPS: LtmsSidebarGroup\[\] = \[\s*\{\s*section: "final"/);
});
test("Accounts root opens Final Accounts but Basic retains its permitted Finance default", () => {
  const source = readFileSync("src/routes/accounts.index.tsx", "utf8");
  assert.match(source, /role === "basic"[\s\S]*?<Navigate to="\/accounts\/finance" replace \/>/);
  assert.match(source, /<Navigate to="\/accounts\/final" replace \/>/);
});
test("Final Accounts defaults to Trial Balance but direct sidebar tab links take priority", () => {
  const source = readFileSync("src/components/accounts/FinalAccountsPage.tsx", "utf8");
  assert.match(source, /const pending = consumeAccountsTabNavigation\("final"\);/);
  assert.match(source, /: "trial-balance";/);
  assert.match(source, /pending === "balance-sheet"/);
});
