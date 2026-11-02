import { Feather, Octicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { Btn, describeError, Empty, syncSummaryText } from "@/components/GitUi";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import { showAlert, showConfirm } from "@/utils/dialogs";
import { hostOf, type Container } from "@/utils/git/store";

export default function ReposScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { containers, ready, busy, sync, remove } = useRepos();
  const s = makeStyles(colors);

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
    for (const c of containers) {
      if (c.merge) continue;
      try {
        await sync(c.id);
      } catch (e) {
        errors.push(`${c.name} : ${describeError(e, t)}`);
      }
    }
    if (errors.length) showAlert(t("g.repos.syncAllErrors"), errors.join("\n\n"));
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
          <Feather name="download-cloud" size={14} color="#000" />
          <Text style={s.addText}>{t("g.repos.clone")}</Text>
        </Pressable>
      </View>

      {!ready ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          initialNumToRender={12}
          windowSize={7}
          maxToRenderPerBatch={10}
          data={containers}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 100, gap: 10 }}
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
              <Pressable
                onPress={() => router.push({ pathname: "/repo/[id]", params: { id: c.id } } as any)}
                onLongPress={() => confirmRemove(c)}
                style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }]}
              >
                <View style={s.iconBox}>
                  <Octicons name="repo" size={18} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.name} numberOfLines={1}>{c.name}</Text>
                  <Text style={s.meta} numberOfLines={1}>
                    {c.url ? hostOf(c.url) : t("newRepo.localOnly")} · {c.branch ?? "—"}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                    {c.pendingRetry ? <Feather name="wifi-off" size={11} color="#e3b341" /> : null}
                    {c.merge ? <Feather name="alert-triangle" size={11} color={colors.destructive} /> : null}
                    <Text
                      style={[s.meta, { color: c.merge || failed ? colors.destructive : colors.mutedForeground }]}
                      numberOfLines={1}
                    >
                      {op ? t(`g.op.${op}`) : syncSummaryText(c, t)}
                    </Text>
                  </View>
                </View>
                <Pressable hitSlop={8} disabled={!!op || !!c.merge} onPress={() => syncOne(c)} style={s.syncBtn}>
                  {op ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Feather name="refresh-cw" size={18} color={c.merge ? colors.mutedForeground : colors.accent} />
                  )}
                </Pressable>
              </Pressable>
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
    title: { flex: 1, fontSize: 20, color: colors.foreground, fontFamily: "Inter_700Bold" },
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
    addText: { fontSize: 11, color: "#000", fontFamily: "Inter_700Bold" },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      padding: 12,
    },
    iconBox: {
      width: 38,
      height: 38,
      borderRadius: 10,
      backgroundColor: colors.greenBg,
      alignItems: "center",
      justifyContent: "center",
    },
    name: { fontSize: 15, color: colors.foreground, fontFamily: "Inter_700Bold" },
    meta: { fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
    syncBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  });
}
