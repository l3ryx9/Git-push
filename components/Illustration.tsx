import { Feather } from "@expo/vector-icons";
import React from "react";
import { View, type ViewStyle } from "react-native";

import { withAlpha } from "@/constants/colors";
import { useColors } from "@/hooks/useColors";

/**
 * Illustrations de Git-Push : dessinées en vues (formes arrondies + icônes), donc
 * - aucune dépendance (pas de react-native-svg), aucun fichier image à charger ;
 * - nettes à toutes les densités d'écran, légères, hors ligne ;
 * - même langage graphique partout : une forme principale pleine, une forme en retrait
 *   translucide, un badge d'action.
 * Elles sont purement décoratives (masquées aux lecteurs d'écran) : le titre de la
 * carte porte le sens.
 */

export type IllustrationKind =
  | "repos"
  | "clone"
  | "newRepo"
  | "sync"
  | "branches"
  | "history"
  | "changes"
  | "conflicts"
  | "empty"
  | "success";

// Teintes propres aux illustrations (en plus des couleurs du thème).
const PINK = "#f472b6";
const ORANGE = "#fb923c";

/** Couleur de chaque raccourci : la même sur la carte, l'illustration et les pastilles. */
export function illustrationColor(kind: IllustrationKind, c: ReturnType<typeof useColors>): string {
  switch (kind) {
    case "repos":
      return c.amber;
    case "clone":
      return c.cyan;
    case "newRepo":
      return c.accent;
    case "sync":
      return c.blue;
    case "branches":
      return c.violet;
    case "history":
      return PINK;
    case "changes":
      return ORANGE;
    case "conflicts":
      return c.destructive;
    case "success":
      return c.success;
    default:
      return c.accent;
  }
}

interface BoxProps {
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number;
  bg?: string;
  border?: string;
  bw?: number;
  rot?: number;
  style?: ViewStyle;
  children?: React.ReactNode;
}

