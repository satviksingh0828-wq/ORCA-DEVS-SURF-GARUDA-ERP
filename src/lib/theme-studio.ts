/**
 * ORCA Theme Studio v2
 * Uses the existing app_settings.theme TEXT column. Legacy theme IDs remain valid.
 * The v2 payload is deliberately bounded, validated and serializable.
 */
export const THEME_PROFILE_PREFIX = "orca-theme-v2:";

export const THEME_PRESETS = [
  { id: "garuda", name: "Current ORCA", description: "Original Garuda / Sentry appearance", swatch: "#8b1a2c", dark: false },
  { id: "ocean", name: "Ocean Blue", description: "Professional logistics blue", swatch: "#1e3a6e", dark: false },
  { id: "sky", name: "Azure Sky", description: "Bright corporate blue", swatch: "#2f7ed8", dark: false },
  { id: "emerald", name: "Emerald", description: "Operations green", swatch: "#12926f", dark: false },
  { id: "violet", name: "Royal Purple", description: "Modern purple", swatch: "#6d4bd8", dark: false },
  { id: "copper", name: "Copper Gold", description: "Industrial warm copper", swatch: "#8b5a2b", dark: false },
  { id: "graphite", name: "Minimal Graphite", description: "Neutral and distraction-free", swatch: "#4a4f57", dark: false },
  { id: "arctic", name: "Arctic Sky", description: "Cool teal and frost", swatch: "#2a8fa8", dark: false },
  { id: "midnight", name: "Midnight Blue", description: "Dark navy and blue", swatch: "#4a7fd8", dark: true },
  { id: "forest", name: "Dark Forest", description: "Dark green", swatch: "#22d870", dark: true },
  { id: "storm", name: "Charcoal", description: "Dark graphite and blue", swatch: "#3a6fd8", dark: true },
  { id: "neon", name: "Neon Terminal", description: "High-contrast dark green", swatch: "#39ff7a", dark: true },
] as const;

export type ThemeModule = "erp" | "ltms" | "wms" | "hrms" | "accounts";
export type ThemeColors = Partial<Record<"primary" | "primaryForeground" | "background" | "foreground" | "card" | "cardForeground" | "secondary" | "secondaryForeground" | "muted" | "mutedForeground" | "popover" | "popoverForeground" | "border" | "input" | "ring" | "sidebar" | "sidebarForeground" | "sidebarCard" | "sidebarAccent" | "sidebarAccentForeground" | "sidebarBorder" | "wmsAccent" | "videoHeading" | "videoText" | "videoMutedText" | "videoLink" | "videoLabel" | "videoPanelBackground" | "videoPanelText" | "footerBackground" | "footerForeground" | "footerAccent", string>>;
export type ThemeProfile = {
  version: 2;
  baseTheme: string;
  modules: Partial<Record<ThemeModule, string>>;
  colors: ThemeColors;
  /** Explicit per-tab video choices; absent keys use the secure default policy. */
  videoTabs: Record<string, boolean>;
  density: "comfortable" | "compact";
  radius: number | null;
};

export const DEFAULT_THEME_PROFILE: ThemeProfile = {
  version: 2,
  baseTheme: "garuda",
  modules: {},
  colors: {},
  videoTabs: {},
  density: "comfortable",
  radius: null,
};

const MODULES: ThemeModule[] = ["erp", "ltms", "wms", "hrms", "accounts"];
const COLOR_FIELDS = ["primary","primaryForeground","background","foreground","card","cardForeground","secondary","secondaryForeground","muted","mutedForeground","popover","popoverForeground","border","input","ring","sidebar","sidebarForeground","sidebarCard","sidebarAccent","sidebarAccentForeground","sidebarBorder","wmsAccent","videoHeading","videoText","videoMutedText","videoLink","videoLabel","videoPanelBackground","videoPanelText","footerBackground","footerForeground","footerAccent"] as const;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DARK_THEME_IDS = new Set(["neon", "midnight", "forest", "storm"]);

export function isDarkTheme(themeId: string): boolean {
  return DARK_THEME_IDS.has(themeId);
}

export function normalizeThemeProfile(raw: unknown, allowed: ReadonlySet<string>): ThemeProfile {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const baseTheme = typeof source.baseTheme === "string" && allowed.has(source.baseTheme)
    ? source.baseTheme
    : "garuda";
  const rawModules = source.modules && typeof source.modules === "object"
    ? source.modules as Record<string, unknown> : {};
  const modules: ThemeProfile["modules"] = {};
  for (const module of MODULES) {
    const value = rawModules[module];
    if (typeof value === "string" && allowed.has(value)) modules[module] = value;
  }
  const rawColors = source.colors && typeof source.colors === "object"
    ? source.colors as Record<string, unknown> : {};
  const colors: ThemeColors = {};
  for (const key of COLOR_FIELDS) {
    const value = rawColors[key];
    if (typeof value === "string" && HEX_COLOR.test(value)) colors[key] = value;
  }
  const rawVideoTabs = source.videoTabs && typeof source.videoTabs === "object" && !Array.isArray(source.videoTabs)
    ? source.videoTabs as Record<string, unknown> : {};
  const videoTabs: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(rawVideoTabs).slice(0, 80)) {
    if (/^[a-z0-9:/_-]{1,96}$/.test(key) && typeof value === "boolean") videoTabs[key] = value;
  }
  return {
    version: 2,
    baseTheme,
    modules,
    colors,
    videoTabs,
    density: source.density === "compact" ? "compact" : "comfortable",
    radius: typeof source.radius === "number" && Number.isFinite(source.radius)
      ? Math.max(0, Math.min(24, source.radius))
      : null,
  };
}

