import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { forgeErrorText, goForge, runColor, runIcon, useForgeRef } from "@/components/ForgeUi";
import { Empty, ScreenHeader, timeAgo } from "@/components/GitUi";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { listRuns, type Run } from "@/utils/forge";

export default function ActionsScreen() {
  const ref = useForgeRef();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setRuns(await listRuns(ref, 1));
      setError(null);
    } catch (e) {
      setError(forgeErrorText(e, t));
      setRuns([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.project]);

  useFocusEffect(
    useCallback(() => {
      void load();
      // Actualisation automatique tant que des exécutions sont en cours.
      const timer = setInterval(() => void load(), 15000);
      return () => clearInterval(timer);
    }, [load])
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppBackground />
      <ScreenHeader art="forge" title="GitHub Actions" subtitle={ref.project} />
      {runs === null ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} />
      ) : (
        <FlatList
          data={runs}
          keyExtractor={(r) => String(r.id)}
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}
          ListEmptyComponent={<Empty icon="play-circle" text={error ?? t("f.actions.empty")} />}
          renderItem={({ item: r }) => (
            <Pressable
              onPress={() => goForge("run", ref, { run: r.id })}
              style={({ pressed }) => [
                { flexDirection: "row", gap: 12, padding: 13, borderBottomWidth: 1, borderColor: colors.border },
                pressed && { backgroundColor: colors.secondary },
              ]}
            >
              <Feather name={runIcon(r.status, r.conclusion)} size={18} color={runColor(r.status, r.conclusion, colors)} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: "Inter_600SemiBold" }} numberOfLines={2}>
                  {r.title}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 3 }} numberOfLines={1}>
                  {r.workflow} #{r.number} · {r.branch} · {r.event}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
                  {r.actor} · {timeAgo(new Date(r.createdAt).getTime(), t)}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
