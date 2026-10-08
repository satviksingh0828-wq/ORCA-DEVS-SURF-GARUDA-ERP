/**
 * PasskeyGate — Device-level security gate using WebAuthn / Windows Hello.
 * Wraps the entire app. Every fresh page load (new tab/window) requires
 * biometric / PIN verification before the app renders.
 *
 * States:
 *   loading       → checking storage + session
 *   no-credential → never registered on this device → Access Restricted page
 *   registering   → in-progress registration flow
 *   pending       → registered, awaiting admin approval
 *   rejected      → admin rejected this device
 *   authenticating→ prompting Windows Hello
 *   auth-failed   → WebAuthn assertion failed
 *   unsupported   → browser doesn't support WebAuthn
 *   authenticated → passed → show app
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import { Shield, ShieldAlert, ShieldCheck, Clock, XCircle, Fingerprint, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandFooter } from "@/components/BrandFooter";
import { secureStorage, secureSession } from "@/lib/storage";
import {
  serverStartRegistration,
  serverFinishRegistration,
  serverCheckCredential,
  serverStartAuthentication,
  serverFinishAuthentication,
} from "@/lib/passkey";

// ── Storage keys ──────────────────────────────────────────────────────────────
const CRED_KEY    = "tms.passkey.cred_id.v1";
const SESSION_KEY = "tms.passkey.verified.v1";

function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

// ── Context — exposes the current device credentialId to child components ─────
type PasskeyContextValue = {
  credentialId: string | null;
  /** User IDs that are allowed to login on this device (empty = any user allowed) */
  allowedUserIds: string[];
};

const PasskeyContext = createContext<PasskeyContextValue>({ credentialId: null, allowedUserIds: [] });

export function usePasskeyContext() {
  return useContext(PasskeyContext);
}

type GateState =
  | "loading"
  | "no-credential"
  | "registering"
  | "reg-success"
  | "pending"
  | "rejected"
  | "authenticating"
  | "auth-failed"
  | "unsupported"
  | "authenticated";

// ── Full-screen wrapper ───────────────────────────────────────────────────────

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="auth-abstract-background ltms-app-shell relative isolate flex min-h-screen flex-col bg-background text-foreground">
      <header className="ltms-app-shell-header z-10 flex h-14 shrink-0 items-center border-b-2 border-[#b87333] bg-[#2a2520]">
        <div className="ltms-app-shell-header-inner flex h-full w-full items-center gap-3 px-4">
          <img
            src="/garuda-logo.png"
            alt="Garuda Logistics Solutions"
            className="ltms-app-shell-logo h-10 w-auto object-contain"
          />
          <span className="ltms-app-shell-title hidden sm:inline">Garuda Logistics Solutions</span>
          <span className="ml-auto min-w-0 max-w-[48%] text-right text-[9px] leading-tight text-white/80 sm:max-w-none sm:text-xs sm:whitespace-nowrap">
            <span className="font-semibold text-white">ERP</span> — Enterprise Resource Planning
          </span>
        </div>
      </header>
      <main className="relative z-10 flex flex-1 items-center justify-center overflow-y-auto px-4 py-8">
        <div className="surface-card w-full max-w-md animate-fade-up px-6 py-8 text-center sm:px-8">
          {children}
        </div>
      </main>
      <BrandFooter />
    </div>
  );
}

// ── Loading spinner ───────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <Screen>
      <Loader2 className="mx-auto size-10 animate-spin text-muted-foreground" />
      <p className="mt-4 text-sm text-muted-foreground">Checking device…</p>
    </Screen>
  );
}

// ── Registration form ─────────────────────────────────────────────────────────

