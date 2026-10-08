import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Building,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Loader2,
  Search,
  ShieldCheck,
  Wifi,
  MessageCircle,
  Mail,
  Film,
} from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { SharedSidebar } from "@/components/SharedSidebar";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { CompanySettings } from "@/components/settings/CompanySettings";
import { BranchSettings } from "@/components/settings/BranchSettings";
import { AttendanceModuleSettings } from "@/components/settings/AttendanceModuleSettings";
import { DEFAULT_BACKGROUND_VIDEO_URL, THEMES, useTheme, type ThemeId } from "@/lib/theme";
import { DEFAULT_VIDEO_GLASS_APPEARANCE, type VideoGlassAppearance } from "@/lib/video-glass";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useAppSettings, useUpdateAppSettings } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { WhatsAppSettings } from "@/components/settings/WhatsAppSettings";
import { MailSettings } from "@/components/settings/MailSettings";
import { HRMSAccountsSettings } from "@/components/settings/HRMSAccountsSettings";
import { TMSAccountsSettings } from "@/components/settings/TMSAccountsSettings";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — ORCA DEVS SURF" },
      {
        name: "description",
        content: "Manage company profile, branches, integrations and security for ORCA DEVS SURF.",
      },
      { property: "og:title", content: "Settings — ORCA DEVS SURF" },
      {
        property: "og:description",
        content: "Company profile, branches, integrations and security for ORCA DEVS SURF.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <SettingsRouteContent />
    </RequireAuth>
  ),
});

function SettingsRouteContent() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname.startsWith("/settings/") ? <Outlet /> : <SettingsPage />;
}

