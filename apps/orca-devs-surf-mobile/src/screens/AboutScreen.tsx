import { useMemo } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { fontFamilies, fontSizes, radius, space, useAppTheme, type ThemeColors } from "../theme";

const features = [
  ["QR permissions", "Only actions explicitly enabled by the scanned QR are shown."],
  [
    "Secure requests",
    "The saved ID and password are sent as HTTP Basic authentication for each permitted view, add, and replace request.",
  ],
  [
    "Encrypted local sign-in",
    "Credentials are stored with the device secure-storage service. Passwords are not added to local activity history.",
  ],
  [
    "Files and photos",
    "Pick a document or capture a photo when the QR supplies an allowed upload destination.",
  ],
];

export function AboutScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const openWebsite = () => Linking.openURL("https://orca.devs.surf").catch(() => undefined);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>ABOUT</Text>
      <Text style={styles.title}>ORCA DEVS SURF</Text>
      <Text style={styles.intro}>
        A secured document uploading application for ORCA DEVS SURF applications.
      </Text>

      <View style={styles.brandCard}>
        <Text style={styles.brandLabel}>DOCUMENT ACCESS</Text>
        <Text style={styles.brandText}>
          Scan an application QR code to see available document fields, current files, and the
          view/add/replace actions allowed for that record.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>How it protects your workflow</Text>
      <View style={styles.featureList}>
        {features.map(([title, description], index) => (
          <View key={title} style={styles.feature}>
            <View style={styles.index}>
              <Text style={styles.indexText}>{String(index + 1).padStart(2, "0")}</Text>
            </View>
            <View style={styles.featureCopy}>
              <Text style={styles.featureTitle}>{title}</Text>
              <Text style={styles.featureText}>{description}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>Only trust QR codes from your organization</Text>
        <Text style={styles.noticeText}>
          If a QR action points to a server different from your login endpoint, the app asks before
          sending your credentials to that host. Use HTTPS outside a private development network.
        </Text>
      </View>

      <Pressable
        accessibilityRole="link"
        onPress={openWebsite}
        style={({ pressed }) => [styles.websiteButton, pressed && styles.pressed]}
      >
        <Text style={styles.websiteButtonText}>VISIT ORCA.DEVS.SURF</Text>
      </Pressable>
      <Text style={styles.version}>ORCA DOCUMENTS · 1.0.0</Text>
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    content: { paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.xl },
    eyebrow: {
      color: colors.muted,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.caption,
      letterSpacing: 0.6,
    },
    title: {
      color: colors.text,
      fontFamily: fontFamilies.bold,
      fontSize: fontSizes.title,
      letterSpacing: 0.4,
      marginTop: space.xs,
    },
    intro: {
      color: colors.muted,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.body,
      lineHeight: 21,
      marginTop: space.sm,
    },
    brandCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: space.lg,
      marginTop: space.lg,
    },
    brandLabel: {
      color: colors.text,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.caption,
      letterSpacing: 0.5,
    },
    brandText: {
      color: colors.text,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.description,
      lineHeight: 20,
      marginTop: space.sm,
    },
    sectionTitle: {
      color: colors.text,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.heading,
      marginTop: space.xl,
      marginBottom: space.md,
    },
    featureList: { gap: space.sm },
    feature: {
      flexDirection: "row",
      gap: space.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: space.md,
    },
    index: {
      width: 36,
      height: 36,
      borderRadius: radius.sm,
      backgroundColor: colors.input,
      alignItems: "center",
      justifyContent: "center",
    },
    indexText: {
      color: colors.text,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.caption,
    },
    featureCopy: { flex: 1 },
    featureTitle: {
      color: colors.text,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.description,
    },
    featureText: {
      color: colors.muted,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.caption,
      lineHeight: 18,
      marginTop: space.xs,
    },
    notice: {
      borderLeftWidth: 2,
      borderLeftColor: colors.text,
      paddingLeft: space.md,
      marginTop: space.xl,
    },
    noticeTitle: {
      color: colors.text,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.description,
    },
    noticeText: {
      color: colors.muted,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.caption,
      lineHeight: 18,
      marginTop: space.xs,
    },
    websiteButton: {
      minHeight: 48,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.sm,
      alignItems: "center",
      justifyContent: "center",
      marginTop: space.xl,
      backgroundColor: colors.surface,
    },
    websiteButtonText: {
      color: colors.text,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.small,
      letterSpacing: 0.4,
    },
    pressed: { opacity: 0.7 },
    version: {
      color: colors.muted,
      textAlign: "center",
      fontFamily: fontFamilies.medium,
      fontSize: fontSizes.micro,
      letterSpacing: 0.5,
      marginTop: space.md,
    },
  });
}
