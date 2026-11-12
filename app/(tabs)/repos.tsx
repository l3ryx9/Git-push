import { Feather, Octicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { Illustration, illustrationColor } from "@/components/Illustration";
import { FavoriteButton, useToggleFavorite } from "@/components/FavoriteButton";
import { Badge, Btn, describeError, Empty, PressableScale, SkeletonRow, syncSummaryText } from "@/components/GitUi";
import { stateColor } from "@/components/HomeUi";
import { TAB_BAR_SPACE } from "@/constants/layout";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import { showAlert, showConfirm } from "@/utils/dialogs";
import { hostOf, type Container } from "@/utils/git/store";
import { syncState } from "@/utils/homePure";
import { showToast } from "@/utils/toast";
import { C, withAlpha } from "@/constants/colors";

export default function ReposScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { containers, ready, busy, sync, remove } = useRepos();
  const toggleFavorite = useToggleFavorite();
  const s = makeStyles(colors);
  const [syncingAll, setSyncingAll] = useState(false);
  const [query, setQuery] = useState("");
  const filteredContainers = containers.filter((c) => `${c.name} ${c.url ?? ""} ${c.branch ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  async function syncOne(c: Container) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    try {
      await sync(c.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (e) {
      showAlert(c.name, describeError(e, t));
    }
  }

  function confirmSyncAll() {
    if (syncingAll) return;
    const eligibleCount = containers.filter((c) => !c.merge && c.url).length;
    if (!eligibleCount) return;
    showConfirm({
      title: t("g.repos.syncAllConfirmTitle"),
      message: t("g.repos.syncAllConfirmBody", { n: eligibleCount }),
      confirmText: t("g.repos.syncAll"),
      cancelText: t("msg.cancel"),
      onConfirm: () => void runSyncAll(),
    });
  }

  async function runSyncAll() {
    if (syncingAll) return;
    setSyncingAll(true);
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
    try {
      await Promise.all([worker(), worker()]);
      if (errors.length) showAlert(t("g.repos.syncAllErrors"), errors.join("\n\n"));
      else if (list.length) showToast(t("g.repos.syncAllDone", { n: list.length }));
    } finally {
      setSyncingAll(false);
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
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 46, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: withAlpha(illustrationColor("repos", colors), 0.12), borderWidth: 1, borderColor: withAlpha(illustrationColor("repos", colors), 0.22) }}>
            <Illustration kind="repos" size={40} />
          </View>
          <Text style={s.title}>{t("g.repos.title")}</Text>
        </View>
        {containers.length > 1 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("g.repos.syncAll")}
            accessibilityState={{ disabled: syncingAll }}
            disabled={syncingAll}
            onPress={confirmSyncAll}
            style={({ pressed }) => [s.syncAllBtn, pressed && { opacity: 0.78 }, syncingAll && { opacity: 0.6 }]}
          >
            {syncingAll ? <ActivityIndicator size="small" color={colors.accent} /> : <Feather name="refresh-cw" size={15} color={colors.accent} />}
            <Text style={s.syncAllText}>{syncingAll ? t("g.repos.syncingAll") : t("g.repos.syncAll")}</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("newRepo.title")}
          hitSlop={8}
          onPress={() => router.push("/new-repo" as any)}
          style={({ pressed }) => [s.headerBtn, pressed && { backgroundColor: colors.card }]}
        >
          <Feather name="plus" size={19} color={colors.foreground} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/clone" as any)}
          style={({ pressed }) => [s.addBtn, pressed && { opacity: 0.82 }]}
        >
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
          data={filteredContainers}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + TAB_BAR_SPACE + 20, gap: 10 }}
          ListHeaderComponent={
            <View style={{ gap: 9, marginBottom: 2 }}>
              <View style={s.syncHint}>
                <Feather name="info" size={14} color={colors.mutedForeground} />
                <Text style={s.syncHintText}>{t("g.repos.syncHint")}</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card, paddingHorizontal: 12 }}>
              <Feather name="search" size={16} color={colors.mutedForeground} />
              <TextInput
                accessibilityLabel={t("g.repos.search")}
                value={query}
                onChangeText={setQuery}
                placeholder={t("g.repos.search")}
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                style={{ flex: 1, minHeight: 44, color: colors.foreground, paddingVertical: 10, fontSize: 14 }}
              />
              {!!query && (
                <Pressable accessibilityRole="button" accessibilityLabel={t("g.repos.clearSearch")} onPress={() => setQuery("")} hitSlop={8} style={s.clearSearch}>
                  <Feather name="x-circle" size={17} color={colors.mutedForeground} />
                </Pressable>
              )}
                <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{filteredContainers.length}/{containers.length}</Text>
              </View>
            </View>
          }
          ListEmptyComponent={
            query.trim() ? <Text style={{ color: colors.mutedForeground, textAlign: "center", padding: 24, fontSize: 13 }}>{t("g.repos.noMatch")}</Text> : (
              <View style={{ marginTop: 30 }}>
                <Empty icon="box" art="repos" text={t("g.repos.empty")} hint={t("g.repos.emptyHint")} />
                <Btn label={t("g.repos.cloneFirst")} icon="download-cloud" variant="primary" onPress={() => router.push("/clone" as any)} />
                <Btn label={t("newRepo.title")} icon="plus" onPress={() => router.push("/new-repo" as any)} style={{ marginTop: 8 }} />
              </View>
            )
          }
          renderItem={({ item: c }) => {
            const op = busy[c.id];
            const st = syncState(c);
            const failed = st === "failed" || st === "conflict";
            return (
              <PressableScale
                onPress={() => router.push({ pathname: "/repo/[id]", params: { id: c.id } } as any)}
                accessibilityRole="button"
                accessibilityLabel={`${c.name}, ${op ? t(`g.op.${op}`) : syncSummaryText(c, t)}`}
                contentStyle={s.card}
              >
                <View style={s.cardTop}>
                  <View style={s.iconBox}>
                    <Octicons name="repo" size={19} color={colors.amber} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name} numberOfLines={1}>{c.name}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                      <Badge icon="git-branch" label={c.branch ?? "—"} color={colors.violet} />
                      <Text style={[s.meta, { flex: 1 }]} numberOfLines={1}>
                        {c.url ? hostOf(c.url) : t("newRepo.localOnly")}
                      </Text>
                    </View>
                  </View>
                  <FavoriteButton active={!!c.favorite} name={c.name} onPress={() => void toggleFavorite(c)} />
                </View>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
                  <View style={[s.dot, { backgroundColor: op ? colors.accent : stateColor(st, colors) }]} />
                  {c.pendingRetry ? <Feather name="wifi-off" size={11} color={C.warning} /> : null}
                  {c.merge ? <Feather name="alert-triangle" size={11} color={colors.destructive} /> : null}
                  <Text style={[s.meta, { flex: 1, color: failed ? colors.destructive : colors.mutedForeground }]} numberOfLines={1}>
                    {op ? t(`g.op.${op}`) : syncSummaryText(c, t)}
                  </Text>
                </View>

                <View style={s.cardActions}>
                  <Pressable
                    disabled={!!op || !!c.merge}
                    onPress={() => syncOne(c)}
                    accessibilityRole="button"
                    accessibilityLabel={`${t("g.op.sync")} ${c.name}`}
                    style={({ pressed }) => [s.syncBtn, (!!op || !!c.merge) && { opacity: 0.5 }, pressed && { backgroundColor: colors.greenBg }]}
                  >
                    {op ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <Feather name="refresh-cw" size={16} color={colors.accent} />
                    )}
                    <Text style={s.syncBtnText}>{t("g.op.sync")}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => confirmRemove(c)}
                    accessibilityRole="button"
                    accessibilityLabel={`${t("g.common.delete")} ${c.name}`}
                    style={({ pressed }) => [s.deleteBtn, pressed && { backgroundColor: colors.destructiveBg }]}
                  >
                    <Feather name="trash-2" size={17} color={colors.mutedForeground} />
                  </Pressable>
                </View>
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
    title: { flex: 1, fontSize: 25, color: colors.foreground, fontFamily: "Inter_700Bold", letterSpacing: -0.4 },
    headerBtn: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
    syncAllBtn: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 11, borderRadius: 21, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    syncAllText: { color: colors.foreground, fontSize: 11, fontFamily: "Inter_600SemiBold" },
    syncHint: { flexDirection: "row", alignItems: "flex-start", gap: 7, paddingHorizontal: 3 },
    syncHintText: { flex: 1, color: colors.mutedForeground, fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
    addBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: colors.primary,
      paddingHorizontal: 12,
      minHeight: 42,
      paddingVertical: 9,
      borderRadius: 21,
    },
    addText: { fontSize: 12, color: colors.primaryForeground, fontFamily: "Inter_700Bold" },
    card: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 22,
      padding: 14,
      paddingRight: 8,
    },
    cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
    cardActions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, paddingRight: 6 },
    syncBtn: {
      flex: 1,
      minHeight: 46,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.3),
      backgroundColor: withAlpha(colors.accent, 0.08),
    },
    syncBtnText: { fontSize: 13.5, color: colors.accent, fontFamily: "Inter_600SemiBold" },
    deleteBtn: { width: 48, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
    dot: { width: 8, height: 8, borderRadius: 4 },
    clearSearch: { width: 36, height: 44, alignItems: "center", justifyContent: "center" },
    iconBox: {
      width: 46,
      height: 46,
      borderRadius: 15,
      backgroundColor: withAlpha(colors.amber, 0.14),
      alignItems: "center",
      justifyContent: "center",
    },
    name: { fontSize: 16, color: colors.foreground, fontFamily: "Inter_700Bold" },
    meta: { fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
  });
}
