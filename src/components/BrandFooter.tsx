import { useTheme } from "@/lib/theme";

const DARK_THEMES = new Set(["neon", "midnight", "forest", "storm"]);

export function BrandFooter() {
  const { theme } = useTheme();
  const logo = DARK_THEMES.has(theme) ? "/orca-logo-light.svg" : "/orca-logo.svg";

  return (
    <footer className="relative z-10 shrink-0 border-t border-border bg-card/80 backdrop-blur">
      <div className="mx-auto flex w-full flex-col items-start justify-between gap-x-4 gap-y-1 px-4 py-2 text-[11px] sm:flex-row sm:items-center sm:px-6 sm:text-xs">
        <div className="flex items-center gap-2">
          <span className="uppercase tracking-wider text-muted-foreground">Powered by</span>
          <img src={logo} alt="ORCA logo" className="size-5 object-contain" />
          <span className="font-semibold tracking-wide text-foreground">ORCA DEVS SURF</span>
        </div>
        <div className="text-left text-muted-foreground sm:text-right">
          <span className="font-medium text-foreground">ERP:</span> Enterprise Resource Planning
        </div>
      </div>
    </footer>
  );
}
