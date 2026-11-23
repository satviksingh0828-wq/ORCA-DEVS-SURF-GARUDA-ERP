import jsPDF from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { formatConsignmentGst } from "./consignment-pdf-format";

type AnyRecord = Record<string, unknown>;

type ConsignmentPdfOptions = {
  consignment: AnyRecord;
  shipments: AnyRecord[];
  packages: AnyRecord[];
  /** LR uses the identical first-page reference; only filename differs. */
  filenamePrefix?: "LR";
  /** The GR is page one; optional extra details follow on subsequent pages. */
  mode?: "gr-only" | "with-additional" | "additional-only";
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
    tbb: normalized === "to_be_billed",
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

/**
 * Fit a field's label and value entirely inside its measured rectangle.
 * Full values are retained on the continuation sheet if abbreviated here.
 */
function field(doc: jsPDF, label: string, value: string, x: number, y: number, width: number) {
  const initialSize = doc.getFontSize();
  const safeWidth = Math.max(1, Math.min(width, FORM_X + FORM_W - x - 3));
  const cleanLabel = label.replace(/[\u2013\u2014]/g, "-");
  const cleanValue = value.replace(/[\u2013\u2014]/g, "-").replace(/₹/g, "Rs. ");
  let font = Math.min(7, Math.max(5.4, initialSize));
  doc.setFont("helvetica", "bold");
  doc.setFontSize(font);
  while (font > 5.1 && doc.getTextWidth(cleanLabel) + 4 > safeWidth) {
    font -= 0.2;
    doc.setFontSize(font);
  }
  const labelMax = Math.max(1, safeWidth - 3);
  let shownLabel = cleanLabel;
  while (shownLabel.length > 1 && doc.getTextWidth(shownLabel) > labelMax) {
    shownLabel = shownLabel.slice(0, -1);
  }
  doc.text(shownLabel, x, y);
  const labelWidth = doc.getTextWidth(shownLabel);
  const valueX = x + labelWidth + 3;
  const valueWidth = Math.max(0, safeWidth - labelWidth - 5);
  if (valueWidth > 2 && cleanValue) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(font);
    let size = font;
    while (size > 5.1 && doc.getTextWidth(cleanValue) > valueWidth) {
      size -= 0.2;
      doc.setFontSize(size);
    }
    let shown = cleanValue;
    if (doc.getTextWidth(shown) > valueWidth) {
      while (shown.length > 1 && doc.getTextWidth(shown + "...") > valueWidth) {
        shown = shown.slice(0, -1);
      }
      shown += "...";
    }
    if (doc.getTextWidth(shown) <= valueWidth) doc.text(shown, valueX, y);
  }
  doc.setFontSize(initialSize);
}

function checkbox(doc: jsPDF, x: number, y: number, label: string, checked: boolean) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.6);
  doc.text(label, x - doc.getTextWidth(label) - 4, y - 1);
  doc.rect(x, y - 8.8, 15.5, 9.5);
  if (checked) {
    doc.setFont("helvetica", "bold");
    doc.setLineWidth(1.1);
    doc.line(x + 3, y - 4.5, x + 6.5, y - 1.8);
    doc.line(x + 6.5, y - 1.8, x + 12, y - 7.8);
    doc.setLineWidth(0.55);
  }
}


/**
 * Preserve the reference's original 565 x 358 pt GR geometry.
 * Additional details start on a new A4 sheet, below the single-page GR
 * in combined mode or alone in details-only mode.
 */
