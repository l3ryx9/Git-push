import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { IconBtn, MONO, ScreenHeader, describeError } from "@/components/GitUi";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import { isBinary, unifiedDiff, type DiffResult } from "@/utils/git/diff";
import * as engine from "@/utils/git/engine";
import { decodeUtf8 } from "@/utils/git/fs";

/** Diff d'un fichier entre deux révisions : oid de commit, « HEAD », « WORKDIR » ou vide (= absent). */
export default function DiffScreen() {
  const { id, path = "", from = "", to = "" } = useLocalSearchParams<{ id: string; path: string; from?: string; to?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const repos = useRepos();
  const [full, setFull] = useState(false);
  const [texts, setTexts] = useState<{ a: string; b: string } | null>(null);
  const [binary, setBinary] = useState(false);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [a, b] = await repos.read(id, (ctx) => Promise.all([engine.fileAt(ctx.dir, from, path), engine.fileAt(ctx.dir, to, path)]));
        if ((a && isBinary(a)) || (b && isBinary(b))) {
          setBinary(true);
          return;
        }
        setTexts({ a: a ? decodeUtf8(a) : "", b: b ? decodeUtf8(b) : "" });
      } catch (e) {
        setError(describeError(e, t));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, path, from, to]);

  useEffect(() => {
    if (texts) setDiff(unifiedDiff(texts.a, texts.b, full));
  }, [texts, full]);

  const name = path.split("/").pop() ?? path;
  const sub = diff ? `+${diff.adds}  −${diff.dels}  ·  ${path}` : path;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppBackground />
      <ScreenHeader title={name} subtitle={sub} right={<IconBtn icon={full ? "minimize-2" : "maximize-2"} onPress={() => setFull((v) => !v)} />} />
      {error ? (
        <Text style={{ color: colors.destructive, padding: 20 }}>{error}</Text>
      ) : binary ? (
        <Text style={{ color: colors.mutedForeground, padding: 20, textAlign: "center" }}>{t("g.diff.binary")}</Text>
      ) : !diff ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} />
      ) : diff.rows.length === 0 ? (
        <Text style={{ color: colors.mutedForeground, padding: 20, textAlign: "center" }}>{t("g.diff.same")}</Text>
      ) : (
        <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ minWidth: "100%" }}>
          <FlatList
            style={{ flex: 1 }}
            data={diff.rows}
            keyExtractor={(_, i) => String(i)}
            initialNumToRender={80}
            contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}
            renderItem={({ item }) =>
              item.kind === "hunk" ? (
                <Text style={{ color: "#79c0ff", backgroundColor: "#0d1d33", fontFamily: MONO, fontSize: 12, paddingVertical: 4, paddingHorizontal: 8 }}>
                  {item.text}
                </Text>
              ) : (
                <View
                  style={{
                    flexDirection: "row",
                    backgroundColor: item.t === 1 ? "#0f2a17" : item.t === -1 ? "#2d1215" : "transparent",
                  }}
                >
                  <Text style={{ width: 40, textAlign: "right", color: colors.mutedForeground, fontFamily: MONO, fontSize: 11, lineHeight: 18 }}>
                    {item.a ?? ""}
                  </Text>
                  <Text style={{ width: 40, textAlign: "right", color: colors.mutedForeground, fontFamily: MONO, fontSize: 11, lineHeight: 18 }}>
                    {item.b ?? ""}
                  </Text>
                  <Text
                    style={{
                      color: item.t === 1 ? "#56d364" : item.t === -1 ? "#f85149" : colors.foreground,
                      fontFamily: MONO,
                      fontSize: 12,
                      lineHeight: 18,
                      paddingLeft: 8,
                      paddingRight: 16,
                    }}
                  >
                    {item.t === 1 ? "+ " : item.t === -1 ? "− " : "  "}
                    {item.text}
                  </Text>
                </View>
              )
            }
          />
        </ScrollView>
      )}
    </View>
  );
}
