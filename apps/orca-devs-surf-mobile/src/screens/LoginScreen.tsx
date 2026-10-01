import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Credentials } from "../types";
import { fontFamilies, fontSizes, radius, space, useAppTheme, type ThemeColors } from "../theme";

import logo from "../../assets/orca-logo.png";

interface LoginScreenProps {
  initialEndpoint?: string;
  initialUserId?: string;
  busy: boolean;
  error?: string;
  demoEndpoint?: string;
  onSubmit: (credentials: Credentials) => void;
}

export function LoginScreen({
  initialEndpoint = "",
  initialUserId = "",
  busy,
  error,
  demoEndpoint,
  onSubmit,
}: LoginScreenProps) {
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [endpointUrl, setEndpointUrl] = useState(initialEndpoint);
  const [userId, setUserId] = useState(initialUserId);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const submit = () => {
    if (!endpointUrl.trim() || !userId.trim() || !password) return;
    onSubmit({ endpointUrl: endpointUrl.trim(), userId: userId.trim(), password });
  };

  const fillDemo = () => {
    if (!demoEndpoint) return;
    setEndpointUrl(`${demoEndpoint.replace(/\/$/, "")}/api/mobile/verify`);
    setUserId("demo");
    setPassword("orca-demo-2026");
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <Image
            source={logo}
            style={[styles.logo, { tintColor: isDark ? colors.text : colors.accent }]}
            resizeMode="contain"
          />
          <Text style={styles.title}>ORCA DEVS SURF</Text>
          <Text style={styles.subTitle}>SECURE DOCUMENT ACCESS</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.eyebrow}>SIGN IN</Text>
          <Text style={styles.heading}>Connect to your endpoint</Text>
          <Text style={styles.intro}>
            Verify your ORCA account before saving it securely on this device.
          </Text>

          {demoEndpoint ? (
            <Pressable
              accessibilityRole="button"
              onPress={fillDemo}
              style={({ pressed }) => [styles.demoButton, pressed && styles.pressed]}
            >
              <Text style={styles.demoButtonText}>FILL HOSTED DEMO ACCOUNT</Text>
            </Pressable>
          ) : null}

          <Text style={styles.label}>ENDPOINT URL</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={setEndpointUrl}
            placeholder="https://your-server.example/api/mobile/verify"
            placeholderTextColor={colors.placeholder}
            style={styles.input}
            value={endpointUrl}
          />

          <Text style={styles.label}>USER ID</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setUserId}
            placeholder="Your user ID"
            placeholderTextColor={colors.placeholder}
            style={styles.input}
            textContentType="username"
            value={userId}
          />

          <Text style={styles.label}>PASSWORD</Text>
          <View style={styles.passwordRow}>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setPassword}
              onSubmitEditing={submit}
              placeholder="Your password"
              placeholderTextColor={colors.placeholder}
              secureTextEntry={!showPassword}
              style={[styles.input, styles.passwordInput]}
              textContentType="password"
              value={password}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowPassword((current) => !current)}
              style={styles.reveal}
            >
              <Text style={styles.revealText}>{showPassword ? "HIDE" : "SHOW"}</Text>
            </Pressable>
          </View>

          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={busy || !endpointUrl.trim() || !userId.trim() || !password}
            onPress={submit}
            style={({ pressed }) => [
              styles.primaryButton,
              (busy || !endpointUrl.trim() || !userId.trim() || !password) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.textOnAccent} />
            ) : (
              <Text style={styles.primaryText}>VERIFY & SIGN IN</Text>
            )}
          </Pressable>

          <View style={styles.securityNote}>
            <Text style={styles.lock}>●</Text>
            <Text style={styles.securityText}>
              Password is saved in encrypted device storage and sent over HTTPS only for protected
              requests.
            </Text>
          </View>
        </View>
        <Text style={styles.version}>ORCA DOCUMENTS · VERSION 1.0</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    scroll: {
      flexGrow: 1,
      justifyContent: "center",
      paddingHorizontal: space.lg,
      paddingTop: space.xl,
      paddingBottom: space.xl,
    },
    brand: { alignItems: "center", marginBottom: space.xl },
    logo: { width: 72, height: 72 },
    title: {
      color: colors.text,
      fontFamily: fontFamilies.bold,
      fontSize: fontSizes.heading,
      letterSpacing: 1.5,
      marginTop: space.sm,
    },
    subTitle: {
      color: colors.muted,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.caption,
      letterSpacing: 1.4,
      marginTop: space.xs,
    },
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: space.xl,
    },
    eyebrow: {
      color: colors.muted,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.caption,
      letterSpacing: 1.1,
    },
    heading: {
      color: colors.text,
      fontFamily: fontFamilies.bold,
      fontSize: fontSizes.cardTitle,
      marginTop: space.sm,
    },
    intro: {
      color: colors.muted,
      fontFamily: fontFamilies.regular,
      lineHeight: 20,
      fontSize: fontSizes.body,
      marginTop: space.sm,
      marginBottom: space.md,
    },
    demoButton: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: space.md,
      marginBottom: space.sm,
      backgroundColor: colors.accentContainer,
    },
    demoButtonText: {
      color: colors.text,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.small,
      letterSpacing: 0.6,
    },
    label: {
      color: colors.text,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.small,
      letterSpacing: 0.4,
      marginTop: space.md,
      marginBottom: space.xs,
    },
    input: {
      minHeight: 48,
      backgroundColor: colors.input,
      color: colors.text,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.sm,
      paddingHorizontal: space.md,
      fontFamily: fontFamilies.regular,
      fontSize: fontSizes.input,
    },
    passwordRow: { position: "relative", justifyContent: "center" },
    passwordInput: { paddingRight: 64 },
    reveal: {
      position: "absolute",
      right: space.md,
      paddingVertical: space.sm,
      paddingHorizontal: space.xs,
    },
    revealText: {
      color: colors.text,
      fontFamily: fontFamilies.semiBold,
      fontSize: fontSizes.small,
      letterSpacing: 0.4,
    },
    error: {
      marginTop: space.md,
      color: colors.danger,
      lineHeight: 18,
      fontFamily: fontFamilies.medium,
      fontSize: fontSizes.description,
    },
    primaryButton: {
      minHeight: 48,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.sm,
      marginTop: space.lg,
    },
    primaryText: {
      color: colors.textOnAccent,
      fontFamily: fontFamilies.bold,
      fontSize: fontSizes.small,
      letterSpacing: 0.6,
    },
    disabled: { opacity: 0.46 },
    pressed: { opacity: 0.78 },
    securityNote: {
      flexDirection: "row",
      gap: space.sm,
      marginTop: space.md,
      alignItems: "flex-start",
    },
    lock: { color: colors.text, fontSize: fontSizes.small, marginTop: 2 },
    securityText: {
      flex: 1,
      color: colors.muted,
      fontFamily: fontFamilies.regular,
      lineHeight: 16,
      fontSize: fontSizes.small,
    },
    version: {
      textAlign: "center",
      color: colors.muted,
      fontFamily: fontFamilies.medium,
      fontSize: fontSizes.micro,
      letterSpacing: 0.8,
      marginTop: space.md,
    },
  });
}
