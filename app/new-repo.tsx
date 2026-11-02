import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { Btn, Field, ScreenHeader } from "@/components/GitUi";
import { useGitHub } from "@/context/GitHubContext";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { aiReady, loadAi } from "@/utils/ai/settings";
import { createRepository, hasGitHubToken, slugRepoName } from "@/utils/git/create";
import { showAlert } from "@/utils/dialogs";

/** Nouveau dépôt : dossier Git local (+ GitHub), puis ouverture de l'agent IA pour y créer les fichiers. */
export default function NewRepoScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { user } = useGitHub();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [onGitHub, setOnGitHub] = useState(false);
  const [canGitHub, setCanGitHub] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [aiOk, setAiOk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    hasGitHubToken().then((ok) => {
      setCanGitHub(ok);
      setOnGitHub(ok);
    });
    loadAi().then((s) => setAiOk(aiReady(s)));
  }, []);

  async function submit() {
    if (!slugRepoName(name)) {
      showAlert(t("newRepo.title"), t("newRepo.badName"));
      return;
    }
    setBusy(true);
    try {
      const author = {
        name: user?.name || user?.login || "Git-Push",
        email: user?.email || (user?.login ? `${user.login}@users.noreply.github.com` : "gitcrush@localhost"),
      };
      const c = await createRepository({ name, description: description.trim(), onGitHub: onGitHub && canGitHub, isPrivate, author });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      if (aiOk) {
        router.replace({ pathname: "/(tabs)/ai", params: { repo: c.id, ...(prompt.trim() ? { prompt: prompt.trim() } : {}) } } as any);
      } else {
        router.replace({ pathname: "/repo/[id]", params: { id: c.id } } as any);
      }
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      showAlert(t("newRepo.title"), String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const row = (label: string, value: boolean, onChange: (v: boolean) => void, hint?: string, disabled?: boolean) => (
    <View style={{ marginBottom: 14, opacity: disabled ? 0.5 : 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ flex: 1, color: colors.foreground, fontSize: 14, fontFamily: "Inter_500Medium" }}>{label}</Text>
        <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: colors.primary }} />
      </View>
      {hint ? <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 3, lineHeight: 15 }}>{hint}</Text> : null}
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <AppBackground />
      <ScreenHeader title={t("newRepo.title")} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <Field label={t("newRepo.name")} value={name} onChangeText={setName} placeholder="mon-projet" />
        <Field label={t("newRepo.description")} value={description} onChangeText={setDescription} placeholder={t("newRepo.descriptionPh")} />
        {row(t("newRepo.github"), onGitHub && canGitHub, setOnGitHub, canGitHub ? t("newRepo.githubHint") : t("newRepo.githubOff"), !canGitHub)}
        {onGitHub && canGitHub ? row(t("newRepo.private"), isPrivate, setIsPrivate) : null}
        {aiOk ? (
          <Field label={t("newRepo.prompt")} value={prompt} onChangeText={setPrompt} multiline placeholder={t("newRepo.promptPh")} hint={t("newRepo.promptHint")} />
        ) : (
          <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 14, lineHeight: 17 }}>{t("newRepo.noAi")}</Text>
        )}
        <Btn label={t("newRepo.create")} icon="plus" variant="primary" onPress={submit} loading={busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
