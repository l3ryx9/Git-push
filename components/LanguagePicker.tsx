import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text } from "react-native";

import { LANGS, useI18n, type LangCode } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";

/**
 * Petit menu déroulant de langue.
 * Rendu : bouton compact (drapeau + code) qui ouvre une liste en modal.
 */
export function LanguagePicker({ compact = true }: { compact?: boolean }) {
  const colors = useColors();
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);

  const current = LANGS.find((l) => l.code === lang) ?? LANGS[0];
  const s = makeStyles(colors);

  function pick(code: LangCode) {
    setLang(code);
    setOpen(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {/**/});
  }

  return (
    <>
      <Pressable
        style={({ pressed }) => [s.trigger, pressed && { opacity: 0.7 }]}
        onPress={() => setOpen(true)}
        hitSlop={8}
      >
        <Text style={s.flag}>{current.flag}</Text>
        {compact ? (
          <Text style={s.code}>{current.code.toUpperCase()}</Text>
        ) : (
          <Text style={s.code}>{current.label}</Text>
        )}
        <Feather name="chevron-down" size={13} color={colors.mutedForeground} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={s.sheetTitle}>{t("login.chooseLang")}</Text>
            {LANGS.map((l) => (
              <Pressable
                key={l.code}
                style={({ pressed }) => [
                  s.item,
                  lang === l.code && { backgroundColor: colors.greenBg },
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => pick(l.code)}
              >
                <Text style={s.flag}>{l.flag}</Text>
                <Text style={s.itemLabel}>{l.label}</Text>
                {lang === l.code && <Feather name="check" size={15} color={colors.accent} />}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    trigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    flag: { fontSize: 15 },
    code: {
      fontSize: 12,
      color: colors.foreground,
      fontFamily: "Inter_600SemiBold",
      letterSpacing: 0.5,
    },
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.6)",
      alignItems: "center",
      justifyContent: "center",
      padding: 32,
    },
    sheet: {
      width: "100%",
      maxWidth: 320,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
      paddingBottom: 6,
    },
    sheetTitle: {
      fontSize: 12,
      color: colors.mutedForeground,
      fontFamily: "Inter_600SemiBold",
      letterSpacing: 0.8,
      textTransform: "uppercase",
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 8,
    },
    item: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    itemLabel: {
      flex: 1,
      fontSize: 14,
      color: colors.foreground,
      fontFamily: "Inter_500Medium",
    },
  });
}
