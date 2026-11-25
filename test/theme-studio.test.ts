import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_THEME_PROFILE,
  THEME_PRESETS,
  MATERIAL_THEME_PRESETS,
  getModuleTheme,
  isDarkTheme,
  normalizeThemeProfile,
  parseThemeProfile,
  serializeThemeProfile,
  themeInlineStyles,
  moduleThemeInlineStyles,
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

test("HRMS routes map to independently configurable video tabs", () => {
  const cases = {
    "/hrms": "hrms:employees",
    "/employees": "hrms:employees",
    "/employees/departments": "hrms:employees:departments",
    "/attendance/holidays": "hrms:attendance:holidays",
    "/attendance/history": "hrms:attendance:history",
    "/payroll/loans": "hrms:payroll:loans",
    "/dashboard/attendance": "hrms:dashboard:attendance",
    "/hr-dashboard": "hrms:dashboard",
    "/hr-data": "hrms:data",
  };
  for (const [pathname, expected] of Object.entries(cases)) {
    assert.equal(videoTabFromPath(pathname), expected);
  }
  const tabGroups = VIDEO_TAB_GROUPS.find((group) => group.title.startsWith("HRMS"));
  assert.ok(tabGroups);
  assert.ok(tabGroups.options.length > 15);
  const policy = { "hrms": true, "hrms:payroll": false, "hrms:payroll:loans": true };
  assert.equal(videoEnabledForTab(policy, "hrms:attendance:holidays"), true);
  assert.equal(videoEnabledForTab(policy, "hrms:payroll:loans"), true);
  assert.equal(videoEnabledForTab(policy, "hrms:payroll:history"), false);
  assert.equal(videoEnabledForTab({}, "hrms:payroll"), false);
});

test("background mode and advanced video effects survive existing text-column storage", () => {
  for (const mode of ["video", "still", "blank"]) {
    const saved = normalizeThemeProfile({
      baseTheme: "ocean",
      videoPlayback: {
        backgroundMode: mode,
        blur: 12, tintColor: "#3155aa", tintOpacity: 36,
        brightness: 110, saturation: 70, contrast: 125,
        grayscale: 20, hueRotate: -45, zoom: 115,
      },
      videoTabs: { hrms: true, "hrms:payroll:loans": false },
    }, allowed);
    assert.equal(saved.videoPlayback.backgroundMode, mode);
    assert.equal(saved.videoPlayback.blur, 12);
    assert.equal(saved.videoPlayback.tintColor, "#3155aa");
    assert.equal(saved.videoPlayback.grayscale, 20);
    assert.equal(saved.videoPlayback.hueRotate, -45);
    assert.deepEqual(parseThemeProfile(serializeThemeProfile(saved), allowed), saved);
  }
});

test("invalid video filter options are bounded and obsolete banner settings discarded", () => {
  const saved = normalizeThemeProfile({
    videoPlayback: {
      backgroundMode: "unknown", showTruckPoster: true,
      blur: 999, tintColor: "url(javascript:bad)", tintOpacity: 999,
      brightness: -40, saturation: 777, contrast: 1000,
      grayscale: -2, hueRotate: 999, zoom: 500,
    },
  }, allowed);
  const p = saved.videoPlayback;
  assert.equal(p.backgroundMode, "video");
  assert.equal(p.blur, 24);
  assert.equal(p.tintColor, "#000000");
  assert.equal(p.tintOpacity, 80);
  assert.equal(p.brightness, 40);
  assert.equal(p.saturation, 200);
  assert.equal(p.contrast, 160);
  assert.equal(p.grayscale, 0);
  assert.equal(p.hueRotate, 180);
  assert.equal(p.zoom, 130);
  assert.equal("showTruckPoster" in p, false);
});

test("no poster or Garuda banner is rendered by the video backdrop", async () => {
  const fs = await import("node:fs");
  for (const path of ["src/components/WorkspaceBackgroundVideo.tsx", "src/styles.css"]) {
    const source = fs.readFileSync(path, "utf8");
    assert.doesNotMatch(source, /garuda-banner\\.(?:webp|jpeg|jpg|png)/i, path);
  }
  const backdrop = fs.readFileSync("src/components/WorkspaceBackgroundVideo.tsx", "utf8");
  assert.doesNotMatch(backdrop, /poster\\s*=/i);
  assert.match(backdrop, /onLoadedMetadata/);
});

test("Home icon size keeps the previous 28px default and round-trips across devices", () => {
  const previous = parseThemeProfile("garuda", allowed);
  assert.equal(previous.homeIconSize, 28);
  assert.equal(serializeThemeProfile(previous), "garuda");
  for (const size of [16, 20, 28, 44, 64]) {
    const configured = normalizeThemeProfile({ baseTheme: "ocean", homeIconSize: size }, allowed);
    assert.equal(configured.homeIconSize, size);
    const reloaded = parseThemeProfile(serializeThemeProfile(configured), allowed);
    assert.equal(reloaded.homeIconSize, size);
  }
  assert.equal(normalizeThemeProfile({ homeIconSize: 1 }, allowed).homeIconSize, 16);
  assert.equal(normalizeThemeProfile({ homeIconSize: 999 }, allowed).homeIconSize, 64);
  assert.equal(normalizeThemeProfile({ homeIconSize: Number.NaN }, allowed).homeIconSize, 28);
  assert.equal(normalizeThemeProfile({ homeIconSize: "52" }, allowed).homeIconSize, 28);
});

