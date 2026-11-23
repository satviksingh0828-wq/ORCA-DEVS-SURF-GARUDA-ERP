import jsPDF from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { formatConsignmentGst } from "./consignment-pdf-format";

type AnyRecord = Record<string, unknown>;

type ConsignmentPdfOptions = {
  consignment: AnyRecord;
  shipments: AnyRecord[];
  packages: AnyRecord[];
};

const A4_WIDTH = 595;
const A4_HEIGHT = 841;
const FORM_X = 16;
const FORM_Y = 49.6;
const FORM_W = 564.2;
const FORM_H = 357.9;
const BLACK: [number, number, number] = [20, 20, 20];
const RED: [number, number, number] = [185, 28, 28];

const text = (value: unknown) => String(value ?? "").trim();
const display = (value: unknown) => text(value);
const num = (value: unknown) => Number(value || 0);
const date = (value: unknown) => {
  const raw = text(value).slice(0, 10);
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : raw;
};
const money = (value: unknown) => {
  const number = num(value);
  if (!number) return "";
  return number.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};
const join = (...values: unknown[]) => values.map(text).filter(Boolean).join(", ");
const numberString = (value: number, fraction = 3) =>
  value.toLocaleString("en-IN", {
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  });

function addressLines(party: AnyRecord, prefix: "supplier" | "recipient") {
  const lines = [
    text(party[`${prefix}_address_line_1`]) || text(party[`${prefix}_address`]),
    text(party[`${prefix}_address_line_2`]),
    join(party[`${prefix}_place`], party[`${prefix}_state`]),
  ].filter(Boolean);
  return lines.filter((line, index) => lines.indexOf(line) === index);
}

function partyName(party: AnyRecord, prefix: "supplier" | "recipient") {
  return text(party[`${prefix}_trade_name`]) || text(party[`${prefix}_legal_name`]);
}

function billingCheckboxes(status: unknown) {
  const normalized = text(status).toLowerCase();
  return {
    toPay: normalized === "billed",
    paid: normalized === "billed_and_paid",
    tbb: normalized === "to_be_billed" || !normalized,
  };
}

function safeImageData(url: string): Promise<string | null> {
  return fetch(url)
    .then((response) => response.blob())
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        }),
    )
    .catch(() => null);
}

function drawWrapped(
  doc: jsPDF,
  value: string,
  x: number,
  y: number,
  width: number,
  lineHeight = 7,
) {
  if (!value) return 0;
  const lines = doc.splitTextToSize(value, width) as string[];
  doc.text(lines, x, y);
  return lines.length * lineHeight;
}

function field(doc: jsPDF, label: string, value: string, x: number, y: number, width: number) {
  const originalSize = doc.getFontSize();
  doc.setFont("helvetica", "bold");
  doc.text(label, x, y);
  const valueX = x + doc.getTextWidth(label) + 3;
  doc.setFont("helvetica", "normal");
  // Keep the reference form's single-line cells from overflowing into the
  // next framed cell. Full values are repeated in the detail continuation.
  const allowed = Math.max(12, width - (valueX - x) - 2);
  let size = originalSize;
  while (size > 5.1 && doc.getTextWidth(value) > allowed) {
    size -= 0.25;
    doc.setFontSize(size);
  }
  if (doc.getTextWidth(value) <= allowed) {
    doc.text(value, valueX, y);
  } else {
    let visible = value;
    while (visible.length > 1 && doc.getTextWidth(visible + "...") > allowed) {
      visible = visible.slice(0, -1);
    }
    doc.text(visible + "...", valueX, y);
  }
  doc.setFontSize(originalSize);
}

function checkbox(doc: jsPDF, x: number, y: number, label: string, checked: boolean) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.6);
  doc.text(label, x - doc.getTextWidth(label) - 3, y - 0.5);
  doc.rect(x, y - 8, 10, 8);
  if (checked) {
    doc.setFont("helvetica", "bold");
    doc.text("✓", x + 1, y - 1);
  }
}


/**
 * Keep the reference's original 565 x 358 pt receipt block at the same A4
 * coordinates. Extra ERP fields and multi-shipment details flow below it,
 * spilling to additional A4 portrait pages only when needed.
 */
