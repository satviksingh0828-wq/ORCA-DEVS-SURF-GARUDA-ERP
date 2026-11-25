import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { Check, Download, Layers3, Loader2, Palette, RotateCcw, Truck, Warehouse, Settings2, Upload } from "lucide-react";
import { toast } from "sonner";
import { THEMES, useTheme } from "@/lib/theme";
import { VIDEO_TAB_GROUPS, videoEnabledForTab } from "@/lib/video-tabs";
import {
  DEFAULT_THEME_PROFILE,
  THEME_PRESETS,
  materialTheme,
  getModuleTheme,
  isDarkTheme,
  normalizeThemeProfile,
  type ThemeColors,
  type ThemeModule,
  type ThemeProfile,
} from "@/lib/theme-studio";

const MODULES: Array<{ key: ThemeModule; label: string; description: string }> = [
  { key: "erp", label: "ERP & general", description: "Home, masters, settings and operations" },
  { key: "ltms", label: "LTMS", description: "Trips, consignments, billing and reporting" },
  { key: "wms", label: "Sentry / WMS", description: "Inventory, picking, receiving and bins" },
  { key: "hrms", label: "HRMS", description: "Employees, attendance and payroll" },
  { key: "accounts", label: "Accounts", description: "Ledger, journals and finance" },
];
const COLOR_GROUPS: Array<{
  title: string; description: string;
  fields: Array<{ key: keyof ThemeColors; label: string }>;
}> = [
  {
    title: "Brand and workspace", description: "Primary actions, readable text and overall page colours.",
    fields: [
      { key: "primary", label: "Primary / brand" }, { key: "primaryForeground", label: "Button text" },
      { key: "background", label: "Page background" }, { key: "foreground", label: "Page text" },
      { key: "ring", label: "Keyboard focus ring" },
    ],
  },
  {
    title: "Cards, menus and surfaces", description: "Cards, dropdowns, popovers, muted panels and supporting text.",
    fields: [
      { key: "card", label: "Card surface" }, { key: "cardForeground", label: "Card text" },
      { key: "popover", label: "Popup / dropdown" }, { key: "popoverForeground", label: "Popup text" },
      { key: "secondary", label: "Secondary surface" }, { key: "secondaryForeground", label: "Secondary text" },
      { key: "muted", label: "Muted surface" }, { key: "mutedForeground", label: "Muted text" },
      { key: "border", label: "Borders" }, { key: "input", label: "Input backgrounds / lines" },
    ],
  },
  {
    title: "Sidebars and top bars", description: "Shared navigation colours used by LTMS, Accounts, HRMS and Sentry/WMS.",
    fields: [
      { key: "sidebar", label: "Sidebar / header" },
      { key: "sidebarForeground", label: "Sidebar text" },
      { key: "sidebarCard", label: "Sidebar section cards" },
      { key: "sidebarAccent", label: "Selected navigation" },
      { key: "sidebarAccentForeground", label: "Selected text" },
      { key: "sidebarBorder", label: "Sidebar divider" },
      { key: "wmsAccent", label: "WMS action accent" },
    ],
  },
  {
    title: "Text displayed directly over video",
    description: "Choose readable headings, captions, buttons, labels and links without blurring the footage.",
    fields: [
      { key: "videoHeading", label: "Video headings" },
      { key: "videoText", label: "Video body text" },
      { key: "videoMutedText", label: "Video captions / secondary text" },
      { key: "videoLink", label: "Links over footage" },
      { key: "videoLabel", label: "Labels / icons over footage" },
      { key: "videoPanelBackground", label: "Video form panel background" },
      { key: "videoPanelText", label: "Text inside video form panels" },
    ],
  },
  {
    title: "Footer and credits",
    description: "Theme the login, Home and passkey footers and the Powered by ORCA credit text.",
    fields: [
      { key: "footerBackground", label: "Footer background" },
      { key: "footerForeground", label: "Footer text / links" },
      { key: "footerAccent", label: "Footer top border" },
    ],
  },
];
const themeNames = new Map<string, string>(THEMES.map((item) => [item.id, item.label]));
const allowedThemes = new Set(THEMES.map((item) => item.id));
const presetIds = new Set<string>(THEME_PRESETS.map((item) => item.id));

