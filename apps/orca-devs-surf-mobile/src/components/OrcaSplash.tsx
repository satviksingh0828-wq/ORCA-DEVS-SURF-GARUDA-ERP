import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Image,
  Linking,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { fontFamilies, fontSizes, useAppTheme } from "../theme";

import logo from "../../assets/orca-logo.png";
const WEBSITE = "https://orca.devs.surf";

export function OrcaSplash({ onComplete }: { onComplete: () => void }) {
  const { width, height } = useWindowDimensions();
  const { colors, isDark } = useAppTheme();
  const size = Math.min(width * 0.6, height * 0.6, 420);
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const firstRingScale = useRef(new Animated.Value(0.08)).current;
  const secondRingScale = useRef(new Animated.Value(0.08)).current;
  const firstRingOpacity = useRef(new Animated.Value(0.9)).current;
  const secondRingOpacity = useRef(new Animated.Value(0.9)).current;
  const markOpacity = useRef(new Animated.Value(0)).current;
  const markScale = useRef(new Animated.Value(0.92)).current;
  const captionOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const expandRing = (scale: Animated.Value, opacity: Animated.Value, delay: number) =>
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 1.12,
            duration: 1600,
            easing: Easing.bezier(0.16, 0.84, 0.44, 1),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, { toValue: 0, duration: 1600, useNativeDriver: true }),
        ]),
      ]);

    Animated.parallel([
      expandRing(firstRingScale, firstRingOpacity, 50),
      expandRing(secondRingScale, secondRingOpacity, 350),
      Animated.sequence([
        Animated.delay(600),
        Animated.parallel([
          Animated.timing(markOpacity, {
            toValue: 1,
            duration: 600,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.spring(markScale, {
            toValue: 1,
            speed: 1.1,
            bounciness: 4,
            useNativeDriver: true,
          }),
        ]),
      ]),
      Animated.sequence([
        Animated.delay(1550),
        Animated.timing(captionOpacity, {
          toValue: 1,
          duration: 700,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    const fadeTimer = setTimeout(
      () =>
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }).start(),
      2450,
    );
    const doneTimer = setTimeout(onComplete, 2850);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, [
    captionOpacity,
    firstRingOpacity,
    firstRingScale,
    markOpacity,
    markScale,
    onComplete,
    overlayOpacity,
    secondRingOpacity,
    secondRingScale,
  ]);

  return (
    <>
      <StatusBar
        barStyle={isDark ? "light-content" : "dark-content"}
        backgroundColor={colors.background}
      />
      <Animated.View
        style={[styles.root, { backgroundColor: colors.background, opacity: overlayOpacity }]}
      >
        <View style={[styles.stage, { width: size, height: size }]}>
          <Animated.View
            style={[
              styles.ring,
              {
                borderColor: colors.text,
                opacity: firstRingOpacity,
                transform: [{ scale: firstRingScale }],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.ring,
              {
                borderColor: colors.text,
                opacity: secondRingOpacity,
                transform: [{ scale: secondRingScale }],
              },
            ]}
          />
          <Animated.Image
            source={logo}
            resizeMode="contain"
            style={[
              styles.logo,
              { tintColor: colors.text, opacity: markOpacity, transform: [{ scale: markScale }] },
            ]}
          />
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Powered by ORCA DEVS SURF. Open orca.devs.surf."
            onPress={() => void Linking.openURL(WEBSITE)}
            style={styles.captionWrap}
          >
            <Animated.Text
              style={[styles.caption, { color: colors.muted, opacity: captionOpacity }]}
            >
              POWERED BY ORCA DEVS SURF
            </Animated.Text>
          </Pressable>
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  stage: { alignItems: "center", justifyContent: "center", overflow: "visible" },
  ring: { position: "absolute", width: "100%", height: "100%", borderRadius: 999, borderWidth: 1 },
  logo: { width: "100%", height: "100%" },
  captionWrap: { position: "absolute", top: "100%", marginTop: 28, alignSelf: "center" },
  caption: {
    fontFamily: fontFamilies.semiBold,
    fontSize: fontSizes.micro,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    textAlign: "center",
    includeFontPadding: false,
  },
});