function appendConsignmentDetails(
  pdf: jsPDF,
  consignment: AnyRecord,
  shipments: AnyRecord[],
  packages: AnyRecord[],
  items: AnyRecord[],
) {
  let y = 45;
  const firstDetailPage = pdf.getNumberOfPages();
  const left = FORM_X;
  const width = FORM_W;
  const bottom = A4_HEIGHT - 28;
  const grNo = text(consignment.consignment_number);

  const detailsHeader = () => {
    y = 45;
    pdf.setTextColor(...BLACK);
    pdf.setDrawColor(...BLACK);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text("ADDITIONAL TRANSPORT / CONSIGNMENT DETAILS", left + 4, 28);
    pdf.setFont("helvetica", "normal");
    pdf.text("GR No.: " + grNo, left + width - 4, 28, { align: "right" });
    pdf.line(left, 34, left + width, 34);
  };
  const newPage = () => {
    pdf.addPage();
    detailsHeader();
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

  // This is a NEW PDF, not a page appended to the GR.
  detailsHeader();

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
    ["Lorry Receipt Mode", text(consignment.lr_mode)],
    ["Calculated LR Income", text(consignment.lr_calculated_income)],
    ["Linked Manifest", text(consignment.manifest_number)],
    ["Linked Trip", text(consignment.trip_number)],
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

  // Do not add page numbering to the reference GR on page one.
  const lastPage = pdf.getNumberOfPages();
  const detailPages = lastPage - firstDetailPage + 1;
  if (detailPages > 1) {
    for (let p = firstDetailPage; p <= lastPage; p += 1) {
      pdf.setPage(p);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      pdf.text((p - firstDetailPage + 1) + " / " + detailPages,
        A4_WIDTH - 18, A4_HEIGHT - 10, { align: "right" });
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


// Fixed column geometry is taken from the user's 595 x 841 pt GR reference.
// Separate label/value positions are necessary; estimating x from label width
// shifted fields and made them overlap the neighboring border.
function referenceField(
  doc: jsPDF,
  label: string,
  value: string,
  labelX: number,
  valueX: number,
  y: number,
  rightX: number,
  boldValue = false,
  fontSize = 6.6,
) {
  doc.setFont("helvetica", "bold");
  singleLine(doc, label, labelX, y, Math.max(1, valueX - labelX - 3), fontSize, true);
  if (value) {
    doc.setFont("helvetica", boldValue ? "bold" : "normal");
    singleLine(doc, value, valueX, y, Math.max(1, rightX - valueX - 3), fontSize, boldValue);
  }
}

function centeredReferenceLine(
  doc: jsPDF,
  value: string,
  center: number,
  y: number,
  width: number,
  size: number,
  bold = false,
) {
  if (!value) return;
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(size);
  let currentSize = size;
  while (currentSize > 5.2 && doc.getTextWidth(value) > width) {
    currentSize -= 0.2;
    doc.setFontSize(currentSize);
  }
  let visible = value;
  if (doc.getTextWidth(visible) > width) {
    while (visible.length > 1 && doc.getTextWidth(visible + "...") > width)
      visible = visible.slice(0, -1);
    visible += "...";
  }
  if (doc.getTextWidth(visible) <= width) doc.text(visible, center, y, { align: "center" });
}

function issuingBranchAddress(doc: jsPDF, branch: AnyRecord) {
  const main = join(branch.address_line1, branch.address_line2, branch.area_locality);
  const location = [text(branch.city), text(branch.state), text(branch.pin_code)]
    .filter(Boolean).join(" - ");
  doc.setFont("helvetica", "normal");
  let fontSize = 6.6;
  doc.setFontSize(fontSize);
  let addressLines = doc.splitTextToSize(main, 250) as string[];
  while (addressLines.length > 2 && fontSize > 5.2) {
    fontSize -= 0.2;
    doc.setFontSize(fontSize);
    addressLines = doc.splitTextToSize(main, 250) as string[];
  }
  if (addressLines.length > 2) {
    const limit = addressLines.slice(0, 2).join(" ");
    centeredReferenceLine(doc, limit, 232, 85.7, 255, fontSize);
  } else {
    addressLines.slice(0, 2).forEach((line, i) =>
      centeredReferenceLine(doc, line, 232, 85.7 + i * 10.3, 255, fontSize));
  }
  const locationY = addressLines.length < 2 ? 95.8 : 106.4;
  centeredReferenceLine(doc, location, 232, locationY, 255, 6.6);
  if (locationY < 106.4) {
    centeredReferenceLine(doc, "GSTIN : " + text(branch.gstin), 232, 106.4, 255, 6.6);
  } else {
    // If the address takes two lines, prioritize the tax identity over an
    // additional location line; the full location is on the details PDF.
    centeredReferenceLine(doc, "GSTIN : " + text(branch.gstin), 232, 117.0, 255, 6.4);
  }
}

function pdfSafeFilename(raw: string) {
  return raw.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export async function printConsignorCopyPdf({
  consignment,
  shipments,
  packages,
  filenamePrefix,
  mode = "gr-only",
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
  const shipment = shipments[0] ?? {};
  const items = shipments.flatMap((entry) => (entry.shipment_items ?? []) as AnyRecord[]);
  const packageRows = packages as AnyRecord[];
  const actualWeight = items.reduce((sum, item) => sum + num(item.weight_kg), 0);
  const packageWeight = packageRows.reduce((sum, item) => sum + num(item.weight_kg), 0);
  const chargedWeight = packageWeight || actualWeight;
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
  pdf.setLineWidth(1.0);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6.3);

  // Outer frame and the reference's compact top-of-A4 form.
  pdf.rect(FORM_X, FORM_Y, FORM_W, FORM_H);
  pdf.line(375.2, FORM_Y, 375.2, 220.6);
  pdf.line(474, FORM_Y, 474, 77.5);
  pdf.line(375, 63.1, 473.5, 63.1);
  pdf.line(375, 77.1, FORM_X + FORM_W, 77.1);
  pdf.line(375, 90.5, FORM_X + FORM_W, 90.5);
  pdf.line(375, 104, FORM_X + FORM_W, 104);
  pdf.line(FORM_X, 130, FORM_X + FORM_W, 130);
  pdf.line(FORM_X, 175.3, 375.2, 175.3);
  // Align each freight-table border flush to the grey header below.
  pdf.line(438.25, 187.1, 438.25, 284.6);
  pdf.line(518, 187.1, 518, 272.1);
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
  // Complete grey Particulars and Amount cells. Borders are drawn AFTER
  // the fill so no line disappears under the shading or crosses the text.
  pdf.setFillColor(192, 192, 192);
  pdf.rect(438.25, 172.6, 79.75, 14.5, "FD");
  pdf.rect(518, 172.6, FORM_X + FORM_W - 518, 14.5, "FD");

  if (logo) {
    try { pdf.addImage(logo, "PNG", 18.5, 62.3, 70, 61); }
    catch { centeredReferenceLine(pdf, "GARUDA", 54, 96, 65, 12, true); }
  } else {
    centeredReferenceLine(pdf, "GARUDA", 54, 96, 65, 12, true);
  }
  // Header: fixed label/value positions and baselines measured from the
  // supplied Crystal Reports GR (not positions inferred from the text length).
  referenceField(pdf, "SAC Code :", "9965", 20, 71.8, 59.4, 110, false);
  referenceField(pdf, "GST No. :", text(branch.gstin), 113, 154.8, 59.4, 243, false);
  referenceField(pdf, "PAN No. :", text(branch.pan), 247, 298.2, 59.4, 372, false);
  centeredReferenceLine(pdf, companyName, 232, 74.0, 280, 9.9, true);
  issuingBranchAddress(pdf, branch);

  centeredReferenceLine(pdf, "CONSIGNOR COPY", 424.5, 59.4, 96, 6.6, true);
  referenceField(pdf, "GR", text(consignment.consignment_number), 476.8, 498.0, 59.4, 578.4, true);
  singleLine(pdf, "No. :", 476.8, 69.5, 20, 6.6, true);
  referenceField(pdf, "DATE :", date(consignment.consignment_date || consignment.created_at),
    378.8, 408.2, 73.4, 578.4);
  referenceField(pdf, "Truck/Flight No. :",
    text(consignment.part_b_vehicle_no || vehicle?.registration_number),
    378.8, 465.5, 87.2, 578.4);
  referenceField(pdf, "Mode of Movement :", text(consignment.transport_mode).toUpperCase(),
    378.8, 477.5, 100.3, 578.4);
  referenceField(pdf, "From :",
    text(shipment.dispatch_from_place) || text(shipment.supplier_place),
    378.8, 408, 113.6, 578.4);

  referenceField(pdf, "Consignor :", fromName, 20, 75.2, 139.5, 371, true);
  limitedLines(pdf, fromAddress.join(", "), 20, 151, 347, 2, 9, 6.6);
  referenceField(pdf, "GST No. :", text(shipment.supplier_gstin), 20, 75.2, 171.3, 252, true);
  referenceField(pdf, "M :", text(shipment.supplier_phone), 256, 268.5, 171.3, 370, true);
  referenceField(pdf, "Consignee :", toName, 20, 75.2, 185.2, 371, true);
  limitedLines(pdf, toAddress.join(", "), 20, 196, 347, 2, 9.5, 6.6);
  referenceField(pdf, "GST No. :", text(shipment.recipient_gstin), 20, 75.2, 215.7, 252, true);
  referenceField(pdf, "M :", text(shipment.recipient_phone), 256, 268.5, 215.7, 370, true);

  referenceField(pdf, "To :", text(shipment.recipient_place), 378.8, 408, 139.5, 578.4);
  referenceField(pdf, "Packing Type :", packageType, 378.8, 449, 153.5, 578.4);
  referenceField(pdf, "Article :", articleCount ? String(articleCount) : "",
    378.8, 415.2, 167.5, 439, false);
  checkbox(pdf, 481, 169.0, "To Pay", billing.toPay);
  checkbox(pdf, 523.5, 168.7, "Paid", billing.paid);
  checkbox(pdf, 561.75, 169.0, "TBB", billing.tbb);

  centeredReferenceLine(pdf, "Actual Wt.", 407, 183.2, 59, 6.6, true);
  centeredReferenceLine(pdf, "Particulars", 478.3, 183.2, 76, 6.6, true);
  centeredReferenceLine(pdf, "Amount", 548, 183.2, 60, 6.6, true);
  centeredReferenceLine(pdf, actualWeight ? numberString(actualWeight) : "",
    407, 194.0, 59, 6.6);
  referenceField(pdf, "", "FREIGHT", 442, 442, 198.2, 514);
  centeredReferenceLine(pdf, "Charged Wt.", 407, 208, 59, 6.6, true);
  centeredReferenceLine(pdf, chargedWeight ? numberString(chargedWeight) : "",
    407, 218, 59, 6.6);

  referenceField(pdf, "Goods Description :", goodsDescription, 20, 116.2, 230, 433);
  referenceField(pdf, "Invoice No. :",
    shipments.map((entry) => text(entry.document_number)).filter(Boolean).join(", "),
    20, 80.8, 245, 264);
  referenceField(pdf, "PO No. :", "", 271.2, 322, 245, 437);
  referenceField(pdf, "Value :",
    shipments.map((entry) => money(entry.total_invoice_value)).filter(Boolean).join(", "),
    20, 80.8, 256, 264);
  referenceField(pdf, "Challan No. :", "", 271.2, 324, 256, 437);
  referenceField(pdf, "Date :", date(shipment.document_date), 20, 80.8, 269, 264);
  referenceField(pdf, "GST", gstLabel, 442, 459, 269, 514, true);
  referenceField(pdf, "E-Way Bill No. :",
    shipments.map((entry) => text(entry.eway_bill_number)).filter(Boolean).join(", "),
    20, 94.8, 281.3, 437);
  referenceField(pdf, "TOTAL", "", 442, 480, 281.3, 579);
  referenceField(pdf, "Remarks :", text(consignment.remarks), 20, 78, 294, 575);
  referenceField(pdf, "Rs in Words :", "", 20, 86, 305, 575);

  const fullDeliveryAddress =
    text(shipment.ship_to_address) || text(shipment.ship_to_address_line_1) ||
    join(shipment.recipient_address_line_1, shipment.recipient_address_line_2) ||
    text(shipment.recipient_place);
  referenceField(pdf, "Delivery At :", "", 20, 79.5, 318.5, 234, true, 7.4);
  limitedLines(pdf, fullDeliveryAddress, 79.5, 318.5, 149, 2, 10.6, 7.4);
  referenceField(pdf, "Acknowledgement :", "", 238.8, 325, 317.5, 363);
  centeredReferenceLine(pdf, "Goods received in good condition", 300.5, 329, 121, 6.6, true);
  referenceField(pdf, "IGST Paid By :", "", 368.8, 429, 317.5, 576);

  referenceField(pdf, "Terms & Conditions :", "", 20, 100, 341.3, 235);
  fittedParagraph(
    pdf,
    "I/We hereby agree to the terms & conditions set out on the reverse of this consignor's copy & declare that the contents on the waybill are true and correct. The To-pay freight has my/our consent and will be paid by the consignee along with the applicable service charges at the time of delivery.",
    20.2, 353.5, 206, 5, 8.55,
  );
  pdf.setTextColor(...RED);
  centeredReferenceLine(pdf, "FOR " + companyName, 472.5, 341.7, 206, 6.6, true);
  pdf.setTextColor(...BLACK);
  centeredReferenceLine(pdf, "Signature with Stamp", 301.5, 389, 122, 6.6);
  centeredReferenceLine(pdf, "Booking Clerk", 472, 389, 82, 6.6);
  centeredReferenceLine(pdf, "Smart People Great Solution", A4_WIDTH / 2, 403, 205, 6.6, true);

  // The GR is exactly one A4 page like the uploaded sample. Optional
  // supplementary ERP data always belongs to its own distinct PDF.
  const number = pdfSafeFilename(text(consignment.consignment_number) || "consignment");
  const mainName = filenamePrefix === "LR"
    ? "LR-" + number + ".pdf"
    : "Consignor-Copy-" + number + ".pdf";
  if (mode === "gr-only") {
    pdf.save(mainName);
    return;
  }

  if (mode === "with-additional") {
    // Keep the GR as page 1, then append all supplementary sections to the
    // SAME PDF, beginning on page 2. Never create or download a ZIP.
    pdf.addPage();
    appendConsignmentDetails(pdf, { ...consignment, branch }, shipments, packages, items);
    pdf.save("GR-with-Additional-Details-" + number + ".pdf");
    return;
  }

  // The optional standalone details PDF remains available.
  const details = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  details.setDrawColor(...BLACK);
  details.setTextColor(...BLACK);
  details.setLineWidth(0.55);
  appendConsignmentDetails(details, { ...consignment, branch }, shipments, packages, items);
  details.save("Additional-Details-" + number + ".pdf");
}