test("WMS module override uses isolated readable light/dark surfaces", () => {
  const light = normalizeThemeProfile({
    baseTheme: "midnight",
    modules: { wms: "ocean" },
  }, allowed);
  const lightCss = moduleThemeInlineStyles(light, "wms");
  assert.equal(lightCss["--background"], "#fafaf7");
  assert.equal(lightCss["--foreground"], "#1a1714");
  assert.equal(lightCss["--card"], "#ffffff");
  const dark = normalizeThemeProfile({
    baseTheme: "garuda",
    modules: { wms: "midnight" },
    colors: { primary: "#123456", foreground: "#eeeeee" },
  }, allowed);
  const darkCss = moduleThemeInlineStyles(dark, "wms");
  assert.equal(darkCss["--background"], "#121821");
  assert.equal(darkCss["--foreground"], "#eeeeee");
  assert.equal(darkCss["--primary"], "#123456");
  const unchanged = moduleThemeInlineStyles(normalizeThemeProfile({baseTheme: "garuda"}, allowed), "wms");
  assert.equal(unchanged["--background"], undefined);
});

test("every embedded WMS Settings surface uses the shared theme boundary", async () => {
  const fs = await import("node:fs");
  const settings = fs.readFileSync("src/components/WmsSystemSettings.tsx", "utf8");
  const layout = fs.readFileSync("src/wms/components/Layout.jsx", "utf8");
  const standalone = fs.readFileSync("src/components/WmsStandalone.tsx", "utf8");
  const boundary = fs.readFileSync("src/components/WmsThemeScope.tsx", "utf8");
  const home = fs.readFileSync("src/routes/home.tsx", "utf8");
  const studio = fs.readFileSync("src/components/settings/AppearanceStudio.tsx", "utf8");
  assert.match(settings, /<WmsThemeScope/);
  assert.match(settings, /activeTabId !== "user-access"/);
  assert.match(layout, /<WmsThemeScope/);
  assert.match(standalone, /<WmsThemeScope/);
  assert.match(boundary, /moduleThemeInlineStyles\(profile, "wms"\)/);
  assert.match(boundary, /legacy \? "wms-embedded-scope" : "wms-native-theme-scope"/);
  assert.match(home, /profile\.homeIconSize/);
  assert.match(studio, /Home module icon size/);
});


test("all 41 new material presets round-trip and retain their dark classification", () => {
  assert.equal(MATERIAL_THEME_PRESETS.length, 41);
  const ids = new Set<string>(THEME_PRESETS.map(item => item.id));
  assert.equal(ids.size, 69);
  for (const item of MATERIAL_THEME_PRESETS) {
    const parsed = parseThemeProfile(item.id, ids);
    assert.equal(serializeThemeProfile(parsed), item.id);
    assert.equal(isDarkTheme(item.id), item.dark);
    const scoped = normalizeThemeProfile({baseTheme:"garuda", modules:{wms:item.id}}, ids);
    assert.equal(getModuleTheme(scoped,"wms"),item.id);
    assert.equal(moduleThemeInlineStyles(scoped,"wms")["--background"],undefined);
  }
});


test("all selectable themes have splash CSS palette and wooden texture coverage", async () => {
  const fs = await import("node:fs");
  const css = fs.readFileSync("src/styles.css", "utf8");
  const splash = fs.readFileSync("src/components/SplashScreen.tsx", "utf8");
  const root = css.match(/(?:^|\n):root\s*\{([^}]+)\}/)?.[1] ?? "";
  const token = (source: string, key: string) => source.match(new RegExp("--" + key + ":\\s*([^;]+);"))?.[1].trim();
  assert.equal(THEME_PRESETS.length, 69);
  for (const item of THEME_PRESETS) {
    const block = css.match(new RegExp('\\[data-theme="' + item.id + '"\\]\\s*\\{([^}]+)\\}'))?.[1];
    assert.ok(block, item.id);
    for (const key of ["background","foreground","primary"]) assert.ok(token(block,key) || token(root,key), item.id + " " + key);
  }
  for (const item of MATERIAL_THEME_PRESETS) {
    const block = css.match(new RegExp('\\[data-theme="' + item.id + '"\\]\\s*\\{([^}]+)\\}'))?.[1] ?? "";
    for (const key of ["background","foreground","primary"] as const) assert.equal(token(block,key),item.colors[key],item.id);
    if (item.group === "Wood") assert.ok(token(block,"logbook-theme-texture"),item.id);
  }
  assert.match(splash, /fillColor = themeProfile \? "var\(--primary\)"/);
  assert.match(splash, /moduleThemeInlineStyles\(themeProfile, "erp"\)/);
  assert.match(splash, /<mask id=\{maskId\}/);
});


test("live theme preview is independent from stored appearance", async () => {
  const fs = await import("node:fs");
  const provider = fs.readFileSync("src/lib/theme.tsx", "utf8");
  const studio = fs.readFileSync("src/components/settings/AppearanceStudio.tsx", "utf8");
  assert.match(provider, /const profile = temporaryProfile \?\? savedProfile/);
  const preview = provider.slice(provider.indexOf("const previewProfile = useCallback"), provider.indexOf("const previewProfile = useCallback") + 250);
  assert.match(preview, /setTemporaryProfile/);
  assert.doesNotMatch(preview, /cacheProfile\(|saveSettings\(|localStorage\./);
  assert.match(studio, /previewProfile\(dirty && ready \? draft : null\)/);
  assert.match(studio, /\(\) => \(\) => previewProfile\(null\)/);
});
