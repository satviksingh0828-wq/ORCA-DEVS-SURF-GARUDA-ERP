// Startup canvas typography remains independent of the app header font.
export const LOGBOOK_WORDMARK = "LogBook";
export const LOGBOOK_FONT_FAMILY = "Arial, sans-serif";
export const LOGBOOK_FONT_WEIGHT = 900;

export function LogBookWordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`text-right text-[11px] font-semibold leading-tight sm:text-sm whitespace-nowrap ${className}`}
      style={{ color: "var(--ltms-chrome-text, #ffffff)", fontFamily: "inherit" }}
    >
      LogBook - ERP
    </span>
  );
}
