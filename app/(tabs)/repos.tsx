import { Feather, Octicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { Badge, Btn, describeError, Empty, PressableScale, SkeletonRow, syncSummaryText } from "@/components/GitUi";
import { TAB_BAR_SPACE } from "@/constants/layout";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import { showAlert, showConfirm } from "@/utils/dialogs";
import { hostOf, type Container } from "@/utils/git/store";
import { showToast } from "@/utils/toast";
import { C } from "@/constants/colors";

export default function ReposScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { containers, ready, busy, sync, remove } = useRepos();
  const s = makeStyles(colors);
  const [refreshing, setRefreshing] = useState(false);

  async function syncOne(c: Container) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    try {
      await sync(c.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (e) {
      showAlert(c.name, describeError(e, t));
    }
  }

  async function syncAll() {
    const errors: string[] = [];
    // Deux dépôts à la fois : plus rapide que l'un après l'autre, sans saturer le réseau mobile.
    const list = containers.filter((c) => !c.merge && c.url);
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const c = list[next++];
        try {
          await sync(c.id);
        } catch (e) {
          errors.push(`${c.name} : ${describeError(e, t)}`);
        }
      }
    };
    await Promise.all([worker(), worker()]);
    if (errors.length) showAlert(t("g.repos.syncAllErrors"), errors.join("\n\n"));
    else if (list.length) showToast(t("g.repos.syncAllDone", { n: list.length }));
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await syncAll();
    } finally {
      setRefreshing(false);
    }
  }

  function confirmRemove(c: Container) {
    showConfirm({
      title: t("g.repos.removeTitle"),
      message: t("g.repos.removeBody", { name: c.name }),
      confirmText: t("g.common.delete"),
      cancelText: t("msg.cancel"),
      destructive: true,
      onConfirm: () => void remove(c.id),
    });
  }

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      <AppBackground />
      <View style={[s.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
        <Text style={s.title}>{t("g.repos.title")}</Text>
        {containers.length > 1 && (
          <Pressable hitSlop={8} onPress={syncAll} style={s.headerBtn}>
            <Feather name="refresh-cw" size={17} color={colors.foreground} />
          </Pressable>
        )}
        <Pressable hitSlop={8} onPress={() => router.push("/new-repo" as any)} style={s.headerBtn}>
          <Feather name="plus" size={19} color={colors.foreground} />
        </Pressable>
        <Pressable onPress={() => router.push("/clone" as any)} style={s.addBtn}>
          <Feather name="download-cloud" size={14} color={colors.primaryForeground} />
          <Text style={s.addText}>{t("g.repos.clone")}</Text>
        </Pressable>
      </View>

      {!ready ? (
        <View style={{ padding: 12, gap: 10 }}>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </View>
      ) : (
        <FlatList
          initialNumToRender={12}
          windowSize={7}
          maxToRenderPerBatch={10}
          data={containers}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + TAB_BAR_SPACE + 20, gap: 10 }}
          refreshControl={
            containers.length ? (
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} progressBackgroundColor={colors.cardSolid} />
            ) : undefined
          }
          ListEmptyComponent={
            <View style={{ marginTop: 30 }}>
              <Empty icon="box" text={t("g.repos.empty")} hint={t("g.repos.emptyHint")} />
              <Btn label={t("g.repos.cloneFirst")} icon="download-cloud" variant="primary" onPress={() => router.push("/clone" as any)} />
              <Btn label={t("newRepo.title")} icon="plus" onPress={() => router.push("/new-repo" as any)} style={{ marginTop: 8 }} />
            </View>
          }
          renderItem={({ item: c }) => {
            const op = busy[c.id];
            const failed = c.lastSync && !c.lastSync.ok;
            return (
              <PressableScale
                onPress={() => router.push({ pathname: "/repo/[id]", params: { id: c.id } } as any)}
                onLongPress={() => confirmRemove(c)}
                accessibilityRole="button"
                accessibilityLabel={`${c.name}, ${op ? t(`g.op.${op}`) : syncSummaryText(c, t)}`}
                contentStyle={s.card}
              >
                <View style={s.iconBox}>
                  <Octicons name="repo" size={18} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.name} numberOfLines={1}>{c.name}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }}>
                    <Badge icon="git-branch" label={c.branch ?? "—"} color={colors.accent} />
                    <Text style={s.meta} numberOfLines={1}>
                      {c.url ? hostOf(c.url) : t("newRepo.localOnly")}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                    {c.pendingRetry ? <Feather name="wifi-off" size={11} color={C.warning} /> : null}
                    {c.merge ? <Feather name="alert-triangle" size={11} color={colors.destructive} /> : null}
                    <Text
                      style={[s.meta, { color: c.merge || failed ? colors.destructive : colors.mutedForeground }]}
                      numberOfLines={1}
                    >
                      {op ? t(`g.op.${op}`) : syncSummaryText(c, t)}
                    </Text>
                  </View>
                </View>
                <Pressable
                  hitSlop={8}
                  disabled={!!op || !!c.merge}
                  onPress={() => syncOne(c)}
                  accessibilityRole="button"
                  accessibilityLabel={t("g.op.sync")}
                  style={({ pressed }) => [s.syncBtn, pressed && { backgroundColor: colors.greenBg }]}
                >
                  {op ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Feather name="refresh-cw" size={18} color={c.merge ? colors.mutedForeground : colors.accent} />
                  )}
                </Pressable>
              </PressableScale>
            );
          }}
        />
      )}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    title: { flex: 1, fontSize: 24, color: colors.foreground, fontFamily: "Inter_700Bold", letterSpacing: -0.4 },
    headerBtn: { padding: 8 },
    addBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: colors.primary,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 20,
    },
    addText: { fontSize: 12, color: colors.primaryForeground, fontFamily: "Inter_700Bold" },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      padding: 14,
    },
    iconBox: {
      width: 42,
      height: 42,
      borderRadius: colors.radiusSm + 2,
      backgroundColor: colors.greenBg,
      alignItems: "center",
      justifyContent: "center",
    },
    name: { fontSize: 15, color: colors.foreground, fontFamily: "Inter_700Bold" },
    meta: { fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
    syncBtn: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  });
}
