import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

const features = [
  ["QR permissions", "Only actions explicitly enabled by the scanned QR are shown."],
  ["Secure requests", "The saved ID and password are sent as HTTP Basic authentication for each permitted view, add, and replace request."],
  ["Encrypted local sign-in", "Credentials are stored with the device secure-storage service. Passwords are not added to local activity history."],
  ["Files and photos", "Pick a document or capture a photo when the QR supplies an allowed upload destination."],
];

export function AboutScreen() {
  const openWebsite = () => Linking.openURL("https://orca.devs.surf").catch(() => undefined);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>ABOUT</Text>
      <Text style={styles.title}>ORCA DEVS SURF</Text>
      <Text style={styles.intro}>A secured document uploading application for ORCA DEVS SURF applications.</Text>

      <View style={styles.brandCard}>
        <Text style={styles.brandLabel}>DOCUMENT ACCESS</Text>
        <Text style={styles.brandText}>Scan an application QR code to see available document fields, current files, and the view/add/replace actions allowed for that record.</Text>
      </View>

      <Text style={styles.sectionTitle}>How it protects your workflow</Text>
      <View style={styles.featureList}>
        {features.map(([title, description], index) => (
          <View key={title} style={styles.feature}>
            <View style={styles.index}><Text style={styles.indexText}>{String(index + 1).padStart(2, "0")}</Text></View>
            <View style={styles.featureCopy}>
              <Text style={styles.featureTitle}>{title}</Text>
              <Text style={styles.featureText}>{description}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>Only trust QR codes from your organization</Text>
        <Text style={styles.noticeText}>If a QR action points to a server different from your login endpoint, the app asks before sending your credentials to that host. Use HTTPS outside a private development network.</Text>
      </View>

      <Pressable accessibilityRole="link" onPress={openWebsite} style={styles.websiteButton}>
        <Text style={styles.websiteButtonText}>VISIT ORCA.DEVS.SURF</Text>
      </Pressable>
      <Text style={styles.version}>ORCA DOCUMENTS · 1.0.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 28 },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: "900", letterSpacing: 1.8 },
  title: { color: colors.text, fontSize: 25, fontWeight: "900", letterSpacing: 1.3, marginTop: 6 },
  intro: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 9 },
  brandCard: { backgroundColor: "#0B1B29", borderWidth: 1, borderColor: "#1B4055", borderRadius: 18, padding: 17, marginTop: 20 },
  brandLabel: { color: colors.accent, fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  brandText: { color: colors.text, fontSize: 12, lineHeight: 19, marginTop: 9 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: "800", marginTop: 24, marginBottom: 11 },
  featureList: { gap: 10 },
  feature: { flexDirection: "row", gap: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 13 },
  index: { width: 32, height: 32, borderRadius: 11, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  indexText: { color: colors.accent, fontSize: 9, fontWeight: "900" },
  featureCopy: { flex: 1 },
  featureTitle: { color: colors.text, fontSize: 12, fontWeight: "800" },
  featureText: { color: colors.muted, fontSize: 10, lineHeight: 16, marginTop: 4 },
  notice: { borderLeftWidth: 2, borderLeftColor: colors.warning, paddingLeft: 12, marginTop: 21 },
  noticeTitle: { color: colors.warning, fontSize: 11, fontWeight: "800" },
  noticeText: { color: colors.muted, fontSize: 10, lineHeight: 16, marginTop: 5 },
  websiteButton: { height: 45, borderColor: colors.border, borderWidth: 1, borderRadius: 13, alignItems: "center", justifyContent: "center", marginTop: 21, backgroundColor: colors.surface },
  websiteButtonText: { color: colors.accent, fontWeight: "900", fontSize: 10, letterSpacing: 1.2 },
  version: { color: "#657589", textAlign: "center", fontSize: 8, fontWeight: "700", letterSpacing: 1.1, marginTop: 14 },
});
