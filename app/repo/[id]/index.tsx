import { Feather, Octicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Btn,
  Card,
  describeError,
  IconBtn,
  MONO,
  NavRow,
  ProgressLine,
  progressText,
  ScreenHeader,
  SectionTitle,
  statusColor,
  statusLetter,
  syncSummaryText,
} from "@/components/GitUi";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import { showAlert, showConfirm } from "@/utils/dialogs";
import * as engine from "@/utils/git/engine";
import type { FileStatus, MergeOutcome, SyncSummary } from "@/utils/git/engine";
import { hostOf } from "@/utils/git/store";
import { pullContainer } from "@/utils/git/sync";
import { goForge } from "@/components/ForgeUi";
import { AiButton, useAiReady } from "@/components/AiUi";
import { suggestCommitMessage } from "@/utils/ai/tasks";
import { forgeFromUrl, type ForgeRef } from "@/utils/forge";

export default function RepoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, lang } = useI18n() as ReturnType<typeof useI18n> & { lang: string };
  const showAi = useAiReady();
  const repos = useRepos();
  const c = repos.get(id);
  const op = repos.busy[id];
  const s = makeStyles(colors);

  const [status, setStatus] = useState<FileStatus[] | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [ab, setAb] = useState<{ ahead: number; behind: number; upstream: boolean } | null>(null);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forge, setForge] = useState<ForgeRef | null>(null);

  React.useEffect(() => {
    if (c) forgeFromUrl(c.url, c.accountId).then(setForge).catch(() => setForge(null));
  }, [c?.url, c?.accountId]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await repos.read(id, async (ctx) => {
        const b = await engine.currentBranch(ctx.dir);
        const st = await engine.getStatus(ctx.dir);
        const counts = b ? await engine.aheadBehind(ctx.dir, b, ctx.remote) : null;
        return { b, st, counts };
      });
      setBranch(res.b);
      setStatus(res.st);
      setAb(res.counts);
      setLoadError(null);
    } catch (e) {
      setLoadError(describeError(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!c) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScreenHeader title={t("g.repo.title")} />
        <Text style={{ color: colors.mutedForeground, padding: 20 }}>{t("g.err.containerNotFound")}</Text>
      </View>
    );
  }
  const container = c;

  function go(screen: string, params: Record<string, string> = {}) {
    router.push({ pathname: `/repo/[id]/${screen}`, params: { id, ...params } } as any);
  }

  function describeSync(sum: SyncSummary): string {
    const parts: string[] = [];
    if (sum.committed) parts.push(t("g.sync.committed", { n: sum.committed }));
    if (sum.pulled === "fastforward" || sum.pulled === "merged") parts.push(t(`g.sync.pulled.${sum.pulled}`));
    if (sum.pushed) parts.push(t("g.sync.pushed"));
    return parts.length ? parts.join(" · ") : t("g.sync.nothing");
  }

  function afterMerge(outcome: MergeOutcome) {
    if (outcome.kind === "conflict") {
      showAlert(t("g.conflicts.title"), t("g.conflicts.found", { n: outcome.merge.conflicts.length }), [
        { text: "OK", onPress: () => go("conflicts") },
      ]);
    } else {
      showAlert(t("g.op.pull"), t(`g.merge.${outcome.kind}`));
    }
  }

  async function act<T>(label: string, fn: () => Promise<T>, done?: (r: T) => void) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    try {
      const r = await fn();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      done?.(r);
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      showAlert(t(`g.op.${label}`), describeError(e, t));
    } finally {
      void load();
    }
  }

  const onSync = () =>
    act("sync", () => repos.sync(id), (sum: SyncSummary) => {
      if (sum.pulled === "conflict") afterMerge({ kind: "conflict", merge: repos.get(id)?.merge ?? ({ conflicts: sum.conflicts } as any) });
      else showAlert(t("g.op.sync"), describeSync(sum));
    });
  const onFetch = () => act("fetch", () => repos.run(id, "fetch", (ctx) => engine.fetchRemote(ctx)));
  const onPull = () => act("pull", () => repos.withBusy(id, "pull", (onProgress) => pullContainer(id, onProgress)), afterMerge);
  const onPush = () =>
    act(
      "push",
      () =>
        repos.run(id, "push", async (ctx) => {
          const b = await engine.currentBranch(ctx.dir);
          if (!b) throw engine.codeError("NoBranch");
          await engine.pushRemote(ctx, b);
        }),
      () => showAlert(t("g.op.push"), t("g.push.done"))
    );

  const changes = status ?? [];
  const staged = changes.filter((x) => x.staged);
  const unstaged = changes.filter((x) => x.unstaged);

  const toggle = (f: FileStatus) =>
    act("stage", () =>
      repos.read(id, (ctx) => (f.unstaged ? engine.stagePaths(ctx.dir, [f.path]) : engine.unstagePaths(ctx.dir, [f.path])))
    );
  const stageAll = () => act("stage", () => repos.read(id, (ctx) => engine.stagePaths(ctx.dir, unstaged.map((x) => x.path))));
  const unstageAll = () => act("stage", () => repos.read(id, (ctx) => engine.unstagePaths(ctx.dir, staged.map((x) => x.path))));

  function discard(f: FileStatus) {
    showConfirm({
      title: t("g.changes.discardTitle"),
      message: t("g.changes.discardBody", { path: f.path }),
      confirmText: t("g.changes.discard"),
      cancelText: t("msg.cancel"),
      destructive: true,
      onConfirm: () => void act("discard", () => repos.read(id, (ctx) => engine.discardChanges(ctx.dir, [f]))),
    });
  }

  function commit() {
    const msg = message.trim();
    if (!msg) return showAlert(t("g.commit.title"), t("g.commit.needMessage"));
    if (!staged.length) return showAlert(t("g.commit.title"), t("g.commit.nothingStaged"));
    void act(
      "commit",
      () => repos.run(id, "commit", (ctx) => engine.commitStaged(ctx, msg)),
      () => setMessage("")
    );
  }

  const busyText = op ? progressText(repos.progress[id], t) ?? t(`g.op.${op}`) : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title={container.name}
        subtitle={`${hostOf(container.url)} · ${container.remote}`}
        right={<IconBtn icon="settings" onPress={() => go("settings")} />}
      />
      <ScrollView
        contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.accent}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        {/* Branche */}
        <Card>
          <Pressable style={s.branchRow} onPress={() => go("branches")}>
            <Octicons name="git-branch" size={16} color={colors.accent} />
            <Text style={s.branch} numberOfLines={1}>{branch ?? t("home.unborn")}</Text>
            {ab && ab.upstream ? (
              <Text style={s.counts}>
                ↑{ab.ahead >= 0 ? ab.ahead : "?"} ↓{ab.behind >= 0 ? ab.behind : "?"}
              </Text>
            ) : ab ? (
              <Text style={s.counts}>{t("g.repo.noUpstream")}</Text>
            ) : null}
            <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
          </Pressable>
        </Card>

        {container.merge ? (
          <Pressable style={[s.banner, { borderColor: colors.destructive }]} onPress={() => go("conflicts")}>
            <Feather name="alert-triangle" size={16} color={colors.destructive} />
            <Text style={[s.bannerText, { color: colors.destructive }]}>
              {t("g.repo.mergeBanner", { n: container.merge.conflicts.length - container.merge.resolved.length })}
            </Text>
            <Feather name="chevron-right" size={15} color={colors.destructive} />
          </Pressable>
        ) : null}
        {container.pendingRetry ? (
          <View style={[s.banner, { borderColor: "#e3b341" }]}>
            <Feather name="wifi-off" size={15} color="#e3b341" />
            <Text style={[s.bannerText, { color: "#e3b341" }]}>{t("g.repo.retryBanner")}</Text>
          </View>
        ) : null}
        {loadError ? <Text style={{ color: colors.destructive, marginTop: 10, fontSize: 12 }}>{loadError}</Text> : null}

        {/* Synchronisation */}
        <Pressable
          disabled={!!op || !!container.merge}
          onPress={onSync}
          style={({ pressed }) => [s.syncBtn, (!!op || !!container.merge) && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
        >
          {op === "sync" ? <ActivityIndicator color="#000" /> : <Feather name="refresh-cw" size={18} color="#000" />}
          <Text style={s.syncText}>{t("g.repo.sync")}</Text>
        </Pressable>
        <ProgressLine text={busyText} />
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          <Btn small label={t("g.op.fetch")} icon="download" onPress={onFetch} disabled={!!op} style={{ flex: 1 }} />
          <Btn small label={t("g.op.pull")} icon="arrow-down-circle" onPress={onPull} disabled={!!op || !!container.merge} style={{ flex: 1 }} />
          <Btn small label={t("g.op.push")} icon="arrow-up-circle" onPress={onPush} disabled={!!op || !!container.merge} style={{ flex: 1 }} />
        </View>
        <Text style={s.lastSync}>{syncSummaryText(container, t)}</Text>
        {container.lastSync && !container.lastSync.ok && container.lastSync.error && !container.merge ? (
          <Text style={[s.lastSync, { color: colors.destructive, marginTop: 2 }]} numberOfLines={3}>
            {container.lastSync.error}
          </Text>
        ) : null}

        {/* Modifications */}
        <SectionTitle
          right={
            changes.length ? (
              <View style={{ flexDirection: "row", gap: 12 }}>
                {unstaged.length ? (
                  <Text style={s.link} onPress={stageAll}>{t("g.changes.stageAll")}</Text>
                ) : null}
                {staged.length ? (
                  <Text style={s.link} onPress={unstageAll}>{t("g.changes.unstageAll")}</Text>
                ) : null}
              </View>
            ) : undefined
          }
        >
          {t("g.changes.title", { n: changes.length })}
        </SectionTitle>
        <Card>
          {status === null ? (
            <ActivityIndicator color={colors.accent} style={{ padding: 20 }} />
          ) : changes.length === 0 ? (
            <Text style={s.clean}>{t("g.changes.clean")}</Text>
          ) : (
            changes.map((f, i) => (
              <Pressable
                key={f.path}
                onPress={() => go("diff", { path: f.path, from: f.row[0] === 1 ? "HEAD" : "", to: f.kind === "deleted" ? "" : "WORKDIR" })}
                onLongPress={() => discard(f)}
                style={[s.fileRow, i < changes.length - 1 && { borderBottomWidth: 1, borderColor: colors.border }]}
              >
                <Pressable hitSlop={10} onPress={() => toggle(f)}>
                  <Feather
                    name={f.staged && !f.unstaged ? "check-square" : f.staged ? "minus-square" : "square"}
                    size={19}
                    color={f.staged ? colors.accent : colors.mutedForeground}
                  />
                </Pressable>
                <Text style={[s.letter, { color: statusColor(f.kind, colors) }]}>{statusLetter(f.kind)}</Text>
                <Text style={s.path} numberOfLines={1} ellipsizeMode="head">{f.path}</Text>
              </Pressable>
            ))
          )}
        </Card>
        {changes.length ? <Text style={s.hint}>{t("g.changes.hint")}</Text> : null}

        {/* Commit */}
        {!container.merge ? (
          <View style={{ marginTop: 12 }}>
            <View>
              <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder={t("g.commit.placeholder")}
                placeholderTextColor={colors.mutedForeground}
                multiline
                style={[s.msgInput, showAi && { paddingRight: 44 }]}
              />
              {staged.length ? (
                <View style={{ position: "absolute", right: 6, top: 8 }}>
                  <AiButton
                    run={(ai) =>
                      repos.read(id, (ctx) =>
                        suggestCommitMessage(ai, ctx.dir, staged.map((x) => x.path), message.trim(), lang ?? "fr")
                      )
                    }
                    onResult={setMessage}
                  />
                </View>
              ) : null}
            </View>
            <Btn
              label={t("g.commit.button", { n: staged.length })}
              icon="git-commit"
              variant="primary"
              onPress={commit}
              disabled={!staged.length || !!op}
              loading={op === "commit"}
              style={{ marginTop: 8 }}
            />
          </View>
        ) : null}

        {/* Navigation */}
        <SectionTitle>{t("g.repo.browse")}</SectionTitle>
        <Card>
          {showAi ? (
            <NavRow icon="zap" label={t("ai.assistant")} value={t("ai.assistantHint")} onPress={() => router.navigate({ pathname: "/(tabs)/ai", params: { repo: id } } as any)} />
          ) : null}
          <NavRow icon="folder" label={t("g.nav.files")} onPress={() => go("files")} />
          <NavRow icon="git-commit" label={t("g.nav.commits")} onPress={() => go("commits")} />
          <NavRow icon="git-branch" label={t("g.nav.branches")} value={branch ?? undefined} onPress={() => go("branches")} />
          <NavRow icon="globe" label={t("g.nav.remotes")} value={container.remote} onPress={() => go("remotes")} />
          <NavRow icon="sliders" label={t("g.nav.settings")} onPress={() => go("settings")} last />
        </Card>

        {forge ? (
          <>
            <SectionTitle>{forge.provider === "github" ? "GITHUB" : "GITLAB"}</SectionTitle>
            <Card>
              <NavRow icon="alert-circle" label={t("f.issues")} onPress={() => goForge("list", forge, { kind: "issues" })} />
              <NavRow
                icon="git-pull-request"
                label={forge.provider === "gitlab" ? t("f.mrs") : t("f.prs")}
                onPress={() => goForge("list", forge, { kind: "pulls" })}
                last={forge.provider !== "github"}
              />
              {forge.provider === "github" ? (
                <NavRow icon="play-circle" label="GitHub Actions" onPress={() => goForge("actions", forge)} last />
              ) : null}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    branchRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 13 },
    branch: { flex: 1, color: colors.foreground, fontSize: 15, fontFamily: "Inter_700Bold" },
    counts: { color: colors.mutedForeground, fontSize: 12, fontFamily: MONO },
    banner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 10,
      padding: 12,
      borderWidth: 1,
      borderRadius: colors.radius,
      backgroundColor: colors.card,
    },
    bannerText: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
    syncBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      marginTop: 14,
      paddingVertical: 15,
      borderRadius: colors.radius,
      backgroundColor: colors.primary,
    },
    syncText: { color: "#000", fontSize: 15, fontFamily: "Inter_700Bold", letterSpacing: 1 },
    lastSync: { color: colors.mutedForeground, fontSize: 11, textAlign: "center", marginTop: 10, fontFamily: "Inter_400Regular" },
    link: { color: colors.accent, fontSize: 11, fontFamily: "Inter_600SemiBold" },
    clean: { color: colors.mutedForeground, fontSize: 13, padding: 18, textAlign: "center", fontFamily: "Inter_400Regular" },
    fileRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 11 },
    letter: { width: 14, fontFamily: MONO, fontSize: 13, fontWeight: "700" },
    path: { flex: 1, color: colors.foreground, fontSize: 13, fontFamily: MONO },
    hint: { color: colors.mutedForeground, fontSize: 11, marginTop: 6, paddingHorizontal: 4, fontFamily: "Inter_400Regular" },
    msgInput: {
      backgroundColor: colors.input,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      color: colors.foreground,
      padding: 12,
      minHeight: 60,
      fontSize: 14,
      textAlignVertical: "top",
      fontFamily: "Inter_400Regular",
    },
  });
}
