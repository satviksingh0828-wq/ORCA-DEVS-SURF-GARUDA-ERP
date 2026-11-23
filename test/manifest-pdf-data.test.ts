import assert from "node:assert/strict";
import test from "node:test";
import { manifestPackageTotals, mostCommonManifestVehicle } from "../src/lib/manifest-pdf-data.ts";

test("manifest vehicle is the most common distinct consignment vehicle", () => {
  assert.equal(mostCommonManifestVehicle([
    { consignmentId: "a", vehicleNumber: "PB10 CW 6292" },
    { consignmentId: "a", vehicleNumber: "PB10 CW 6292" },
    { consignmentId: "b", vehicleNumber: "HR12AB1234" },
    { consignmentId: "c", vehicleNumber: "PB10CW6292" },
  ]), "PB10 CW 6292");
});
test("vehicle tie uses first recorded and absent values are not invented", () => {
  assert.equal(mostCommonManifestVehicle([
    { consignmentId: "a", vehicleNumber: "ABC1" },
    { consignmentId: "b", vehicleNumber: "XYZ2" },
  ]), "ABC1");
  assert.equal(mostCommonManifestVehicle([{ consignmentId: "a", vehicleNumber: null }]), "");
});
test("package totals remain linked to their own shipment", () => {
  const totals = manifestPackageTotals([
    { consignment_id: "cn", shipment_id: "s1", quantity: 5, weight_kg: 42.5 },
    { consignment_id: "cn", shipment_id: "s1", quantity: 3, weight_kg: 12.5 },
    { consignment_id: "cn", shipment_id: "s2", quantity: 2, weight_kg: 10 },
  ]);
  assert.deepEqual(totals.get("cn:s1"), { quantity: 8, weightKg: 55 });
  assert.deepEqual(totals.get("cn:s2"), { quantity: 2, weightKg: 10 });
  assert.equal(totals.get("cn:s3"), undefined);
});
