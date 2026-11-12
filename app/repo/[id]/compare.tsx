import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { Card, describeError, MONO, ScreenHeader, SectionTitle } from "@/components/GitUi";
import { PickerModal } from "@/components/PickerModal";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import * as engine from "@/utils/git/engine";
import type { Change } from "@/utils/git/engine";

export default function CompareBranchesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const repos = useRepos();
  const [branches, setBranches] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [base, setBase] = useState<string | null>(null);
  const [head, setHead] = useState<string | null>(null);
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [oids, setOids] = useState<{ base: string; head: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerKind, setPickerKind] = useState<"base" | "head" | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");

  const loadBranches = useCallback(async () => {
    setLoading(true);
    try {
      const result = await repos.read(id, async (ctx) => ({ current: await engine.currentBranch(ctx.dir), branches: await engine.listLocalBranches(ctx.dir) }));
      setCurrent(result.current);
      setBranches(result.branches);
      const initialBase = base && result.branches.includes(base) ? base : result.branches.find((b) => b !== result.current) ?? result.current;
      const initialHead = head && result.branches.includes(head) ? head : result.current ?? result.branches[0] ?? null;
      setBase(initialBase ?? null);
      setHead(initialHead ?? null);
    } catch (e) {
      setError(describeError(e, t));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const compare = useCallback(async (a: string | null, b: string | null) => {
    if (!a || !b) return;
    if (a === b) {
      setError(t("g.compare.sameBranch"));
      setChanges([]);
      setOids(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await repos.read(id, async (ctx) => {
        const [aOid, bOid] = await Promise.all([engine.resolveOrNull(ctx.dir, `refs/heads/${a}`), engine.resolveOrNull(ctx.dir, `refs/heads/${b}`)]);
        if (!aOid || !bOid) throw engine.codeError("NotFoundError", undefined, { what: "branch" });
        const files = await engine.diffCommits(ctx.dir, aOid, bOid);
        return { aOid, bOid, files };
      });
      setOids({ base: result.aOid, head: result.bOid });
      setChanges(result.files);
    } catch (e) {
      setError(describeError(e, t));
      setChanges(null);
      setOids(null);
    } finally {
      setLoading(false);
    }
  }, [id, repos, t]);

  useFocusEffect(useCallback(() => { void loadBranches(); }, [loadBranches]));
  React.useEffect(() => {
    if (base && head) void compare(base, head);
  }, [base, head, compare]);

  function choose(which: "base" | "head") {
    setPickerSearch("");
    setPickerKind(which);
  }


  const counts = { added: changes?.filter((x) => x.kind === "added").length ?? 0, modified: changes?.filter((x) => x.kind === "modified").length ?? 0, deleted: changes?.filter((x) => x.kind === "deleted").length ?? 0 };
  const kindLabel = (kind: Change["kind"]) => kind === "added" ? t("g.compare.added") : kind === "deleted" ? t("g.compare.deleted") : t("g.compare.modified");
  const kindColor = (kind: Change["kind"]) => kind === "added" ? colors.success : kind === "deleted" ? colors.destructive : colors.warning;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppBackground />
      <ScreenHeader art="compare" title={t("g.compare.title")} subtitle={t("g.compare.subtitle")} />
      {loading && !branches.length ? <ActivityIndicator color={colors.accent} style={{ marginTop: 32 }} /> : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 30 }}>
          <Card>
            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: "Inter_700Bold", marginBottom: 8 }}>{t("g.compare.compareFrom")}</Text>
            <Pressable onPress={() => choose("base")} style={{ padding: 12, borderRadius: 10, backgroundColor: colors.secondary, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Feather name="git-branch" size={15} color={colors.accent} /><Text style={{ flex: 1, color: colors.foreground, fontFamily: MONO, fontSize: 13 }}>{base ?? "—"}</Text><Feather name="chevron-down" size={15} color={colors.mutedForeground} />
            </Pressable>
            <View style={{ alignItems: "center", paddingVertical: 5 }}><Feather name="arrow-down" size={16} color={colors.mutedForeground} /></View>
            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: "Inter_700Bold", marginBottom: 8 }}>{t("g.compare.compareInto")}</Text>
            <Pressable onPress={() => choose("head")} style={{ padding: 12, borderRadius: 10, backgroundColor: colors.secondary, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Feather name="git-branch" size={15} color={colors.accent} /><Text style={{ flex: 1, color: colors.foreground, fontFamily: MONO, fontSize: 13 }}>{head ?? "—"}</Text><Feather name="chevron-down" size={15} color={colors.mutedForeground} />
            </Pressable>
          </Card>
          <SectionTitle>{t("g.compare.files")}</SectionTitle>
          {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 20 }} /> : error ? <Text style={{ color: colors.destructive, padding: 14 }}>{error}</Text> : changes ? (
            <>
              <View style={{ flexDirection: "row", gap: 7, marginBottom: 10 }}>
                {([ ["+", counts.added, colors.success], ["~", counts.modified, colors.warning], ["−", counts.deleted, colors.destructive] ] as const).map(([symbol, count, color]) => <View key={symbol} style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}><Text style={{ color, fontSize: 16, fontFamily: MONO }}>{symbol} {count}</Text></View>)}
              </View>
              <Card>
                {changes.length ? changes.map((change, index) => (
                  <Pressable key={`${change.path}-${index}`} onPress={() => oids && router.push({ pathname: "/repo/[id]/diff", params: { id, path: change.path, from: change.a ? oids.base : "", to: change.b ? oids.head : "" } } as any)} style={{ flexDirection: "row", alignItems: "center", gap: 9, padding: 12, borderBottomWidth: index < changes.length - 1 ? 1 : 0, borderColor: colors.border }}>
                    <Feather name={change.kind === "added" ? "plus-circle" : change.kind === "deleted" ? "minus-circle" : "edit-3"} size={15} color={kindColor(change.kind)} />
                    <View style={{ flex: 1 }}><Text style={{ color: colors.foreground, fontSize: 12, fontFamily: MONO }} numberOfLines={2}>{change.path}</Text><Text style={{ color: kindColor(change.kind), fontSize: 10, marginTop: 3 }}>{kindLabel(change.kind)}</Text></View>
                    <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
                  </Pressable>
                )) : <Text style={{ color: colors.mutedForeground, padding: 14, textAlign: "center", fontSize: 12 }}>{t("g.compare.noChanges")}</Text>}
              </Card>
              <Text style={{ color: colors.mutedForeground, fontSize: 10, marginTop: 10, paddingHorizontal: 4 }}>{t("g.compare.hint")}</Text>
            </>
          ) : null}
        </ScrollView>
      )}
      <PickerModal
        visible={!!pickerKind}
        title={pickerKind === "base" ? t("g.compare.base") : t("g.compare.target")}
        items={branches.filter((name) => name.toLocaleLowerCase().includes(pickerSearch.trim().toLocaleLowerCase())).map((name) => ({ key: name, label: `${name}${name === current ? ` · ${t("g.compare.current")}` : ""}`, icon: "git-branch" as const, selected: name === (pickerKind === "base" ? base : head) }))}
        searchable
        searchValue={pickerSearch}
        onSearchChange={setPickerSearch}
        searchPlaceholder={t("g.branches.search")}
        emptyLabel={t("g.branches.noMatch")}
        onSelect={(name) => { if (pickerKind === "base") setBase(name); else setHead(name); setPickerKind(null); }}
        onClose={() => setPickerKind(null)}
      />
    </View>
  );
}
