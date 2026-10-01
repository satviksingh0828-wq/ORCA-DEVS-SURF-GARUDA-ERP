import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

export function BrandFooter() {
  const openWebsite = async () => {
    try {
      await Linking.openURL("https://orca.devs.surf");
    } catch {
      // Keep the app usable if the device cannot open a browser.
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.powered}>POWERED BY ORCA DEVS SURF</Text>
      <Pressable accessibilityRole="link" onPress={openWebsite}>
        <Text style={styles.link}>orca.devs.surf</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 10,
    paddingBottom: 7,
    gap: 3,
  },
  powered: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  link: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "700",
  },
});
