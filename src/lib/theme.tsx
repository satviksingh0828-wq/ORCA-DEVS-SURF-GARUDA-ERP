import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_VIDEO_GLASS_APPEARANCE,
  normalizeVideoGlassAppearance,
  type VideoGlassAppearance,
} from "@/lib/video-glass";

export const THEMES = [
  /* ── Light accent themes ── */
  { id: "sky", label: "Azure Sky", swatch: "#2f7ed8", hint: "Calm corporate blue", dark: false },
  {
    id: "workspace",
    label: "Workspace Blue",
    swatch: "#159fe3",
    hint: "Bright, modern portal",
    dark: false,
  },
  {
    id: "glass",
    label: "Video Glass",
    swatch: "#8ccff0",
    hint: "Frosted glass · pairs with background video",
    dark: false,
  },
  { id: "emerald", label: "Emerald", swatch: "#12926f", hint: "Logistics green", dark: false },
  { id: "violet", label: "Deep Violet", swatch: "#6d4bd8", hint: "Modern & bold", dark: false },
  { id: "amber", label: "Warm Amber", swatch: "#d38b1b", hint: "Bright & energetic", dark: false },
  { id: "rose", label: "Signal Rose", swatch: "#d94f5c", hint: "High visibility", dark: false },
  { id: "graphite", label: "Graphite", swatch: "#4a4f57", hint: "Neutral monochrome", dark: false },
  { id: "garuda", label: "ORCA DEVS SURF", swatch: "#8b1a2c", hint: "Crimson & gold", dark: false },
  { id: "ocean", label: "Deep Ocean", swatch: "#1e3a6e", hint: "Professional navy", dark: false },
  { id: "blaze", label: "Blaze", swatch: "#e06820", hint: "Orange on blue-tint", dark: false },
  {
    id: "tangerine",
    label: "Tangerine",
    swatch: "#d96a25",
    hint: "Light warm orange",
    dark: false,
  },
  { id: "copper", label: "Copper", swatch: "#8b5a2b", hint: "Burnished bronze", dark: false },
  { id: "sakura", label: "Sakura", swatch: "#d95f8a", hint: "Cherry blossom pink", dark: false },
  { id: "arctic", label: "Arctic", swatch: "#2a8fa8", hint: "Icy teal & frost", dark: false },
  { id: "terra", label: "Terra", swatch: "#b05a30", hint: "Earthy terracotta", dark: false },
  /* ── Textured surface themes ── */
  {
    id: "vintage",
    label: "Vintage Press",
    swatch: "#7a4520",
    hint: "Sepia newspaper",
    dark: false,
  },
  { id: "paper", label: "Paper", swatch: "#3a4a8a", hint: "Clean parchment", dark: false },
  { id: "kraft", label: "Kraft", swatch: "#8B5E3C", hint: "Cardboard kraft paper", dark: false },
  {
    id: "blueprint",
    label: "Blueprint",
    swatch: "#1A3F6F",
    hint: "Engineering draft paper",
    dark: false,
  },
  { id: "linen", label: "Linen", swatch: "#7A3B2E", hint: "Natural linen & cream", dark: false },
  {
    id: "chalkboard",
    label: "Chalkboard",
    swatch: "#2D5A3D",
    hint: "Warm white, forest green",
    dark: false,
  },
  {
    id: "vellum",
    label: "Vellum",
    swatch: "#4A4A5A",
    hint: "Tracing paper & graphite",
    dark: false,
  },
  { id: "cork", label: "Cork", swatch: "#1A6B6B", hint: "Cork board tan & teal", dark: false },
  /* ── Dark themes ── */
  {
    id: "neon",
    label: "Neon Brutalism",
    swatch: "#39ff7a",
    hint: "Dark + neon green, no radius",
    dark: true,
  },
  { id: "midnight", label: "Midnight", swatch: "#4a7fd8", hint: "Deep midnight blue", dark: true },
  { id: "forest", label: "Dark Forest", swatch: "#22d870", hint: "Pine & moss", dark: true },
  { id: "storm", label: "Storm", swatch: "#3a6fd8", hint: "Charcoal + electric blue", dark: true },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export type LoginUi = "plain" | "image" | "video" | "workspace";
export const DEFAULT_BACKGROUND_VIDEO_URL =
  "https://cdn.pixabay.com/video/2024/04/29/209883_large.mp4";
export type BackgroundVideoSettings = { enabled?: boolean; url?: string };

type ThemeValue = {
  theme: ThemeId;
  setTheme: (t: ThemeId) => Promise<void>;
  saving: boolean;
  loginUi: LoginUi;
  setLoginUi: (v: LoginUi) => Promise<void>;
  backgroundVideoEnabled: boolean;
  backgroundVideoUrl: string;
  setBackgroundVideo: (settings: BackgroundVideoSettings) => Promise<void>;
  videoSaving: boolean;
  videoGlassAppearance: VideoGlassAppearance;
  setVideoGlassAppearance: (settings: VideoGlassAppearance) => Promise<void>;
  glassSaving: boolean;
};

const ThemeContext = createContext<ThemeValue | null>(null);
const THEME_CACHE_KEY = "garuda.theme";
const VIDEO_CACHE_KEY = "garuda.background-video";
const VIDEO_GLASS_CACHE_KEY = "garuda.video-glass";
const DEFAULT_THEME: ThemeId = "sky";
const DEFAULT_VIDEO_SETTINGS = { enabled: true, url: DEFAULT_BACKGROUND_VIDEO_URL };
const THEME_IDS = new Set<string>(THEMES.map(({ id }) => id));

function validTheme(value: unknown): ThemeId {
  return typeof value === "string" && THEME_IDS.has(value) ? (value as ThemeId) : DEFAULT_THEME;
}

function readCachedTheme(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    return validTheme(window.localStorage.getItem(THEME_CACHE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

function cacheTheme(theme: ThemeId) {
  try {
    window.localStorage.setItem(THEME_CACHE_KEY, theme);
  } catch {
    // Storage can be disabled; the in-memory theme still works.
  }
}

function readCachedVideoSettings() {
  if (typeof window === "undefined") return DEFAULT_VIDEO_SETTINGS;
  try {
    const stored = JSON.parse(window.localStorage.getItem(VIDEO_CACHE_KEY) ?? "null");
    return {
      enabled:
        typeof stored?.enabled === "boolean" ? stored.enabled : DEFAULT_VIDEO_SETTINGS.enabled,
      url:
        typeof stored?.url === "string" && stored.url.trim()
          ? stored.url
          : DEFAULT_VIDEO_SETTINGS.url,
    };
  } catch {
    return DEFAULT_VIDEO_SETTINGS;
  }
}

function cacheVideoSettings(settings: { enabled: boolean; url: string }) {
  try {
    window.localStorage.setItem(VIDEO_CACHE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be disabled; the in-memory setting still works.
  }
}

function readCachedVideoGlassAppearance(): VideoGlassAppearance {
  if (typeof window === "undefined") return DEFAULT_VIDEO_GLASS_APPEARANCE;
  try {
    return normalizeVideoGlassAppearance(
      JSON.parse(window.localStorage.getItem(VIDEO_GLASS_CACHE_KEY) ?? "null"),
    );
  } catch {
    return DEFAULT_VIDEO_GLASS_APPEARANCE;
  }
}

function cacheVideoGlassAppearance(settings: VideoGlassAppearance) {
  try {
    window.localStorage.setItem(VIDEO_GLASS_CACHE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be disabled; the in-memory appearance still works.
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Keep the server and first client render identical. Reading localStorage
  // here would make SSR render `sky` while the browser renders the cached
  // theme, which triggers React hydration error #418.
  const [theme, setThemeState] = useState<ThemeId>(DEFAULT_THEME);
  const [loginUi, setLoginUiState] = useState<LoginUi>("plain");
  const [backgroundVideoEnabled, setBackgroundVideoEnabled] = useState(true);
  const [backgroundVideoUrl, setBackgroundVideoUrl] = useState(DEFAULT_BACKGROUND_VIDEO_URL);
  const [videoGlassAppearance, setVideoGlassAppearanceState] = useState(
    DEFAULT_VIDEO_GLASS_APPEARANCE,
  );
  const [saving, setSaving] = useState(false);
  const [videoSaving, setVideoSaving] = useState(false);
  const [glassSaving, setGlassSaving] = useState(false);

  const apply = useCallback((t: ThemeId) => {
    document.documentElement.setAttribute("data-theme", t);
  }, []);

  // Shared fetch helper — called on mount and on page-visibility regain.
  // Tries to fetch both columns; if login_ui doesn't exist yet (migration
  // not run), falls back to fetching just theme so the theme still loads.
  const fetchSettings = useCallback(async () => {
    try {
      if (!isSupabaseConfigured()) return;
      const request = supabase
        .from("app_settings")
        .select(
          "theme, login_ui, background_video_enabled, background_video_url, glass_surface_opacity, glass_background_veil, glass_text_color",
        )
        .limit(1)
        .maybeSingle();
      const { data, error } = await Promise.race([
        request,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("theme settings timeout")), 2500),
        ),
      ]);

      if (error) {
        // Keep video settings working while the newer glass-controls migration is pending.
        const { data: previousVideoSettings, error: previousVideoError } = await supabase
          .from("app_settings")
          .select("theme, login_ui, background_video_enabled, background_video_url")
          .limit(1)
          .maybeSingle();
        if (!previousVideoError && previousVideoSettings) {
          const next = validTheme(previousVideoSettings.theme);
          setThemeState(next);
          apply(next);
          cacheTheme(next);
          setLoginUiState((previousVideoSettings.login_ui as LoginUi) ?? "plain");
          const enabled = previousVideoSettings.background_video_enabled !== false;
          const url =
            typeof previousVideoSettings.background_video_url === "string" &&
            previousVideoSettings.background_video_url.trim()
              ? previousVideoSettings.background_video_url
              : DEFAULT_BACKGROUND_VIDEO_URL;
          setBackgroundVideoEnabled(enabled);
          setBackgroundVideoUrl(url);
          cacheVideoSettings({ enabled, url });
          const cachedGlass = readCachedVideoGlassAppearance();
          setVideoGlassAppearanceState(cachedGlass);
          return;
        }

        // Support older projects that have not yet run the background-video migration.
        const { data: fallback } = await supabase
          .from("app_settings")
          .select("theme, login_ui")
          .limit(1)
          .maybeSingle();
        if (fallback) {
          const next = validTheme(fallback.theme);
          setThemeState(next);
          apply(next);
          cacheTheme(next);
          setLoginUiState((fallback.login_ui as LoginUi) ?? "plain");
        } else {
          const { data: legacy } = await supabase
            .from("app_settings")
            .select("theme")
            .limit(1)
            .maybeSingle();
          const next = validTheme(legacy?.theme);
          setThemeState(next);
          apply(next);
          cacheTheme(next);
        }
        const cachedGlass = readCachedVideoGlassAppearance();
        setVideoGlassAppearanceState(cachedGlass);
        return;
      }

      const next = validTheme(data?.theme);
      setThemeState(next);
      apply(next);
      cacheTheme(next);
      setLoginUiState((data?.login_ui as LoginUi) ?? "plain");
      const enabled = data?.background_video_enabled !== false;
      const url =
        typeof data?.background_video_url === "string" && data.background_video_url.trim()
          ? data.background_video_url
          : DEFAULT_BACKGROUND_VIDEO_URL;
      setBackgroundVideoEnabled(enabled);
      setBackgroundVideoUrl(url);
      cacheVideoSettings({ enabled, url });
      const glassAppearance = normalizeVideoGlassAppearance({
        surfaceOpacity: data?.glass_surface_opacity,
        backgroundVeil: data?.glass_background_veil,
        textColor: data?.glass_text_color,
      });
      setVideoGlassAppearanceState(glassAppearance);
      cacheVideoGlassAppearance(glassAppearance);
    } catch {
      // Supabase not configured yet — keep defaults.
    }
  }, [apply]);

  useEffect(() => {
    const cached = readCachedTheme();
    const cachedVideo = readCachedVideoSettings();
    const cachedGlass = readCachedVideoGlassAppearance();
    setBackgroundVideoEnabled(cachedVideo.enabled);
    setBackgroundVideoUrl(cachedVideo.url);
    setVideoGlassAppearanceState(cachedGlass);
    if (cached !== DEFAULT_THEME) {
      setThemeState(cached);
      apply(cached);
    }
    void fetchSettings();
    // Re-fetch whenever the user switches back to this tab (covers cross-device
    // changes that may have happened while the tab was in the background).
    function onVisible() {
      if (document.visibilityState === "visible") fetchSettings();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [apply, fetchSettings]);

  useEffect(() => {
    apply(theme);
  }, [apply, theme]);

  // Real-time sync: when admin saves a theme on any device, all open sessions update instantly.
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const channel = supabase
      .channel("theme_sync")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "app_settings" },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row.theme) {
            const next = validTheme(row.theme);
            setThemeState(next);
            apply(next);
            cacheTheme(next);
          }
          if (row.login_ui) {
            setLoginUiState(row.login_ui as LoginUi);
          }
          if (typeof row.background_video_enabled === "boolean") {
            setBackgroundVideoEnabled(row.background_video_enabled);
          }
          if (typeof row.background_video_url === "string" && row.background_video_url.trim()) {
            setBackgroundVideoUrl(row.background_video_url);
          }
          if (
            typeof row.background_video_enabled === "boolean" ||
            typeof row.background_video_url === "string"
          ) {
            const cachedVideo = readCachedVideoSettings();
            cacheVideoSettings({
              enabled:
                typeof row.background_video_enabled === "boolean"
                  ? row.background_video_enabled
                  : cachedVideo.enabled,
              url:
                typeof row.background_video_url === "string" && row.background_video_url.trim()
                  ? row.background_video_url
                  : cachedVideo.url,
            });
          }
          if (
            typeof row.glass_surface_opacity === "number" ||
            typeof row.glass_background_veil === "number" ||
            typeof row.glass_text_color === "string"
          ) {
            const cachedGlass = readCachedVideoGlassAppearance();
            const nextGlass = normalizeVideoGlassAppearance({
              surfaceOpacity:
                typeof row.glass_surface_opacity === "number"
                  ? row.glass_surface_opacity
                  : cachedGlass.surfaceOpacity,
              backgroundVeil:
                typeof row.glass_background_veil === "number"
                  ? row.glass_background_veil
                  : cachedGlass.backgroundVeil,
              textColor:
                typeof row.glass_text_color === "string"
                  ? row.glass_text_color
                  : cachedGlass.textColor,
            });
            setVideoGlassAppearanceState(nextGlass);
            cacheVideoGlassAppearance(nextGlass);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [apply]);

  // Shared save helper — upserts a partial settings object.
  // Gets the existing row id first so we always UPDATE the same row, never
  // accumulate duplicate rows that would cause the wrong row to load later.
  const saveSettings = useCallback(
    async (
      patch: Partial<{
        theme: string;
        login_ui: string;
        background_video_enabled: boolean;
        background_video_url: string;
        glass_surface_opacity: number;
        glass_background_veil: number;
        glass_text_color: string;
        updated_at: string;
      }>,
    ) => {
      if (!isSupabaseConfigured()) return;
      const { data, error: readError } = await supabase
        .from("app_settings")
        .select("id")
        .limit(1)
        .maybeSingle();
      if (readError) throw readError;
      if (data?.id) {
        const { error } = await supabase
          .from("app_settings")
          .update(patch)
          .eq("id", data.id as string);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("app_settings").insert(patch);
        if (error) throw error;
      }
    },
    [],
  );

  const setTheme = useCallback(
    async (t: ThemeId) => {
      setThemeState(t);
      apply(t);
      cacheTheme(t);
      setSaving(true);
      try {
        await saveSettings({ theme: t });
      } catch {
        // Supabase not configured yet — theme applied locally only.
      }
      setSaving(false);
    },
    [apply, saveSettings],
  );

  const setLoginUi = useCallback(
    async (v: LoginUi) => {
      setLoginUiState(v);
      setSaving(true);
      try {
        await saveSettings({ login_ui: v });
      } catch {
        // Supabase not configured — applied locally only.
      }
      setSaving(false);
    },
    [saveSettings],
  );

  const setBackgroundVideo = useCallback(
    async (settings: BackgroundVideoSettings) => {
      const enabled = settings.enabled ?? backgroundVideoEnabled;
      const url = settings.url?.trim() || backgroundVideoUrl;
      setBackgroundVideoEnabled(enabled);
      setBackgroundVideoUrl(url);
      cacheVideoSettings({ enabled, url });
      setVideoSaving(true);
      try {
        await saveSettings({
          background_video_enabled: enabled,
          background_video_url: url,
        });
      } finally {
        setVideoSaving(false);
      }
    },
    [backgroundVideoEnabled, backgroundVideoUrl, saveSettings],
  );

  const setVideoGlassAppearance = useCallback(
    async (settings: VideoGlassAppearance) => {
      const appearance = normalizeVideoGlassAppearance(settings);
      setVideoGlassAppearanceState(appearance);
      cacheVideoGlassAppearance(appearance);
      setGlassSaving(true);
      try {
        await saveSettings({
          glass_surface_opacity: appearance.surfaceOpacity,
          glass_background_veil: appearance.backgroundVeil,
          glass_text_color: appearance.textColor,
        });
      } finally {
        setGlassSaving(false);
      }
    },
    [saveSettings],
  );

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      saving,
      loginUi,
      setLoginUi,
      backgroundVideoEnabled,
      backgroundVideoUrl,
      setBackgroundVideo,
      videoSaving,
      videoGlassAppearance,
      setVideoGlassAppearance,
      glassSaving,
    }),
    [
      theme,
      setTheme,
      saving,
      loginUi,
      setLoginUi,
      backgroundVideoEnabled,
      backgroundVideoUrl,
      setBackgroundVideo,
      videoSaving,
      videoGlassAppearance,
      setVideoGlassAppearance,
      glassSaving,
    ],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
