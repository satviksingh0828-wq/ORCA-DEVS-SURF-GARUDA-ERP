import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(path, "utf8");

test("Consignment renders one list title with the accurate E-Way Bill explanation", () => {
  const route = source("src/routes/operations.tsx");
  const list = source("src/components/operations/ConsignmentList.tsx");
  assert.match(route, /One Consignment contains one or more matching E-Way Bills and view-only Shipments/);
  assert.doesNotMatch(route, /Create shipments from E-Way Bills/);
  assert.doesNotMatch(list, /<h2[^>]*>Consignment<\/h2>/);
  assert.match(list, /Create Consignment/);
  assert.match(route, /!fullBleed && !fullBleedConsignment/);
});

test("Operations keep page titles only once and retain functional creation actions", () => {
  for (const [file, duplicateTitle, requiredAction] of [
    ["ShipmentList.tsx", "Shipments", "Create Shipment"],
    ["LorryReceiptList.tsx", "Lorry Receipts (LR)", "Create LR"],
    ["ManifestList.tsx", "Manifest", "Create Manifest"],
    ["StockInward.tsx", "Stock Inward", "Create Stock Inward"],
    ["StockOutward.tsx", "Stock Outward", "Create Stock Outward"],
    ["OutwardPOD.tsx", "Outward POD List", "Create POD"],
  ]) {
    const content = source(`src/components/operations/${file}`);
    // Specific Create/Edit/Details headings are separate screens and remain intact.
    assert.ok(!content.includes(`>${duplicateTitle}</h2>`), `duplicate list header: ${file}`);
    assert.ok(content.includes(requiredAction), `missing action: ${file}`);
  }
});

test("Masters use their route title when embedded, without removing forms", () => {
  const route = source("src/routes/masters.tsx");
  const master = source("src/components/masters/MasterList.tsx");
  const party = source("src/components/masters/PartyMaster.tsx");
  const contracts = source("src/components/masters/Contracts.tsx");
  assert.match(route, /<MasterList embedded/);
  assert.match(route, /<Contracts embedded/);
  assert.match(route, /<PartyMaster embedded partyType="consignor"/);
  assert.match(route, /<PartyMaster embedded partyType="consignee"/);
  for (const content of [master, party, contracts]) {
    assert.match(content, /!embedded &&/);
  }
  assert.match(route, /Freight sources, rate slabs and route-wise entries/);
});

test("Report tables retain result counts without repeating the full page title", () => {
  for (const name of [
    "ConsignmentIncomeReport.tsx",
    "ConsignmentNetReport.tsx",
    "TripExpenditureReport.tsx",
    "TransporterExpenditureReport.tsx",
  ]) {
    const content = source(`src/components/reports/${name}`);
    assert.match(content, /Results \(\{filtered\.length\}\)/);
  }
});

test("Embedded WMS Settings omits only its redundant heading", () => {
  const settings = source("src/components/WmsSystemSettings.tsx");
  const css = source("src/wms/App.scoped.css");
  assert.match(settings, /data-hide-generic-heading=\{activeTabId === "settings"/);
  assert.match(css, /\.wms-settings-embedded\[data-hide-generic-heading="true"\] \.page-header/);
  assert.match(css, /Embedded only: standalone/);
});
