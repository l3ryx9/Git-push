import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { AppState, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Btn, Card, describeError, ScreenHeader, SectionTitle } from "@/components/GitUi";
import { PickerModal } from "@/components/PickerModal";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import { showAlert, showConfirm } from "@/utils/dialogs";
import { getWatchRules, Native, saveWatchRules, type WatchRule } from "@/utils/native";

const ALL = "__all__";

/**
 * Synchronisation avancée (Android) : tuile des Réglages rapides, widget d'écran d'accueil
 * et synchro à l'ouverture / fermeture d'autres applications (service d'accessibilité).
 */
export default function NativeSyncScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { containers } = useRepos();

  const [rules, setRules] = useState<WatchRule[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [apps, setApps] = useState<{ pkg: string; label: string }[] | null>(null);
  const [loadingApps, setLoadingApps] = useState(false);
  const [pickApp, setPickApp] = useState(false);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<{ pkg: string; label: string } | null>(null);

  const refresh = useCallback(() => {
    if (!Native) return;
    setRules(getWatchRules());
    try {
      setEnabled(Native.isAccessibilityEnabled());
    } catch {
      setEnabled(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  // Au retour des réglages système, on relit l'état du service.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const update = (next: WatchRule[]) => {
    setRules(next);
    saveWatchRules(next);
  };

  async function addTile() {
    if (!Native) return;
    try {
      const code = await Native.requestAddTile();
      if (code === 2) showAlert(t("n.tile.title"), t("n.tile.added"));
      else if (code === 1) showAlert(t("n.tile.title"), t("n.tile.already"));
      else if (code === -1 || code >= 1000) showAlert(t("n.tile.title"), t("n.tile.manual"));
    } catch {
      showAlert(t("n.tile.title"), t("n.tile.manual"));
    }
  }

  function addWidget() {
    if (!Native) return;
    try {
      if (!Native.requestPinWidget()) showAlert(t("n.widget.title"), t("n.widget.manual"));
    } catch {
      showAlert(t("n.widget.title"), t("n.widget.manual"));
    }
  }

  // Divulgation visible exigée avant d'envoyer l'utilisateur activer un service d'accessibilité.
  function enableService() {
    showConfirm({
      title: t("n.acc.disclosureTitle"),
      message: t("n.acc.disclosure"),
      confirmText: t("n.acc.agree"),
      cancelText: t("msg.cancel"),
      onConfirm: () => {
        try {
          Native?.openAccessibilitySettings();
        } catch (e) {
          showAlert(t("n.acc.title"), describeError(e, t));
        }
      },
    });
  }

  async function openAppPicker() {
    setPickApp(true);
    if (apps || !Native) return;
    setLoadingApps(true);
    try {
      setApps(await Native.getLaunchableApps());
    } catch (e) {
      showAlert(t("n.acc.title"), describeError(e, t));
      setPickApp(false);
    } finally {
      setLoadingApps(false);
    }
  }

  function addRule(repo: string) {
    const app = chosen;
    setChosen(null);
    if (!app) return;
    if (rules.some((r) => r.pkg === app.pkg && r.repo === repo)) {
      showAlert(t("n.acc.title"), t("n.acc.duplicate"));
      return;
    }
    update([...rules, { pkg: app.pkg, label: app.label, repo, onOpen: true, onClose: false }]);
  }

  const repoName = (id: string) => (id ? containers.find((c) => c.id === id)?.name ?? t("n.acc.repoMissing") : t("n.acc.allRepos"));
  const filteredApps = (apps ?? []).filter((a) => a.label.toLowerCase().includes(search.trim().toLowerCase()) || a.pkg.includes(search.trim().toLowerCase()));

  const sw = (label: string, value: boolean, onChange: (v: boolean) => void) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary }} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title={t("n.advanced.title")} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 40 }}>
        {!Native ? (
          <Card style={{ padding: 14 }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 19 }}>{t("n.unavailable")}</Text>
          </Card>
        ) : (
          <>
            <SectionTitle>{t("n.tile.title")}</SectionTitle>
            <Card style={{ padding: 14, gap: 10 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 17 }}>{t("n.tile.desc")}</Text>
              <Btn label={t("n.tile.add")} icon="grid" onPress={addTile} />
            </Card>

            <SectionTitle>{t("n.widget.title")}</SectionTitle>
            <Card style={{ padding: 14, gap: 10 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 17 }}>{t("n.widget.desc")}</Text>
              <Btn label={t("n.widget.add")} icon="layout" onPress={addWidget} />
            </Card>

            <SectionTitle>{t("n.acc.title")}</SectionTitle>
            <Card style={{ padding: 14, gap: 10 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 17 }}>{t("n.acc.desc")}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Feather name={enabled ? "check-circle" : "alert-circle"} size={16} color={enabled ? colors.accent : "#e3b341"} />
                <Text style={{ flex: 1, color: enabled ? colors.accent : "#e3b341", fontSize: 13, fontFamily: "Inter_600SemiBold" }}>
                  {enabled ? t("n.acc.on") : t("n.acc.off")}
                </Text>
              </View>
              <Btn label={enabled ? t("n.acc.manage") : t("n.acc.enable")} icon="shield" variant={enabled ? "secondary" : "primary"} onPress={enableService} />
            </Card>

            <SectionTitle>{t("n.rules.title")}</SectionTitle>
            <Card>
              {rules.length === 0 ? (
                <Text style={{ color: colors.mutedForeground, padding: 14, fontSize: 12, lineHeight: 17 }}>{t("n.rules.empty")}</Text>
              ) : (
                rules.map((r, i) => (
                  <View key={`${r.pkg}|${r.repo}`} style={[{ padding: 13, gap: 8 }, i < rules.length - 1 && { borderBottomWidth: 1, borderColor: colors.border }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_600SemiBold" }} numberOfLines={1}>
                          {r.label}
                        </Text>
                        <Text style={{ color: colors.mutedForeground, fontSize: 11 }} numberOfLines={1}>
                          → {repoName(r.repo)}
                        </Text>
                      </View>
                      <Pressable hitSlop={10} onPress={() => update(rules.filter((x) => x !== r))}>
                        <Feather name="trash-2" size={16} color={colors.mutedForeground} />
                      </Pressable>
                    </View>
                    <View style={{ flexDirection: "row", gap: 18 }}>
                      {sw(t("n.rules.onOpen"), r.onOpen, (v) => update(rules.map((x) => (x === r ? { ...x, onOpen: v } : x))))}
                      {sw(t("n.rules.onClose"), r.onClose, (v) => update(rules.map((x) => (x === r ? { ...x, onClose: v } : x))))}
                    </View>
                  </View>
                ))
              )}
            </Card>
            <Btn label={t("n.rules.add")} icon="plus" onPress={openAppPicker} style={{ marginTop: 10 }} />
            <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 10, lineHeight: 16, paddingHorizontal: 4 }}>{t("n.rules.note")}</Text>
          </>
        )}
      </ScrollView>

      <PickerModal
        visible={pickApp}
        title={t("n.rules.pickApp")}
        loading={loadingApps}
        searchable
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("files.search")}
        emptyLabel={t("n.rules.noApp")}
        items={filteredApps.map((a) => ({ key: a.pkg, label: a.label, icon: "repo" as const }))}
        onSelect={(key) => {
          const app = (apps ?? []).find((a) => a.pkg === key);
          setPickApp(false);
          setSearch("");
          if (app) setChosen(app);
        }}
        onClose={() => {
          setPickApp(false);
          setSearch("");
        }}
      />
      <PickerModal
        visible={!!chosen}
        title={t("n.rules.pickRepo", { app: chosen?.label ?? "" })}
        emptyLabel={t("g.repos.empty")}
        items={[{ key: ALL, label: t("n.acc.allRepos"), icon: "repo" as const }, ...containers.map((c) => ({ key: c.id, label: c.name, icon: "git-branch" as const }))]}
        onSelect={(key) => addRule(key === ALL ? "" : key)}
        onClose={() => setChosen(null)}
      />
    </View>
  );
}
