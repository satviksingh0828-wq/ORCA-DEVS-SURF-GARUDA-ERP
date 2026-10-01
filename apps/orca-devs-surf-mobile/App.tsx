import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import { BrandFooter } from "./src/components/BrandFooter";
import { OrcaSplash } from "./src/components/OrcaSplash";
import { AboutScreen } from "./src/screens/AboutScreen";
import { HistoryScreen } from "./src/screens/HistoryScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { ScannerScreen } from "./src/screens/ScannerScreen";
import { actionUrl, fileKind, normalizeManifest, parseJsonQr, qrManifestUrl } from "./src/lib/qr";
import { downloadForPreview, fetchManifest, originOf, uploadFile, validateHttpUrl, verifyCredentials } from "./src/lib/api";
import { clearCredentials, clearHistory, loadCredentials, loadHistory, saveCredentials, saveHistoryItem } from "./src/lib/storage";
import type { AppTab, Credentials, FileAction, FileSource, HistoryAction, HistoryEntry, PickedFile, QrManifest, UploadField } from "./src/types";
import { colors } from "./src/theme";

const logo = require("./assets/orca-logo.png");
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const tabs: { id: AppTab; label: string; mark: string }[] = [
  { id: "scan", label: "Scan", mark: "⌗" },
  { id: "history", label: "History", mark: "↺" },
  { id: "about", label: "About", mark: "i" },
];

function fileNameFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "") || undefined;
  } catch {
    return undefined;
  }
}

function pickManifestBase(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const data = payload as Record<string, unknown>;
    const candidate = data.endpointUrl ?? data.endpoint_url ?? data.apiUrl ?? data.api_url ?? data.baseUrl;
    if (typeof candidate === "string") {
      try {
        return validateHttpUrl(candidate);
      } catch {
        // Fall back to the authenticated endpoint; malformed optional QR hints do not break absolute URLs.
      }
    }
  }
  return fallback;
}

function HistoryTabButton({ item, selected, onPress }: { item: (typeof tabs)[number]; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={styles.tabButton}>
      <Text style={[styles.tabMark, selected && styles.tabMarkActive]}>{item.mark}</Text>
      <Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>{item.label}</Text>
    </Pressable>
  );
}

