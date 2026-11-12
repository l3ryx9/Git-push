import { router } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

import { AppBackground } from "@/components/AppBackground";
import { useColors } from "@/hooks/useColors";

/**
 * Cible du retour OAuth (gitcrush://oauth-callback?code=…). Le code est lu
 * directement par l'écran qui a lancé la connexion : celui-ci se referme.
 */
export default function OAuthCallback() {
  const colors = useColors();
  useEffect(() => {
    const t = setTimeout(() => {
      if (router.canGoBack()) router.back();
      else router.replace("/accounts" as any);
    }, 50);
    return () => clearTimeout(t);
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
      <AppBackground />
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}
