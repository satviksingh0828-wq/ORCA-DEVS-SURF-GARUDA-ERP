import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useCurrentVideoTab, videoEnabledForTab } from "@/lib/video-tabs";

const LOCAL_KEY = "garuda.background-video.playback-v3";
const LEGACY_KEY = "garuda.background-video.user-paused";

type DeviceChoice = { mode: "video" | "still"; base: string; url: string };

function cachedChoice(base: string, url: string): DeviceChoice | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) {
      const value = JSON.parse(raw) as DeviceChoice;
      return value.base === base && value.url === url &&
        (value.mode === "video" || value.mode === "still") ? value : null;
    }
    const old = localStorage.getItem(LEGACY_KEY);
    if (base === "video" && (old === "true" || old === "false"))
      return { mode: old === "true" ? "still" : "video", base, url };
  } catch {
    // Storage is optional; the workspace default is always usable.
  }
  return null;
}

/** One universal video controller, independent of the original ORCA splash. */
export function WorkspaceBackgroundVideo() {
  const { backgroundVideoEnabled, backgroundVideoUrl, profile, ready: themeReady } = useTheme();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tab = useCurrentVideoTab(pathname);
  const settings = profile.videoPlayback;
  const sourceMode = settings.backgroundMode;
  const forbidden = pathname.startsWith("/screen-control-host") ||
    pathname.startsWith("/share") || pathname.includes("/print");
  const tabAllowed = themeReady && backgroundVideoEnabled && !forbidden &&
    videoEnabledForTab(profile.videoTabs, tab);
  const [deviceChoice, setDeviceChoice] = useState<DeviceChoice | null>(null);
  const localMode = deviceChoice?.base === sourceMode && deviceChoice.url === backgroundVideoUrl
    ? deviceChoice.mode : null;
  const mode = !tabAllowed || sourceMode === "blank" ? "blank" :
    localMode ?? (sourceMode === "still" || settings.startPaused ? "still" : "video");
  const showMedia = mode !== "blank";
  const videoRef = useRef<HTMLVideoElement>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => setDeviceChoice(cachedChoice(sourceMode, backgroundVideoUrl)),
    [sourceMode, backgroundVideoUrl]);

  useEffect(() => {
    setFrameReady(false);
    setFailed(false);
    setPlaying(false);
  }, [backgroundVideoUrl]);

  // Even when no video is rendered, blank mode removes old Login/Passkey
  // decorative gradients and images. Never touch the splash-screen component.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.videoMode = mode;
    if (showMedia) {
      root.dataset.videoBackground = "on";
      root.dataset.videoScreen = tab === "login" || tab === "passkey" ? "auth" : "workspace";
    } else {
      root.removeAttribute("data-video-background");
      root.removeAttribute("data-video-screen");
    }
    return () => {
      root.removeAttribute("data-video-mode");
      root.removeAttribute("data-video-background");
      root.removeAttribute("data-video-screen");
    };
  }, [mode, showMedia, tab]);

  useEffect(() => {
    if (!showMedia) return;
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = settings.playbackRate;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      const pauseForMotion = settings.respectReducedMotion && localMode === null && reducedMotion.matches;
      if (mode !== "video" || (settings.pauseWhenHidden && document.hidden) || pauseForMotion) {
        video.pause();
      } else {
        void video.play().catch(() => setPlaying(false));
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    reducedMotion.addEventListener?.("change", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      reducedMotion.removeEventListener?.("change", sync);
      video.pause();
    };
  }, [showMedia, mode, frameReady, settings.playbackRate,
    settings.pauseWhenHidden, settings.respectReducedMotion, localMode]);

  function selectMode(next: "video" | "still") {
    const choice = { mode: next, base: sourceMode, url: backgroundVideoUrl };
    setDeviceChoice(choice);
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(choice));
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      // Keep in-memory controls functional.
    }
    if (next === "video") void videoRef.current?.play().catch(() => setPlaying(false));
    else videoRef.current?.pause();
  }

  if (!showMedia) return null;

  const mediaStyle: CSSProperties = {
    backgroundImage: "none",
    filter: `blur(${settings.blur}px) brightness(${settings.brightness}%) saturate(${settings.saturation}%)`,
    transform: settings.blur > 0 ? `scale(${1 + settings.blur / 250})` : undefined,
  };
  const tintStyle = {
    "--video-tint-color": settings.tintColor,
    "--video-tint-opacity": `${settings.tintOpacity}%`,
  } as CSSProperties;

  return (
    <>
      <div className="workspace-video-fallback" aria-hidden="true" />
      <video
        ref={videoRef}
        className={`background-video-layer${frameReady && !failed ? " background-video-ready" : ""}`}
        src={backgroundVideoUrl}
        muted
        loop={settings.loopVideo}
        playsInline
        preload="auto"
        style={mediaStyle}
        aria-hidden="true"
        onLoadedMetadata={(event) => {
          // Still mode must display a decoded frame of the selected video, not an image.
          const video = event.currentTarget;
          if (mode === "still" && Number.isFinite(video.duration) && video.duration > 0.15) {
            try { video.currentTime = Math.min(0.15, video.duration / 2); } catch { /* Seek may be unavailable. */ }
          }
        }}
        onLoadedData={() => { setFrameReady(true); setFailed(false); }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => { setFrameReady(false); setFailed(true); setPlaying(false); }}
      />
      <div className="video-background-veil background-video-veil-layer"
        style={tintStyle} aria-hidden="true" />
      {settings.showPauseButton && (
        <div className="workspace-video-controls" role="group" aria-label="Universal background video playback">
          <button type="button" className="workspace-video-control-button"
            aria-label={playing ? "Pause background video" : "Play background video"}
            title={playing ? "Pause video on this device" : "Play video on this device"}
            onClick={() => selectMode(playing ? "still" : "video")}>
            {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
            <span>{playing ? "Pause" : "Play"}</span>
          </button>
          <button type="button" className="workspace-video-control-button"
            aria-label="Restart background video" title="Restart background video"
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              video.currentTime = 0;
              selectMode("video");
            }}>
            <RotateCcw size={15} aria-hidden="true" />
          </button>
          <span className="workspace-video-speed" aria-label={mode === "still" ?
            "Still video frame" : `Playback speed ${settings.playbackRate} times`}>
            {mode === "still" ? "Still frame" : `${settings.playbackRate}×`}
          </span>
        </div>
      )}
    </>
  );
}
