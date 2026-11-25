import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Building,
  Building2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  ShieldCheck,
  Wifi,
  MessageCircle,
  Mail,
  Film,
  Palette,
  KeyRound,
  Warehouse,
} from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { LtmsSidebar } from "@/components/ltms/LtmsSidebar";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { CompanySettings } from "@/components/settings/CompanySettings";
import { BranchSettings } from "@/components/settings/BranchSettings";
import { AttendanceModuleSettings } from "@/components/settings/AttendanceModuleSettings";
import { DEFAULT_BACKGROUND_VIDEO_URL, useTheme } from "@/lib/theme";
import { AppearanceStudio } from "@/components/settings/AppearanceStudio";
import { normalizeSplashMode, type SplashMode } from "@/components/SplashScreen";
import { supabase } from "@/integrations/supabase/client";
import { reportActiveVideoTab } from "@/lib/video-tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useAppSettings, useUpdateAppSettings } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { WhatsAppSettings } from "@/components/settings/WhatsAppSettings";
import { MailSettings } from "@/components/settings/MailSettings";
import { HRMSAccountsSettings } from "@/components/settings/HRMSAccountsSettings";
import { TMSAccountsSettings } from "@/components/settings/TMSAccountsSettings";
import { LtmsReportMcpSettings } from "@/components/settings/LtmsReportMcpSettings";
import { WMS_SYSTEM_TABS, WmsSystemSettings } from "@/components/WmsSystemSettings";

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
  { id: "appearance", label: "Appearance & Themes", desc: "Entire workspace and WMS themes", icon: Palette },
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
  {
    id: "mcp-reports",
    label: "AI Report MCP",
    desc: "Read-only keys for LTMS reports",
    icon: KeyRound,
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

const MODULE_TABS = [
  {
    id: "settings",
    label: "Settings",
    desc: "Company and workspace preferences",
    icon: Building2,
  },
  { id: "wms", label: "WMS Settings", desc: "Warehouse management settings", icon: Warehouse },
] as const;

function SettingsPage() {
  const { user, wmsAccessReady, wmsEnabled } = useSession();
  const [tab, setTab] = useState<TabId>("appearance");
  const [wmsTabId, setWmsTabId] = useState(WMS_SYSTEM_TABS[0].id);
  const [activeSection, setActiveSection] = useState<"settings" | "wms">("settings");
  useEffect(() => reportActiveVideoTab(activeSection === "settings" ? `settings:${tab}` : `wms-settings:${wmsTabId}`), [activeSection, tab, wmsTabId]);
  if (user?.role !== "admin") return null;
  const visibleTabs = TABS;
  const wmsSidebarTabs = WMS_SYSTEM_TABS.map(({ id, label }) => ({
    id: `wms:${id}`,
    label,
  }));
  const mobileWmsTabs = WMS_SYSTEM_TABS.map(({ id, label }) => ({
    id,
    label,
    desc: `Manage ${label.toLowerCase()} for WMS`,
    icon: Warehouse,
  }));

  if (!wmsAccessReady) {
    return (
      <AppShell variant="ltms" shellTitle="Settings">
        <div className="flex min-h-[360px] items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Preparing Settings…
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell variant="ltms" shellTitle={activeSection === "wms" ? "WMS Settings" : "Settings"} themeModule={activeSection === "wms" ? "wms" : "erp"}>
      <div className="ltms-reference-shell ltms-single-pane-reference-shell grid min-w-0 grid-cols-1 lg:grid-cols-[192px_minmax(0,1fr)]">
        <LtmsSidebar
          label="Settings navigation"
          activeTabId=""
          activeItems={{
            settings: activeSection === "settings" ? `settings:${tab}` : "",
            wms: activeSection === "wms" ? `wms:${wmsTabId}` : "",
          }}
          onSelectTab={(id) => {
            if (id.startsWith("settings:")) {
              setActiveSection("settings");
              setTab(id.slice("settings:".length) as TabId);
              return;
            }
            if (id.startsWith("wms:")) {
              setActiveSection("wms");
              setWmsTabId(id.slice("wms:".length));
            }
          }}
          showCustomMobileNav={false}
          groups={[
            {
              section: "settings",
              label: "Settings",
              items: visibleTabs.map(({ id, label }) => ({ id: `settings:${id}`, label })),
            },
            ...(wmsEnabled
              ? [{ section: "wms", label: "WMS Settings", items: wmsSidebarTabs }]
              : []),
          ]}
        />
        <div className="ltms-reference-content min-w-0">
          <div className="mb-4 lg:hidden">
            <MobileTabDropdown
              tabs={MODULE_TABS.filter(({ id }) => id !== "wms" || wmsEnabled)}
              activeId={activeSection}
              label="Settings modules"
              onChange={(id) => setActiveSection(id as "settings" | "wms")}
              compact
            />
          </div>
          {activeSection === "wms" && wmsEnabled && user?.sessionToken ? (
            <>
              <div className="mb-4 lg:hidden">
                <MobileTabDropdown
                  tabs={mobileWmsTabs}
                  activeId={wmsTabId}
                  label="WMS Settings"
                  onChange={setWmsTabId}
                  compact
                />
              </div>
              <WmsSystemSettings erpSessionToken={user.sessionToken} activeTabId={wmsTabId} />
            </>
          ) : (
            <>
              <div className="mb-4 lg:hidden">
                <MobileTabDropdown
                  tabs={visibleTabs}
                  activeId={tab}
                  label="Settings"
                  onChange={setTab}
                  compact
                />
              </div>
              <div key={tab} className="animate-fade-in min-w-0">
                {tab === "appearance" ? <><AppearanceStudio /><div className="mt-5"><SplashAppearancePanel /></div><div className="mt-5"><ThemePanel /></div></> : null}
                {tab === "company" ? <CompanySettings /> : null}
                {tab === "branch" ? <BranchSettings /> : null}
                {tab === "attendance" ? <AttendanceModuleSettings /> : null}
                {tab === "whatsapp" ? <WhatsAppSettings /> : null}
                {tab === "mail" ? <MailSettings /> : null}
                {tab === "hrms-accounts" ? <HRMSAccountsSettings /> : null}
                {tab === "tms-accounts" ? <TMSAccountsSettings /> : null}
                {tab === "passkey" ? <PasskeySecurityPanel /> : null}
                {tab === "mcp-reports" ? <LtmsReportMcpSettings /> : null}
              </div>
            </>
          )}
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

function SplashAppearancePanel() {
  const { data, isLoading, isError, refetch } = useAppSettings();
  const [draft, setDraft] = useState<SplashMode>("system");
  const [saving, setSaving] = useState(false);
  const saved = normalizeSplashMode(data?.splash_screen_mode);
  useEffect(() => { setDraft(saved); }, [saved]);
  async function save() {
    setSaving(true);
    try {
      const values = { splash_screen_mode: draft };
      const result = data?.id
        ? await supabase.from("app_settings").update(values).eq("id", data.id).select("id").single()
        : await supabase.from("app_settings").insert(values).select("id").single();
      if (result.error) throw result.error;
      await refetch();
      toast.success("Splash screen appearance saved.");
    } catch {
      toast.error("Could not save splash appearance. Please try again.");
    } finally { setSaving(false); }
  }
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-semibold">Splash screen appearance</h2>
      <p className="mt-1 text-sm text-muted-foreground">Choose the LogBook startup animation mode. App Theme follows the saved workspace background and text colours. System follows the device appearance and is also used when the database is unavailable.</p>
      <label htmlFor="splash-screen-mode" className="mt-4 block text-sm font-medium">Appearance mode</label>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <select id="splash-screen-mode" className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={draft} disabled={isLoading || isError || saving} onChange={(event) => setDraft(normalizeSplashMode(event.target.value))}>
          <option value="system">System (default)</option>
          <option value="app">App Theme</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
        <Button type="button" disabled={isLoading || isError || saving || saved === draft} onClick={() => void save()}>{saving ? "Saving..." : "Save splash appearance"}</Button>
      </div>
      {isError && <p className="mt-2 text-sm text-destructive">Could not load the saved appearance.</p>}
    </section>
  );
}

function ThemePanel() {
  const { backgroundVideoEnabled, backgroundVideoUrl, setBackgroundVideo, videoSaving } = useTheme();
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
  useEffect(() => setVideoUrlDraft(backgroundVideoUrl), [backgroundVideoUrl]);

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
        "Could not save the selected video. Cloud sync is unavailable. Your saved video is still cached on this device.",
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
        "Could not sync the video URL. Check the existing video settings in Supabase, then try again.",
      );
    }
  }

  async function toggleBackgroundVideo() {
    try {
      await setBackgroundVideo({ enabled: !backgroundVideoEnabled });
      toast.success(`Background video ${backgroundVideoEnabled ? "disabled" : "enabled"}.`);
    } catch {
      toast.error(
        "Could not sync video settings. Cloud sync is unavailable. Your saved video is still cached on this device.",
      );
    }
  }

  return (
    <div className="animate-fade-up space-y-5">
      <section className="surface-card p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Film className="size-5" />
          </span>
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Workspace background video</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Configure the shared muted background video for Home, Login and passkey verification. Other ERP/LTMS and Sentry/WMS tabs are off by default and can be enabled individually in Appearance Studio. The video itself stays sharp and unblurred.
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

    </div>
  );
}
