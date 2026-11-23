import { printConsignorCopyPdf } from "@/lib/consignment-pdf";

type Row = Record<string, unknown>;
const text = (v: unknown) => String(v ?? "").trim();
const record = (v: unknown): Row =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};

function manifestVehicle(values: string[]) {
  const votes = new Map<string, { count: number; label: string }>();
  for (const value of values) {
    const number = value.trim().toUpperCase();
    if (!number) continue;
    const key = number.replace(/[\s-]/g, "");
    const count = votes.get(key);
    votes.set(key, { count: (count?.count ?? 0) + 1, label: count?.label ?? number });
  }
  return [...votes.values()].sort((a, b) => b.count - a.count)[0]?.label ?? "";
}

/**
 * LR and consignment intentionally share the same exact GR reference geometry.
 * Only the data adapter differs. Empty fields remain blank; no TBB/vehicle/
 * driver or tax identity is fabricated.
 */
export async function printLorryReceiptPdf(lr: Row) {
  const shipmentLinks = Array.isArray(lr.lorry_receipt_shipments)
    ? lr.lorry_receipt_shipments as Row[] : [];
  const shipments = shipmentLinks.map((link) => record(link.shipment))
    .filter((shipment) => Boolean(Object.keys(shipment).length));
  const first = shipments[0] || {};
  const packages = shipments.flatMap((shipment) =>
    (Array.isArray(shipment.shipment_items) ? shipment.shipment_items as Row[] : [])
      .map((item) => ({
        shipment_id: shipment.id,
        shipment: { eway_bill_number: shipment.eway_bill_number },
        package_type: item.package_type || item.unit || "",
        quantity: item.quantity,
        weight_kg: item.weight_kg,
        sku: item.hsn_code,
        item_name: item.product_name || item.description,
      })));
  const vehicles = shipments.map((shipment) =>
    text(shipment.part_b_vehicle_no || shipment.vehicle_number ||
      shipment.vehicle_no || shipment.transporter_vehicle_number));
  const metadata: Row = {
    ...lr,
    branch_id: lr.branch_id,
    branch: lr.branch,
    consignment_number: lr.lr_number,
    consignment_date: text(lr.lr_date || lr.created_at),
    // The LR's transport mode can be pickup/drop; do not translate that
    // into ROAD or another mode without a recorded shipment transport mode.
    transport_mode: first.transport_mode || first.transportation_mode || "",
    part_b_vehicle_no: manifestVehicle(vehicles),
    billing_status: lr.billing_status || "",
    from_pin_code: first.dispatch_from_pin_code,
    to_pin_code: first.ship_to_pin_code,
    source: lr.source,
    remarks: lr.remarks || lr.note || "",
    // Income is a calculated LR field, not an invoice freight charge.
    lr_calculated_income: lr.calculated_income,
    lr_mode: lr.mode,
    manifest_number: lr.manifest_number,
    trip_number: lr.trip_number,
  };
  return printConsignorCopyPdf({
    consignment: metadata,
    shipments,
    packages,
    filenamePrefix: "LR",
  });
}
