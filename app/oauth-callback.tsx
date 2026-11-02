import { router } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

/**
 * Cible du retour OAuth (gitcrush://oauth-callback?code=…). Le code est lu
 * directement par l'écran qui a lancé la connexion : celui-ci se referme.
 */
export default function OAuthCallback() {
  useEffect(() => {
    const t = setTimeout(() => {
      if (router.canGoBack()) router.back();
      else router.replace("/accounts" as any);
    }, 50);
    return () => clearTimeout(t);
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: "#0a0a0a", alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color="#00ff41" />
    </View>
  );
}
