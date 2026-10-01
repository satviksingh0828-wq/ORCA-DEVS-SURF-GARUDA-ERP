import assert from "node:assert/strict";
import test from "node:test";
import { buildTripQrManifest } from "../src/lib/trip-qr-manifest.ts";

test("builds an ORCA Documents-compatible JSON manifest for a Trip and its manifests", () => {
  const manifest = buildTripQrManifest({
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
  });

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
