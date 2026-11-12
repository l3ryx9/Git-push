import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isReduceMotion, tapFeedback } from "@/components/GitUi";
import { withAlpha } from "@/constants/colors";
import { motion, radius, space, touch, typography as typo } from "@/constants/theme";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { subscribeActionSheet, type SheetAction, type SheetRequest } from "@/utils/actionSheet";

/**
 * Feuille d'actions du bas de l'écran (à monter une seule fois, à la racine).
 * Toutes les actions sont visibles d'un coup, avec leur icône ; les actions
 * destructives sont en rouge ; « Annuler », le retour Android et un appui sur le
 * fond referment le menu. L'action choisie s'exécute APRÈS la fermeture, pour
 * qu'une confirmation qu'elle ouvre ne soit pas masquée par la feuille.
 */
export function ActionSheetHost() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { t } = useI18n();
  const [req, setReq] = useState<SheetRequest | null>(null);
  const [anim] = useState(() => new Animated.Value(0));
  const pending = useRef<(() => void) | null>(null);

  useEffect(
    () =>
      subscribeActionSheet((r) => {
        pending.current = null;
        setReq(r);
        anim.setValue(isReduceMotion() ? 1 : 0);
        if (!isReduceMotion()) {
          Animated.timing(anim, { toValue: 1, duration: motion.base, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        }
      }),
    [anim]
  );

  function close(then?: () => void) {
    pending.current = then ?? null;
    const done = () => {
      setReq(null);
      const fn = pending.current;
      pending.current = null;
      fn?.();
    };
    if (isReduceMotion()) return done();
    Animated.timing(anim, { toValue: 0, duration: motion.fast, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(done);
  }

  if (!req) return null;
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });

  const row = (a: SheetAction, i: number, last: boolean) => {
    const tint = a.destructive ? colors.destructive : colors.foreground;
    return (
      <Pressable
        key={i}
        disabled={a.disabled}
        accessibilityRole="button"
        accessibilityLabel={a.label}
        accessibilityState={{ disabled: !!a.disabled }}
        onPress={() => {
          tapFeedback();
          close(a.onPress);
        }}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          minHeight: touch.comfortable + 4,
          paddingHorizontal: space.lg,
          opacity: a.disabled ? 0.4 : 1,
          backgroundColor: pressed ? colors.secondary : "transparent",
          borderBottomWidth: last ? 0 : 1,
          borderColor: colors.border,
        })}
      >
        {a.icon ? (
          <View style={{ width: 32, height: 32, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: withAlpha(a.destructive ? colors.destructive : colors.accent, 0.12) }}>
            <Feather name={a.icon} size={16} color={a.destructive ? colors.destructive : colors.accent} />
          </View>
        ) : null}
        <Text numberOfLines={2} style={{ flex: 1, ...typo.bodyStrong, color: tint }}>
          {a.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => close()}>
      <Animated.View style={{ flex: 1, opacity: anim, backgroundColor: "rgba(0,0,0,0.6)" }}>
        <Pressable accessibilityRole="button" style={{ flex: 1 }} accessibilityLabel={t("msg.cancel")} onPress={() => close()} />
      </Animated.View>
      <Animated.View
        accessibilityViewIsModal
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: space.md,
          paddingBottom: insets.bottom + space.md,
          opacity: anim,
          transform: [{ translateY }],
        }}
      >
        <View style={{ alignSelf: "center", width: "100%", maxWidth: 560, borderRadius: radius.xl, backgroundColor: colors.cardSolid, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
          {req.title || req.message ? (
            <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md, borderBottomWidth: 1, borderColor: colors.border }}>
              {req.title ? (
                <Text accessibilityRole="header" numberOfLines={2} style={{ ...typo.title, fontSize: 16, color: colors.foreground }}>
                  {req.title}
                </Text>
              ) : null}
              {req.message ? (
                <Text numberOfLines={3} style={{ ...typo.code, color: colors.mutedForeground, marginTop: space.xs }}>
                  {req.message}
                </Text>
              ) : null}
            </View>
          ) : null}
          <ScrollView style={{ maxHeight: height * 0.6 }} bounces={false}>
            {req.actions.map((a, i) => row(a, i, i === req.actions.length - 1))}
          </ScrollView>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("msg.cancel")}
          onPress={() => close()}
          style={({ pressed }) => ({
            alignSelf: "center",
            width: "100%",
            maxWidth: 560,
            marginTop: space.sm,
            minHeight: touch.comfortable + 4,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.xl,
            backgroundColor: pressed ? colors.elevated : colors.cardSolid,
            borderWidth: 1,
            borderColor: colors.border,
          })}
        >
          <Text style={{ ...typo.bodyStrong, color: colors.foreground }}>{t("msg.cancel")}</Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}