function currentColor(theme: ThemeProfile, key: keyof ThemeColors): string {
  const palette = materialTheme(theme.baseTheme)?.colors;
  if (palette && key in palette) return palette[key as keyof typeof palette];
  const dark = isDarkTheme(theme.baseTheme);
  const accent = THEME_PRESETS.find((item) => item.id === theme.baseTheme)?.swatch ?? "#8b1a2c";
  const fg = dark ? "#f1f5f9" : "#1a1714";
  const bg = dark ? "#151923" : "#fafaf7";
  const card = dark ? "#222a35" : "#ffffff";
  const sidebar = dark ? "#111a29" : "#2a2520";
  const foregroundOnPrimary = theme.baseTheme === "neon" || theme.baseTheme === "forest" ? "#0b1720" : "#ffffff";
  const defaults: Record<keyof ThemeColors, string> = {
    primary: accent, primaryForeground: foregroundOnPrimary,
    background: bg, foreground: fg,
    card, cardForeground: fg,
    secondary: dark ? "#2b3340" : "#f0f2f5",
    secondaryForeground: fg,
    muted: dark ? "#252d3a" : "#f4f4f2",
    mutedForeground: dark ? "#b5bece" : "#69717e",
    popover: card, popoverForeground: fg,
    border: dark ? "#3b4656" : "#e8e2d8",
    input: dark ? "#323b49" : "#e8e2d8",
    ring: accent,
    sidebar, sidebarForeground: "#fdf4e3",
    sidebarCard: dark ? "#263142" : "#352f2a",
    sidebarAccent: accent, sidebarAccentForeground: "#ffffff",
    sidebarBorder: dark ? "#364355" : "#4e4841",
    wmsAccent: accent,
    videoHeading: "#FFFFFF", videoText: "#FFFFFF", videoMutedText: "#E2E8F0",
    videoLink: "#B8E2FF", videoLabel: "#FFFFFF",
    videoPanelBackground: card, videoPanelText: fg,
    footerBackground: sidebar, footerForeground: "#FDF4E3", footerAccent: accent,
  };
  return defaults[key];
}
function luminance(hex: string) {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  return channels.map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
}
function contrast(first: string, second: string) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function AppearanceStudio() {
  const { savedProfile: profile, previewProfile, updateProfile, saving, ready, backgroundVideoUrl, backgroundVideoEnabled } = useTheme();
  const [draft, setDraft] = useState<ThemeProfile>(profile);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const [previewPaused, setPreviewPaused] = useState(false);
  useEffect(() => {
    setPreviewPaused(draft.videoPlayback.backgroundMode !== "video");
  }, [draft.videoPlayback.backgroundMode]);
  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video) return;
    video.playbackRate = draft.videoPlayback.playbackRate;
    if (previewPaused || draft.videoPlayback.backgroundMode === "blank") video.pause();
    else void video.play().catch(() => undefined);
  }, [previewPaused, draft.videoPlayback.playbackRate, draft.videoPlayback.backgroundMode, backgroundVideoUrl]);
  const previousSaved = useRef(profile);
  useEffect(() => {
    const previous = previousSaved.current;
    previousSaved.current = profile;
    setDraft((current) => JSON.stringify(current) === JSON.stringify(previous) ? profile : current);
  }, [profile]);
  const dirty = JSON.stringify(normalizeThemeProfile(draft, allowedThemes)) !== JSON.stringify(normalizeThemeProfile(profile, allowedThemes));
  useEffect(() => {
    previewProfile(dirty && ready ? draft : null);
  }, [draft, dirty, ready, previewProfile]);
  useEffect(() => () => previewProfile(null), [previewProfile]);
  const preview = useMemo(() => {
    const get = (key: keyof ThemeColors) => draft.colors[key] || currentColor(draft, key);
    return {
      background: get("background"), foreground: get("foreground"),
      card: get("card"), cardForeground: get("cardForeground"),
      border: get("border"), primary: get("primary"), primaryForeground: get("primaryForeground"),
      sidebar: get("sidebar"), sidebarForeground: get("sidebarForeground"),
      sidebarCard: get("sidebarCard"), sidebarAccent: get("sidebarAccent"),
      muted: get("muted"),
    };
  }, [draft]);
  const readability = contrast(preview.foreground, preview.background);
  const cardReadability = contrast(preview.cardForeground, preview.card);
  const sidebarReadability = contrast(preview.sidebarForeground, preview.sidebar);
  const footerReadability = contrast(
    draft.colors.footerForeground || currentColor(draft, "footerForeground"),
    draft.colors.footerBackground || currentColor(draft, "footerBackground"),
  );
  const videoPanelReadability = contrast(
    draft.colors.videoPanelText || currentColor(draft, "videoPanelText"),
    draft.colors.videoPanelBackground || currentColor(draft, "videoPanelBackground"),
  );
  const accessible = readability >= 4.5 && cardReadability >= 4.5 &&
    sidebarReadability >= 4.5 && footerReadability >= 4.5 && videoPanelReadability >= 4.5;
  const activeName = themeNames.get(draft.baseTheme) ?? "Current ORCA";
  const enabledVideoTabs = VIDEO_TAB_GROUPS.flatMap((group) => group.options)
    .filter((option) => videoEnabledForTab(draft.videoTabs, option.key)).length;
  const getVideoColor = (key: keyof ThemeColors) => draft.colors[key] ?? currentColor(draft, key);
  const previewVideoTextStyle = {
    textShadow: draft.videoTextShadow === "none" ? "none"
      : draft.videoTextShadow === "strong"
        ? "0 2px 4px rgba(0,0,0,.92), 0 0 10px rgba(0,0,0,.56)"
        : "0 1px 3px rgba(0,0,0,.82)",
    fontWeight: draft.videoTextWeight === "bold" ? 700 : draft.videoTextWeight === "regular" ? 400 : 500,
  } as const;
  function setVideoTab(key: string, enabled: boolean) {
    setDraft((current) => ({
      ...current,
      videoTabs: { ...current.videoTabs, [key]: enabled },
    }));
  }

  async function save() {
    try {
      const submitted = normalizeThemeProfile(draft, allowedThemes);
      await updateProfile(submitted);
      setDraft((current) => JSON.stringify(normalizeThemeProfile(current, allowedThemes)) === JSON.stringify(submitted) ? submitted : current);
      toast.success("Appearance saved to the existing Supabase theme setting.");
    } catch {
      toast.error("Could not save appearance. Your unsaved live preview remains active; retry when connected.");
    }
  }
  function chooseTheme(id: string) {
    setDraft((previous) => ({ ...previous, baseTheme: id, modules: {}, colors: {} }));
  }
  function setModule(module: ThemeModule, id: string) {
    setDraft((previous) => {
      const modules = { ...previous.modules };
      if (id) modules[module] = id;
      else delete modules[module];
      return { ...previous, modules };
    });
  }
  function setColor(key: keyof ThemeColors, color: string) {
    setDraft((previous) => ({ ...previous, colors: { ...previous.colors, [key]: color } }));
  }
  function clearColor(key: keyof ThemeColors) {
    setDraft((previous) => {
      const colors = { ...previous.colors };
      delete colors[key];
      return { ...previous, colors };
    });
  }
  function exportTheme() {
    const json = JSON.stringify(draft, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "orca-appearance-theme.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  async function importTheme(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > 30_000) return toast.error("Theme files must be under 30 KB.");
    try {
      const value = JSON.parse(await file.text());
      if (!value || typeof value !== "object" || !("baseTheme" in value)) throw new Error("Invalid theme file");
      setDraft(normalizeThemeProfile(value, allowedThemes));
      toast.success("Theme imported into preview. Select Save to publish it.");
    } catch {
      toast.error("Could not read this theme JSON file.");
    }
  }

  return (
    <div className="animate-fade-up space-y-5">
      <section className="surface-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-primary-soft p-3 text-primary"><Palette className="size-5" /></span>
            <div>
              <h2 className="text-lg font-semibold">ORCA Appearance Studio</h2>
              <p className="mt-1 text-sm text-muted-foreground">Select a theme to preview it across the application immediately. Only Save publishes it to the workspace and device cache.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={exportTheme} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs hover:bg-muted"><Download className="size-4"/>Export</button>
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs hover:bg-muted"><Upload className="size-4"/>Import</button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(event) => void importTheme(event)} />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">Current saved: {themeNames.get(profile.baseTheme) ?? profile.baseTheme}</span>
          <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{ready ? "Device cache + cloud synchronization enabled" : "Loading saved appearance…"}</span>
          {dirty && <span className="rounded-md bg-primary-soft px-2 py-1 text-xs font-medium text-primary">Live app preview · not saved</span>}
          {dirty && <div className="ml-auto flex flex-wrap items-center gap-2"><button type="button" onClick={() => { setDraft(profile); previewProfile(null); }} disabled={saving} className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-50">Discard preview</button><button type="button" onClick={() => void save()} disabled={saving || !ready || !accessible} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">{saving ? "Saving..." : "Save workspace theme"}</button></div>}
        </div>
      </section>

      <section className="surface-card p-5 sm:p-6">
        <h3 className="text-sm font-semibold">Choose an application theme</h3>
        <p className="mb-4 mt-1 text-xs text-muted-foreground">Selecting a global preset previews the whole app immediately and resets module overrides in the draft. You can set individual module themes again below. Nothing is saved until you publish.</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {THEME_PRESETS.map((item) => {
            const active = draft.baseTheme === item.id;
            const palette = materialTheme(item.id)?.colors;
            return (
              <button key={item.id} type="button" onClick={() => chooseTheme(item.id)} aria-pressed={active}
                className={`relative overflow-hidden rounded-xl border p-3 text-left transition-colors hover:border-primary/70 ${active ? "border-primary ring-2 ring-primary/20" : "border-border"}`}>
                <div className="mb-3 h-16 rounded-lg p-2" data-theme={item.id} style={{ backgroundColor: palette?.background ?? (item.dark ? "#151c27" : "#f8f9fb"), backgroundImage: "var(--logbook-theme-texture, none)", color: palette?.foreground ?? (item.dark ? "#f2f6fc" : "#273142") }}>
                  <div className="flex h-full gap-2">
                    <div className="w-5 shrink-0 rounded" style={{ backgroundColor: palette?.sidebar ?? item.swatch, backgroundImage: "var(--logbook-theme-texture, none)" }} />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-2 w-4/5 rounded-sm" style={{ background: palette?.primary ?? (item.dark ? "#576273" : "#ccd3db") }}/>
                      <div className="h-3 rounded-sm" style={{ background: palette?.card ?? (item.dark ? "#344051" : "#e3e7eb") }}/>
                      <div className="h-3 rounded-sm" style={{ background: palette?.card ?? (item.dark ? "#344051" : "#e3e7eb") }}/>
                    </div>
                  </div>
                </div>
                <div className="flex items-start justify-between gap-1">
                  <span className="text-xs font-semibold">{item.name}</span>
                  {active && <Check className="size-4 shrink-0 text-primary"/>}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{item.description}</p>
              </button>
            );
          })}
        </div>
        {!presetIds.has(draft.baseTheme) && <p className="mt-3 text-xs text-muted-foreground">Legacy theme “{activeName}” is still supported. Choose a new preset to update it.</p>}
      </section>

      <section className="surface-card p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <Layers3 className="size-4 text-primary"/>
          <h3 className="text-sm font-semibold">Module-specific themes</h3>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">By default every module inherits the workspace theme. Give a module its own preset only when required.</p>
        <div className="grid gap-3 md:grid-cols-2">
          {MODULES.map((module) => (
            <label key={module.key} className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/20 p-3">
              <span className="text-sm font-medium">{module.label}</span>
              <span className="text-xs text-muted-foreground">{module.description}</span>
              <select value={draft.modules[module.key] || ""} onChange={(event) => setModule(module.key, event.target.value)}
                className="mt-1 h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground">
                <option value="">Inherit global ({activeName})</option>
                {THEME_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          ))}
        </div>
      </section>

      <section className="surface-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Home module icon size</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Change the icon size of every Home module tile, including LTMS, HRMS,
              Sentry/WMS and Settings. Labels keep their normal size; icon frames
              automatically grow so larger icons are never clipped.
            </p>
          </div>
          <span className="rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-sm font-semibold tabular-nums">
            {draft.homeIconSize}px
          </span>
        </div>
        <label htmlFor="home-icon-size" className="mt-5 flex justify-between text-xs font-medium text-foreground">
          <span>Smaller icons</span><span>Larger icons</span>
        </label>
        <input id="home-icon-size" type="range" min={16} max={64} step={2}
          value={draft.homeIconSize}
          onChange={(event) => setDraft((previous) => ({
            ...previous,
            homeIconSize: Number(event.target.value),
          }))}
          className="mt-2 w-full accent-primary"
          aria-label="Home module icon size"/>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {([
            ["Small", 20],
            ["Default", 28],
            ["Large", 44],
            ["Extra large", 64],
          ] as const).map(([name, size]) => (
            <button type="button" key={name}
              aria-pressed={draft.homeIconSize === size}
              onClick={() => setDraft((previous) => ({ ...previous, homeIconSize: size }))}
              className={`rounded-lg border px-3 py-1.5 text-xs transition-colors hover:border-primary
                ${draft.homeIconSize === size ? "border-primary bg-primary-soft text-primary" : "border-border"}`}>
              {name}
            </button>
          ))}
          <button type="button"
            className="ml-auto rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted"
            onClick={() => setDraft((previous) => ({ ...previous, homeIconSize: 28 }))}>
            Reset size
          </button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl border border-border bg-background p-4">
          {([
            [Truck, "LTMS"],
            [Warehouse, "Sentry/WMS"],
            [Settings2, "Settings"],
          ] as const).map(([Icon, label]) => (
            <div key={label} className="flex min-w-0 flex-col items-center gap-2 text-center">
              <span className="flex shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary"
                style={{
                  width: Math.max(52, draft.homeIconSize + 24),
                  height: Math.max(52, draft.homeIconSize + 24),
                }}>
                <Icon style={{ width: draft.homeIconSize, height: draft.homeIconSize }}
                  aria-hidden="true"/>
              </span>
              <span className="text-xs font-medium text-foreground">{label}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          This is a live preview. Save workspace theme below to apply the size across devices.
        </p>
      </section>

      <section className="surface-card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Background video per tab</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Video is on only for Home, Login and passkey verification by default.
              Every LTMS, HRMS, ERP and Sentry/WMS tab is off until you enable it below.
              The master video switch and video URL remain in Workspace background video.
            </p>
          </div>
          <span className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground">
            {enabledVideoTabs} enabled · {backgroundVideoEnabled ? "Master video on" : "Master video off"}
          </span>
        </div>
        <div className="mt-4 space-y-3">
          {VIDEO_TAB_GROUPS.map((group, index) => (
            <details key={group.title} open={index === 0 ? true : undefined} className="group rounded-xl border border-border bg-muted/10">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold">{group.title}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {group.options.filter((item) => videoEnabledForTab(draft.videoTabs, item.key)).length}/{group.options.length} on
                </span>
              </summary>
              <div className="border-t border-border p-3">
                <div className="mb-3 flex flex-wrap gap-2">
                  <button type="button" className="rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted"
                    onClick={() => setDraft((current) => ({
                      ...current,
                      videoTabs: { ...current.videoTabs, ...Object.fromEntries(group.options.map((item) => [item.key, true])) },
                    }))}>Enable all in group</button>
                  <button type="button" className="rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted"
                    onClick={() => setDraft((current) => ({
                      ...current,
                      videoTabs: { ...current.videoTabs, ...Object.fromEntries(group.options.map((item) => [item.key, false])) },
                    }))}>Disable all in group</button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {group.options.map((option) => (
                    <label key={option.key} className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs">
                      <span>{option.label}</span>
                      <input type="checkbox" className="size-4 shrink-0 accent-primary"
                        checked={videoEnabledForTab(draft.videoTabs, option.key)}
                        onChange={(event) => setVideoTab(option.key, event.target.checked)}
                        aria-label={`Show background video in ${option.label}`}/>
                    </label>
                  ))}
                </div>
              </div>
            </details>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Print pages and secure sharing screens never play background video. New tabs inherit their section setting or remain off until selected.</p>
      </section>

      <section className="surface-card p-5 sm:p-6">
        <h3 className="text-sm font-semibold">Customise your selected theme</h3>
        <p className="mb-4 mt-1 text-xs text-muted-foreground">Optional colour overrides. Unset fields inherit the preset and original semantics.</p>
        <div className="space-y-4">
          {COLOR_GROUPS.map((group, groupIndex) => (
            <details key={group.title} open={groupIndex === 0 || groupIndex === 2} className="rounded-xl border border-border bg-muted/10">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold hover:text-primary">
                {group.title} <span className="ml-2 font-normal text-xs text-muted-foreground">({group.fields.length} controls)</span>
              </summary>
              <p className="px-4 pb-2 text-xs text-muted-foreground">{group.description}</p>
              <div className="grid gap-2 p-3 pt-1 md:grid-cols-2">
                {group.fields.map(({ key, label }) => (
                  <div key={key} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border bg-card p-3">
                    <div className="min-w-0">
                      <label htmlFor={`theme-color-${key}`} className="text-xs font-medium">{label}</label>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                        {draft.colors[key] ?? "Using preset"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {draft.colors[key] && (
                        <button type="button" onClick={() => clearColor(key)} aria-label={`Reset ${label}`}
                          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                          Reset
                        </button>
                      )}
                      <input id={`theme-color-${key}`} type="color" value={draft.colors[key] || currentColor(draft, key)}
                        onChange={(event) => setColor(key, event.target.value)}
                        aria-label={label}
                        className="h-10 w-12 cursor-pointer rounded-md border border-border bg-background p-1"/>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Custom colours override the current preset across the app; sidebar changes affect Sentry/WMS too.
          </p>
          <button type="button" onClick={() => setDraft((prev) => ({ ...prev, colors: {} }))}
            disabled={!Object.keys(draft.colors).length}
            className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40">
            Reset custom colours
          </button>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm font-medium">Display density
            <select value={draft.density} onChange={(event) => setDraft((prev) => ({ ...prev, density: event.target.value as ThemeProfile["density"] }))}
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm">
              <option value="comfortable">Comfortable (default)</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">Corner rounding: {draft.radius === null ? "Default" : draft.radius + "px"}
            <input type="range" min={0} max={24} value={draft.radius ?? 12} onChange={(event) => setDraft((prev) => ({ ...prev, radius: Number(event.target.value) }))} className="accent-primary"/>
            <button type="button" onClick={() => setDraft((prev) => ({ ...prev, radius: null }))} className="self-start text-xs text-muted-foreground hover:text-foreground">Use preset rounding</button>
          </label>
        </div>
      </section>

      <section className="surface-card p-5 sm:p-6">
        <h3 className="text-sm font-semibold">Advanced background video playback</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Configure how background video starts and runs on the tabs where you enable it.
          Users can pause or resume on their own device without changing anyone else's playback.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {([
            ["video", "Moving video", "Play the selected video as the background."],
            ["still", "Video as image", "Freeze a decoded frame from that video, with no other image."],
            ["blank", "Blank background", "No video, banner, gradients, poster or background photograph."],
          ] as const).map(([mode, title, desc]) => (
            <button type="button" key={mode} aria-pressed={draft.videoPlayback.backgroundMode === mode}
              className={draft.videoPlayback.backgroundMode === mode
                ? "rounded-xl border-2 border-primary bg-primary-soft p-3 text-left"
                : "rounded-xl border border-border bg-card p-3 text-left hover:border-primary"}
              onClick={() => setDraft((prev) => ({
                ...prev,
                videoPlayback: { ...prev.videoPlayback, backgroundMode: mode, startPaused: false },
              }))}>
              <span className="block text-sm font-semibold">{title}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{desc}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          These modes apply universally wherever video is enabled. Play/Pause on a page changes
          the current device only. The Garuda banner is never used as a fallback.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {([
            ["showPauseButton", "Show on-page Play / Pause / Restart", "Allow playback control directly from Home, Login, passkey and enabled module tabs."],
            ["pauseWhenHidden", "Pause when switching browser tabs", "Save device resources and automatically resume if playback was not manually paused."],
            ["respectReducedMotion", "Respect reduced-motion preference", "Start paused for users requesting reduced motion; they can manually resume."],
            ["loopVideo", "Loop video continuously", "Restart the footage automatically when playback reaches the end."],
          ] as const).map(([key, title, detail]) => (
            <label key={key} className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-border bg-card p-3">
              <span className="space-y-1">
                <span className="block text-sm font-medium">{title}</span>
                <span className="block text-xs text-muted-foreground">{detail}</span>
              </span>
              <input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary"
                checked={draft.videoPlayback[key]}
                onChange={(event) => setDraft((prev) => ({
                  ...prev,
                  videoPlayback: { ...prev.videoPlayback, [key]: event.target.checked },
                }))}/>
            </label>
          ))}
          <div className="space-y-3 rounded-lg border border-border bg-card p-3 sm:col-span-2">
            <div>
              <span className="text-sm font-semibold">Universal video effects</span>
              <p className="mt-1 text-xs text-muted-foreground">
                Blur and colour tint apply to the video or frozen video frame on every enabled page.
                Forms, headers, navigation and text are never blurred.
              </p>
            </div>
            <label className="flex flex-wrap items-center justify-between gap-3 text-xs font-medium">
              Video colour tint
              <span className="flex items-center gap-2">
                <input type="color" value={draft.videoPlayback.tintColor}
                  className="h-9 w-12 cursor-pointer rounded-md border border-border bg-background p-1"
                  onChange={(event) => setDraft((prev) => ({
                    ...prev, videoPlayback: { ...prev.videoPlayback, tintColor: event.target.value },
                  }))}/>
                <span className="font-mono">{draft.videoPlayback.tintColor}</span>
              </span>
            </label>
            {([
              ["tintOpacity", "Colour tint strength", 0, 80, "%"],
              ["blur", "Video blur", 0, 24, "px"],
              ["brightness", "Video brightness", 40, 160, "%"],
              ["saturation", "Colour saturation", 0, 200, "%"],
              ["contrast", "Video contrast", 50, 160, "%"],
              ["grayscale", "Black & white", 0, 100, "%"],
              ["hueRotate", "Hue rotation", -180, 180, "°"],
              ["zoom", "Video zoom / crop", 100, 130, "%"],
            ] as const).map(([key, label, min, max, unit]) => (
              <label key={key} className="flex flex-col gap-2 text-xs font-medium">
                <span className="flex justify-between gap-2">
                  <span>{label}</span>
                  <span className="tabular-nums">{draft.videoPlayback[key]}{unit}</span>
                </span>
                <input type="range" min={min} max={max} step={1}
                  value={draft.videoPlayback[key]} className="w-full accent-primary"
                  onChange={(event) => setDraft((prev) => ({
                    ...prev, videoPlayback: { ...prev.videoPlayback, [key]: Number(event.target.value) },
                  }))}/>
              </label>
            ))}
            <button type="button" className="rounded-md border border-border bg-background px-3 py-2 text-xs hover:bg-muted"
              onClick={() => setDraft((prev) => ({
                ...prev, videoPlayback: {
                  ...prev.videoPlayback, blur: 0, tintColor: "#000000",
                  tintOpacity: 0, brightness: 100, saturation: 100,
                  contrast: 100, grayscale: 0, hueRotate: 0, zoom: 100, videoDim: 0,
                },
              }))}>Reset video effects</button>
          </div>
          <label className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
            <span className="text-sm font-medium">Playback speed</span>
            <span className="text-xs text-muted-foreground">Play slower for calm footage, or faster for motion.</span>
            <select className="mt-auto rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
              value={draft.videoPlayback.playbackRate}
              onChange={(event) => setDraft((prev) => ({
                ...prev,
                videoPlayback: { ...prev.videoPlayback, playbackRate: Number(event.target.value) },
              }))}>
              {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((speed) => (
                <option key={speed} value={speed}>{speed}× {speed === 1 ? "(normal)" : ""}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:col-span-2">
            <span className="text-sm font-medium">Video dimming: {draft.videoPlayback.videoDim}%</span>
            <span className="text-xs text-muted-foreground">0% keeps the footage at full brightness. Up to 15% darkens it without blurring a single pixel.</span>
            <input type="range" min={0} max={15} step={1}
              value={draft.videoPlayback.videoDim}
              onChange={(event) => setDraft((prev) => ({
                ...prev,
                videoPlayback: { ...prev.videoPlayback, videoDim: Number(event.target.value) },
              }))} className="w-full accent-primary"/>
          </label>
        </div>
        <button type="button" className="mt-3 rounded-lg border border-border bg-card px-3 py-2 text-xs hover:bg-muted"
          onClick={() => setDraft((prev) => ({
            ...prev,
            videoPlayback: { ...DEFAULT_THEME_PROFILE.videoPlayback },
          }))}>Restore playback defaults</button>
      </section>

      <section className="surface-card p-5 sm:p-6">
        <h3 className="text-sm font-semibold">Video text and readability</h3>
        <p className="mt-1 text-xs text-muted-foreground">Style text and form panels independently of blur/tint on the video footage. The foreground UI remains sharp and readable.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-xs font-medium">Text shadow for moving footage
            <select className="rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground"
              value={draft.videoTextShadow}
              onChange={(event) => setDraft((prev) => ({ ...prev, videoTextShadow: event.target.value as ThemeProfile["videoTextShadow"] }))}>
              <option value="none">None (unobstructed)</option>
              <option value="subtle">Subtle (recommended)</option>
              <option value="strong">Strong (maximum readability)</option>
            </select>
          </label>
          <label className="flex flex-col gap-2 text-xs font-medium">Text weight over video
            <select className="rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground"
              value={draft.videoTextWeight}
              onChange={(event) => setDraft((prev) => ({ ...prev, videoTextWeight: event.target.value as ThemeProfile["videoTextWeight"] }))}>
              <option value="regular">Regular</option>
              <option value="medium">Medium (recommended)</option>
              <option value="bold">Bold</option>
            </select>
          </label>
        </div>
        <div className="relative mt-4 min-h-[240px] overflow-hidden rounded-xl"
          style={{ background: preview.background }}>
          {draft.videoPlayback.backgroundMode !== "blank" && <video ref={previewVideoRef} src={backgroundVideoUrl} autoPlay={!previewPaused}
            muted loop={draft.videoPlayback.loopVideo} playsInline preload="auto" aria-hidden="true"
            className="absolute inset-0 size-full object-cover"
            style={{ filter: `blur(${draft.videoPlayback.blur}px) brightness(${draft.videoPlayback.brightness}%) saturate(${draft.videoPlayback.saturation}%) contrast(${draft.videoPlayback.contrast}%) grayscale(${draft.videoPlayback.grayscale}%) hue-rotate(${draft.videoPlayback.hueRotate}deg)`,
              transform: `scale(${Math.max(draft.videoPlayback.zoom / 100, 1 + draft.videoPlayback.blur / 250)})` }}
            onLoadedMetadata={(event) => {
              event.currentTarget.playbackRate = draft.videoPlayback.playbackRate;
              if (draft.videoPlayback.backgroundMode === "still" && Number.isFinite(event.currentTarget.duration) &&
                  event.currentTarget.duration > 0.15) event.currentTarget.currentTime = 0.15;
              if (previewPaused) event.currentTarget.pause();
            }}/>} 
          {draft.videoPlayback.backgroundMode !== "blank" && <>
            <div className="pointer-events-none absolute inset-0 z-[1]"
              style={{ backgroundColor: draft.videoPlayback.tintColor, opacity: draft.videoPlayback.tintOpacity / 100 }} />
            <div className="pointer-events-none absolute inset-0 z-[1]"
              style={{ background: `rgb(0 0 0 / ${draft.videoPlayback.videoDim / 100})` }} />
          </>}
          <div className="relative z-10 flex min-h-[240px] flex-col items-start justify-between gap-3 p-5">
            <div style={previewVideoTextStyle}>
              <p className="text-xs" style={{ color: getVideoColor("videoLabel") }}>GARUDA · VIDEO TEXT PREVIEW</p>
              <h4 className="mt-1 text-xl" style={{ color: getVideoColor("videoHeading") }}>Logistics workspace</h4>
              <p className="mt-2 text-sm" style={{ color: getVideoColor("videoText") }}>Direct text remains readable over moving footage.</p>
              <p className="mt-1 text-xs" style={{ color: getVideoColor("videoMutedText") }}>Text, labels and video remain unblurred.</p>
              <span className="mt-2 inline-block text-sm underline" style={{ color: getVideoColor("videoLink") }}>Open workspace</span>
              {draft.videoPlayback.backgroundMode !== "blank" && <button type="button"
                className="ml-3 rounded-md bg-slate-900/80 px-3 py-1 text-xs font-semibold text-white"
                onClick={() => setPreviewPaused((current) => !current)}>
                {previewPaused ? "Play preview" : "Pause preview"}
              </button>}
            </div>
            <div className="rounded-lg border px-3 py-2 text-xs" style={{
              background: getVideoColor("videoPanelBackground"),
              color: getVideoColor("videoPanelText"),
              borderColor: getVideoColor("footerAccent"),
            }}>Readable form panel · no backdrop blur</div>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Preview matches the selected video mode and visual effects. Still mode uses a frame from the video; Blank shows only your theme background. Contrast can vary between video frames.</p>
      </section>

      <section className="surface-card p-5 sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Live theme preview</h3>
          <span className="text-xs text-muted-foreground">Actual module selection: {getModuleTheme(draft, "ltms")}</span>
        </div>
        <div className="overflow-hidden rounded-xl border" style={{ background: preview.background, color: preview.foreground, borderColor: preview.border, borderRadius: draft.radius === null ? undefined : draft.radius }}>
          <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ background: preview.sidebar, color: preview.sidebarForeground }}>
            <span className="text-xs font-semibold">GARUDA ERP · WORKSPACE</span>
            <span className="text-[11px] opacity-70">Preview only</span>
          </div>
          <div className="flex min-h-[210px]">
            <aside className="w-[38%] max-w-44 space-y-1 p-2.5" style={{ background: preview.sidebar, color: preview.sidebarForeground }}>
              <div className="mb-2 rounded-md px-2 py-2 text-[11px] font-semibold" style={{ background: preview.sidebarCard }}>NAVIGATION</div>
              {["Dashboard", "Consignments", "Trips", "Accounts", "WMS"].map((item, index) => (
                <div key={item} className="rounded-md px-2 py-2 text-[11px]"
                  style={{ background: index === 1 ? preview.sidebarAccent : "transparent", color: index === 1 ? (draft.colors.sidebarAccentForeground || preview.sidebarForeground) : preview.sidebarForeground }}>
                  {item}
                </div>
              ))}
            </aside>
            <div className="min-w-0 flex-1 space-y-3 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">Financial dashboard</h4>
                <span className="rounded-md px-2 py-1.5 text-[11px] font-semibold" style={{ background: preview.primary, color: preview.primaryForeground }}>New trip</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {["Consignment income", "Trip expenditure"].map((label, index) => (
                  <div key={label} className="rounded-lg border p-2.5" style={{ background: preview.card, color: preview.cardForeground, borderColor: preview.border }}>
                    <p className="text-[11px] opacity-75">{label}</p>
                    <p className="mt-2 text-base font-semibold">{index === 0 ? "₹52,470" : "₹7,600"}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border p-2.5 text-[11px]" style={{ background: preview.card, color: preview.cardForeground, borderColor: preview.border }}>
                <div className="flex justify-between gap-1"><span>BOLR2026000002</span><span>₹3,350</span></div>
                <div className="my-2 h-px" style={{ background: preview.border }}/>
                <div className="flex justify-between gap-1"><span>BOLR2026000001</span><span>₹3,675</span></div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 px-3 py-2 text-xs"
            style={{
              background: draft.colors.footerBackground || currentColor(draft, "footerBackground"),
              color: draft.colors.footerForeground || currentColor(draft, "footerForeground"),
              borderColor: draft.colors.footerAccent || currentColor(draft, "footerAccent"),
            }}>
            <span>Powered by ORCA DEVS SURF</span>
            <span>orca.devs.surf</span>
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          {[
            ["Workspace text", readability],
            ["Card text", cardReadability],
            ["Sidebar text", sidebarReadability],
            ["Footer text", footerReadability],
            ["Video panel text", videoPanelReadability],
          ].map(([name, ratio]) => (
            <div key={String(name)} className="rounded-lg border border-border bg-muted/20 p-2.5">
              <span className="text-muted-foreground">{name}</span>
              <p className={Number(ratio) < 4.5 ? "mt-1 font-semibold text-destructive" : "mt-1 font-semibold text-emerald-600"}>
                {Number(ratio).toFixed(1)}:1 {Number(ratio) < 4.5 ? "Low contrast" : "Pass"}
              </p>
            </div>
          ))}
        </div>
        {!accessible && <p role="alert" className="mt-3 text-xs text-destructive">Some selected text colours have low contrast. Increase contrast to enable Save.</p>}
      </section>

      <section className="surface-card flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6">
        <div>
          <p className="text-sm font-semibold">Publish appearance</p>
          <p className="mt-1 text-xs text-muted-foreground">Save publishes the full profile to Supabase and device storage. Discard or leaving Appearance Studio restores the last saved theme.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setDraft({ ...DEFAULT_THEME_PROFILE })} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted"><RotateCcw className="size-4"/>Original look</button>
          <button type="button" onClick={() => { setDraft(profile); previewProfile(null); }} disabled={!dirty || saving} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">Discard</button>
          <button type="button" onClick={() => void save()} disabled={!dirty || saving || !ready || !accessible}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">
            {saving ? <Loader2 className="size-4 animate-spin"/> : <Check className="size-4"/>}Save workspace theme
          </button>
        </div>
      </section>
    </div>
  );
}
