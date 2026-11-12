import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Illustration, illustrationColor, type IllustrationKind } from "@/components/Illustration";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { isNetworkError } from "@/utils/git/engine";
import type { Container } from "@/utils/git/store";
import { C, withAlpha } from "@/constants/colors";

export const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

type T = (key: string, vars?: Record<string, string | number>) => string;

export function describeError(e: any, t: T): string {
  const code = e?.code;
  const withNext = (message: string, next: string) => `${message}\\n\\n${t(next)}`;
  const files = (e?.data?.files ?? e?.data?.filepaths ?? []) as string[];
  switch (code) {
    case "DirtyWorktree":
      return withNext(t("g.err.dirty"), "g.err.next.dirty");
    case "MergePending":
      return withNext(t("g.err.mergePending"), "g.err.next.merge");
    case "NoBranch":
      return withNext(t("g.err.noBranch"), "g.err.next.branch");
    case "CheckoutConflictError":
      return withNext(t("g.err.checkoutConflict", { files: files.slice(0, 5).join(", ") }), "g.err.next.dirty");
    case "PushRejectedError":
      return withNext(t("g.err.pushRejected"), "g.err.next.push");
    case "UnmergedPathsError":
      return withNext(t("g.err.unmerged"), "g.err.next.merge");
    case "MergeNotSupportedError":
      return withNext(t("g.err.mergeNotSupported", { files: files.slice(0, 5).join(", ") }), "g.err.next.merge");
    case "AlreadyExistsError":
      return t("g.err.exists");
    case "UserCanceledError":
      return t("g.err.auth");
    case "ContainerNotFound":
      return t("g.err.containerNotFound");
    case "NativeUnavailable":
      return t("g.err.nativeUnavailable");
    case "InsecureTransport":
      return t("g.err.insecureTransport");
    case "HttpError": {
      const s = Number(e?.data?.statusCode);
      if (s === 401 || s === 403) return withNext(t("g.err.auth"), "g.err.next.auth");
      if (s === 404) return withNext(t("g.err.notFound"), "g.err.next.notFound");
      if (isNetworkError(e)) return withNext(t("g.err.network"), "g.err.next.network");
      return withNext(t("g.err.http", { code: s }), "g.err.next.generic");
    }
    case "NotFoundError":
      return t("g.err.refNotFound", { what: String(e?.data?.what ?? "") });
  }
  if (/ssl|certificate|trust anchor|handshake|cert path/i.test(String(e?.message ?? e))) return withNext(t("g.err.ssl"), "g.err.next.ssl");
  if (isNetworkError(e)) return withNext(t("g.err.network"), "g.err.next.network");
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

/** Retour haptique léger (ignoré si indisponible). */
export function tapFeedback() {
  Haptics.selectionAsync().catch(() => undefined);
}

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled?.()
  .then((v: boolean) => {
    reduceMotion = !!v;
  })
  .catch(() => undefined);

/**
 * Zone appuyable qui « s'enfonce » légèrement (ressort natif, 60 i/s même si le
 * JavaScript est occupé). `style` s'applique au conteneur (mise en page),
 * `contentStyle` à la zone appuyable elle-même.
 */
export function PressableScale({
  style,
  contentStyle,
  scaleTo = 0.97,
  haptic,
  onPressIn,
  onPressOut,
  onPress,
  children,
  ...rest
}: Omit<PressableProps, "style" | "children"> & {
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle> | ((s: { pressed: boolean }) => StyleProp<ViewStyle>);
  scaleTo?: number;
  haptic?: boolean;
  children?: React.ReactNode;
}) {
  const [scale] = useState(() => new Animated.Value(1));
  const animate = (to: number, spring: boolean) => {
    if (reduceMotion) return;
    if (spring) Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 28, bounciness: 7 }).start();
    else Animated.timing(scale, { toValue: to, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  };
  return (
    <Animated.View style={[style, { transform: [{ scale }] }]}>
      <Pressable
        {...rest}
        onPressIn={(e: GestureResponderEvent) => {
          animate(scaleTo, false);
          onPressIn?.(e);
        }}
        onPressOut={(e: GestureResponderEvent) => {
          animate(1, true);
          onPressOut?.(e);
        }}
        onPress={(e: GestureResponderEvent) => {
          if (haptic) tapFeedback();
          onPress?.(e);
        }}
        style={contentStyle as any}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

/** Bloc de chargement animé (remplace un simple indicateur qui tourne). */
export function Skeleton({ height = 14, width = "100%", radius = 8, style }: { height?: number; width?: number | `${number}%`; radius?: number; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  const [pulse] = useState(() => new Animated.Value(0.45));
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[{ height, width, borderRadius: radius, backgroundColor: colors.secondary, opacity: pulse }, style]} />;
}

/** Carte fantôme d'une liste en cours de chargement. */
export function SkeletonRow() {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: colors.radius, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
      <Skeleton width={38} height={38} radius={colors.radiusSm} />
      <View style={{ flex: 1, gap: 7 }}>
        <Skeleton width="55%" height={13} />
        <Skeleton width="80%" height={10} />
      </View>
    </View>
  );
}

/** Petite pastille d'état (branche, compteur, statut). */
export function Badge({ label, color, icon }: { label: string; color?: string; icon?: React.ComponentProps<typeof Feather>["name"] }) {
  const colors = useColors();
  const c = color ?? colors.mutedForeground;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: withAlpha(c.startsWith("#") ? c : "#8aa097", 0.13) }}>
      {icon ? <Feather name={icon} size={10} color={c} /> : null}
      <Text style={{ color: c, fontSize: 11, fontFamily: "Inter_600SemiBold" }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * Aide contextuelle repliable : l'information reste disponible sans encombrer
 * l'écran pour les utilisateurs qui n'en ont pas besoin.
 */
export function HelpTip({ title, body }: { title: string; body: string }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ marginTop: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={{ minHeight: 44, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 9 }}
      >
        <Feather name="help-circle" size={16} color={colors.accent} />
        <Text style={{ flex: 1, color: colors.foreground, fontSize: 12.5, fontFamily: "Inter_600SemiBold" }}>{title}</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={15} color={colors.mutedForeground} />
      </Pressable>
      {open ? (
        <Text style={{ paddingHorizontal: 12, paddingBottom: 12, color: colors.mutedForeground, fontSize: 12, lineHeight: 18 }}>
          {body}
        </Text>
      ) : null}
    </View>
  );
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
  const { t } = useI18n();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingTop: insets.top + 8,
        paddingBottom: 12,
        paddingHorizontal: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        // Transparent : le fond stylisé de l'écran reste visible derrière l'en-tête.
        backgroundColor: "transparent",
      }}
    >
      {noBack ? (
        <View style={{ width: 6 }} />
      ) : (
        <PressableScale
          hitSlop={10}
          scaleTo={0.9}
          accessibilityRole="button"
          accessibilityLabel={t("g.common.back")}
          onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/repos" as any)))}
          contentStyle={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.secondary }}
        >
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </PressableScale>
      )}
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} accessibilityRole="header" style={{ color: colors.foreground, fontSize: 19, fontFamily: "Inter_700Bold", letterSpacing: -0.3 }}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 }}>
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
  label,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  onPress: () => void;
  color?: string;
  disabled?: boolean;
  /** Texte lu par le lecteur d'écran. */
  label?: string;
}) {
  const colors = useColors();
  return (
    <PressableScale
      hitSlop={8}
      scaleTo={0.88}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? icon}
      accessibilityState={{ disabled: !!disabled }}
      style={{ opacity: disabled ? 0.35 : 1 }}
      contentStyle={({ pressed }) => [{ width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22 }, pressed && { backgroundColor: colors.secondary }]}
    >
      <Feather name={icon} size={20} color={color ?? colors.foreground} />
    </PressableScale>
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
    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 22, marginBottom: 8, paddingHorizontal: 4 }}>
      <Text
        accessibilityRole="header"
        style={{
          flex: 1,
          fontSize: 12,
          color: colors.mutedForeground,
          fontFamily: "Inter_600SemiBold",
          letterSpacing: 0.4,
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
    variant === "primary" ? colors.primary : variant === "danger" ? colors.destructiveBg : variant === "ghost" ? "transparent" : colors.secondary;
  const fg = variant === "primary" ? colors.primaryForeground : variant === "danger" ? colors.destructive : colors.foreground;
  const border = variant === "danger" ? withAlpha("#ff6b6b", 0.35) : colors.border;
  return (
    <PressableScale
      onPress={onPress}
      haptic
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={[{ opacity: disabled ? 0.4 : 1 }, style]}
      contentStyle={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          backgroundColor: bg,
          borderRadius: colors.radiusSm + 2,
          borderWidth: variant === "primary" ? 0 : 1,
          borderColor: border,
          paddingHorizontal: small ? 12 : 16,
          minHeight: small ? 40 : 48,
          paddingVertical: small ? 6 : 10,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Feather name={icon} size={small ? 14 : 16} color={fg} />
      ) : null}
      <Text style={{ color: fg, fontSize: small ? 12.5 : 14, fontFamily: "Inter_600SemiBold" }} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
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
  const tint = danger ? colors.destructive : colors.accent;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={value ? `${label}, ${value}` : label}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          minHeight: 52,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderColor: colors.border,
        },
        pressed && onPress && { backgroundColor: colors.secondary },
      ]}
    >
      <View style={{ width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: withAlpha(danger ? "#ff6b6b" : "#4be08f", 0.1) }}>
        <Feather name={icon} size={15} color={tint} />
      </View>
      <Text
        numberOfLines={1}
        style={{ flex: 1, color: danger ? colors.destructive : colors.foreground, fontSize: 14.5, fontFamily: "Inter_500Medium" }}
      >
        {label}
      </Text>
      {right ??
        (value ? (
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 12.5, maxWidth: "45%", fontFamily: "Inter_400Regular" }}>
            {value}
          </Text>
        ) : null)}
      {onPress && !right ? <Feather name="chevron-right" size={15} color={colors.mutedForeground} /> : null}
    </Pressable>
  );
}

