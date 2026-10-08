import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, Server, ShieldCheck, User } from "lucide-react";
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { useSession } from "@/lib/session";
import { useOrcaAI } from "@/lib/orca-context";
import { Button } from "@/components/ui/button";
import { MeetTrigger } from "@/components/MeetPanel";
import { NotificationBell } from "@/components/NotificationBell";
import { cn } from "@/lib/utils";
import { isAdminLike } from "@/lib/roles";
import { useTheme } from "@/lib/theme";

let sharedBackgroundVideo: HTMLVideoElement | null = null;
let sharedBackgroundVeil: HTMLDivElement | null = null;
let sharedBackgroundVideoUrl = "";
let sharedBackgroundVideoReady = false;

function ensureSharedBackgroundVideo() {
  if (sharedBackgroundVideo && sharedBackgroundVeil) {
    if (!document.body.contains(sharedBackgroundVideo))
      document.body.appendChild(sharedBackgroundVideo);
    if (!document.body.contains(sharedBackgroundVeil))
      document.body.appendChild(sharedBackgroundVeil);
    return { video: sharedBackgroundVideo, veil: sharedBackgroundVeil };
  }

  const video = document.createElement("video");
  video.className = "background-video-layer";
  video.autoplay = true;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.poster = "/garuda-banner.webp";
  video.setAttribute("aria-hidden", "true");
  video.addEventListener("canplay", () => {
    sharedBackgroundVideoReady = true;
    video.classList.add("background-video-ready");
  });

  const veil = document.createElement("div");
  veil.className = "video-background-veil background-video-veil-layer";
  veil.setAttribute("aria-hidden", "true");

  document.body.append(video, veil);
  sharedBackgroundVideo = video;
  sharedBackgroundVeil = veil;
  return { video, veil };
}

