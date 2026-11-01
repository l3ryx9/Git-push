import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAccounts } from "@/components/AuthPicker";
import { GitHubDeviceLogin } from "@/components/GitHubDeviceLogin";
import { Btn, Card, IconBtn, ScreenHeader, SectionTitle } from "@/components/GitUi";
import { useGitHub } from "@/context/GitHubContext";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { showAlert, showConfirm } from "@/utils/dialogs";
import { hostOfUrl, removeAccount, type Account } from "@/utils/accounts";

export default function AccountsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { user, login } = useGitHub();
  const accounts = useAccounts();
  const [oauthOpen, setOauthOpen] = useState(false);

  function remove(a: Account) {
    showConfirm({
      title: t("f.accounts.removeTitle"),
      message: t("f.accounts.removeBody", { name: `${a.username} · ${hostOfUrl(a.baseUrl)}` }),
      confirmText: t("g.common.delete"),
      cancelText: t("msg.cancel"),
      destructive: true,
      onConfirm: () => void removeAccount(a.id),
    });
  }

  const avatar = (uri?: string) =>
    uri ? (
      <Image source={{ uri }} style={{ width: 34, height: 34, borderRadius: 17 }} />
    ) : (
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.secondary, alignItems: "center", justifyContent: "center" }}>
        <Feather name="user" size={16} color={colors.mutedForeground} />
      </View>
    );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title={t("f.accounts.title")} right={<IconBtn icon="plus" onPress={() => router.push("/account-add" as any)} />} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 30 }}>
        <SectionTitle>GITHUB</SectionTitle>
        <Card style={{ padding: 14, gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            {avatar(user?.avatar_url)}
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_600SemiBold" }}>{user?.login ?? "—"}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{t("f.accounts.githubMain")}</Text>
            </View>
          </View>
          <Btn label={t("f.oauth.reconnect")} icon="github" onPress={() => setOauthOpen(true)} small />
        </Card>

        <SectionTitle>{t("f.accounts.others")}</SectionTitle>
        <Card>
          {accounts.length === 0 ? (
            <Text style={{ color: colors.mutedForeground, padding: 14, fontSize: 12 }}>{t("f.accounts.none")}</Text>
          ) : (
            accounts.map((a, i) => (
              <Pressable
                key={a.id}
                onLongPress={() => remove(a)}
                style={[{ flexDirection: "row", alignItems: "center", gap: 12, padding: 13 }, i < accounts.length - 1 && { borderBottomWidth: 1, borderColor: colors.border }]}
              >
                {avatar(a.avatar)}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_600SemiBold" }}>{a.username}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
                    {a.kind === "gitlab" ? "GitLab" : "Gitea / Forgejo"} · {hostOfUrl(a.baseUrl)} · {a.method === "oauth" ? "OAuth" : "token"}
                  </Text>
                </View>
                <Pressable hitSlop={10} onPress={() => remove(a)}>
                  <Feather name="trash-2" size={16} color={colors.mutedForeground} />
                </Pressable>
              </Pressable>
            ))
          )}
        </Card>
        <Btn label={t("f.accounts.add")} icon="plus" variant="primary" onPress={() => router.push("/account-add" as any)} style={{ marginTop: 14 }} />
        <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 10, lineHeight: 16, paddingHorizontal: 4 }}>{t("f.accounts.hint")}</Text>
      </ScrollView>
      <GitHubDeviceLogin
        visible={oauthOpen}
        onClose={() => setOauthOpen(false)}
        onToken={async (tok) => {
          const ok = await login(tok);
          if (ok) showAlert("GitHub", t("f.oauth.connected"));
          return ok;
        }}
      />
    </View>
  );
}
