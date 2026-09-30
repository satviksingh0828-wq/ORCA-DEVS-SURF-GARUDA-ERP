/**
 * security.ts
 *
 * Client-side security hardening for Garuda Logistics Solutions:
 *   • Suppresses all browser console output in production
 *   • Blocks common DevTools keyboard shortcuts (F12, Ctrl+Shift+I, etc.)
 *   • Disables right-click context menu
 *   • Blocks Ctrl+U (view source) and Ctrl+S (save page)
 *
 * Note: These measures deter casual inspection; a determined attacker
 * can always bypass them. True security lies in server-side controls.
 */

let initialized = false;

export function initSecurity(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  // ── Suppress console output in production ────────────────────────────────
  if (import.meta.env.PROD) {
    const noop = () => {};
    const consoleMethods: (keyof Console)[] = [
      "log", "warn", "info", "debug", "error", "trace",
      "group", "groupCollapsed", "groupEnd", "table", "dir", "dirxml",
      "count", "countReset", "time", "timeEnd", "timeLog", "profile",
      "profileEnd", "clear",
    ];
    consoleMethods.forEach((method) => {
      try {
        // @ts-expect-error — intentional console suppression
        console[method] = noop;
      } catch {
        // Some environments prevent overriding — ignore
      }
    });
  }

  // ── Block DevTools keyboard shortcuts ────────────────────────────────────
  window.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      // F12
      if (e.key === "F12") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C (DevTools panels)
      if (e.ctrlKey && e.shiftKey && ["I", "J", "C", "i", "j", "c"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Cmd+Option+I (Mac DevTools)
      if (e.metaKey && e.altKey && ["I", "i"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Ctrl+U (view source)
      if (e.ctrlKey && ["U", "u"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Ctrl+S (save page)
      if (e.ctrlKey && ["S", "s"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Ctrl+P (print — prevents source inspection via print preview)
      if (e.ctrlKey && ["P", "p"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    },
    true, // capture phase — fires before any other handler
  );

  // ── Disable right-click context menu ─────────────────────────────────────
  window.addEventListener("contextmenu", (e: MouseEvent) => {
    e.preventDefault();
  });

  // ── Detect DevTools open via console timing trick ────────────────────────
  // (keeps a periodic heartbeat that triggers debugger if devtools open)
  if (import.meta.env.PROD) {
    const threshold = 160; // ms — devtools slows this down significantly
    setInterval(() => {
      const start = performance.now();
      // eslint-disable-next-line no-debugger
      debugger;
      const elapsed = performance.now() - start;
      if (elapsed > threshold) {
        // DevTools appear to be open — clear the page
        document.body.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;font-size:1.1rem;color:#666;">Close developer tools to continue.</div>';
      }
    }, 3000);
  }
}
