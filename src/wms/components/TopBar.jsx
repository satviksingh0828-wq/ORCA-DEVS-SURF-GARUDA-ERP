import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { useWarehouse } from "../warehouse.jsx";
import { api } from "../api.js";
import QRCode from "qrcode";

const SEARCH_DEBOUNCE_MS = 250;

const RESULT_TYPE_LABEL = {
  item: "Item",
  bin: "Bin",
  po: "PO",
  so: "SO",
  customer: "Customer",
};

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
];

function ApkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 7h6M9 11h6M9 15h3M12 18h.01" />
    </svg>
  );
}

function resultRoute(r) {
  // Selection routes the operator to the list page filtered by the
  // result's primary label. Item / bin / PO / SO map directly to
  // their list page; customer maps to the sales-orders list since
  // there is no customers detail view.
  const q = encodeURIComponent(r.label);
  switch (r.type) {
    case "item":
      return `/items?q=${q}`;
    case "bin":
      return `/bins?q=${q}`;
    case "po":
      return `/purchase-orders?q=${q}`;
    case "so":
      return `/sales-orders?q=${q}`;
    case "customer":
      return `/sales-orders?q=${q}`;
    default:
      return "/";
  }
}

export default function TopBar({ forced = false }) {
  const { user, logout } = useAuth();
  const { warehouses, warehouseId, warehouse, setWarehouseId } = useWarehouse();
  const navigate = useNavigate();
  const [showMenu, setShowMenu] = useState(false);
  const [showWhPicker, setShowWhPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchHighlight, setSearchHighlight] = useState(-1);
  const [serverVersion, setServerVersion] = useState(null);
  const [showApkMenu, setShowApkMenu] = useState(false);
  const [selectedApk, setSelectedApk] = useState(null);
  const [apkQr, setApkQr] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const menuRef = useRef(null);
  const whRef = useRef(null);
  const searchRef = useRef(null);
  const apkRef = useRef(null);

  useEffect(() => {
    // Fetch the running api version once after login so the operator can
    // tell at a glance whether a deploy landed. /api/admin/system-info is
    // admin-gated, so no fingerprinting concern. Silent on failure -- the
    // version label is informational, not load-bearing.
    if (forced || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/admin/system-info");
        if (res?.ok && !cancelled) {
          const data = await res.json();
          setServerVersion(data?.version || null);
        }
      } catch (_) {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [forced, user]);

  const initials = user?.full_name
    ? user.full_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
    : user?.username?.[0]?.toUpperCase() || "?";

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
      }
      if (whRef.current && !whRef.current.contains(e.target)) {
        setShowWhPicker(false);
      }
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false);
      }
      if (apkRef.current && !apkRef.current.contains(e.target)) {
        setShowApkMenu(false);
      }
    }
    if (showMenu || showWhPicker || searchOpen || showApkMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu, showWhPicker, searchOpen, showApkMenu]);

  async function openApk(app) {
    setSelectedApk(app);
    setShowApkMenu(false);
    setApkQr("");
    setCopyStatus("");
    try {
      setApkQr(await QRCode.toDataURL(app.url, { width: 240, margin: 2, errorCorrectionLevel: "M" }));
    } catch (_) {
      setApkQr("");
    }
  }

  async function copyApkLink() {
    if (!selectedApk) return;
    try {
      await navigator.clipboard.writeText(selectedApk.url);
      setCopyStatus("Copied");
    } catch (_) {
      setCopyStatus("Copy failed");
    }
    window.setTimeout(() => setCopyStatus(""), 1800);
  }

  useEffect(() => {
    const q = searchQuery.trim();
    const handle = setTimeout(async () => {
      if (q.length < 2) {
        setSearchResults([]);
        setSearchLoading(false);
        return;
      }
      setSearchLoading(true);
      const params = new URLSearchParams({ q });
      if (warehouseId) params.set("warehouse_id", String(warehouseId));
      const res = await api.get(`/admin/search?${params}`);
      if (res?.ok) {
        const data = await res.json();
        setSearchResults(data.results || []);
        setSearchHighlight(-1);
      } else {
        setSearchResults([]);
      }
      setSearchLoading(false);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchQuery, warehouseId]);

  function selectSearchResult(r) {
    if (!r) return;
    navigate(resultRoute(r));
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    setSearchHighlight(-1);
  }

  function handleSearchKeyDown(e) {
    if (!searchOpen || searchResults.length === 0) {
      if (e.key === "Escape") setSearchOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSearchHighlight((i) => Math.min(searchResults.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSearchHighlight((i) => Math.max(-1, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const idx = searchHighlight >= 0 ? searchHighlight : 0;
      selectSearchResult(searchResults[idx]);
    } else if (e.key === "Escape") {
      setSearchOpen(false);
    }
  }

  function selectWarehouse(id) {
    setWarehouseId(id);
    setShowWhPicker(false);
  }

  const whCode = warehouse?.warehouse_code || warehouse?.code || "...";

  return (
    <div className="topbar">
      <div className="topbar-logo">
        <span className="topbar-module-name">WMS</span>
        {serverVersion && (
          <span
            className="topbar-version"
            title={`API version ${serverVersion}`}
            style={{
              marginLeft: 10,
              fontSize: 13,
              fontWeight: 500,
              opacity: 0.75,
              letterSpacing: 0.2,
            }}
          >
            v{serverVersion}
          </span>
        )}
      </div>
      {!forced && (
        <div className="topbar-breadcrumb" ref={whRef} style={{ position: "relative" }}>
          <span className="topbar-wh-picker" onClick={() => setShowWhPicker(!showWhPicker)}>
            <span>Warehouse</span> {whCode}
            <svg width="10" height="10" viewBox="0 0 10 10" style={{ marginLeft: 4, opacity: 0.5 }}>
              <path
                d="M2 4 L5 7 L8 4"
                stroke="currentColor"
                strokeWidth="1.2"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          </span>
          {showWhPicker && warehouses.length > 0 && (
            <div className="topbar-wh-dropdown">
              {warehouses.map((w) => {
                const wId = w.warehouse_id || w.id;
                const isActive = wId === warehouseId;
                return (
                  <div
                    key={wId}
                    className={`topbar-wh-option${isActive ? " active" : ""}`}
                    onClick={() => selectWarehouse(wId)}
                  >
                    <span className="topbar-wh-code">{w.warehouse_code || w.code}</span>
                    <span className="topbar-wh-name">{w.warehouse_name || w.name}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {!forced && (
        <div className="topbar-search" ref={searchRef} style={{ position: "relative" }}>
          <input
            type="text"
            placeholder="Search items, bins, orders..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => {
              if (searchQuery.trim().length >= 2) setSearchOpen(true);
            }}
            onKeyDown={handleSearchKeyDown}
          />
          {searchOpen && searchQuery.trim().length >= 2 && (
            <div
              className="topbar-wh-dropdown"
              style={{ minWidth: 320, maxHeight: 360, overflowY: "auto" }}
            >
              {searchLoading && (
                <div
                  className="topbar-wh-option"
                  style={{ color: "rgba(255,255,255,0.5)", cursor: "default" }}
                >
                  Searching…
                </div>
              )}
              {!searchLoading && searchResults.length === 0 && (
                <div
                  className="topbar-wh-option"
                  style={{ color: "rgba(255,255,255,0.5)", cursor: "default" }}
                >
                  No matches
                </div>
              )}
              {!searchLoading &&
                searchResults.map((r, idx) => {
                  const key = `${r.type}-${r.id}`;
                  const isActive = idx === searchHighlight;
                  return (
                    <div
                      key={key}
                      className={`topbar-wh-option${isActive ? " active" : ""}`}
                      onMouseEnter={() => setSearchHighlight(idx)}
                      onClick={() => selectSearchResult(r)}
                    >
                      <span className="topbar-wh-code">
                        [{RESULT_TYPE_LABEL[r.type] || r.type}] {r.label}
                      </span>
                      {r.sublabel && <span className="topbar-wh-name">{r.sublabel}</span>}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}
      {!forced && (
        <div className="topbar-apk" ref={apkRef}>
          <button
            type="button"
            className="topbar-apk-button"
            onClick={() => setShowApkMenu((open) => !open)}
            aria-label="Download mobile apps"
            title="Download mobile apps"
          >
            <ApkIcon />
          </button>
          {showApkMenu && (
            <div className="topbar-apk-menu">
              <div className="topbar-apk-menu-title">Mobile Apps</div>
              {APK_APPS.map((app) => (
                <button type="button" className="topbar-apk-option" key={app.id} onClick={() => openApk(app)}>
                  <span className="topbar-apk-option-name">{app.name}</span>
                  <span className="topbar-apk-option-meta">{app.version}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="topbar-user" ref={menuRef} style={{ position: "relative" }}>
        <div
          className="topbar-avatar"
          onClick={() => setShowMenu(!showMenu)}
          title={user?.full_name || user?.username}
        >
          {initials}
        </div>
        {showMenu && (
          <div className="topbar-dropdown">
            <div className="topbar-dropdown-header">
              <div style={{ fontWeight: 600, fontSize: 13, color: "#fdf4e3" }}>
                {user?.full_name || user?.username}
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{user?.role}</div>
            </div>
            <div className="topbar-dropdown-divider" />
            <button className="topbar-dropdown-item" onClick={logout}>
              Logout
            </button>
          </div>
        )}
      </div>
      {selectedApk && (
        <div className="apk-modal-overlay" role="presentation" onClick={() => setSelectedApk(null)}>
          <div className="apk-modal" role="dialog" aria-modal="true" aria-labelledby="apk-modal-title" onClick={(e) => e.stopPropagation()}>
            <div className="apk-modal-header">
              <div>
                <h2 id="apk-modal-title">{selectedApk.name}</h2>
                <span>{selectedApk.version}</span>
              </div>
              <button type="button" className="apk-modal-close" onClick={() => setSelectedApk(null)} aria-label="Close">&times;</button>
            </div>
            <div className="apk-modal-content">
              {apkQr ? <img className="apk-qr" src={apkQr} alt={`QR code for ${selectedApk.name}`} /> : <div className="apk-qr-loading">Generating QR code…</div>}
              <div className="apk-file-name">{selectedApk.fileName}</div>
              <p className="apk-modal-help">Scan this QR code on an Android device or copy the download link.</p>
              <div className="apk-link-row">
                <input type="text" readOnly value={selectedApk.url} aria-label="APK download link" onFocus={(e) => e.target.select()} />
                <button type="button" className="btn btn-primary" onClick={copyApkLink}>{copyStatus || "Copy link"}</button>
              </div>
              <a className="apk-open-link" href={selectedApk.url} target="_blank" rel="noreferrer">Open download page</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