function appendConsignmentDetails(
  pdf: jsPDF,
  consignment: AnyRecord,
  shipments: AnyRecord[],
  packages: AnyRecord[],
  items: AnyRecord[],
) {
  let y = 45;
  const left = FORM_X;
  const width = FORM_W;
  const bottom = A4_HEIGHT - 28;
  const grNo = text(consignment.consignment_number);

  const newPage = () => {
    pdf.addPage();
    y = 45;
    pdf.setTextColor(...BLACK);
    pdf.setDrawColor(...BLACK);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text("CONSIGNOR COPY - CONTINUATION", left + 4, 28);
    pdf.setFont("helvetica", "normal");
    pdf.text("GR No.: " + grNo, left + width - 4, 28, { align: "right" });
    pdf.line(left, 34, left + width, 34);
  };
  const ensure = (height: number) => {
    if (y + height > bottom) newPage();
  };
  const heading = (title: string) => {
    ensure(40);
    pdf.setFillColor(238, 238, 238);
    pdf.rect(left, y, width, 17, "FD");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.text(title, left + 5, y + 11.5);
    y += 17;
  };
  const wrapped = (value: string, available: number): string[] => {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    return pdf.splitTextToSize(value || " ", available) as string[];
  };
  const detail = (fields: Array<[string, string]>) => {
    const half = width / 2;
    for (let index = 0; index < fields.length; index += 2) {
      const pair = [fields[index], fields[index + 1]];
      const measured = pair.map((entry) =>
        entry ? wrapped(entry[1], half - 96) : [" "]);
      const totalLines = Math.max(1, ...measured.map((lines) => lines.length));
      let offset = 0;
      while (offset < totalLines) {
        const available = Math.floor((bottom - y - 12) / 8.1);
        if (available < 2) {
          newPage();
          continue;
        }
        const take = Math.min(totalLines - offset, available);
        const height = Math.max(17, take * 8.1 + 7);
        ensure(height);
        pair.forEach((entry, col) => {
          pdf.rect(left + col * half, y, half, height);
          if (!entry) return;
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(6.8);
          const label = entry[0] + (offset ? " cont." : "") + ":";
          pdf.text(label, left + col * half + 4, y + 10, {
            maxWidth: 83,
          });
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(7);
          const segment = measured[col].slice(offset, offset + take);
          if (segment.length) pdf.text(segment, left + col * half + 91, y + 10);
        });
        y += height;
        offset += take;
      }
    }
  };
  const grid = (title: string, headers: string[], widths: number[], rows: string[][]) => {
    if (rows.length === 0) return;
    heading(title);
    const header = () => {
      ensure(19);
      let x = left;
      headers.forEach((head, index) => {
        pdf.setFillColor(238, 238, 238);
        pdf.rect(x, y, widths[index], 19, "FD");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(6.6);
        pdf.text(wrapped(head, widths[index] - 7), x + 3, y + 8.8);
        x += widths[index];
      });
      y += 19;
    };
    header();
    for (const row of rows) {
      const pieces = row.map((item, index) => wrapped(item, widths[index] - 7));
      let start = 0;
      while (start < Math.max(...pieces.map((lines) => lines.length))) {
        const availableLines = Math.max(1, Math.floor((bottom - y - 7) / 8));
        if (availableLines < 1 || y + 16 > bottom) {
          newPage();
          header();
        }
        const take = Math.max(1, Math.min(
          Math.max(...pieces.map((lines) => lines.length)) - start,
          Math.floor((bottom - y - 7) / 8),
        ));
        const rowHeight = Math.max(16, take * 8 + 7);
        let x = left;
        pieces.forEach((lineItems, index) => {
          pdf.rect(x, y, widths[index], rowHeight);
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(7);
          pdf.text(lineItems.slice(start, start + take), x + 3, y + 10);
          x += widths[index];
        });
        y += rowHeight;
        start += take;
      }
    }
  };

  // The reference receipt must occupy page 1 on its own. Every optional
  // detail section starts on a dedicated continuation page.
  newPage();

  const first = shipments[0] ?? {};
  const fromName = partyName(first, "supplier");
  const toName = partyName(first, "recipient");
  const fromAddress = addressLines(first, "supplier").join(", ");
  const toAddress = addressLines(first, "recipient").join(", ");
  const goods = items.map((item) => text(item.product_name) || text(item.description))
    .filter(Boolean).join(", ");
  const vehicle = (consignment.vehicle ?? {}) as AnyRecord;
  const driver = (consignment.driver ?? {}) as AnyRecord;
  const source = (consignment.source ?? {}) as AnyRecord;
  const transporter = (consignment.transporter ?? {}) as AnyRecord;
  const rental = (consignment.rental ?? {}) as AnyRecord;

  const extras: Array<[string, string]> = [
    ["Issuing Branch", text(((consignment.branch ?? {}) as AnyRecord).branch_name)],
    ["Branch Address", join(
      ((consignment.branch ?? {}) as AnyRecord).address_line1,
      ((consignment.branch ?? {}) as AnyRecord).address_line2,
      ((consignment.branch ?? {}) as AnyRecord).area_locality,
      ((consignment.branch ?? {}) as AnyRecord).city,
      ((consignment.branch ?? {}) as AnyRecord).state,
      ((consignment.branch ?? {}) as AnyRecord).pin_code,
    )],
    ["Branch GSTIN", text(((consignment.branch ?? {}) as AnyRecord).gstin)],
    ["Branch PAN", text(((consignment.branch ?? {}) as AnyRecord).pan)],
    ["Branch Contact", text(((consignment.branch ?? {}) as AnyRecord).mobile_number)],
    ["Source / Contract", text(source.contract_name)],
    ["Consignment Type", text(consignment.consignment_type)],
    ["Movement Mode", text(consignment.movement_mode)],
    ["Own Transport Option", text(consignment.own_transport_mode)],
    ["Transport Mode", text(consignment.transport_mode)],
    ["Driver", text(driver.full_name) || text(driver.driver_code)],
    ["Vehicle", text(vehicle.registration_number) || text(consignment.part_b_vehicle_no)],
    ["Transporter", text(transporter.transporter_name)],
    ["Transporter GSTIN", text(transporter.gstin)],
    ["Transporter PIN", text(transporter.pin_code)],
    ["Rental", text(rental.rental_name)],
    ["Delivery Date", date(consignment.delivery_date)],
    ["Transporter LR No.", text(consignment.transporter_lr_number)],
    ["Transporter LR Date", date(consignment.transporter_lr_date)],
    ["From PIN", text(consignment.from_pin_code)],
    ["To PIN", text(consignment.to_pin_code)],
    ["Billing status", text(consignment.billing_status)],
    ["Remarks", text(consignment.remarks)],
  ].filter((entry) => Boolean(entry[1])) as Array<[string, string]>;
  heading("ADDITIONAL TRANSPORT / CONSIGNMENT INFORMATION");
  if (extras.length) detail(extras);


  // Show every value that can wrap or be abbreviated in the compact reference.
  const overflow = (content: string, maxWidth: number, maxLines = 1) =>
    (wrapped(content, maxWidth) as string[]).length > maxLines;
  const delivery = text(first.ship_to_address) ||
    text(first.ship_to_address_line_1) || toAddress || text(first.recipient_place);
  const ewayNumbers = shipments.map((entry) => text(entry.eway_bill_number))
    .filter(Boolean).join(", ");
  const fullText = ([
    ["Consignor", fromName, overflow(fromName, 290)],
    ["Consignor address", fromAddress, overflow(fromAddress, 340, 2)],
    ["Consignee", toName, overflow(toName, 290)],
    ["Consignee address", toAddress, overflow(toAddress, 340, 2)],
    ["Goods description", goods, overflow(goods, 275)],
    ["Delivery address", delivery, overflow(delivery, 144, 2)],
    ["E-Way Bill numbers", ewayNumbers, overflow(ewayNumbers, 475)],
  ] as Array<[string, string, boolean]>)
    .filter((entry) => Boolean(entry[1]) && entry[2])
    .map(([label, content]) => [label, content] as [string, string]);
  if (fullText.length) {
    heading("COMPLETE PARTY / GOODS DETAILS");
    detail(fullText);
  }

  if (shipments.length > 1) grid(
    "INVOICE / E-WAY BILL BREAKUP",
    ["Invoice Date", "Document / Invoice No.", "E-Way Bill No.", "Package Type", "Invoice Value"],
    [75, 139, 139, 105, 107],
    shipments.map((shipment) => {
      const matched = packages.filter((pkg) => {
        const linked = (pkg.shipment ?? {}) as AnyRecord;
        return (text(pkg.shipment_id) && text(pkg.shipment_id) === text(shipment.id)) ||
          (text(linked.eway_bill_number) &&
            text(linked.eway_bill_number) === text(shipment.eway_bill_number));
      });
      return [
        date(shipment.document_date),
        text(shipment.document_number),
        text(shipment.eway_bill_number),
        [...new Set((matched.length ? matched : shipments.length === 1 ? packages : [])
          .map((pkg) => text(pkg.package_type)).filter(Boolean))].join(", "),
        money(shipment.total_invoice_value),
      ];
    }),
  );

  if (packages.length > 1 || packages.some((pkg) => text(pkg.sku) || text(pkg.item_name))) grid(
    "PACKAGE INFORMATION",
    ["Package Type", "E-Way Bill No.", "Method", "Quantity", "Weight (KG)", "SKU / Item"],
    [98, 105, 76, 62, 75, 149],
    packages.map((pkg) => [
      text(pkg.package_type),
      text(((pkg.shipment ?? {}) as AnyRecord).eway_bill_number) ||
        text(pkg.eway_bill_number),
      text(pkg.basis) === "weight" ? "Weight-wise" : "Quantity-wise",
      text(pkg.quantity),
      text(pkg.weight_kg),
      join(pkg.sku, pkg.item_name),
    ]),
  );

  // Preserve item-level numbers and descriptions rather than squeezing them
  // into the single Goods Description line in the Crystal-style receipt.
  if (items.length > 1) grid(
    "GOODS / ITEM INFORMATION",
    ["Description", "Qty", "Weight (KG)", "GST Rate", "Taxable Value", "Invoice Value"],
    [174, 52, 73, 64, 101, 101],
    items.map((item) => [
      text(item.product_name) || text(item.description),
      text(item.quantity),
      text(item.weight_kg),
      text(item.gst_rate || item.cgst_rate),
      text(item.taxable_value),
      money(item.total_invoice_value),
    ]),
  );

  const adjustments: Array<[string, string]> = [
    ["Freight deduction", money(consignment.freight_deduction)],
    ["Additional freight", money(consignment.additional_freight)],
    ["Loading deduction", money(consignment.loading_deduction)],
    ["Additional loading", money(consignment.additional_loading)],
  ].filter((entry, i) => num([
    consignment.freight_deduction,
    consignment.additional_freight,
    consignment.loading_deduction,
    consignment.additional_loading,
  ][i]) !== 0) as Array<[string, string]>;
  if (adjustments.length) {
    heading("FREIGHT / CHARGE ADJUSTMENTS");
    detail(adjustments);
  }

  if (pdf.getNumberOfPages() > 1) {
    const pages = pdf.getNumberOfPages();
    for (let p = 1; p <= pages; p += 1) {
      pdf.setPage(p);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      pdf.text(String(p) + " / " + String(pages), A4_WIDTH - 18, A4_HEIGHT - 10, {
        align: "right",
      });
    }
  }
}


