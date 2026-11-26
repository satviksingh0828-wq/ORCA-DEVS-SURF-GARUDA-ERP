/* Document layouts based on the supplied Manifest Auto GR-style receipt. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import jsPDF from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { manifestPackageTotals, mostCommonManifestVehicle, type ManifestPackageLine } from "@/lib/manifest-pdf-data";

type Row = Record<string, any>;
type StockKind = "inward" | "outward";
const X = 29;
const W = 532;
const H = 841;
const ink = [28, 28, 28] as const;
const text = (value: unknown) => String(value ?? "").trim();
const num = (value: unknown) => Number(value ?? 0) || 0;
const record = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const money = (value: unknown) => num(value).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const date = (value: unknown) => {
  const source = text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(source);
  return match ? match[3] + "/" + match[2] + "/" + match[1] : source;
};
const join = (...values: unknown[]) => values.map(text).filter(Boolean).join(", ");
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

async function loadHeader(branchId: string, fallbackBranch: Row) {
  const [company, branch, logo] = await Promise.all([
    supabase.from("company").select("company_name").limit(1).maybeSingle(),
    branchId
      ? supabase.from("branches")
          .select("branch_name,address_line1,address_line2,area_locality,city,state,pin_code,gstin,pan,mobile_number")
          .eq("id", branchId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    fetch("/garuda-logo.png").then(async (res) => {
      if (!res.ok) return null;
      const image = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(image);
      });
    }).catch(() => null),
  ]);
  return {
    name: text(company.data?.company_name) || "GARUDA LOGISTICS SOLUTION PRIVATE LIMITED",
    branch: { ...fallbackBranch, ...record(branch.data) },
    logo,
  };
}

function rect(doc: jsPDF, x: number, y: number, w: number, h: number, fill = false) {
  doc.setLineWidth(0.65);
  doc.setDrawColor(...ink);
  if (fill) {
    doc.setFillColor(207, 207, 207);
    doc.rect(x, y, w, h, "FD");
  } else {
    doc.rect(x, y, w, h);
  }
}

function fit(doc: jsPDF, content: string, x: number, y: number, maxW: number, size = 7, bold = false) {
  doc.setFont("helvetica", bold ? "bold" : "normal");
  let current = size;
  doc.setFontSize(current);
  while (current > 5 && doc.getTextWidth(content) > maxW) {
    current -= 0.2;
    doc.setFontSize(current);
  }
  let displayed = content;
  if (doc.getTextWidth(displayed) > maxW) {
    while (displayed.length > 1 && doc.getTextWidth(displayed + "...") > maxW)
      displayed = displayed.slice(0, -1);
    displayed += "...";
  }
  doc.text(displayed, x, y);
}

function stripes(doc: jsPDF, value: string, x: number, y: number, width: number) {
  // Decoratively resembles the supplied document header. The printed number
  // below is the authoritative identifier, not a scannable barcode.
  const str = value || "ORCA";
  let position = x;
  let index = 0;
  doc.setFillColor(...ink);
  while (position < x + width - 2) {
    const key = str.charCodeAt(index % str.length);
    const bar = 0.6 + (key % 4) * 0.5;
    const gap = 0.65 + (index % 3) * 0.35;
    doc.rect(position, y, Math.min(bar, x + width - position), 33, "F");
    position += bar + gap;
    index += 1;
  }
}

function heading(doc: jsPDF, title: string, number: string, header: Awaited<ReturnType<typeof loadHeader>>) {
  const branch = header.branch;
  rect(doc, X, 32, W, 22, true);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(title, X + W / 2, 47, { align: "center" });
  rect(doc, X, 54, W, 98);
  doc.line(X + 87, 54, X + 87, 152);
  doc.line(X + 344, 54, X + 344, 152);
  if (header.logo) {
    try { doc.addImage(header.logo, "PNG", X + 4, 75, 79, 56); }
    catch { fit(doc, "GARUDA", X + 8, 101, 72, 12, true); }
  } else fit(doc, "GARUDA", X + 8, 101, 72, 12, true);
  fit(doc, header.name, X + 93, 68, 250, 11.5, true);
  const address = join(branch.address_line1, branch.address_line2, branch.area_locality);
  const address2 = join(branch.city, branch.state, branch.pin_code);
  fit(doc, address, X + 93, 84, 248, 7.2);
  fit(doc, address2, X + 93, 96, 248, 7.2);
  fit(doc, "Branch: " + text(branch.branch_name), X + 93, 109, 248, 7.2);
  fit(doc, "Phone: " + text(branch.mobile_number), X + 93, 120, 248, 7.1);
  fit(doc, "GSTIN: " + text(branch.gstin), X + 93, 132, 248, 7.1);
  stripes(doc, number, X + 353, 63, 170);
  doc.line(X + 344, 117, X + W, 117);
  doc.line(X + 437, 117, X + 437, 152);
  rect(doc, X + 344, 117, 188, 16, true);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("Document No.", X + 349, 128);
  doc.text("Date & Time", X + 442, 128);
  fit(doc, number, X + 349, 145, 88, 8, true);
}

function infoRow(
  doc: jsPDF, y: number, cols: string[], values: string[],
  widths: number[], labelHeight = 16, valueHeight = 23,
) {
  let x = X;
  for (let i = 0; i < cols.length; i += 1) {
    rect(doc, x, y, widths[i], labelHeight, true);
    fit(doc, cols[i], x + 3, y + 10.5, widths[i] - 6, 6.6, true);
    rect(doc, x, y + labelHeight, widths[i], valueHeight);
    fit(doc, values[i] || "", x + 3, y + labelHeight + Math.min(13, valueHeight - 5),
      widths[i] - 6, 7.3);
    x += widths[i];
  }
  return y + labelHeight + valueHeight;
}

function table(
  doc: jsPDF, title: string, number: string,
  headers: string[], widths: number[], rows: string[][], yStart: number,
) {
  let y = yStart;
  let pageNo = 1;
  const next = () => {
    doc.addPage();
    pageNo += 1;
    y = 42;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    fit(doc, title + " CONTINUED - " + number, X + 3, 29, W - 6, 10, true);
    doc.line(X, 34, X + W, 34);
  };
  const header = () => {
    const rowHeight = 26;
    let px = X;
    headers.forEach((head, i) => {
      rect(doc, px, y, widths[i], rowHeight, true);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.8);
      const chunks = doc.splitTextToSize(head, widths[i] - 5) as string[];
      doc.text(chunks.slice(0, 2), px + 2.5, y + 10);
      px += widths[i];
    });
    y += rowHeight;
  };
  header();
  rows.forEach((row) => {
    const chunks = row.map((entry, i) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      return doc.splitTextToSize(entry || " ", widths[i] - 6) as string[];
    });
    const lines = Math.max(...chunks.map((part) => part.length), 1);
    let consumed = 0;
    while (consumed < lines) {
      const capacity = Math.floor((H - 92 - y - 8) / 8.2);
      if (capacity < 1) {
        next();
        header();
        continue;
      }
      const take = Math.min(capacity, lines - consumed);
      const height = Math.max(24, take * 8.2 + 9);
      let px = X;
      chunks.forEach((part, index) => {
        rect(doc, px, y, widths[index], height);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.text(part.slice(consumed, consumed + take), px + 3, y + 11);
        px += widths[index];
      });
      y += height;
      consumed += take;
    }
  });
  return { y, pageNo, next };
}

function totals(doc: jsPDF, label: string, y: number, cols: Array<[string, string]>) {
  if (y + 92 > H - 42) {
    doc.addPage();
    y = 45;
  }
  rect(doc, X, y, W, 23);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  fit(doc, label, X + 5, y + 15, 170, 7.5, true);
  let px = X + 175;
  cols.forEach(([name, value]) => {
    fit(doc, name + ": " + value, px, y + 15, Math.min(130, X + W - px - 5), 7.3, true);
    px += 115;
  });
  y += 23;
  rect(doc, X, y, W, 36);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Remarks :", X + 6, y + 12);
  y += 36;
  doc.setFontSize(7.8);
  doc.text("Loaded / Prepared By :", X + 6, y + 16);
  doc.text("Driver's Sign / Received By :", X + W - 6, y + 16, { align: "right" });
  return y + 36;
}

function finish(doc: jsPDF, companyName: string) {
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    fit(doc, "For " + companyName, X + W - 255, H - 48, 250, 8, true);
    doc.setFontSize(6.5);
    doc.text(String(page) + " / " + String(pages), X + W, H - 12, { align: "right" });
  }
}


async function loadPackageTotals(consignmentIds: string[]) {
  const ids = [...new Set(consignmentIds.filter(Boolean))];
  const rows: ManifestPackageLine[] = [];
  const db = supabase as any;
  for (let index = 0; index < ids.length; index += 80) {
    const { data, error } = await db
      .from("consignment_package_information")
      .select("consignment_id,shipment_id,quantity,weight_kg")
      .in("consignment_id", ids.slice(index, index + 80));
    if (error) throw new Error("Could not load consignment package weights: " + error.message);
    rows.push(...((data ?? []) as ManifestPackageLine[]));
  }
  return manifestPackageTotals(rows);
}

function linkedConsignmentVehicle(consignment: Row) {
  return text(consignment.part_b_vehicle_no) ||
    text(record(consignment.vehicle).registration_number);
}

export async function printLtmsManifestPdf(manifest: Row) {
  const number = text(manifest.manifest_number);
  const data = await loadHeader(text(manifest.branch_id), record(manifest.branch));
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  doc.setTextColor(...ink);
  heading(doc, "MANIFEST DETAILS", number, data);
  const items = Array.isArray(manifest.items) ? manifest.items as Row[] : [];
  const getConsignment = (item: Row) => record(item.consignment);
  const first = items[0] || {};
  const firstConsignment = getConsignment(first);
  const chosenVehicle = mostCommonManifestVehicle(items.map((item) => {
    const cn = getConsignment(item);
    return {
      consignmentId: text(item.consignment_id || cn.id || item.consignment_number),
      vehicleNumber: linkedConsignmentVehicle(cn),
    };
  }));
  // Use the driver/location that belongs to the selected vehicle, instead of
  // taking a driver's name from an unrelated first manifest row.
  const representative = items.find((item) =>
    linkedConsignmentVehicle(getConsignment(item)).replace(/[\s-]/g, "").toUpperCase() ===
      chosenVehicle.replace(/[\s-]/g, "").toUpperCase(),
  ) || first;
  const consignment = getConsignment(representative);
  const shipment = record(representative.shipment);
  const from = record(consignment.from_details);
  const to = record(consignment.to_details);
  const transporter = record(manifest.transporter);
  const driver = record(consignment.driver);
  const packageTotals = await loadPackageTotals(
    items.map((item) => text(item.consignment_id || getConsignment(item).id)),
  );
  const manifestDate = date(manifest.manifest_date || manifest.created_at);
  const time = text(manifest.created_at)
    ? new Date(manifest.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : "";
  fit(doc, manifestDate + "  " + time, X + 442, 145, 87, 7.2);
  const billNumbers = unique(items.map((item) =>
    text(item.eway_bill_number || record(item.shipment).eway_bill_number)));
  const headerBill = String(billNumbers.length);
  const validUntil = items
    .map((item) => text(record(item.shipment).valid_until))
    .filter(Boolean).sort()[0] || "";
  let y = infoRow(doc, 152,
    ["PAN No.", "GSTIN", "CIN", "No. of E-Way Bills", "E-way Bill Date"],
    [text(data.branch.pan), text(data.branch.gstin), "",
      headerBill, billNumbers.length === 1 ? date(shipment.eway_bill_date) : ""],
    [87, 132, 124, 94, 95]);
  y = infoRow(doc, y,
    ["From", "Vehicle No.", "Load Type", "E-way Bill Valid", "Mode"],
    [text(from.place || shipment.dispatch_from_place || data.branch.city),
      chosenVehicle,
      text(manifest.load_type || consignment.load_type), date(validUntil),
      text(consignment.transport_mode)],
    [87, 132, 124, 94, 95]);
  y = infoRow(doc, y,
    ["To", "Transporter", "Driver's Name", "Driver's Contact No."],
    [text(to.place || shipment.recipient_place),
      text(manifest.transporter_name || transporter.transporter_name),
      text(driver.full_name), text(driver.mobile_number)],
    [87, 162, 155, 128]);

  let totalPieces = 0;
  let totalWeight = 0;
  const rows = items.map((item, index) => {
    const cn = getConsignment(item);
    const linkedShipment = record(item.shipment);
    const source = record(cn.from_details);
    const destination = record(cn.to_details);
    const id = text(item.consignment_id || cn.id);
    const shipId = text(item.shipment_id || linkedShipment.id);
    const saved = packageTotals.get(id + ":" + shipId);
    const goods = Array.isArray(linkedShipment.shipment_items)
      ? linkedShipment.shipment_items as Row[] : [];
    // Consignment package lines are the authority for manifest package and
    // weight totals; only fall back to shipment items if no package line exists.
    const pkgs = saved
      ? saved.quantity
      : goods.reduce((sum, part) => sum + num(part.quantity), 0);
    const weight = saved
      ? saved.weightKg
      : goods.reduce((sum, part) => sum + num(part.weight_kg), 0);
    totalPieces += pkgs;
    totalWeight += weight;
    const billing = text(cn.billing_status);
    return [
      String(index + 1),
      text(item.consignment_number || cn.consignment_number),
      text(source.place || linkedShipment.dispatch_from_place || linkedShipment.supplier_place),
      text(destination.place || linkedShipment.recipient_place),
      pkgs ? money(pkgs) : "",
      weight ? money(weight) : "",
      billing === "billed" ? "TO PAY" : billing === "billed_and_paid" ? "PAID" : "TO B BILL",
      text(linkedShipment.supplier_trade_name || linkedShipment.supplier_legal_name),
      text(linkedShipment.recipient_trade_name || linkedShipment.recipient_legal_name),
    ];
  });
  const widths = [26, 77, 59, 58, 33, 55, 50, 86, 88];
  const tab = table(doc, "MANIFEST DETAILS", number,
    ["S. No.", "Consignment No.", "From", "To", "Pkgs", "Weight", "Bill Status", "Consignor", "Consignee"],
    widths, rows, y);
  totals(doc, "Total / No. of Consignments: " + rows.length, tab.y,
    [["Pkgs", money(totalPieces)], ["Weight (KG)", money(totalWeight)]]);
  // Transfer metadata that is not part of the source's nine-column table is
  // retained in a separate appendix instead of being silently discarded.
  if (items.some((item) => text(item.eway_bill_number) || text(item.transfer_error))) {
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("MANIFEST TRANSFER DETAILS - " + number, X, 35);
    const appendix = items.map((item) => [
      text(item.consignment_number || getConsignment(item).consignment_number),
      text(item.eway_bill_number || record(item.shipment).eway_bill_number),
      linkedConsignmentVehicle(getConsignment(item)),
      text(item.transfer_status),
      text(item.transfer_error),
    ]);
    table(doc, "MANIFEST TRANSFER DETAILS", number,
      ["Consignment", "E-Way Bill", "Consignment Vehicle", "Transfer Status", "Error / Remarks"],
      [97, 107, 98, 84, 146], appendix, 48);
  }
  finish(doc, data.name);
  doc.save("Manifest-" + (number || "manifest") + ".pdf");
}

export async function printStockMovementPdf(row: Row, kind: StockKind, canViewSourceIncome: boolean) {
  const outward = kind === "outward";
  const number = text(outward ? row.outward_number : row.receipt_number);
  const created = outward ? row.outward_date : row.receipt_date;
  const data = await loadHeader(text(row.branch_id), record(row.branch));
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  doc.setTextColor(...ink);
  heading(doc, outward ? "STOCK OUTWARD" : "STOCK INWARD", number, data);
  fit(doc, date(created), X + 442, 145, 88, 7.8);
  const docs = (outward ? row.stock_outward_documents : row.stock_inward_documents) as Row[] || [];
  const sources = (outward ? row.stock_outward_sources : row.stock_inward_sources) as Row[] || [];
  const packages = (outward ? row.stock_outward_packages : row.stock_inward_packages) as Row[] || [];
  let y = infoRow(doc, 152,
    ["PAN No.", "GSTIN", "Branch", "Document Count", "Package Lines"],
    [text(data.branch.pan), text(data.branch.gstin), text(data.branch.branch_name),
      String(docs.length), String(packages.length)],
    [87, 132, 124, 94, 95]);
  y = infoRow(doc, y,
    [outward ? "Outward Date" : "Receipt Date", outward ? "Loading Date" : "Unloading Date", "Vehicle Numbers", "Sources"],
    [date(created), date(outward ? row.loading_date : row.unloading_date),
      unique(docs.map((d) => text(d.vehicle_number))).join(", "),
      unique(sources.map((s) => text(record(s.source).contract_name))).join(", ")],
    [100, 100, 153, 179]);
  y = infoRow(doc, y,
    ["WMS Order No.", "Amount Received", "Additional Income Mode", "Approval Amount"],
    [text(outward ? row.wms_sales_order_number : row.wms_purchase_order_number),
      money(outward ? row.loading_amount_received : row.unloading_amount_received),
      text(row.additional_income_mode), money(row.approval_amount)],
    [132, 132, 134, 134]);

  const tableRows = packages.map((p, index) => {
    const linked = docs.find((d) => text(d.id) === text(outward ? p.outward_document_id : p.inward_document_id));
    return [
      String(index + 1),
      text(linked?.document_no),
      text(record(p.source).contract_name),
      text(p.package_type),
      join(p.sku, p.item_name),
      text(p.quantity),
      text(p.weight_kg),
      text(p.pdf_amount),
    ];
  });
  const widths = [27, 92, 96, 75, 93, 42, 48, 59];
  const t = table(doc, outward ? "STOCK OUTWARD" : "STOCK INWARD", number,
    ["S. No.", "Document No.", "Source", "Package Type", "SKU / Item", "Pkgs", "Weight KG", "Amount"],
    widths, tableRows, y);
  const totalCount = packages.reduce((sum, p) => sum + num(p.quantity), 0);
  const weight = packages.reduce((sum, p) => sum + num(p.weight_kg), 0);
  totals(doc, "Total Package Lines: " + packages.length, t.y,
    [["Packages", money(totalCount)], ["Weight (KG)", money(weight)]]);
  // The printout includes every document/vehicle and source name, including
  // those that are not linked directly to a package.
  const extra: Array<[string, string]> = [
    ["Document / Vehicle", docs.map((d) => text(d.document_no) + " / " + text(d.vehicle_number)).join("; ")],
    ["Sources", unique(sources.map((s) => text(record(s.source).contract_name))).join("; ")],
    ["Created", text(row.created_at)],
    ["Posting status", text(outward ? row.loading_received_journal_entry_id : row.unloading_received_journal_entry_id)],
    ...(canViewSourceIncome ? [["Source Income", money(row.source_income_amount)] as [string, string]] : []),
  ].filter((field) => field[1]);
  if (extra.length) {
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("ADDITIONAL STOCK DOCUMENT DETAILS - " + number, X, 34);
    let cy = 48;
    extra.forEach(([label, item]) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text(label + ":", X + 5, cy + 10);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      const wrapped = doc.splitTextToSize(item, 375) as string[];
      const height = Math.max(21, wrapped.length * 9 + 6);
      if (cy + height > H - 80) {
        doc.addPage();
        cy = 48;
      }
      rect(doc, X, cy, W, height);
      doc.text(wrapped, X + 150, cy + 10);
      cy += height;
    });
  }
  finish(doc, data.name);
  doc.save((outward ? "Stock-Outward-" : "Stock-Inward-") + (number || "receipt") + ".pdf");
}


/** Delivery manifest (LR-based) variant of the same Manifest Auto print template. */
export async function printDeliveryManifestPdf(
  manifest: Row,
  locations: { from: string; to: string },
) {
  const number = text(manifest.manifest_number);
  const data = await loadHeader(text(manifest.branch_id), record(manifest.branch));
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  doc.setTextColor(...ink);
  const partner = record(manifest.partner);
  const links: Row[] = Array.isArray(manifest.lr_links) ? manifest.lr_links : [];
  const linkedShipments = links.flatMap((link) => {
    const lr = record(link.lr);
    return ((lr.lr_shipments ?? []) as Row[])
      .map((entry) => record(entry.shipment))
      .filter((shipment) => Boolean(Object.keys(shipment).length));
  });
  const consignmentIds = unique(linkedShipments.map((shipment) =>
    text(shipment.consignment_id)));
  const db = supabase as any;
  const consignments: Row[] = [];
  for (let index = 0; index < consignmentIds.length; index += 80) {
    const { data: rows, error } = await db
      .from("consignments")
      .select(
        "id,part_b_vehicle_no,transport_mode,vehicle:vehicles(registration_number),driver:drivers(full_name,mobile_number)",
      )
      .in("id", consignmentIds.slice(index, index + 80));
    if (error) throw new Error("Could not load linked consignment vehicles: " + error.message);
    consignments.push(...((rows ?? []) as Row[]));
  }
  const consignmentById = new Map(consignments.map((cn) => [text(cn.id), cn]));
  const chosenVehicle = mostCommonManifestVehicle(consignments.map((cn) => ({
    consignmentId: text(cn.id),
    vehicleNumber: linkedConsignmentVehicle(cn),
  }))) || text(manifest.vehicle_no);
  const representative = consignments.find((cn) =>
    linkedConsignmentVehicle(cn).replace(/[\s-]/g, "").toUpperCase() ===
    chosenVehicle.replace(/[\s-]/g, "").toUpperCase(),
  ) || {};
  const driver = record(representative.driver);
  const packageTotals = await loadPackageTotals(consignmentIds);
  const deliveryBillNumbers = unique(linkedShipments.map((shipment) => text(shipment.eway_bill_number)));
  heading(doc, "MANIFEST DETAILS", number, data);
  fit(doc, date(manifest.manifest_date), X + 442, 145, 88, 7.8);
  let y = infoRow(doc, 152,
    ["PAN No.", "GSTIN", "CIN", "No. of E-Way Bills", "E-way Bill Date"],
    [text(data.branch.pan), text(data.branch.gstin), "",
      String(deliveryBillNumbers.length),
      deliveryBillNumbers.length === 1 ? date(linkedShipments.find((shipment) => text(shipment.eway_bill_number) === deliveryBillNumbers[0])?.eway_bill_date) : ""],
    [87, 132, 124, 94, 95]);
  y = infoRow(doc, y,
    ["From", "Vehicle No.", "Load Type", "E-way Bill Valid", "Mode"],
    [locations.from, chosenVehicle, text(manifest.load_type), "",
      text(representative.transport_mode || manifest.transport_mode)],
    [87, 132, 124, 94, 95]);
  y = infoRow(doc, y,
    ["To", "Transporter / Partner", "Driver's Name", "Driver's Contact No."],
    [locations.to, text(partner.delivery_partner_name),
      text(driver.full_name || manifest.driver_name),
      text(driver.mobile_number || manifest.driver_contact_number)],
    [87, 162, 155, 128]);

  let totalPieces = 0;
  let totalWeight = 0;
  const rows = links.map((link, index) => {
    const lr = record(link.lr);
    const shipments: Row[] = ((lr.lr_shipments ?? []) as Row[])
      .map((entry) => record(entry.shipment))
      .filter((shipment) => Boolean(Object.keys(shipment).length));
    const first = shipments[0] || {};
    const totals = shipments.reduce((sum, shipment) => {
      const cnId = text(shipment.consignment_id);
      const matching = packageTotals.get(cnId + ":" + text(shipment.id));
      const items = Array.isArray(shipment.shipment_items)
        ? shipment.shipment_items as Row[] : [];
      sum.pkgs += matching ? matching.quantity
        : items.reduce((n, item) => n + num(item.quantity), 0);
      sum.weight += matching ? matching.weightKg
        : items.reduce((n, item) => n + num(item.weight_kg), 0);
      return sum;
    }, { pkgs: 0, weight: 0 });
    totalPieces += totals.pkgs;
    totalWeight += totals.weight;
    return [
      String(index + 1),
      text(lr.lr_number),
      text(first.supplier_place || locations.from),
      text(first.recipient_place || locations.to),
      totals.pkgs ? money(totals.pkgs) : "",
      totals.weight ? money(totals.weight) : "",
      text(link.transfer_status),
      text(first.supplier_trade_name),
      text(first.recipient_trade_name),
    ];
  });
  const widths = [26, 77, 59, 58, 33, 55, 50, 86, 88];
  const result = table(doc, "MANIFEST DETAILS", number,
    ["S. No.", "LR No.", "From", "To", "Pkgs", "Weight", "Status", "Consignor", "Consignee"],
    widths, rows, y);
  totals(doc, "Total / No. of LR: " + links.length, result.y,
    [["Pkgs", money(totalPieces)], ["Weight (KG)", money(totalWeight)]]);
  if (linkedShipments.length || links.some((link) => text(link.transfer_error))) {
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("MANIFEST LR / E-WAY BILL DETAILS - " + number, X, 35);
    const appendix = links.flatMap((link) => {
      const lr = record(link.lr);
      const shipments: Row[] = Array.isArray(lr.lr_shipments) ? lr.lr_shipments : [];
      return shipments.length
        ? shipments.map((entry) => {
            const shipment = record(entry.shipment);
            const cn = consignmentById.get(text(shipment.consignment_id)) || {};
            return [
              text(lr.lr_number),
              text(shipment.eway_bill_number),
              linkedConsignmentVehicle(cn),
              text(link.transfer_status),
              text(link.transfer_error),
            ];
          })
        : [[text(lr.lr_number), "", "", text(link.transfer_status), text(link.transfer_error)]];
    });
    table(doc, "MANIFEST LR DETAILS", number,
      ["LR No.", "E-Way Bill No.", "Consignment Vehicle", "Transfer Status", "Error / Remarks"],
      [97, 107, 98, 84, 146], appendix, 48);
  }
  finish(doc, data.name);
  doc.save("Manifest-" + (number || "manifest") + ".pdf");
}
