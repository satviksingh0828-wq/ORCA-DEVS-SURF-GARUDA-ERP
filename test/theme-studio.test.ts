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

import {
  videoEnabledForTab,
  videoTabFromPath,
  videoTabFromWmsPath,
  VIDEO_TAB_GROUPS,
} from "../src/lib/video-tabs.ts";

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


test("background video defaults on only for Login, Home, and passkey", () => {
  const defaults = {};
  for (const key of ["login", "home", "passkey"]) {
    assert.equal(videoEnabledForTab(defaults, key), true, key);
  }
  for (const key of ["settings:appearance", "settings:wms", "ltms:operations:trip", "wms:dashboard", "wms:inventory", "route:accounts"]) {
    assert.equal(videoEnabledForTab(defaults, key), false, key);
  }
  assert.equal(videoTabFromPath("/"), "login");
  assert.equal(videoTabFromPath("/home"), "home");
  assert.equal(videoTabFromPath("/wms"), "wms:dashboard");
  assert.equal(videoTabFromWmsPath("/data/bins"), "wms:data/bins");
});

test("video policy honours per-tab overrides and section inheritance", () => {
  const overrides = { "ltms:operations": true, "ltms:operations:trip": false, "wms:inventory": true, login: false };
  assert.equal(videoEnabledForTab(overrides, "ltms:operations:shipments"), true);
  assert.equal(videoEnabledForTab(overrides, "ltms:operations:trip"), false);
  assert.equal(videoEnabledForTab(overrides, "wms:inventory"), true);
  assert.equal(videoEnabledForTab(overrides, "login"), false);
  assert.equal(videoEnabledForTab(overrides, "wms:picking-batches"), false);
  assert.ok(VIDEO_TAB_GROUPS.flatMap((group) => group.options).some((option) => option.key === "wms:inventory"));
});

test("advanced video options round-trip in existing Supabase theme column", () => {
  const profile = normalizeThemeProfile({
    baseTheme: "garuda",
    videoTabs: { "wms:inventory": true, "ltms:operations:trip": false, home: true },
    videoTextShadow: "strong",
    videoTextWeight: "bold",
    videoPlayback: {
      startPaused: true,
      playbackRate: 1.5,
      pauseWhenHidden: false,
      respectReducedMotion: true,
      loopVideo: false,
      showPauseButton: true,
      videoDim: 12,
    },
    colors: { videoHeading: "#FFFFFF", footerBackground: "#F5F5F5", footerForeground: "#111111" },
  }, allowed);
  const saved = serializeThemeProfile(profile);
  assert.ok(saved.startsWith("orca-theme-v2:"));
  assert.deepEqual(parseThemeProfile(saved, allowed), profile);
  assert.equal(profile.videoPlayback.startPaused, true);
  assert.equal(profile.videoPlayback.playbackRate, 1.5);
  assert.equal(profile.videoPlayback.videoDim, 12);
});

test("unsafe video policy values are sanitized and legacy theme defaults remain unchanged", () => {
  const sanitized = normalizeThemeProfile({
    videoTabs: { "__proto__": true, "wms:inventory": "yes", "wms:receiving": true },
    videoPlayback: { playbackRate: 25, videoDim: 100, loopVideo: false },
  }, allowed);
  assert.equal(sanitized.videoTabs["wms:inventory"], undefined);
  assert.equal(sanitized.videoTabs["wms:receiving"], true);
  assert.equal(sanitized.videoPlayback.playbackRate, 2);
  assert.equal(sanitized.videoPlayback.videoDim, 15);
  assert.equal(sanitized.videoPlayback.loopVideo, false);
  const oldTheme = parseThemeProfile("ocean", allowed);
  assert.equal(oldTheme.videoPlayback.startPaused, false);
  assert.equal(oldTheme.videoPlayback.playbackRate, 1);
  assert.equal(oldTheme.videoTabs.login, undefined);
  assert.equal(serializeThemeProfile(oldTheme), "ocean");
});
