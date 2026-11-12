import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { Btn, Field, MONO, ScreenHeader, SectionTitle, Segmented } from "@/components/GitUi";
import { OAUTH_REDIRECT_URI } from "@/constants/oauth";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { showAlert } from "@/utils/dialogs";
import { getClientIdFor, normBase, saveAccount, setClientIdFor, type ForgeKind } from "@/utils/accounts";
import { newId } from "@/utils/git/store";
import { fetchForgeUser, pkceLogin } from "@/utils/oauth";

export default function AccountAddScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [kind, setKind] = useState<ForgeKind>("gitlab");
  const [base, setBase] = useState("https://gitlab.com");
  const [method, setMethod] = useState<"oauth" | "token">("oauth");
  const [clientId, setClientId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getClientIdFor(base).then((id) => setClientId(id));
  }, [base]);

  function onKind(k: ForgeKind) {
    setKind(k);
    if (k === "gitlab" && /codeberg\.org/.test(base)) setBase("https://gitlab.com");
    if (k === "gitea" && /gitlab\.com/.test(base)) setBase("https://codeberg.org");
  }

  const appsUrl = (b: string) => (kind === "gitlab" ? `${b}/-/user_settings/applications` : `${b}/user/settings/applications`);
  const tokenUrl = (b: string) => (kind === "gitlab" ? `${b}/-/user_settings/personal_access_tokens` : `${b}/user/settings/applications`);

  async function submit() {
    const b = normBase(base);
    setBusy(true);
    try {
      let tok = token.trim();
      let refreshToken: string | undefined;
      let expiresAt: number | undefined;
      if (method === "oauth") {
        if (!clientId.trim()) {
          showAlert(t("f.accounts.add"), t("f.add.needClient"));
          return;
        }
        await setClientIdFor(b, clientId);
        const r = await pkceLogin(kind, b, clientId.trim());
        tok = r.token;
        refreshToken = r.refreshToken;
        expiresAt = r.expiresIn ? Date.now() + r.expiresIn * 1000 : undefined;
      } else if (!tok) {
        showAlert(t("f.accounts.add"), t("f.add.needToken"));
        return;
      }
      const u = await fetchForgeUser(kind, b, tok);
      await saveAccount({
        id: newId(),
        kind,
        baseUrl: b,
        username: u.username,
        name: u.name,
        avatar: u.avatar,
        method,
        token: tok,
        refreshToken,
        expiresAt,
        clientId: method === "oauth" ? clientId.trim() : undefined,
        createdAt: Date.now(),
      });
      showAlert(t("f.accounts.add"), t("f.add.done", { name: u.username }), [{ text: "OK", onPress: () => router.back() }]);
    } catch (e: any) {
      if (e?.code === "OAuthCancelled") return;
      showAlert(t("f.oauth.failed"), String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <AppBackground />
      <ScreenHeader title={t("f.accounts.add")} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <SectionTitle>{t("f.add.forge")}</SectionTitle>
        <Segmented
          value={kind}
          onChange={onKind}
          options={[
            { value: "gitlab", label: "GitLab" },
            { value: "gitea", label: "Gitea / Forgejo / Codeberg" },
          ]}
        />
        <Field label={t("f.add.instance")} value={base} onChangeText={setBase} keyboardType="url" placeholder="https://gitlab.com" />

        <SectionTitle>{t("f.add.method")}</SectionTitle>
        <Segmented
          value={method}
          onChange={setMethod}
          options={[
            { value: "oauth", label: "OAuth" },
            { value: "token", label: t("f.add.tokenMethod") },
          ]}
        />
        {method === "oauth" ? (
          <>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 17, marginBottom: 10 }}>
              {t(kind === "gitlab" ? "f.add.oauthHelpGitlab" : "f.add.oauthHelpGitea")}
            </Text>
            <Text selectable style={{ color: colors.accent, fontFamily: MONO, fontSize: 12, marginBottom: 10 }}>
              {OAUTH_REDIRECT_URI}
            </Text>
            <Btn label={t("f.add.openApps")} icon="external-link" small onPress={() => WebBrowser.openBrowserAsync(appsUrl(normBase(base))).catch(() => undefined)} style={{ marginBottom: 12 }} />
            <Field label={t("f.add.clientId")} value={clientId} onChangeText={setClientId} />
          </>
        ) : (
          <>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 17, marginBottom: 10 }}>
              {t(kind === "gitlab" ? "f.add.tokenHelpGitlab" : "f.add.tokenHelpGitea")}
            </Text>
            <Btn label={t("f.add.openTokens")} icon="external-link" small onPress={() => WebBrowser.openBrowserAsync(tokenUrl(normBase(base))).catch(() => undefined)} style={{ marginBottom: 12 }} />
            <Field label={t("f.add.token")} value={token} onChangeText={setToken} secure placeholder={kind === "gitlab" ? "glpat-…" : ""} />
          </>
        )}
        <Btn label={method === "oauth" ? t("f.add.connect") : t("f.add.save")} icon="log-in" variant="primary" onPress={submit} loading={busy} style={{ marginTop: 8 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
