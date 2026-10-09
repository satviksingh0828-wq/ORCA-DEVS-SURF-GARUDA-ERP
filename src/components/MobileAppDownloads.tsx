import { useEffect, useState } from "react";
import { Check, Copy, Download, Smartphone } from "lucide-react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const APK_APPS = [
  {
    id: "location-app",
    name: "LOCATION APP",
    version: "v1.0.0",
    fileName: "app-gms-arm64-v8a-release.apk",
    url: "https://releasehub.orca.devs.surf/?app=location-app&release=app-gms-arm64-v8a-release",
  },
  {
    id: "document-app",
    name: "DOCUMENT APP",
    version: "v1.0.0",
    fileName: "application-3a3d27b2-fb2d-4b2d-a752-12c48dd78345.apk",
    url: "https://releasehub.orca.devs.surf/?app=document-app&release=document-release",
  },
  {
    id: "orca-wms-mobile",
    name: "ORCA WMS MOBILE",
    version: "Production APK",
    fileName: "ORCA-WMS-mobile.apk",
    url: "https://releasehub.orca.devs.surf/?app=orca-wms-mobile&release=wms-mobile-release",
  },
] as const;

type ApkApp = (typeof APK_APPS)[number];

export function MobileAppDownloads() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedApp, setSelectedApp] = useState<ApkApp | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setQrDataUrl("");
    setCopied(false);
    if (!selectedApp) return () => undefined;
    void QRCode.toDataURL(selectedApp.url, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: "M",
    }).then((dataUrl) => {
      if (!cancelled) setQrDataUrl(dataUrl);
    }).catch(() => {
      if (!cancelled) setQrDataUrl("");
    });
    return () => {
      cancelled = true;
    };
  }, [selectedApp]);

  async function copyLink() {
    if (!selectedApp) return;
    try {
      await navigator.clipboard.writeText(selectedApp.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  function selectApp(app: ApkApp) {
    setMenuOpen(false);
    setSelectedApp(app);
  }

  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            title="Download mobile apps"
            aria-label="Download mobile apps"
            className="relative flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background p-0 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            data-no-remote-control
          >
            <Smartphone className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={10} className="w-64 p-2" data-no-remote-control>
          <div className="px-2 pb-2 pt-1">
            <p className="text-sm font-semibold">Mobile Apps</p>
            <p className="text-xs text-muted-foreground">Select an app to show its QR code.</p>
          </div>
          <div className="space-y-1">
            {APK_APPS.map((app) => (
              <button
                key={app.id}
                type="button"
                onClick={() => selectApp(app)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Download className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{app.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{app.version}</span>
                </span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={selectedApp !== null} onOpenChange={(open) => !open && setSelectedApp(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedApp?.name}</DialogTitle>
            <DialogDescription>
              {selectedApp?.version} · Scan the QR code on an Android device or copy the download link.
            </DialogDescription>
          </DialogHeader>
          {selectedApp && (
            <div className="flex flex-col items-center gap-4">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`QR code for ${selectedApp.name}`}
                  className="size-60 rounded-md border border-border bg-white p-2"
                />
              ) : (
                <div className="flex size-60 items-center justify-center rounded-md border border-border bg-white text-xs text-muted-foreground">
                  Generating QR code…
                </div>
              )}
              <p className="max-w-full break-all text-center font-mono text-[11px] text-muted-foreground">
                {selectedApp.fileName}
              </p>
              <div className="flex w-full gap-2">
                <input
                  type="text"
                  readOnly
                  value={selectedApp.url}
                  aria-label="APK download link"
                  onFocus={(event) => event.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-ring"
                />
                <Button type="button" variant="default" onClick={copyLink} className="shrink-0">
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  <span className="hidden sm:inline">{copied ? "Copied" : "Copy link"}</span>
                </Button>
              </div>
              <Button asChild variant="outline" className="w-full">
                <a href={selectedApp.url} target="_blank" rel="noreferrer">
                  <Download className="size-4" />
                  Open download page
                </a>
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
