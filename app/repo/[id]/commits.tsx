import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { describeError, Empty, MONO, ScreenHeader, timeAgo } from "@/components/GitUi";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import * as engine from "@/utils/git/engine";
import type { LogEntry } from "@/utils/git/engine";
import { C } from "@/constants/colors";

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
  const [query, setQuery] = useState("");
  const loadingMore = useRef(false);

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
      } finally {
        loadingMore.current = false;
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

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleLog = (log ?? []).filter((item) => {
    if (!normalizedQuery) return true;
    const author = item.commit.author;
    return [item.commit.message, author.name, author.email, item.oid]
      .some((value) => String(value ?? "").toLocaleLowerCase().includes(normalizedQuery));
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppBackground />
      <ScreenHeader title={t("g.nav.commits")} subtitle={ref || c.branch} />
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 12, minHeight: 44 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 16, marginRight: 8 }}>⌕</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher un commit, auteur ou SHA…"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={{ flex: 1, color: colors.foreground, fontSize: 13, paddingVertical: 9 }}
            accessibilityLabel="Rechercher dans l’historique des commits"
          />
          {!!query && <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Effacer la recherche"><Text style={{ color: colors.mutedForeground, fontSize: 18 }}>×</Text></Pressable>}
        </View>
        {log !== null ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 8 }}>
            {visibleLog.length === log.length ? `${log.length} commit${log.length > 1 ? "s" : ""} chargé${log.length > 1 ? "s" : ""}` : `${visibleLog.length} résultat${visibleLog.length > 1 ? "s" : ""} sur ${log.length} commits chargés`}
          </Text>
        ) : null}
      </View>
      {log === null ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} />
      ) : (
        <FlatList
          initialNumToRender={12}
          windowSize={7}
          maxToRenderPerBatch={10}
          data={visibleLog}
          keyExtractor={(x) => x.oid}
          contentContainerStyle={{ paddingBottom: insets.bottom + 30, flexGrow: visibleLog.length === 0 ? 1 : 0 }}
          ListEmptyComponent={<Empty icon="git-commit" art="history" text={normalizedQuery ? "Aucun commit ne correspond à cette recherche." : error ?? t("home.noCommits")} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (end || normalizedQuery || loadingMore.current) return;
            loadingMore.current = true;
            const d = depth + PAGE;
            setDepth(d);
            void load(d);
          }}
          ListFooterComponent={!end && log.length && !normalizedQuery ? <ActivityIndicator color={colors.accent} style={{ padding: 16 }} /> : null}
          renderItem={({ item, index }) => {
            const a = item.commit.author;
            const merge = item.commit.parent.length > 1;
            return (
              <Pressable
                onPress={() => router.push({ pathname: "/repo/[id]/commit", params: { id, oid: item.oid } } as any)}
                accessibilityRole="button"
                accessibilityLabel={`Commit ${item.oid.slice(0, 7)} : ${item.commit.message.split("\n")[0]}`}
                style={({ pressed }) => [
                  { flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 15, paddingVertical: 14, borderBottomWidth: 1, borderColor: colors.border },
                  pressed && { backgroundColor: colors.secondary },
                ]}
              >
                <View style={{ width: 18, alignItems: "center", alignSelf: "stretch", justifyContent: "center" }}>
                  <View style={{ position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: colors.border }} />
                  <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: merge ? C.violet : colors.green, backgroundColor: colors.background }} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: "Inter_500Medium" }} numberOfLines={2}>
                    {item.commit.message.split("\n")[0]}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 4 }} numberOfLines={1}>
                    {a.name} · {timeAgo(a.timestamp * 1000, t)}
                  </Text>
                  {merge ? <View style={{ alignSelf: "flex-start", marginTop: 5, backgroundColor: `${C.violet}18`, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}><Text style={{ color: C.violet, fontSize: 9, fontFamily: "Inter_600SemiBold" }}>MERGE · {item.commit.parent.length} parents</Text></View> : null}
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Text style={{ color: colors.accent, fontSize: 11, fontFamily: MONO, backgroundColor: colors.greenBg, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 5 }}>
                    {item.oid.slice(0, 7)}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 9 }}>#{index + 1}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
