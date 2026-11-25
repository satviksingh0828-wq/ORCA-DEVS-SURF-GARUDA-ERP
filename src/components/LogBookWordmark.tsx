// Shared LogBook typography for startup canvas and static app headers.
export const LOGBOOK_WORDMARK = "LogBook";
export const LOGBOOK_FONT_FAMILY = "Arial, sans-serif";
export const LOGBOOK_FONT_WEIGHT = 900;

export function LogBookWordmark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      role="img"
      aria-label={LOGBOOK_WORDMARK}
      viewBox="0 0 962 192"
      style={{
        display: "block",
        width: "clamp(96px, 14vw, 150px)",
        maxWidth: "38%",
        height: "auto",
        color: "var(--ltms-chrome-text, #ffffff)",
        overflow: "visible",
      }}
    >
      <text
        x="481"
        y="94"
        textAnchor="middle"
        dominantBaseline="central"
        textLength="942.76"
        lengthAdjust="spacingAndGlyphs"
        fontFamily={LOGBOOK_FONT_FAMILY}
        fontWeight={LOGBOOK_FONT_WEIGHT}
        fontSize="199.68"
        fill="currentColor"
      >
        {LOGBOOK_WORDMARK}
      </text>
    </svg>
  );
}
