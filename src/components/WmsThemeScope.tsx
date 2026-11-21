import type { CSSProperties, ReactNode } from "react";
import { useTheme } from "@/lib/theme";
import { isDarkTheme, moduleThemeInlineStyles } from "@/lib/theme-studio";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  className?: string;
  /** Legacy WMS pages use their own design tokens and CSS reset. ERP-native
   * settings pages must not inherit that reset or lose Tailwind spacing. */
  legacy?: boolean;
};

/** Single theme boundary for Sentry/WMS operations, settings and standalone UI. */
export function WmsThemeScope({ children, className, legacy = true }: Props) {
  const { profile, resolveModuleTheme } = useTheme();
  const selected = resolveModuleTheme("wms");
  return (
    <div
      className={cn(
        legacy ? "wms-embedded-scope" : "wms-native-theme-scope",
        isDarkTheme(selected) ? "dark" : "",
        className,
      )}
      data-theme={selected}
      data-custom-theme={Object.keys(profile.colors).length ? "true" : undefined}
      data-wms-theme-scope="true"
      style={moduleThemeInlineStyles(profile, "wms") as CSSProperties}
    >
      {children}
    </div>
  );
}
