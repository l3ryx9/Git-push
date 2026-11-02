import { Feather, Octicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAiSettings } from "@/components/AiUi";
import { TAB_BAR_GAP, TAB_BAR_HEIGHT } from "@/constants/layout";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";

const RADIUS = 22;

/** Icône d'onglet : une pastille verte signale l'onglet actif, pour tous les onglets. */
function TabIcon({ focused, children }: { focused: boolean; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View
      style={{
        width: 48,
        height: 30,
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: focused ? colors.greenBg : "transparent",
      }}
    >
      {children}
    </View>
  );
}

export default function TabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const ai = useAiSettings();
  const isIOS = Platform.OS === "ios";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Le fond de chaque écran est dessiné par l'écran lui-même (AppBackground).
        sceneStyle: { backgroundColor: colors.background },
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.mutedForeground,
        // Barre flottante arrondie, détachée du bas de l'écran.
        tabBarStyle: {
          position: "absolute",
          bottom: insets.bottom + TAB_BAR_GAP,
          marginHorizontal: 14,
          height: TAB_BAR_HEIGHT,
          paddingTop: 7,
          paddingBottom: 7,
          borderRadius: RADIUS,
          borderTopWidth: 0,
          backgroundColor: "transparent",
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarBackground: () => (
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                borderRadius: RADIUS,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: isIOS ? "transparent" : colors.tabBar,
              },
            ]}
          >
            {isIOS ? <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} /> : null}
          </View>
        ),
        tabBarLabelStyle: {
          fontFamily: "Inter_600SemiBold",
          fontSize: 10.5,
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.home"),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon focused={focused}>
              <Octicons name="home" size={20} color={color} />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="repos"
        options={{
          title: t("tabs.repos"),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon focused={focused}>
              <Octicons name="repo" size={20} color={color} />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="ai"
        options={{
          title: t("tabs.ai"),
          // IA désactivée dans les réglages : l'onglet est masqué.
          href: ai && !ai.enabled ? null : undefined,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon focused={focused}>
              <Feather name="zap" size={20} color={color} />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="files"
        options={{
          title: t("tabs.files"),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon focused={focused}>
              <Feather name="upload-cloud" size={20} color={color} />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("tabs.profile"),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon focused={focused}>
              <Feather name="user" size={20} color={color} />
            </TabIcon>
          ),
        }}
      />
    </Tabs>
  );
}
