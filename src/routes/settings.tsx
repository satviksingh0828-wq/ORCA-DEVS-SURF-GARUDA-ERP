import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Building,
  Building2,
  Check,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Loader2,
  Palette,
  ShieldCheck,
  Wifi,
  MessageCircle,
  Mail,
  Film,
} from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { CompanySettings } from "@/components/settings/CompanySettings";
import { BranchSettings } from "@/components/settings/BranchSettings";
import { AttendanceModuleSettings } from "@/components/settings/AttendanceModuleSettings";
import { DEFAULT_BACKGROUND_VIDEO_URL, THEMES, useTheme, type ThemeId } from "@/lib/theme";
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
      { title: "Settings — Garuda Logistics Solutions | ORCA DEVS SURF" },
      {
        name: "description",
        content:
          "Manage company profile, branches, departments and application appearance for Garuda Logistics Solutions.",
      },
      { property: "og:title", content: "Settings — Garuda Logistics Solutions" },
      {
        property: "og:description",
        content:
          "Company profile, branches, departments and theme settings for Garuda Logistics Solutions.",
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
  { id: "theme", label: "Theme Settings", desc: "Universal app appearance", icon: Palette },
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
    label: "TMS Accounts",
    desc: "Driver payroll ledger mappings",
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
      <div className={`grid gap-6 ${navOpen ? "lg:grid-cols-[220px_1fr]" : "grid-cols-1"}`}>
        {/* Desktop left nav */}
        {navOpen && (
          <nav className="app-sidebar-scroll hidden lg:block lg:fixed lg:left-[max(1.5rem,calc((100vw-1280px)/2+1.5rem))] lg:top-20 lg:h-[calc(100dvh-5rem)] lg:w-[220px] lg:max-h-[calc(100dvh-5rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
            <p className="mb-3 px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Settings
            </p>
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
          </nav>
        )}

        {/* Mobile dropdown navigation */}
        <MobileTabDropdown tabs={TABS} activeId={tab} label="Settings" onChange={setTab} />

        <div key={tab} className={`animate-fade-in min-w-0 ${navOpen ? "lg:col-start-2" : ""}`}>
          <header className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">{active.label}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{active.desc}</p>
          </header>
          {tab === "company" ? <CompanySettings /> : null}
          {tab === "branch" ? <BranchSettings /> : null}
          {tab === "theme" ? <ThemePanel /> : null}
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
  } = useTheme();
  const [videoUrlDraft, setVideoUrlDraft] = useState(backgroundVideoUrl);
  useEffect(() => setVideoUrlDraft(backgroundVideoUrl), [backgroundVideoUrl]);

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
      </section>

      {/* ── Login page style ─────────────────────────────────────── */}
      <section className="surface-card p-6">
        <h3 className="text-sm font-semibold tracking-tight">Login page style</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose the sign-in page appearance. The cloud workspace style is inspired by the supplied
          Bitrix24 reference. Saved to the cloud and applied to all users.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
