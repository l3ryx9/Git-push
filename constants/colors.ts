// Thème Git-Push : encre vert-nuit + surfaces « verre » posées sur le fond
// graphe de commits (assets/images/bg.webp, voir components/AppBackground).
const colors = {
  dark: {
    text: "#e6efe9",
    tint: "#00ff41",

    // Couleur unie sous l'image de fond (identique à son ton dominant).
    background: "#050c0b",
    foreground: "#e6efe9",

    // Surfaces translucides : le fond reste visible à travers.
    card: "rgba(12, 24, 21, 0.80)",
    cardForeground: "#e6efe9",
    // Surfaces opaques : feuilles, boîtes de dialogue, barre d'onglets.
    cardSolid: "#0c1714",
    tabBar: "rgba(9, 19, 17, 0.95)",

    primary: "#00cc35",
    primaryForeground: "#000000",

    secondary: "rgba(255, 255, 255, 0.06)",
    secondaryForeground: "#e6efe9",

    muted: "rgba(255, 255, 255, 0.05)",
    mutedForeground: "#7f938b",

    accent: "#00ff41",
    accentForeground: "#000000",

    destructive: "#ff4d4d",
    destructiveForeground: "#ffffff",

    border: "rgba(160, 255, 200, 0.10)",
    borderStrong: "rgba(0, 255, 65, 0.22)",
    input: "rgba(0, 0, 0, 0.32)",

    green: "#00ff41",
    greenDim: "#00cc35",
    greenBg: "rgba(0, 255, 65, 0.10)",

    // Couleurs des voies du graphe (reprises dans l'interface).
    cyan: "#22d3ee",
    violet: "#a78bfa",
    amber: "#e3b341",
    blue: "#58a6ff",
  },
  radius: 12,
};

/** "#22d3ee" + 0.12 → "rgba(34, 211, 238, 0.12)" */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export default colors;
