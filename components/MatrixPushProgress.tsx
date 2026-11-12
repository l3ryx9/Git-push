import React, { useEffect, useRef } from "react";
import { Animated, Easing, Text, View } from "react-native";

import type { Progress } from "@/utils/git/engine";

const MATRIX = "#39ff78";
const GLYPHS = "01 10 11 00 1A 0F 10 01 11 00 10 01";

function formatCount(value: number): string {
  return Math.round(value).toLocaleString();
}

export function MatrixPushProgress({ progress, label }: { progress?: Progress; label: string }) {
  const scan = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const scanLoop = Animated.loop(Animated.timing(scan, {
      toValue: 1,
      duration: 1800,
      easing: Easing.linear,
      useNativeDriver: true,
    }));
    const pulseLoop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.35, duration: 650, useNativeDriver: true }),
    ]));
    scanLoop.start();
    pulseLoop.start();
    return () => {
      scanLoop.stop();
      pulseLoop.stop();
    };
  }, [pulse, scan]);

  const total = progress?.total ?? 0;
  const loaded = Math.max(0, progress?.loaded ?? 0);
  const determinate = total > 0;
  const ratio = determinate ? Math.max(0, Math.min(1, loaded / total)) : 0;
  const percent = Math.round(ratio * 100);
  const phase = progress?.phase || label;
  const translateX = scan.interpolate({ inputRange: [0, 1], outputRange: [-180, 320] });

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={determinate ? { min: 0, max: 100, now: percent } : undefined}
      style={{
        marginTop: 10,
        marginBottom: 8,
        padding: 13,
        borderRadius: 13,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: `${MATRIX}88`,
        backgroundColor: "#020b06",
      }}
    >
      <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "58%", overflow: "hidden", opacity: 0.12 }}>
        <Animated.Text
          numberOfLines={5}
          style={{
            color: MATRIX,
            fontFamily: "monospace",
            fontSize: 11,
            lineHeight: 17,
            letterSpacing: 5,
            transform: [{ translateY: scan.interpolate({ inputRange: [0, 1], outputRange: [12, -34] }) }],
          }}
        >
          {`${GLYPHS}\n${GLYPHS}\n${GLYPHS}\n${GLYPHS}\n${GLYPHS}`}
        </Animated.Text>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, flex: 1 }}>
          <Animated.View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: MATRIX, opacity: pulse }} />
          <Text style={{ color: MATRIX, fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 1.5 }}>
            MATRIX / PUSH
          </Text>
        </View>
        <Text style={{ color: MATRIX, fontSize: 11, fontFamily: "monospace" }}>
          {determinate ? `${percent}%` : "TRANSMITTING"}
        </Text>
      </View>

      <View style={{ height: 13, flexDirection: "row", gap: 3, marginTop: 12, overflow: "hidden" }}>
        {Array.from({ length: 28 }, (_, index) => {
          const active = determinate ? index < Math.ceil(ratio * 28) : false;
          return (
            <View key={index} style={{ flex: 1, borderRadius: 2, backgroundColor: active ? MATRIX : "#123321", opacity: active ? 0.95 : 0.7 }} />
          );
        })}
        {!determinate ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 76,
              backgroundColor: `${MATRIX}55`,
              transform: [{ translateX }],
            }}
          />
        ) : null}
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 9, gap: 8 }}>
        <Text numberOfLines={1} style={{ color: "#b4f5c7", fontSize: 10, flex: 1, fontFamily: "monospace" }}>
          {`> ${phase.toUpperCase()}`}
        </Text>
        <Text style={{ color: "#6cae80", fontSize: 9, fontFamily: "monospace" }}>
          {determinate ? `${formatCount(loaded)} / ${formatCount(total)} OBJ` : `${formatCount(loaded)} OBJ`}
        </Text>
      </View>
      <Text style={{ color: "#397a50", fontSize: 8, marginTop: 7, letterSpacing: 1, fontFamily: "monospace" }}>
        SECURE CHANNEL · GIT OBJECT TRANSFER
      </Text>
    </View>
  );
}
