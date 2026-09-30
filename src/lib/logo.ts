/**
 * logo.ts — runtime logo management.
 *
 * The active company's logo is stored here as a base64 data URL.
 * It is set by the CompanyContext when a company is selected.
 * PDF/export functions call getLogoBase64() to embed it.
 */

let _activeLogo: string | null = null;

/** Called by CompanyContext when a company is selected or its logo changes. */
export function setActiveLogo(b64: string | null): void {
  _activeLogo = b64;
}

/** Returns the current company logo as a base64 data URL, or null. */
export function getLogoBase64(): string | null {
  return _activeLogo;
}

/** Load the fixed Garuda header logo once so every synchronous PDF exporter can embed it. */
export async function preloadLogo(): Promise<void> {
  if (_activeLogo || typeof window === "undefined") return;
  const response = await fetch("/garuda-logo.png");
  if (!response.ok) throw new Error("Could not load Garuda logo");
  const blob = await response.blob();
  _activeLogo = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