export function parseThemeProfile(raw: unknown, allowed: ReadonlySet<string>): ThemeProfile {
  if (typeof raw !== "string") return { ...DEFAULT_THEME_PROFILE };
  if (allowed.has(raw)) return { ...DEFAULT_THEME_PROFILE, baseTheme: raw };
  if (!raw.startsWith(THEME_PROFILE_PREFIX) || raw.length > 5000) {
    return { ...DEFAULT_THEME_PROFILE };
  }
  try {
    return normalizeThemeProfile(JSON.parse(raw.slice(THEME_PROFILE_PREFIX.length)), allowed);
  } catch {
    return { ...DEFAULT_THEME_PROFILE };
  }
}

export function serializeThemeProfile(profile: ThemeProfile): string {
  if (Object.keys(profile.modules).length === 0 &&
      Object.keys(profile.colors).length === 0 &&
      Object.keys(profile.videoTabs ?? {}).length === 0 &&
      profile.density === "comfortable" && profile.radius === null) {
    // Preserve compatibility with previous versions when no v2 customization is used.
    return profile.baseTheme;
  }
  return THEME_PROFILE_PREFIX + JSON.stringify(profile);
}

/** Resolve the visual module from real router paths. LTMS has several legacy
 * top-level routes, so checking only /ltms leaves most sidebars unthemed. */
export function themeModuleForPath(pathname: string): ThemeModule {
  const segment = pathname.toLowerCase().split("/")[1] ?? "";
  if (segment === "wms") return "wms";
  if (["accounts", "cash-reports"].includes(segment)) return "accounts";
  if (["hrms", "hr-dashboard", "hr-data", "dashboard", "employees", "payroll", "attendance"].includes(segment)) return "hrms";
  if (["ltms", "tms", "masters", "operations", "finance", "reports", "report-master", "import-trips"].includes(segment)) return "ltms";
  return "erp";
}

export function getModuleTheme(profile: ThemeProfile, module: ThemeModule): string {
  return profile.modules[module] || profile.baseTheme;
}

/** CSS custom-property map; includes both Tailwind semantic tokens and legacy Sentry/LTMS chrome. */
const COLOR_TOKENS: Record<keyof ThemeColors, readonly string[]> = {
  primary: ["--primary", "--primary-soft", "--primary-glow"],
  primaryForeground: ["--primary-foreground"],
  background: ["--background", "--ltms-surface"],
  foreground: ["--foreground", "--ltms-content-text"],
  card: ["--card", "--popover"],
  cardForeground: ["--card-foreground"],
  secondary: ["--secondary"],
  secondaryForeground: ["--secondary-foreground"],
  muted: ["--muted"],
  mutedForeground: ["--muted-foreground"],
  popover: ["--popover"],
  popoverForeground: ["--popover-foreground"],
  border: ["--border"],
  input: ["--input"],
  ring: ["--ring"],
  sidebar: ["--sidebar", "--ltms-chrome", "--wms-chrome"],
  sidebarForeground: ["--sidebar-foreground", "--ltms-chrome-text", "--wms-chrome-text"],
  sidebarCard: ["--ltms-chrome-card", "--wms-chrome-card"],
  sidebarAccent: ["--sidebar-accent", "--ltms-chrome-accent", "--wms-copper", "--ltms-branded"],
  sidebarAccentForeground: ["--sidebar-accent-foreground"],
  sidebarBorder: ["--sidebar-border"],
  wmsAccent: ["--wms-accent-override"],
};
const ROOT_OVERRIDES = [...new Set(Object.values(COLOR_TOKENS).flat().concat([
  "--sidebar-primary", "--sidebar-primary-foreground",
]))];

export function themeInlineStyles(profile: ThemeProfile): Record<string, string> {
  const result: Record<string, string> = {};
  const colors = profile.colors;
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value !== "string" || !HEX_COLOR.test(value)) continue;
    for (const token of COLOR_TOKENS[key as keyof ThemeColors] ?? []) {
      if (token === "--primary-soft") result[token] = `color-mix(in oklch, ${value} 14%, var(--card))`;
      else if (token === "--primary-glow") result[token] = `color-mix(in oklch, ${value} 65%, white)`;
      else result[token] = value;
    }
  }
  if (colors.primary && !colors.ring) result["--ring"] = colors.primary;
  if (colors.primary && !colors.sidebarAccent) result["--sidebar-primary"] = colors.primary;
  if (colors.primaryForeground && !colors.sidebarAccentForeground) {
    result["--sidebar-primary-foreground"] = colors.primaryForeground;
  }
  if (colors.foreground && !colors.cardForeground) result["--card-foreground"] = colors.foreground;
  if (colors.foreground && !colors.popoverForeground) result["--popover-foreground"] = colors.foreground;
  if (colors.border && !colors.input) result["--input"] = colors.border;
  if (profile.radius !== null) result["--radius"] = profile.radius + "px";
  return result;
}

export function applyThemeProfile(profile: ThemeProfile): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = profile.baseTheme;
  root.dataset.density = profile.density;
  const routeTheme = typeof window === "undefined" ? profile.baseTheme :
    getModuleTheme(profile, themeModuleForPath(window.location.pathname));
  root.classList.toggle("dark", isDarkTheme(routeTheme));
  for (const name of ROOT_OVERRIDES) root.style.removeProperty(name);
  root.style.removeProperty("--radius");
  for (const [key, value] of Object.entries(themeInlineStyles(profile))) root.style.setProperty(key, value);
}
