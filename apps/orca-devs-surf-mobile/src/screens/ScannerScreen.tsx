import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { FileAction, FileSource, QrManifest, UploadField } from "../types";
import { actionUrl, displayFileType } from "../lib/qr";
import { colors } from "../theme";

const logo = require("../../assets/orca-logo.png");

interface ScannerScreenProps {
  manifest: QrManifest | null;
  scanning: boolean;
  busyUploadId?: string;
  scanError?: string;
  onScan: (data: string) => void;
  onRescan: () => void;
  onView: (field: UploadField) => void;
  onFileAction: (field: UploadField, action: FileAction, source: FileSource) => void;
}

function fileNameFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
    return name || undefined;
  } catch {
    return undefined;
  }
}

function safeUrlLabel(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return undefined;
  }
}

function SmallAction({ label, onPress, kind = "secondary", disabled = false }: { label: string; onPress: () => void; kind?: "primary" | "secondary"; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.actionButton, kind === "primary" ? styles.actionPrimary : styles.actionSecondary, disabled && styles.actionDisabled, pressed && styles.actionPressed]}>
      <Text style={[styles.actionLabel, kind === "primary" && styles.actionLabelPrimary]}>{label}</Text>
    </Pressable>
  );
}

function UploadCard({ field, disabled, onView, onFileAction }: { field: UploadField; disabled: boolean; onView: (field: UploadField) => void; onFileAction: (field: UploadField, action: FileAction, source: FileSource) => void }) {
  const addUrl = actionUrl(field, "add");
  const replaceUrl = actionUrl(field, "replace");
  const canView = field.allowView && Boolean(field.viewUrl);
  const filename = fileNameFromUrl(field.valueUrl);

  return (
    <View style={styles.uploadCard}>
      <View style={styles.fieldHeading}>
        <View style={styles.fileIcon}><Text style={styles.fileIconText}>{displayFileType(field).slice(0, 3)}</Text></View>
        <View style={styles.fieldTitles}>
          <Text style={styles.fieldName}>{field.label}</Text>
          <Text style={styles.fieldId}>ID · {field.id}</Text>
        </View>
        <View style={[styles.typePill, field.valueUrl ? styles.typePillFilled : styles.typePillEmpty]}>
          <Text style={styles.typePillText}>{field.valueUrl ? displayFileType(field) : "EMPTY"}</Text>
        </View>
      </View>

      <View style={styles.valueBox}>
        <Text style={styles.valueHeading}>{field.valueUrl ? "CURRENT FILE" : "CURRENT VALUE"}</Text>
        <Text numberOfLines={2} style={styles.valueText}>{filename ?? (field.valueUrl ? safeUrlLabel(field.valueUrl) : "No file is currently attached")}</Text>
        {field.valueUrl && safeUrlLabel(field.valueUrl) ? <Text numberOfLines={1} style={styles.valueHost}>{safeUrlLabel(field.valueUrl)}</Text> : null}
      </View>

      <View style={styles.actions}>
        {canView ? <SmallAction label="VIEW / PREVIEW" onPress={() => onView(field)} disabled={disabled} kind="primary" /> : null}
        {addUrl ? <SmallAction label="ADD FILE" onPress={() => onFileAction(field, "add", "document")} disabled={disabled} /> : null}
        {addUrl ? <SmallAction label="TAKE PHOTO" onPress={() => onFileAction(field, "add", "photo")} disabled={disabled} /> : null}
        {replaceUrl ? <SmallAction label="REPLACE FILE" onPress={() => onFileAction(field, "replace", "document")} disabled={disabled} /> : null}
        {replaceUrl ? <SmallAction label="REPLACE WITH PHOTO" onPress={() => onFileAction(field, "replace", "photo")} disabled={disabled} /> : null}
      </View>

      {disabled ? <View style={styles.uploading}><ActivityIndicator color={colors.accent} size="small" /><Text style={styles.uploadingText}>Sending securely…</Text></View> : null}
      {!canView && !addUrl && !replaceUrl ? <Text style={styles.noActions}>This QR provides no enabled file action for this item.</Text> : null}
      <Text style={styles.permissionNote}>Actions are shown only when allowed by this QR and an action URL is provided.</Text>
    </View>
  );
}

