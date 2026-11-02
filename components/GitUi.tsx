import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { isNetworkError } from "@/utils/git/engine";
import type { Container } from "@/utils/git/store";

export const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

type T = (key: string, vars?: Record<string, string | number>) => string;

export function describeError(e: any, t: T): string {
  const code = e?.code;
  const files = (e?.data?.files ?? e?.data?.filepaths ?? []) as string[];
  switch (code) {
    case "DirtyWorktree":
      return t("g.err.dirty");
    case "MergePending":
      return t("g.err.mergePending");
    case "NoBranch":
      return t("g.err.noBranch");
    case "CheckoutConflictError":
      return t("g.err.checkoutConflict", { files: files.slice(0, 5).join(", ") });
    case "PushRejectedError":
      return t("g.err.pushRejected");
    case "UnmergedPathsError":
      return t("g.err.unmerged");
    case "MergeNotSupportedError":
      return t("g.err.mergeNotSupported", { files: files.slice(0, 5).join(", ") });
    case "AlreadyExistsError":
      return t("g.err.exists");
    case "UserCanceledError":
      return t("g.err.auth");
    case "ContainerNotFound":
      return t("g.err.containerNotFound");
    case "NativeUnavailable":
      return t("g.err.nativeUnavailable");
    case "HttpError": {
      const s = Number(e?.data?.statusCode);
      if (s === 401 || s === 403) return t("g.err.auth");
      if (s === 404) return t("g.err.notFound");
      if (isNetworkError(e)) return t("g.err.network");
      return t("g.err.http", { code: s });
    }
    case "NotFoundError":
      return t("g.err.refNotFound", { what: String(e?.data?.what ?? "") });
  }
  if (/ssl|certificate|trust anchor|handshake|cert path/i.test(String(e?.message ?? e))) return t("g.err.ssl");
  if (isNetworkError(e)) return t("g.err.network");
  return String(e?.message ?? e);
}

export function timeAgo(ms: number, t: T): string {
  const diff = Math.max(0, Date.now() - ms);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("g.time.now");
  if (mins < 60) return t("g.time.min", { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t("g.time.hour", { n: hrs });
  return t("g.time.day", { n: Math.floor(hrs / 24) });
}

export function ScreenHeader({
  title,
  subtitle,
  right,
  onBack,
  noBack,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onBack?: () => void;
  /** Pas de flèche retour (écran affiché dans un onglet). */
  noBack?: boolean;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingTop: insets.top + 6,
        paddingBottom: 10,
        paddingHorizontal: 8,
        borderBottomWidth: 1,
        borderColor: colors.border,
        // Transparent : le fond stylisé de l'écran reste visible derrière l'en-tête.
        backgroundColor: "transparent",
      }}
    >
      {noBack ? (
        <View style={{ width: 8 }} />
      ) : (
        <Pressable
          hitSlop={10}
          onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/repos" as any)))}
          style={({ pressed }) => [{ padding: 6 }, pressed && { opacity: 0.6 }]}
        >
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </Pressable>
      )}
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 17, fontFamily: "Inter_700Bold" }}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: "Inter_400Regular" }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function IconBtn({
  icon,
  onPress,
  color,
  disabled,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  onPress: () => void;
  color?: string;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      hitSlop={8}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [{ padding: 7, opacity: disabled ? 0.35 : 1 }, pressed && { opacity: 0.6 }]}
    >
      <Feather name={icon} size={19} color={color ?? colors.foreground} />
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  return (
    <View
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: colors.radius,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 18, marginBottom: 8, paddingHorizontal: 4 }}>
      <Text
        style={{
          flex: 1,
          fontSize: 11,
          color: colors.mutedForeground,
          fontFamily: "Inter_600SemiBold",
          letterSpacing: 0.8,
        }}
      >
        {children}
      </Text>
      {right}
    </View>
  );
}

export function Btn({
  label,
  icon,
  onPress,
  variant = "secondary",
  disabled,
  loading,
  style,
  small,
}: {
  label: string;
  icon?: React.ComponentProps<typeof Feather>["name"];
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const colors = useColors();
  const bg =
    variant === "primary" ? colors.primary : variant === "danger" ? "#2a0d0d" : variant === "ghost" ? "transparent" : colors.secondary;
  const fg = variant === "primary" ? "#000" : variant === "danger" ? colors.destructive : colors.foreground;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          backgroundColor: bg,
          borderRadius: colors.radius,
          borderWidth: variant === "secondary" || variant === "ghost" ? 1 : 0,
          borderColor: colors.border,
          paddingHorizontal: small ? 10 : 14,
          paddingVertical: small ? 7 : 11,
          opacity: disabled ? 0.4 : 1,
        },
        pressed && { opacity: 0.75 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Feather name={icon} size={small ? 13 : 15} color={fg} />
      ) : null}
      <Text style={{ color: fg, fontSize: small ? 12 : 13, fontFamily: "Inter_700Bold" }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function NavRow({
  icon,
  label,
  value,
  onPress,
  onLongPress,
  danger,
  right,
  last,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  value?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  danger?: boolean;
  right?: React.ReactNode;
  last?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 14,
          paddingVertical: 13,
          borderBottomWidth: last ? 0 : 1,
          borderColor: colors.border,
        },
        pressed && onPress && { backgroundColor: colors.secondary },
      ]}
    >
      <Feather name={icon} size={16} color={danger ? colors.destructive : colors.mutedForeground} />
      <Text
        numberOfLines={1}
        style={{ flex: 1, color: danger ? colors.destructive : colors.foreground, fontSize: 14, fontFamily: "Inter_500Medium" }}
      >
        {label}
      </Text>
      {right ??
        (value ? (
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 12, maxWidth: "45%", fontFamily: "Inter_400Regular" }}>
            {value}
          </Text>
        ) : null)}
      {onPress && !right ? <Feather name="chevron-right" size={14} color={colors.mutedForeground} /> : null}
    </Pressable>
  );
}

