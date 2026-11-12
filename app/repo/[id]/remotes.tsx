import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { Card, describeError, IconBtn, MONO, PromptModal, ScreenHeader } from "@/components/GitUi";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import { showAlert, showConfirm } from "@/utils/dialogs";
import * as engine from "@/utils/git/engine";
import { showToast } from "@/utils/toast";
import { showActionSheet } from "@/utils/actionSheet";

export default function RemotesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const repos = useRepos();
  const c = repos.get(id);
  const [list, setList] = useState<{ remote: string; url: string }[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await repos.read(id, (ctx) => engine.listRemotes(ctx.dir)));
    } catch (e) {
      showAlert(t("g.nav.remotes"), describeError(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!c) return null;

  async function act(label: string, fn: () => Promise<unknown>, okMsg?: string) {
    try {
      await fn();
      showToast(okMsg ?? t("g.feedback.done"), "success", t(`g.op.${label}`));
    } catch (e) {
      showAlert(t(`g.op.${label}`), describeError(e, t));
    } finally {
      void load();
    }
  }

  function actions(r: { remote: string; url: string }) {
    showActionSheet({
      title: r.remote,
      message: r.url,
      actions: [
        { label: t("g.remotes.useForSync"), icon: "refresh-cw", disabled: c?.remote === r.remote, onPress: () => void repos.update(id, { remote: r.remote }) },
        { label: t("g.op.fetch"), icon: "download-cloud", onPress: () => void act("fetch", () => repos.run(id, "fetch", (ctx) => engine.fetchRemote(ctx, r.remote)), t("g.remotes.fetched")) },
        {
          label: t("g.common.delete"),
          icon: "trash-2",
          destructive: true,
          onPress: () =>
            showConfirm({
              title: t("g.remotes.deleteTitle"),
              message: t("g.remotes.deleteBody", { name: r.remote }),
              confirmText: t("g.common.delete"),
              cancelText: t("msg.cancel"),
              destructive: true,
              onConfirm: () =>
                void act("delete", async () => {
                  await repos.run(id, "delete", (ctx) => engine.deleteRemote(ctx.dir, r.remote));
                  if (c?.remote === r.remote) await repos.update(id, { remote: "origin" });
                }),
            }),
        },
      ],
    });
  }

  async function onAdd(v: Record<string, string>) {
    setAdding(false);
    const name = (v.name ?? "").trim();
    const url = (v.url ?? "").trim();
    if (!name || !/^https?:\/\//i.test(url)) {
      showAlert(t("g.remotes.add"), t("g.clone.badUrl"));
      return;
    }
    await act("remote", () => repos.run(id, "remote", (ctx) => engine.addRemote(ctx.dir, name, url)));
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppBackground />
      <ScreenHeader art="remote" title={t("g.nav.remotes")} right={<IconBtn icon="plus" label={t("a11y.addRemote")} onPress={() => setAdding(true)} />} />
      {!list ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 30 }}>
          <Card>
            {list.map((r, i) => (
              <Pressable accessibilityRole="button"
                key={r.remote}
                onPress={() => actions(r)}
                style={({ pressed }) => [
                  { flexDirection: "row", alignItems: "center", gap: 10, padding: 13 },
                  i < list.length - 1 && { borderBottomWidth: 1, borderColor: colors.border },
                  pressed && { backgroundColor: colors.secondary },
                ]}
              >
                <Feather name="globe" size={15} color={r.remote === c.remote ? colors.accent : colors.mutedForeground} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_600SemiBold" }}>
                    {r.remote}
                    {r.remote === c.remote ? `  ·  ${t("g.remotes.syncTarget")}` : ""}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: MONO }} numberOfLines={1}>
                    {r.url}
                  </Text>
                </View>
                <Feather name="more-vertical" size={15} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </Card>
          <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 10, paddingHorizontal: 4, lineHeight: 16 }}>{t("g.remotes.hint")}</Text>
        </ScrollView>
      )}
      <PromptModal
        visible={adding}
        title={t("g.remotes.add")}
        fields={[
          { key: "name", label: t("g.remotes.name"), placeholder: "upstream" },
          { key: "url", label: "URL", placeholder: "https://gitlab.com/owner/repo.git" },
        ]}
        confirmText={t("g.common.ok")}
        cancelText={t("msg.cancel")}
        onConfirm={onAdd}
        onClose={() => setAdding(false)}
      />
    </View>
  );
}
