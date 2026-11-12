import { Feather, Octicons } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

export interface PickerItem {
  key: string;
  label: string;
  icon: "repo" | "lock" | "git-branch";
  selected?: boolean;
  /** Mode multi-sélection : case à cocher devant l'élément. */
  checked?: boolean;
}

/**
 * Sélecteur plein écran en Modal.
 * Remplace les anciens dropdowns imbriqués dans le ScrollView : ceux-ci
 * étaient coupés à 240px avec le scroll désactivé, donc impossibles à
 * faire défiler. Ici la FlatList a son propre défilement, fiable sur
 * iOS, Android et web.
 */
export function PickerModal({
  visible,
  title,
  items,
  loading,
  searchable,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  emptyLabel,
  onSelect,
  onClose,
  multiSelect,
  selectAllLabel,
  onSelectAll,
  confirmLabel,
  onConfirm,
  confirmDisabled,
}: {
  visible: boolean;
  title: string;
  items: PickerItem[];
  loading?: boolean;
  searchable?: boolean;
  searchValue?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;
  emptyLabel: string;
  onSelect: (key: string) => void;
  onClose: () => void;
  /** Multi-sélection : cases à cocher + bouton de validation en bas. */
  multiSelect?: boolean;
  selectAllLabel?: string;
  onSelectAll?: () => void;
  confirmLabel?: string;
  onConfirm?: () => void;
  confirmDisabled?: boolean;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const s = makeStyles(colors);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={s.handle} />
          <View style={s.headerRow}>
            <Text style={s.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} style={({ pressed }) => pressed && { opacity: 0.6 }}>
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {searchable && (
            <View style={s.searchRow}>
              <Feather name="search" size={14} color={colors.mutedForeground} />
              <TextInput
                style={s.searchInput}
                value={searchValue}
                onChangeText={onSearchChange}
                placeholder={searchPlaceholder}
                placeholderTextColor={colors.mutedForeground}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>
          )}

          {multiSelect && onSelectAll && selectAllLabel && (
            <Pressable onPress={onSelectAll} hitSlop={6} style={({ pressed }) => [s.selectAll, pressed && { opacity: 0.6 }]}>
              <Feather name="check-square" size={14} color={colors.accent} />
              <Text style={s.selectAllText}>{selectAllLabel}</Text>
            </Pressable>
          )}

          {loading ? (
            <ActivityIndicator color={colors.accent} style={{ padding: 24 }} />
          ) : (
            <FlatList
              data={items}
              keyExtractor={(i) => i.key}
              style={s.list}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [
                    s.item,
                    item.selected && { backgroundColor: colors.greenBg },
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => onSelect(item.key)}
                >
                  {multiSelect && (
                    <Feather
                      name={item.checked ? "check-square" : "square"}
                      size={19}
                      color={item.checked ? colors.destructive : colors.mutedForeground}
                    />
                  )}
                  <Octicons name={item.icon} size={14} color={colors.mutedForeground} />
                  <Text style={s.itemLabel} numberOfLines={1}>{item.label}</Text>
                  {!multiSelect && item.selected && <Feather name="check" size={15} color={colors.accent} />}
                </Pressable>
              )}
              ListEmptyComponent={<Text style={s.empty}>{emptyLabel}</Text>}
            />
          )}

          {multiSelect && onConfirm && (
            <Pressable
              style={({ pressed }) => [
                s.confirmBtn,
                { opacity: pressed || confirmDisabled ? 0.5 : 1 },
              ]}
              onPress={onConfirm}
              disabled={confirmDisabled}
            >
              <Feather name="trash-2" size={16} color="#fff" />
              <Text style={s.confirmText}>{confirmLabel}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
    sheet: {
      maxHeight: "75%",
      backgroundColor: colors.cardSolid,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    handle: {
      alignSelf: "center",
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginTop: 8,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 8,
    },
    title: {
      fontSize: 15,
      fontWeight: "700" as const,
      color: colors.foreground,
      fontFamily: "Inter_700Bold",
    },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginHorizontal: 12,
      marginBottom: 6,
      paddingHorizontal: 12,
      backgroundColor: colors.input,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
    },
    searchInput: {
      flex: 1,
      paddingVertical: 10,
      fontSize: 13,
      color: colors.foreground,
      fontFamily: "Inter_400Regular",
    },
    list: { flexGrow: 0, flexShrink: 1 },
    selectAll: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    selectAllText: {
      fontSize: 13,
      color: colors.accent,
      fontFamily: "Inter_400Regular",
    },
    confirmBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      marginHorizontal: 12,
      marginTop: 10,
      paddingVertical: 14,
      borderRadius: colors.radius,
      backgroundColor: colors.destructive,
    },
    confirmText: {
      color: "#fff",
      fontSize: 14,
      fontWeight: "700" as const,
      fontFamily: "Inter_700Bold",
    },
    item: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 13,
      borderTopWidth: 1,
      borderColor: colors.border,
    },
    itemLabel: {
      flex: 1,
      fontSize: 14,
      color: colors.foreground,
      fontFamily: "Inter_400Regular",
    },
    empty: {
      color: colors.mutedForeground,
      padding: 16,
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      textAlign: "center",
    },
  });
}
