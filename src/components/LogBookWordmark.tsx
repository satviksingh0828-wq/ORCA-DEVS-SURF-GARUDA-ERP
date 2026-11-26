// Splash and screensaver typography remains independent of the app header font.
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

/** Shared, exact wordmark geometry for the liquid mask and static screensaver. */
export function LogBookSplashText({ fill }: { fill: string }) {
  return (
    <text x="481" y="145" textAnchor="middle" fontFamily={LOGBOOK_FONT_FAMILY}
      fontWeight={LOGBOOK_FONT_WEIGHT} fontSize="188" textLength="942.76"
      lengthAdjust="spacingAndGlyphs" fill={fill}>{LOGBOOK_WORDMARK}</text>
  );
}
