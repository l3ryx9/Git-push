import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { Btn, Card, describeError, Empty, HelpTip, MONO, ScreenHeader } from "@/components/GitUi";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import { showAlert, showConfirm } from "@/utils/dialogs";
import * as engine from "@/utils/git/engine";

export default function ConflictsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const repos = useRepos();
  const c = repos.get(id);
  const merge = c?.merge ?? null;
  const [working, setWorking] = useState<string | null>(null);

  if (!c || !merge) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <AppBackground />
        <ScreenHeader title={t("g.conflicts.title")} />
        <Empty icon="check-circle" art="success" text={t("g.conflicts.none")} hint={t("g.help.conflicts.body")} />
      </View>
    );
  }
  const m = merge;
  const remaining = m.conflicts.filter((p) => !m.resolved.includes(p));

  async function resolve(path: string, choice: "ours" | "theirs" | "worktree") {
    setWorking(path);
    try {
      const res = await repos.read(id, (ctx) => engine.resolveConflict(ctx.dir, m, path, choice));
      const apply = () =>
        repos.update(id, { merge: { ...m, resolved: Array.from(new Set([...m.resolved, path])) } });
      if (res.markersLeft) {
        showConfirm({
          title: t("g.conflicts.markersTitle"),
          message: t("g.conflicts.markersBody", { path }),
          confirmText: t("g.conflicts.markAnyway"),
          cancelText: t("msg.cancel"),
          onConfirm: () => void apply(),
        });
      } else {
        await apply();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      }
    } catch (e) {
      showAlert(path, describeError(e, t));
    } finally {
      setWorking(null);
    }
  }

  async function finish() {
    try {
      await repos.run(id, "commit", (ctx) => engine.finishMerge(ctx, m));
      await repos.update(id, { merge: null });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      showAlert(t("g.conflicts.title"), t("g.conflicts.done"), [{ text: "OK", onPress: () => router.back() }]);
    } catch (e) {
      showAlert(t("g.conflicts.title"), describeError(e, t));
    }
  }

  function abort() {
    showConfirm({
      title: t("g.conflicts.abortTitle"),
      message: t("g.conflicts.abortBody"),
      confirmText: t("g.conflicts.abort"),
      cancelText: t("msg.cancel"),
      destructive: true,
      onConfirm: async () => {
        try {
          await repos.run(id, "abort", (ctx) => engine.abortMerge(ctx.dir, m));
          await repos.update(id, { merge: null });
          router.back();
        } catch (e) {
          showAlert(t("g.conflicts.title"), describeError(e, t));
        }
      },
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppBackground />
      <ScreenHeader title={t("g.conflicts.title")} subtitle={m.message} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 30 }}>
        <HelpTip title={t("g.help.conflicts.title")} body={t("g.help.conflicts.body")} />
        <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 17, marginBottom: 12 }}>
          {t("g.conflicts.explain", { ours: c.branch ?? "HEAD", theirs: m.label })}
        </Text>
        <Card>
          {m.conflicts.map((p, i) => {
            const done = m.resolved.includes(p);
            return (
              <View key={p} style={[{ padding: 12, gap: 10 }, i < m.conflicts.length - 1 && { borderBottomWidth: 1, borderColor: colors.border }]}>
                <Pressable
                  onPress={() => router.push({ pathname: "/repo/[id]/editor", params: { id, path: p } } as any)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  <Feather name={done ? "check-circle" : "alert-triangle"} size={15} color={done ? colors.accent : colors.destructive} />
                  <Text style={{ flex: 1, color: colors.foreground, fontFamily: MONO, fontSize: 12 }} numberOfLines={2}>
                    {p}
                  </Text>
                  <Feather name="edit-2" size={14} color={colors.mutedForeground} />
                </Pressable>
                {!done ? (
                  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                    <Btn small label={t("g.conflicts.ours")} onPress={() => resolve(p, "ours")} loading={working === p} />
                    <Btn small label={t("g.conflicts.theirs")} onPress={() => resolve(p, "theirs")} disabled={working === p} />
                    <Btn small label={t("g.conflicts.markResolved")} icon="check" onPress={() => resolve(p, "worktree")} disabled={working === p} />
                  </View>
                ) : null}
              </View>
            );
          })}
        </Card>
        <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 8, lineHeight: 16 }}>{t("g.conflicts.editHint")}</Text>
        <Btn
          label={remaining.length ? t("g.conflicts.remaining", { n: remaining.length }) : t("g.conflicts.finish")}
          icon="git-merge"
          variant="primary"
          disabled={remaining.length > 0}
          onPress={finish}
          style={{ marginTop: 16 }}
        />
        <Btn label={t("g.conflicts.abort")} icon="x-circle" variant="danger" onPress={abort} style={{ marginTop: 10 }} />
      </ScrollView>
    </View>
  );
}
