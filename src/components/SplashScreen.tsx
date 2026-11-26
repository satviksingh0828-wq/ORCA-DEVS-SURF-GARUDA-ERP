import { useEffect, useId, useRef, useState } from "react";
import { LogBookSplashText } from "./LogBookWordmark";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import { THEMES } from "@/lib/theme";
import { parseThemeProfile, getModuleTheme, moduleThemeInlineStyles, type ThemeProfile } from "@/lib/theme-studio";

const THEME_IDS = new Set<string>(THEMES.map((theme) => theme.id));
export type SplashMode = "system" | "light" | "dark" | "app";
export type SplashPreview = { mode: SplashMode; profile: ThemeProfile };
export function normalizeSplashMode(value: unknown): SplashMode {
  return value === "light" || value === "dark" || value === "app" ? value : "system";
}

export function SplashScreen({ onComplete, preview }: { onComplete?: () => void; preview?: SplashPreview } = {}) {
  const [mode, setMode] = useState<SplashMode | null>(null);
  const [systemDark, setSystemDark] = useState(false);
  const [appProfile, setAppProfile] = useState<ThemeProfile | null>(null);
  const [gone, setGone] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const wavePath = useRef<SVGPathElement>(null);
  const logo = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const complete = useRef(onComplete);
  const maskId = "logbook-mask-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  useEffect(() => { complete.current = onComplete; }, [onComplete]);

  // Always ask the database first during real startup. A settings preview is
  // explicitly local and does not save or fetch settings.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let timer: number | undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    async function loadMode() {
      let selected: SplashMode = "system";
      let profile: ThemeProfile | null = null;
      try {
        if (preview) {
          selected = normalizeSplashMode(preview.mode);
          if (selected === "app") profile = preview.profile;
        } else if (isSupabaseConfigured()) {
          const result = await Promise.race([
            supabase.from("app_settings").select("splash_screen_mode,theme").limit(1).maybeSingle().abortSignal(controller.signal),
            new Promise<null>((resolve) => { timer = window.setTimeout(() => { resolve(null); controller.abort(); }, 2500); }),
          ]);
          if (result && !result.error && result.data) {
            selected = normalizeSplashMode(result.data.splash_screen_mode);
            if (selected === "app") profile = parseThemeProfile(result.data.theme, THEME_IDS);
          }
        }
      } catch { selected = "system"; }
      finally { if (timer !== undefined) window.clearTimeout(timer); }
      if (active) {
        setAppProfile(profile);
        setMode(selected === "app" && !profile ? "system" : selected);
      }
    }
    void loadMode();
    return () => {
      active = false;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
      media.removeEventListener("change", update);
    };
  }, [preview]);

  const themeProfile = mode === "app" ? appProfile : null;
  const themeId = themeProfile ? getModuleTheme(themeProfile, "erp") : undefined;
  const dark = mode === "dark" || ((mode === "system" || mode === null) && systemDark);
  const ink = dark ? "#ffffff" : "#151515";
  const empty = dark ? "#424242" : "#d6d6d6";
  const fillColor = themeProfile ? "var(--primary)" : ink;
  const emptyColor = themeProfile ? "color-mix(in srgb, var(--primary) 32%, var(--background))" : empty;

  useEffect(() => {
    if (!preview) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setGone(true); complete.current?.(); }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [preview]);

  useEffect(() => {
    if (gone || mode === null || !svg.current || !wavePath.current || !logo.current || !overlay.current) return;
    const graphic = svg.current, wave = wavePath.current, stage = logo.current, layer = overlay.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    let frame = 0;
    function draw(now: number) {
      const t = (now - started) / 1000;
      const p = reduced ? 1 : Math.max(0, Math.min(1, (t - 1) / 3));
      // Native SVG mask + CSS fills keep custom colours, OKLCH and theme
      // textures independent of canvas colour parsing and device pixel ratio.
      if (p === 0) wave.setAttribute("d", "");
      else if (p === 1) wave.setAttribute("d", "M0 0H962V192H0Z");
      else {
        const w = Math.max(1, graphic.clientWidth);
        const unit = 962 / w;
        const amplitude = (window.innerWidth >= 1024 ? 50 : 25) * unit;
        const expandedHeight = 192 + 1.75 * amplitude;
        const phase = (t - 1) * 1.8;
        const waterline = expandedHeight * (1 - p) - (expandedHeight - 192) / 2;
        let d = "M0 " + (192 + amplitude);
        for (let x = 0; x <= 962; x += 4) {
          const k = x / unit / 3;
          const offset = Math.sin(0.02 * k + phase) * Math.sin(0.01 * k + phase) * Math.sin(0.05 * k + phase) * amplitude;
          d += " L" + x + " " + (waterline - offset).toFixed(2);
        }
        wave.setAttribute("d", d + " L962 " + (192 + amplitude) + "Z");
      }
      const zoom = reduced ? 0 : Math.max(0, Math.min(1, t - 4.7));
      const target = window.innerWidth / Math.max(graphic.clientWidth, 1) * (window.innerWidth >= 1024 ? 2 : 1.5);
      stage.style.transform = "scale(" + (1 + zoom * (target - 1)) + ")";
      stage.style.opacity = String(1 - zoom);
      layer.style.opacity = String(reduced ? 1 : Math.max(0, 1 - (t - 5.7) / 0.4));
      if (t >= (reduced ? 0.35 : 6.1)) { setGone(true); complete.current?.(); return; }
      frame = window.requestAnimationFrame(draw);
    }
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [mode, gone]);

  if (gone) return null;
  return (
    <div ref={overlay} role="status" aria-label="Loading LogBook" data-theme={themeId} className={themeProfile ? "logbook-splash-app-theme" : undefined}
      style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", ...(themeProfile ? moduleThemeInlineStyles(themeProfile, "erp") : {}), backgroundColor: themeProfile ? "var(--background)" : dark ? "#151515" : "#ffffff", color: themeProfile ? "var(--foreground)" : ink, backgroundImage: themeProfile ? "var(--logbook-theme-texture, none)" : "none", userSelect: "none" }}>
      {mode !== null && <div className="logbook-splash-wordmark" ref={logo}>
        <svg ref={svg} viewBox="0 0 962 192" style={{ display: "block", width: "100%", aspectRatio: "962 / 192", overflow: "visible" }} aria-hidden="true">
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="962" height="192" style={{ maskType: "alpha" }}>
              <LogBookSplashText fill="white" />
            </mask>
          </defs>
          <g mask={`url(#${maskId})`}>
            <rect width="962" height="192" fill={emptyColor} />
            <path ref={wavePath} fill={fillColor} />
          </g>
        </svg>
      </div>}
      {preview && <button type="button" onClick={() => { setGone(true); complete.current?.(); }} style={{ position: "absolute", top: 18, right: 18, border: "1px solid currentColor", borderRadius: 8, padding: "6px 12px", font: "inherit", color: "inherit", background: "transparent" }}>Close preview</button>}
    </div>
  );
}
