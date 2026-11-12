/**
 * Design system Git-Push — direction « Terminal de nuit ».
 *
 * Principes :
 * - Le vert d'accent sert UNIQUEMENT à l'action et à l'état actif (bouton principal,
 *   onglet sélectionné, succès). Les données Git (graphe, voies) gardent le cyan,
 *   l'IA le violet : une couleur = un sens.
 * - L'identité « Matrix » passe par le monospace des identifiants Git (SHA, branches,
 *   chemins) et par l'écran de progression du push — pas par des effets décoratifs
 *   répétés sur chaque carte.
 * - Une échelle typographique courte (7 tailles) et un plancher de 11 pt.
 *
 * Fichier sans dépendance React Native : testable avec `npm test`.
 */

/** Espacements (multiples de 4). */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
} as const;

/**
 * Rayons : la hiérarchie se lit dans l'arrondi. Petits éléments (pastilles de fichiers,
 * icônes) < champs et boutons < cartes < feuilles et modales.
 */
export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

/** Familles chargées dans app/_layout.tsx (Inter) + monospace système pour Git. */
export const font = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  mono: "monospace",
} as const;

/** Taille de texte minimale tolérée dans l'interface (lisibilité). */
export const MIN_FONT_SIZE = 11;

/**
 * Échelle typographique (rapport ~1,2). Chaque style porte sa taille, sa graisse et
 * son interlignage : un écran choisit un rôle, pas une valeur.
 */
export const typography = {
  /** Métadonnées secondaires : dates, compteurs, pastilles. */
  caption: { fontSize: 11.5, lineHeight: 16, fontFamily: font.medium },
  /** Libellés de champs, titres de section, aides. */
  label: { fontSize: 13, lineHeight: 18, fontFamily: font.semibold },
  /** Texte courant. */
  body: { fontSize: 14.5, lineHeight: 21, fontFamily: font.regular },
  /** Texte d'une ligne de liste, d'un bouton. */
  bodyStrong: { fontSize: 14.5, lineHeight: 20, fontFamily: font.semibold },
  /** Titre de carte ou de modale. */
  title: { fontSize: 17, lineHeight: 23, fontFamily: font.bold },
  /** Titre d'écran. */
  headline: { fontSize: 20, lineHeight: 26, fontFamily: font.bold, letterSpacing: -0.3 },
  /** Grand titre (accueil). */
  display: { fontSize: 26, lineHeight: 32, fontFamily: font.bold, letterSpacing: -0.5 },
  /** Identifiants Git : SHA, branches, chemins, sortie de commande. */
  code: { fontSize: 12.5, lineHeight: 18, fontFamily: font.mono },
} as const;

/** Zones tactiles (Material : 48 dp ; jamais moins de 44). */
export const touch = {
  min: 44,
  comfortable: 48,
} as const;

/** Durées d'animation (ms) : courtes, jamais bloquantes. */
export const motion = {
  press: 90,
  fast: 160,
  base: 240,
  slow: 320,
} as const;

/** Opacités des états. */
export const stateOpacity = {
  disabled: 0.4,
  pressed: 0.85,
} as const;

/** Arrondit une taille de texte au plancher de lisibilité. */
export function readableSize(size: number): number {
  return Math.max(MIN_FONT_SIZE, size);
}
