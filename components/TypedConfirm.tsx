import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { withAlpha } from "@/constants/colors";
import { radius, space, touch, typography as typo } from "@/constants/theme";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { phraseMatches, subscribeTypedConfirm, type TypedConfirmRequest } from "@/utils/safeConfirm";

/**
 * Fenêtre de vérification de sécurité (à monter une seule fois, à la racine).
 * Le bouton rouge reste désactivé tant que la phrase n'est pas recopiée exactement
 * ET que le court délai n'est pas écoulé. L'action ne s'exécute qu'après fermeture.
 */
export function TypedConfirmHost() {
  const colors = useColors();
  const { t } = useI18n();
  const [req, setReq] = useState<TypedConfirmRequest | null>(null);
  const [text, setText] = useState("");
  const [left, setLeft] = useState(0);

  useEffect(
    () =>
      subscribeTypedConfirm((r) => {
        setText("");
        setLeft(Math.ceil(r.delayMs / 1000));
        setReq(r);
      }),
    []
  );

  useEffect(() => {
    if (!req || left <= 0) return;
    const timer = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [req, left]);

  if (!req) return null;
  const ok = left <= 0 && phraseMatches(text, req.phrase);

  function close(run: boolean) {
    const current = req;
    setReq(null);
    setText("");
    if (run && current) setTimeout(() => current.onConfirm(), 0);
  }

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => close(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", padding: space.lg }}>
        <View
          accessibilityViewIsModal
          style={{ alignSelf: "center", width: "100%", maxWidth: 520, maxHeight: "90%", borderRadius: radius.xl, backgroundColor: colors.cardSolid, borderWidth: 1, borderColor: colors.destructive, overflow: "hidden" }}
        >
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <View style={{ width: 34, height: 34, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: withAlpha(colors.destructive, 0.14) }}>
                <Feather name="shield" size={18} color={colors.destructive} />
              </View>
              <Text accessibilityRole="header" style={{ flex: 1, ...typo.title, fontSize: 17, color: colors.foreground }}>
                {req.title}
              </Text>
            </View>
            <Text style={{ ...typo.body, color: colors.mutedForeground }}>{req.message}</Text>
            <Text style={{ ...typo.label, color: colors.mutedForeground }}>{t("safe.typeToConfirm")}</Text>
            <Text selectable style={{ ...typo.bodyStrong, color: colors.destructive, backgroundColor: withAlpha(colors.destructive, 0.1), padding: space.sm, borderRadius: radius.sm }}>
              {req.phrase}
            </Text>
            <TextInput
              value={text}
              onChangeText={setText}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              importantForAutofill="no"
              placeholder={req.phrase}
              placeholderTextColor={colors.mutedForeground}
              accessibilityLabel={t("safe.typeToConfirm")}
              style={{
                color: colors.foreground,
                backgroundColor: colors.input,
                borderColor: ok ? colors.destructive : colors.border,
                borderWidth: 1,
                borderRadius: radius.md,
                paddingHorizontal: space.md,
                minHeight: touch.comfortable,
                fontSize: typo.body.fontSize,
                fontFamily: typo.body.fontFamily,
              }}
            />
            <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.xs }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={req.cancelText}
                onPress={() => close(false)}
                style={({ pressed }) => ({ flex: 1, minHeight: touch.comfortable, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? colors.elevated : "transparent" })}
              >
                <Text style={{ ...typo.bodyStrong, color: colors.foreground }}>{req.cancelText}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={req.confirmText}
                accessibilityState={{ disabled: !ok }}
                disabled={!ok}
                onPress={() => close(true)}
                style={({ pressed }) => ({ flex: 1, minHeight: touch.comfortable, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.destructiveSolid, opacity: ok ? (pressed ? 0.8 : 1) : 0.35 })}
              >
                <Text style={{ ...typo.bodyStrong, color: colors.destructiveForeground }}>
                  {left > 0 ? `${req.confirmText} (${left})` : req.confirmText}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
