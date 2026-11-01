import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { describeError, Empty, IconBtn, MONO, PromptModal, ScreenHeader, statusColor } from "@/components/GitUi";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import { showAlert, showConfirm } from "@/utils/dialogs";
import * as engine from "@/utils/git/engine";
import { listEntries, makeDir, movePath, pathExists, removePath, writeTextDeep, type Entry } from "@/utils/git/fs";
import { repoDir } from "@/utils/git/store";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i;

export default function FilesScreen() {
  const { id, path = "" } = useLocalSearchParams<{ id: string; path?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const repos = useRepos();
  const c = repos.get(id);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [changed, setChanged] = useState<Record<string, string>>({});
  const [prompt, setPrompt] = useState<null | { kind: "file" | "folder" | "rename"; entry?: Entry }>(null);

  const base = c ? repoDir(c) : "";
  const absDir = path ? `${base}/${path}` : base;

  const load = useCallback(async () => {
    if (!c) return;
    try {
      const list = await listEntries(absDir);
      setEntries(path ? list : list.filter((e) => e.name !== ".git"));
      const st = await repos.read(id, (ctx) => engine.getStatus(ctx.dir));
      const map: Record<string, string> = {};
      for (const f of st) {
        map[f.path] = f.kind;
        const parts = f.path.split("/");
        for (let i = 1; i < parts.length; i++) map[parts.slice(0, i).join("/") + "/"] ??= "modified";
      }
      setChanged(map);
    } catch (e) {
      showAlert(t("g.nav.files"), describeError(e, t));
      setEntries([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [absDir]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!c) return null;

  const rel = (e: Entry) => (path ? `${path}/${e.name}` : e.name);

  function open(e: Entry) {
    if (e.isDir) router.push({ pathname: "/repo/[id]/files", params: { id, path: rel(e) } } as any);
    else router.push({ pathname: "/repo/[id]/editor", params: { id, path: rel(e) } } as any);
  }

  function actions(e: Entry) {
    Alert.alert(e.name, undefined, [
      { text: t("g.files.rename"), onPress: () => setPrompt({ kind: "rename", entry: e }) },
      {
        text: t("g.common.delete"),
        style: "destructive",
        onPress: () =>
          showConfirm({
            title: t("g.files.deleteTitle"),
            message: t("g.files.deleteBody", { name: rel(e) }),
            confirmText: t("g.common.delete"),
            cancelText: t("msg.cancel"),
            destructive: true,
            onConfirm: async () => {
              await removePath(e.path);
              void load();
            },
          }),
      },
      { text: t("msg.cancel"), style: "cancel" },
    ]);
  }

  function addMenu() {
    Alert.alert(t("g.files.new"), undefined, [
      { text: t("g.files.newFile"), onPress: () => setPrompt({ kind: "file" }) },
      { text: t("g.files.newFolder"), onPress: () => setPrompt({ kind: "folder" }) },
      { text: t("msg.cancel"), style: "cancel" },
    ]);
  }

  async function onPrompt(values: Record<string, string>) {
    const name = (values.name ?? "").trim().replace(/^\/+|\/+$/g, "");
    const p = prompt;
    setPrompt(null);
    if (!name || !p) return;
    if (name.split("/").some((seg) => seg === ".." || seg === ".git")) {
      showAlert(t("g.files.new"), t("g.files.badName"));
      return;
    }
    try {
      const target = `${absDir}/${name}`;
      if (await pathExists(target)) {
        showAlert(t("g.files.new"), t("g.err.exists"));
        return;
      }
      if (p.kind === "folder") await makeDir(target);
      else if (p.kind === "file") {
        await writeTextDeep(target, "");
        router.push({ pathname: "/repo/[id]/editor", params: { id, path: path ? `${path}/${name}` : name } } as any);
      } else if (p.entry) await movePath(p.entry.path, target);
      void load();
    } catch (e) {
      showAlert(t("g.files.new"), describeError(e, t));
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title={path ? path.split("/").pop()! : c.name} subtitle={`/${path}`} right={<IconBtn icon="plus" onPress={addMenu} />} />
      {entries === null ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} />
      ) : (
        <FlatList
          initialNumToRender={12}
          windowSize={7}
          maxToRenderPerBatch={10}
          data={entries}
          keyExtractor={(e) => e.path}
          contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}
          ListEmptyComponent={<Empty icon="folder" text={t("g.files.empty")} />}
          renderItem={({ item: e }) => {
            const kind = changed[e.isDir ? rel(e) + "/" : rel(e)];
            return (
              <Pressable
                onPress={() => open(e)}
                onLongPress={() => actions(e)}
                style={({ pressed }) => [
                  { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.border },
                  pressed && { backgroundColor: colors.secondary },
                ]}
              >
                <Feather
                  name={e.isDir ? "folder" : IMAGE_RE.test(e.name) ? "image" : "file-text"}
                  size={17}
                  color={e.isDir ? colors.accent : colors.mutedForeground}
                />
                <Text style={{ flex: 1, color: kind ? statusColor(kind, colors) : colors.foreground, fontSize: 14, fontFamily: MONO }} numberOfLines={1}>
                  {e.name}
                </Text>
                {!e.isDir ? <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{formatSize(e.size)}</Text> : null}
                {e.isDir ? <Feather name="chevron-right" size={14} color={colors.mutedForeground} /> : null}
              </Pressable>
            );
          }}
        />
      )}
      <PromptModal
        visible={!!prompt}
        title={prompt?.kind === "folder" ? t("g.files.newFolder") : prompt?.kind === "rename" ? t("g.files.rename") : t("g.files.newFile")}
        fields={[{ key: "name", label: t("g.files.name"), initial: prompt?.entry?.name ?? "", placeholder: prompt?.kind === "folder" ? "src" : "README.md" }]}
        confirmText={t("g.common.ok")}
        cancelText={t("msg.cancel")}
        onConfirm={onPrompt}
        onClose={() => setPrompt(null)}
      />
    </View>
  );
}