export default function App() {
  const [hydrated, setHydrated] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeTab, setActiveTab] = useState<AppTab>("scan");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string>();
  const [qrBusy, setQrBusy] = useState(false);
  const [scanError, setScanError] = useState<string>();
  const [manifest, setManifest] = useState<QrManifest | null>(null);
  const [busyUploadId, setBusyUploadId] = useState<string>();
  const [preview, setPreview] = useState<{ uri: string; label: string } | null>(null);
  const trustedOrigins = useRef(new Set<string>());
  const finishSplash = useCallback(() => setShowSplash(false), []);

  useEffect(() => {
    let alive = true;
    Promise.all([loadCredentials().catch(() => null), loadHistory().catch(() => [])]).then(([saved, entries]) => {
      if (!alive) return;
      setCredentials(saved);
      setHistory(entries);
      setHydrated(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const recordHistory = useCallback(async (entry: Omit<HistoryEntry, "id" | "at">) => {
    const complete: HistoryEntry = { ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString() };
    setHistory((previous) => [complete, ...previous].slice(0, 100));
    try {
      const saved = await saveHistoryItem(complete);
      setHistory(saved);
    } catch {
      // In-memory history remains available for this session if local history storage is full.
    }
  }, []);

  const onLogin = useCallback(async (input: Credentials) => {
    setLoginBusy(true);
    setLoginError(undefined);
    try {
      const endpointUrl = validateHttpUrl(input.endpointUrl);
      const verified = { ...input, endpointUrl };
      await verifyCredentials(verified);
      await saveCredentials(verified);
      trustedOrigins.current.clear();
      setCredentials(verified);
      setActiveTab("scan");
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Sign-in could not be completed.");
    } finally {
      setLoginBusy(false);
    }
  }, []);

  const signOut = useCallback(() => {
    Alert.alert("Sign out?", "This removes the saved endpoint credentials from this device. Local activity history is kept.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          void clearCredentials().catch(() => undefined);
          trustedOrigins.current.clear();
          setCredentials(null);
          setManifest(null);
          setScanError(undefined);
          setActiveTab("scan");
        },
      },
    ]);
  }, []);

  const confirmRequestOrigin = useCallback(async (url: string): Promise<boolean> => {
    if (!credentials) return false;
    let safeUrl: string;
    try {
      safeUrl = validateHttpUrl(url);
    } catch (error) {
      Alert.alert("Unsafe URL", error instanceof Error ? error.message : "The QR contains an invalid URL.");
      return false;
    }
    const targetOrigin = originOf(safeUrl);
    const loginOrigin = originOf(validateHttpUrl(credentials.endpointUrl));
    if (targetOrigin === loginOrigin || trustedOrigins.current.has(targetOrigin)) return true;

    return new Promise((resolve) => {
      Alert.alert(
        "Confirm QR server",
        `This QR action will send your ID and password to:\n\n${targetOrigin}\n\nContinue only if you trust the QR code and this server.`,
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          {
            text: "Send credentials",
            style: Platform.OS === "ios" ? "destructive" : "default",
            onPress: () => {
              trustedOrigins.current.add(targetOrigin);
              resolve(true);
            },
          },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  }, [credentials]);

  const handleQrScan = useCallback(async (raw: string) => {
    if (!credentials || qrBusy) return;
    setQrBusy(true);
    setScanError(undefined);
    try {
      let decoded: unknown = parseJsonQr(raw) ?? raw.trim();
      let manifestData: unknown;
      const baseUrl = pickManifestBase(decoded, credentials.endpointUrl);

      try {
        manifestData = normalizeManifest(decoded, baseUrl);
      } catch (directError) {
        const manifestUrl = qrManifestUrl(decoded);
        if (!manifestUrl) throw directError;
        if (!(await confirmRequestOrigin(manifestUrl))) throw new Error("QR request cancelled. No credentials were sent to that server.");
        decoded = await fetchManifest(manifestUrl, credentials);
        manifestData = normalizeManifest(decoded, manifestUrl);
      }

      const next = manifestData as QrManifest;
      setManifest(next);
      setScanError(undefined);
      await recordHistory({
        action: "scan",
        recordId: next.recordId,
        recordTitle: next.title,
        status: "success",
        message: `${next.uploads.length} document field${next.uploads.length === 1 ? "" : "s"} read from the QR manifest.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not read this QR code.";
      setScanError(message);
      await recordHistory({
        action: "scan",
        recordId: "unknown",
        recordTitle: "QR scan",
        status: "failed",
        message,
      });
    } finally {
      setQrBusy(false);
    }
  }, [confirmRequestOrigin, credentials, qrBusy, recordHistory]);

  const handleFileAction = useCallback(async (field: UploadField, action: FileAction, source: FileSource) => {
    if (!credentials || !manifest) return;
    const targetUrl = actionUrl(field, action);
    if (!targetUrl) {
      Alert.alert("Action unavailable", "This QR does not allow the action or did not provide its upload URL.");
      return;
    }
    if (!(await confirmRequestOrigin(targetUrl))) return;

    let file: PickedFile | undefined;
    try {
      if (source === "document") {
        const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: false });
        if (result.canceled || !result.assets.length) return;
        const asset = result.assets[0];
        file = { uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? "application/octet-stream", size: asset.size };
      } else {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error("Camera permission is required to take a document photo.");
        const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.92, allowsEditing: false });
        if (result.canceled || !result.assets.length) return;
        const asset = result.assets[0];
        file = {
          uri: asset.uri,
          name: asset.fileName ?? `orca-photo-${Date.now()}.jpg`,
          mimeType: asset.mimeType ?? "image/jpeg",
          size: asset.fileSize,
        };
      }

      if (file.size && file.size > MAX_FILE_BYTES) {
        throw new Error("This file is over the app's 50 MB upload limit. Choose a smaller file.");
      }
      setBusyUploadId(field.id);
      const response = await uploadFile(targetUrl, credentials, manifest, field.id, action, file);
      const returnedUrl = response.url ?? response.fileUrl ?? response.value;
      if (returnedUrl) {
        setManifest((current) => current ? {
          ...current,
          uploads: current.uploads.map((item) => item.id === field.id ? { ...item, valueUrl: returnedUrl, viewUrl: item.allowView ? returnedUrl : item.viewUrl } : item),
        } : current);
      }
      await recordHistory({
        action,
        recordId: manifest.recordId,
        recordTitle: manifest.title,
        uploadLabel: field.label,
        fileName: file.name,
        status: "success",
        message: response.message ?? `${action === "add" ? "File added" : "File replaced"} successfully.`,
      });
      Alert.alert("Upload complete", response.message ?? `${file.name} was sent successfully.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The file could not be uploaded.";
      await recordHistory({
        action,
        recordId: manifest.recordId,
        recordTitle: manifest.title,
        uploadLabel: field.label,
        fileName: file?.name,
        status: "failed",
        message,
      });
      Alert.alert("Upload failed", message);
    } finally {
      const cacheDirectory = FileSystem.cacheDirectory;
      if (file && cacheDirectory && file.uri.startsWith(cacheDirectory)) {
        await FileSystem.deleteAsync(file.uri, { idempotent: true }).catch(() => undefined);
      }
      setBusyUploadId(undefined);
    }
  }, [confirmRequestOrigin, credentials, manifest, recordHistory]);

  const handleView = useCallback(async (field: UploadField) => {
    if (!credentials || !manifest || !field.allowView || !field.viewUrl) {
      Alert.alert("View unavailable", "This QR does not allow viewing or did not provide a file URL.");
      return;
    }
    if (!(await confirmRequestOrigin(field.viewUrl))) return;
    const filename = fileNameFromUrl(field.valueUrl ?? field.viewUrl) ?? `${field.id}.${field.mimeType.split("/")[1] || "file"}`;
    let cachedUri: string | undefined;
    try {
      const { uri } = await downloadForPreview(field.viewUrl, credentials, filename);
      cachedUri = uri;
      const kind = fileKind(field.mimeType, filename);
      if (kind === "image") {
        setPreview({ uri, label: filename });
        cachedUri = undefined;
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: field.mimeType, dialogTitle: `Open ${field.label}` });
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
        cachedUri = undefined;
      } else {
        throw new Error("No compatible file viewer or sharing service is available on this device.");
      }
      await recordHistory({
        action: "view",
        recordId: manifest.recordId,
        recordTitle: manifest.title,
        uploadLabel: field.label,
        fileName: filename,
        status: "success",
        message: kind === "image" ? "File downloaded and opened in the in-app image preview." : "File downloaded and sent to the device's compatible viewer chooser.",
      });
    } catch (error) {
      if (cachedUri) await FileSystem.deleteAsync(cachedUri, { idempotent: true }).catch(() => undefined);
      const message = error instanceof Error ? error.message : "The file could not be opened.";
      await recordHistory({
        action: "view",
        recordId: manifest.recordId,
        recordTitle: manifest.title,
        uploadLabel: field.label,
        fileName: filename,
        status: "failed",
        message,
      });
      Alert.alert("Could not open file", message);
    }
  }, [confirmRequestOrigin, credentials, manifest, recordHistory]);

  const closePreview = useCallback(() => {
    const uri = preview?.uri;
    setPreview(null);
    if (uri) void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
  }, [preview]);

  const handleRescan = useCallback(() => {
    setManifest(null);
    setScanError(undefined);
  }, []);

  const handleClearHistory = useCallback(async () => {
    await clearHistory().catch(() => undefined);
    setHistory([]);
  }, []);

  if (!hydrated || showSplash) return <OrcaSplash onComplete={finishSplash} />;

  return (
    <SafeAreaView style={styles.root}>
      <ExpoStatusBar style="light" />
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      {!credentials ? (
        <>
          <View style={styles.loginArea}>
            <LoginScreen busy={loginBusy} error={loginError} onSubmit={onLogin} />
          </View>
          <BrandFooter />
        </>
      ) : (
        <>
          <View style={styles.header}>
            <View style={styles.brandBlock}>
              <Image source={logo} style={styles.headerLogo} resizeMode="contain" />
              <View>
                <Text style={styles.headerTitle}>ORCA DEVS SURF</Text>
                <Text numberOfLines={1} style={styles.headerUser}>{credentials.userId}</Text>
              </View>
            </View>
            <Pressable accessibilityRole="button" onPress={signOut} style={styles.signOutButton}>
              <Text style={styles.signOutText}>SIGN OUT</Text>
            </Pressable>
          </View>

          <View style={styles.body}>
            {activeTab === "scan" ? (
              <ScannerScreen
                manifest={manifest}
                scanning={qrBusy}
                busyUploadId={busyUploadId}
                scanError={scanError}
                onScan={handleQrScan}
                onRescan={handleRescan}
                onView={handleView}
                onFileAction={handleFileAction}
              />
            ) : activeTab === "history" ? (
              <HistoryScreen entries={history} onClear={handleClearHistory} />
            ) : (
              <AboutScreen />
            )}
          </View>

          <View style={styles.tabBar}>
            {tabs.map((item) => <HistoryTabButton key={item.id} item={item} selected={activeTab === item.id} onPress={() => setActiveTab(item.id)} />)}
          </View>
          <BrandFooter />
        </>
      )}

      <Modal visible={Boolean(preview)} animationType="fade" onRequestClose={closePreview} statusBarTranslucent>
        <View style={styles.previewRoot}>
          <View style={styles.previewHeader}>
            <View style={styles.previewTitleWrap}>
              <Text style={styles.previewEyebrow}>SECURE PREVIEW</Text>
              <Text numberOfLines={1} style={styles.previewTitle}>{preview?.label}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={closePreview} style={styles.closeButton}><Text style={styles.closeText}>CLOSE</Text></Pressable>
          </View>
          {preview ? <Image source={{ uri: preview.uri }} style={styles.previewImage} resizeMode="contain" /> : null}
          <Text style={styles.previewNote}>This file was fetched using your saved credentials and is displayed from the temporary device cache.</Text>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  loginArea: { flex: 1 },
  header: { minHeight: 62, paddingHorizontal: 17, paddingVertical: 9, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.border },
  brandBlock: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  headerLogo: { width: 37, height: 37 },
  headerTitle: { color: colors.text, fontWeight: "900", fontSize: 11, letterSpacing: 0.8 },
  headerUser: { color: colors.muted, fontSize: 9, marginTop: 3, maxWidth: 190 },
  signOutButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7 },
  signOutText: { color: colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 0.7 },
  body: { flex: 1 },
  tabBar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: "#09111A", paddingTop: 5, paddingBottom: 4 },
  tabButton: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 48, gap: 1 },
  tabMark: { color: "#718398", fontSize: 16, fontWeight: "700", lineHeight: 19 },
  tabMarkActive: { color: colors.accent },
  tabLabel: { color: "#718398", fontSize: 8, fontWeight: "800", letterSpacing: 0.4 },
  tabLabelActive: { color: colors.text },
  previewRoot: { flex: 1, backgroundColor: colors.background, paddingTop: Platform.OS === "android" ? 32 : 54, paddingHorizontal: 15, paddingBottom: 20 },
  previewHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  previewTitleWrap: { flex: 1, paddingRight: 10 },
  previewEyebrow: { color: colors.accent, fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  previewTitle: { color: colors.text, fontSize: 14, fontWeight: "800", marginTop: 3 },
  closeButton: { borderColor: colors.border, borderWidth: 1, borderRadius: 18, paddingHorizontal: 11, paddingVertical: 7 },
  closeText: { color: colors.text, fontSize: 8, fontWeight: "900", letterSpacing: 0.7 },
  previewImage: { flex: 1, width: "100%", marginTop: 12, marginBottom: 10 },
  previewNote: { color: colors.muted, fontSize: 9, lineHeight: 14, textAlign: "center", paddingHorizontal: 8 },
});