function RegisterForm({
  onRegistered,
  onBack,
}: {
  onRegistered: (credId: string) => void;
  onBack: () => void;
}) {
  const [name, setName]       = useState("");
  const [step, setStep]       = useState<"form" | "waiting" | "error">("form");
  const [errMsg, setErrMsg]   = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setStep("waiting");
    setErrMsg("");

    try {
      const origin = window.location.origin;
      const deviceInfo = navigator.userAgent.slice(0, 200);

      // 1. Get challenge + options from server
      const { challengeId, options } = await serverStartRegistration({
        data: { name: trimmed, origin },
      });

      // 2. Prompt Windows Hello / platform authenticator
      const credential = await startRegistration({ optionsJSON: options as never });

      // 3. Send response to server for verification + storage
      const { credentialId } = await serverFinishRegistration({
        data: { challengeId, response: credential, name: trimmed, deviceInfo, origin },
      });

      // 4. Persist credential ID locally
      secureStorage.setItem(CRED_KEY, credentialId);
      onRegistered(credentialId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // User cancelled is not an error worth showing
      if (msg.toLowerCase().includes("cancel") || msg.toLowerCase().includes("abort")) {
        setStep("form");
      } else {
        setErrMsg(msg);
        setStep("error");
      }
    }
  }

  if (step === "waiting") {
    return (
      <Screen>
        <Fingerprint className="mx-auto size-14 text-primary animate-pulse" />
        <h2 className="mt-5 text-xl font-semibold">Setting up Windows Hello</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Follow the prompt on your device to register your fingerprint or PIN.
        </p>
      </Screen>
    );
  }

  return (
    <Screen>
      <Fingerprint className="mx-auto size-12 text-primary" />
      <h2 className="mt-5 text-xl font-semibold">Request Access</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Enter your name. Your Windows Hello fingerprint or PIN will be registered and
        sent to the admin for approval.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-3 text-left">
        <label className="block">
          <span className="text-sm font-medium text-foreground">Your Name</span>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Rahul Sharma"
            autoFocus
            required
            className="mt-1.5 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </label>

        {step === "error" && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-400">
            {errMsg}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={!name.trim()}>
          <Fingerprint className="size-4" />
          Register with Windows Hello
        </Button>
      </form>

      <button
        type="button"
        onClick={onBack}
        className="mt-4 text-xs text-muted-foreground hover:text-foreground"
      >
        ← Back
      </button>
    </Screen>
  );
}

// ── Access Restricted page ────────────────────────────────────────────────────

function AccessRestrictedPage({ onRequest }: { onRequest: () => void }) {
  return (
    <Screen>
      {/* Icon */}
      <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-red-50 dark:bg-red-950">
        <ShieldAlert className="size-10 text-red-500" />
      </div>

      {/* Heading */}
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">
        Access Restricted
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        This device is not registered to access this application.
      </p>

      {/* Note card */}
      <div className="mt-6 rounded-xl border border-border bg-muted/40 px-4 py-3 text-left text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Note: </span>
        This is a personal management panel. If you want access, ask the admin.
      </div>

      {/* CTA */}
      <Button className="mt-6 w-full" size="lg" onClick={onRequest}>
        <Fingerprint className="size-4" />
        Request Access
      </Button>
    </Screen>
  );
}

// ── Pending approval page ─────────────────────────────────────────────────────

function PendingPage() {
  return (
    <Screen>
      <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-950">
        <Clock className="size-10 text-amber-500" />
      </div>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Awaiting Approval</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Your access request has been submitted. Please wait for the admin to approve
        this device before you can sign in.
      </p>
      <div className="mt-6 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Note: </span>
        This is a personal management panel. If you want access, ask the admin.
      </div>
    </Screen>
  );
}

// ── Rejected page ─────────────────────────────────────────────────────────────

function RejectedPage({ onClear }: { onClear: () => void }) {
  return (
    <Screen>
      <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-red-50 dark:bg-red-950">
        <XCircle className="size-10 text-red-500" />
      </div>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Access Denied</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Your access request was rejected by the admin. Contact the admin if you
        believe this is a mistake.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-6 text-xs text-muted-foreground underline hover:text-foreground"
      >
        Clear this device and request again
      </button>
    </Screen>
  );
}

// ── Authentication screen ─────────────────────────────────────────────────────

function AuthenticatingScreen({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  if (!failed) {
    return (
      <Screen>
        <Fingerprint className="mx-auto size-14 text-primary animate-pulse" />
        <h2 className="mt-5 text-xl font-semibold">Verifying Device</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Please use Windows Hello (fingerprint / PIN) to confirm your identity.
        </p>
      </Screen>
    );
  }
  return (
    <Screen>
      <ShieldAlert className="mx-auto size-14 text-red-500" />
      <h2 className="mt-5 text-xl font-semibold">Authentication Failed</h2>
      <p className="mt-3 text-sm text-muted-foreground">
        Could not verify your identity. Please try again.
      </p>
      <Button className="mt-6 w-full" onClick={onRetry}>
        <Fingerprint className="size-4" />
        Try Again
      </Button>
    </Screen>
  );
}

// ── Unsupported ───────────────────────────────────────────────────────────────

function UnsupportedScreen() {
  return (
    <Screen>
      <Shield className="mx-auto size-14 text-muted-foreground" />
      <h2 className="mt-5 text-xl font-semibold">Browser Not Supported</h2>
      <p className="mt-3 text-sm text-muted-foreground">
        This app requires a browser that supports Windows Hello / Passkeys
        (Chrome, Edge, or Firefox on Windows 10+).
      </p>
    </Screen>
  );
}

// ── Registration success ──────────────────────────────────────────────────────

function RegSuccessScreen() {
  return (
    <Screen>
      <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-green-50 dark:bg-green-950">
        <ShieldCheck className="size-10 text-green-500" />
      </div>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Request Submitted!</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Your device has been registered. Once the admin approves it, you can access
        this application.
      </p>
      <div className="mt-6 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Note: </span>
        This is a personal management panel. If you want access, ask the admin.
      </div>
    </Screen>
  );
}

// ── Main gate ─────────────────────────────────────────────────────────────────

export function PasskeyGate({ children }: { children: ReactNode }) {
  const [state, setState]             = useState<GateState>("loading");
  const [mounted, setMounted]         = useState(false);
  const [allowedUserIds, setAllowed]  = useState<string[]>([]);

  // Credential ID that passed Windows Hello this session (exposed via context)
  const credentialId = secureStorage.getItem(CRED_KEY);

  // Run authentication flow against a stored, approved credential
  async function runAuth(credId: string) {
    setState("authenticating");
    try {
      const origin = window.location.origin;
      const { challengeId, options } = await serverStartAuthentication({
        data: { credentialId: credId, origin },
      });
      const assertion = await startAuthentication({ optionsJSON: options as never });
      const result = await serverFinishAuthentication({
        data: { challengeId, credentialId: credId || undefined, response: assertion, origin },
      });
      if (result.ok) {
        if (result.credentialId) secureStorage.setItem(CRED_KEY, result.credentialId);
        secureSession.setItem(SESSION_KEY, "1");
        setAllowed(result.allowedUserIds);
        setState("authenticated");
      } else {
        setState(credId ? "auth-failed" : "no-credential");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void msg;
      setState(credId ? "auth-failed" : "no-credential");
    }
  }

  useEffect(() => {
    setMounted(true);

    async function init() {
      // Passkey access is restricted to supported desktop operator devices.
      // Show the existing access request screen on mobile instead of exposing
      // a browser-support message or starting an unsupported registration flow.
      if (isMobileDevice()) {
        setState("no-credential");
        return;
      }

      // 1. Check WebAuthn support
      if (typeof window === "undefined" || !window.PublicKeyCredential) {
        setState("unsupported");
        return;
      }

      // 2. Already verified this session?
      const sessionOk = secureSession.getItem(SESSION_KEY);
      if (sessionOk === "1") {
        // Re-fetch allowed user IDs from server so they're up to date
        const credId = secureStorage.getItem(CRED_KEY);
        if (credId) {
          try {
            const { allowedUserIds: ids } = await serverCheckCredential({ data: { credentialId: credId } });
            setAllowed(ids);
          } catch { /* ignore, already authenticated */ }
        }
        setState("authenticated");
        return;
      }

      // 3. Check stored credential ID
      const credId = secureStorage.getItem(CRED_KEY);
      if (!credId) {
        // The credential may still exist in Windows Hello even when localStorage
        // was cleared. Ask the server for approved credentials and let WebAuthn
        // discover/use the existing passkey before offering registration.
        await runAuth("");
        return;
      }

      // 4. Check server-side status
      try {
        const { status, allowedUserIds: ids } = await serverCheckCredential({ data: { credentialId: credId } });
        if (status === "not_found") {
          // Orphaned local key — clear it
          secureStorage.removeItem(CRED_KEY);
          setState("no-credential");
          return;
        }
        if (status === "pending")  { setState("pending");  return; }
        if (status === "rejected") { setState("rejected"); return; }
        // approved → run auth
        if (status === "approved") {
          setAllowed(ids);
          await runAuth(credId);
        }
      } catch {
        // If server is unreachable, show auth failed
        setState("auth-failed");
      }
    }

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SSR or before mount → blank loading screen
  if (!mounted || state === "loading") return <LoadingScreen />;

  // Authenticated → render app wrapped in context
  if (state === "authenticated") {
    return (
      <PasskeyContext.Provider value={{ credentialId, allowedUserIds }}>
        {children}
      </PasskeyContext.Provider>
    );
  }

  // Gate screens
  if (state === "unsupported") return <UnsupportedScreen />;

  if (state === "no-credential") {
    return (
      <AccessRestrictedPage onRequest={() => setState("registering")} />
    );
  }

  if (state === "registering") {
    return (
      <RegisterForm
        onRegistered={() => setState("reg-success")}
        onBack={() => setState("no-credential")}
      />
    );
  }

  if (state === "reg-success") return <RegSuccessScreen />;
  if (state === "pending")     return <PendingPage />;

  if (state === "rejected") {
    return (
      <RejectedPage
        onClear={() => {
          secureStorage.removeItem(CRED_KEY);
          setState("no-credential");
        }}
      />
    );
  }

  if (state === "authenticating" || state === "auth-failed") {
    const credId = secureStorage.getItem(CRED_KEY) ?? "";
    return (
      <AuthenticatingScreen
        failed={state === "auth-failed"}
        onRetry={() => runAuth(credId)}
      />
    );
  }

  return <LoadingScreen />;
}
