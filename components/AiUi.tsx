import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { Btn, MONO } from "@/components/GitUi";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { aiErrorText } from "@/utils/ai/providers";
import { aiReady, loadAi, PROVIDERS, subscribeAi, type AiSettings } from "@/utils/ai/settings";
import { showAlert } from "@/utils/dialogs";
import type { DiffResult } from "@/utils/git/diff";

export function useAiSettings(): AiSettings | null {
  const [s, setS] = useState<AiSettings | null>(null);
  useEffect(() => {
    loadAi().then(setS);
    return subscribeAi((v) => setS({ ...v }));
  }, []);
  return s;
}

/** true si les fonctions IA doivent être affichées (activées ET configurées). */
export function useAiReady(): boolean {
  return aiReady(useAiSettings());
}

export function aiLabel(s: AiSettings | null): string {
  if (!s) return "";
  return `${PROVIDERS.find((p) => p.id === s.provider)?.label ?? s.provider} · ${s.models[s.provider]}`;
}

/**
 * Bouton ✦ d'auto-complétion « magique » : appelle run() et transmet le texte.
 * Invisible si l'IA est désactivée ou non configurée.
 */
export function AiButton({
  run,
  onResult,
  label,
  size = 18,
}: {
  run: (s: AiSettings) => Promise<string>;
  onResult: (text: string) => void;
  label?: string;
  size?: number;
}) {
  const { t } = useI18n();
  const s = useAiSettings();
  const [busy, setBusy] = useState(false);
  if (!aiReady(s)) return null;

  async function press() {
    if (!s || busy) return;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    try {
      const text = await run(s);
      if (text) onResult(text);
    } catch (e) {
      showAlert(t("ai.title"), aiErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable
      onPress={press}
      hitSlop={8}
      style={({ pressed }) => [
        { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: label ? 10 : 6, paddingVertical: 5, borderRadius: 14, borderWidth: label ? 1 : 0, borderColor: "#7c5cff" },
        pressed && { opacity: 0.6 },
      ]}
    >
      {busy ? <ActivityIndicator size="small" color="#a78bfa" /> : <Feather name="zap" size={size - 3} color="#a78bfa" />}
      {label ? <Text style={{ color: "#a78bfa", fontSize: 12, fontFamily: "Inter_600SemiBold" }}>{label}</Text> : null}
    </Pressable>
  );
}

export function DiffBlock({ diff, max = 300 }: { diff: DiffResult; max?: number }) {
  const colors = useColors();
  const { t } = useI18n();
  // Les gros diffs s'affichent par tranches : bien plus fluide qu'un rendu de plusieurs milliers de lignes.
  const [shown, setShown] = useState(Math.min(max, 150));
  const limit = Math.min(max, Math.max(shown, 0));
  const rows = diff.rows.slice(0, limit);
  return (
    <ScrollView horizontal style={{ backgroundColor: "#0b0b0b" }}>
      <View style={{ paddingVertical: 4 }}>
        {rows.map((r, i) =>
          r.kind === "hunk" ? (
            <Text key={i} style={{ color: "#79c0ff", backgroundColor: "#0d1d33", fontFamily: MONO, fontSize: 11, paddingHorizontal: 8, lineHeight: 16 }}>
              {r.text}
            </Text>
          ) : (
            <Text
              key={i}
              style={{
                color: r.t === 1 ? "#56d364" : r.t === -1 ? "#f85149" : colors.mutedForeground,
                backgroundColor: r.t === 1 ? "#0f2a17" : r.t === -1 ? "#2d1215" : "transparent",
                fontFamily: MONO,
                fontSize: 11,
                lineHeight: 16,
                paddingHorizontal: 8,
              }}
            >
              {r.t === 1 ? "+ " : r.t === -1 ? "− " : "  "}
              {r.text}
            </Text>
          )
        )}
        {diff.rows.length > limit ? (
          limit < max ? (
            <Pressable onPress={() => setShown(limit + 300)} style={{ padding: 10 }}>
              <Text style={{ color: "#a78bfa", fontSize: 12, fontFamily: "Inter_600SemiBold" }}>{t("ai.showMore", { n: Math.min(300, diff.rows.length - limit) })}</Text>
            </Pressable>
          ) : (
            <Text style={{ color: colors.mutedForeground, fontSize: 11, padding: 8 }}>… +{diff.rows.length - limit}</Text>
          )
        ) : null}
      </View>
    </ScrollView>
  );
}

/** Fenêtre plein écran : aperçu d'une modification proposée par l'IA. */
export function DiffApprovalModal({
  visible,
  title,
  diff,
  onAccept,
  onReject,
}: {
  visible: boolean;
  title: string;
  diff: DiffResult | null;
  onAccept: () => void;
  onReject: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onReject}>
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top + 8 }}>
        <AppBackground />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: 1, borderColor: colors.border }}>
          <Feather name="zap" size={18} color="#a78bfa" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: "Inter_700Bold" }} numberOfLines={1}>
              {title}
            </Text>
            {diff ? (
              <Text style={{ fontFamily: MONO, fontSize: 11 }}>
                <Text style={{ color: "#56d364" }}>+{diff.adds}</Text> <Text style={{ color: "#f85149" }}>−{diff.dels}</Text>
              </Text>
            ) : null}
          </View>
        </View>
        <ScrollView style={{ flex: 1 }}>
          {diff && diff.rows.length ? <DiffBlock diff={diff} max={2000} /> : <Text style={{ color: colors.mutedForeground, padding: 20 }}>{t("g.diff.same")}</Text>}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 8, padding: 12, paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderColor: colors.border }}>
          <Btn label={t("ai.reject")} icon="x" onPress={onReject} style={{ flex: 1 }} />
          <Btn label={t("ai.accept")} icon="check" variant="primary" onPress={onAccept} style={{ flex: 1 }} />
        </View>
      </View>
    </Modal>
  );
}
