import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { ForgeRef, Kind } from "@/utils/forge";
import { C } from "@/constants/colors";

type T = (key: string, vars?: Record<string, string | number>) => string;

export function useForgeRef(): ForgeRef & { raw: Record<string, string | undefined> } {
  // Paramètres de route non typés (string | string[]) ramenés à une seule valeur texte :
  // le générique précédent ne respectait pas la contrainte d'expo-router (typecheck CI).
  const params = useLocalSearchParams();
  const raw: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(params)) raw[k] = Array.isArray(v) ? v[0] : v;
  return {
    provider: raw.provider === "gitlab" ? "gitlab" : "github",
    project: raw.project ?? "",
    accountId: raw.accountId || undefined,
    raw,
  };
}

export function forgeParams(ref: ForgeRef, extra: Record<string, string | number> = {}) {
  const out: Record<string, string> = { provider: ref.provider, project: ref.project };
  if (ref.accountId) out.accountId = ref.accountId;
  for (const [k, v] of Object.entries(extra)) out[k] = String(v);
  return out;
}

export function goForge(screen: "list" | "item" | "new" | "actions" | "run", ref: ForgeRef, extra: Record<string, string | number> = {}) {
  router.push({ pathname: `/forge/${screen}`, params: forgeParams(ref, extra) } as any);
}

export function kindLabel(kind: Kind, ref: ForgeRef, t: T) {
  if (kind === "issues") return t("f.issues");
  return ref.provider === "gitlab" ? t("f.mrs") : t("f.prs");
}

export function StateBadge({ state, draft, t }: { state: "open" | "closed" | "merged"; draft?: boolean; t: T }) {
  const colors = useColors();
  const map = {
    open: { c: colors.accent, i: "circle" as const },
    closed: { c: colors.destructive, i: "x-circle" as const },
    merged: { c: C.violet, i: "git-merge" as const },
  };
  const m = map[state];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, borderWidth: 1, borderColor: m.c }}>
      <Feather name={m.i} size={10} color={m.c} />
      <Text style={{ color: m.c, fontSize: 11, fontFamily: "Inter_600SemiBold" }}>{draft && state === "open" ? t("f.state.draft") : t(`f.state.${state}`)}</Text>
    </View>
  );
}

export function runColor(status: string, conclusion: string | null, colors: ReturnType<typeof useColors>) {
  if (status !== "completed") return C.warning;
  if (conclusion === "success") return colors.accent;
  if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "startup_failure") return colors.destructive;
  return colors.mutedForeground;
}

export function runIcon(status: string, conclusion: string | null): React.ComponentProps<typeof Feather>["name"] {
  if (status !== "completed") return status === "in_progress" ? "loader" : "clock";
  if (conclusion === "success") return "check-circle";
  if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "startup_failure") return "x-circle";
  if (conclusion === "cancelled") return "slash";
  return "minus-circle";
}

/** Affichage coloré d'un patch unifié (diff fourni par l'API). */
export function PatchView({ patch }: { patch: string }) {
  const colors = useColors();
  const lines = patch.split("\n").slice(0, 400);
  return (
    <View style={{ paddingVertical: 4 }}>
      {lines.map((l, i) => {
        const c = l.startsWith("+") ? C.diffAdd : l.startsWith("-") ? C.diffDel : l.startsWith("@@") ? C.info : colors.foreground;
        const bg = l.startsWith("+") ? "#0f2a17" : l.startsWith("-") ? "#2d1215" : l.startsWith("@@") ? "#0d1d33" : "transparent";
        return (
          <Text key={i} style={{ color: c, backgroundColor: bg, fontFamily: "monospace", fontSize: 11, lineHeight: 16, paddingHorizontal: 8 }}>
            {l || " "}
          </Text>
        );
      })}
    </View>
  );
}

export function forgeErrorText(e: any, t: T): string {
  const s = Number(e?.data?.statusCode);
  if (s === 401) return t("f.err.auth");
  if (s === 403) return `${t("f.err.forbidden")}\n${e?.message ?? ""}`;
  if (s === 404) return t("f.err.notFound");
  if (s === 410) return t("f.err.disabled");
  return String(e?.message ?? e);
}
