import { useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { forgeErrorText, goForge, kindLabel, StateBadge, useForgeRef } from "@/components/ForgeUi";
import { Empty, IconBtn, ScreenHeader, Segmented, timeAgo } from "@/components/GitUi";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { listItems, type Item, type Kind, type State } from "@/utils/forge";

export default function ForgeListScreen() {
  const ref = useForgeRef();
  const kind: Kind = ref.raw.kind === "pulls" ? "pulls" : "issues";
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [state, setState] = useState<State>("open");
  const [items, setItems] = useState<Item[] | null>(null);
  const [page, setPage] = useState(1);
  const [end, setEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (st: State, p: number) => {
      try {
        const list = await listItems(ref, kind, st, p);
        setItems((cur) => (p === 1 ? list : [...(cur ?? []), ...list]));
        setEnd(list.length < 30 && !(kind === "issues" && ref.provider === "github" && list.length > 0));
        setError(null);
      } catch (e) {
        setError(forgeErrorText(e, t));
        if (p === 1) setItems([]);
        setEnd(true);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ref.provider, ref.project, ref.accountId, kind]
  );

  useFocusEffect(
    useCallback(() => {
      setPage(1);
      void load(state, 1);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, state])
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppBackground />
      <ScreenHeader art="forge"
        title={kindLabel(kind, ref, t)}
        subtitle={ref.project}
        right={<IconBtn icon="plus" label={t("a11y.create")} onPress={() => goForge("new", ref, { kind })} />}
      />
      <View style={{ paddingHorizontal: 12, paddingTop: 12 }}>
        <Segmented
          value={state}
          onChange={(v) => {
            setItems(null);
            setState(v);
          }}
          options={[
            { value: "open", label: t("f.filter.open") },
            { value: "closed", label: t("f.filter.closed") },
            { value: "all", label: t("f.filter.all") },
          ]}
        />
      </View>
      {items === null ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(x) => String(x.number)}
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            setPage(1);
            await load(state, 1);
            setRefreshing(false);
          }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}
          ListEmptyComponent={<Empty icon={kind === "issues" ? "alert-circle" : "git-pull-request"} text={error ?? t("f.empty")} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (end || !items.length) return;
            const p = page + 1;
            setPage(p);
            void load(state, p);
          }}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button"
              onPress={() => goForge("item", ref, { kind, number: item.number })}
              style={({ pressed }) => [
                { padding: 13, borderBottomWidth: 1, borderColor: colors.border, gap: 6 },
                pressed && { backgroundColor: colors.secondary },
              ]}
            >
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                <Text style={{ flex: 1, color: colors.foreground, fontSize: 14, fontFamily: "Inter_600SemiBold" }} numberOfLines={2}>
                  {item.title}
                </Text>
                <StateBadge state={item.state} draft={item.draft} t={t} />
              </View>
              <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
                #{item.number} · {item.author} · {timeAgo(new Date(item.createdAt).getTime(), t)}
                {item.comments ? ` · 💬 ${item.comments}` : ""}
              </Text>
              {item.labels.length ? (
                <Text style={{ color: colors.accent, fontSize: 11 }} numberOfLines={1}>
                  {item.labels.join(" · ")}
                </Text>
              ) : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
