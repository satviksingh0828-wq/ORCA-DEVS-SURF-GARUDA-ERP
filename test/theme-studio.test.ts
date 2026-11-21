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
