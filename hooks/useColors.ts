import colors from "@/constants/colors";

export type Colors = typeof colors.dark & { radius: number; radiusSm: number; radiusLg: number };

// Objet UNIQUE et stable : avant, un nouvel objet était créé à chaque rendu, ce qui
// empêchait le React Compiler (et tout useMemo) de réutiliser les styles calculés
// dans chaque écran. Git-Push est toujours en thème sombre.
const THEME: Colors = { ...colors.dark, radius: colors.radius, radiusSm: colors.radiusSm, radiusLg: colors.radiusLg };

export function useColors(): Colors {
  return THEME;
}
