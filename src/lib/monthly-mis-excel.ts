import type { MisActivity, MisEntry, MisForm, MisReportRow } from "@/lib/monthly-mis";
import type { WorkBook } from "xlsx";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function misScheduleLabel(activity: MisActivity) {
  if (activity.schedule_type === "daily") return "Daily";
  if (activity.schedule_type === "weekly")
    return `Every ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][activity.schedule_value ?? 0]}`;
  if (activity.schedule_type === "twice_monthly")
    return `Twice monthly (${activity.schedule_value ?? 1} & ${activity.schedule_value_2 ?? 15})`;
  const day = activity.schedule_value ?? 1;
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  return `${day}${suffix}`;
}

function metrics(entries: MisEntry[]) {
  const today = new Date().toISOString().slice(0, 10);
  const due = entries.length;
  const done = entries.filter((entry) => entry.completed).length;
  const missed = entries.filter((entry) => !entry.completed && entry.due_date < today).length;
  return { due, done, missed, compliance: due ? done / due : 1 };
}

function calendarRows(
  form: Pick<MisForm, "branch_name" | "mis_month" | "activities" | "entries" | "status">,
) {
  const [year, monthNumber] = form.mis_month.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const totals = metrics(form.entries);
  const title = `MONTHLY MIS – DATE-WISE SUBMISSION CALENDAR — ${form.branch_name}`;
  const rows: (string | number)[][] = [
    [title],
    ["MONTHLY SUMMARY"],
    [
      "MIS Month",
      form.mis_month,
      "Status",
      form.status,
      "Total Due",
      totals.due,
      "Done",
      totals.done,
      "Missed",
      totals.missed,
      "Compliance",
      totals.compliance,
    ],
    [
      "Weekday",
      "",
      ...Array.from(
        { length: days },
        (_, index) => weekdays[new Date(Date.UTC(year, monthNumber - 1, index + 1)).getUTCDay()],
      ),
    ],
    [
      "MIS Activity",
      "Schedule",
      ...Array.from({ length: days }, (_, index) => index + 1),
      "Due",
      "Done",
      "Missed",
      "Compliance %",
    ],
  ];

  for (const activity of form.activities) {
    const entries = form.entries.filter((entry) => entry.activity_id === activity.id);
    const byDay = new Map(entries.map((entry) => [Number(entry.due_date.slice(-2)), entry]));
    const activityMetrics = metrics(entries);
    rows.push([
      activity.activity_name,
      misScheduleLabel(activity),
      ...Array.from({ length: days }, (_, index) => {
        const entry = byDay.get(index + 1);
        if (!entry) return "";
        return entry.completed
          ? "DONE"
          : entry.due_date < new Date().toISOString().slice(0, 10)
            ? "MISSED"
            : "DUE";
      }),
      activityMetrics.due,
      activityMetrics.done,
      activityMetrics.missed,
      activityMetrics.compliance,
    ]);
  }
  return { rows, days };
}

function safeSheetName(name: string, used: Set<string>) {
  const base =
    name
      .replace(/[\\/?*:]/g, " ")
      .replaceAll("[", " ")
      .replaceAll("]", " ")
      .slice(0, 31) || "Depot";
  let value = base;
  let suffix = 2;
  while (used.has(value)) value = `${base.slice(0, 27)} ${suffix++}`;
  used.add(value);
  return value;
}

async function appendCalendarSheet(
  workbook: WorkBook,
  form: Pick<MisForm, "branch_name" | "mis_month" | "activities" | "entries" | "status">,
  name: string,
) {
  const XLSX = await import("xlsx");
  const { rows, days } = calendarRows(form);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: days + 5 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: days + 5 } },
  ];
  sheet["!cols"] = [
    { wch: 42 },
    { wch: 18 },
    ...Array.from({ length: days }, () => ({ wch: 9 })),
    { wch: 9 },
    { wch: 9 },
    { wch: 9 },
    { wch: 15 },
  ];
  sheet["!freeze"] = { xSplit: 2, ySplit: 5 };
  for (let row = 5; row < rows.length; row += 1) {
    const complianceCell = sheet[XLSX.utils.encode_cell({ r: row, c: days + 5 })];
    if (complianceCell) complianceCell.z = "0.0%";
  }
  const summaryCompliance = sheet[XLSX.utils.encode_cell({ r: 2, c: 11 })];
  if (summaryCompliance) summaryCompliance.z = "0.0%";
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

export async function exportMisFormExcel(form: MisForm) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  await appendCalendarSheet(workbook, form, "Monthly MIS");
  XLSX.writeFile(workbook, `Monthly-MIS-${form.branch_name}-${form.mis_month}.xlsx`);
}

export async function exportMisDepotReportExcel(rows: MisReportRow[], month: string) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const summary = XLSX.utils.json_to_sheet(
    rows.map((row) => ({
      Depot: row.branch_name,
      "Submitted Date": row.submitted_at ?? "-",
      Status: row.status,
      Due: row.due,
      Done: row.done,
      Missed: row.missed,
      "Compliance %": row.compliance / 100,
      "Submitted At": row.submitted_at ?? "",
    })),
  );
  summary["!cols"] = [
    { wch: 28 },
    { wch: 24 },
    { wch: 12 },
    { wch: 9 },
    { wch: 9 },
    { wch: 9 },
    { wch: 16 },
    { wch: 24 },
  ];
  for (let row = 1; row <= rows.length; row += 1) {
    const cell = summary[XLSX.utils.encode_cell({ r: row, c: 6 })];
    if (cell) cell.z = "0.0%";
  }
  XLSX.utils.book_append_sheet(workbook, summary, "Depot Summary");
  const used = new Set(["Depot Summary"]);
  for (const row of rows) {
    if (!row.snapshot) continue;
    await appendCalendarSheet(
      workbook,
      {
        branch_name: row.branch_name,
        mis_month: row.mis_month,
        status: row.status,
        activities: row.snapshot.activities,
        entries: row.snapshot.entries,
      },
      safeSheetName(row.branch_name, used),
    );
  }
  XLSX.writeFile(workbook, `Monthly-MIS-Depot-Compliance-${month}.xlsx`);
}
