import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { AuthPicker, suggestAuth, useAccounts } from "@/components/AuthPicker";
import { Btn, describeError, Field, ProgressLine, progressText, ScreenHeader, Segmented } from "@/components/GitUi";
import { PickerModal } from "@/components/PickerModal";
import { useGitHub } from "@/context/GitHubContext";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import { showAlert } from "@/utils/dialogs";
import type { Progress } from "@/utils/git/engine";
import { repoNameFromUrl, type AuthMode } from "@/utils/git/store";

export default function CloneScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const params = useLocalSearchParams<{ url?: string; name?: string }>();
  const { repos, fetchRepos, reposLoading } = useGitHub();
  const { clone, findByUrl } = useRepos();

  const [url, setUrl] = useState(params.url ?? "");
  const [name, setName] = useState(params.name ?? "");
  const [branch, setBranch] = useState("");
  const [depth, setDepth] = useState("");
  const [singleBranch, setSingleBranch] = useState(false);
  const [cloneMode, setCloneMode] = useState<"full" | "lite">("full");
  const [insecureSsl, setInsecureSsl] = useState(false);
  const accounts = useAccounts();
  const [auth, setAuth] = useState<AuthMode>(params.url ? suggestAuth(params.url, []).auth : "github");
  const [accountId, setAccountId] = useState<string | undefined>();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | undefined>();
  const [picker, setPicker] = useState(false);
  const [search, setSearch] = useState("");

  function onUrlChange(v: string) {
    setUrl(v);
    if (/^https?:\/\/[^/]+\//i.test(v)) {
      const sug = suggestAuth(v, accounts);
      setAuth(sug.auth);
      setAccountId(sug.accountId);
    }
  }

  async function submit() {
    const u = url.trim();
    if (!/^https?:\/\/.+/i.test(u)) {
      showAlert(t("g.clone.title"), t(/^(git@|ssh:\/\/)/i.test(u) ? "g.clone.sshUnsupported" : "g.clone.badUrl"));
      return;
    }
    if (auth === "account" && !accountId) {
      showAlert(t("g.clone.title"), t("f.auth.noAccount"));
      return;
    }
    const existing = findByUrl(u);
    if (existing) {
      router.replace({ pathname: "/repo/[id]", params: { id: existing.id } } as any);
      return;
    }
    setBusy(true);
    try {
      const c = await clone(
        {
          url: u,
          name: name.trim() || repoNameFromUrl(u),
          branch: branch.trim() || undefined,
          depth: parseInt(depth, 10) || undefined,
          singleBranch,
          insecureSsl,
          auth,
          accountId,
          username,
          password,
        },
        setProgress
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      router.replace({ pathname: "/repo/[id]", params: { id: c.id } } as any);
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      showAlert(t("g.clone.failed"), describeError(e, t));
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  }

  const filtered = repos.filter((r) => r.full_name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <AppBackground />
      <ScreenHeader title={t("g.clone.title")} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <Btn
          label={t("g.clone.fromGitHub")}
          icon="github"
          onPress={() => {
            if (!repos.length) void fetchRepos();
            setPicker(true);
          }}
          style={{ marginBottom: 16 }}
        />
        <Field label={t("g.clone.url")} value={url} onChangeText={onUrlChange} placeholder="https://github.com/owner/repo.git" keyboardType="url" />
        <Field label={t("g.clone.name")} value={name} onChangeText={setName} placeholder={url ? repoNameFromUrl(url) : "mon-depot"} />
        <Field label={t("g.clone.branch")} value={branch} onChangeText={setBranch} placeholder={t("g.clone.branchPh")} />
        <Segmented
          value={cloneMode}
          onChange={(v) => {
            setCloneMode(v);
            setDepth(v === "lite" ? "1" : "");
            setSingleBranch(v === "lite");
          }}
          options={[
            { value: "full", label: t("clone.full") },
            { value: "lite", label: t("clone.lite") },
          ]}
        />
        <Text style={{ color: colors.mutedForeground, fontSize: 11, lineHeight: 15, marginTop: -4, marginBottom: 14 }}>{t(cloneMode === "lite" ? "clone.liteHint" : "clone.fullHint")}</Text>
        <Field
          label={t("g.clone.depth")}
          value={depth}
          onChangeText={(v) => setDepth(v.replace(/[^0-9]/g, ""))}
          placeholder={t("g.clone.depthPh")}
          keyboardType="number-pad"
          hint={t("g.clone.depthHint")}
        />
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}>
          <Text style={{ flex: 1, color: colors.foreground, fontSize: 14, fontFamily: "Inter_500Medium" }}>{t("g.clone.singleBranch")}</Text>
          <Switch value={singleBranch} onValueChange={setSingleBranch} trackColor={{ true: colors.primary }} />
        </View>

        <View style={{ marginBottom: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ flex: 1, color: colors.foreground, fontSize: 14, fontFamily: "Inter_500Medium" }}>{t("n.ssl.disable")}</Text>
            <Switch value={insecureSsl} onValueChange={setInsecureSsl} trackColor={{ true: colors.destructive }} />
          </View>
          {insecureSsl ? <Text style={{ color: colors.destructive, fontSize: 11, marginTop: 4, lineHeight: 15 }}>{t("n.ssl.warning")}</Text> : null}
        </View>

        <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.6, marginBottom: 8 }}>
          {t("g.auth.title")}
        </Text>
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

        <Btn label={t("g.clone.submit")} icon="download-cloud" variant="primary" onPress={submit} loading={busy} style={{ marginTop: 8 }} />
        <ProgressLine text={progressText(progress, t)} />
        <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 14, lineHeight: 16 }}>{t("g.clone.note")}</Text>
      </ScrollView>

      <PickerModal
        visible={picker}
        title={t("g.clone.fromGitHub")}
        loading={reposLoading}
        searchable
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("files.search")}
        emptyLabel={t("files.noRepoFound")}
        items={filtered.map((r) => ({ key: String(r.id), label: r.full_name, icon: r.private ? ("lock" as const) : ("repo" as const) }))}
        onSelect={(key) => {
          const r = repos.find((x) => String(x.id) === key);
          if (r) {
            setUrl(`${r.html_url}.git`);
            setName(r.name);
            setBranch("");
            setAuth("github");
          }
          setPicker(false);
          setSearch("");
        }}
        onClose={() => {
          setPicker(false);
          setSearch("");
        }}
      />
    </KeyboardAvoidingView>
  );
}
