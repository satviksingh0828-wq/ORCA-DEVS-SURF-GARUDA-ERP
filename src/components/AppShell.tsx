import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, PanelLeftClose, PanelLeftOpen, Server, ShieldCheck, User } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useSession } from "@/lib/session";
import { serverChangePassword } from "@/lib/user-auth";
import { useOrcaAI } from "@/lib/orca-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MeetTrigger } from "@/components/MeetPanel";
import { NotificationBell } from "@/components/NotificationBell";
import { cn } from "@/lib/utils";
import { isAdminLike } from "@/lib/roles";
import { useTheme } from "@/lib/theme";

let sharedBackgroundVideo: HTMLVideoElement | null = null;
let sharedBackgroundVeil: HTMLDivElement | null = null;
let sharedBackgroundVideoUrl = "";
let sharedBackgroundVideoReady = false;

function ChangePasswordDialog({
  open,
  onOpenChange,
  sessionToken,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionToken?: string;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError("");
    setSuccess(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!sessionToken) return setError("Your session has expired. Please sign in again.");
    if (newPassword.length < 6) return setError("The new password must be at least 6 characters.");
    if (newPassword !== confirmPassword) return setError("The new passwords do not match.");
    setSaving(true);
    try {
      const result = await serverChangePassword({
        data: { sessionToken, currentPassword, newPassword },
      });
      if (!result.ok) setError(result.error ?? "Could not change the password.");
      else {
        setSuccess(true);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch {
      setError("Could not change the password. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Update the password used to sign in to Garuda ERP.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={6}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={6}
              required
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {success && (
            <p className="text-sm text-emerald-600" role="status">
              Password changed successfully.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Change password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

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
  footer,
  breadcrumb,
  headerStart,
  headerEnd,
  mainClassName,
  variant = "default",
  shellTitle = "LTMS",
  showSidebarToggle = true,
}: {
  children: ReactNode;
  footer?: ReactNode;
  breadcrumb?: ReactNode;
  /** Extra content rendered directly after the logo and before the module title */
  headerStart?: ReactNode;
  /** Extra content rendered between the breadcrumb and the user area (e.g. sidebar toggle) */
  headerEnd?: ReactNode;
  mainClassName?: string;
  variant?: "default" | "ltms";
  shellTitle?: string;
  showSidebarToggle?: boolean;
}) {
  const { signOut, user } = useSession();
  const navigate = useNavigate();
  const { open, expanded } = useOrcaAI();
  const { theme, backgroundVideoEnabled, backgroundVideoUrl, videoGlassAppearance } = useTheme();
  const isAdmin = isAdminLike(user?.role);
  const isViewer = user?.role === "viewer";
  const displayName = user?.fullName ?? user?.username ?? "User";
  const displayRole = isAdmin
    ? user?.role === "semi_admin"
      ? "Semi-Admin"
      : "Admin"
    : isViewer
      ? "Viewer"
      : "User";
  const avatarInitials =
    displayName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] ?? "")
      .join("")
      .toUpperCase() || "U";
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try {
      return (
        typeof window !== "undefined" &&
        window.localStorage.getItem("app.sidebar.hidden") === "true"
      );
    } catch {
      return false;
    }
  });
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (sidebarHidden) root.setAttribute("data-app-sidebar-hidden", "true");
    else root.removeAttribute("data-app-sidebar-hidden");
    try {
      window.localStorage.setItem("app.sidebar.hidden", String(sidebarHidden));
    } catch {
      // Keep the current-session toggle usable when storage is unavailable.
    }
  }, [sidebarHidden]);

  useEffect(() => {
    if (!accountMenuOpen || variant !== "ltms") return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node))
        setAccountMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountMenuOpen, variant]);

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
              alt="Garuda Logistics Solutions"
              className={cn("h-8 w-auto sm:h-10", variant === "ltms" ? "ltms-app-shell-logo" : "")}
            />
          </Link>
          {headerStart && <div className="ml-1 shrink-0">{headerStart}</div>}
          {variant === "ltms" && <span className="ltms-app-shell-title">{shellTitle}</span>}
          {breadcrumb && variant !== "ltms" && (
            <div
              className={cn(
                "ml-2 hidden shrink-0 md:block",
                variant === "ltms" ? "ltms-app-shell-breadcrumb" : "",
              )}
            >
              {breadcrumb}
            </div>
          )}
          {headerEnd && <div className="ml-2 hidden sm:block">{headerEnd}</div>}
          {showSidebarToggle && (
            <button
              type="button"
              onClick={() => setSidebarHidden((hidden) => !hidden)}
              title={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
              aria-label={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
              aria-pressed={sidebarHidden}
              className={cn(
                "ml-1 hidden h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:flex",
                variant === "ltms" ? "ltms-app-shell-icon-button" : "",
              )}
            >
              {sidebarHidden ? (
                <PanelLeftOpen className="size-4" />
              ) : (
                <PanelLeftClose className="size-4" />
              )}
              <span className="hidden xl:inline">
                {sidebarHidden ? "Show sidebar" : "Hide sidebar"}
              </span>
            </button>
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
            {variant === "ltms" ? (
              user && (
                <div ref={accountMenuRef} className="ltms-app-shell-account">
                  <button
                    type="button"
                    className="ltms-app-shell-avatar"
                    title={displayName}
                    aria-label="Open account menu"
                    aria-expanded={accountMenuOpen}
                    aria-haspopup="menu"
                    onClick={() => setAccountMenuOpen((open) => !open)}
                  >
                    {avatarInitials}
                  </button>
                  {accountMenuOpen && (
                    <div className="ltms-app-shell-account-menu" role="menu">
                      <div className="ltms-app-shell-account-header">
                        <div className="ltms-app-shell-account-name">{displayName}</div>
                        <div className="ltms-app-shell-account-role">{displayRole}</div>
                      </div>
                      <div className="ltms-app-shell-account-divider" />
                      <button
                        type="button"
                        className="ltms-app-shell-account-signout"
                        role="menuitem"
                        onClick={() => {
                          setAccountMenuOpen(false);
                          setChangePasswordOpen(true);
                        }}
                      >
                        <ShieldCheck className="size-4" />
                        <span>Change password</span>
                      </button>
                      <button
                        type="button"
                        data-no-remote-control
                        className="ltms-app-shell-account-signout"
                        role="menuitem"
                        onClick={() => {
                          setAccountMenuOpen(false);
                          signOut();
                          navigate({ to: "/", replace: true });
                        }}
                      >
                        <LogOut className="size-4" />
                        <span>Sign out</span>
                      </button>
                    </div>
                  )}
                </div>
              )
            ) : (
              <>
                <span className="hidden min-w-0 items-center gap-2 text-sm text-muted-foreground sm:flex">
                  {isAdmin ? (
                    <ShieldCheck className="size-3.5 shrink-0 text-primary" />
                  ) : (
                    <User className="size-3.5 shrink-0" />
                  )}
                  <span className="max-w-[120px] truncate font-medium text-foreground">
                    {user?.fullName ?? user?.username}
                  </span>
                  <span className="hidden shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide md:inline-block">
                    {displayRole}
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
                  className="shrink-0"
                >
                  <LogOut className="size-4" />
                  <span className="hidden sm:inline">Sign out</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
      <ChangePasswordDialog
        open={changePasswordOpen}
        onOpenChange={setChangePasswordOpen}
        sessionToken={user?.sessionToken}
      />
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
      {footer}
    </div>
  );
}
