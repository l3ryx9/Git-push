// Thème Git-Push : encre vert-nuit + surfaces « verre » posées sur le fond
// graphe de commits (assets/images/bg.webp, voir components/AppBackground).
//
// Principe : le fond graphe de commits est l'élément marquant ; tout le reste
// reste sobre. L'ancien vert « néon » (#00ff41) est remplacé par un vert plus
// doux, lisible longtemps, et chaque usage a sa couleur nommée (succès,
// alerte, IA…) au lieu de codes couleur dispersés dans les écrans.
const colors = {
  dark: {
    text: "#e8f0ec",
    tint: "#4be08f",

    // Couleur unie sous l'image de fond (identique à son ton dominant).
    background: "#080f0d",
    foreground: "#e8f0ec",

    // Surfaces translucides : le fond reste visible à travers.
    card: "rgba(15, 27, 24, 0.94)",
    cardForeground: "#e8f0ec",
    // Surfaces opaques : feuilles, boîtes de dialogue, barre d'onglets.
    cardSolid: "#101d19",
    // Surface surélevée (notifications, menus).
    elevated: "#172821",
    tabBar: "rgba(12, 22, 19, 0.98)",

    primary: "#38d27f",
    primaryForeground: "#03140b",

    secondary: "rgba(255, 255, 255, 0.06)",
    secondaryForeground: "#e8f0ec",

    muted: "rgba(255, 255, 255, 0.05)",
    mutedForeground: "#a0b3aa",

    accent: "#4be08f",
    accentForeground: "#03140b",

    destructive: "#ff6b6b",
    destructiveForeground: "#ffffff",
    destructiveBg: "rgba(255, 107, 107, 0.12)",

    border: "rgba(190, 230, 210, 0.14)",
    borderStrong: "rgba(75, 224, 143, 0.38)",
    input: "rgba(0, 0, 0, 0.38)",

    // Noms historiques (utilisés par les écrans) : alignés sur l'accent.
    green: "#4be08f",
    greenDim: "#38d27f",
    greenBg: "rgba(75, 224, 143, 0.12)",

    // Sens précis.
    success: "#56d364",
    warning: "#f0b94a",
    warningBg: "rgba(240, 185, 74, 0.12)",
    info: "#6cb6ff",
    /** Tout ce qui relève de l'agent IA. */
    ai: "#9d8cff",
    aiBg: "rgba(157, 140, 255, 0.13)",
    diffAdd: "#56d364",
    diffDel: "#f85149",

    // Couleurs des voies du graphe (reprises dans l'interface).
    cyan: "#22d3ee",
    violet: "#a78bfa",
    amber: "#f0b94a",
    blue: "#6cb6ff",
  },
  radius: 18,
  radiusSm: 12,
  radiusLg: 24,
};

/** "#22d3ee" + 0.12 → "rgba(34, 211, 238, 0.12)" */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export default colors;

/** Jetons de couleur accessibles partout (y compris hors composant). */
export const C = colors.dark;
