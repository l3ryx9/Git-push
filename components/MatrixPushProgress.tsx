import React, { useEffect, useRef } from "react";
import { Animated, Easing, Text, View } from "react-native";

import { isReduceMotion } from "@/components/GitUi";
import { withAlpha } from "@/constants/colors";
import { radius, space, typography as typo } from "@/constants/theme";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import type { Progress } from "@/utils/git/engine";

const GLYPHS = "01 10 11 00 1A 0F 10 01 11 00 10 01";
const CELLS = 28;

function formatCount(value: number): string {
  return Math.round(value).toLocaleString();
}

/**
 * Signature visuelle de Git-Push : la progression du push façon terminal « Matrix ».
 * - Le pourcentage vient UNIQUEMENT des valeurs loaded / total fournies par Git ;
 *   sans total, une bande indéterminée balaie la piste (aucun faux pourcentage).
 * - Même vert que l'accent de l'application (plus de second vert néon isolé).
 * - Textes traduits, taille minimale 11, et animations coupées si l'utilisateur a
 *   demandé de réduire les animations.
 */
export function MatrixPushProgress({ progress, label }: { progress?: Progress; label: string }) {
  const colors = useColors();
  const { t } = useI18n();
  const tint = colors.accent;
  const scan = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const still = isReduceMotion();

  useEffect(() => {
    if (still) return;
    const scanLoop = Animated.loop(Animated.timing(scan, { toValue: 1, duration: 1800, easing: Easing.linear, useNativeDriver: true }));
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      ])
    );
    scanLoop.start();
    pulseLoop.start();
    return () => {
      scanLoop.stop();
      pulseLoop.stop();
    };
  }, [pulse, scan, still]);

  const total = progress?.total ?? 0;
  const loaded = Math.max(0, progress?.loaded ?? 0);
  const determinate = total > 0;
  const ratio = determinate ? Math.max(0, Math.min(1, loaded / total)) : 0;
  const percent = Math.round(ratio * 100);
  const phase = progress?.phase || label;
  const translateX = scan.interpolate({ inputRange: [0, 1], outputRange: [-180, 320] });
  const objects = determinate
    ? t("g.push.matrix.objectsOf", { n: formatCount(loaded), total: formatCount(total) })
    : t("g.push.matrix.objects", { n: formatCount(loaded) });

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`${label} : ${phase}`}
      accessibilityValue={determinate ? { min: 0, max: 100, now: percent } : { text: objects }}
      style={{
        marginTop: space.md,
        marginBottom: space.sm,
        padding: space.md + 1,
        borderRadius: radius.md,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: withAlpha(tint, 0.45),
        backgroundColor: "#020b06",
      }}
    >
      {!still ? (
        <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "58%", overflow: "hidden", opacity: 0.1 }}>
          <Animated.Text
            numberOfLines={5}
            style={{
              color: tint,
              fontFamily: typo.code.fontFamily,
              fontSize: 11,
              lineHeight: 17,
              letterSpacing: 5,
              transform: [{ translateY: scan.interpolate({ inputRange: [0, 1], outputRange: [12, -34] }) }],
            }}
          >
            {`${GLYPHS}\n${GLYPHS}\n${GLYPHS}\n${GLYPHS}\n${GLYPHS}`}
          </Animated.Text>
        </View>
      ) : null}

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flex: 1 }}>
          <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tint, opacity: pulse }} />
          <Text numberOfLines={1} style={{ ...typo.label, color: tint }}>
            {label}
          </Text>
        </View>
        <Text style={{ ...typo.code, fontSize: 13, color: tint }}>{determinate ? `${percent} %` : t("g.push.matrix.sending")}</Text>
      </View>

      <View style={{ height: 12, flexDirection: "row", gap: 3, marginTop: space.md, overflow: "hidden" }}>
        {Array.from({ length: CELLS }, (_, index) => {
          const active = determinate ? index < Math.ceil(ratio * CELLS) : false;
          return <View key={index} style={{ flex: 1, borderRadius: 2, backgroundColor: active ? tint : "#123321" }} />;
        })}
        {!determinate && !still ? (
          <Animated.View
            pointerEvents="none"
            style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 76, backgroundColor: withAlpha(tint, 0.35), transform: [{ translateX }] }}
          />
        ) : null}
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space.sm + 2, gap: space.sm }}>
        <Text numberOfLines={1} style={{ ...typo.code, fontSize: 11.5, color: "#c4f5d3", flex: 1 }}>
          {`> ${phase}`}
        </Text>
        <Text style={{ ...typo.code, fontSize: 11.5, color: "#8fd3a6" }}>{objects}</Text>
      </View>
    </View>
  );
}