export function AppShell({
  children,
  breadcrumb,
  headerEnd,
  mainClassName,
  variant = "default",
}: {
  children: ReactNode;
  breadcrumb?: ReactNode;
  /** Extra content rendered between the breadcrumb and the user area (e.g. sidebar toggle) */
  headerEnd?: ReactNode;
  mainClassName?: string;
  variant?: "default" | "ltms";
}) {
  const { signOut, user } = useSession();
  const navigate = useNavigate();
  const { open, expanded } = useOrcaAI();
  const { theme, backgroundVideoEnabled, backgroundVideoUrl, videoGlassAppearance } = useTheme();
  const isAdmin = isAdminLike(user?.role);
  const isViewer = user?.role === "viewer";

  useEffect(() => {
    const root = document.documentElement;
    const previousAttribute = root.getAttribute("data-video-background");
    const properties = [
      "--video-glass-opacity",
      "--video-background-veil",
      "--video-glass-text-color",
    ];
    const previousStyles = properties.map((property) => ({
      property,
      value: root.style.getPropertyValue(property),
      priority: root.style.getPropertyPriority(property),
    }));

    if (backgroundVideoEnabled) root.setAttribute("data-video-background", "on");
    else root.removeAttribute("data-video-background");
    root.style.setProperty("--video-glass-opacity", `${videoGlassAppearance.surfaceOpacity}%`);
    root.style.setProperty("--video-background-veil", `${videoGlassAppearance.backgroundVeil}%`);
    root.style.setProperty("--video-glass-text-color", videoGlassAppearance.textColor);

    return () => {
      if (previousAttribute === null) root.removeAttribute("data-video-background");
      else root.setAttribute("data-video-background", previousAttribute);
      previousStyles.forEach(({ property, value, priority }) => {
        if (value) root.style.setProperty(property, value, priority);
        else root.style.removeProperty(property);
      });
    };
  }, [backgroundVideoEnabled, videoGlassAppearance]);

  useEffect(() => {
    const { video, veil } = ensureSharedBackgroundVideo();
    video.style.display = backgroundVideoEnabled ? "block" : "none";
    veil.style.display = backgroundVideoEnabled ? "block" : "none";

    if (!backgroundVideoEnabled) return;
    if (sharedBackgroundVideoUrl !== backgroundVideoUrl) {
      sharedBackgroundVideoUrl = backgroundVideoUrl;
      sharedBackgroundVideoReady = false;
      video.classList.remove("background-video-ready");
      video.src = backgroundVideoUrl;
      video.load();
    }
    if (sharedBackgroundVideoReady) video.classList.add("background-video-ready");
    if (document.body.dataset.screenControlActive !== "true")
      void video.play().catch(() => undefined);
  }, [backgroundVideoEnabled, backgroundVideoUrl]);

  useEffect(() => {
    return () => {
      if (sharedBackgroundVideo) sharedBackgroundVideo.style.display = "none";
      if (sharedBackgroundVeil) sharedBackgroundVeil.style.display = "none";
    };
  }, []);

  return (
    <div
      data-video-background={backgroundVideoEnabled ? "on" : "off"}
      style={
        {
          "--video-glass-opacity": `${videoGlassAppearance.surfaceOpacity}%`,
          "--video-background-veil": `${videoGlassAppearance.backgroundVeil}%`,
          "--video-glass-text-color": videoGlassAppearance.textColor,
        } as CSSProperties
      }
      className={cn(
        "relative flex h-screen flex-col overflow-hidden transition-all duration-300",
        backgroundVideoEnabled ? "bg-transparent" : "bg-background",
        user && open && !expanded && variant !== "ltms" ? "lg:mr-[360px]" : "",
        variant === "ltms" ? "ltms-app-shell" : "",
      )}
    >
      <header
        className={cn(
          "relative z-30 shrink-0 border-b border-border bg-card/85 backdrop-blur",
          variant === "ltms" ? "ltms-app-shell-header" : "",
        )}
      >
        <div
          className={cn(
            "flex h-16 w-full items-center gap-1.5 px-3 sm:gap-3 sm:px-6",
            variant === "ltms" ? "ltms-app-shell-header-inner" : "",
          )}
        >
          <Link to="/home" className="shrink-0" aria-label="Garuda Logistics home">
            <img
              src={
                variant === "ltms" ||
                theme === "neon" ||
                theme === "midnight" ||
                theme === "forest" ||
                theme === "storm"
                  ? "/garuda-logo.png"
                  : "/garuda-logo-light.png"
              }
              alt="Garuda Logistics Solution"
              className={cn("h-8 w-auto sm:h-10", variant === "ltms" ? "ltms-app-shell-logo" : "")}
            />
          </Link>
          {breadcrumb && (
            <div
              className={cn(
                "ml-2 hidden shrink-0 md:block",
                variant === "ltms" ? "ltms-app-shell-breadcrumb" : "",
              )}
            >
              {breadcrumb}
            </div>
          )}
          {headerEnd && variant !== "ltms" && (
            <div className="ml-2 hidden lg:block">{headerEnd}</div>
          )}
          <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-3">
            {isAdmin && (
              <Link
                to="/system"
                title="System"
                className={cn(
                  "relative flex size-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  variant === "ltms" ? "ltms-app-shell-icon-button" : "",
                )}
              >
                <Server className="size-4" />
              </Link>
            )}
            {(isAdmin || user?.role === "viewer" || user?.role === "basic") && <NotificationBell />}
            <div
              data-app-shell-header-actions
              className={cn(
                "flex shrink-0 items-center gap-1.5 sm:gap-2",
                variant === "ltms" ? "ltms-app-shell-header-actions" : "",
              )}
            />
            {user && variant !== "ltms" && <MeetTrigger />}
            <span
              className={cn(
                "hidden min-w-0 items-center gap-2 text-sm text-muted-foreground sm:flex",
                variant === "ltms" ? "ltms-app-shell-user" : "",
              )}
            >
              {isAdmin ? (
                <ShieldCheck className="size-3.5 text-primary shrink-0" />
              ) : (
                <User className="size-3.5 shrink-0" />
              )}
              <span className="font-medium text-foreground truncate max-w-[120px]">
                {user?.fullName ?? user?.username}
              </span>
              <span className="hidden md:inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide shrink-0">
                {isAdmin
                  ? user?.role === "semi_admin"
                    ? "Semi-Admin"
                    : "Admin"
                  : isViewer
                    ? "Viewer"
                    : "User"}
              </span>
            </span>
            <Button
              variant="outline"
              size="sm"
              data-no-remote-control
              onClick={() => {
                signOut();
                navigate({ to: "/", replace: true });
              }}
              className={cn("shrink-0", variant === "ltms" ? "ltms-app-shell-signout" : "")}
            >
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>
      <main
        className={cn(
          "relative z-10",
          "min-h-0 flex-1 overflow-x-hidden overflow-y-auto [overflow-anchor:none]",
          "w-full max-w-none px-2 py-4 sm:px-4 sm:py-6",
          variant === "ltms" ? "ltms-app-shell-main" : "",
          mainClassName,
        )}
      >
        {children}
      </main>
    </div>
  );
}
