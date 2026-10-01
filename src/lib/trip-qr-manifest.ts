type Row = Record<string, unknown>;

type TripQrManifestInput = {
  trip: Row;
  branchName?: string | null;
  startLocationName?: string | null;
  endLocationName?: string | null;
  vehicleName?: string | null;
  driverName?: string | null;
  transporterName?: string | null;
  rentalName?: string | null;
  contractName?: string | null;
  manifests: Row[];
};

function displayValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return "";
}

export function buildTripQrManifest(input: TripQrManifestInput) {
  const { trip } = input;
  const fields: Array<{
    id: string;
    label: string;
    type: "text" | "date" | "number";
    value: string;
    required: false;
    editable: false;
  }> = [];
  const addField = (
    id: string,
    label: string,
    value: unknown,
    type: "text" | "date" | "number" = "text",
  ) => {
    const text = displayValue(value);
    if (!text) return;
    fields.push({ id, label, type, value: text, required: false, editable: false });
  };

  const tripCode = displayValue(trip.trip_code) || displayValue(trip.id) || "Trip";
  addField("tripStatus", "Trip status", trip.closed === true ? "Closed" : "Open");
  addField("tripCode", "Trip code", trip.trip_code);
  addField("mode", "Mode", trip.mode);
  addField("ownership", "Ownership", trip.ownership);
  addField("branch", "Branch", input.branchName ?? trip.branch_id);
  addField("startDate", "Start date", trip.start_date, "date");
  addField("startTime", "Start time", trip.start_time);
  addField("startLocation", "Start location", input.startLocationName ?? trip.start_location_id);
  addField("endDate", "End date", trip.end_date, "date");
  addField("endTime", "End time", trip.end_time);
  addField("endLocation", "End location", input.endLocationName ?? trip.end_location_id);
  addField("vehicle", "Vehicle", input.vehicleName || trip.third_party_vehicle_number);
  addField("driver", "Driver", input.driverName);
  addField("transporter", "Transporter", input.transporterName);
  addField("rental", "Rental", input.rentalName);
  addField("contract", "Contract", input.contractName);
  addField("odometerStart", "Odometer start", trip.odometer_start, "number");
  addField("odometerEnd", "Odometer end", trip.odometer_end, "number");
  addField("manifestCount", "Manifest count", input.manifests.length, "number");

  input.manifests.forEach((manifest, index) => {
    const prefix = `manifest${index + 1}`;
    const title = `Manifest ${index + 1}`;
    addField(`${prefix}Number`, `${title} number`, manifest.manifest_number);
    addField(`${prefix}Date`, `${title} date`, manifest.manifest_date, "date");
    addField(
      `${prefix}From`,
      `${title} from`,
      manifest.from_location_name ?? manifest.from_pin_code,
    );
    addField(`${prefix}To`, `${title} to`, manifest.to_location_name ?? manifest.to_pin_code);
    addField(`${prefix}WeightKg`, `${title} weight (kg)`, manifest.weight_kg, "number");
    addField(`${prefix}Quantity`, `${title} quantity`, manifest.quantity, "number");
  });

  return {
    schema: "orca.document.v1",
    recordId: displayValue(trip.id) || tripCode,
    title: `Trip · ${tripCode}`,
    readOnly: true,
    uploads: [],
    metadata: { mode: "update" as const, fields },
  };
}
