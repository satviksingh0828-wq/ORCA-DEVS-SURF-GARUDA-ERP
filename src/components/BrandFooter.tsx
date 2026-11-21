/** Branded credits shared by Home, Login and passkey.
 * Keeps all links and content unchanged while inheriting theme colours. */
import { useTheme } from "@/lib/theme";

function isLightBackground(hex?: string): boolean {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return false;
  const channel = (offset: number) => parseInt(hex.slice(offset, offset + 2), 16);
  return (channel(1) * 299 + channel(3) * 587 + channel(5) * 114) / 1000 > 160;
}

export function BrandFooter() {
  const { profile } = useTheme();
  const lightLogo = isLightBackground(profile.colors.footerBackground || profile.colors.sidebar);
  return (
    <footer className="orca-brand-footer relative z-10 flex min-h-14 shrink-0 items-center border-t-2">
      <div className="flex w-full flex-col items-start justify-center gap-y-1 px-4 py-2 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-y-0 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="uppercase tracking-wider opacity-75">Powered by</span>
          <img src={lightLogo ? "/orca-logo.svg" : "/orca-logo-light.svg"} alt="ORCA logo" className="orca-brand-footer-logo size-5 object-contain" />
          <a
            href="https://orca.devs.surf"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold tracking-wide underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/70"
          >
            ORCA DEVS SURF
          </a>
        </div>
        <div className="flex flex-col items-start gap-x-3 gap-y-1 opacity-80 sm:flex-row sm:items-center sm:justify-end sm:text-right">
          <a
            href="mailto:orcadevssurf@gmail.com"
            className="underline-offset-4 hover:opacity-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/70"
          >
            orcadevssurf@gmail.com
          </a>
          <span aria-hidden="true" className="hidden opacity-40 sm:inline">|</span>
          <a
            href="https://orca.devs.surf"
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-4 hover:opacity-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/70"
          >
            orca.devs.surf
          </a>
        </div>
      </div>
    </footer>
  );
}
