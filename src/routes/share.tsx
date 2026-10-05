import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { LockKeyhole, LogOut, MonitorUp, Pencil, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { ScreenControlWidget } from "@/components/ScreenControlWidget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createGuestShareSession,
  leaveGuestShareSession,
  renameGuestShareSession,
} from "@/lib/screen-control";
import type { GuestShareParticipant } from "@/lib/screen-control";

const DEVICE_PREFS_KEY = "orca.public-share.device.v1";
const TAB_TOKEN_KEY = "orca.public-share.tab-token.v1";

type DevicePreferences = { pin: string; username: string };

function loadDevicePreferences(): DevicePreferences | null {
  try {
    const raw = localStorage.getItem(DEVICE_PREFS_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<DevicePreferences>;
    if (typeof value.pin !== "string" || typeof value.username !== "string") return null;
    return { pin: value.pin, username: value.username };
  } catch {
    return null;
  }
}

function saveDevicePreferences(preferences: DevicePreferences) {
  try {
    localStorage.setItem(DEVICE_PREFS_KEY, JSON.stringify(preferences));
  } catch {
    // The current guest session still works if this browser blocks local storage.
  }
}

function storeTabToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TAB_TOKEN_KEY, token);
    else sessionStorage.removeItem(TAB_TOKEN_KEY);
  } catch {
    // A token is tab-scoped; the screen-control APIs still validate it server-side.
  }
}

