import assert from "node:assert/strict";
import test from "node:test";
import { buildTripQrManifest } from "../src/lib/trip-qr-manifest.ts";

const baseInput = {
  trip: {
    id: "trip-123",
    trip_code: "TR-0042",
    closed: false,
    mode: "ROAD",
    ownership: "own",
    start_date: "2026-10-01",
    start_time: "09:30",
    start_location_id: "loc-a",
    end_date: "2026-10-02",
    end_time: "16:00",
    end_location_id: "loc-b",
    odometer_start: "12000",
    odometer_end: "12500",
  },
  branchName: "Mumbai Branch",
  startLocationName: "Mumbai, MH",
  endLocationName: "Pune, MH",
  vehicleName: "MH01AB1234",
  driverName: "Driver One",
  manifests: [
    {
      manifest_number: "MAN-1",
      manifest_date: "2026-10-01",
      from_location_name: "Mumbai",
      from_pin_code: "400001",
      to_location_name: "Pune",
      to_pin_code: "411001",
      weight_kg: "250",
      quantity: "18",
    },
  ],
};

test("builds an ORCA Documents-compatible read-only Trip manifest", () => {
  const manifest = buildTripQrManifest(baseInput);

  assert.equal(manifest.schema, "orca.document.v1");
  assert.equal(manifest.recordId, "trip-123");
  assert.equal(manifest.title, "Trip · TR-0042");
  assert.deepEqual(manifest.uploads, []);
  assert.equal(manifest.metadata.mode, "update");
  assert.equal(manifest.readOnly, true);

  const fields = manifest.metadata.fields;
  assert.ok(fields.some((field) => field.id === "tripCode" && field.value === "TR-0042"));
  assert.ok(fields.some((field) => field.id === "startLocation" && field.value === "Mumbai, MH"));
  assert.ok(fields.some((field) => field.id === "manifest1Number" && field.value === "MAN-1"));
  assert.ok(fields.every((field) => field.editable === false));
});

test("shows Other Income and Expenditure amounts, editable only for an open Trip", () => {
  const manifest = buildTripQrManifest({
    ...baseInput,
    incomes: [
      { id: "income-1", income_name: "Loading recovery", amount: "250" },
      { id: "income-2", income_name: "Extra handling", amount: "" },
    ],
    expenses: [{ id: "expense-1", expense_name: "Fuel", amount: "1200.50" }],
    allowFinanceEdit: true,
    updateUrl: "https://erp.example/api/mobile/outward-pod?operation=trip-finance&tripId=trip-123",
  });

  assert.equal(manifest.readOnly, false);
  assert.equal(
    manifest.metadata.updateUrl,
    "https://erp.example/api/mobile/outward-pod?operation=trip-finance&tripId=trip-123",
  );
  const fields = manifest.metadata.fields;
  assert.ok(
    fields.some(
      (field) =>
        field.id === "incomeName_income-1" && field.value === "Loading recovery" && !field.editable,
    ),
  );
  assert.ok(
    fields.some(
      (field) => field.id === "incomeAmount_income-1" && field.value === "250" && field.editable,
    ),
  );
  assert.ok(
    fields.some(
      (field) =>
        field.id === "expenseAmount_expense-1" && field.value === "1200.50" && field.editable,
    ),
  );
  assert.ok(
    fields.some(
      (field) => field.id === "incomeAmount_income-2" && field.value === "" && field.editable,
    ),
  );
  assert.ok(
    fields.filter((field) => field.editable).every((field) => field.id.includes("Amount_")),
  );
});

test("keeps Trip amounts read-only when edit permission or update URL is missing", () => {
  const manifest = buildTripQrManifest({
    ...baseInput,
    incomes: [{ id: "income-1", income_name: "Loading recovery", amount: "250" }],
    expenses: [{ id: "expense-1", expense_name: "Fuel", amount: "1200.50" }],
    allowFinanceEdit: true,
  });

  assert.equal(manifest.readOnly, true);
  assert.equal(manifest.metadata.updateUrl, undefined);
  assert.ok(manifest.metadata.fields.every((field) => field.editable === false));
});

test("never exposes editable amounts for a closed Trip", () => {
  const manifest = buildTripQrManifest({
    ...baseInput,
    trip: { ...baseInput.trip, closed: true },
    incomes: [{ id: "income-1", income_name: "Loading recovery", amount: "250" }],
    allowFinanceEdit: true,
    updateUrl: "https://erp.example/api/mobile/outward-pod?operation=trip-finance&tripId=trip-123",
  });

  assert.equal(manifest.readOnly, true);
  assert.equal(manifest.metadata.updateUrl, undefined);
  assert.ok(manifest.metadata.fields.every((field) => field.editable === false));
});
