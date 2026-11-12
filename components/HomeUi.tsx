import { Feather, Octicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Illustration, illustrationColor, type IllustrationKind } from "@/components/Illustration";
import { FavoriteButton } from "@/components/FavoriteButton";
import { PressableScale, syncSummaryText, timeAgo } from "@/components/GitUi";
import { withAlpha } from "@/constants/colors";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { syncState, type SyncState } from "@/utils/homePure";
import type { Container } from "@/utils/git/store";

/** Titre de section de l'accueil, avec action optionnelle à droite. */
export function HomeSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={{ marginTop: 28 }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12, paddingHorizontal: 2 }}>
        <Text
          accessibilityRole="header"
          style={{ flex: 1, fontSize: 19, color: colors.foreground, fontFamily: "Inter_700Bold", letterSpacing: -0.3 }}
        >
          {title}
        </Text>
        {action ? (
          <Pressable
            accessibilityRole="button"
            onPress={action.onPress}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 6 }}
            style={{ minHeight: 32, justifyContent: "center" }}
          >
            <Text style={{ fontSize: 13, color: colors.accent, fontFamily: "Inter_600SemiBold" }}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/**
 * Grande carte de raccourci : illustration, titre court, petite description.
 * Toute la carte est cliquable (≥ 148 px de haut, bien au-delà des 48 px recommandés).
 */
export function ShortcutCard({
  kind,
  title,
  sub,
  badge,
  width,
  dimmed,
  onPress,
}: {
  kind: IllustrationKind;
  title: string;
  sub: string;
  /** Petite pastille (ex. nombre de conflits). */
  badge?: string;
  width: number;
  /** Visuellement atténuée (aucun dépôt) mais toujours cliquable : elle guide vers le clonage. */
  dimmed?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const tint = illustrationColor(kind, colors);
  return (
    <PressableScale
      haptic
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${title}, ${badge}. ${sub}` : `${title}. ${sub}`}
      style={{ width }}
      contentStyle={({ pressed }) => [
        {
          minHeight: 148,
          borderRadius: 22,
          padding: 14,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: pressed ? withAlpha(tint, 0.6) : colors.border,
          opacity: dimmed ? 0.72 : 1,
        },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
        <View
          style={{
            width: 68,
            height: 68,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: withAlpha(tint, 0.14),
          }}
        >
          <Illustration kind={kind} size={54} />
        </View>
        {badge ? (
          <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: withAlpha(tint, 0.18) }}>
            <Text style={{ fontSize: 11.5, color: tint, fontFamily: "Inter_700Bold" }}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={2} style={{ marginTop: 12, fontSize: 15.5, color: colors.foreground, fontFamily: "Inter_700Bold", letterSpacing: -0.2 }}>
        {title}
      </Text>
      <Text numberOfLines={2} style={{ marginTop: 2, fontSize: 12.5, lineHeight: 17, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
        {sub}
      </Text>
    </PressableScale>
  );
}

/** Couleur du point d'état selon la synchronisation réelle du dépôt. */
export function stateColor(state: SyncState, colors: ReturnType<typeof useColors>): string {
  switch (state) {
    case "ok":
      return colors.accent;
    case "conflict":
    case "failed":
      return colors.destructive;
    case "waiting":
      return colors.warning;
    default:
      return colors.mutedForeground;
  }
}

function StatusLine({ c }: { c: Container }) {
  const colors = useColors();
  const { t } = useI18n();
  const st = syncState(c);
  const col = stateColor(st, colors);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginTop: 8 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: col }} />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: st === "ok" || st === "never" ? colors.mutedForeground : col, fontFamily: "Inter_500Medium" }}>
        {syncSummaryText(c, t)}
      </Text>
    </View>
  );
}

/** Carte d'un dépôt favori : nom, branche active, état de synchronisation, accès direct. */
export function FavoriteCard({
  repo,
  width,
  onOpen,
  onToggleFavorite,
}: {
  repo: Container;
  width: number;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  const colors = useColors();
  const { t } = useI18n();
  return (
    <PressableScale
      haptic
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={t("hm.fav.open", { name: repo.name })}
      style={{ width }}
      contentStyle={({ pressed }) => ({
        borderRadius: 22,
        padding: 14,
        paddingRight: 8,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: pressed ? colors.borderStrong : colors.border,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: withAlpha(colors.amber, 0.15) }}>
          <Octicons name="repo" size={18} color={colors.amber} />
        </View>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 15.5, color: colors.foreground, fontFamily: "Inter_700Bold" }}>
          {repo.name}
        </Text>
        <FavoriteButton active onPress={onToggleFavorite} name={repo.name} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, paddingRight: 6 }}>
        <Octicons name="git-branch" size={13} color={colors.violet} />
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: colors.violet, fontFamily: "Inter_600SemiBold" }}>
          {repo.branch ?? t("hm.branch.none")}
        </Text>
      </View>
      <View style={{ paddingRight: 6 }}>
        <StatusLine c={repo} />
      </View>
    </PressableScale>
  );
}

/** Carte compacte d'un dépôt consulté récemment. */
export function RecentRepoCard({ repo, width, onOpen }: { repo: Container; width: number; onOpen: () => void }) {
  const colors = useColors();
  const { t } = useI18n();
  return (
    <PressableScale
      haptic
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={t("hm.fav.open", { name: repo.name })}
      style={{ width }}
      contentStyle={({ pressed }) => ({
        minHeight: 84,
        borderRadius: 18,
        padding: 12,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: pressed ? colors.borderStrong : colors.border,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Octicons name="repo" size={14} color={colors.accent} />
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, color: colors.foreground, fontFamily: "Inter_700Bold" }}>
          {repo.name}
        </Text>
      </View>
      <Text numberOfLines={1} style={{ marginTop: 6, fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
        {repo.branch ?? t("hm.branch.none")}
      </Text>
      <Text numberOfLines={1} style={{ marginTop: 2, fontSize: 11.5, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
        {repo.lastOpenedAt ? timeAgo(repo.lastOpenedAt, t) : ""}
      </Text>
    </PressableScale>
  );
}

/** Une opération Git réellement effectuée (ligne compacte). */
export function OperationRow({
  name,
  ok,
  at,
  onPress,
  last,
}: {
  name: string;
  ok: boolean;
  at: number;
  onPress: () => void;
  last?: boolean;
}) {
  const colors = useColors();
  const { t } = useI18n();
  const col = ok ? colors.accent : colors.destructive;
  const label = ok ? t("g.repos.synced") : t("g.repos.syncFailed");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${label}, ${timeAgo(at, t)}`}
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          minHeight: 56,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderColor: colors.border,
        },
        pressed && { backgroundColor: colors.secondary },
      ]}
    >
      <View style={{ width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: withAlpha(col, 0.14) }}>
        <Feather name={ok ? "refresh-cw" : "alert-triangle"} size={15} color={col} />
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: 14, color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>
          {name}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 12, color: ok ? colors.mutedForeground : colors.destructive, fontFamily: "Inter_400Regular", marginTop: 1 }}>
          {label}
        </Text>
      </View>
      <Text style={{ fontSize: 11.5, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{timeAgo(at, t)}</Text>
    </Pressable>
  );
}

/** Rangée horizontale à défilement doux (favoris, dépôts récents). */
export function HScroll({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Les cartes dépassent un peu du bord : on voit qu'il y en a d'autres.
      style={{ marginHorizontal: -16 }}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
    >
      {children}
    </ScrollView>
  );
}
