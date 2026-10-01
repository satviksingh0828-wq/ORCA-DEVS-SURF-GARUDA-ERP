import { useMemo } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { HistoryEntry } from "../types";
import { fontFamilies, fontSizes, radius, space, useAppTheme, type ThemeColors } from "../theme";

interface HistoryScreenProps {
  entries: HistoryEntry[];
  onClear: () => void;
}

const actionNames: Record<HistoryEntry["action"], string> = {
  scan: "QR SCAN",
  view: "VIEW",
  add: "ADD FILE",
  replace: "REPLACE FILE",
};

export function HistoryScreen({ entries, onClear }: HistoryScreenProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const confirmClear = () =>
    Alert.alert(
      "Clear history?",
      "This removes only this device's local activity list. It does not delete uploaded documents.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear history", style: "destructive", onPress: onClear },
      ],
    );

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.headingRow}>
        <View>
          <Text style={styles.eyebrow}>ON THIS DEVICE</Text>
          <Text style={styles.title}>Recent activity</Text>
        </View>
        {entries.length > 0 ? (
          <Pressable accessibilityRole="button" onPress={confirmClear} style={styles.clearButton}>
            <Text style={styles.clear}>CLEAR</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.subtitle}>
        Recent scans and document actions. Passwords and authentication headers are never recorded
        here.
      </Text>

      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyMark}>—</Text>
          <Text style={styles.emptyTitle}>No activity yet</Text>
          <Text style={styles.emptyText}>
            QR scans, previews, additions, and replacements will appear here.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {entries.map((entry) => (
            <View key={entry.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.actionBadge}>
                  <Text style={styles.actionText}>{actionNames[entry.action]}</Text>
                </View>
                <Text
                  style={[
                    styles.status,
                    entry.status === "success" ? styles.success : styles.failed,
                  ]}
                >
                  {entry.status === "success" ? "SUCCESS" : "FAILED"}
                </Text>
              </View>
              <Text style={styles.record}>{entry.recordTitle}</Text>
              <Text style={styles.meta}>
                {entry.uploadLabel ? `${entry.uploadLabel} · ` : ""}
                {entry.fileName ?? entry.recordId}
              </Text>
              <Text style={styles.message}>{entry.message}</Text>
              <Text style={styles.time}>{new Date(entry.at).toLocaleString()}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    content: { paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.xl },
    headingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
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
    clearButton: {
      minHeight: 44,
      minWidth: 48,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: space.sm,
    },
    clear: {
      color: colors.text,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.small,
      letterSpacing: 0.4,
    },
    subtitle: {
      color: colors.muted,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.body,
      lineHeight: 20,
      marginTop: space.sm,
      marginBottom: space.lg,
    },
    empty: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      alignItems: "center",
      padding: space.xl,
      marginTop: space.sm,
    },
    emptyMark: { color: colors.text, fontFamily: fontFamilies.regular, fontSize: 28 },
    emptyTitle: {
      color: colors.text,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.label,
      marginTop: space.xs,
    },
    emptyText: {
      color: colors.muted,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.description,
      lineHeight: 19,
      textAlign: "center",
      marginTop: space.sm,
    },
    list: { gap: space.sm },
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: space.lg,
    },
    cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    actionBadge: {
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      backgroundColor: colors.input,
    },
    actionText: {
      color: colors.text,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.micro,
      letterSpacing: 0.4,
    },
    status: { fontFamily: fontFamilies.semiBold, fontSize: fontSizes.micro, letterSpacing: 0.4 },
    success: { color: colors.success },
    failed: { color: colors.danger },
    record: {
      color: colors.text,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.body,
      marginTop: space.md,
    },
    meta: {
      color: colors.muted,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.description,
      marginTop: space.xs,
    },
    message: {
      color: colors.text,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.description,
      lineHeight: 19,
      marginTop: space.sm,
    },
    time: {
      color: colors.muted,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.caption,
      marginTop: space.md,
    },
  });
}
