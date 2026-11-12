import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { Btn, Card, Field, ScreenHeader, SectionTitle, Segmented } from "@/components/GitUi";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { aiErrorText, complete } from "@/utils/ai/providers";
import { DEFAULT_AI, loadAi, PROVIDERS, saveAi, usageToday, type AiProvider, type AiSettings } from "@/utils/ai/settings";
import { showAlert } from "@/utils/dialogs";
import { showToast } from "@/utils/toast";

export default function AiSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [s, setS] = useState<AiSettings>(DEFAULT_AI);
  const [testing, setTesting] = useState(false);
  const [used, setUsed] = useState(0);

  useEffect(() => {
    loadAi().then((v) => setS({ ...v }));
    usageToday().then(setUsed);
  }, []);

  const p = s.provider;
  const info = PROVIDERS.find((x) => x.id === p)!;

  async function patch(next: Partial<AiSettings>) {
    const merged = await saveAi(next);
    setS({ ...merged });
  }

  async function test() {
    setTesting(true);
    try {
      const out = await complete(s, "Réponds en un seul mot.", "Dis « OK ».");
      showToast(`${info.label} · ${s.models[p]} : ${out.slice(0, 80)}`, "success", t("ai.testOk"));
      usageToday().then(setUsed);
    } catch (e) {
      showAlert(t("ai.test"), aiErrorText(e, t));
    } finally {
      setTesting(false);
    }
  }

  const row = (label: string, value: boolean, onChange: (v: boolean) => void, hint?: string, last?: boolean) => (
    <View style={{ padding: 14, borderBottomWidth: last ? 0 : 1, borderColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ flex: 1, color: colors.foreground, fontSize: 14, fontFamily: "Inter_500Medium" }}>{label}</Text>
        <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary }} />
      </View>
      {hint ? <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 3, lineHeight: 15 }}>{hint}</Text> : null}
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <AppBackground />
      <ScreenHeader title={t("ai.settings")} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <Card>
          {row(t("ai.enabled"), s.enabled, (v) => void patch({ enabled: v }), t("ai.enabledHint"))}
          {row(t("ai.autoApprove"), s.autoApprove, (v) => void patch({ autoApprove: v }), t("ai.autoApproveHint"))}
          {row(t("ai.freeTier"), s.freeTier, (v) => void patch({ freeTier: v }), t("ai.freeTierHint"), true)}
        </Card>
        {s.enabled ? <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 8, marginBottom: 4 }}>{t("ai.usage", { n: used })}</Text> : null}

        {s.enabled ? (
          <>
            <SectionTitle>{t("ai.provider")}</SectionTitle>
            <Segmented value={p} onChange={(v: AiProvider) => void patch({ provider: v })} options={PROVIDERS.map((x) => ({ value: x.id, label: x.label }))} />

            <Field
              label={t("ai.key", { provider: info.label })}
              value={s.keys[p]}
              onChangeText={(v) => {
                setS((cur) => ({ ...cur, keys: { ...cur.keys, [p]: v } }));
                void saveAi({ keys: { ...s.keys, [p]: v } });
              }}
              secure
              placeholder={p === "anthropic" ? "sk-ant-…" : p === "openai" ? "sk-…" : "AIza…"}
              hint={t("ai.keyHint")}
            />
            <Btn label={t("ai.getKey")} icon="external-link" small onPress={() => WebBrowser.openBrowserAsync(info.keyUrl).catch(() => undefined)} style={{ marginBottom: 14 }} />

            <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.6, marginBottom: 8 }}>{t("ai.model")}</Text>
            <Segmented
              value={info.models.includes(s.models[p]) ? s.models[p] : ""}
              onChange={(v) => void patch({ models: { ...s.models, [p]: v } })}
              options={info.models.map((m) => ({ value: m, label: m }))}
            />
            <Field
              label={t("ai.modelCustom")}
              value={s.models[p]}
              onChangeText={(v) => {
                setS((cur) => ({ ...cur, models: { ...cur.models, [p]: v.trim() } }));
                void saveAi({ models: { ...s.models, [p]: v.trim() } });
              }}
              hint={t("ai.modelHint")}
            />
            <Field
              label={t("ai.fastModel")}
              value={s.fastModels[p] ?? ""}
              onChangeText={(v) => {
                setS((cur) => ({ ...cur, fastModels: { ...cur.fastModels, [p]: v.trim() } }));
                void saveAi({ fastModels: { ...s.fastModels, [p]: v.trim() } });
              }}
              hint={t("ai.fastModelHint")}
            />
            <Btn label={t("ai.test")} icon="activity" variant="primary" onPress={test} loading={testing} disabled={!s.keys[p]?.trim()} />

            <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 16, lineHeight: 16 }}>{t("ai.privacy")}</Text>
          </>
        ) : (
          <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 14, lineHeight: 17 }}>{t("ai.disabledInfo")}</Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
