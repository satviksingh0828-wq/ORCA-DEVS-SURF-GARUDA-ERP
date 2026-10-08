/**
 * TurnstileWidget — Cloudflare Turnstile CAPTCHA (no user-account registration required).
 *
 * Uses Cloudflare's official public TEST keys by default:
 *   Site key  : 1x00000000000000000000AA  (always passes, invisible)
 *   Secret key: 1x0000000000000000000000000000000AA
 *
 * For production, set:
 *   VITE_TURNSTILE_SITEKEY  (client)
 *   TURNSTILE_SECRET_KEY    (server, via Vercel Environment Variables)
 * and get real keys from dash.cloudflare.com → Turnstile (free, no CC required).
 */
import { useEffect, useRef } from "react";

// Public test site key — always passes, no Cloudflare account needed
export const TURNSTILE_SITEKEY =
  (typeof import.meta !== "undefined" &&
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_TURNSTILE_SITEKEY) ||
  "1x00000000000000000000AA";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact" | "invisible";
          appearance?: "always" | "execute" | "interaction-only";
        },
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
    onTurnstileLoad?: () => void;
  }
}

let scriptLoaded = false;
let scriptLoading = false;
const listeners: Array<() => void> = [];

function loadTurnstileScript(onReady: () => void) {
  if (scriptLoaded) {
    onReady();
    return;
  }
  listeners.push(onReady);
  if (scriptLoading) return;
  scriptLoading = true;
  window.onTurnstileLoad = () => {
    scriptLoaded = true;
    listeners.splice(0).forEach((fn) => fn());
  };
  const script = document.createElement("script");
  script.src =
    "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit";
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
}

type Props = {
  onToken: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
  theme?: "light" | "dark" | "auto";
  /** Call reset() from outside via ref */
  resetRef?: React.MutableRefObject<(() => void) | null>;
};

export function TurnstileWidget({ onToken, onExpire, onError, theme = "auto", resetRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    function renderWidget() {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      // Clean up previous instance
      if (widgetIdRef.current) {
        try {
          window.turnstile!.remove(widgetIdRef.current);
        } catch {
          /* ignore */
        }
        widgetIdRef.current = null;
      }
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITEKEY,
        callback: onToken,
        "expired-callback": onExpire,
        "error-callback": onError,
        theme,
        size: "normal",
        appearance: "interaction-only",
      });
    }

    loadTurnstileScript(renderWidget);

    // Expose reset
    if (resetRef) {
      resetRef.current = () => {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
      };
    }

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* ignore */
        }
        widgetIdRef.current = null;
      }
      if (resetRef) resetRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  return <div ref={containerRef} />;
}
