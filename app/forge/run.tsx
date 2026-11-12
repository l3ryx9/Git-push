import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { forgeErrorText, runColor, runIcon, useForgeRef } from "@/components/ForgeUi";
import { Btn, Card, IconBtn, ScreenHeader, SectionTitle, timeAgo } from "@/components/GitUi";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { showAlert } from "@/utils/dialogs";
import { cancelRun, getRun, listJobs, rerunRun, type Job, type Run } from "@/utils/forge";

function duration(a?: string, b?: string): string {
  if (!a) return "";
  const ms = (b ? new Date(b).getTime() : Date.now()) - new Date(a).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

export default function RunScreen() {
  const ref = useForgeRef();
  const id = Number(ref.raw.run);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [run, setRun] = useState<Run | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, j] = await Promise.all([getRun(ref, id), listJobs(ref, id)]);
      setRun(r);
      setJobs(j);
      setError(null);
    } catch (e) {
      setError(forgeErrorText(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(fn: () => Promise<void>, msg: string) {
    setBusy(true);
    try {
      await fn();
      showAlert("GitHub Actions", msg);
      await load();
    } catch (e) {
      showAlert("GitHub Actions", forgeErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  const running = run && run.status !== "completed";
  const failed = run && run.status === "completed" && run.conclusion !== "success";

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppBackground />
      <ScreenHeader art="forge"
        title={run ? `${run.workflow} #${run.number}` : "GitHub Actions"}
        subtitle={ref.project}
        right={run ? <IconBtn icon="external-link" onPress={() => WebBrowser.openBrowserAsync(run.url).catch(() => undefined)} /> : null}
      />
      {error ? (
        <Text style={{ color: colors.destructive, padding: 20 }}>{error}</Text>
      ) : !run ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 30 }}>
          <Card style={{ padding: 14, gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Feather name={runIcon(run.status, run.conclusion)} size={18} color={runColor(run.status, run.conclusion, colors)} />
              <Text style={{ flex: 1, color: colors.foreground, fontSize: 14, fontFamily: "Inter_600SemiBold" }}>{run.title}</Text>
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
              {t(`f.run.${run.status === "completed" ? run.conclusion ?? "completed" : run.status}`)} · {run.branch} · {run.event}
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
              {run.actor} · {timeAgo(new Date(run.createdAt).getTime(), t)}
            </Text>
          </Card>

          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            {running ? (
              <Btn label={t("f.run.cancel")} icon="slash" variant="danger" onPress={() => act(() => cancelRun(ref, id), t("f.run.cancelRequested"))} loading={busy} style={{ flex: 1 }} />
            ) : (
              <>
                <Btn label={t("f.run.rerun")} icon="refresh-cw" onPress={() => act(() => rerunRun(ref, id, false), t("f.run.rerunDone"))} loading={busy} style={{ flex: 1 }} />
                {failed ? (
                  <Btn label={t("f.run.rerunFailed")} icon="rotate-ccw" onPress={() => act(() => rerunRun(ref, id, true), t("f.run.rerunDone"))} disabled={busy} style={{ flex: 1 }} />
                ) : null}
              </>
            )}
          </View>

          <SectionTitle>{t("f.run.jobs", { n: jobs.length })}</SectionTitle>
          {jobs.map((j) => (
            <Card key={j.id} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderBottomWidth: j.steps.length ? 1 : 0, borderColor: colors.border }}>
                <Feather name={runIcon(j.status, j.conclusion)} size={15} color={runColor(j.status, j.conclusion, colors)} />
                <Text style={{ flex: 1, color: colors.foreground, fontSize: 13, fontFamily: "Inter_600SemiBold" }}>{j.name}</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{duration(j.startedAt, j.completedAt)}</Text>
              </View>
              {j.steps.map((s) => (
                <View key={s.number} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 7 }}>
                  <Feather name={runIcon(s.status, s.conclusion)} size={12} color={runColor(s.status, s.conclusion, colors)} />
                  <Text style={{ flex: 1, color: colors.mutedForeground, fontSize: 12 }} numberOfLines={1}>
                    {s.name}
                  </Text>
                </View>
              ))}
            </Card>
          ))}
          <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 4 }}>{t("f.run.logsHint")}</Text>
        </ScrollView>
      )}
    </View>
  );
}