// Fit a value into the reference's fixed-width cells without JS PDF's implicit
// multi-line wrapping, which previously crossed the printed borders.
function singleLine(
  pdf: jsPDF, content: string, x: number, y: number, width: number,
  preferredSize = 7, bold = false,
) {
  pdf.setFont("helvetica", bold ? "bold" : "normal");
  let size = preferredSize;
  pdf.setFontSize(size);
  while (pdf.getTextWidth(content) > width && size > 5) {
    size -= 0.2;
    pdf.setFontSize(size);
  }
  let result = content;
  if (pdf.getTextWidth(result) > width) {
    while (result.length > 1 && pdf.getTextWidth(result + "...") > width) {
      result = result.slice(0, -1);
    }
    result += "...";
  }
  pdf.text(result, x, y);
  return result === content;
}

function limitedLines(
  pdf: jsPDF, content: string, x: number, y: number, width: number,
  maxLines: number, leading: number, size = 7,
) {
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(size);
  const wrapped = pdf.splitTextToSize(content || " ", width) as string[];
  const visible = wrapped.slice(0, maxLines);
  if (wrapped.length > maxLines && visible.length) {
    let last = visible[visible.length - 1];
    while (last.length && pdf.getTextWidth(last + "...") > width) last = last.slice(0, -1);
    visible[visible.length - 1] = last + "...";
  }
  visible.forEach((line, i) => pdf.text(line, x, y + leading * i));
}

