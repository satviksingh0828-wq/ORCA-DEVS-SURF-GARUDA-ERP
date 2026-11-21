import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useCurrentVideoTab, videoEnabledForTab } from "@/lib/video-tabs";

const DEVICE_PAUSE_KEY = "garuda.background-video.user-paused";

/** One muted background video across routes; never changes the ORCA splash. */
export function WorkspaceBackgroundVideo() {
  const { backgroundVideoEnabled, backgroundVideoUrl, profile, ready: themeReady } = useTheme();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const currentTab = useCurrentVideoTab(pathname);
  const forbidden = pathname.startsWith("/screen-control-host") ||
    pathname.startsWith("/share") || pathname.includes("/print");
  const showVideo = themeReady && backgroundVideoEnabled && !forbidden &&
    videoEnabledForTab(profile.videoTabs, currentTab);
  const settings = profile.videoPlayback;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [devicePause, setDevicePause] = useState<boolean | null>(null);
  const paused = devicePause ?? settings.startPaused;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DEVICE_PAUSE_KEY);
      if (saved === "true" || saved === "false") setDevicePause(saved === "true");
    } catch {
      // Private browsing can disable storage; profile default still applies.
    }
  }, []);

  useEffect(() => {
    setReady(false);
    setFailed(false);
    setPlaying(false);
  }, [backgroundVideoUrl]);

  useEffect(() => {
    const root = document.documentElement;
    if (showVideo) {
      root.dataset.videoBackground = "on";
      root.dataset.videoScreen = currentTab === "login" || currentTab === "passkey" ? "auth" : "workspace";
    } else {
      root.removeAttribute("data-video-background");
      root.removeAttribute("data-video-screen");
    }
    return () => {
      root.removeAttribute("data-video-background");
      root.removeAttribute("data-video-screen");
    };
  }, [showVideo, currentTab]);

  useEffect(() => {
    if (!showVideo) return;
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = settings.playbackRate;
    const sync = () => {
      if (paused || (settings.pauseWhenHidden && document.hidden)) {
        video.pause();
      } else {
        void video.play().catch(() => setPlaying(false));
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      video.pause();
    };
  }, [showVideo, paused, settings.playbackRate, settings.pauseWhenHidden, ready]);

  function setPausedByUser(next: boolean) {
    setDevicePause(next);
    try {
      window.localStorage.setItem(DEVICE_PAUSE_KEY, String(next));
    } catch {
      // Keep controls usable even when local storage is disabled.
    }
  }

  if (!showVideo) return null;
  return (
    <>
      <div className="workspace-video-fallback" aria-hidden="true" />
      <video
        ref={videoRef}
        className={`background-video-layer${ready && !failed ? " background-video-ready" : ""}`}
        src={backgroundVideoUrl}
        poster="/garuda-banner.webp"
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
        onCanPlay={() => { setReady(true); setFailed(false); }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => { setFailed(true); setReady(false); setPlaying(false); }}
      />
      <div className="video-background-veil background-video-veil-layer" aria-hidden="true" />
      {settings.showPauseButton && (
        <div className="workspace-video-controls" role="group" aria-label="Background video playback">
          <button type="button" className="workspace-video-control-button"
            aria-label={playing ? "Pause background video" : "Resume background video"}
            title={playing ? "Pause background video" : "Resume background video"}
            onClick={() => setPausedByUser(!paused)}>
            {playing ? <Pause size={16} aria-hidden="true"/> : <Play size={16} aria-hidden="true"/>}
            <span>{playing ? "Pause" : "Play"}</span>
          </button>
          <button type="button" className="workspace-video-control-button"
            aria-label="Restart background video" title="Restart background video"
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              video.currentTime = 0;
              setPausedByUser(false);
              void video.play().catch(() => setPlaying(false));
            }}>
            <RotateCcw size={15} aria-hidden="true" />
          </button>
          <span className="workspace-video-speed" aria-label={`Playback speed ${settings.playbackRate} times`}>
            {settings.playbackRate}×
          </span>
        </div>
      )}
    </>
  );
}
