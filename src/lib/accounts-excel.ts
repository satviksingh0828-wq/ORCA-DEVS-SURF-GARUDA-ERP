import * as XLSX from "xlsx";

export type AccountKind = "bank" | "cash";

export type AccountExcelRow = Record<string, unknown>;

const BANK_HEADERS = [
  "Branch",
  "Account Holder Name",
  "Bank Name",
  "Account Number",
  "IFSC Code",
  "Bank Branch Name",
  "Account Type",
  "Status",
  "Opening Date",
  "Opening Balance",
  "Opening Balance Date",
];

const CASH_HEADERS = [
  "Branch",
  "Responsible Person",
  "Responsible Person Mobile",
  "Email",
  "Address",
  "Responsible Person Branch",
  "Opening Balance",
  "Opening Balance Date",
];

const s = (value: unknown) => String(value ?? "").trim();

export function excelDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed)
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const raw = s(value);
  const isoMatch = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch)
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
  const indianMatch = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (indianMatch)
    return `${indianMatch[3]}-${indianMatch[2].padStart(2, "0")}-${indianMatch[1].padStart(2, "0")}`;
  return raw;
}

function num(value: unknown, field: string, rowNumber: number): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(String(value).replace(/[,₹\s]/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a number on row ${rowNumber}.`);
  return parsed;
}

function makeSheet(rows: AccountExcelRow[], headers: string[]) {
  const sheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  sheet["!cols"] = headers.map((header) => ({ wch: Math.max(header.length + 3, 18) }));
  return sheet;
}

function downloadWorkbook(workbook: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(workbook, filename, { bookType: "xlsx" });
}

export function exportAccounts(
  kind: AccountKind,
  rows: AccountExcelRow[],
  branchNameById: Map<string, string>,
  filenameDate: string,
) {
  const headers = kind === "bank" ? BANK_HEADERS : CASH_HEADERS;
  const output = rows.map((row) => {
    if (kind === "bank") {
      return {
        Branch: branchNameById.get(s(row.branch_id)) ?? "",
        "Account Holder Name": s(row.account_holder_name),
        "Bank Name": s(row.bank_name),
        "Account Number": s(row.account_number),
        "IFSC Code": s(row.ifsc_code),
        "Bank Branch Name": s(row.bank_branch_name),
        "Account Type": s(row.account_type),
        Status: s(row.status),
        "Opening Date": excelDate(row.opening_date),
        "Opening Balance": Number(row.opening_balance ?? 0),
        "Opening Balance Date": excelDate(row.opening_balance_date),
      };
    }
    return {
      Branch: branchNameById.get(s(row.branch_id)) ?? "",
      "Responsible Person": s(row.responsible_person),
      "Responsible Person Mobile": s(row.responsible_person_mobile),
      Email: s(row.email),
      Address: s(row.address),
      "Responsible Person Branch": s(row.responsible_person_branch),
      "Opening Balance": Number(row.opening_balance ?? 0),
      "Opening Balance Date": excelDate(row.opening_balance_date),
    };
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    makeSheet(output, headers),
    kind === "bank" ? "Bank Accounts" : "Cash Accounts",
  );
  downloadWorkbook(workbook, `${kind}-accounts-${filenameDate}.xlsx`);
}

export function downloadAccountsTemplate(kind: AccountKind) {
  const headers = kind === "bank" ? BANK_HEADERS : CASH_HEADERS;
  const example =
    kind === "bank"
      ? [
          {
            Branch: "Main Branch",
            "Account Holder Name": "Garuda Logistics",
            "Bank Name": "State Bank of India",
            "Account Number": "000000000000",
            "IFSC Code": "SBIN0000000",
            "Bank Branch Name": "Main",
            "Account Type": "savings",
            Status: "active",
            "Opening Date": "2026-01-01",
            "Opening Balance": 0,
            "Opening Balance Date": "2026-01-01",
          },
        ]
      : [
          {
            Branch: "Main Branch",
            "Responsible Person": "Cashier Name",
            "Responsible Person Mobile": "9876543210",
            Email: "cashier@example.com",
            Address: "Office address",
            "Responsible Person Branch": "Main Branch",
            "Opening Balance": 0,
            "Opening Balance Date": "2026-01-01",
          },
        ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    makeSheet([], headers),
    kind === "bank" ? "Bank Accounts" : "Cash Accounts",
  );
  XLSX.utils.book_append_sheet(workbook, makeSheet(example, headers), "Example");
  XLSX.utils.book_append_sheet(
    workbook,
    makeSheet([
      {
        Field: "Date format",
        Guidance: "Use YYYY-MM-DD, for example 2026-01-31. Do not use DD-MM-YYYY.",
      },
      { Field: "Branch", Guidance: "Must exactly match an existing branch name." },
      { Field: "Numbers", Guidance: "Use numbers only; do not include commas or the ₹ symbol." },
      ...(kind === "bank"
        ? [
            { Field: "Account Type", Guidance: "Allowed values: savings or current." },
            { Field: "Status", Guidance: "Allowed values: active or inactive." },
            {
              Field: "Required",
              Guidance:
                "Branch, Account Holder Name, Bank Name, Account Number, IFSC Code, Bank Branch Name, Opening Balance Date.",
            },
          ]
        : [
            {
              Field: "Required",
              Guidance:
                "Branch, Responsible Person, Responsible Person Mobile, Opening Balance Date.",
            },
          ]),
    ]),
    "Instructions",
  );
  downloadWorkbook(workbook, `${kind}-accounts-import-template.xlsx`);
}

export function parseAccountRows(
  kind: AccountKind,
  rawRows: AccountExcelRow[],
  branchIdByName: Map<string, string>,
) {
  return rawRows.map((row, index) => {
    const rowNumber = index + 2;
    const branchName = s(row.Branch);
    const branchId = branchIdByName.get(branchName.toLowerCase());
    if (!branchId) throw new Error(`Branch "${branchName}" was not found on row ${rowNumber}.`);
    const openingBalanceDate = excelDate(row["Opening Balance Date"]);
    if (!openingBalanceDate) throw new Error(`Opening Balance Date is required on row ${rowNumber}.`);
    if (kind === "bank") {
      const accountType = s(row["Account Type"]).toLowerCase() || "savings";
      const status = s(row.Status).toLowerCase() || "active";
      if (!["savings", "current"].includes(accountType))
        throw new Error(`Account Type is invalid on row ${rowNumber}.`);
      if (!["active", "inactive"].includes(status))
        throw new Error(`Status is invalid on row ${rowNumber}.`);
      const required = [
        "Account Holder Name",
        "Bank Name",
        "Account Number",
        "IFSC Code",
        "Bank Branch Name",
      ];
      const missing = required.find((field) => !s(row[field]));
      if (missing) throw new Error(`${missing} is required on row ${rowNumber}.`);
      return {
        branch_id: branchId,
        account_holder_name: s(row["Account Holder Name"]),
        bank_name: s(row["Bank Name"]),
        account_number: s(row["Account Number"]),
        ifsc_code: s(row["IFSC Code"]).toUpperCase(),
        bank_branch_name: s(row["Bank Branch Name"]),
        account_type: accountType,
        status,
        opening_date: excelDate(row["Opening Date"]) || null,
        opening_balance: num(row["Opening Balance"], "Opening Balance", rowNumber),
        opening_balance_date: openingBalanceDate,
      };
    }
    const required = ["Responsible Person", "Responsible Person Mobile"];
    const missing = required.find((field) => !s(row[field]));
    if (missing) throw new Error(`${missing} is required on row ${rowNumber}.`);
    return {
      branch_id: branchId,
      responsible_person: s(row["Responsible Person"]),
      responsible_person_mobile: s(row["Responsible Person Mobile"]),
      email: s(row.Email),
      address: s(row.Address),
      responsible_person_branch: s(row["Responsible Person Branch"]),
      opening_balance: num(row["Opening Balance"], "Opening Balance", rowNumber),
      opening_balance_date: openingBalanceDate,
    };
  });
}

export async function readAccountWorkbook(file: File) {
  const buffer = await file.arrayBuffer();
  return XLSX.read(buffer, { type: "array", cellDates: true });
}

export function accountSheetRows(workbook: XLSX.WorkBook, kind: AccountKind) {
  const sheetName = kind === "bank" ? "Bank Accounts" : "Cash Accounts";
  const sheet = workbook.Sheets[sheetName] ?? workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("The workbook does not contain an account sheet.");
  return XLSX.utils.sheet_to_json<AccountExcelRow>(sheet, { defval: "" });
}
