import { Feather, Octicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import React from "react";
import * as Haptics from "expo-haptics";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAiSettings } from "@/components/AiUi";
import { withAlpha } from "@/constants/colors";
import { TAB_BAR_GAP, TAB_BAR_HEIGHT } from "@/constants/layout";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";

const RADIUS = 28;

/** Icône d'onglet : l'onglet actif est signalé par une pastille verte, pas seulement par la couleur de l'icône. */
function TabIcon({ focused, children }: { focused: boolean; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View
      style={{
        width: 60,
        height: 34,
        borderRadius: 17,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: focused ? withAlpha(colors.accent, 0.2) : "transparent",
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
      screenListeners={{
        tabPress: () => {
          Haptics.selectionAsync().catch(() => undefined);
        },
      }}
      screenOptions={{
        headerShown: false,
        // Onglets masqués « gelés » : ils ne se redessinent plus à chaque mise à jour
        // (progression d'une synchro, liste des dépôts…), l'onglet visible reste fluide.
        freezeOnBlur: true,
        lazy: true,
        animation: "shift",
        // Le fond de chaque écran est dessiné par l'écran lui-même (AppBackground).
        sceneStyle: { backgroundColor: colors.background },
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.mutedForeground,
        // Barre flottante arrondie, détachée du bas de l'écran.
        tabBarStyle: {
          position: "absolute",
          bottom: insets.bottom + TAB_BAR_GAP,
          marginHorizontal: 12,
          height: TAB_BAR_HEIGHT + 4,
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
                borderColor: colors.borderStrong,
                backgroundColor: isIOS ? "transparent" : colors.tabBar,
              },
            ]}
          >
            {isIOS ? <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} /> : null}
          </View>
        ),
        tabBarLabelStyle: {
          fontFamily: "Inter_600SemiBold",
          fontSize: 11.5,
          marginTop: 1,
        },
        // Chaque onglet occupe toute sa colonne : zone tactile bien supérieure à 48 px.
        tabBarItemStyle: { minHeight: 48 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.home"),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon focused={focused}>
              <Octicons name="home" size={21} color={color} />
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
              <Octicons name="repo" size={21} color={color} />
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
