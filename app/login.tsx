import { Feather, Octicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GitHubDeviceLogin } from "@/components/GitHubDeviceLogin";
import { LanguagePicker } from "@/components/LanguagePicker";
import { useGitHub } from "@/context/GitHubContext";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { login } = useGitHub();
  const { t } = useI18n();

  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [oauthOpen, setOauthOpen] = useState(false);

  async function handleLogin() {
    if (!token.trim()) {
      setError(t("login.tokenRequired"));
      return;
    }
    setError("");
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {/**/});
    const ok = await login(token.trim());
    setLoading(false);
    if (ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {/**/});
      router.replace("/(tabs)");
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {/**/});
      setError(t("login.tokenInvalid"));
    }
  }

  function openTokenPage() {
    WebBrowser.openBrowserAsync(
      "https://github.com/settings/tokens/new?scopes=repo,read:user&description=Git-Push+App"
    );
  }

  const s = makeStyles(colors);

  return (
    <KeyboardAvoidingView
      style={[s.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Barre du haut : sélecteur de langue à droite */}
      <View style={[s.topBar, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 12) }]}>
        <View style={{ flex: 1 }} />
        <LanguagePicker />
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo */}
        <View style={s.logoWrap}>
          <View style={s.logoCircle}>
            <Octicons name="mark-github" size={40} color={colors.foreground} />
          </View>
          <Text style={s.appName}>Git-Push</Text>
          <Text style={s.tagline}>{t("login.tagline")}</Text>
        </View>

        {/* Connexion OAuth (Device Flow) */}
        <Pressable
          style={({ pressed }) => [s.loginBtn, { marginBottom: 12 }, pressed && { opacity: 0.8 }]}
          onPress={() => setOauthOpen(true)}
        >
          <Octicons name="mark-github" size={18} color="#fff" />
          <Text style={s.loginBtnText}>{t("f.oauth.githubButton")}</Text>
        </Pressable>
        <Text style={[s.note, { marginBottom: 20 }]}>{t("f.oauth.orToken")}</Text>

        {/* Steps */}
        <View style={s.stepsCard}>
          <Text style={s.stepsTitle}>{t("login.howTo")}</Text>
          {[
            { n: "1", text: t("login.step1") },
            { n: "2", text: t("login.step2") },
            { n: "3", text: t("login.step3") },
          ].map((step) => (
            <View key={step.n} style={s.step}>
              <View style={s.stepNum}>
                <Text style={s.stepNumText}>{step.n}</Text>
              </View>
              <Text style={s.stepText}>{step.text}</Text>
            </View>
          ))}
        </View>

        {/* Token input */}
        <View style={s.inputWrap}>
          <Text style={s.inputLabel}>{t("login.tokenLabel")}</Text>
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={token}
              onChangeText={setToken}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry={!showToken}
              autoCorrect={false}
              autoCapitalize="none"
              onSubmitEditing={handleLogin}
            />
            <Pressable style={s.eyeBtn} onPress={() => setShowToken((v) => !v)}>
              <Feather name={showToken ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
          {!!error && <Text style={s.error}>{error}</Text>}
        </View>

        {/* Connect button */}
        <Pressable
          style={({ pressed }) => [s.loginBtn, pressed && { opacity: 0.8 }]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Octicons name="mark-github" size={18} color="#fff" />
              <Text style={s.loginBtnText}>{t("login.connect")}</Text>
            </>
          )}
        </Pressable>

        {/* Create token button */}
        <Pressable
          style={({ pressed }) => [s.tokenBtn, pressed && { opacity: 0.7 }]}
          onPress={openTokenPage}
        >
          <Feather name="external-link" size={15} color={colors.accent} />
          <Text style={s.tokenBtnText}>{t("login.createToken")}</Text>
        </Pressable>

        <Text style={s.note}>{t("login.note")}</Text>
      </ScrollView>
      <GitHubDeviceLogin
        visible={oauthOpen}
        onClose={() => setOauthOpen(false)}
        onToken={async (tok) => {
          const ok = await login(tok);
          if (ok) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {/**/});
            router.replace("/(tabs)");
          }
          return ok;
        }}
      />
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1 },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingBottom: 4,
    },
    scroll: { paddingHorizontal: 24, paddingTop: 8 },
    logoWrap: { alignItems: "center", marginBottom: 32 },
    logoCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
    },
    appName: {
      fontSize: 28,
      fontWeight: "700" as const,
      color: colors.foreground,
      fontFamily: "Inter_700Bold",
      marginBottom: 6,
    },
    tagline: {
      fontSize: 14,
      color: colors.mutedForeground,
      fontFamily: "Inter_400Regular",
      textAlign: "center",
    },
    stepsCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      marginBottom: 24,
    },
    stepsTitle: {
      fontSize: 12,
      fontWeight: "600" as const,
      color: colors.mutedForeground,
      fontFamily: "Inter_600SemiBold",
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 12,
    },
    step: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
    stepNum: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.greenBg,
      borderWidth: 1,
      borderColor: colors.green,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
      marginTop: 1,
    },
    stepNumText: { fontSize: 11, color: colors.green, fontWeight: "700" as const },
    stepText: { flex: 1, fontSize: 14, color: colors.foreground, fontFamily: "Inter_400Regular", lineHeight: 20 },
    inputWrap: { marginBottom: 16 },
    inputLabel: {
      fontSize: 12,
      fontWeight: "600" as const,
      color: colors.mutedForeground,
      fontFamily: "Inter_600SemiBold",
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 8,
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.input,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
    },
    input: {
      flex: 1,
      padding: 14,
      fontSize: 14,
      color: colors.foreground,
      fontFamily: "Inter_400Regular",
    },
    eyeBtn: { padding: 14 },
    error: {
      fontSize: 13,
      color: colors.destructive,
      fontFamily: "Inter_400Regular",
      marginTop: 6,
    },
    loginBtn: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      padding: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      marginBottom: 12,
    },
    loginBtnText: {
      fontSize: 16,
      fontWeight: "700" as const,
      color: "#fff",
      fontFamily: "Inter_700Bold",
    },
    tokenBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      padding: 14,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 20,
    },
    tokenBtnText: {
      fontSize: 14,
      color: colors.accent,
      fontFamily: "Inter_500Medium",
    },
    note: {
      fontSize: 12,
      color: colors.mutedForeground,
      textAlign: "center",
      fontFamily: "Inter_400Regular",
      lineHeight: 18,
    },
  });
}
