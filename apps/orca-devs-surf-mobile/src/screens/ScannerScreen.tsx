import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { FileAction, FileSource, MetadataField, QrManifest, UploadField } from "../types";
import { actionUrl, displayFileType } from "../lib/qr";
import { fontFamilies, fontSizes, radius, space, useAppTheme, type ThemeColors } from "../theme";

import logo from "../../assets/orca-logo.png";

interface ScannerScreenProps {
  manifest: QrManifest | null;
  scanning: boolean;
  busyUploadId?: string;
  scanError?: string;
  onScan: (data: string) => void;
  onRescan: () => void;
  onView: (field: UploadField) => void;
  onFileAction: (
    field: UploadField,
    action: FileAction,
    source: FileSource,
    metadataValues?: Record<string, string>,
  ) => void;
  onMetadataSave: (values: Record<string, string>) => void;
  metadataSaving: boolean;
}

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function dateForPicker(value?: string) {
  if (value && validIsoDate(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }
  return new Date();
}

function pickerDateToIso(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayIsoDate(value: string) {
  if (!validIsoDate(value)) return value;
  const [year, month, day] = value.split("-");
  return `${day}-${month}-${year}`;
}

function legacyMetadataFields(creation: QrManifest["creation"]): MetadataField[] {
  if (!creation) return [];
  const fields: MetadataField[] = [
    {
      id: "deliveryDate",
      label: "Delivery date",
      type: "date",
      value: "",
      required: creation.deliveryDateRequired,
      editable: true,
    },
  ];
  if (creation.transporterLrRequired) {
    fields.push(
      {
        id: "transporterLrNumber",
        label: "Transporter LR number",
        type: "text",
        value: "",
        required: true,
        editable: true,
      },
      {
        id: "transporterLrDate",
        label: "Transporter LR date",
        type: "date",
        value: "",
        required: true,
        editable: true,
      },
    );
  }
  return fields;
}

function fileNameFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const name =
      parsed.searchParams.get("filename") ??
      decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() ?? "");
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

function SmallAction({
  label,
  onPress,
  kind = "secondary",
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "secondary";
  disabled?: boolean;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        kind === "primary" ? styles.actionPrimary : styles.actionSecondary,
        disabled && styles.actionDisabled,
        pressed && styles.actionPressed,
      ]}
    >
      <Text style={[styles.actionLabel, kind === "primary" && styles.actionLabelPrimary]}>
        {label}
      </Text>
    </Pressable>
  );
}

