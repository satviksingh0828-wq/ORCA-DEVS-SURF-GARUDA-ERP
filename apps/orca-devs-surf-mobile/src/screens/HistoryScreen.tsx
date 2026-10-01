import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { HistoryEntry } from "../types";
import { colors } from "../theme";

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
  const confirmClear = () => Alert.alert("Clear history?", "This removes only this device's local activity list. It does not delete uploaded documents.", [
    { text: "Cancel", style: "cancel" },
    { text: "Clear history", style: "destructive", onPress: onClear },
  ]);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.headingRow}>
        <View>
          <Text style={styles.eyebrow}>ON THIS DEVICE</Text>
          <Text style={styles.title}>History</Text>
        </View>
        {entries.length > 0 ? <Pressable accessibilityRole="button" onPress={confirmClear}><Text style={styles.clear}>CLEAR</Text></Pressable> : null}
      </View>
      <Text style={styles.subtitle}>Recent scans and document actions. Passwords and authentication headers are never recorded here.</Text>

      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyMark}>—</Text>
          <Text style={styles.emptyTitle}>No activity yet</Text>
          <Text style={styles.emptyText}>QR scans, previews, additions, and replacements will appear here.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {entries.map((entry) => (
            <View key={entry.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.actionBadge}><Text style={styles.actionText}>{actionNames[entry.action]}</Text></View>
                <Text style={[styles.status, entry.status === "success" ? styles.success : styles.failed]}>{entry.status === "success" ? "SUCCESS" : "FAILED"}</Text>
              </View>
              <Text style={styles.record}>{entry.recordTitle}</Text>
              <Text style={styles.meta}>{entry.uploadLabel ? `${entry.uploadLabel} · ` : ""}{entry.fileName ?? entry.recordId}</Text>
              <Text style={styles.message}>{entry.message}</Text>
              <Text style={styles.time}>{new Date(entry.at).toLocaleString()}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 28 },
  headingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: "800", letterSpacing: 1.6 },
  title: { color: colors.text, fontSize: 26, fontWeight: "900", marginTop: 4 },
  clear: { color: colors.danger, fontSize: 10, fontWeight: "900", letterSpacing: 1.1, padding: 8 },
  subtitle: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 9, marginBottom: 18 },
  empty: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 18, alignItems: "center", padding: 26, marginTop: 8 },
  emptyMark: { color: colors.accent, fontSize: 28, fontWeight: "300" },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: "800", marginTop: 4 },
  emptyText: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 7 },
  list: { gap: 10 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 15 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actionBadge: { borderColor: colors.border, borderWidth: 1, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: colors.surfaceRaised },
  actionText: { color: colors.accent, fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  status: { fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  success: { color: colors.success },
  failed: { color: colors.danger },
  record: { color: colors.text, fontSize: 14, fontWeight: "800", marginTop: 12 },
  meta: { color: colors.muted, fontSize: 11, marginTop: 4 },
  message: { color: "#B6C2D0", fontSize: 10, lineHeight: 15, marginTop: 9 },
  time: { color: "#68798C", fontSize: 9, marginTop: 10 },
});