export function Empty({
  icon,
  text,
  hint,
  art,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  text: string;
  hint?: string;
  /** Illustration à la place de l'icône (mêmes dessins que les raccourcis de l'accueil). */
  art?: IllustrationKind;
}) {
  const colors = useColors();
  const tint = art ? illustrationColor(art, colors) : colors.accent;
  return (
    <View style={{ alignItems: "center", paddingVertical: 36, paddingHorizontal: 24, gap: 10 }}>
      {art ? (
        <View style={{ width: 96, height: 96, borderRadius: 30, alignItems: "center", justifyContent: "center", backgroundColor: withAlpha(tint, 0.12) }}>
          <Illustration kind={art} size={72} />
        </View>
      ) : (
        <View style={{ width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.greenBg }}>
          <Feather name={icon} size={24} color={colors.accent} />
        </View>
      )}
      <Text style={{ color: colors.foreground, fontSize: 16, fontFamily: "Inter_700Bold", textAlign: "center", marginTop: art ? 6 : 0 }}>{text}</Text>
      {hint ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular", textAlign: "center", maxWidth: 320 }}>{hint}</Text>
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
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(false);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: 6 }}>{label}</Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: multiline ? "flex-start" : "center",
          backgroundColor: colors.input,
          borderWidth: 1,
          borderColor: focused ? colors.borderStrong : colors.border,
          borderRadius: colors.radiusSm + 2,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          secureTextEntry={secure && !reveal}
          multiline={multiline}
          keyboardType={keyboardType}
          autoCapitalize="none"
          autoCorrect={false}
          // Jamais de suggestions / mémorisation clavier pour un secret.
          autoComplete={secure ? "off" : undefined}
          importantForAutofill={secure ? "no" : undefined}
          accessibilityLabel={label}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1,
            color: colors.foreground,
            paddingHorizontal: 12,
            paddingVertical: 11,
            fontSize: 14.5,
            fontFamily: "Inter_400Regular",
            minHeight: multiline ? 76 : 46,
            textAlignVertical: multiline ? "top" : "center",
          }}
        />
        {secure ? (
          <Pressable
            hitSlop={8}
            onPress={() => setReveal((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={reveal ? "Masquer" : "Afficher"}
            style={{ paddingHorizontal: 12, paddingVertical: 10 }}
          >
            <Feather name={reveal ? "eye-off" : "eye"} size={17} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
      {hint ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 6, fontFamily: "Inter_400Regular", lineHeight: 17 }}>{hint}</Text>
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
  // Peu d'options : contrôle segmenté sur une piste. Beaucoup (branches…) : pastilles qui passent à la ligne.
  if (options.length <= 4) {
    return (
      <View
        accessibilityRole="tablist"
        style={{ flexDirection: "row", padding: 3, gap: 3, borderRadius: colors.radiusSm + 3, backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.border, marginBottom: 12 }}
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => {
                if (!on) tapFeedback();
                onChange(o.value);
              }}
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 8,
                paddingHorizontal: 6,
                borderRadius: colors.radiusSm,
                backgroundColor: on ? colors.elevated : "transparent",
                borderWidth: on ? 1 : 0,
                borderColor: colors.borderStrong,
              }}
            >
              <Text numberOfLines={1} style={{ color: on ? colors.accent : colors.mutedForeground, fontSize: 13, fontFamily: "Inter_600SemiBold" }}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => {
              if (!on) tapFeedback();
              onChange(o.value);
            }}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: on ? colors.borderStrong : colors.border,
              backgroundColor: on ? colors.greenBg : "transparent",
            }}
          >
            <Text style={{ color: on ? colors.accent : colors.foreground, fontSize: 12.5, fontFamily: "Inter_600SemiBold" }}>{o.label}</Text>
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
      return C.warning;
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

