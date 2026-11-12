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
  useWindowDimensions,
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
import { withAlpha } from "@/constants/colors";
import { radius, space, stateOpacity, touch, typography as typo } from "@/constants/theme";

export const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

type T = (key: string, vars?: Record<string, string | number>) => string;

export function describeError(e: any, t: T): string {
  const code = e?.code;
  const withNext = (message: string, next: string) => `${message}\n\n${t(next)}`;
  const files = (e?.data?.files ?? e?.data?.filepaths ?? []) as string[];
  switch (code) {
    case "DirtyWorktree":
      return withNext(t("g.err.dirty"), "g.err.next.dirty");
    case "UntrackedOverwrite":
      return withNext(t("g.err.untrackedOverwrite", { files: files.slice(0, 5).join(", ") }), "g.err.next.dirty");
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

// Préférence « Réduire les animations » : lue au démarrage PUIS suivie en direct
// (avant, un changement du réglage pendant l'utilisation n'était pas pris en compte).
let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled?.()
  .then((v: boolean) => {
    reduceMotion = !!v;
  })
  .catch(() => undefined);
try {
  AccessibilityInfo.addEventListener?.("reduceMotionChanged", (v: boolean) => {
    reduceMotion = !!v;
  });
} catch {
  /* plateforme sans événement : valeur de démarrage conservée */
}

/** Animations réduites (préférence système) : à consulter avant toute animation non essentielle. */
export function isReduceMotion(): boolean {
  return reduceMotion;
}

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
      <Pressable accessibilityRole="button"
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
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: withAlpha(c.startsWith("#") ? c : colors.mutedForeground, 0.14) }}>
      {icon ? <Feather name={icon} size={11} color={c} /> : null}
      <Text style={{ ...typo.caption, lineHeight: undefined, color: c, fontFamily: typo.label.fontFamily }} numberOfLines={1}>
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
    <View style={{ marginTop: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.card }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={{ minHeight: touch.min, paddingHorizontal: space.md, flexDirection: "row", alignItems: "center", gap: space.sm }}
      >
        <Feather name="help-circle" size={16} color={colors.accent} />
        <Text style={{ flex: 1, ...typo.label, color: colors.foreground }}>{title}</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={15} color={colors.mutedForeground} />
      </Pressable>
      {open ? (
        <Text style={{ paddingHorizontal: space.md, paddingBottom: space.md, ...typo.body, fontSize: 13, lineHeight: 19, color: colors.mutedForeground }}>
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
  art,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onBack?: () => void;
  /** Pas de flèche retour (écran affiché dans un onglet). */
  noBack?: boolean;
  /** Illustration propre à l'écran, purement décorative. */
  art?: IllustrationKind;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  // Petits écrans : l'illustration rétrécit, puis disparaît quand des actions occupent
  // la droite de l'en-tête (le titre restait sinon tronqué à quelques caractères).
  const { width } = useWindowDimensions();
  const artSize = !art ? 0 : width < 360 || (width < 400 && right) ? 0 : width < 420 ? 40 : 48;
  // Entrée discrète du contenu : native driver, sans décalage de mise en page.
  const [headerEntrance] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  useEffect(() => {
    if (reduceMotion) {
      headerEntrance.setValue(1);
      return;
    }
    const animation = Animated.timing(headerEntrance, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [headerEntrance]);
  const entranceStyle = {
    opacity: headerEntrance,
    transform: [{ translateY: headerEntrance.interpolate({ inputRange: [0, 1], outputRange: [5, 0] }) }],
  };
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
        <View style={{ width: 4, height: 24, borderRadius: 2, backgroundColor: withAlpha(colors.accent, 0.78) }} />
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
      {art && artSize ? (
        <Animated.View style={entranceStyle}>
        <View style={{
          width: artSize,
          height: artSize,
          borderRadius: radius.md,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: withAlpha(illustrationColor(art, colors), 0.11),
          borderWidth: 1,
          borderColor: withAlpha(illustrationColor(art, colors), 0.22),
          overflow: "hidden",
        }}>
          <Illustration kind={art} size={artSize - 6} />
        </View>
        </Animated.View>
      ) : null}
      <Animated.View style={[{ flex: 1 }, entranceStyle]}>
        <Text numberOfLines={1} accessibilityRole="header" style={{ ...typo.headline, color: colors.foreground }}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={{ ...typo.caption, fontFamily: typo.body.fontFamily, fontSize: 12.5, color: colors.mutedForeground, marginTop: 1 }}>
            {subtitle}
          </Text>
        ) : null}
      </Animated.View>
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
  /** Texte lu par le lecteur d'écran (obligatoire : un nom d'icône anglais n'est pas un libellé). */
  label: string;
}) {
  const colors = useColors();
  return (
    <PressableScale
      hitSlop={8}
      scaleTo={0.88}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={{ opacity: disabled ? stateOpacity.disabled : 1 }}
      contentStyle={({ pressed }) => [{ width: touch.min, height: touch.min, alignItems: "center", justifyContent: "center", borderRadius: radius.pill }, pressed && { backgroundColor: colors.secondary }]}
    >
      <Feather name={icon} size={20} color={color ?? colors.foreground} />
    </PressableScale>
  );
}

/**
 * Carte : surface sobre à bordure discrète. L'ancien décor (filet cyan + point vert
 * sur CHAQUE carte) est retiré ; `accent` marque seulement les cartes qui portent
 * un état (succès, alerte, IA…).
 */
export function Card({ children, style, accent }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; accent?: string }) {
  const colors = useColors();
  return (
    <View
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: accent ? withAlpha(accent, 0.32) : colors.border,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {accent ? <View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 3, backgroundColor: accent }} /> : null}
      {children}
    </View>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", minHeight: 28, marginTop: space.xl + 2, marginBottom: space.sm, paddingHorizontal: space.xs }}>
      <Text accessibilityRole="header" style={{ flex: 1, ...typo.label, color: colors.mutedForeground }}>
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
  const border = variant === "danger" ? withAlpha(colors.destructive, 0.35) : variant === "ghost" ? "transparent" : colors.border;
  return (
    <PressableScale
      onPress={onPress}
      haptic
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={[{ opacity: disabled ? stateOpacity.disabled : 1 }, style]}
      contentStyle={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: space.sm,
          backgroundColor: bg,
          borderRadius: radius.md,
          borderWidth: variant === "primary" ? 0 : 1,
          borderColor: border,
          paddingHorizontal: small ? space.md : space.lg,
          // Même en petit format, la zone tactile reste à 44 px minimum.
          minHeight: small ? touch.min : touch.comfortable,
          paddingVertical: small ? 6 : 10,
        },
        pressed && { opacity: stateOpacity.pressed },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Feather name={icon} size={small ? 14 : 16} color={fg} />
      ) : null}
      <Text style={{ ...typo.bodyStrong, lineHeight: undefined, fontSize: small ? 13 : 14.5, color: fg }} numberOfLines={1}>
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
          paddingHorizontal: space.lg - 2,
          paddingVertical: space.md,
          minHeight: 54,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderColor: colors.border,
        },
        pressed && onPress && { backgroundColor: colors.secondary },
      ]}
    >
      <View style={{ width: 32, height: 32, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: withAlpha(tint, 0.12) }}>
        <Feather name={icon} size={15} color={tint} />
      </View>
      <Text
        numberOfLines={1}
        style={{ flex: 1, ...typo.body, fontFamily: typo.bodyStrong.fontFamily, lineHeight: undefined, color: danger ? colors.destructive : colors.foreground }}
      >
        {label}
      </Text>
      {right ??
        (value ? (
          <Text numberOfLines={1} style={{ ...typo.caption, fontSize: 13, fontFamily: typo.body.fontFamily, color: colors.mutedForeground, maxWidth: "45%" }}>
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
      <Text accessibilityRole="header" style={{ ...typo.title, color: colors.foreground, textAlign: "center", marginTop: art ? 6 : 0 }}>{text}</Text>
      {hint ? (
        <Text style={{ ...typo.body, fontSize: 13.5, lineHeight: 20, color: colors.mutedForeground, textAlign: "center", maxWidth: 320 }}>{hint}</Text>
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
  error,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
  multiline?: boolean;
  keyboardType?: "default" | "number-pad" | "email-address" | "url";
  hint?: string;
  /** Message d'erreur affiché sous le champ (bordure rouge, lu par le lecteur d'écran). */
  error?: string;
}) {
  const colors = useColors();
  const { t } = useI18n();
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(false);
  return (
    <View style={{ marginBottom: space.lg - 2 }}>
      <Text style={{ ...typo.label, color: error ? colors.destructive : colors.mutedForeground, marginBottom: 6 }}>{label}</Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: multiline ? "flex-start" : "center",
          backgroundColor: colors.input,
          borderColor: error ? colors.destructive : focused ? colors.borderStrong : colors.border,
          borderWidth: 1,
          borderRadius: radius.md,
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
          accessibilityHint={error}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1,
            color: colors.foreground,
            paddingHorizontal: space.md,
            paddingVertical: 11,
            fontSize: typo.body.fontSize,
            fontFamily: typo.body.fontFamily,
            minHeight: multiline ? 76 : touch.comfortable,
            textAlignVertical: multiline ? "top" : "center",
          }}
        />
        {secure ? (
          <Pressable
            hitSlop={8}
            onPress={() => setReveal((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={t(reveal ? "a11y.hide" : "a11y.show")}
            style={{ minWidth: touch.min, minHeight: touch.min, alignItems: "center", justifyContent: "center" }}
          >
            <Feather name={reveal ? "eye-off" : "eye"} size={17} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={{ ...typo.caption, fontSize: 12.5, color: colors.destructive, marginTop: 6 }}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={{ ...typo.caption, fontSize: 12.5, fontFamily: typo.body.fontFamily, lineHeight: 18, color: colors.mutedForeground, marginTop: 6 }}>{hint}</Text>
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
        style={{ flexDirection: "row", padding: 3, gap: 3, borderRadius: radius.md, backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.border, marginBottom: space.md }}
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
                minHeight: 40,
                paddingHorizontal: 6,
                borderRadius: radius.sm + 1,
                backgroundColor: on ? colors.elevated : "transparent",
                borderWidth: on ? 1 : 0,
                borderColor: colors.borderStrong,
              }}
            >
              <Text numberOfLines={1} style={{ ...typo.label, lineHeight: undefined, color: on ? colors.accent : colors.mutedForeground }}>
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
              paddingHorizontal: space.md,
              minHeight: 40,
              justifyContent: "center",
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: on ? colors.borderStrong : colors.border,
              backgroundColor: on ? colors.greenBg : "transparent",
            }}
          >
            <Text style={{ ...typo.label, lineHeight: undefined, color: on ? colors.accent : colors.foreground }}>{o.label}</Text>
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
        <View style={[styles.box, { backgroundColor: colors.cardSolid, borderColor: colors.border, borderRadius: radius.xl }]}>
          <Text accessibilityRole="header" style={{ ...typo.title, color: colors.foreground, marginBottom: space.lg - 2 }}>{title}</Text>
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
      return colors.warning;
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