function readTabToken() {
  try {
    return sessionStorage.getItem(TAB_TOKEN_KEY);
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/share")({
  head: () => ({
    meta: [
      { title: "Guest Screen Share — ORCA DEVS SURF" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
  component: PublicSharePage,
});

function PublicSharePage() {
  const [guest, setGuest] = useState<GuestShareParticipant | null>(null);
  const [pin, setPin] = useState("");
  const [username, setUsername] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef("");
  const initializationStarted = useRef(false);

  useEffect(() => {
    if (initializationStarted.current) return;
    initializationStarted.current = true;

    const restore = async () => {
      const preferences = loadDevicePreferences();
      if (preferences) {
        setPin(preferences.pin);
        setUsername(preferences.username);
        setNameDraft(preferences.username);
      }

      const existingToken = readTabToken();
      if (existingToken) {
        try {
          await leaveGuestShareSession({ data: { sessionToken: existingToken } });
        } catch {
          // Continue with a fresh token; server-side presence expiry is the fallback.
        }
        storeTabToken(null);
      }

      if (preferences) {
        try {
          const result = await createGuestShareSession({
            data: { pin: preferences.pin, username: preferences.username },
          });
          const joined: GuestShareParticipant = {
            ...result.participant,
            sessionToken: result.sessionToken,
          };
          setGuest(joined);
          tokenRef.current = result.sessionToken;
          storeTabToken(result.sessionToken);
          setError(null);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not resume the guest session.");
        }
      }
      setReady(true);
    };

    void restore();
  }, []);

  useEffect(() => {
    const sessionToken = guest?.sessionToken;
    if (!sessionToken) return;
    const onPageHide = () => {
      if (tokenRef.current !== sessionToken) return;
      tokenRef.current = "";
      const payload = new Blob([JSON.stringify({ sessionToken })], {
        type: "application/json",
      });
      if (!navigator.sendBeacon?.("/api/screen-control/disconnect", payload)) {
        void fetch("/api/screen-control/disconnect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionToken }),
          keepalive: true,
        }).catch(() => undefined);
      }
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      onPageHide();
    };
  }, [guest?.sessionToken]);

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await createGuestShareSession({ data: { pin, username } });
      const joined: GuestShareParticipant = {
        ...result.participant,
        sessionToken: result.sessionToken,
      };
      setGuest(joined);
      tokenRef.current = result.sessionToken;
      storeTabToken(result.sessionToken);
      saveDevicePreferences({ pin, username: result.participant.username });
      setPin(pin);
      setUsername(result.participant.username);
      setNameDraft(result.participant.username);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the guest session.");
    } finally {
      setBusy(false);
    }
  }

  async function saveUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!guest) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await renameGuestShareSession({
        data: { sessionToken: guest.sessionToken, username: nameDraft },
      });
      const next = { ...guest, username: updated.username, name: updated.name };
      setGuest(next);
      setUsername(updated.username);
      saveDevicePreferences({ pin, username: updated.username });
      setEditingName(false);
      toast.success("Your guest name was updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update your guest name.");
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (!guest) return;
    setBusy(true);
    setError(null);
    try {
      await leaveGuestShareSession({ data: { sessionToken: guest.sessionToken } });
      tokenRef.current = "";
      storeTabToken(null);
      setGuest(null);
      setEditingName(false);
      toast.info("Your temporary guest session and its screen-control data were removed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not end the guest session.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <MonitorUp className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold tracking-wide">ORCA DEVS SURF</p>
            <p className="text-xs text-muted-foreground">Guest screen share</p>
          </div>
        </div>
        <div className="flex items-center gap-3" data-app-shell-header-actions>
          {guest && (
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
              <span className="size-2 rounded-full bg-emerald-500" />
              Guest · @{guest.username}
            </span>
          )}
        </div>
      </header>

      {!ready ? (
        <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Reconnecting to your temporary guest session…
          </div>
        </div>
      ) : guest ? (
        <>
          <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 sm:px-8">
            <div className="flex flex-col justify-between gap-5 rounded-2xl border border-border bg-card p-6 shadow-sm sm:flex-row sm:items-center">
              <div className="max-w-2xl">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  <Users className="size-3.5" /> Temporary guest · signed-in ERP user required
                </div>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  Ready to connect, {guest.username}
                </h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Choose <strong>Share screen</strong> in the header to find online participants.
                  Guests can connect only with authenticated ERP users—not with other guests.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setNameDraft(guest.username);
                    setEditingName((value) => !value);
                  }}
                >
                  <Pencil className="size-4" /> Change name
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void leave()}>
                  <LogOut className="size-4" /> End guest session
                </Button>
              </div>
            </div>

            {editingName && (
              <form
                onSubmit={saveUsername}
                className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-end"
              >
                <div className="flex-1 space-y-2">
                  <Label htmlFor="guest-name">Guest name</Label>
                  <Input
                    id="guest-name"
                    value={nameDraft}
                    onChange={(event) => setNameDraft(event.target.value)}
                    maxLength={32}
                    autoComplete="nickname"
                    required
                  />
                </div>
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save name"}
                </Button>
              </form>
            )}

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <article className="rounded-xl border border-border bg-card p-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheck className="size-4 text-primary" /> You stay in control
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  Your screen is not sent until you accept a request and approve the browser or
                  operating-system screen picker. You can end a session at any time.
                </p>
              </article>
              <article className="rounded-xl border border-border bg-card p-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <LockKeyhole className="size-4 text-primary" /> Temporary by design
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  The guest alias is not an ERP account. This tab's identity and related screen
                  signaling are removed when you leave; abandoned sessions expire automatically.
                  Your name and entry PIN are remembered only on this device.
                </p>
              </article>
            </div>
          </section>
          <ScreenControlWidget guestParticipant={guest} />
        </>
      ) : (
        <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl items-start justify-center px-4 py-10 sm:items-center sm:px-8">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
            <div className="mb-6 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <LockKeyhole className="size-6" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Public support session
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Join with a guest name</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Enter the four-digit share PIN and a name. This creates a temporary guest session, not
              a registered ERP account.
            </p>

            <form onSubmit={join} className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="share-pin">Share PIN</Label>
                <Input
                  id="share-pin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  autoComplete="one-time-code"
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="4 digits"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="share-username">Name shown to participants</Label>
                <Input
                  id="share-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  maxLength={32}
                  autoComplete="nickname"
                  placeholder="For example, Alex"
                  required
                />
              </div>
              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
                >
                  {error}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={busy || pin.length !== 4 || username.trim().length < 2}
              >
                {busy ? "Joining…" : "Continue to share"}
              </Button>
            </form>
            <p className="mt-5 text-xs leading-5 text-muted-foreground">
              When you continue, this device remembers your guest name and PIN so you do not have to
              re-enter them each time. Change the name later from this page.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
