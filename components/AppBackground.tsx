import { Image } from "expo-image";
import React from "react";
import { StyleSheet, View } from "react-native";

// Fond « graphe de commits » (voies, fourches, fusions) généré une fois en WebP.
const BG = require("../assets/images/bg.webp");

/**
 * Fond stylisé commun à tous les écrans.
 * À placer comme PREMIER enfant de la vue racine de l'écran (qui garde
 * `backgroundColor: colors.background` pour des transitions propres).
 */
export function AppBackground() {
  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: "none" }]}>
      <Image
        source={BG}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        contentPosition="top"
        cachePolicy="memory"
        transition={0}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: "rgba(5, 12, 10, 0.48)" },
        ]}
      />
    </View>
  );
}