const TABS = [
  { id: "company", label: "Company", desc: "Profile & registration", icon: Building },
  { id: "branch", label: "Branch", desc: "Locations & managers", icon: Building2 },
  { id: "attendance", label: "Attendance Module", desc: "Device & service connection", icon: Wifi },
  { id: "whatsapp", label: "WhatsApp", desc: "HR PDF sending & connection", icon: MessageCircle },
  { id: "mail", label: "Mail", desc: "All email notifications", icon: Mail },
  {
    id: "hrms-accounts",
    label: "HRMS Accounts",
    desc: "Payroll and HR ledger mappings",
    icon: Building2,
  },
  {
    id: "tms-accounts",
    label: "LTMS Accounts Map",
    desc: "LTMS and Workmen ledger mappings",
    icon: Building2,
  },
  {
    id: "passkey",
    label: "Passkey Security",
    desc: "Admin-controlled device protection",
    icon: ShieldCheck,
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

function SettingsPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>("company");
  const [navOpen, setNavOpen] = useState(true);

  useEffect(() => {
    if (user && user.role !== "admin") navigate({ to: "/home", replace: true });
  }, [navigate, user]);

  if (user?.role !== "admin") return null;

  const active = TABS.find((t) => t.id === tab)!;

  return (
    <AppShell
      variant="ltms"
      shellTitle="Settings"
      breadcrumb={
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/home" className="hover:text-foreground">
            Workspace
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground">Settings</span>
        </span>
      }
      headerEnd={
        <button
          type="button"
          onClick={() => setNavOpen((v) => !v)}
          title={navOpen ? "Hide sidebar" : "Show sidebar"}
          className="hidden lg:flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {navOpen ? (
            <>
              <PanelLeftClose className="size-3.5" />
              <span>Hide sidebar</span>
            </>
          ) : (
            <>
              <PanelLeftOpen className="size-3.5" />
              <span>Show sidebar</span>
            </>
          )}
        </button>
      }
    >
      <div
        className={`grid gap-6 ${navOpen ? "lg:grid-cols-[220px_minmax(0,1fr)]" : "grid-cols-1"}`}
      >
        {/* Desktop left nav */}
        {navOpen && (
          <SharedSidebar open={navOpen} width="220px" label="Settings">
            <ul className="space-y-1">
              {TABS.map((t) => {
                const Icon = t.icon;
                const isActive = t.id === tab;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setTab(t.id)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-200 ${
                        isActive
                          ? "bg-primary-soft text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <Icon className={`size-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
                      <span className="leading-tight min-w-0">
                        <span className="block text-sm font-medium truncate">{t.label}</span>
                        <span className="block text-[11px] opacity-70 truncate">{t.desc}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </SharedSidebar>
        )}

        {/* Mobile dropdown navigation */}
        <MobileTabDropdown tabs={TABS} activeId={tab} label="Settings" onChange={setTab} />

        <div key={tab} className="animate-fade-in min-w-0">
          <header className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">{active.label}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{active.desc}</p>
          </header>
          {tab === "company" ? <CompanySettings /> : null}
          {tab === "branch" ? <BranchSettings /> : null}
          {tab === "attendance" ? <AttendanceModuleSettings /> : null}
          {tab === "whatsapp" ? <WhatsAppSettings /> : null}
          {tab === "mail" ? <MailSettings /> : null}
          {tab === "hrms-accounts" ? <HRMSAccountsSettings /> : null}
          {tab === "tms-accounts" ? <TMSAccountsSettings /> : null}
          {tab === "passkey" ? <PasskeySecurityPanel /> : null}
        </div>
      </div>
    </AppShell>
  );
}

function PasskeySecurityPanel() {
  const { data: settings, isLoading } = useAppSettings();
  const updateSettings = useUpdateAppSettings();
  const enabled = settings?.passkey_protection_enabled === true;

  function toggleProtection() {
    if (!settings?.id) {
      toast.error("App settings are not available yet.");
      return;
    }
    updateSettings.mutate(
      { id: settings.id, values: { passkey_protection_enabled: !enabled } as never },
      {
        onSuccess: () => toast.success(`Passkey protection ${!enabled ? "enabled" : "disabled"}`),
        onError: (error) =>
          toast.error(error instanceof Error ? error.message : "Could not save passkey setting"),
      },
    );
  }

  return (
    <div className="animate-fade-up space-y-5">
      <section className="surface-card p-6">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Passkey protection</h3>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              When enabled, the existing Windows Hello / passkey device gate verifies the device
              before the full app renders. It reuses the existing device registrations, user
              assignments, and challenge tables.
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 p-4">
          <div>
            <p className="text-sm font-medium">Require passkey verification</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Current status:{" "}
              <strong className="text-foreground">{enabled ? "Enabled" : "Disabled"}</strong>
            </p>
          </div>
          <Button
            type="button"
            onClick={toggleProtection}
            disabled={isLoading || updateSettings.isPending}
          >
            {updateSettings.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {enabled ? "Disable protection" : "Enable protection"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function ThemePanel() {
  const {
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
  } = useTheme();
  const { user } = useSession();
  const [videoUrlDraft, setVideoUrlDraft] = useState(backgroundVideoUrl);
  const [pixabayQuery, setPixabayQuery] = useState(() => {
    const defaults = ["nature", "ocean", "forest", "mountains", "city", "abstract"];
    return defaults[Math.floor(Math.random() * defaults.length)];
  });
  const [pixabayPage, setPixabayPage] = useState(1);
  const [pixabayVideos, setPixabayVideos] = useState<
    Array<{
      id: number;
      pageURL: string;
      duration: number;
      videoUrl: string;
      thumbnail: string;
      width: number;
      height: number;
    }>
  >([]);
  const [pixabayLoading, setPixabayLoading] = useState(false);
  const [pixabayError, setPixabayError] = useState("");
  const [glassOpacityDraft, setGlassOpacityDraft] = useState(videoGlassAppearance.surfaceOpacity);
  const [backgroundVeilDraft, setBackgroundVeilDraft] = useState(
    videoGlassAppearance.backgroundVeil,
  );
  const [glassTextColorDraft, setGlassTextColorDraft] = useState(videoGlassAppearance.textColor);
  useEffect(() => setVideoUrlDraft(backgroundVideoUrl), [backgroundVideoUrl]);
  useEffect(() => {
    setGlassOpacityDraft(videoGlassAppearance.surfaceOpacity);
    setBackgroundVeilDraft(videoGlassAppearance.backgroundVeil);
    setGlassTextColorDraft(videoGlassAppearance.textColor);
  }, [videoGlassAppearance]);

  async function searchPixabay(nextPage = 1) {
    const query = pixabayQuery.trim();
    if (!query) {
      toast.error("Enter a video search term.");
      return;
    }
    if (!user?.sessionToken) {
      toast.error("Your session has expired. Please sign in again.");
      return;
    }
    setPixabayLoading(true);
    setPixabayError("");
    try {
      const params = new URLSearchParams({ q: query, page: String(nextPage) });
      const response = await fetch(`/api/pixabay-videos?${params.toString()}`, {
        headers: { Authorization: `Bearer ${user.sessionToken}` },
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        videos?: typeof pixabayVideos;
      } | null;
      if (!response.ok) throw new Error(body?.error || "Pixabay search failed.");
      setPixabayVideos(body?.videos ?? []);
      setPixabayPage(nextPage);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Pixabay search failed.";
      setPixabayError(message);
      setPixabayVideos([]);
    } finally {
      setPixabayLoading(false);
    }
  }

  async function selectPixabayVideo(url: string) {
    try {
      await setBackgroundVideo({ url });
      setVideoUrlDraft(url);
      toast.success("Pixabay video selected and saved as the workspace background.");
    } catch {
      toast.error(
        "Could not save the selected video. Run the supplied Supabase migration, then try again.",
      );
    }
  }

  useEffect(() => {
    if (user?.sessionToken && !pixabayVideos.length && !pixabayLoading && !pixabayError) {
      void searchPixabay(1);
    }
    // Load the default ten results once per signed-in Settings session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.sessionToken]);

  async function saveVideoUrl() {
    let parsed: URL;
    try {
      parsed = new URL(videoUrlDraft.trim());
    } catch {
      toast.error("Enter a valid direct video URL.");
      return;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      toast.error("Video URLs must start with https:// or http://.");
      return;
    }
    try {
      await setBackgroundVideo({ url: parsed.toString() });
      toast.success("Background video URL saved.");
    } catch {
      toast.error(
        "Could not sync the video URL. Run the supplied Supabase migration, then save again.",
      );
    }
  }

  async function toggleBackgroundVideo() {
    try {
      await setBackgroundVideo({ enabled: !backgroundVideoEnabled });
      toast.success(`Background video ${backgroundVideoEnabled ? "disabled" : "enabled"}.`);
    } catch {
      toast.error(
        "Could not sync video settings. Run the supplied Supabase migration, then try again.",
      );
    }
  }

  async function saveGlassAppearance() {
    const appearance: VideoGlassAppearance = {
      surfaceOpacity: glassOpacityDraft,
      backgroundVeil: backgroundVeilDraft,
      textColor: glassTextColorDraft,
    };
    try {
      await setVideoGlassAppearance(appearance);
      toast.success("Video glass readability settings saved for the workspace.");
    } catch {
      toast.error(
        "Applied on this device, but cloud sync needs the glass-controls Supabase migration.",
      );
    }
  }

  async function resetGlassAppearance() {
    setGlassOpacityDraft(DEFAULT_VIDEO_GLASS_APPEARANCE.surfaceOpacity);
    setBackgroundVeilDraft(DEFAULT_VIDEO_GLASS_APPEARANCE.backgroundVeil);
    setGlassTextColorDraft(DEFAULT_VIDEO_GLASS_APPEARANCE.textColor);
    try {
      await setVideoGlassAppearance(DEFAULT_VIDEO_GLASS_APPEARANCE);
      toast.success("Glass readability settings reset to defaults.");
    } catch {
      toast.error(
        "Defaults are applied on this device; cloud sync needs the glass-controls Supabase migration.",
      );
    }
  }

  return (
    <div className="animate-fade-up space-y-5">
      <section className="surface-card p-6">
        <h3 className="text-sm font-semibold tracking-tight">Accent theme</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Applies across the whole workspace and is saved to the cloud.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Video Glass is an optional frosted look that pairs especially well with the background
          video; the video can still be used with any theme.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {THEMES.map((t) => {
            const isActive = t.id === theme;
            return (
              <button
                key={t.id}
                type="button"
                disabled={saving}
                onClick={() => setTheme(t.id as ThemeId)}
                className={`relative flex items-center gap-3 rounded-xl border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 ${
                  isActive
                    ? "border-primary bg-primary-soft"
                    : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <span
                  className="size-9 shrink-0 rounded-lg"
                  style={{ backgroundColor: t.swatch }}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{t.hint}</span>
                </span>
                {isActive ? <Check className="absolute right-3 top-3 size-4 text-primary" /> : null}
              </button>
            );
          })}
        </div>
      </section>

      <section className="surface-card p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Film className="size-5" />
          </span>
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Workspace background video</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose whether the muted video appears behind workspace pages and set a direct
              MP4/WebM URL. This preference is shared with all users.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 p-4">
          <div>
            <p className="text-sm font-medium">Background video</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Current status:{" "}
              <strong className="text-foreground">{backgroundVideoEnabled ? "On" : "Off"}</strong>
            </p>
          </div>
          <Button
            type="button"
            variant={backgroundVideoEnabled ? "outline" : "default"}
            onClick={() => void toggleBackgroundVideo()}
            disabled={videoSaving}
          >
            {videoSaving ? <Loader2 className="size-4 animate-spin" /> : null}
            {backgroundVideoEnabled ? "Turn video off" : "Turn video on"}
          </Button>
        </div>
        <div className="mt-4 space-y-3">
          <label htmlFor="workspace-background-video" className="text-sm font-medium">
            Video URL
          </label>
          <Input
            id="workspace-background-video"
            type="url"
            value={videoUrlDraft}
            onChange={(event) => setVideoUrlDraft(event.target.value)}
            placeholder="https://example.com/background.mp4"
          />
          <p className="text-xs text-muted-foreground">
            Use a direct video file URL; streaming pages such as YouTube links are not supported.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => void saveVideoUrl()}
              disabled={videoSaving || !videoUrlDraft.trim()}
            >
              {videoSaving ? <Loader2 className="size-4 animate-spin" /> : null}
              Save video URL
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setVideoUrlDraft(DEFAULT_BACKGROUND_VIDEO_URL)}
            >
              Use current video
            </Button>
          </div>
        </div>
        <div className="mt-6 space-y-4 rounded-xl border border-border bg-muted/20 p-4">
          <div>
            <h4 className="text-sm font-semibold">Search Pixabay videos</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Browse 1920×1080 or larger desktop videos. Results use the large Pixabay rendition;
              the API key stays on the server.
            </p>
          </div>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void searchPixabay(1);
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="pl-9"
                value={pixabayQuery}
                onChange={(event) => setPixabayQuery(event.target.value)}
                placeholder="Search nature, city, ocean..."
                aria-label="Search Pixabay videos"
              />
            </div>
            <Button type="submit" disabled={pixabayLoading || !pixabayQuery.trim()}>
              {pixabayLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              Search
            </Button>
          </form>
          {pixabayError ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {pixabayError}
            </p>
          ) : null}
          {pixabayVideos.length ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {pixabayVideos.map((video) => (
                  <article
                    key={video.id}
                    className="overflow-hidden rounded-xl border border-border bg-card"
                  >
                    <div className="aspect-video bg-slate-900">
                      {video.thumbnail ? (
                        <img
                          src={video.thumbnail}
                          alt="Pixabay video preview"
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="space-y-2 p-3">
                      <p className="text-xs text-muted-foreground">
                        {video.width}×{video.height} · {video.duration}s
                      </p>
                      <Button
                        type="button"
                        className="w-full"
                        onClick={() => void selectPixabayVideo(video.videoUrl)}
                      >
                        Use this video
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={pixabayLoading || pixabayPage <= 1}
                  onClick={() => void searchPixabay(pixabayPage - 1)}
                >
                  <ChevronLeft className="size-4" /> Previous
                </Button>
                <span className="text-xs text-muted-foreground">
                  Page {pixabayPage} · 10 videos
                </span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pixabayLoading || pixabayVideos.length < 10}
                  onClick={() => void searchPixabay(pixabayPage + 1)}
                >
                  Next <ChevronRight className="size-4" />
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </section>

      <section className="surface-card space-y-5 p-6">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Video glass readability</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Tune the frosted panels and text shown while the background video is on. These controls
            apply across every accent theme and sync to the whole workspace.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="video-glass-opacity" className="text-sm font-medium">
                Glass surface opacity
              </label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {glassOpacityDraft}%
              </span>
            </div>
            <input
              id="video-glass-opacity"
              type="range"
              min={50}
              max={98}
              step={1}
              value={glassOpacityDraft}
              onChange={(event) => setGlassOpacityDraft(Number(event.target.value))}
              className="w-full accent-primary"
            />
            <p className="text-xs text-muted-foreground">
              Higher opacity makes detail panels brighter and easier to read; lower opacity shows
              more of the video through them.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="video-veil" className="text-sm font-medium">
                Video veil
              </label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {backgroundVeilDraft}%
              </span>
            </div>
            <input
              id="video-veil"
              type="range"
              min={0}
              max={70}
              step={1}
              value={backgroundVeilDraft}
              onChange={(event) => setBackgroundVeilDraft(Number(event.target.value))}
              className="w-full accent-primary"
            />
            <p className="text-xs text-muted-foreground">
              Applied directly over the background video: increase it to soften busy footage, or
              lower it to see more of the video.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <label htmlFor="video-glass-text-color" className="text-sm font-medium">
              Workspace text color
            </label>
            <div className="flex items-center gap-3">
              <Input
                id="video-glass-text-color"
                type="color"
                value={glassTextColorDraft}
                onChange={(event) => setGlassTextColorDraft(event.target.value)}
                className="h-10 w-16 cursor-pointer p-1"
              />
              <span className="font-mono text-xs uppercase text-muted-foreground">
                {glassTextColorDraft}
              </span>
            </div>
          </div>
          <div
            className="min-w-64 flex-1 rounded-xl border p-3 text-sm"
            style={{
              color: glassTextColorDraft,
              backgroundColor: `color-mix(in oklch, var(--card) ${glassOpacityDraft}%, transparent)`,
              backdropFilter: "blur(14px)",
            }}
          >
            Preview: Shipment Details and field labels will use this text color.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => void saveGlassAppearance()} disabled={glassSaving}>
            {glassSaving ? <Loader2 className="size-4 animate-spin" /> : null}
            Save glass settings
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void resetGlassAppearance()}
            disabled={glassSaving}
          >
            Restore defaults
          </Button>
          <span className="text-xs text-muted-foreground">
            Run the glass-controls Supabase migration once for workspace-wide sync; until then,
            values remain saved in this browser.
          </span>
        </div>
      </section>

      {/* ── Login page style ─────────────────────────────────────── */}
      <section className="surface-card p-6">
        <h3 className="text-sm font-semibold tracking-tight">Login page style</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose the sign-in page appearance. The cloud workspace style is inspired by the supplied
          Bitrix24 reference. Saved to the cloud and applied to all users.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {/* Plain UI */}
          <button
            type="button"
            disabled={saving}
            onClick={() => setLoginUi("plain")}
            className={`relative flex flex-col overflow-hidden rounded-xl border text-left transition-all duration-200 hover:-translate-y-0.5 ${
              loginUi === "plain"
                ? "border-primary bg-primary-soft"
                : "border-border bg-card hover:border-primary/40"
            }`}
          >
            {/* Mini preview */}
            <div
              className="flex h-28 w-full items-center justify-center"
              style={{ backgroundImage: "var(--gradient-brand)" }}
            >
              <div className="rounded-xl bg-white/20 px-5 py-2 text-[11px] font-semibold uppercase tracking-widest text-white">
                Garuda Logistics Solutions
              </div>
            </div>
            <div className="flex items-center justify-between p-4">
              <span className="min-w-0">
                <span className="block text-sm font-medium">Plain UI</span>
                <span className="block text-xs text-muted-foreground">
                  Original sign-in layout, gradient with logo
                </span>
              </span>
              {loginUi === "plain" ? <Check className="size-4 shrink-0 text-primary" /> : null}
            </div>
          </button>

          {/* Image UI */}
          <button
            type="button"
            disabled={saving}
            onClick={() => setLoginUi("image")}
            className={`relative flex flex-col overflow-hidden rounded-xl border text-left transition-all duration-200 hover:-translate-y-0.5 ${
              loginUi === "image"
                ? "border-primary bg-primary-soft"
                : "border-border bg-card hover:border-primary/40"
            }`}
          >
            {/* Mini preview */}
            <div className="h-28 w-full overflow-hidden">
              <img
                src="/garuda-banner.jpeg"
                alt="Garuda banner preview"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex items-center justify-between p-4">
              <span className="min-w-0">
                <span className="block text-sm font-medium">Image UI</span>
                <span className="block text-xs text-muted-foreground">
                  Garuda banner as background
                </span>
              </span>
              {loginUi === "image" ? <Check className="size-4 shrink-0 text-primary" /> : null}
            </div>
          </button>
          {/* Video UI — same banner treatment with the configured video */}
          <button
            type="button"
            disabled={saving}
            onClick={() => setLoginUi("video")}
            className={`relative flex flex-col overflow-hidden rounded-xl border text-left transition-all duration-200 hover:-translate-y-0.5 ${
              loginUi === "video"
                ? "border-primary bg-primary-soft"
                : "border-border bg-card hover:border-primary/40"
            }`}
          >
            <div className="relative h-28 w-full overflow-hidden bg-slate-900">
              <video
                className="h-full w-full object-cover"
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                poster="/garuda-banner.webp"
                aria-hidden="true"
              >
                <source src={backgroundVideoUrl} />
              </video>
            </div>
            <div className="flex items-center justify-between p-4">
              <span className="min-w-0">
                <span className="block text-sm font-medium">Video UI</span>
                <span className="block text-xs text-muted-foreground">
                  Same Garuda banner layout with the configured video
                </span>
              </span>
              {loginUi === "video" ? <Check className="size-4 shrink-0 text-primary" /> : null}
            </div>
          </button>
          {/* Workspace UI — clean blue auth inspiration */}
          <button
            type="button"
            disabled={saving}
            onClick={() => setLoginUi("workspace")}
            className={`relative flex flex-col overflow-hidden rounded-xl border text-left transition-all duration-200 hover:-translate-y-0.5 ${
              loginUi === "workspace"
                ? "border-primary bg-primary-soft"
                : "border-border bg-card hover:border-primary/40"
            }`}
          >
            <div className="flex h-28 w-full items-center justify-center bg-gradient-to-br from-sky-50 via-white to-blue-100">
              <div className="rounded-lg border border-sky-100 bg-white px-5 py-2.5 text-[11px] font-semibold tracking-wide text-sky-700 shadow-sm">
                GARUDA · WORKSPACE
              </div>
            </div>
            <div className="flex items-center justify-between p-4">
              <span className="min-w-0">
                <span className="block text-sm font-medium">Cloud Workspace</span>
                <span className="block text-xs text-muted-foreground">
                  Clean blue sign-in, inspired by the reference
                </span>
              </span>
              {loginUi === "workspace" ? <Check className="size-4 shrink-0 text-primary" /> : null}
            </div>
          </button>
        </div>
      </section>

      <section className="surface-card p-6">
        <h3 className="text-sm font-semibold tracking-tight">Preview</h3>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span
            className="rounded-xl px-5 py-2.5 text-sm font-medium text-primary-foreground"
            style={{ backgroundImage: "var(--gradient-brand)" }}
          >
            Primary action
          </span>
          <span className="rounded-xl bg-primary-soft px-5 py-2.5 text-sm font-medium text-primary">
            Soft accent
          </span>
          <span className="rounded-xl border border-border px-5 py-2.5 text-sm font-medium">
            Outline
          </span>
        </div>
      </section>
    </div>
  );
}
