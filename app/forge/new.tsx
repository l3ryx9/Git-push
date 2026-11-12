import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { forgeErrorText, forgeParams, kindLabel, useForgeRef } from "@/components/ForgeUi";
import { AiButton } from "@/components/AiUi";
import { Btn, Field, ScreenHeader, Segmented } from "@/components/GitUi";
import { draftText } from "@/utils/ai/tasks";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { showAlert } from "@/utils/dialogs";
import { compareCommits, createIssue, createPull, listBranches, type Kind } from "@/utils/forge";

export default function ForgeNewScreen() {
  const ref = useForgeRef();
  const kind: Kind = ref.raw.kind === "pulls" ? "pulls" : "issues";
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, lang } = useI18n() as ReturnType<typeof useI18n> & { lang: string };
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [head, setHead] = useState(ref.raw.head ?? "");
  const [base, setBase] = useState("");
  const [isDraft, setIsDraft] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (kind !== "pulls") return;
    listBranches(ref)
      .then((b) => {
        setBranches(b.names);
        setBase((cur) => cur || b.default || b.names[0] || "");
        setHead((cur) => cur || b.names.find((x) => x !== b.default) || "");
      })
      .catch((e) => showAlert(t("g.nav.branches"), forgeErrorText(e, t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    if (!title.trim()) return showAlert(kindLabel(kind, ref, t), t("f.new.needTitle"));
    if (kind === "pulls" && (!head || !base || head === base)) return showAlert(kindLabel(kind, ref, t), t("f.new.badBranches"));
    setBusy(true);
    try {
      const n =
        kind === "issues"
          ? await createIssue(ref, title.trim(), body)
          : await createPull(ref, { title: title.trim(), body, head, base, draft: isDraft });
      router.replace({ pathname: "/forge/item", params: forgeParams(ref, { kind, number: n }) } as any);
    } catch (e) {
      showAlert(kindLabel(kind, ref, t), forgeErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  const branchOptions = branches.slice(0, 40).map((b) => ({ value: b, label: b }));

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <AppBackground />
      <ScreenHeader art="forge" title={kind === "issues" ? t("f.new.issue") : ref.provider === "gitlab" ? t("f.new.mr") : t("f.new.pr")} subtitle={ref.project} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <Field label={t("f.new.title")} value={title} onChangeText={setTitle} />
        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: -4 }}>
          <AiButton
            label={t("ai.draft")}
            run={async (ai) => {
              let ctx = `Dépôt : ${ref.project}\nTitre : ${title || "(à définir)"}`;
              if (kind === "pulls" && head && base) {
                const commits = await compareCommits(ref, base, head).catch(() => [] as string[]);
                ctx += `\nBranches : ${head} → ${base}\nCommits :\n${commits.map((m) => `- ${m}`).join("\n") || "(aucun)"}`;
              }
              return draftText(ai, kind === "pulls" ? "pull" : "issue", ctx, body, lang ?? "fr");
            }}
            onResult={setBody}
          />
        </View>
        <Field label={t("f.new.body")} value={body} onChangeText={setBody} multiline placeholder={t("f.new.bodyPh")} />
        {kind === "pulls" ? (
          <>
            <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: "Inter_600SemiBold", marginBottom: 8 }}>{t("f.new.head")}</Text>
            <Segmented value={head} onChange={setHead} options={branchOptions} />
            <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: "Inter_600SemiBold", marginBottom: 8 }}>{t("f.new.base")}</Text>
            <Segmented value={base} onChange={setBase} options={branchOptions} />
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
              <Text style={{ flex: 1, color: colors.foreground, fontSize: 14 }}>{t("f.new.draft")}</Text>
              <Switch value={isDraft} onValueChange={setIsDraft} trackColor={{ true: colors.primary }} />
            </View>
          </>
        ) : null}
        <Btn label={t("f.new.create")} icon="plus" variant="primary" onPress={submit} loading={busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
