import { Image } from "expo-image";
import React from "react";
import { StyleSheet, View } from "react-native";

import { withAlpha } from "@/constants/colors";
import { useColors } from "@/hooks/useColors";

// Fond « graphe de commits » commun, complété par quelques détails réseau très discrets.
const BG = require("../assets/images/bg.webp");

export function AppBackground() {
  const colors = useColors();
  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: "none", overflow: "hidden" }]}>
      <Image
        source={BG}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        contentPosition="top"
        cachePolicy="memory"
        transition={0}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(5, 12, 10, 0.52)" }]} />
      {/* Halo supérieur droit : rappelle le réseau planétaire sans concurrencer le contenu. */}
      <View style={{
        position: "absolute", top: -118, right: -92, width: 270, height: 270,
        borderRadius: 135, borderWidth: 1, borderColor: withAlpha(colors.cyan, 0.10),
      }} />
      <View style={{
        position: "absolute", top: -78, right: -52, width: 190, height: 190,
        borderRadius: 95, borderWidth: 1, borderColor: withAlpha(colors.accent, 0.08),
      }} />
      <View style={{
        position: "absolute", top: 38, right: 38, width: 7, height: 7,
        borderRadius: 4, backgroundColor: withAlpha(colors.cyan, 0.42),
      }} />
      <View style={{
        position: "absolute", top: 104, right: 126, width: 5, height: 5,
        borderRadius: 3, backgroundColor: withAlpha(colors.violet, 0.38),
      }} />
      {/* Petit motif de connexions dans le bas gauche. */}
      <View style={{
        position: "absolute", bottom: 112, left: -42, width: 126, height: 126,
        borderRadius: 63, borderWidth: 1, borderColor: withAlpha(colors.accent, 0.075),
      }} />
      <View style={{
        position: "absolute", bottom: 174, left: 22, width: 5, height: 5,
        borderRadius: 3, backgroundColor: withAlpha(colors.accent, 0.32),
      }} />
      <View style={{
        position: "absolute", bottom: 126, left: 64, width: 5, height: 5,
        borderRadius: 3, backgroundColor: withAlpha(colors.cyan, 0.30),
      }} />
      <View style={{
        position: "absolute", bottom: 130, left: 25, width: 46, height: 1,
        backgroundColor: withAlpha(colors.cyan, 0.14), transform: [{ rotate: "42deg" }],
      }} />
    </View>
  );
}
