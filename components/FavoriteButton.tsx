import { Feather, Octicons } from "@expo/vector-icons";
import React from "react";
import { Pressable } from "react-native";

import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import { showToast } from "@/utils/toast";

/** Bascule « favori » d'un dépôt (enregistré avec le dépôt, donc conservé hors ligne). */
export function useToggleFavorite() {
  const { update } = useRepos();
  const { t } = useI18n();
  return async (c: { id: string; name: string; favorite?: boolean }) => {
    const next = !c.favorite;
    try {
      await update(c.id, { favorite: next });
      showToast(t(next ? "hm.fav.added" : "hm.fav.removed", { name: c.name }), "info");
    } catch {
      /* l'écriture locale a échoué : l'étoile reste dans son état précédent */
    }
  };
}

/** Étoile (zone tactile 48 px) pour épingler / retirer un dépôt des favoris. */
export function FavoriteButton({
  active,
  onPress,
  name,
}: {
  active: boolean;
  onPress: () => void;
  name: string;
}) {
  const colors = useColors();
  const { t } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t(active ? "hm.fav.remove" : "hm.fav.add")} : ${name}`}
      accessibilityState={{ selected: active }}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
        pressed && { backgroundColor: colors.secondary },
      ]}
    >
      {active ? (
        <Octicons name="star-fill" size={19} color={colors.amber} />
      ) : (
        <Feather name="star" size={19} color={colors.mutedForeground} />
      )}
    </Pressable>
  );
}
