import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { describeError, Empty, MONO, ScreenHeader, timeAgo } from "@/components/GitUi";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import * as engine from "@/utils/git/engine";
import type { LogEntry } from "@/utils/git/engine";

const PAGE = 40;

export default function CommitsScreen() {
  const { id, ref } = useLocalSearchParams<{ id: string; ref?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const repos = useRepos();
  const c = repos.get(id);
  const [log, setLog] = useState<LogEntry[] | null>(null);
  const [depth, setDepth] = useState(PAGE);
  const [end, setEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (d: number) => {
      try {
        const list = await repos.read(id, (ctx) => engine.getLog(ctx.dir, ref || "HEAD", d));
        setLog(list);
        setEnd(list.length < d);
        setError(null);
      } catch (e) {
        setError(describeError(e, t));
        setLog([]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, ref]
  );

  useFocusEffect(
    useCallback(() => {
      void load(depth);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load])
  );

  if (!c) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppBackground />
      <ScreenHeader title={t("g.nav.commits")} subtitle={ref || c.branch} />
      {log === null ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} />
      ) : (
        <FlatList
          initialNumToRender={12}
          windowSize={7}
          maxToRenderPerBatch={10}
          data={log}
          keyExtractor={(x) => x.oid}
          contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}
          ListEmptyComponent={<Empty icon="git-commit" text={error ?? t("home.noCommits")} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (end) return;
            const d = depth + PAGE;
            setDepth(d);
            void load(d);
          }}
          ListFooterComponent={!end && log.length ? <ActivityIndicator color={colors.accent} style={{ padding: 16 }} /> : null}
          renderItem={({ item }) => {
            const a = item.commit.author;
            const merge = item.commit.parent.length > 1;
            return (
              <Pressable
                onPress={() => router.push({ pathname: "/repo/[id]/commit", params: { id, oid: item.oid } } as any)}
                style={({ pressed }) => [
                  { flexDirection: "row", alignItems: "center", gap: 10, padding: 13, borderBottomWidth: 1, borderColor: colors.border },
                  pressed && { backgroundColor: colors.secondary },
                ]}
              >
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: merge ? "#a371f7" : colors.green }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: "Inter_500Medium" }} numberOfLines={1}>
                    {item.commit.message.split("\n")[0]}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 2 }}>
                    {a.name} · {timeAgo(a.timestamp * 1000, t)}
                  </Text>
                </View>
                <Text style={{ color: colors.accent, fontSize: 11, fontFamily: MONO, backgroundColor: colors.greenBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                  {item.oid.slice(0, 7)}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
