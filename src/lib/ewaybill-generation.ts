export function isManualEwayBill(shipment: {
  generation_mode?: unknown;
  generation_mode_code?: unknown;
  [key: string]: unknown;
}): boolean {
  return [shipment.generation_mode, shipment.generation_mode_code].some((value) =>
    ["manual", "manually", "1"].includes(
      String(value ?? "")
        .trim()
        .toLowerCase(),
    ),
  );
}
