import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { AgentChat } from "@/components/AgentChat";
import { Btn, Empty } from "@/components/GitUi";
import { PickerModal } from "@/components/PickerModal";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";

const LAST_REPO = "@gitcrush_ai_repo";

/** Onglet « Agent IA » : choisir un dépôt cloné puis lui demander des modifications. */
export default function AiTab() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { containers, ready } = useRepos();
  const params = useLocalSearchParams<{ repo?: string; prompt?: string }>();
  const [repoId, setRepoId] = useState<string | undefined>();
  const [picker, setPicker] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Dernier dépôt utilisé
  useEffect(() => {
    AsyncStorage.getItem(LAST_REPO)
      .then((v) => v && setRepoId((cur) => cur ?? v))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  // Dépôt demandé par un lien (page du dépôt, nouveau dépôt…)
  useEffect(() => {
    if (params.repo) setRepoId(params.repo);
  }, [params.repo]);

  // Dépôt valide : sinon le premier de la liste
  const valid = repoId && containers.some((c) => c.id === repoId) ? repoId : containers[0]?.id;

  useEffect(() => {
    if (valid) AsyncStorage.setItem(LAST_REPO, valid).catch(() => undefined);
  }, [valid]);

  if (!ready || !loaded) return <View style={{ flex: 1, backgroundColor: colors.background }}><AppBackground /></View>;

  if (!valid) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) + 20, paddingHorizontal: 16 }}>
        <AppBackground />
        <Empty icon="zap" text={t("aiTab.noRepo")} hint={t("aiTab.noRepoHint")} />
        <Btn label={t("newRepo.title")} icon="plus" variant="primary" onPress={() => router.push("/new-repo" as any)} />
        <Btn label={t("g.repos.cloneFirst")} icon="download-cloud" onPress={() => router.push("/clone" as any)} style={{ marginTop: 8 }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AgentChat
        key={valid}
        id={valid}
        embedded
        prompt={params.repo === valid ? params.prompt : undefined}
        onPickRepo={() => setPicker(true)}
      />
      <PickerModal
        visible={picker}
        title={t("aiTab.pick")}
        emptyLabel={t("g.repos.empty")}
        items={containers.map((c) => ({ key: c.id, label: c.name, icon: "repo" as const, selected: c.id === valid }))}
        onSelect={(key) => {
          setRepoId(key);
          setPicker(false);
        }}
        onClose={() => setPicker(false)}
      />
    </View>
  );
}
