// Polyfills (Buffer, TextDecoder) requis par le moteur Git : doivent rester en tête.
import "@/utils/polyfills";
// Définit la tâche de synchronisation en arrière-plan dès le démarrage.
import "@/utils/git/background";

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GitHubProvider } from "@/context/GitHubContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { ReposProvider } from "@/context/ReposContext";
import { installGlobalErrorLogging } from "@/utils/errorLog";
import { runSecretsMigration } from "@/utils/secretsMigration";

SplashScreen.preventAutoHideAsync();
installGlobalErrorLogging();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false, animation: "fade" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // Anciennes clés / tokens en clair → coffre sécurisé du téléphone (une seule fois, en silence).
  useEffect(() => {
    void runSecretsMigration();
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <LanguageProvider>
                <GitHubProvider>
                  <ReposProvider>
                    <RootLayoutNav />
                  </ReposProvider>
                </GitHubProvider>
              </LanguageProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