export function ScannerScreen({ manifest, scanning, busyUploadId, scanError, onScan, onRescan, onView, onFileAction }: ScannerScreenProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanLocked, setScanLocked] = useState(false);
  const [torch, setTorch] = useState(false);

  useEffect(() => {
    if (!manifest && !scanning) setScanLocked(false);
  }, [manifest, scanning]);

  const onBarcode = ({ data }: { data: string }) => {
    if (scanLocked || scanning || manifest) return;
    setScanLocked(true);
    onScan(data);
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.titleRow}>
        <View>
          <Text style={styles.eyebrow}>SECURE DOCUMENT ACCESS</Text>
          <Text style={styles.title}>Scan</Text>
        </View>
        <Image source={logo} style={styles.miniLogo} resizeMode="contain" />
      </View>
      <Text style={styles.subtitle}>Scan an ORCA application QR to read the available document fields and actions.</Text>

      {!manifest ? (
        <>
          {!permission?.granted ? (
            <View style={styles.permissionCard}>
              <Text style={styles.permissionTitle}>Camera access is needed</Text>
              <Text style={styles.permissionBody}>Allow the camera to scan a document QR code. Photos are captured only after you choose an allowed upload action.</Text>
              <SmallAction label={permission?.canAskAgain === false ? "OPEN CAMERA PERMISSION" : "ALLOW CAMERA"} onPress={requestPermission} kind="primary" />
            </View>
          ) : (
            <View style={styles.cameraWrap}>
              <CameraView
                style={styles.camera}
                facing="back"
                enableTorch={torch}
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={scanLocked || scanning ? undefined : onBarcode}
              />
              <View pointerEvents="none" style={styles.scanOverlay}>
                <View style={styles.scanFrame}><View style={styles.scanLine} /></View>
                <Text style={styles.scanHint}>{scanning ? "READING QR…" : "ALIGN THE QR CODE INSIDE THE FRAME"}</Text>
              </View>
              <Pressable accessibilityRole="button" onPress={() => setTorch((value) => !value)} style={styles.torchButton}>
                <Text style={styles.torchText}>{torch ? "TORCH ON" : "TORCH OFF"}</Text>
              </Pressable>
            </View>
          )}
          {scanning ? <View style={styles.statusLine}><ActivityIndicator color={colors.accent} /><Text style={styles.statusText}>Checking the QR manifest…</Text></View> : null}
          {scanError ? <Text accessibilityRole="alert" style={styles.error}>{scanError}</Text> : null}
          <View style={styles.tipCard}>
            <Text style={styles.tipTitle}>QR-controlled access</Text>
            <Text style={styles.tipText}>The app displays an action only when the QR allows it and provides the corresponding server URL. Your ID/password are never placed in a URL.</Text>
          </View>
        </>
      ) : (
        <>
          <View style={styles.manifestCard}>
            <View style={styles.manifestTop}>
              <View style={styles.manifestLogo}><Image source={logo} style={styles.manifestLogoImage} resizeMode="contain" /></View>
              <View style={styles.manifestCopy}>
                <Text style={styles.manifestTitle}>{manifest.title}</Text>
                <Text style={styles.manifestMeta}>RECORD · {manifest.recordId}</Text>
              </View>
            </View>
            <View style={styles.manifestSummary}>
              <Text style={styles.summaryText}>{manifest.uploads.length} {manifest.uploads.length === 1 ? "DOCUMENT FIELD" : "DOCUMENT FIELDS"}</Text>
              <Text style={styles.summaryReadOnly}>QR permissions apply</Text>
            </View>
            <SmallAction label="SCAN ANOTHER QR" onPress={onRescan} />
          </View>
          {manifest.uploads.length === 0 ? (
            <View style={styles.emptyCard}><Text style={styles.emptyTitle}>No file fields available</Text><Text style={styles.emptyText}>The scanned manifest contains an empty uploads list.</Text></View>
          ) : (
            <View style={styles.uploadList}>
              {manifest.uploads.map((field) => (
                <UploadCard
                  key={field.id}
                  field={field}
                  disabled={busyUploadId === field.id}
                  onView={onView}
                  onFileAction={onFileAction}
                />
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 25 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  title: { color: colors.text, fontSize: 27, fontWeight: "900", marginTop: 4 },
  subtitle: { color: colors.muted, fontSize: 11, lineHeight: 18, marginTop: 7, marginBottom: 15 },
  miniLogo: { width: 40, height: 40 },
  cameraWrap: { height: 308, borderRadius: 20, overflow: "hidden", backgroundColor: "#000", borderWidth: 1, borderColor: "#1F3D52" },
  camera: { flex: 1 },
  scanOverlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(4, 10, 16, 0.14)" },
  scanFrame: { width: 214, height: 214, borderWidth: 2, borderRadius: 25, borderColor: colors.accent, alignItems: "center", justifyContent: "center", shadowColor: colors.accent, shadowOpacity: 0.28, shadowRadius: 15, elevation: 8 },
  scanLine: { width: 178, height: 1, backgroundColor: "rgba(53,198,244,0.55)" },
  scanHint: { color: colors.white, fontSize: 9, fontWeight: "900", letterSpacing: 1.1, marginTop: 16, textShadowColor: "#000", textShadowRadius: 4 },
  torchButton: { position: "absolute", right: 12, top: 12, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: "rgba(6,11,18,0.72)", borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.16)" },
  torchText: { color: colors.text, fontWeight: "800", fontSize: 8, letterSpacing: 0.8 },
  permissionCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 18, padding: 18, gap: 11 },
  permissionTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  permissionBody: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  statusLine: { flexDirection: "row", gap: 10, alignItems: "center", marginTop: 12 },
  statusText: { color: colors.accent, fontSize: 11, fontWeight: "700" },
  error: { color: colors.danger, fontSize: 11, lineHeight: 17, marginTop: 12 },
  tipCard: { borderLeftWidth: 2, borderLeftColor: colors.accent, backgroundColor: colors.surface, padding: 13, marginTop: 15, borderRadius: 10 },
  tipTitle: { color: colors.text, fontWeight: "800", fontSize: 11 },
  tipText: { color: colors.muted, fontSize: 10, lineHeight: 16, marginTop: 5 },
  manifestCard: { borderRadius: 19, borderColor: "#204359", borderWidth: 1, backgroundColor: "#0A1723", padding: 15, marginTop: 3 },
  manifestTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  manifestLogo: { width: 48, height: 48, borderRadius: 15, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  manifestLogoImage: { width: 32, height: 32 },
  manifestCopy: { flex: 1 },
  manifestTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  manifestMeta: { color: colors.muted, fontSize: 8, fontWeight: "700", letterSpacing: 0.7, marginTop: 5 },
  manifestSummary: { borderTopWidth: 1, borderColor: colors.border, marginTop: 13, paddingTop: 12, paddingBottom: 12, flexDirection: "row", justifyContent: "space-between" },
  summaryText: { color: colors.accent, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  summaryReadOnly: { color: colors.muted, fontSize: 9 },
  emptyCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, marginTop: 12, padding: 16 },
  emptyTitle: { color: colors.text, fontWeight: "800", fontSize: 13 },
  emptyText: { color: colors.muted, fontSize: 10, marginTop: 5 },
  uploadList: { gap: 11, marginTop: 12 },
  uploadCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 17, padding: 14 },
  fieldHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  fileIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#102537", alignItems: "center", justifyContent: "center" },
  fileIconText: { color: colors.accent, fontWeight: "900", fontSize: 9 },
  fieldTitles: { flex: 1 },
  fieldName: { color: colors.text, fontWeight: "800", fontSize: 13 },
  fieldId: { color: colors.muted, fontSize: 8, marginTop: 4 },
  typePill: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 5 },
  typePillFilled: { borderColor: "#275267", backgroundColor: "#102537" },
  typePillEmpty: { borderColor: colors.border, backgroundColor: colors.surfaceRaised },
  typePillText: { color: colors.accent, fontSize: 8, fontWeight: "900", letterSpacing: 0.4 },
  valueBox: { backgroundColor: "#09111A", borderRadius: 11, padding: 11, marginTop: 12 },
  valueHeading: { color: "#74879A", fontSize: 8, fontWeight: "900", letterSpacing: 0.9 },
  valueText: { color: colors.text, fontSize: 10, fontWeight: "700", marginTop: 5 },
  valueHost: { color: colors.muted, fontSize: 8, marginTop: 4 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 11 },
  actionButton: { minHeight: 34, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  actionPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  actionSecondary: { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
  actionDisabled: { opacity: 0.45 },
  actionPressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  actionLabel: { color: colors.text, fontSize: 8, fontWeight: "900", letterSpacing: 0.4 },
  actionLabelPrimary: { color: colors.background },
  uploading: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 10 },
  uploadingText: { color: colors.accent, fontSize: 10, fontWeight: "700" },
  noActions: { color: colors.warning, fontSize: 9, lineHeight: 14, marginTop: 11 },
  permissionNote: { color: "#65788C", fontSize: 8, lineHeight: 13, marginTop: 9 },
});
