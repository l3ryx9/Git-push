import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { withAlpha } from "@/constants/colors";
import { useColors } from "@/hooks/useColors";
import { subscribeToasts, type Toast } from "@/utils/toast";

const ICON = { success: "check-circle", info: "info", warning: "alert-triangle", error: "x-circle" } as const;

/** Affiche les notifications en haut de l'écran (à monter une seule fois, à la racine). */
export function ToastHost() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<Toast | null>(null);
  const kind: Toast["kind"] = toast?.kind ?? "info";
  const [anim] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const hide = () => {
      Animated.timing(anim, { toValue: 0, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(({ finished }: { finished: boolean }) => {
        if (finished) setToast(null);
      });
    };
    const unsub = subscribeToasts((t) => {
      if (timer.current) clearTimeout(timer.current);
      setToast(t);
      anim.setValue(0);
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 6 }).start();
      AccessibilityInfo.announceForAccessibility?.(t.title ? `${t.title}. ${t.message}` : t.message);
      const ms = Math.min(6000, 2200 + t.message.length * 35);
      timer.current = setTimeout(hide, ms);
    });
    return () => {
      unsub();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [anim]);

  if (!toast) return null;
  const tint = kind === "success" ? colors.accent : kind === "error" ? colors.destructive : kind === "warning" ? colors.warning : colors.info;
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] });

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top + 8, left: 12, right: 12, alignItems: "center", zIndex: 1000, elevation: 1000 }}>
      <Animated.View style={{ width: "100%", maxWidth: 520, opacity: anim, transform: [{ translateY }] }}>
        <Pressable
          onPress={() => {
            if (timer.current) clearTimeout(timer.current);
            setToast(null);
          }}
          accessibilityRole="alert"
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 10,
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderRadius: colors.radius,
            backgroundColor: colors.elevated,
            borderWidth: 1,
            borderColor: withAlpha(tint.startsWith("#") ? tint : "#4be08f", 0.35),
            shadowColor: "#000",
            shadowOpacity: 0.35,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 6 },
            elevation: 8,
          }}
        >
          <Feather name={ICON[kind]} size={18} color={tint} style={{ marginTop: 1 }} />
          <View style={{ flex: 1 }}>
            {toast.title ? (
              <Text style={{ color: colors.foreground, fontSize: 13.5, fontFamily: "Inter_600SemiBold" }} numberOfLines={1}>
                {toast.title}
              </Text>
            ) : null}
            <Text style={{ color: toast.title ? colors.mutedForeground : colors.foreground, fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium" }} numberOfLines={4}>
              {toast.message}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}