// The source template has room for six baselines of terms (y=351..386).
// Reduce size as needed, never allow a seventh line into signatures.
function fittedParagraph(
  pdf: jsPDF, content: string, x: number, y: number,
  width: number, maxLines: number, leading: number,
) {
  let size = 6.3;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(size);
  let wrapped = pdf.splitTextToSize(content, width) as string[];
  while (wrapped.length > maxLines && size > 4.5) {
    size -= 0.15;
    pdf.setFontSize(size);
    wrapped = pdf.splitTextToSize(content, width) as string[];
  }
  wrapped.slice(0, maxLines).forEach((line, i) => pdf.text(line, x, y + i * leading));
}

export async function printConsignorCopyPdf({
  consignment,
  shipments,
  packages,
}: ConsignmentPdfOptions) {
  const [companyResult, branchResult, logo] = await Promise.all([
    supabase.from("company").select("company_name").limit(1).maybeSingle(),
    text(consignment.branch_id)
      ? supabase.from("branches")
          .select("branch_name,address_line1,address_line2,area_locality,city,state,pin_code,gstin,pan,mobile_number")
          .eq("id", text(consignment.branch_id))
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    safeImageData("/garuda-logo.png"),
  ]);
  // The legal name is only the document title. All address, GSTIN, PAN and
  // contact values must come from the issuing branch, never the company row.
  const companyName =
    text(companyResult.data?.company_name) || "GARUDA LOGISTICS SOLUTION PRIVATE LIMITED";
  const branch = {
    ...((consignment.branch ?? {}) as AnyRecord),
    ...((branchResult.data ?? {}) as AnyRecord),
  };
  const branchAddressLine1 = text(branch.address_line1);
  const branchAddressLine2 = join(branch.address_line2, branch.area_locality);
  const branchAddressLine3 = [text(branch.city), text(branch.state)]
    .filter(Boolean)
    .join(" , ")
    .concat(text(branch.pin_code) ? ` - ${text(branch.pin_code)}` : "");
  const shipment = shipments[0] ?? {};
  const items = shipments.flatMap((entry) => (entry.shipment_items ?? []) as AnyRecord[]);
  const packageRows = packages as AnyRecord[];
  const actualWeight = items.reduce((sum, item) => sum + num(item.weight_kg), 0);
  const packageWeight = packageRows.reduce((sum, item) => sum + num(item.weight_kg), 0);
  const chargedWeight = packageWeight;
  const articleCount =
    packageRows.reduce((sum, item) => sum + num(item.quantity), 0) ||
    items.reduce((sum, item) => sum + num(item.quantity), 0);
  const packageType = packageRows
    .map((entry) => text(entry.package_type))
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(", ");
  const goodsDescription = items
    .map((item) => text(item.product_name) || text(item.description))
    .filter(Boolean)
    .join(", ");
  // GST is the rate on a goods line, not the sum of every line's rates.
  // Prefer explicit GST, else IGST, else CGST + SGST.
  const gstRates = items.map((item) =>
    num(item.gst_rate) || num(item.igst_rate) ||
    (num(item.cgst_rate) + num(item.sgst_rate)),
  ).filter((rate) => rate > 0);
  const gstRate = gstRates[0] ?? 0;
  const gstLabel = new Set(gstRates.map((rate) => rate.toFixed(2))).size > 1
    ? "Mixed rates"
    : formatConsignmentGst(gstRate);
  const billing = billingCheckboxes(consignment.billing_status);
  const vehicle = consignment.vehicle as AnyRecord | null | undefined;
  const fromName = partyName(shipment, "supplier");
  const toName = partyName(shipment, "recipient");
  const fromAddress = addressLines(shipment, "supplier");
  const toAddress = addressLines(shipment, "recipient");
  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  pdf.setTextColor(...BLACK);
  pdf.setDrawColor(...BLACK);
  pdf.setLineWidth(0.55);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6.3);

  // Outer frame and the reference's compact top-of-A4 form.
  pdf.rect(FORM_X, FORM_Y, FORM_W, FORM_H);
  pdf.line(375.2, FORM_Y, 375.2, 220.6);
  pdf.line(474, FORM_Y, 474, 77.5);
  pdf.line(375, 63, 474, 63);
  pdf.line(375, 77, FORM_X + FORM_W, 77);
  pdf.line(375, 90.5, FORM_X + FORM_W, 90.5);
  pdf.line(375, 104, FORM_X + FORM_W, 104);
  pdf.line(FORM_X, 130, FORM_X + FORM_W, 130);
  pdf.line(FORM_X, 175.3, 375.2, 175.3);
  pdf.line(375, 172, FORM_X + FORM_W, 172);
  pdf.line(438.2, 172.3, 438.2, 284.1);
  pdf.line(518, 172.3, 518, 272.9);
  pdf.line(FORM_X, 220.3, 438.2, 220.3);
  pdf.line(FORM_X, 234.8, 438.8, 234.8);
  pdf.line(267.5, 234.5, 267.5, 272);
  pdf.line(FORM_X, 272.1, FORM_X + FORM_W, 272.1);
  pdf.line(FORM_X, 284.6, FORM_X + FORM_W, 284.6);
  pdf.line(FORM_X, 307.3, FORM_X + FORM_W, 307.3);
  pdf.line(235.8, 307.3, 235.8, 392.3);
  pdf.line(365, 306.6, 365, 392.3);
  pdf.line(FORM_X, 332, FORM_X + FORM_W, 332);
  pdf.line(FORM_X, 345.5, 235.8, 345.5);
  pdf.line(FORM_X, 392.3, FORM_X + FORM_W, 392.3);
  pdf.line(375.2, 143.6, FORM_X + FORM_W, 143.6);
  pdf.line(375.2, 157.8, FORM_X + FORM_W, 157.8);
  pdf.line(375.2, 172.3, FORM_X + FORM_W, 172.3);
  pdf.line(375.2, 197.3, 438.2, 197.3);
  pdf.setFillColor(229, 229, 229);
  pdf.rect(438.8, 172.6, FORM_X + FORM_W - 438.8, 14.5, "F");
  pdf.line(438.8, 172.6, FORM_X + FORM_W, 172.6);
  pdf.line(438.8, 187.1, FORM_X + FORM_W, 187.1);
  pdf.line(518, 172.6, 518, 187.1);

  if (logo) pdf.addImage(logo, "PNG", 18.5, 62.3, 70, 61);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(6.5);
  field(pdf, "SAC Code :", "9965", 20, 57, 78);
  field(pdf, "GST No. :", text(branch.gstin), 112, 57, 100);
  field(pdf, "PAN No. :", text(branch.pan), 238, 57, 120);
  pdf.setFontSize(10);
  singleLine(pdf, companyName, 93, 73, 274, 10, true);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6);
  singleLine(pdf, branchAddressLine1, 119, 86, 248, 6.2);
  singleLine(pdf, branchAddressLine2, 120, 96, 247, 6.2);
  singleLine(pdf, branchAddressLine3, 119, 106, 248, 6.2);
  singleLine(pdf, `GSTIN : ${text(branch.gstin)}`, 119, 116, 248, 6.2);
  singleLine(pdf, `Contact No. : ${text(branch.mobile_number || branch.telephone_number)}`,
    119, 126, 248, 6);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(6.7);
  pdf.text("CONSIGNOR COPY", 391, 58);
  pdf.text("GR", 476, 58);
  pdf.text("No. :", 476, 64);
  pdf.text(text(consignment.consignment_number), 499, 58);
  field(
    pdf,
    "DATE :",
    date(consignment.consignment_date || consignment.created_at),
    408,
    71.5,
    160,
  );
  field(
    pdf,
    "Truck/Flight No. :",
    text(consignment.part_b_vehicle_no || vehicle?.registration_number),
    378,
    84.8,
    196,
  );
  field(pdf, "Mode of Movement :", text(consignment.transport_mode).toUpperCase(), 378, 98, 196);
  field(
    pdf,
    "From :",
    text(shipment.dispatch_from_place) || text(shipment.supplier_place),
    378,
    111.5,
    196,
  );

  pdf.setFontSize(7);
  field(pdf, "Consignor :", fromName, 20, 137, 348);
  limitedLines(pdf, fromAddress.join(", "), 20, 148, 347, 2, 8, 7);
  field(pdf, "GST No. :", text(shipment.supplier_gstin), 20, 169, 270);
  field(pdf, "M :", text(shipment.supplier_phone), 315, 169, 55);
  field(pdf, "Consignee :", toName, 20, 182, 348);
  limitedLines(pdf, toAddress.join(", "), 20, 193, 347, 3, 8, 7);
  field(pdf, "GST No. :", text(shipment.recipient_gstin), 20, 221, 270);
  field(pdf, "M :", text(shipment.recipient_phone), 315, 221, 55);

  field(pdf, "To :", text(shipment.recipient_place), 378, 137, 196);
  field(pdf, "Packing Type :", packageType, 378, 151, 196);
  field(pdf, "Article :", articleCount ? String(articleCount) : "", 378, 165, 98);
  checkbox(pdf, 480, 166, "To Pay", billing.toPay);
  checkbox(pdf, 523, 166, "Paid", billing.paid);
  checkbox(pdf, 562, 166, "TBB", billing.tbb);
  pdf.setFont("helvetica", "bold");
  pdf.text("Actual Wt.", 379, 186);
  pdf.text("Particulars", 443, 186);
  pdf.text("Amount", 523, 186);
  pdf.setFont("helvetica", "normal");
  pdf.text(actualWeight ? numberString(actualWeight) : "", 395, 198);
  pdf.text("FREIGHT", 442, 200);
  pdf.text("Charged Wt.", 379, 211);
  pdf.text(chargedWeight ? numberString(chargedWeight) : "", 395, 224);
  pdf.text("", 523, 224);

  field(pdf, "Goods Description :", goodsDescription, 20, 230, 340);
  field(
    pdf,
    "Invoice No. :",
    shipments
      .map((entry) => text(entry.document_number))
      .filter(Boolean)
      .join(", "),
    20,
    245,
    240,
  );
  field(pdf, "PO No. :", "", 271, 245, 135);
  field(
    pdf,
    "Value :",
    shipments
      .map((entry) => money(entry.total_invoice_value))
      .filter(Boolean)
      .join(", "),
    20,
    256,
    240,
  );
  field(pdf, "Challan No. :", "", 271, 256, 135);
  field(pdf, "Date :", date(shipment.document_date), 20, 269, 240);
  field(pdf, "GST", gstLabel, 442, 269, 120);
  field(
    pdf,
    "E-Way Bill No. :",
    shipments
      .map((entry) => text(entry.eway_bill_number))
      .filter(Boolean)
      .join(", "),
    20,
    280,
    550,
  );
  field(pdf, "TOTAL", "", 518, 280, 58);
  field(pdf, "Remarks :", text(consignment.remarks), 20, 294, 550);
  field(pdf, "Rs in Words :", "", 20, 304, 550);
  const fullDeliveryAddress =
    text(shipment.ship_to_address) || text(shipment.ship_to_address_line_1) ||
    join(shipment.recipient_address_line_1, shipment.recipient_address_line_2) ||
    text(shipment.recipient_place);
  pdf.setFont("helvetica", "bold");
  pdf.text("Delivery At :", 20, 318);
  pdf.setFont("helvetica", "normal");
  limitedLines(pdf, fullDeliveryAddress, 80, 318, 148, 2, 9, 7);
  pdf.setFont("helvetica", "bold");
  pdf.text("Acknowledgement :", 239, 318);
  pdf.setFont("helvetica", "normal");
  pdf.text("Goods received in good condition", 239, 329);
  field(pdf, "IGST Paid By :", "", 366, 318, 210);

  pdf.setFont("helvetica", "bold");
  pdf.text("Terms & Conditions :", 20, 337);
  pdf.setFont("helvetica", "normal");
  fittedParagraph(
    pdf,
    "I/We hereby agree to the terms & conditions set out on the reverse of this consignor's copy & declare that the contents on the waybill are true and correct. The To-pay freight has my/our consent and will be paid by the consignee along with the applicable service charges at the time of delivery.",
    20, 351, 206, 6, 7,
  );
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(...RED);
  singleLine(pdf, `FOR ${companyName}`, 371, 342, 201, 7.2, true);
  pdf.setTextColor(...BLACK);
  pdf.text("Signature with Stamp", 264, 385);
  pdf.text("Booking Clerk", 496, 385);
  pdf.setFontSize(6.5);
  pdf.text("Smart People Great Solution", A4_WIDTH / 2, 402, { align: "center" });
  pdf.setFontSize(7);
  pdf.text("POWERED BY ORCA DEVS SURF", A4_WIDTH / 2, A4_HEIGHT - 10, { align: "center" });

  appendConsignmentDetails(pdf, { ...consignment, branch }, shipments, packages, items);

  const filename = `Consignor-Copy-${text(consignment.consignment_number) || "consignment"}.pdf`;
  pdf.save(filename);
}