function UploadCard({
  field,
  disabled,
  uploadDisabled,
  onView,
  onFileAction,
}: {
  field: UploadField;
  disabled: boolean;
  uploadDisabled: boolean;
  onView: (field: UploadField) => void;
  onFileAction: (field: UploadField, action: FileAction, source: FileSource) => void;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const addUrl = actionUrl(field, "add");
  const replaceUrl = actionUrl(field, "replace");
  const canView = field.allowView && Boolean(field.viewUrl);
  const hasValue = field.hasValue ?? Boolean(field.valueUrl);
  const visibleUrl = canView ? field.valueUrl : undefined;
  const visibleType = hasValue && canView ? displayFileType(field) : "FILE";
  const filename = fileNameFromUrl(visibleUrl);

  return (
    <View style={styles.uploadCard}>
      <View style={styles.fieldHeading}>
        <View style={styles.fileIcon}>
          <Text style={styles.fileIconText}>
            {(hasValue && canView ? visibleType : "FILE").slice(0, 3)}
          </Text>
        </View>
        <View style={styles.fieldTitles}>
          <Text style={styles.fieldName}>{field.label}</Text>
          <Text style={styles.fieldId}>ID · {field.id}</Text>
        </View>
        <View style={[styles.typePill, hasValue ? styles.typePillFilled : styles.typePillEmpty]}>
          <Text style={styles.typePillText}>{hasValue ? visibleType : "EMPTY"}</Text>
        </View>
      </View>

      <View style={styles.valueBox}>
        <Text style={styles.valueHeading}>{hasValue ? "CURRENT FILE" : "CURRENT VALUE"}</Text>
        <Text numberOfLines={2} style={styles.valueText}>
          {filename ??
            (visibleUrl
              ? safeUrlLabel(visibleUrl)
              : hasValue
                ? "A file is attached; preview is not allowed for this account."
                : "No file is currently attached")}
        </Text>
        {visibleUrl && safeUrlLabel(visibleUrl) ? (
          <Text numberOfLines={1} style={styles.valueHost}>
            {safeUrlLabel(visibleUrl)}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        {canView ? (
          <SmallAction
            label="VIEW / PREVIEW"
            onPress={() => onView(field)}
            disabled={disabled}
            kind="primary"
          />
        ) : null}
        {addUrl ? (
          <SmallAction
            label="ADD FILE"
            onPress={() => onFileAction(field, "add", "document")}
            disabled={disabled || uploadDisabled}
          />
        ) : null}
        {addUrl ? (
          <SmallAction
            label="TAKE PHOTO"
            onPress={() => onFileAction(field, "add", "photo")}
            disabled={disabled || uploadDisabled}
          />
        ) : null}
        {replaceUrl ? (
          <SmallAction
            label="REPLACE FILE"
            onPress={() => onFileAction(field, "replace", "document")}
            disabled={disabled || uploadDisabled}
          />
        ) : null}
        {replaceUrl ? (
          <SmallAction
            label="REPLACE WITH PHOTO"
            onPress={() => onFileAction(field, "replace", "photo")}
            disabled={disabled || uploadDisabled}
          />
        ) : null}
      </View>

      {disabled ? (
        <View style={styles.uploading}>
          <ActivityIndicator color={colors.text} size="small" />
          <Text style={styles.uploadingText}>Sending securely…</Text>
        </View>
      ) : null}
      {!canView && !addUrl && !replaceUrl ? (
        <Text style={styles.noActions}>This QR provides no enabled file action for this item.</Text>
      ) : null}
      <Text style={styles.permissionNote}>
        Actions are shown only when allowed by this QR and an action URL is provided.
      </Text>
    </View>
  );
}

export function ScannerScreen({
  manifest,
  scanning,
  busyUploadId,
  scanError,
  onScan,
  onRescan,
  onView,
  onFileAction,
  onMetadataSave,
  metadataSaving,
}: ScannerScreenProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanLocked, setScanLocked] = useState(false);
  const [torch, setTorch] = useState(false);
  const [datePickerField, setDatePickerField] = useState<string | null>(null);
  const [metadataValues, setMetadataValues] = useState<Record<string, string>>({});
  const metadataFields = useMemo(
    () => manifest?.metadata?.fields ?? legacyMetadataFields(manifest?.creation),
    [manifest?.creation, manifest?.metadata?.fields],
  );

  useEffect(() => {
    setMetadataValues(Object.fromEntries(metadataFields.map((field) => [field.id, field.value])));
    setDatePickerField(null);
  }, [metadataFields]);

  const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    const field = datePickerField;
    setDatePickerField(null);
    if (event.type === "set" && selectedDate && field) {
      const formattedDate = pickerDateToIso(selectedDate);
      setMetadataValues((current) => ({ ...current, [field]: formattedDate }));
    }
  };

  useEffect(() => {
    if (!manifest && !scanning) setScanLocked(false);
  }, [manifest, scanning]);

  const onBarcode = ({ data }: { data: string }) => {
    if (scanLocked || scanning || manifest) return;
    setScanLocked(true);
    onScan(data);
  };
  const creationComplete = metadataFields
    .filter((field) => field.required)
    .every((field) => {
      const value = (metadataValues[field.id] ?? field.value).trim();
      if (!value) return false;
      if (field.type === "date") return validIsoDate(value);
      if (field.type === "number") return Number.isFinite(Number(value));
      if (field.type === "select" && field.options?.length) {
        return field.options.some((option) => option.value === value);
      }
      return true;
    });
  const metadataMode = manifest?.metadata?.mode ?? (manifest?.creation ? "create" : undefined);
  const metadataCanSync = Boolean(
    manifest?.metadata?.updateUrl &&
    metadataFields.some((field) => {
      const value = (metadataValues[field.id] ?? field.value).trim();
      const original = field.value.trim();
      return (field.editable || field.syncOnly) && (Boolean(field.syncOnly) || value !== original);
    }),
  );

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.titleRow}>
        <View>
          <Text style={styles.eyebrow}>SECURE DOCUMENT ACCESS</Text>
          <Text style={styles.title}>Scan</Text>
        </View>
        <Image source={logo} style={styles.miniLogo} tintColor={colors.text} resizeMode="contain" />
      </View>
      <Text style={styles.subtitle}>
        Scan an ORCA application QR to read the document fields and permitted actions.
      </Text>

      {!manifest ? (
        <>
          {!permission?.granted ? (
            <View style={styles.permissionCard}>
              <Text style={styles.permissionTitle}>Camera access is needed</Text>
              <Text style={styles.permissionBody}>
                Allow the camera to scan a document QR code. Photos are captured only after you
                choose an allowed upload action.
              </Text>
              <SmallAction
                label={
                  permission?.canAskAgain === false ? "OPEN CAMERA PERMISSION" : "ALLOW CAMERA"
                }
                onPress={requestPermission}
                kind="primary"
              />
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
                <View style={styles.scanFrame}>
                  <View style={styles.scanLine} />
                </View>
                <Text style={styles.scanHint}>
                  {scanning ? "READING QR…" : "ALIGN THE QR CODE INSIDE THE FRAME"}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => setTorch((value) => !value)}
                style={styles.torchButton}
              >
                <Text style={styles.torchText}>{torch ? "TORCH ON" : "TORCH OFF"}</Text>
              </Pressable>
            </View>
          )}
          {scanning ? (
            <View style={styles.statusLine}>
              <ActivityIndicator color={colors.text} />
              <Text style={styles.statusText}>Checking the QR manifest…</Text>
            </View>
          ) : null}
          {scanError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {scanError}
            </Text>
          ) : null}
          <View style={styles.tipCard}>
            <Text style={styles.tipTitle}>QR-controlled access</Text>
            <Text style={styles.tipText}>
              The app displays an action only when the QR allows it and provides its server URL.
              Your ID/password are never placed in a URL.
            </Text>
          </View>
        </>
      ) : (
        <>
          <View style={styles.manifestCard}>
            <View style={styles.manifestTop}>
              <View style={styles.manifestLogo}>
                <Image
                  source={logo}
                  style={styles.manifestLogoImage}
                  tintColor={colors.text}
                  resizeMode="contain"
                />
              </View>
              <View style={styles.manifestCopy}>
                <Text style={styles.manifestTitle}>{manifest.title}</Text>
                <Text style={styles.manifestMeta}>RECORD · {manifest.recordId}</Text>
              </View>
            </View>
            <View style={styles.manifestSummary}>
              <Text style={styles.summaryText}>
                {manifest.uploads.length}{" "}
                {manifest.uploads.length === 1 ? "DOCUMENT FIELD" : "DOCUMENT FIELDS"}
              </Text>
              <Text style={styles.summaryReadOnly}>QR permissions apply</Text>
            </View>
            <SmallAction label="SCAN ANOTHER QR" onPress={onRescan} />
          </View>
          {metadataFields.length ? (
            <View style={styles.creationCard}>
              <Text style={styles.creationTitle}>
                {metadataMode === "create" ? "Create Outward POD" : "Outward POD details"}
              </Text>
              <Text style={styles.creationDescription}>
                {metadataMode === "create"
                  ? "Complete the fields below. The first successful file upload creates the POD and saves these details to the ERP."
                  : "Edit, clear, or fill supported fields and sync your changes to the ERP."}
              </Text>
              {metadataFields.map((field) => {
                const value = metadataValues[field.id] ?? field.value;
                const displayValue =
                  field.type === "date" && value ? displayIsoDate(value) : value || "Not set";
                return (
                  <View key={field.id} style={styles.creationField}>
                    <Text style={styles.creationLabel}>
                      {field.label}
                      {field.required ? " · required" : ""}
                      {field.syncOnly ? " · ERP value ready to sync" : ""}
                      {!field.editable && !field.syncOnly ? " · saved" : ""}
                    </Text>
                    {!field.editable ? (
                      <View style={styles.creationReadOnly}>
                        <Text style={styles.creationDateText}>{displayValue}</Text>
                      </View>
                    ) : field.type === "date" ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Select ${field.label}`}
                        onPress={() => setDatePickerField(field.id)}
                        style={styles.creationDateButton}
                      >
                        <Text
                          style={[
                            styles.creationDateText,
                            !value && styles.creationDatePlaceholder,
                          ]}
                        >
                          {value ? displayIsoDate(value) : `Select ${field.label.toLowerCase()}`}
                        </Text>
                      </Pressable>
                    ) : field.type === "select" && field.options?.length ? (
                      <View style={styles.metadataOptions}>
                        {field.options.map((option) => {
                          const selected = value === option.value;
                          return (
                            <Pressable
                              key={option.value}
                              accessibilityRole="button"
                              accessibilityState={{ selected }}
                              onPress={() =>
                                setMetadataValues((current) => ({
                                  ...current,
                                  [field.id]: option.value,
                                }))
                              }
                              style={[
                                styles.metadataOption,
                                selected && styles.metadataOptionSelected,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.metadataOptionText,
                                  selected && styles.metadataOptionTextSelected,
                                ]}
                              >
                                {option.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : (
                      <TextInput
                        value={value}
                        onChangeText={(nextValue) =>
                          setMetadataValues((current) => ({ ...current, [field.id]: nextValue }))
                        }
                        placeholder={`Enter ${field.label.toLowerCase()}`}
                        placeholderTextColor={colors.muted}
                        keyboardType={field.type === "number" ? "numeric" : "default"}
                        style={styles.creationInput}
                      />
                    )}
                  </View>
                );
              })}
              {datePickerField &&
              metadataFields.some(
                (field) => field.id === datePickerField && field.type === "date",
              ) ? (
                <DateTimePicker
                  value={dateForPicker(metadataValues[datePickerField])}
                  mode="date"
                  display="default"
                  onChange={onDateChange}
                />
              ) : null}
              {metadataMode === "create" && !creationComplete ? (
                <Text style={styles.creationHint}>
                  Complete the required fields to enable the first POD upload.
                </Text>
              ) : null}
              {metadataMode === "update" && manifest.metadata?.updateUrl ? (
                <SmallAction
                  label={metadataSaving ? "SYNCING TO ERP…" : "SYNC DETAILS TO ERP"}
                  kind="primary"
                  disabled={metadataSaving || !metadataCanSync}
                  onPress={() => onMetadataSave(metadataValues)}
                />
              ) : null}
            </View>
          ) : null}
          {manifest.uploads.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No file fields available</Text>
              <Text style={styles.emptyText}>
                The scanned manifest contains an empty uploads list.
              </Text>
            </View>
          ) : (
            <View style={styles.uploadList}>
              {manifest.uploads.map((field) => (
                <UploadCard
                  key={field.id}
                  field={field}
                  disabled={busyUploadId === field.id}
                  uploadDisabled={!creationComplete}
                  onView={onView}
                  onFileAction={(selectedField, action, source) =>
                    onFileAction(
                      selectedField,
                      action,
                      source,
                      metadataMode === "create" ? metadataValues : undefined,
                    )
                  }
                />
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    content: { paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.xl },
    titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    eyebrow: {
      color: colors.muted,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.caption,
      letterSpacing: 0.5,
    },
    title: {
      color: colors.text,
      fontFamily: fontFamilies.bold,
      fontSize: fontSizes.title,
      marginTop: space.xs,
    },
    subtitle: {
      color: colors.muted,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.body,
      lineHeight: 20,
      marginTop: space.sm,
      marginBottom: space.lg,
    },
    miniLogo: { width: 40, height: 40 },
    cameraWrap: {
      height: 308,
      borderRadius: radius.md,
      overflow: "hidden",
      backgroundColor: "#000000",
      borderWidth: 1,
      borderColor: colors.border,
    },
    camera: { flex: 1 },
    scanOverlay: {
      ...StyleSheet.absoluteFill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(0, 0, 0, 0.18)",
    },
    scanFrame: {
      width: 214,
      height: 214,
      borderWidth: 2,
      borderRadius: radius.lg,
      borderColor: "#FFFFFF",
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000000",
      shadowOpacity: 0.3,
      shadowRadius: 12,
      elevation: 6,
    },
    scanLine: { width: 178, height: 1, backgroundColor: "rgba(255,255,255,0.7)" },
    scanHint: {
      color: "#FFFFFF",
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.micro,
      letterSpacing: 0.6,
      marginTop: space.md,
      textShadowColor: "#000000",
      textShadowRadius: 4,
    },
    torchButton: {
      position: "absolute",
      right: space.md,
      top: space.md,
      minHeight: 40,
      justifyContent: "center",
      paddingVertical: space.xs,
      paddingHorizontal: space.md,
      backgroundColor: "rgba(0,0,0,0.72)",
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.3)",
    },
    torchText: {
      color: "#FFFFFF",
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.micro,
      letterSpacing: 0.4,
    },
    permissionCard: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.md,
      padding: space.lg,
      gap: space.md,
    },
    permissionTitle: {
      color: colors.text,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.label,
    },
    permissionBody: {
      color: colors.muted,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.description,
      lineHeight: 20,
    },
    statusLine: { flexDirection: "row", gap: space.sm, alignItems: "center", marginTop: space.md },
    statusText: {
      color: colors.text,
      fontFamily: fontFamilies.medium,
      fontSize: fontSizes.description,
    },
    error: {
      color: colors.danger,
      fontFamily: fontFamilies.medium,
      fontSize: fontSizes.description,
      lineHeight: 19,
      marginTop: space.md,
    },
    tipCard: {
      borderLeftWidth: 2,
      borderLeftColor: colors.text,
      backgroundColor: colors.surface,
      padding: space.md,
      marginTop: space.lg,
      borderRadius: radius.sm,
    },
    tipTitle: {
      color: colors.text,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.description,
    },
    tipText: {
      color: colors.muted,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.caption,
      lineHeight: 18,
      marginTop: space.xs,
    },
    creationCard: {
      borderRadius: radius.md,
      borderColor: colors.border,
      borderWidth: 1,
      backgroundColor: colors.surface,
      padding: space.lg,
      marginTop: space.md,
      gap: space.md,
    },
    creationTitle: {
      color: colors.text,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.label,
    },
    creationDescription: {
      color: colors.muted,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.caption,
      lineHeight: 18,
    },
    creationField: { gap: space.xs },
    creationLabel: {
      color: colors.text,
      fontFamily: fontFamilies.medium,
      fontSize: fontSizes.caption,
    },
    creationInput: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      backgroundColor: colors.input,
      color: colors.text,
      paddingHorizontal: space.md,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.description,
    },
    creationDateButton: {
      minHeight: 44,
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      backgroundColor: colors.input,
      paddingHorizontal: space.md,
    },
    creationDateText: {
      color: colors.text,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.description,
    },
    creationDatePlaceholder: { color: colors.muted },
    creationReadOnly: {
      minHeight: 44,
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      backgroundColor: colors.surface,
      paddingHorizontal: space.md,
    },
    metadataOptions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
    metadataOption: {
      minHeight: 40,
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.pill,
      paddingHorizontal: space.md,
    },
    metadataOptionSelected: {
      backgroundColor: colors.text,
      borderColor: colors.text,
    },
    metadataOptionText: {
      color: colors.text,
      fontFamily: fontFamilies.medium,
      fontSize: fontSizes.caption,
    },
    metadataOptionTextSelected: { color: colors.background },
    creationHint: {
      color: colors.muted,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.caption,
      lineHeight: 18,
    },
    manifestCard: {
      borderRadius: radius.md,
      borderColor: colors.border,
      borderWidth: 1,
      backgroundColor: colors.surface,
      padding: space.lg,
      marginTop: space.xs,
    },
    manifestTop: { flexDirection: "row", alignItems: "center", gap: space.md },
    manifestLogo: {
      width: 48,
      height: 48,
      borderRadius: radius.sm,
      backgroundColor: colors.input,
      alignItems: "center",
      justifyContent: "center",
    },
    manifestLogoImage: { width: 32, height: 32 },
    manifestCopy: { flex: 1 },
    manifestTitle: {
      color: colors.text,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.label,
    },
    manifestMeta: {
      color: colors.muted,
      fontFamily: fontFamilies.medium,
      fontSize: fontSizes.caption,
      letterSpacing: 0.3,
      marginTop: space.xs,
    },
    manifestSummary: {
      borderTopWidth: 1,
      borderColor: colors.divider,
      marginTop: space.md,
      paddingTop: space.md,
      paddingBottom: space.md,
      flexDirection: "row",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: space.xs,
    },
    summaryText: {
      color: colors.text,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.caption,
      letterSpacing: 0.3,
    },
    summaryReadOnly: {
      color: colors.muted,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.caption,
    },
    emptyCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      marginTop: space.md,
      padding: space.lg,
    },
    emptyTitle: { color: colors.text, fontFamily: fontFamilies.semiBold, fontSize: fontSizes.body },
    emptyText: {
      color: colors.muted,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.description,
      marginTop: space.xs,
    },
    uploadList: { gap: space.sm, marginTop: space.md },
    uploadCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: space.lg,
    },
    fieldHeading: { flexDirection: "row", alignItems: "center", gap: space.sm },
    fileIcon: {
      width: 40,
      height: 40,
      borderRadius: radius.sm,
      backgroundColor: colors.input,
      alignItems: "center",
      justifyContent: "center",
    },
    fileIconText: { color: colors.text, fontFamily: fontFamilies.bold, fontSize: fontSizes.micro },
    fieldTitles: { flex: 1 },
    fieldName: { color: colors.text, fontFamily: fontFamilies.semiBold, fontSize: fontSizes.body },
    fieldId: {
      color: colors.muted,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.caption,
      marginTop: space.xs,
    },
    typePill: {
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
    },
    typePillFilled: { borderColor: colors.border, backgroundColor: colors.input },
    typePillEmpty: { borderColor: colors.border, backgroundColor: colors.surface },
    typePillText: {
      color: colors.text,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.micro,
      letterSpacing: 0.3,
    },
    valueBox: {
      backgroundColor: colors.input,
      borderRadius: radius.sm,
      padding: space.md,
      marginTop: space.md,
    },
    valueHeading: {
      color: colors.muted,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.micro,
      letterSpacing: 0.4,
    },
    valueText: {
      color: colors.text,
      fontFamily: fontFamilies.medium,
      fontSize: fontSizes.description,
      marginTop: space.xs,
    },
    valueHost: {
      color: colors.muted,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.caption,
      marginTop: space.xs,
    },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.md },
    actionButton: {
      minHeight: 44,
      borderRadius: radius.sm,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: space.md,
    },
    actionPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
    actionSecondary: { backgroundColor: colors.surface, borderColor: colors.border },
    actionDisabled: { opacity: 0.45 },
    actionPressed: { opacity: 0.72 },
    actionLabel: {
      color: colors.text,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.small,
      letterSpacing: 0.2,
    },
    actionLabelPrimary: { color: colors.textOnAccent },
    uploading: { flexDirection: "row", gap: space.sm, alignItems: "center", marginTop: space.md },
    uploadingText: {
      color: colors.text,
      fontFamily: fontFamilies.medium,
      fontSize: fontSizes.caption,
    },
    noActions: {
      color: colors.muted,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.caption,
      lineHeight: 18,
      marginTop: space.md,
    },
    permissionNote: {
      color: colors.muted,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.micro,
      lineHeight: 15,
      marginTop: space.md,
    },
  });
}
