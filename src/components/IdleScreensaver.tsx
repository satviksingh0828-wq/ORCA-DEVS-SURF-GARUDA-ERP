import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { useAppSettings } from "@/lib/hooks";
import { getModuleTheme, moduleThemeInlineStyles } from "@/lib/theme-studio";
import { normalizeSplashMode } from "./SplashScreen";
import { LogBookSplashText } from "./LogBookWordmark";

export const SCREENSAVER_IDLE_MS = 3 * 60 * 1000;
const ACTIVITY_EVENTS = ["pointermove", "pointerdown", "keydown", "scroll", "wheel", "touchstart", "click"] as const;

/** Root-level, signed-in only. This is a visual cover, never an auth lock. */
export function IdleScreensaver({ enabled }: { enabled: boolean }) {
  const { user } = useSession();
  const active = enabled && Boolean(user);
  if (!active) return null;
  return <IdleScreensaverSession />;
}

function IdleScreensaverSession() {
  const [visible, setVisible] = useState(false);
  const lastActivity = useRef(0);
  const timeout = useRef<number | undefined>(undefined);
  const dialog = useRef<HTMLDialogElement>(null);
  const { profile } = useTheme();
  const { data, isError } = useAppSettings();
  const [systemDark, setSystemDark] = useState(false);

  const clearTimer = useCallback(() => {
    if (timeout.current !== undefined) window.clearTimeout(timeout.current);
    timeout.current = undefined;
  }, []);

  const checkIdle = useCallback(function checkIdle() {
    clearTimer();
    const remaining = SCREENSAVER_IDLE_MS - (Date.now() - lastActivity.current);
    if (remaining <= 0) {
      setVisible(true);
    } else {
      timeout.current = window.setTimeout(checkIdle, remaining);
    }
  }, [clearTimer]);

  const resetIdle = useCallback(() => {
    lastActivity.current = Date.now();
    checkIdle();
  }, [checkIdle]);

  const dismiss = useCallback(() => {
    setVisible(false);
    resetIdle();
  }, [resetIdle]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    resetIdle();
    const onActivity = () => {
      // Movement alone does not dismiss the saver. Clicking/tapping the
      // actual cover dismisses it; ordinary activity resets the idle clock.
      if (!dialog.current?.open) resetIdle();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !dialog.current?.open) checkIdle();
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { capture: true, passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimer();
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity, true);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [resetIdle, checkIdle, clearTimer]);

  useEffect(() => {
    const element = dialog.current;
    if (!visible || !element) return;
    clearTimer();
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Native top-layer dialog makes the background inert, so the first
    // wake click cannot also submit a form or activate an underlying button.
    if (!element.open) {
      try { element.showModal(); }
      catch { element.setAttribute("open", ""); }
    }
    return () => {
      if (element.open) element.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [visible, clearTimer]);

  if (!visible) return null;

  // Same four appearance modes as the startup screen. App mode uses the
  // active ERP palette (including local preview and custom colours).
  const mode = isError ? "system" : normalizeSplashMode(data?.splash_screen_mode);
  const themed = mode === "app";
  const themeId = themed ? getModuleTheme(profile, "erp") : undefined;
  const dark = mode === "dark" || (mode === "system" && systemDark);
  const ink = dark ? "#ffffff" : "#151515";
  const surface: CSSProperties = {
    ...(themed ? moduleThemeInlineStyles(profile, "erp") : {}),
    position: "fixed", inset: 0, margin: 0, padding: 0, border: 0,
    width: "100%", height: "100%", maxWidth: "none", maxHeight: "none",
    zIndex: 10000, overflow: "hidden",
    backgroundColor: themed ? "var(--background)" : dark ? "#151515" : "#ffffff",
    backgroundImage: themed ? "var(--logbook-theme-texture, none)" : "none",
    color: themed ? "var(--foreground)" : ink,
    userSelect: "none",
  };

  return (
    <dialog ref={dialog} aria-label="LogBook screensaver" data-theme={themeId}
      className={themed ? "logbook-screensaver logbook-splash-app-theme" : "logbook-screensaver"}
      style={surface} onCancel={(event) => { event.preventDefault(); dismiss(); }}>
      <button type="button" aria-label="Dismiss screensaver" onClick={dismiss}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", padding: 0, border: 0, background: "transparent", color: "inherit", cursor: "pointer", touchAction: "manipulation" }}>
        <span className="logbook-splash-wordmark">
          <svg viewBox="0 0 962 192" style={{ display: "block", width: "100%", aspectRatio: "962 / 192", overflow: "visible" }} aria-hidden="true">
            <LogBookSplashText fill={themed ? "var(--primary)" : ink} />
          </svg>
        </span>
      </button>
    </dialog>
  );
}
