import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { AuthPicker } from "@/components/AuthPicker";
import { Btn, Card, describeError, Field, MONO, NavRow, ScreenHeader, SectionTitle, Segmented } from "@/components/GitUi";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import { showAlert, showConfirm } from "@/utils/dialogs";
import { showTypedConfirm } from "@/utils/safeConfirm";
import * as engine from "@/utils/git/engine";
import { formatSyncMessage, INTERVALS, repoDir, type AuthMode, type SyncSettings } from "@/utils/git/store";
import { getSyncKey } from "@/utils/native";

export default function RepoSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const repos = useRepos();
  const c = repos.get(id);

  const [name, setName] = useState(c?.name ?? "");
  const [auth, setAuth] = useState<AuthMode>(c?.auth ?? "github");
  const [accountId, setAccountId] = useState<string | undefined>(c?.accountId);
  const [username, setUsername] = useState(c?.username ?? "");
  const [password, setPassword] = useState(c?.password ?? "");
  const [authorName, setAuthorName] = useState(c?.author.name ?? "");
  const [authorEmail, setAuthorEmail] = useState(c?.author.email ?? "");
  const [sync, setSync] = useState<SyncSettings>(c?.sync ?? ({} as SyncSettings));
  const [saving, setSaving] = useState(false);
  const [insecureSsl, setInsecureSsl] = useState(!!c?.insecureSsl);

  if (!c) return null;
  const container = c;

  const setFlag = (k: keyof SyncSettings, v: boolean | number | string) => setSync((s) => ({ ...s, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      const author = { name: authorName.trim() || container.author.name, email: authorEmail.trim() || container.author.email };
      await repos.update(id, {
        name: name.trim() || container.name,
        auth,
        accountId: auth === "account" ? accountId : undefined,
        username: username.trim() || undefined,
        password: password || undefined,
        author,
        insecureSsl: insecureSsl || undefined,
        sync,
      });
      await repos.read(id, (ctx) => engine.setAuthor(ctx.dir, author));
      router.back();
    } catch (e) {
      showAlert(t("g.nav.settings"), describeError(e, t));
    } finally {
      setSaving(false);
    }
  }

  function removeContainer() {
    const armed = showTypedConfirm({
      title: t("g.repos.removeTitle"),
      message: `${t("g.repos.removeBody", { name: container.name })}\n\n${t("safe.localBody", { name: container.name })}`,
      phrase: container.name,
      confirmText: t("g.common.delete"),
      cancelText: t("msg.cancel"),
      onConfirm: async () => {
        await repos.remove(id);
        router.replace("/(tabs)/repos" as any);
      },
    });
    if (!armed) showAlert(t("msg.error"), t("safe.unavailable"));
  }

  // La clé de cette installation évite la confirmation (AUDIT-003) : l'adresse est à garder privée.
  const syncKey = getSyncKey();
  const intent = `gitcrush://sync?repo=${container.id}${syncKey ? `&key=${syncKey}` : ""}`;
  const sw = (label: string, k: "onOpen" | "onClose" | "scheduled" | "retryOnNetwork", hint?: string, last?: boolean) => (
    <View style={{ paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: last ? 0 : 1, borderColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ flex: 1, color: colors.foreground, fontSize: 14, fontFamily: "Inter_500Medium" }}>{label}</Text>
        <Switch value={!!sync[k]} onValueChange={(v) => setFlag(k, v)} trackColor={{ true: colors.primary }} />
      </View>
      {hint ? <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 2, lineHeight: 15 }}>{hint}</Text> : null}
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <AppBackground />
      <ScreenHeader art="settings" title={t("g.nav.settings")} subtitle={container.name} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <SectionTitle>{t("g.settings.general")}</SectionTitle>
        <Field label={t("g.clone.name")} value={name} onChangeText={setName} />
        <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: MONO, marginBottom: 4 }} selectable>
          {container.url}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: MONO }} selectable>
          {repoDir(container)}
        </Text>

        <SectionTitle>{t("g.auth.title")}</SectionTitle>
        <AuthPicker
          auth={auth}
          accountId={accountId}
          username={username}
          password={password}
          onChange={(p) => {
            if (p.auth !== undefined) setAuth(p.auth);
            if ("accountId" in p) setAccountId(p.accountId);
            if (p.username !== undefined) setUsername(p.username);
            if (p.password !== undefined) setPassword(p.password);
          }}
        />

        <SectionTitle>{t("g.settings.author")}</SectionTitle>
        <Field label={t("g.settings.authorName")} value={authorName} onChangeText={setAuthorName} />
        <Field label={t("g.settings.authorEmail")} value={authorEmail} onChangeText={setAuthorEmail} keyboardType="email-address" />

        <SectionTitle>{t("g.settings.syncMessage")}</SectionTitle>
        <Field
          label={t("g.settings.template")}
          value={sync.message}
          onChangeText={(v) => setFlag("message", v)}
          hint={`${t("g.settings.templateHint")}\n→ ${formatSyncMessage(sync.message, 3, container.branch ?? "main", "manual")}`}
        />

        <SectionTitle>{t("g.settings.modes")}</SectionTitle>
        <Card>
          {sw(t("g.settings.onOpen"), "onOpen")}
          {sw(t("g.settings.onClose"), "onClose", t("g.settings.onCloseHint"))}
          {sw(t("g.settings.scheduled"), "scheduled", t("g.settings.scheduledHint"))}
          {sync.scheduled ? (
            <View style={{ paddingHorizontal: 14, paddingTop: 10, borderBottomWidth: 1, borderColor: colors.border }}>
              <Segmented
                value={String(sync.intervalMin)}
                onChange={(v) => setFlag("intervalMin", Number(v))}
                options={INTERVALS.map((m) => ({ value: String(m), label: m < 60 ? `${m} min` : `${m / 60} h` }))}
              />
            </View>
          ) : null}
          {sw(t("g.settings.retry"), "retryOnNetwork", t("g.settings.retryHint"), true)}
        </Card>

        <SectionTitle>{t("n.ssl.title")}</SectionTitle>
        <Card style={{ padding: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ flex: 1, color: colors.foreground, fontSize: 14, fontFamily: "Inter_500Medium" }}>{t("n.ssl.disable")}</Text>
            <Switch
              value={insecureSsl}
              onValueChange={(v) => {
                if (!v) return setInsecureSsl(false);
                showConfirm({
                  title: t("n.ssl.confirmTitle"),
                  message: t("n.ssl.warning"),
                  confirmText: t("n.ssl.confirm"),
                  cancelText: t("msg.cancel"),
                  destructive: true,
                  onConfirm: () => setInsecureSsl(true),
                });
              }}
              trackColor={{ true: colors.destructive }}
            />
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 6, lineHeight: 15 }}>{t("n.ssl.hint")}</Text>
        </Card>

        <SectionTitle>{t("n.advanced.title")}</SectionTitle>
        <Card>
          <NavRow icon="zap" label={t("n.advanced.open")} onPress={() => router.push("/native-sync" as any)} last />
        </Card>

        <SectionTitle>{t("g.settings.intent")}</SectionTitle>
        <Card style={{ padding: 14 }}>
          <Text selectable style={{ color: colors.accent, fontFamily: MONO, fontSize: 12 }}>
            {intent}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 8, lineHeight: 16 }}>{t("g.settings.intentHint")}</Text>
        </Card>

        <SectionTitle>{t("g.settings.ignore")}</SectionTitle>
        <Card>
          <NavRow icon="eye-off" label=".gitignore" onPress={() => router.push({ pathname: "/repo/[id]/editor", params: { id, path: ".gitignore" } } as any)} />
          <NavRow
            icon="lock"
            label=".git/info/exclude"
            onPress={() => router.push({ pathname: "/repo/[id]/editor", params: { id, path: ".git/info/exclude" } } as any)}
            last
          />
        </Card>
        <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 6, paddingHorizontal: 4 }}>{t("g.settings.ignoreHint")}</Text>

        <Btn label={t("g.settings.save")} icon="save" variant="primary" onPress={save} loading={saving} style={{ marginTop: 20 }} />

        <SectionTitle>{t("settings.danger")}</SectionTitle>
        <Btn label={t("g.settings.removeContainer")} icon="trash-2" variant="danger" onPress={removeContainer} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
