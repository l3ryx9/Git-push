import { Feather, Octicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { router } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { Illustration, illustrationColor } from "@/components/Illustration";
import { useAiSettings } from "@/components/AiUi";
import { LanguagePicker } from "@/components/LanguagePicker";
import { saveAi } from "@/utils/ai/settings";
import { useGitHub } from "@/context/GitHubContext";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { showConfirm } from "@/utils/dialogs";
import { C, withAlpha } from "@/constants/colors";

function Row({
  icon,
  label,
  value,
  onPress,
  danger,
  right,
}: {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  right?: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button"
      style={({ pressed }) => [
        {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          paddingHorizontal: 16,
          paddingVertical: 14,
          gap: 12,
          backgroundColor: pressed && onPress ? colors.secondary : "transparent",
        },
      ]}
      onPress={onPress}
    >
      <Feather name={icon as any} size={16} color={danger ? colors.destructive : colors.mutedForeground} />
      <Text
        style={{
          flex: 1,
          fontSize: 14,
          color: danger ? colors.destructive : colors.foreground,
          fontFamily: "Inter_500Medium",
        }}
      >
        {label}
      </Text>
      {right ? right : value ? (
        <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
          {value}
        </Text>
      ) : null}
      {onPress && !danger && !right ? (
        <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
      ) : null}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const ai = useAiSettings();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { user, repos, logout, loading } = useGitHub();

  React.useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user]);

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
      <AppBackground />
      <ActivityIndicator color={C.accent} size="large" />
    </View>
  );

  if (!user) return null;

  function confirmLogout() {
    showConfirm({
      title: t("settings.logoutConfirmTitle"),
      message: t("settings.logoutConfirmBody"),
      confirmText: t("settings.logoutAction"),
      cancelText: t("msg.cancel"),
      destructive: true,
      onConfirm: async () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {/**/});
        await logout();
        router.replace("/login");
      },
    });
  }

  const s = makeStyles(colors);
  const webTop = Platform.OS === "web" ? 67 : 0;

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      <AppBackground />
      <View style={[s.header, { paddingTop: insets.top + webTop, flexDirection: "row", alignItems: "center", gap: 10 }]}>
        <View style={{ width: 46, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: withAlpha(illustrationColor("settings", colors), 0.12), borderWidth: 1, borderColor: withAlpha(illustrationColor("settings", colors), 0.22) }}>
          <Illustration kind="settings" size={40} />
        </View>
        <Text style={s.headerTitle}>{t("settings.title")}</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile card */}
        <View style={s.profileCard}>
          {user.avatar_url ? (
            <Image source={{ uri: user.avatar_url }} style={s.avatar} contentFit="cover" />
          ) : (
            <View style={[s.avatar, { backgroundColor: colors.secondary, alignItems: "center", justifyContent: "center" }]}>
              <Octicons name="person" size={32} color={colors.mutedForeground} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.displayName}>{user.name || user.login}</Text>
            <Text style={s.username}>@{user.login}</Text>
            {user.email ? <Text style={s.email}>{user.email}</Text> : null}
          </View>
          <View style={s.repoBadge}>
            <Text style={s.repoBadgeNum}>{repos.length}</Text>
            <Text style={s.repoBadgeLabel}>{t("settings.reposBadge")}</Text>
          </View>
        </View>

        {/* GitHub section */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>{t("settings.account")}</Text>
          <View style={s.card}>
            <Row icon="github" label={t("settings.githubProfile")} value={user.login} />
            <View style={s.divider} />
            <Row icon="git-branch" label={t("settings.repos")} value={String(user.public_repos)} />
            <View style={s.divider} />
            <Row icon="users" label={t("f.accounts.title")} onPress={() => router.push("/accounts" as any)} />
          </View>
        </View>

        {/* App section */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>{t("settings.app")}</Text>
          <View style={s.card}>
            <Row icon="zap" label={t("n.advanced.title")} onPress={() => router.push("/native-sync" as any)} />
            <View style={s.divider} />
            <Row icon="info" label={t("settings.version")} value="1.0.0" />
            <View style={s.divider} />
            <Row
              icon="globe"
              label={t("settings.language")}
              right={<LanguagePicker compact={false} />}
            />
          </View>
        </View>

        {/* Intelligence artificielle */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>{t("ai.section")}</Text>
          <View style={s.card}>
            <Row
              icon="zap"
              label={t("ai.enabled")}
              right={
                <Switch
                  value={!!ai?.enabled}
                  onValueChange={(v) => void saveAi({ enabled: v })}
                  trackColor={{ true: colors.primary }}
                />
              }
            />
            {ai?.enabled ? (
              <>
                <View style={s.divider} />
                <Row
                  icon="cpu"
                  label={t("ai.settings")}
                  value={ai.keys[ai.provider] ? ai.models[ai.provider] : t("ai.noKey")}
                  onPress={() => router.push("/ai-settings" as any)}
                />
              </>
            ) : null}
          </View>
        </View>

        {/* Maintenance */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>{t("maint.section")}</Text>
          <View style={s.card}>
            <Row icon="shield" label={t("maint.title")} value={t("maint.hint")} onPress={() => router.push("/maintenance" as any)} />
          </View>
        </View>

        {/* Danger zone */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>{t("settings.danger")}</Text>
          <View style={s.card}>
            <Row icon="log-out" label={t("settings.logout")} onPress={confirmLogout} danger />
          </View>
        </View>

        <View style={{ height: insets.bottom + (Platform.OS === "web" ? 34 : 90) }} />
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1 },
    header: {
      paddingHorizontal: 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    headerTitle: { fontSize: 20, fontWeight: "700" as const, color: colors.foreground, fontFamily: "Inter_700Bold" },
    profileCard: {
      flexDirection: "row",
      alignItems: "center",
      margin: 12,
      padding: 16,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 14,
    },
    avatar: { width: 56, height: 56, borderRadius: 28 },
    displayName: { fontSize: 16, fontWeight: "700" as const, color: colors.foreground, fontFamily: "Inter_700Bold" },
    username: { fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginTop: 2 },
    email: { fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginTop: 2 },
    repoBadge: { alignItems: "center" },
    repoBadgeNum: { fontSize: 20, fontWeight: "700" as const, color: colors.accent, fontFamily: "Inter_700Bold" },
    repoBadgeLabel: { fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
    section: { marginHorizontal: 12, marginBottom: 8 },
    sectionTitle: {
      fontSize: 11,
      color: colors.mutedForeground,
      fontFamily: "Inter_600SemiBold",
      letterSpacing: 0.8,
      marginBottom: 8,
      marginLeft: 4,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    divider: { height: 1, backgroundColor: colors.border },
  });
}
