import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { Btn, describeError, ScreenHeader } from "@/components/GitUi";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import { syncIntentDecision } from "@/utils/git/securityPure";
import type { SyncReason } from "@/utils/git/store";
import { getSyncKey } from "@/utils/native";

type Line = { name: string; state: "wait" | "run" | "ok" | "err"; text?: string };

/**
 * Point d'entrée de l'intent personnalisé :
 *   gitcrush://sync              → synchronise tous les dépôts
 *   gitcrush://sync?repo=<id|nom> → synchronise un dépôt
 * Paramètres : repo = identifiants ou noms séparés par des virgules ; reason = tile | widget | watch ;
 * close=1 → l'app se referme toute seule quand tout s'est bien passé.
 * Utilisable depuis la tuile, le widget, le service d'accessibilité, Tasker / MacroDroid
 * (action VIEW + données = URL), un raccourci, une autre app ou un lien.
 */
export default function SyncIntentScreen() {
  const { repo, reason, close, key } = useLocalSearchParams<{ repo?: string; reason?: string; close?: string; key?: string }>();
  // AUDIT-003 : sans la clé de cette installation, le lien vient d'une autre application ou
  // d'une page web → rien n'est commité ni poussé sans confirmation explicite.
  const [trusted] = useState(() => syncIntentDecision(key, getSyncKey()) === "run");
  const [confirmed, setConfirmed] = useState(trusted);
  const syncReason: SyncReason = trusted && (reason === "tile" || reason === "widget" || reason === "watch") ? reason : "intent";
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { containers, ready, sync } = useRepos();
  const [lines, setLines] = useState<Line[]>([]);
  const [done, setDone] = useState(false);
  const started = useRef(false);

  const keys = (repo ?? "")
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  const targets = keys.length ? containers.filter((c) => keys.includes(c.id.toLowerCase()) || keys.includes(c.name.toLowerCase())) : containers;

  useEffect(() => {
    if (!ready || !confirmed || started.current) return;
    started.current = true;
    if (!targets.length) {
      setLines([{ name: repo || "—", state: "err", text: t("g.err.containerNotFound") }]);
      setDone(true);
      return;
    }
    setLines(targets.map((c) => ({ name: c.name, state: "wait" })));
    (async () => {
      for (let i = 0; i < targets.length; i++) {
        const c = targets[i];
        setLines((l) => l.map((x, j) => (j === i ? { ...x, state: "run" } : x)));
        try {
          if (c.merge) throw Object.assign(new Error(), { code: "MergePending" });
          const s = await sync(c.id, syncReason);
          const parts = [
            s.committed ? t("g.sync.committed", { n: s.committed }) : "",
            s.pulled === "fastforward" || s.pulled === "merged" ? t(`g.sync.pulled.${s.pulled}`) : "",
            s.pushed ? t("g.sync.pushed") : "",
          ].filter(Boolean);
          setLines((l) =>
            l.map((x, j) =>
              j === i
                ? { ...x, state: s.pulled === "conflict" ? "err" : "ok", text: s.pulled === "conflict" ? t("g.repos.conflicts", { n: s.conflicts.length }) : parts.join(" · ") || t("g.sync.nothing") }
                : x
            )
          );
        } catch (e) {
          setLines((l) => l.map((x, j) => (j === i ? { ...x, state: "err", text: describeError(e, t) } : x)));
        }
      }
      setDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, confirmed]);

  // close=1 : on referme l'application 1,5 s après une synchro entièrement réussie
  // (seulement pour les liens internes : un lien externe confirmé laisse l'app ouverte).
  useEffect(() => {
    if (!done || close !== "1" || !trusted || !lines.length || lines.some((l) => l.state === "err")) return;
    const timer = setTimeout(() => BackHandler.exitApp(), 1500);
    return () => clearTimeout(timer);
  }, [done, close, lines]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppBackground />
      <ScreenHeader art="sync" title={t("g.intent.title")} onBack={() => router.replace("/(tabs)/repos" as any)} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 30, gap: 12 }}>
        {!ready ? <ActivityIndicator color={colors.accent} /> : null}
        {ready && !confirmed ? (
          <View style={{ gap: 10 }}>
            <Text style={{ color: colors.foreground, fontSize: 16, fontFamily: "Inter_600SemiBold" }}>{t("g.intent.confirmTitle")}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 19 }}>{t("g.intent.confirmBody")}</Text>
            {(targets.length ? targets.map((c) => c.name) : [repo || "—"]).map((name, i) => (
              <Text key={i} style={{ color: colors.foreground, fontSize: 14 }}>
                • {name}
              </Text>
            ))}
            {targets.length ? <Btn label={t("g.intent.run")} icon="refresh-cw" variant="primary" onPress={() => setConfirmed(true)} /> : null}
            <Btn label={t("msg.cancel")} onPress={() => router.replace("/(tabs)/repos" as any)} />
          </View>
        ) : null}
        {lines.map((l, i) => (
          <View key={i} style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
            {l.state === "run" ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Feather
                name={l.state === "ok" ? "check-circle" : l.state === "err" ? "x-circle" : "clock"}
                size={18}
                color={l.state === "ok" ? colors.accent : l.state === "err" ? colors.destructive : colors.mutedForeground}
              />
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_600SemiBold" }}>{l.name}</Text>
              {l.text ? <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}>{l.text}</Text> : null}
            </View>
          </View>
        ))}
        {done ? <Btn label={t("g.common.close")} variant="primary" onPress={() => router.replace("/(tabs)/repos" as any)} style={{ marginTop: 10 }} /> : null}
      </ScrollView>
    </View>
  );
}
