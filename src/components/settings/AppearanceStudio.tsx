import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { Check, Download, Layers3, Loader2, Palette, RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";
import { THEMES, useTheme } from "@/lib/theme";
import {
  DEFAULT_THEME_PROFILE,
  THEME_PRESETS,
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
];
const themeNames = new Map<string, string>(THEMES.map((item) => [item.id, item.label]));
const allowedThemes = new Set(THEMES.map((item) => item.id));
const presetIds = new Set<string>(THEME_PRESETS.map((item) => item.id));

function currentColor(theme: ThemeProfile, key: keyof ThemeColors): string {
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
  const { profile, updateProfile, saving, ready } = useTheme();
  const [draft, setDraft] = useState<ThemeProfile>(profile);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(profile), [profile]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile);
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
  const accessible = readability >= 4.5 && cardReadability >= 4.5 && sidebarReadability >= 4.5;
  const activeName = themeNames.get(draft.baseTheme) ?? "Current ORCA";

  async function save() {
    try {
      await updateProfile(draft);
      toast.success("Appearance saved to the existing Supabase theme setting.");
    } catch {
      toast.error("Theme applied and cached on this device, but cloud sync failed. Retry when connected.");
    }
  }
  function chooseTheme(id: string) {
    setDraft((previous) => ({ ...previous, baseTheme: id, colors: {} }));
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
    if (file.size > 20_000) return toast.error("Theme files must be under 20 KB.");
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
              <p className="mt-1 text-sm text-muted-foreground">Use the existing Supabase theme column. Preview edits locally, then save once for the whole workspace.</p>
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
          {dirty && <span className="rounded-md bg-primary-soft px-2 py-1 text-xs font-medium text-primary">Unsaved preview</span>}
        </div>
      </section>

      <section className="surface-card p-5 sm:p-6">
        <h3 className="text-sm font-semibold">Choose an application theme</h3>
        <p className="mb-4 mt-1 text-xs text-muted-foreground">Current ORCA preserves the existing application and Sentry look. Other presets also theme the newer LTMS and WMS components.</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {THEME_PRESETS.map((item) => {
            const active = draft.baseTheme === item.id;
            return (
              <button key={item.id} type="button" onClick={() => chooseTheme(item.id)} aria-pressed={active}
                className={`relative overflow-hidden rounded-xl border p-3 text-left transition-colors hover:border-primary/70 ${active ? "border-primary ring-2 ring-primary/20" : "border-border"}`}>
                <div className="mb-3 h-16 rounded-lg p-2" style={{ background: item.dark ? "#151c27" : "#f8f9fb", color: item.dark ? "#f2f6fc" : "#273142" }}>
                  <div className="flex h-full gap-2">
                    <div className="w-5 shrink-0 rounded" style={{ background: item.swatch }} />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-2 w-4/5 rounded-sm" style={{ background: item.dark ? "#576273" : "#ccd3db" }}/>
                      <div className="h-3 rounded-sm" style={{ background: item.dark ? "#344051" : "#e3e7eb" }}/>
                      <div className="h-3 rounded-sm" style={{ background: item.dark ? "#344051" : "#e3e7eb" }}/>
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
        </div>
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          {[
            ["Workspace text", readability],
            ["Card text", cardReadability],
            ["Sidebar text", sidebarReadability],
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
          <p className="mt-1 text-xs text-muted-foreground">Save stores the full profile in the existing theme column and updates the device cache. Cancel discards the preview.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setDraft({ ...DEFAULT_THEME_PROFILE })} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted"><RotateCcw className="size-4"/>Original look</button>
          <button type="button" onClick={() => setDraft(profile)} disabled={!dirty} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">Discard</button>
          <button type="button" onClick={() => void save()} disabled={!dirty || saving || !ready || !accessible}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">
            {saving ? <Loader2 className="size-4 animate-spin"/> : <Check className="size-4"/>}Save workspace theme
          </button>
        </div>
      </section>
    </div>
  );
}
