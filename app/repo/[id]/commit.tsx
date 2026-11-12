import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { Card, describeError, MONO, ScreenHeader, SectionTitle } from "@/components/GitUi";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import * as engine from "@/utils/git/engine";
import type { Change } from "@/utils/git/engine";
import { C } from "@/constants/colors";

type Info = Awaited<ReturnType<typeof engine.readCommit>>;

export default function CommitScreen() {
  const { id, oid } = useLocalSearchParams<{ id: string; oid: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const repos = useRepos();
  const [info, setInfo] = useState<Info | null>(null);
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await repos.read(id, async (ctx) => {
          const ci = await engine.readCommit(ctx.dir, oid);
          const ch = await engine.diffCommits(ctx.dir, ci.commit.parent[0] ?? null, oid);
          return { ci, ch };
        });
        setInfo(res.ci);
        setChanges(res.ch.sort((a, b) => a.path.localeCompare(b.path)));
      } catch (e) {
        setError(describeError(e, t));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, oid]);

  const color = (k: Change["kind"]) => (k === "added" ? colors.accent : k === "deleted" ? colors.destructive : C.warning);
  const icon = (k: Change["kind"]) => (k === "added" ? "plus-circle" : k === "deleted" ? "minus-circle" : "edit-3");

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppBackground />
      <ScreenHeader art="commit" title={t("g.commit.details")} subtitle={oid?.slice(0, 12)} />
      {error ? (
        <Text style={{ color: colors.destructive, padding: 20 }}>{error}</Text>
      ) : !info ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 30 }}>
          <Card style={{ padding: 14 }}>
            <Text selectable style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 20 }}>
              {info.commit.message.trim()}
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 10 }}>
              {info.commit.author.name} &lt;{info.commit.author.email}&gt;
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}>
              {new Date(info.commit.author.timestamp * 1000).toLocaleString()}
            </Text>
            <Text selectable style={{ color: colors.accent, fontSize: 11, fontFamily: MONO, marginTop: 8 }}>
              {info.oid}
            </Text>
            {info.commit.parent.map((p) => (
              <Pressable accessibilityRole="button" key={p} onPress={() => router.push({ pathname: "/repo/[id]/commit", params: { id, oid: p } } as any)}>
                <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: MONO, marginTop: 3 }}>
                  {t("g.commit.parent")} {p.slice(0, 12)} ›
                </Text>
              </Pressable>
            ))}
          </Card>
          <SectionTitle>{t("g.commit.files", { n: changes?.length ?? 0 })}</SectionTitle>
          <Card>
            {(changes ?? []).map((ch, i, arr) => (
              <Pressable accessibilityRole="button"
                key={ch.path}
                onPress={() =>
                  router.push({
                    pathname: "/repo/[id]/diff",
                    params: { id, path: ch.path, from: ch.a ? info.commit.parent[0] ?? "" : "", to: ch.b ? oid : "" },
                  } as any)
                }
                style={({ pressed }) => [
                  { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
                  i < arr.length - 1 && { borderBottomWidth: 1, borderColor: colors.border },
                  pressed && { backgroundColor: colors.secondary },
                ]}
              >
                <Feather name={icon(ch.kind)} size={14} color={color(ch.kind)} />
                <Text style={{ flex: 1, color: colors.foreground, fontFamily: MONO, fontSize: 12 }} numberOfLines={1} ellipsizeMode="head">
                  {ch.path}
                </Text>
                <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
              </Pressable>
            ))}
            {changes && !changes.length ? <Text style={{ color: colors.mutedForeground, padding: 14 }}>{t("g.commit.noFiles")}</Text> : null}
          </Card>
        </ScrollView>
      )}
    </View>
  );
}
