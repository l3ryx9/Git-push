import colors from "@/constants/colors";

export type Colors = typeof colors.dark & { radius: number };

// Git-Push is always dark — matches the GitHub aesthetic
export function useColors(): Colors {
  return { ...colors.dark, radius: colors.radius };
}
