/**
 * Add calendar months without allowing an invalid day-of-month to overflow
 * into the following month.
 *
 * A schedule that starts on the last day of a month remains month-end based:
 * 31 January -> 28 February -> 31 March. For other start days, the day is
 * preserved when possible and clamped only when the target month is shorter.
 */
export function addMonthsMonthEndSafe(dateStr: string, months: number): string {
  if (!dateStr) return "";

  const [yearText, monthText, dayText] = dateStr.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1
  ) {
    return "";
  }

  const startMonthLastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const isMonthEnd = day === startMonthLastDay;
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const targetMonthLastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = isMonthEnd ? targetMonthLastDay : Math.min(day, targetMonthLastDay);

  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}