export function Empty({ icon, text, hint }: { icon: React.ComponentProps<typeof Feather>["name"]; text: string; hint?: string }) {
  const colors = useColors();
  return (
    <View style={{ alignItems: "center", padding: 32, gap: 8 }}>
      <Feather name={icon} size={26} color={colors.mutedForeground} />
      <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: "Inter_600SemiBold", textAlign: "center" }}>{text}</Text>
      {hint ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" }}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secure,
  multiline,
  keyboardType,
  hint,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
  multiline?: boolean;
  keyboardType?: "default" | "number-pad" | "email-address" | "url";
  hint?: string;
}) {
  const colors = useColors();
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.6, marginBottom: 6 }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        secureTextEntry={secure}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          backgroundColor: colors.input,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: colors.radius,
          color: colors.foreground,
          paddingHorizontal: 12,
          paddingVertical: 10,
          fontSize: 14,
          fontFamily: "Inter_400Regular",
          minHeight: multiline ? 70 : undefined,
          textAlignVertical: multiline ? "top" : "center",
        }}
      />
      {hint ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 5, fontFamily: "Inter_400Regular", lineHeight: 15 }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function Segmented<V extends string>({
  value,
  options,
  onChange,
}: {
  value: V;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
}) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: on ? colors.accent : colors.border,
              backgroundColor: on ? colors.greenBg : "transparent",
            }}
          >
            <Text style={{ color: on ? colors.accent : colors.foreground, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface PromptField {
  key: string;
  label: string;
  placeholder?: string;
  initial?: string;
  secure?: boolean;
}

/** Remplace Alert.prompt (inexistant sur Android). */
export function PromptModal({
  visible,
  title,
  fields,
  confirmText,
  cancelText,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  fields: PromptField[];
  confirmText: string;
  cancelText: string;
  onConfirm: (values: Record<string, string>) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    if (visible) setValues(Object.fromEntries(fields.map((f) => [f.key, f.initial ?? ""])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.backdrop}>
        <View style={[styles.box, { backgroundColor: colors.cardSolid, borderColor: colors.border, borderRadius: colors.radius + 4 }]}>
          <Text style={{ color: colors.foreground, fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 14 }}>{title}</Text>
          {fields.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              value={values[f.key] ?? ""}
              placeholder={f.placeholder}
              secure={f.secure}
              onChangeText={(v) => setValues((cur) => ({ ...cur, [f.key]: v }))}
            />
          ))}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
            <Btn label={cancelText} onPress={onClose} style={{ flex: 1 }} />
            <Btn label={confirmText} variant="primary" onPress={() => onConfirm(values)} style={{ flex: 1 }} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 22 },
  box: { padding: 18, borderWidth: 1 },
});

export function statusColor(kind: string, colors: ReturnType<typeof useColors>): string {
  switch (kind) {
    case "new":
    case "added":
      return colors.accent;
    case "deleted":
      return colors.destructive;
    default:
      return "#e3b341";
  }
}

export function statusLetter(kind: string): string {
  switch (kind) {
    case "new":
      return "U";
    case "added":
      return "A";
    case "deleted":
      return "D";
    default:
      return "M";
  }
}

export function ProgressLine({ text }: { text?: string }) {
  const colors = useColors();
  if (!text) return null;
  return (
    <Text style={{ color: colors.accent, fontSize: 11, fontFamily: MONO, marginTop: 6, textAlign: "center" }} numberOfLines={1}>
      {text}
    </Text>
  );
}

export function progressText(p: { phase: string; loaded: number; total?: number } | undefined, t: T): string | undefined {
  if (!p) return undefined;
  const phase = t(`g.phase.${p.phase}`) !== `g.phase.${p.phase}` ? t(`g.phase.${p.phase}`) : p.phase;
  if (p.total) return `${phase} ${Math.round((p.loaded / p.total) * 100)} % (${p.loaded}/${p.total})`;
  return p.loaded ? `${phase} ${p.loaded}` : phase;
}

export function syncSummaryText(c: Container, t: T): string {
  if (c.merge) return t("g.repos.conflicts", { n: c.merge.conflicts.length - c.merge.resolved.length });
  const s = c.lastSync;
  if (!s) return t("g.repos.neverSynced");
  if (!s.ok) {
    return `${t("g.repos.syncFailed")} · ${timeAgo(s.at, t)}`;
  }
  return `${t("g.repos.synced")} · ${timeAgo(s.at, t)}`;
}

