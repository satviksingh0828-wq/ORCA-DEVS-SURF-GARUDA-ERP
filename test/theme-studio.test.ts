import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_THEME_PROFILE,
  THEME_PRESETS,
  getModuleTheme,
  isDarkTheme,
  normalizeThemeProfile,
  parseThemeProfile,
  serializeThemeProfile,
  themeInlineStyles,
  themeModuleForPath,
} from "../src/lib/theme-studio.ts";

const allowed = new Set(["garuda", "sky", "ocean", "neon", "midnight", "forest", "storm"]);

test("preserves the current app appearance as the initial default", () => {
  assert.equal(DEFAULT_THEME_PROFILE.baseTheme, "garuda");
  assert.equal(parseThemeProfile(null, allowed).baseTheme, "garuda");
  assert.equal(THEME_PRESETS[0].id, "garuda");
});

test("supports existing theme IDs without changing the Supabase schema", () => {
  const legacy = parseThemeProfile("sky", allowed);
  assert.equal(legacy.baseTheme, "sky");
  assert.equal(serializeThemeProfile(legacy), "sky");
});

test("round-trips module overrides and custom color values inside a text column", () => {
  const original = normalizeThemeProfile({
    baseTheme: "ocean",
    modules: { wms: "storm", ltms: "sky" },
    colors: { primary: "#123456", background: "#FAFAFA" },
    density: "compact",
    radius: 7,
  }, allowed);
  const stored = serializeThemeProfile(original);
  assert.ok(stored.startsWith("orca-theme-v2:"));
  const loaded = parseThemeProfile(stored, allowed);
  assert.deepEqual(loaded, original);
  assert.equal(getModuleTheme(loaded, "wms"), "storm");
  assert.equal(getModuleTheme(loaded, "accounts"), "ocean");
});

test("rejects malformed, oversized and unsafe theme payloads", () => {
  assert.equal(parseThemeProfile("orca-theme-v2:{", allowed).baseTheme, "garuda");
  assert.equal(parseThemeProfile("orca-theme-v2:" + "x".repeat(6000), allowed).baseTheme, "garuda");
  const sanitized = normalizeThemeProfile({
    baseTheme: "no-such-theme",
    modules: { wms: "invalid", hrms: "midnight" },
    colors: { primary: "url(javascript:alert(1))", card: "#ABCDEF" },
    radius: 500,
  }, allowed);
  assert.equal(sanitized.baseTheme, "garuda");
  assert.equal(sanitized.modules.wms, undefined);
  assert.equal(sanitized.modules.hrms, "midnight");
  assert.equal(sanitized.colors.primary, undefined);
  assert.equal(sanitized.colors.card, "#ABCDEF");
  assert.equal(sanitized.radius, 24);
});

test("dark-mode classification supports curated dark themes", () => {
  for (const id of ["neon", "midnight", "forest", "storm"]) assert.equal(isDarkTheme(id), true);
  assert.equal(isDarkTheme("garuda"), false);
});

test("customized sidebar and Sentry colours are mapped to both design systems", () => {
  const profile = normalizeThemeProfile({
    baseTheme: "ocean",
    colors: {
      sidebar: "#17263A",
      sidebarForeground: "#FFFFFF",
      sidebarCard: "#273A50",
      sidebarAccent: "#55A5ED",
      wmsAccent: "#FFB454",
      cardForeground: "#0A0B0C",
      mutedForeground: "#667788",
    },
  }, allowed);
  const css = themeInlineStyles(profile);
  assert.equal(css["--ltms-chrome"], "#17263A");
  assert.equal(css["--wms-chrome"], "#17263A");
  assert.equal(css["--ltms-chrome-text"], "#FFFFFF");
  assert.equal(css["--wms-chrome-card"], "#273A50");
  assert.equal(css["--ltms-chrome-accent"], "#55A5ED");
  assert.equal(css["--wms-accent-override"], "#FFB454");
  assert.equal(css["--card-foreground"], "#0A0B0C");
  assert.equal(css["--muted-foreground"], "#667788");
  assert.deepEqual(parseThemeProfile(serializeThemeProfile(profile), allowed), profile);
});

test("invalid sidebar colour values are rejected instead of becoming CSS", () => {
  const invalid = normalizeThemeProfile({ colors: { sidebar: "red; background:url(unsafe)", wmsAccent: "#135790" } }, allowed);
  assert.equal(themeInlineStyles(invalid)["--ltms-chrome"], undefined);
  assert.equal(themeInlineStyles(invalid)["--wms-accent-override"], "#135790");
});

test("every ERP route family gets the intended module theme", () => {
  for (const pathname of ["/ltms", "/ltms/operations", "/tms", "/masters", "/operations", "/reports", "/report-master", "/finance", "/import-trips"]) {
    assert.equal(themeModuleForPath(pathname), "ltms", pathname);
  }
  for (const pathname of ["/hrms", "/dashboard", "/hr-dashboard", "/employees", "/attendance", "/payroll"]) {
    assert.equal(themeModuleForPath(pathname), "hrms", pathname);
  }
  for (const pathname of ["/accounts", "/accounts/ledger", "/cash-reports"]) {
    assert.equal(themeModuleForPath(pathname), "accounts", pathname);
  }
  assert.equal(themeModuleForPath("/wms"), "wms");
  assert.equal(themeModuleForPath("/home"), "erp");
  assert.equal(themeModuleForPath("/settings"), "erp");
});
