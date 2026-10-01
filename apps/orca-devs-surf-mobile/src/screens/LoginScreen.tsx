import { useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { Credentials } from "../types";
import { colors } from "../theme";

const logo = require("../../assets/orca-logo.png");

interface LoginScreenProps {
  initialEndpoint?: string;
  initialUserId?: string;
  busy: boolean;
  error?: string;
  onSubmit: (credentials: Credentials) => void;
}

export function LoginScreen({ initialEndpoint = "", initialUserId = "", busy, error, onSubmit }: LoginScreenProps) {
  const [endpointUrl, setEndpointUrl] = useState(initialEndpoint);
  const [userId, setUserId] = useState(initialUserId);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const submit = () => {
    if (!endpointUrl.trim() || !userId.trim() || !password) return;
    onSubmit({ endpointUrl: endpointUrl.trim(), userId: userId.trim(), password });
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <Image source={logo} style={styles.logo} resizeMode="contain" />
          <Text style={styles.title}>ORCA DEVS SURF</Text>
          <Text style={styles.subTitle}>SECURE DOCUMENT ACCESS</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.eyebrow}>SIGN IN</Text>
          <Text style={styles.heading}>Connect to your endpoint</Text>
          <Text style={styles.intro}>Use your ORCA application endpoint and account. We verify the credentials before saving them on this device.</Text>

          <Text style={styles.label}>ENDPOINT URL</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={setEndpointUrl}
            placeholder="https://your-server.example/api/mobile/verify"
            placeholderTextColor="#647589"
            style={styles.input}
            value={endpointUrl}
          />

          <Text style={styles.label}>USER ID</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setUserId}
            placeholder="Your user ID"
            placeholderTextColor="#647589"
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
              placeholderTextColor="#647589"
              secureTextEntry={!showPassword}
              style={[styles.input, styles.passwordInput]}
              textContentType="password"
              value={password}
            />
            <Pressable accessibilityRole="button" onPress={() => setShowPassword((current) => !current)} style={styles.reveal}>
              <Text style={styles.revealText}>{showPassword ? "HIDE" : "SHOW"}</Text>
            </Pressable>
          </View>

          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

          <Pressable accessibilityRole="button" disabled={busy || !endpointUrl.trim() || !userId.trim() || !password} onPress={submit} style={({ pressed }) => [styles.primaryButton, (busy || !endpointUrl.trim() || !userId.trim() || !password) && styles.disabled, pressed && styles.pressed]}>
            {busy ? <ActivityIndicator color={colors.background} /> : <Text style={styles.primaryText}>VERIFY & SIGN IN</Text>}
          </Pressable>

          <View style={styles.securityNote}>
            <Text style={styles.lock}>●</Text>
            <Text style={styles.securityText}>Password is saved in encrypted device storage and sent over HTTPS for protected requests.</Text>
          </View>
        </View>
        <Text style={styles.version}>ORCA DOCUMENTS · VERSION 1.0</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 22, paddingTop: 20, paddingBottom: 26 },
  brand: { alignItems: "center", marginBottom: 25 },
  logo: { width: 78, height: 78 },
  title: { color: colors.text, fontWeight: "900", fontSize: 22, letterSpacing: 2.2, marginTop: 12 },
  subTitle: { color: colors.accent, fontWeight: "700", fontSize: 9, letterSpacing: 2.0, marginTop: 6 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 22, padding: 20 },
  eyebrow: { color: colors.accent, fontWeight: "800", fontSize: 10, letterSpacing: 1.9 },
  heading: { color: colors.text, fontWeight: "800", fontSize: 20, marginTop: 8 },
  intro: { color: colors.muted, lineHeight: 19, fontSize: 12, marginTop: 8, marginBottom: 16 },
  label: { color: "#A8B7C8", fontWeight: "800", fontSize: 9, letterSpacing: 1.1, marginTop: 12, marginBottom: 7 },
  input: { minHeight: 49, backgroundColor: "#09111B", color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, fontSize: 13 },
  passwordRow: { position: "relative", justifyContent: "center" },
  passwordInput: { paddingRight: 64 },
  reveal: { position: "absolute", right: 13, paddingVertical: 10, paddingHorizontal: 3 },
  revealText: { color: colors.accent, fontWeight: "800", fontSize: 9, letterSpacing: 1 },
  error: { marginTop: 12, color: colors.danger, lineHeight: 18, fontSize: 12 },
  primaryButton: { height: 50, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", borderRadius: 13, marginTop: 18 },
  primaryText: { color: colors.background, fontWeight: "900", fontSize: 12, letterSpacing: 1.1 },
  disabled: { opacity: 0.48 },
  pressed: { transform: [{ scale: 0.985 }] },
  securityNote: { flexDirection: "row", gap: 9, marginTop: 15, alignItems: "flex-start" },
  lock: { color: colors.success, fontSize: 9, marginTop: 2 },
  securityText: { flex: 1, color: colors.muted, lineHeight: 16, fontSize: 10 },
  version: { textAlign: "center", color: "#617185", fontWeight: "700", fontSize: 8, letterSpacing: 1.3, marginTop: 16 },
});
