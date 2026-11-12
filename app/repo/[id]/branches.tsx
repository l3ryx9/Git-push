import { Feather, Octicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { Card, describeError, HelpTip, IconBtn, MONO, PromptModal, ScreenHeader, SectionTitle } from "@/components/GitUi";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import { showAlert, showConfirm } from "@/utils/dialogs";
import { showTypedConfirm } from "@/utils/safeConfirm";
import * as engine from "@/utils/git/engine";
import type { MergeOutcome } from "@/utils/git/engine";
import { mergeRefIntoContainer } from "@/utils/git/sync";
import { showToast } from "@/utils/toast";
import { showActionSheet, type SheetAction } from "@/utils/actionSheet";

type Data = { current: string | null; local: string[]; remotes: { remote: string; branches: string[] }[] };

export default function BranchesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const repos = useRepos();
  const c = repos.get(id);
  const op = repos.busy[id];
  const [data, setData] = useState<Data | null>(null);
  const [query, setQuery] = useState("");
  const [prompt, setPrompt] = useState<null | { kind: "create" } | { kind: "rename"; name: string }>(null);

  const load = useCallback(async () => {
    try {
      const d = await repos.read(id, async (ctx) => {
        const current = await engine.currentBranch(ctx.dir);
        const local = await engine.listLocalBranches(ctx.dir);
        const remotes = await Promise.all(
          (await engine.listRemotes(ctx.dir)).map(async (r) => ({ remote: r.remote, branches: await engine.listRemoteBranches(ctx.dir, r.remote) }))
        );
        return { current, local, remotes };
      });
      setData(d);
    } catch (e) {
      showAlert(t("g.nav.branches"), describeError(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!c) return null;

  async function act(label: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      // La fusion affiche son propre résultat (y compris les conflits).
      if (label !== "merge") showToast(t("g.feedback.done"), "success", t(`g.op.${label}`));
    } catch (e) {
      showAlert(t(`g.op.${label}`), describeError(e, t));
    } finally {
      void load();
    }
  }

  function afterMerge(o: MergeOutcome) {
    if (o.kind === "conflict") {
      showAlert(t("g.conflicts.title"), t("g.conflicts.found", { n: o.merge.conflicts.length }), [
        { text: "OK", onPress: () => router.push({ pathname: "/repo/[id]/conflicts", params: { id } } as any) },
      ]);
    } else showToast(t(`g.merge.${o.kind}`), "success", t("g.branches.merge"));
  }

  const checkout = (name: string, remote?: string) =>
    act("checkout", () => repos.run(id, "checkout", (ctx) => engine.checkoutBranch(ctx.dir, name, remote)));

  function localActions(name: string) {
    const isCurrent = name === data?.current;
    const actions: SheetAction[] = [];
    if (!isCurrent) {
      actions.push({ label: t("g.branches.checkout"), icon: "log-in", onPress: () => void checkout(name) });
      actions.push({
        label: t("g.branches.mergeInto", { branch: data?.current ?? "" }),
        icon: "git-merge",
        onPress: () =>
          void act("merge", async () =>
            afterMerge(await repos.withBusy(id, "merge", () => mergeRefIntoContainer(id, `refs/heads/${name}`, name)))
          ),
      });
    }
    actions.push({ label: t("g.files.rename"), icon: "edit-2", onPress: () => setPrompt({ kind: "rename", name }) });
    if (!isCurrent) {
      actions.push({
        label: t("g.common.delete"),
        icon: "trash-2",
        destructive: true,
        onPress: () =>
          showConfirm({
            title: t("g.branches.deleteTitle"),
            message: t("g.branches.deleteBody", { name }),
            confirmText: t("g.common.delete"),
            cancelText: t("msg.cancel"),
            destructive: true,
            onConfirm: () => void act("delete", () => repos.run(id, "delete", (ctx) => engine.deleteBranch(ctx.dir, name))),
          }),
      });
    }
    // Toutes les actions dans un seul menu (l'ancien Alert natif était limité à 3 boutons sur Android).
    showActionSheet({ title: name, actions });
  }

  function remoteActions(remote: string, name: string) {
    const exists = data?.local.includes(name);
    showActionSheet({
      title: `${remote}/${name}`,
      actions: [
        exists
          ? {
              label: t("g.branches.mergeInto", { branch: data?.current ?? "" }),
              icon: "git-merge",
              onPress: () =>
                void act("merge", async () =>
                  afterMerge(await repos.withBusy(id, "merge", () => mergeRefIntoContainer(id, `refs/remotes/${remote}/${name}`, `${remote}/${name}`)))
                ),
            }
          : { label: t("g.branches.checkoutTrack"), icon: "download", onPress: () => void checkout(name, remote) },
        {
          label: t("g.branches.deleteRemote"),
          icon: "trash-2",
          destructive: true,
          onPress: () => {
            const armed = showTypedConfirm({
              title: t("g.branches.deleteRemote"),
              message: `${t("g.branches.deleteRemoteBody", { name: `${remote}/${name}` })}\n\n${t("safe.remoteBranchBody", { name: `${remote}/${name}` })}`,
              phrase: name,
              confirmText: t("g.common.delete"),
              cancelText: t("msg.cancel"),
              onConfirm: () =>
                void act("push", () => repos.run(id, "push", (ctx) => engine.pushRemote(ctx, name, { remote, delete: true }))),
            });
            if (!armed) showAlert(t("msg.error"), t("safe.unavailable"));
          },
        },
      ],
    });
  }

  async function onPrompt(v: Record<string, string>) {
    const p = prompt;
    setPrompt(null);
    const name = (v.name ?? "").trim().replace(/\s+/g, "-");
    if (!name || !p) return;
    if (p.kind === "create") await act("branch", () => repos.run(id, "branch", (ctx) => engine.createBranch(ctx.dir, name, true)));
    else await act("branch", () => repos.run(id, "branch", (ctx) => engine.renameBranch(ctx.dir, p.name, name)));
  }

  const needle = query.trim().toLocaleLowerCase();
  const visibleLocal = (data?.local ?? []).filter((b) => b.toLocaleLowerCase().includes(needle));
  const visibleRemotes = (data?.remotes ?? []).map((r) => ({ ...r, branches: r.branches.filter((b) => `${r.remote}/${b}`.toLocaleLowerCase().includes(needle) || b.toLocaleLowerCase().includes(needle)) })).filter((r) => r.branches.length > 0 || !needle);

  const row = (label: string, opts: { current?: boolean; onPress: () => void; icon?: "git-branch" | "cloud" }) => (
    <Pressable accessibilityRole="button"
      key={label}
      onPress={opts.onPress}
      style={({ pressed }) => [
        { flexDirection: "row", alignItems: "center", gap: 10, padding: 13, borderBottomWidth: 1, borderColor: colors.border },
        pressed && { backgroundColor: colors.secondary },
      ]}
    >
      {opts.icon === "cloud" ? (
        <Feather name="cloud" size={14} color={colors.mutedForeground} />
      ) : (
        <Octicons name="git-branch" size={15} color={opts.current ? colors.accent : colors.mutedForeground} />
      )}
      <Text style={{ flex: 1, color: opts.current ? colors.accent : colors.foreground, fontFamily: MONO, fontSize: 13 }} numberOfLines={1}>
        {label}
      </Text>
      {opts.current ? <Feather name="check" size={15} color={colors.accent} /> : <Feather name="more-vertical" size={15} color={colors.mutedForeground} />}
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppBackground />
      <ScreenHeader art="branches"
        title={t("g.nav.branches")}
        subtitle={op ? t(`g.op.${op}`) : data?.current ?? undefined}
        right={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <IconBtn icon="git-merge" label={t("a11y.compareBranches")} onPress={() => router.push({ pathname: "/repo/[id]/compare", params: { id } } as any)} />
            <IconBtn icon="plus" label={t("a11y.newBranch")} onPress={() => setPrompt({ kind: "create" })} />
          </View>
        }
      />
      {!data ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
          <HelpTip title={t("g.help.branches.title")} body={t("g.help.branches.body")} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card, paddingHorizontal: 12, marginBottom: 14 }}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput value={query} onChangeText={setQuery} placeholder={t("g.branches.search")} placeholderTextColor={colors.mutedForeground} autoCapitalize="none" autoCorrect={false} style={{ flex: 1, color: colors.foreground, paddingVertical: 11, fontSize: 13 }} />
            {!!query && <Pressable accessibilityRole="button" accessibilityLabel={t("a11y.clearSearch")} onPress={() => setQuery("")} hitSlop={12}><Feather name="x-circle" size={16} color={colors.mutedForeground} /></Pressable>}
          </View>
          <SectionTitle>{t("g.branches.local")} · {visibleLocal.length}</SectionTitle>
          <Card>{visibleLocal.length ? visibleLocal.map((b) => row(b, { current: b === data.current, onPress: () => localActions(b) })) : <Text style={{ color: colors.mutedForeground, padding: 13, fontSize: 12 }}>{t("g.branches.noMatch")}</Text>}</Card>
          {visibleRemotes.map((r) => (
            <View key={r.remote}>
              <SectionTitle>{t("g.branches.remote", { remote: r.remote })}</SectionTitle>
              <Card>
                {r.branches.length ? (
                  r.branches.map((b) => row(`${r.remote}/${b}`, { icon: "cloud", onPress: () => remoteActions(r.remote, b) }))
                ) : (
                  <Text style={{ color: colors.mutedForeground, padding: 13, fontSize: 12 }}>{t("g.branches.noneRemote")}</Text>
                )}
              </Card>
            </View>
          ))}
          <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 10, paddingHorizontal: 4 }}>{t("g.branches.hint")}</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/repo/[id]/compare", params: { id } } as any)} style={{ marginTop: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 13, flexDirection: "row", alignItems: "center", gap: 10 }}><Feather name="git-merge" size={16} color={colors.accent} /><Text style={{ flex: 1, color: colors.foreground, fontSize: 13, fontFamily: "Inter_600SemiBold" }}>{t("g.branches.compare")}</Text><Feather name="chevron-right" size={16} color={colors.mutedForeground} /></Pressable>
        </ScrollView>
      )}
      <PromptModal
        visible={!!prompt}
        title={prompt?.kind === "rename" ? t("g.files.rename") : t("g.branches.new")}
        fields={[{ key: "name", label: t("g.branches.name"), initial: prompt?.kind === "rename" ? prompt.name : "", placeholder: "feature/ma-branche" }]}
        confirmText={t("g.common.ok")}
        cancelText={t("msg.cancel")}
        onConfirm={onPrompt}
        onClose={() => setPrompt(null)}
      />
    </View>
  );
}
