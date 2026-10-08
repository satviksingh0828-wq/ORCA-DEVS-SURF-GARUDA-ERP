import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Lock, Mail, Unlock, User } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/session";
import { BrandFooter } from "@/components/BrandFooter";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  getLockoutRemaining,
  lockoutLabel,
  recordFailedAttempt,
  clearRateLimit,
} from "@/lib/login-rate-limit";
import { logAction } from "@/lib/log-actions";
import { serverRequestUnpauseOtp, serverSubmitUnpauseOtp } from "@/lib/user-auth";
import { usePasskeyContext } from "@/components/PasskeyGate";
import type { AppRole } from "@/lib/roles";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign in — ORCA DEVS SURF" },
      { name: "description", content: "Secure operator sign-in for ORCA DEVS SURF." },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
  component: LoginPage,
});

// ── Login page ─────────────────────────────────────────────────────────────────

function LoginPage() {
  const { signIn, user, ready } = useSession();
  const { credentialId } = usePasskeyContext();
  const navigate = useNavigate();

  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDialog, setErrorDialog] = useState<string | null>(null);

  // Cloudflare Turnstile CAPTCHA state
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileResetRef = useRef<(() => void) | null>(null);

  // Honeypot
  const [honeypot, setHoneypot] = useState("");

  // Rate limit countdown
  const [lockedUntilMs, setLockedUntilMs] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Paused-account OTP flow ────────────────────────────────────────────────
  const [pausedRole, setPausedRole] = useState<AppRole | null>(null);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpSuccess, setOtpSuccess] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const otpCooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startCooldown(seconds: number) {
    setOtpCooldown(seconds);
    if (otpCooldownRef.current) clearInterval(otpCooldownRef.current);
    otpCooldownRef.current = setInterval(() => {
      setOtpCooldown((s) => {
        if (s <= 1) {
          clearInterval(otpCooldownRef.current!);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  function clearPausedFlow() {
    setPausedRole(null);
    setOtpSent(false);
    setOtpCode("");
    setOtpBusy(false);
    setOtpError(null);
    setOtpSuccess(false);
    setOtpCooldown(0);
    if (otpCooldownRef.current) clearInterval(otpCooldownRef.current);
  }

  async function sendOtp() {
    setOtpBusy(true);
    setOtpError(null);
    try {
      const result = await serverRequestUnpauseOtp({ data: id.trim() });
      if (!result.ok) {
        setOtpError(result.error ?? "Failed to send code.");
        if (result.retryAfterSeconds) startCooldown(result.retryAfterSeconds);
      } else {
        setOtpSent(true);
        startCooldown(120); // 2-minute resend cooldown
      }
    } catch {
      setOtpError("Unexpected error. Please try again.");
    } finally {
      setOtpBusy(false);
    }
  }

  async function submitOtp() {
    if (otpCode.trim().length < 6) return;
    setOtpBusy(true);
    setOtpError(null);
    try {
      const result = await serverSubmitUnpauseOtp({
        data: { username: id.trim(), code: otpCode.trim() },
      });
      if (!result.ok) {
        setOtpError(result.error ?? "Incorrect code.");
      } else {
        setOtpSuccess(true);
      }
    } catch {
      setOtpError("Unexpected error. Please try again.");
    } finally {
      setOtpBusy(false);
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (ready && user) navigate({ to: "/home", replace: true });
  }, [ready, user, navigate]);

  useEffect(() => {
    function tick() {
      const remaining = id.trim() ? getLockoutRemaining(id.trim()) : 0;
      setLockedUntilMs(remaining);
      if (remaining <= 0 && countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
        setError(null);
      }
    }
    countdownRef.current = setInterval(tick, 500);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [id]);

  function resetCaptcha() {
    setTurnstileToken(null);
    turnstileResetRef.current?.();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (honeypot.trim() !== "") return;

    if (!turnstileToken) {
      setError("Please complete the Cloudflare security check before signing in.");
      return;
    }

    const remaining = getLockoutRemaining(id.trim());
    if (remaining > 0) {
      setError(`Too many failed attempts. Try again in ${lockoutLabel(remaining)}.`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await new Promise((r) => setTimeout(r, 400));
      const outcome = await signIn(id, password, turnstileToken, credentialId ?? undefined);

      if (outcome.ok) {
        clearRateLimit(id.trim());
        logAction("login_success", "login", { entityLabel: id.trim() });
        toast.success("Welcome back");
        navigate({ to: "/home", replace: true });
      } else {
        logAction("login_failed", "login", {
          entityLabel: id.trim(),
          details: { reason: outcome.reason },
        });
        resetCaptcha();
        if (outcome.reason === "account_paused") {
          // Always count as a failed attempt (rate-limits the locked screen too)
          recordFailedAttempt(id.trim());
          setPausedRole(outcome.role);
        } else {
          const lockMs = recordFailedAttempt(id.trim());
          if (lockMs > 0) {
            setError(`Too many failed attempts. Account locked for ${lockoutLabel(lockMs)}.`);
          } else {
            setErrorDialog(outcome.message);
          }
        }
      }
    } catch (err) {
      void (err instanceof Error ? err.message : String(err));
      setErrorDialog("Unexpected error — please try again.");
      resetCaptcha();
    } finally {
      setBusy(false);
    }
  }

  const isLocked = lockedUntilMs > 0;
  const canSubmit = !!turnstileToken && !isLocked && !busy;

  return (
    <>
      {/* ── Error popup ───────────────────────────────────────────────────── */}
      {/* ── Locked account popup ──────────────────────────────────────────── */}
      <AlertDialog
        open={!!pausedRole}
        onOpenChange={(open) => {
          if (!open) {
            clearPausedFlow();
            setPassword("");
            resetCaptcha();
          }
        }}
      >
        <AlertDialogContent className="max-w-sm overflow-hidden p-0 gap-0">
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-800 dark:bg-amber-950/50">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-400">
              <Lock className="size-4" />
            </span>
            <div>
              <p className="text-sm font-semibold leading-tight">Account locked</p>
              <p className="text-xs text-muted-foreground">{id.trim()}</p>
            </div>
          </div>

          {/* Body */}
          <div className="space-y-4 p-5">
            {pausedRole === "basic" ? (
              <p className="text-center text-sm leading-relaxed text-muted-foreground">
                Your account has been locked after multiple failed login attempts. Please contact
                your administrator to restore access.
              </p>
            ) : otpSuccess ? (
              <div className="space-y-3 text-center">
                <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900">
                  <CheckCircle2 className="size-6" />
                </span>
                <p className="text-sm font-semibold">Account unlocked</p>
                <p className="text-xs text-muted-foreground">
                  You can now sign in with your usual password. It has not been changed.
                </p>
              </div>
            ) : !otpSent ? (
              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Request a one-time verification code to the registered security email to unlock
                  your account.
                </p>
                {otpError && (
                  <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {otpError}
                  </p>
                )}
                <Button
                  className="h-10 w-full"
                  onClick={sendOtp}
                  disabled={otpBusy || otpCooldown > 0}
                >
                  {otpBusy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Mail className="size-4" />
                  )}
                  {otpCooldown > 0
                    ? `Wait ${otpCooldown}s…`
                    : otpBusy
                      ? "Sending…"
                      : "Send verification code"}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Enter the 6-character code from the security email.
                </p>
                <Input
                  className="h-12 text-center font-mono text-lg uppercase tracking-[0.5em]"
                  placeholder="A3FX9K"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => {
                    setOtpCode(e.target.value.toUpperCase());
                    setOtpError(null);
                  }}
                  autoFocus
                  disabled={otpBusy}
                />
                {otpError && (
                  <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {otpError}
                  </p>
                )}
                <Button
                  className="h-10 w-full"
                  onClick={submitOtp}
                  disabled={otpCode.trim().length < 6 || otpBusy}
                >
                  {otpBusy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Unlock className="size-4" />
                  )}
                  {otpBusy ? "Verifying…" : "Unlock account"}
                </Button>
                <div className="text-center">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:underline disabled:pointer-events-none disabled:opacity-40"
                    disabled={otpCooldown > 0 || otpBusy}
                    onClick={() => {
                      setOtpError(null);
                      sendOtp();
                    }}
                  >
                    {otpCooldown > 0 ? `Resend in ${otpCooldown}s` : "Resend code"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t px-5 py-3">
            {otpSuccess ? (
              <Button
                className="h-9 w-full"
                onClick={() => {
                  clearPausedFlow();
                  resetCaptcha();
                }}
              >
                Continue to sign in →
              </Button>
            ) : (
              <button
                type="button"
                className="w-full text-center text-xs text-muted-foreground hover:underline"
                onClick={() => {
                  clearPausedFlow();
                  setPassword("");
                  resetCaptcha();
                }}
              >
                ← Use a different account
              </button>
            )}
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Sign-in error popup ────────────────────────────────────────────── */}
      <AlertDialog
        open={!!errorDialog}
        onOpenChange={(open) => {
          if (!open) setErrorDialog(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5 shrink-0" />
              Sign-in failed
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed">
              {errorDialog}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setErrorDialog(null)} className="w-full">
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="auth-abstract-background ltms-app-shell relative isolate flex min-h-[100dvh] flex-col bg-background text-foreground">
        <header className="ltms-app-shell-header z-10 flex h-14 shrink-0 items-center border-b-2 border-[#b87333] bg-[#2a2520]">
          <div className="ltms-app-shell-header-inner flex h-full w-full items-center gap-3 px-4">
            <img
              src="/garuda-logo.png"
              alt="Garuda Logistics Solutions"
              className="ltms-app-shell-logo h-10 w-auto object-contain"
            />
            <span className="ltms-app-shell-title">Garuda Logistics Solutions</span>
          </div>
        </header>
        <main className="relative z-10 flex flex-1 items-center justify-center overflow-y-auto px-4 py-8">
          <div className="w-full max-w-sm">
            {/* ── Normal login form — always visible ────────────────────────── */}
            <div className="w-full max-w-sm animate-fade-up rounded-xl border border-border bg-card p-8 shadow-sm">
              <h2 className="text-center text-2xl font-semibold tracking-tight">Sign in</h2>
              <p className="mt-1.5 text-center text-sm text-muted-foreground">
                Enter your operator credentials to continue.
              </p>

              <form onSubmit={onSubmit} className="mt-6 space-y-4">
                {/* Honeypot */}
                <div
                  style={{
                    position: "absolute",
                    left: "-9999px",
                    top: "-9999px",
                    opacity: 0,
                    height: 0,
                    overflow: "hidden",
                  }}
                  aria-hidden="true"
                  tabIndex={-1}
                >
                  <label>Leave this field empty</label>
                  <input
                    type="text"
                    name="website"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                    autoComplete="off"
                    tabIndex={-1}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="loginId">Login ID</Label>
                  <div className="relative">
                    <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="loginId"
                      value={id}
                      onChange={(e) => setId(e.target.value)}
                      placeholder="admin"
                      autoComplete="username"
                      className="h-11 pl-9"
                      required
                      disabled={isLocked || busy}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      className="h-11 pl-9"
                      required
                      disabled={isLocked || busy}
                    />
                  </div>
                </div>

                {/* Invisible Turnstile runs silently unless a manual challenge is needed. */}
                <TurnstileWidget
                  onToken={setTurnstileToken}
                  onExpire={() => setTurnstileToken(null)}
                  onError={() => setTurnstileToken(null)}
                  resetRef={turnstileResetRef}
                />

                <Button type="submit" disabled={!canSubmit} className="h-11 w-full">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  {busy
                    ? "Signing in…"
                    : isLocked
                      ? `Locked — ${lockoutLabel(lockedUntilMs)}`
                      : "Sign in"}
                </Button>
              </form>

              <p className="mt-6 text-center text-xs text-muted-foreground">
                Access is limited to authorised operators. Contact your administrator for
                credentials.
              </p>
            </div>
          </div>
        </main>
        <BrandFooter />
      </div>
    </>
  );
}
