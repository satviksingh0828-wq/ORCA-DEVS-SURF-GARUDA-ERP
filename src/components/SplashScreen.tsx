import { useEffect, useRef, useState } from "react";
import { LOGBOOK_FONT_FAMILY, LOGBOOK_FONT_WEIGHT, LOGBOOK_WORDMARK } from "./LogBookWordmark";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";

import { THEMES } from "@/lib/theme";
import { parseThemeProfile, getModuleTheme, isDarkTheme, themeInlineStyles, type ThemeProfile } from "@/lib/theme-studio";

const THEME_IDS = new Set<string>(THEMES.map((theme) => theme.id));
export type SplashMode = "system" | "light" | "dark" | "app";
export function normalizeSplashMode(value: unknown): SplashMode {
  return value === "light" || value === "dark" || value === "app" ? value : "system";
}

export function SplashScreen({ onComplete }: { onComplete?: () => void } = {}) {
  const [mode, setMode] = useState<SplashMode | null>(null);
  const [systemDark, setSystemDark] = useState(false);
  const [appProfile, setAppProfile] = useState<ThemeProfile | null>(null);
  const [gone, setGone] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const logo = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const counter = useRef<HTMLDivElement>(null);
  const number = useRef<HTMLSpanElement>(null);
  const complete = useRef(onComplete);
  useEffect(() => { complete.current = onComplete; }, [onComplete]);

  // Always ask the database first; never substitute a stale local preference.
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
      try {
        if (isSupabaseConfigured()) {
          const result = await Promise.race([
            supabase.from("app_settings").select("splash_screen_mode,theme").limit(1).maybeSingle().abortSignal(controller.signal),
            new Promise<null>((resolve) => { timer = window.setTimeout(() => { resolve(null); controller.abort(); }, 2500); }),
          ]);
          if (result && !result.error && active) {
            selected = normalizeSplashMode(result.data?.splash_screen_mode);
            if (selected === "app") setAppProfile(parseThemeProfile(result.data?.theme, THEME_IDS));
          }
        }
      } catch { /* Unavailable or unconfigured: use OS appearance. */ }
      finally { if (timer !== undefined) window.clearTimeout(timer); }
      if (active) setMode(selected);
    }
    void loadMode();
    return () => {
      active = false;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
      media.removeEventListener("change", update);
    };
  }, []);

  const themeProfile = mode === "app" ? appProfile : null;
  const themeId = themeProfile ? getModuleTheme(themeProfile, "erp") : undefined;
  const dark = themeId ? isDarkTheme(themeId) : mode === "dark" || ((mode === "system" || mode === null) && systemDark);
  const ink = dark ? "#ffffff" : "#151515";
  const empty = dark ? "#424242" : "#d6d6d6";
  const colors = useRef({ ink, empty });
  useEffect(() => { colors.current = { ink, empty }; }, [ink, empty]);

  useEffect(() => {
    if (mode === null || !canvas.current || !logo.current || !overlay.current || !counter.current || !number.current) return;
    const cv = canvas.current, stage = logo.current, layer = overlay.current, label = counter.current, digits = number.current;
    const ctx = cv.getContext("2d");
    if (!ctx) { setGone(true); complete.current?.(); return; }
    // Read the scoped CSS theme rather than the device-cached root theme.
    const themed = mode === "app";
    const readThemeColors = () => {
      const computed = window.getComputedStyle(layer);
      const fill = computed.color;
      const probe = layer.querySelector<HTMLElement>("[data-splash-empty]");
      const muted = probe ? window.getComputedStyle(probe).color : fill;
      return { ink: fill, empty: muted };
    };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    let frame = 0;
    function draw(now: number) {
      if (!ctx) return;
      const t = (now - started) / 1000;
      const p = reduced ? 1 : Math.max(0, Math.min(1, (t - 1) / 3));
      const w = cv.clientWidth, h = cv.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const pixelW = Math.max(1, Math.round(w * dpr)), pixelH = Math.max(1, Math.round(h * dpr));
      if (cv.width !== pixelW || cv.height !== pixelH) { cv.width = pixelW; cv.height = pixelH; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      const palette = themed ? readThemeColors() : colors.current;
      ctx.fillStyle = p === 1 ? palette.ink : palette.empty;
      ctx.font = LOGBOOK_FONT_WEIGHT + " " + h * 1.04 + "px " + LOGBOOK_FONT_FAMILY;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.save();
      ctx.translate(w / 2, h * 0.49);
      ctx.scale(w * 0.98 / Math.max(1, ctx.measureText(LOGBOOK_WORDMARK).width), 1);
      ctx.fillText(LOGBOOK_WORDMARK, 0, 0);
      ctx.restore();
      if (p > 0 && p < 1) {
        const amplitude = window.innerWidth >= 1024 ? 50 : 25;
        const expandedHeight = h + 1.75 * amplitude;
        const phase = (t - 1) * 1.8;
        const waterline = expandedHeight * (1 - p) - (expandedHeight - h) / 2;
        ctx.globalCompositeOperation = "source-atop";
        ctx.fillStyle = palette.ink;
        ctx.beginPath();
        ctx.moveTo(0, h + amplitude);
        for (let x = 0; x <= w; x++) {
          const k = x / 3;
          const wave = Math.sin(0.02 * k + phase) * Math.sin(0.01 * k + phase) * Math.sin(0.05 * k + phase) * amplitude;
          ctx.lineTo(x, waterline - wave);
        }
        ctx.lineTo(w, h + amplitude);
        ctx.closePath();
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      }
      digits.textContent = String(Math.round(p * 100));
      label.style.opacity = String(reduced ? 1 : Math.max(0, 1 - (t - 4) / 0.25));
      const zoom = reduced ? 0 : Math.max(0, Math.min(1, (t - 4.7)));
      const target = window.innerWidth / Math.max(w, 1) * (window.innerWidth >= 1024 ? 2 : 1.5);
      stage.style.transform = "scale(" + (1 + zoom * (target - 1)) + ")";
      stage.style.opacity = String(1 - zoom);
      layer.style.opacity = String(reduced ? 1 : Math.max(0, 1 - (t - 5.7) / 0.4));
      if (t >= (reduced ? 0.35 : 6.1)) { setGone(true); complete.current?.(); return; }
      frame = window.requestAnimationFrame(draw);
    }
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [mode]);

  if (gone) return null;
  return (
    <div ref={overlay} role="status" aria-label="Loading LogBook" data-theme={themeId} className={themeProfile ? "logbook-splash-app-theme" : undefined}
      style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", ...(themeProfile ? themeInlineStyles(themeProfile) : {}), background: themeProfile ? "var(--background)" : dark ? "#151515" : "#ffffff", color: themeProfile ? "var(--foreground)" : ink, userSelect: "none" }}>
      <style>{`
        .logbook-splash-wordmark { width: 80%; position: relative; }
        @media (min-width: 768px) { .logbook-splash-wordmark { width: 70%; } }
        @media (min-width: 1024px) { .logbook-splash-wordmark { width: min(80%, 740px); } }
        @media (min-width: 1280px) { .logbook-splash-wordmark { width: min(80%, 965px); } }
      `}</style>
      {themeProfile && <span data-splash-empty aria-hidden="true" style={{ position: "absolute", visibility: "hidden", color: "color-mix(in srgb, var(--foreground) 30%, var(--background))" }} />}
      {mode !== null && <div className="logbook-splash-wordmark" ref={logo}>
        <canvas ref={canvas} style={{ display: "block", width: "100%", aspectRatio: "962 / 192" }} aria-hidden="true" />
        <div ref={counter} style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, font: "500 12px Arial, sans-serif", fontVariantNumeric: "tabular-nums" }}>loading... <span ref={number} style={{ display: "inline-block", minWidth: "3ch", textAlign: "right" }}>0</span>%</div>
      </div>}
    </div>
  );
}
