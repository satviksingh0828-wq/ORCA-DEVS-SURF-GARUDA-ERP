import { useMemo } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { fontFamilies, fontSizes, space, useAppTheme, type ThemeColors } from "../theme";

import logo from "../../assets/orca-logo.png";

export function BrandFooter() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const openWebsite = async () => {
    try {
      await Linking.openURL("https://orca.devs.surf");
    } catch {
      // Keep the app usable if the device cannot open a browser.
    }
  };

  return (
    <View
      style={styles.wrap}
      accessibilityRole="text"
      accessibilityLabel="Powered by ORCA DEVS SURF"
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Powered by ORCA DEVS SURF"
        onPress={openWebsite}
        style={({ pressed }) => [styles.link, pressed && styles.pressed]}
      >
        <Text style={styles.label}>POWERED BY</Text>
        <Image source={logo} style={styles.logo} resizeMode="contain" />
        <Text style={styles.label}>ORCA DEVS SURF</Text>
      </Pressable>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      minHeight: 34,
      paddingHorizontal: space.lg,
      paddingVertical: space.xs,
      alignItems: "center",
      justifyContent: "center",
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      backgroundColor: colors.surface,
    },
    link: {
      minHeight: 28,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: space.xs,
    },
    pressed: { opacity: 0.62 },
    logo: { width: 20, height: 20, flexShrink: 0, aspectRatio: 1, tintColor: colors.text },
    label: {
      color: colors.text,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.micro,
      letterSpacing: 0.4,
    },
  });
}