/** Rectangle positionné dans une grille de 64 × 64. */
function Box({ x, y, w, h, r = 0, bg, border, bw = 0, rot, style, children }: BoxProps) {
  return (
    <View
      style={[
        {
          position: "absolute",
          left: x,
          top: y,
          width: w,
          height: h,
          borderRadius: r,
          backgroundColor: bg,
          borderColor: border,
          borderWidth: bw,
          transform: rot ? [{ rotate: `${rot}deg` }] : undefined,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Cercle centré en (cx, cy). */
function Dot({ cx, cy, d, bg, border, bw }: { cx: number; cy: number; d: number; bg?: string; border?: string; bw?: number }) {
  return <Box x={cx - d / 2} y={cy - d / 2} w={d} h={d} r={d / 2} bg={bg} border={border} bw={bw} />;
}

/** Segment entre deux points (épaisseur t). */
function Seg({ x1, y1, x2, y2, t = 3, bg }: { x1: number; y1: number; x2: number; y2: number; t?: number; bg: string }) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  return <Box x={cx - len / 2} y={cy - t / 2} w={len} h={t} r={t / 2} bg={bg} rot={angle} />;
}

/** Pastille d'action (flèche, plus, alerte…) posée sur un coin. */
function Badge({ cx, cy, icon, color, ink }: { cx: number; cy: number; icon: React.ComponentProps<typeof Feather>["name"]; color: string; ink: string }) {
  return (
    <>
      <Dot cx={cx} cy={cy} d={26} bg={ink} />
      <Dot cx={cx} cy={cy} d={20} bg={color} />
      <View style={{ position: "absolute", left: cx - 10, top: cy - 10, width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
        <Feather name={icon} size={12} color={ink} />
      </View>
    </>
  );
}

function Scene({ kind, color, ink }: { kind: IllustrationKind; color: string; ink: string }) {
  const soft = withAlpha(color, 0.3);
  const mid = withAlpha(color, 0.55);
  switch (kind) {
    case "repos":
      return (
        <>
          {/* deux dossiers empilés */}
          <Box x={10} y={9} w={22} h={10} r={5} bg={soft} />
          <Box x={10} y={14} w={44} h={30} r={9} bg={soft} />
          <Box x={6} y={22} w={22} h={10} r={5} bg={mid} />
          <Box x={6} y={27} w={52} h={30} r={10} bg={color} />
          <Box x={13} y={37} w={22} h={4} r={2} bg={withAlpha(ink, 0.55)} />
          <Box x={13} y={45} w={13} h={4} r={2} bg={withAlpha(ink, 0.35)} />
          <Dot cx={48} cy={42} d={9} bg={ink} />
          <Dot cx={48} cy={42} d={4} bg={color} />
        </>
      );
    case "clone":
      return (
        <>
          <Box x={22} y={8} w={34} h={36} r={9} bg={soft} />
          <Box x={10} y={16} w={36} h={38} r={10} bg={color} />
          <Box x={17} y={26} w={22} h={4} r={2} bg={withAlpha(ink, 0.55)} />
          <Box x={17} y={34} w={14} h={4} r={2} bg={withAlpha(ink, 0.35)} />
          <Badge cx={48} cy={48} icon="arrow-down" color={mid} ink={ink} />
        </>
      );
    case "newRepo":
      return (
        <>
          <Box x={8} y={14} w={24} h={10} r={5} bg={mid} />
          <Box x={8} y={19} w={48} h={34} r={10} bg={color} />
          <Box x={15} y={42} w={20} h={4} r={2} bg={withAlpha(ink, 0.45)} />
          <Badge cx={47} cy={17} icon="plus" color={color} ink={ink} />
        </>
      );
    case "sync":
      return (
        <>
          <Dot cx={32} cy={32} d={52} bg={soft} />
          <Dot cx={32} cy={32} d={38} bg={color} />
          <View style={{ position: "absolute", left: 18, top: 18, width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
            <Feather name="refresh-cw" size={20} color={ink} />
          </View>
          <Dot cx={52} cy={12} d={7} bg={mid} />
          <Dot cx={10} cy={52} d={5} bg={mid} />
        </>
      );
    case "branches":
      return (
        <>
          <Box x={19} y={12} w={4} h={40} r={2} bg={color} />
          {/* bifurcation : la branche part du tronc et s'écarte vers la droite */}
          <Box x={21} y={20} w={26} h={20} bg="transparent" border={mid} bw={4} style={{ borderTopWidth: 0, borderRightWidth: 0, borderBottomLeftRadius: 14, borderBottomRightRadius: 0, borderTopLeftRadius: 0 }} />
          <Dot cx={21} cy={12} d={13} bg={ink} border={color} bw={3.5} />
          <Dot cx={21} cy={52} d={13} bg={color} />
          <Dot cx={47} cy={40} d={13} bg={ink} border={mid} bw={3.5} />
          <Dot cx={47} cy={14} d={7} bg={soft} />
        </>
      );
    case "history":
      return (
        <>
          <Box x={13} y={10} w={4} h={44} r={2} bg={soft} />
          {[14, 32, 50].map((cy, i) => (
            <React.Fragment key={cy}>
              <Dot cx={15} cy={cy} d={13} bg={i === 0 ? color : ink} border={color} bw={3.5} />
              <Box x={27} y={cy - 6} w={[26, 20, 24][i]} h={5} r={2.5} bg={i === 0 ? color : mid} />
              <Box x={27} y={cy + 2} w={[16, 26, 12][i]} h={4} r={2} bg={soft} />
            </React.Fragment>
          ))}
        </>
      );
    case "changes":
      return (
        <>
          <Box x={13} y={6} w={38} h={50} r={9} bg={soft} />
          <Box x={9} y={10} w={38} h={50} r={9} bg={color} />
          <Box x={15} y={20} w={26} h={6} r={3} bg={withAlpha(ink, 0.7)} />
          <Box x={15} y={30} w={20} h={6} r={3} bg={withAlpha(ink, 0.45)} />
          <Box x={15} y={40} w={24} h={6} r={3} bg={withAlpha(ink, 0.3)} />
          <Badge cx={48} cy={48} icon="edit-2" color="#ffffff" ink={ink} />
        </>
      );
    case "conflicts":
      return (
        <>
          <Seg x1={14} y1={11} x2={32} y2={36} bg={mid} />
          <Seg x1={50} y1={11} x2={32} y2={36} bg={color} />
          <Seg x1={32} y1={36} x2={32} y2={53} bg={color} t={4} />
          <Dot cx={14} cy={11} d={13} bg={ink} border={mid} bw={3.5} />
          <Dot cx={50} cy={11} d={13} bg={ink} border={color} bw={3.5} />
          <Dot cx={32} cy={36} d={15} bg={color} />
          <Dot cx={32} cy={36} d={6} bg={ink} />
          <Badge cx={47} cy={50} icon="alert-triangle" color="#ffd166" ink={ink} />
        </>
      );
    case "success":
      return (
        <>
          <Dot cx={32} cy={32} d={54} bg={soft} />
          <Dot cx={32} cy={32} d={38} bg={color} />
          <View style={{ position: "absolute", left: 18, top: 18, width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
            <Feather name="check" size={22} color={ink} />
          </View>
        </>
      );
    default:
      // « empty » : dossier vide en pointillés
      return (
        <>
          <Box x={8} y={14} w={24} h={10} r={5} bg={soft} />
          <Box x={8} y={19} w={48} h={34} r={10} bg="transparent" border={mid} bw={3} />
          <Dot cx={32} cy={36} d={5} bg={mid} />
          <Dot cx={22} cy={36} d={5} bg={soft} />
          <Dot cx={42} cy={36} d={5} bg={soft} />
        </>
      );
  }
}

/**
 * Illustration d'un raccourci ou d'un état vide. `size` redimensionne tout le dessin
 * (grille interne de 64 × 64).
 */
export function Illustration({ kind, size = 64 }: { kind: IllustrationKind; size?: number }) {
  const colors = useColors();
  const color = illustrationColor(kind, colors);
  const scale = size / 64;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, overflow: "hidden" }}
    >
      <View style={{ width: 64, height: 64, transform: [{ scale }], transformOrigin: "0% 0%" }}>
        <Scene kind={kind} color={color} ink={colors.cardSolid} />
      </View>
    </View>
  );
}

/**
 * Bandeau d'accueil : le graphe de commits (tronc + deux branches + fusion) qui est
 * la signature visuelle de l'app, dessiné ici en grand.
 */
export function HeroGraph({ width = 132, height = 96 }: { width?: number; height?: number }) {
  const colors = useColors();
  const sx = width / 132;
  const sy = height / 96;
  const lane = (x: number) => x;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, overflow: "hidden" }}
    >
      <View style={{ width: 132, height: 96, transform: [{ scaleX: sx }, { scaleY: sy }], transformOrigin: "0% 0%" }}>
        {/* trois voies */}
        <Box x={lane(24)} y={8} w={4} h={80} r={2} bg={withAlpha(colors.accent, 0.9)} />
        <Seg x1={26} y1={30} x2={64} y2={48} bg={withAlpha(colors.violet, 0.8)} />
        <Box x={62} y={48} w={4} h={28} r={2} bg={withAlpha(colors.violet, 0.8)} />
        <Seg x1={64} y1={76} x2={26} y2={86} bg={withAlpha(colors.violet, 0.8)} />
        <Seg x1={26} y1={18} x2={104} y2={30} bg={withAlpha(colors.cyan, 0.7)} />
        <Box x={102} y={30} w={4} h={40} r={2} bg={withAlpha(colors.cyan, 0.7)} />
        <Seg x1={104} y1={70} x2={26} y2={86} bg={withAlpha(colors.cyan, 0.7)} />
        {/* commits */}
        <Dot cx={26} cy={10} d={14} bg={colors.cardSolid} border={colors.accent} bw={3.5} />
        <Dot cx={26} cy={30} d={12} bg={colors.accent} />
        <Dot cx={64} cy={50} d={12} bg={colors.cardSolid} border={colors.violet} bw={3} />
        <Dot cx={64} cy={74} d={12} bg={colors.violet} />
        <Dot cx={104} cy={32} d={12} bg={colors.cardSolid} border={colors.cyan} bw={3} />
        <Dot cx={104} cy={60} d={12} bg={colors.cyan} />
        <Dot cx={26} cy={86} d={16} bg={colors.accent} />
        <Dot cx={26} cy={86} d={7} bg={colors.cardSolid} />
      </View>
    </View>
  );
}
