export function BrandFooter() {
  return (
    <footer className="relative z-10 flex min-h-14 shrink-0 items-center border-t-2 border-[#b87333] bg-[#2a2520] text-white">
      <div className="flex w-full flex-col items-start justify-center gap-y-1 px-4 py-2 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-y-0 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="uppercase tracking-wider text-white/70">Powered by</span>
          <img src="/orca-logo-light.svg" alt="ORCA logo" className="size-5 object-contain" />
          <a
            href="https://orca.devs.surf"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold tracking-wide text-white underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            ORCA DEVS SURF
          </a>
        </div>
        <div className="text-left text-white/70 sm:text-right">
          <span className="font-medium text-white">ERP:</span> Enterprise Resource Planning
        </div>
      </div>
    </footer>
  );
}
