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
export type ThemeColors = Partial<Record<"primary" | "background" | "foreground" | "card" | "border", string>>;
export type ThemeProfile = {
  version: 2;
  baseTheme: string;
  modules: Partial<Record<ThemeModule, string>>;
  colors: ThemeColors;
  density: "comfortable" | "compact";
  radius: number | null;
};

export const DEFAULT_THEME_PROFILE: ThemeProfile = {
  version: 2,
  baseTheme: "garuda",
  modules: {},
  colors: {},
  density: "comfortable",
  radius: null,
};

const MODULES: ThemeModule[] = ["erp", "ltms", "wms", "hrms", "accounts"];
const COLOR_FIELDS = ["primary", "background", "foreground", "card", "border"] as const;
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
  return {
    version: 2,
    baseTheme,
    modules,
    colors,
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
      profile.density === "comfortable" && profile.radius === null) {
    // Preserve compatibility with previous versions when no v2 customization is used.
    return profile.baseTheme;
  }
  return THEME_PROFILE_PREFIX + JSON.stringify(profile);
}

export function getModuleTheme(profile: ThemeProfile, module: ThemeModule): string {
  return profile.modules[module] || profile.baseTheme;
}

const ROOT_OVERRIDES = [
  "--primary", "--primary-soft", "--primary-glow", "--ring", "--sidebar-primary",
  "--background", "--foreground", "--card", "--card-foreground",
  "--popover", "--popover-foreground", "--border", "--input", "--radius",
] as const;

export function applyThemeProfile(profile: ThemeProfile): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = profile.baseTheme;
  root.dataset.density = profile.density;
  root.classList.toggle("dark", isDarkTheme(profile.baseTheme));
  for (const name of ROOT_OVERRIDES) root.style.removeProperty(name);
  const { primary, background, foreground, card, border } = profile.colors;
  if (primary) {
    root.style.setProperty("--primary", primary);
    root.style.setProperty("--primary-soft", `color-mix(in oklch, ${primary} 14%, var(--card))`);
    root.style.setProperty("--primary-glow", `color-mix(in oklch, ${primary} 65%, white)`);
    root.style.setProperty("--ring", primary);
    root.style.setProperty("--sidebar-primary", primary);
  }
  if (background) root.style.setProperty("--background", background);
  if (foreground) root.style.setProperty("--foreground", foreground);
  if (card) {
    root.style.setProperty("--card", card);
    root.style.setProperty("--popover", card);
  }
  if (foreground) {
    root.style.setProperty("--card-foreground", foreground);
    root.style.setProperty("--popover-foreground", foreground);
  }
  if (border) {
    root.style.setProperty("--border", border);
    root.style.setProperty("--input", border);
  }
  if (profile.radius !== null) root.style.setProperty("--radius", profile.radius + "px");
}
