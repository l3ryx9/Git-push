import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { Card, describeError, MONO, ScreenHeader, SectionTitle, timeAgo } from "@/components/GitUi";
import { GitCommitGraph } from "@/components/GitCommitGraph";
import { C } from "@/constants/colors";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import * as engine from "@/utils/git/engine";


type LocalBranch = { name: string; oid: string | null; current: boolean };
type RemoteBranch = { remote: string; name: string; oid: string | null };
type Dashboard = {
  current: string | null;
  local: LocalBranch[];
  remote: RemoteBranch[];
  commits: import("@/utils/git/engine").GraphCommit[];
  aheadBehind: { ahead: number; behind: number; upstream: boolean } | null;
};

const HISTORY_LIMIT = 80;

export default function GitGraphScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const repos = useRepos();
  const container = repos.get(id);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await repos.read(id, async (ctx) => {
        const current = await engine.currentBranch(ctx.dir);
        const [localNames, remotes, commits, aheadBehind] = await Promise.all([
          engine.listLocalBranches(ctx.dir),
          engine.listRemotes(ctx.dir),
          engine.getGitGraph(ctx.dir, HISTORY_LIMIT),
          current ? engine.aheadBehind(ctx.dir, current, ctx.remote) : Promise.resolve(null),
        ]);
        const local = await Promise.all(localNames.map(async (name) => ({
          name,
          oid: await engine.resolveOrNull(ctx.dir, `refs/heads/${name}`),
          current: name === current,
        })));
        const remote = (await Promise.all(remotes.map(async (r) => {
          const names = await engine.listRemoteBranches(ctx.dir, r.remote).catch(() => []);
          return Promise.all(names.map(async (name) => ({
            remote: r.remote,
            name,
            oid: await engine.resolveOrNull(ctx.dir, `refs/remotes/${r.remote}/${name}`),
          })));
        }))).flat();
        return { current, local, remote, commits: commits.commits, aheadBehind };
      });
      setData(result);
      setError(null);
    } catch (e) {
      setError(describeError(e, t));
      setData(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!container) return null;

  const stats = data?.aheadBehind;
  const syncTint = !container.lastSync ? colors.mutedForeground : container.lastSync.ok ? colors.accent : colors.destructive;
  const syncLabel = !container.lastSync
    ? t("g.graph.never")
    : container.lastSync.ok ? t("g.graph.ok") : t("g.graph.failed");

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppBackground />
      <ScreenHeader art="branches" title={t("g.graph.title")} subtitle={container.name} />
      {data === null ? (
        error ? <Text style={{ color: colors.destructive, padding: 18 }}>{error}</Text> : <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 34 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Card style={{ flex: 1, padding: 13 }}>
              <Feather name="git-branch" size={17} color={colors.accent} />
              <Text style={{ color: colors.foreground, fontSize: 23, fontFamily: "Inter_700Bold", marginTop: 8 }}>{data.local.length}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{t("g.graph.branches")}</Text>
            </Card>
            <Card style={{ flex: 1, padding: 13 }}>
              <Feather name="cloud" size={17} color={colors.info} />
              <Text style={{ color: colors.foreground, fontSize: 23, fontFamily: "Inter_700Bold", marginTop: 8 }}>{data.remote.length}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{t("g.graph.remoteBranches")}</Text>
            </Card>
            <Card style={{ flex: 1, padding: 13 }}>
              <Feather name="git-commit" size={17} color={C.violet} />
              <Text style={{ color: colors.foreground, fontSize: 23, fontFamily: "Inter_700Bold", marginTop: 8 }}>{data.commits.length}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{t("g.graph.history")}</Text>
            </Card>
          </View>

          <SectionTitle>{t("g.graph.sync")}</SectionTitle>
          <Card style={{ padding: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
              <Feather name={container.lastSync?.ok ? "check-circle" : container.lastSync ? "alert-circle" : "clock"} size={18} color={syncTint} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: "Inter_600SemiBold" }}>{syncLabel}</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 3 }}>
                  {container.lastSync ? timeAgo(container.lastSync.at, t) : t("g.graph.never")}
                </Text>
              </View>
              {container.pendingRetry ? <Text style={{ color: C.warning, fontSize: 11, fontFamily: "Inter_600SemiBold" }}>{t("g.graph.pending")}</Text> : null}
            </View>
            {stats?.upstream ? (
              <View style={{ flexDirection: "row", gap: 16, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderColor: colors.border }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Feather name="arrow-up" size={14} color={colors.accent} />
                  <Text style={{ color: colors.foreground, fontSize: 12 }}>{t("g.graph.ahead")}: {stats.ahead}</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Feather name="arrow-down" size={14} color={colors.info} />
                  <Text style={{ color: colors.foreground, fontSize: 12 }}>{t("g.graph.behind")}: {stats.behind}</Text>
                </View>
              </View>
            ) : (
              <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 10 }}>{t("g.graph.noUpstream")}</Text>
            )}
            {container.lastSync?.error ? <Text style={{ color: colors.destructive, fontSize: 11, lineHeight: 16, marginTop: 10 }}>{container.lastSync.error}</Text> : null}
          </Card>

          <SectionTitle>{t("g.graph.branches")}</SectionTitle>
          <Card>
            {data.local.length ? data.local.map((branch, index) => (
              <Pressable accessibilityRole="button"
                key={branch.name}
                onPress={() => router.push({ pathname: "/repo/[id]/commits", params: { id, ref: `refs/heads/${branch.name}` } } as any)}
                style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 9, padding: 12, borderBottomWidth: index < data.local.length - 1 ? 1 : 0, borderColor: colors.border }, pressed && { backgroundColor: colors.secondary }]}
              >
                <Feather name={branch.current ? "git-branch" : "git-commit"} size={15} color={branch.current ? colors.accent : colors.mutedForeground} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: branch.current ? colors.accent : colors.foreground, fontSize: 12, fontFamily: "Inter_600SemiBold" }} numberOfLines={1}>{branch.name}</Text>
                  {branch.oid ? <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: MONO, marginTop: 3 }}>{branch.oid.slice(0, 10)}</Text> : null}
                </View>
                {branch.current ? <Text style={{ color: colors.accent, fontSize: 11, fontFamily: "Inter_700Bold" }}>{t("g.graph.current")}</Text> : null}
                <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
              </Pressable>
            )) : <Text style={{ color: colors.mutedForeground, padding: 13, fontSize: 12 }}>{t("g.graph.noBranches")}</Text>}
          </Card>

          <SectionTitle>{t("g.graph.remoteBranches")}</SectionTitle>
          <Card>
            {data.remote.length ? data.remote.map((branch, index) => (
              <View key={`${branch.remote}/${branch.name}`} style={{ flexDirection: "row", alignItems: "center", gap: 9, padding: 12, borderBottomWidth: index < data.remote.length - 1 ? 1 : 0, borderColor: colors.border }}>
                <Feather name="cloud" size={14} color={colors.mutedForeground} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>{branch.remote}/{branch.name}</Text>
                  {branch.oid ? <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: MONO, marginTop: 3 }}>{branch.oid.slice(0, 10)}</Text> : null}
                </View>
              </View>
            )) : <Text style={{ color: colors.mutedForeground, padding: 13, fontSize: 12 }}>{t("g.graph.noRemoteBranches")}</Text>}
          </Card>

          <SectionTitle right={<Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{t("g.graph.commitCount", { n: data.commits.length })}</Text>}>{t("g.graph.history")}</SectionTitle>
          <Card style={{ paddingVertical: 4 }}>
            <GitCommitGraph
              commits={data.commits}
              t={t}
              onCommitPress={(oid) => router.push({ pathname: "/repo/[id]/commit", params: { id, oid } } as any)}
            />
            {!data.commits.length ? (
              <Text style={{ color: colors.mutedForeground, padding: 16, fontSize: 12 }}>{t("g.graph.noCommits")}</Text>
            ) : null}
          </Card>
          <Pressable accessibilityRole="button"
            onPress={() => router.push({ pathname: "/repo/[id]/commits", params: { id } } as any)}
            style={{ alignSelf: "center", padding: 13, marginTop: 6 }}
          >
            <Text style={{ color: colors.accent, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>{t("g.graph.openHistory")} ›</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}
