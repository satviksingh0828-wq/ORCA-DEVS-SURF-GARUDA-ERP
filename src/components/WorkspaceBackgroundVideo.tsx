import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useTheme } from "@/lib/theme";
import { useCurrentVideoTab, videoEnabledForTab } from "@/lib/video-tabs";

/**
 * Single workspace backdrop for unauthenticated and authenticated screens.
 * Mounted once inside ThemeProvider so route changes never restart video.
 * The original ORCA splash screen remains completely independent.
 */
export function WorkspaceBackgroundVideo() {
  const { backgroundVideoEnabled, backgroundVideoUrl, profile } = useTheme();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const currentTab = useCurrentVideoTab(pathname);
  // Keep special host, sharing and print-only routes free from decorative video.
  const videoAllowed = !pathname.startsWith("/screen-control-host") &&
    !pathname.startsWith("/share") && !pathname.includes("/print");
  const showVideo = backgroundVideoEnabled && videoAllowed && videoEnabledForTab(profile.videoTabs, currentTab);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (showVideo) {
      root.setAttribute("data-video-background", "on");
      root.setAttribute("data-video-screen", ["login", "passkey"].includes(currentTab) ? "auth" : "workspace");
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
    setReady(false);
    setFailed(false);
  }, [backgroundVideoUrl]);

  if (!showVideo) return null;
  return (
    <>
      <div className="workspace-video-fallback" aria-hidden="true" />
      <video
        className={`background-video-layer${ready && !failed ? " background-video-ready" : ""}`}
        src={backgroundVideoUrl}
        poster="/garuda-banner.webp"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
        onCanPlay={(event) => {
          setReady(true);
          setFailed(false);
          void event.currentTarget.play().catch(() => setFailed(true));
        }}
        onError={() => {
          setFailed(true);
          setReady(false);
        }}
      />
      <div className="video-background-veil background-video-veil-layer" aria-hidden="true" />
    </>
  );
}
