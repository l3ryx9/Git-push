import { Feather, Octicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { goForge } from "@/components/ForgeUi";
import { describeError, timeAgo } from "@/components/GitUi";
import { PickerModal } from "@/components/PickerModal";
import { withAlpha } from "@/constants/colors";
import { TAB_BAR_SPACE } from "@/constants/layout";
import { useGitHub } from "@/context/GitHubContext";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import { showAlert } from "@/utils/dialogs";

const ICON = require("../../assets/images/icon.png");

function hapticLight() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {/**/});
}

type Colors = ReturnType<typeof useColors>;

interface QuickAction {
  key: string;
  title: string;
  sub: string;
  color: string;
  icon: React.ReactNode;
  needsRepo: boolean;
  go: () => void;
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { t } = useI18n();
  const {
    user, repos, selectedRepo, branches, currentBranch, commits,
    loading, reposLoading, refreshCommits, selectRepo, selectBranch,
  } = useGitHub();
  const { findByUrl, sync: syncLocal } = useRepos();
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showRepoModal, setShowRepoModal] = useState(false);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");

  React.useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
        <AppBackground />
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (!user) return null;

  const filteredRepos = repos.filter((r) =>
    r.full_name.toLowerCase().includes(repoSearch.trim().toLowerCase())
  );

  async function onRefresh() {
    setRefreshing(true);
    hapticLight();
    await refreshCommits();
    setRefreshing(false);
  }

  const localClone = selectedRepo ? findByUrl(`${selectedRepo.html_url}.git`) : undefined;

  function openRepoPicker() {
    hapticLight();
    setShowRepoModal(true);
  }

  function openBranchPicker() {
    if (!selectedRepo) { openRepoPicker(); return; }
    hapticLight();
    setShowBranchModal(true);
  }

  // Synchronisation Git complète si le dépôt est cloné sur le téléphone
  // (commit → fetch → fusion → push), sinon simple actualisation des commits.
  async function onSyncPress() {
    if (!selectedRepo) {
      openRepoPicker();
      return;
    }
    setSyncing(true);
    hapticLight();
    try {
      if (localClone) {
        const sum = await syncLocal(localClone.id);
        if (sum.pulled === "conflict") {
          router.push({ pathname: "/repo/[id]/conflicts", params: { id: localClone.id } } as any);
        }
      }
      await refreshCommits();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {/**/});
    } catch (e) {
      showAlert(t("g.op.sync"), describeError(e, t));
    } finally {
      setSyncing(false);
    }
  }

  // Clone le dépôt sur le téléphone (ou ouvre le clone existant).
  function onClonePress() {
    if (!selectedRepo) {
      openRepoPicker();
      return;
    }
    hapticLight();
    if (localClone) {
      router.push({ pathname: "/repo/[id]", params: { id: localClone.id } } as any);
      return;
    }
    router.push({ pathname: "/clone", params: { url: `${selectedRepo.html_url}.git`, name: selectedRepo.name } } as any);
  }

  function goDirectory() {
    if (localClone) router.push({ pathname: "/repo/[id]/files", params: { id: localClone.id } } as any);
    else onClonePress();
  }

  function goLocalSettings() {
    if (localClone) router.push({ pathname: "/repo/[id]/settings", params: { id: localClone.id } } as any);
    else onClonePress();
  }

  const forgeRef = selectedRepo ? { provider: "github" as const, project: selectedRepo.full_name } : null;

  const actions: QuickAction[] = [
    {
      key: "upload",
      title: t("hx.upload"),
      sub: t("hx.uploadSub"),
      color: colors.accent,
      icon: <Feather name="upload-cloud" size={18} color={colors.accent} />,
      needsRepo: false,
      go: () => router.push("/(tabs)/files"),
    },
    {
      key: "browse",
      title: t("hx.browse"),
      sub: localClone ? t("hx.browseSub") : t("hx.cloneFirst"),
      color: colors.cyan,
      icon: <Feather name="folder" size={18} color={colors.cyan} />,
      needsRepo: true,
      go: goDirectory,
    },
    {
      key: "issues",
      title: t("f.issues"),
      sub: t("hx.issuesSub"),
      color: colors.amber,
      icon: <Feather name="alert-circle" size={18} color={colors.amber} />,
      needsRepo: true,
      go: () => forgeRef && goForge("list", forgeRef, { kind: "issues" }),
    },
    {
      key: "prs",
      title: t("f.prs"),
      sub: t("hx.prsSub"),
      color: colors.violet,
      icon: <Octicons name="git-pull-request" size={18} color={colors.violet} />,
      needsRepo: true,
      go: () => forgeRef && goForge("list", forgeRef, { kind: "pulls" }),
    },
    {
      key: "actions",
      title: "GitHub Actions",
      sub: t("hx.actionsSub"),
      color: colors.blue,
      icon: <Feather name="play-circle" size={18} color={colors.blue} />,
      needsRepo: true,
      go: () => forgeRef && goForge("actions", forgeRef),
    },
    {
      key: "auto",
      title: t("hx.auto"),
      sub: localClone
        ? localClone.sync.scheduled
          ? t("hx.autoOn", { n: localClone.sync.intervalMin })
          : t("hx.autoOff")
        : t("hx.cloneFirst"),
      color: colors.accent,
      icon: <Feather name="clock" size={18} color={colors.accent} />,
      needsRepo: true,
      go: goLocalSettings,
    },
  ];

  const s = makeStyles(colors);
  const webTop = Platform.OS === "web" ? 67 : 0;
  const tileW = Math.floor((Math.min(width, 640) - 32 - 10) / 2);
  const [owner, name] = selectedRepo ? selectedRepo.full_name.split("/") : ["", ""];

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      <AppBackground />

      {/* En-tête : marque + salutation, avatar → profil */}
      <View style={[s.header, { paddingTop: insets.top + webTop + 10 }]}>
        <Image source={ICON} style={s.logo} contentFit="cover" />
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>Git-Push</Text>
          <Text style={s.greeting} numberOfLines={1}>
            {t("hx.greeting", { name: user.name?.split(" ")[0] || user.login })}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("tabs.profile")}
          hitSlop={8}
          onPress={() => { hapticLight(); router.push("/(tabs)/settings"); }}
          style={({ pressed }) => [s.avatarRing, pressed && { opacity: 0.7 }]}
        >
          {user.avatar_url ? (
            <Image source={{ uri: user.avatar_url }} style={s.avatar} contentFit="cover" />
          ) : (
            <Feather name="user" size={18} color={colors.foreground} />
          )}
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.cardSolid}
          />
        }
      >
        {/* Carte principale : le dépôt sur lequel on travaille */}
        <View style={s.hero}>
          <Text style={s.heroLabel}>{t("hx.activeRepo")}</Text>

          <Pressable
            accessibilityRole="button"
            onPress={openRepoPicker}
            style={({ pressed }) => [s.repoRow, pressed && { opacity: 0.75 }]}
          >
            <View style={s.repoIcon}>
              <Octicons name={selectedRepo?.private ? "lock" : "repo"} size={18} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              {selectedRepo ? (
                <>
                  <Text style={s.repoOwner} numberOfLines={1}>{owner}</Text>
                  <Text style={s.repoName} numberOfLines={1}>{name}</Text>
                </>
              ) : (
                <Text style={[s.repoName, { color: colors.mutedForeground }]}>{t("hx.noRepo")}</Text>
              )}
            </View>
            <View style={s.changePill}>
              <Text style={s.changeText}>{selectedRepo ? t("hx.change") : t("hx.choose")}</Text>
              <Feather name="chevron-down" size={13} color={colors.foreground} />
            </View>
          </Pressable>

          {selectedRepo ? (
            <View style={s.chips}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("home.chooseBranch")}
                onPress={openBranchPicker}
                style={({ pressed }) => [s.chip, pressed && { opacity: 0.7 }]}
              >
                <Octicons name="git-branch" size={13} color={colors.accent} />
                <Text style={s.chipText} numberOfLines={1}>{currentBranch || t("home.unborn")}</Text>
                <Feather name="chevron-down" size={12} color={colors.mutedForeground} />
              </Pressable>
              <View style={[s.chip, localClone ? s.chipOn : null]}>
                <View style={[s.statusDot, { backgroundColor: localClone ? colors.accent : colors.mutedForeground }]} />
                <Text style={[s.chipText, { color: localClone ? colors.accent : colors.mutedForeground }]} numberOfLines={1}>
                  {localClone ? t("hx.cloned") : t("hx.notCloned")}
                </Text>
              </View>
            </View>
          ) : null}

          <View style={s.heroActions}>
            {selectedRepo ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  onPress={onSyncPress}
                  disabled={syncing}
                  style={({ pressed }) => [s.primaryBtn, { flex: 1 }, pressed && { opacity: 0.85 }]}
                >
                  {syncing ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Feather name="refresh-cw" size={16} color="#000" />
                  )}
                  <Text style={s.primaryBtnText}>{localClone ? t("hx.sync") : t("hx.refresh")}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={onClonePress}
                  style={({ pressed }) => [s.secondaryBtn, pressed && { opacity: 0.75 }]}
                >
                  <Feather name={localClone ? "folder" : "download-cloud"} size={16} color={colors.foreground} />
                  <Text style={s.secondaryBtnText}>{localClone ? t("hx.open") : t("hx.clone")}</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={openRepoPicker}
                style={({ pressed }) => [s.primaryBtn, { flex: 1 }, pressed && { opacity: 0.85 }]}
              >
                <Octicons name="repo" size={16} color="#000" />
                <Text style={s.primaryBtnText}>{t("hx.pickRepo")}</Text>
              </Pressable>
            )}
          </View>

          {!selectedRepo ? <Text style={s.heroHint}>{t("hx.pickRepoHint")}</Text> : null}
        </View>

        {/* Actions rapides : une tuile = une destination, avec ce qu'elle fait */}
        <Text style={s.sectionTitle}>{t("hx.quick")}</Text>
        <View style={s.grid}>
          {actions.map((a) => {
            const locked = a.needsRepo && !selectedRepo;
            return (
              <Pressable
                key={a.key}
                accessibilityRole="button"
                accessibilityHint={locked ? t("home.selectRepoFirst") : undefined}
                onPress={() => {
                  if (locked) { openRepoPicker(); return; }
                  hapticLight();
                  a.go();
                }}
                style={({ pressed }) => [
                  s.tile,
                  { width: tileW },
                  locked && { opacity: 0.5 },
                  pressed && { borderColor: withAlpha(a.color, 0.45) },
                ]}
              >
                <View style={[s.tileIcon, { backgroundColor: withAlpha(a.color, 0.13) }]}>{a.icon}</View>
                <Text style={s.tileTitle} numberOfLines={2}>{a.title}</Text>
                <Text style={s.tileSub} numberOfLines={2}>{locked ? t("home.selectRepoFirst") : a.sub}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Derniers commits, dessinés comme une voie du graphe */}
        <View style={s.sectionRow}>
          <Text style={[s.sectionTitle, { marginTop: 0, marginBottom: 0, flex: 1 }]}>{t("hx.commits")}</Text>
          {selectedRepo && commits.length > 0 ? (
            <Pressable hitSlop={8} onPress={openBranchPicker} style={s.branchLink}>
              <Octicons name="git-branch" size={12} color={colors.mutedForeground} />
              <Text style={s.branchLinkText} numberOfLines={1}>{currentBranch}</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={s.commitsCard}>
          {commits.length === 0 ? (
            <View style={s.emptyBox}>
              <View style={s.emptyIcon}>
                <Octicons name="git-commit" size={20} color={colors.mutedForeground} />
              </View>
              <Text style={s.emptyText}>{selectedRepo ? t("hx.noCommits") : t("hx.noRepoCommits")}</Text>
              {selectedRepo ? <Text style={s.emptyHint}>{t("hx.pullHint")}</Text> : null}
            </View>
          ) : (
            commits.map((item, i) => (
              <CommitRow
                key={item.sha}
                colors={colors}
                first={i === 0}
                last={i === commits.length - 1}
                message={item.commit.message.split("\n")[0]}
                author={item.commit.author.name}
                when={timeAgo(new Date(item.commit.author.date).getTime(), t)}
                sha={item.sha.slice(0, 7)}
              />
            ))
          )}
        </View>

        <View style={{ height: insets.bottom + TAB_BAR_SPACE + 24 }} />
      </ScrollView>

      {/* Sélecteur de dépôt */}
      <PickerModal
        visible={showRepoModal}
        title={t("home.chooseRepo")}
        loading={reposLoading}
        searchable
        searchValue={repoSearch}
        onSearchChange={setRepoSearch}
        searchPlaceholder={t("files.search")}
        emptyLabel={t("files.noRepoFound")}
        items={filteredRepos.map((r) => ({
          key: String(r.id),
          label: r.full_name,
          icon: r.private ? ("lock" as const) : ("repo" as const),
          selected: selectedRepo?.id === r.id,
        }))}
        onSelect={(key) => {
          const repo = repos.find((r) => String(r.id) === key);
          if (repo) {
            selectRepo(repo);
            hapticLight();
          }
          setShowRepoModal(false);
          setRepoSearch("");
        }}
        onClose={() => { setShowRepoModal(false); setRepoSearch(""); }}
      />

      {/* Sélecteur de branche */}
      <PickerModal
        visible={showBranchModal}
        title={t("home.chooseBranch")}
        emptyLabel={t("home.unborn")}
        items={branches.map((b) => ({
          key: b.name,
          label: b.name,
          icon: "git-branch" as const,
          selected: currentBranch === b.name,
        }))}
        onSelect={(key) => {
          selectBranch(key);
          hapticLight();
          setShowBranchModal(false);
        }}
        onClose={() => setShowBranchModal(false)}
      />
    </View>
  );
}

function CommitRow({
  colors, first, last, message, author, when, sha,
}: {
  colors: Colors;
  first: boolean;
  last: boolean;
  message: string;
  author: string;
  when: string;
  sha: string;
}) {
  return (
    <View style={{ flexDirection: "row", paddingHorizontal: 14 }}>
      {/* Voie : trait vertical continu + nœud (plein pour le plus récent) */}
      <View style={{ width: 18, alignItems: "center" }}>
        <View style={{ width: 2, height: 16, backgroundColor: first ? "transparent" : withAlpha(colors.accent, 0.35) }} />
        <View
          style={{
            width: 12,
            height: 12,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: colors.accent,
            backgroundColor: first ? colors.accent : colors.cardSolid,
          }}
        />
        <View style={{ width: 2, flex: 1, backgroundColor: last ? "transparent" : withAlpha(colors.accent, 0.35) }} />
      </View>
      <View style={{ flex: 1, paddingVertical: 11, paddingLeft: 10, borderBottomWidth: last ? 0 : 1, borderColor: colors.border }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ flex: 1, fontSize: 13.5, color: colors.foreground, fontFamily: "Inter_500Medium" }} numberOfLines={1}>
            {message}
          </Text>
          <Text
            style={{
              fontSize: 11,
              color: colors.accent,
              fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
              backgroundColor: colors.greenBg,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 5,
              overflow: "hidden",
            }}
          >
            {sha}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 3, gap: 8 }}>
          <Text style={{ flex: 1, fontSize: 11.5, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }} numberOfLines={1}>
            {author}
          </Text>
          <Text style={{ fontSize: 11.5, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{when}</Text>
        </View>
      </View>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 16,
      paddingBottom: 14,
    },
    logo: {
      width: 40,
      height: 40,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    brand: { fontSize: 21, color: colors.foreground, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
    greeting: { fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginTop: 1 },
    avatarRing: {
      width: 42,
      height: 42,
      borderRadius: 21,
      borderWidth: 2,
      borderColor: colors.borderStrong,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.card,
      overflow: "hidden",
    },
    avatar: { width: 38, height: 38, borderRadius: 19 },

    hero: {
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      padding: 16,
    },
    heroLabel: { fontSize: 12.5, color: colors.mutedForeground, fontFamily: "Inter_500Medium", marginBottom: 10 },
    repoRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    repoIcon: {
      width: 44,
      height: 44,
      borderRadius: 13,
      backgroundColor: colors.greenBg,
      alignItems: "center",
      justifyContent: "center",
    },
    repoOwner: { fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
    repoName: { fontSize: 18, color: colors.foreground, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },
    changePill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: colors.secondary,
      borderWidth: 1,
      borderColor: colors.border,
    },
    changeText: { fontSize: 12, color: colors.foreground, fontFamily: "Inter_600SemiBold" },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      maxWidth: "100%",
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: colors.input,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipOn: { borderColor: withAlpha(colors.accent, 0.3), backgroundColor: colors.greenBg },
    chipText: { fontSize: 12.5, color: colors.foreground, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
    heroActions: { flexDirection: "row", gap: 10, marginTop: 16 },
    primaryBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: colors.accent,
      borderRadius: 14,
      paddingVertical: 13,
      paddingHorizontal: 16,
    },
    primaryBtnText: { fontSize: 14.5, color: "#000", fontFamily: "Inter_700Bold" },
    secondaryBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: colors.secondary,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      paddingVertical: 13,
      paddingHorizontal: 18,
    },
    secondaryBtnText: { fontSize: 14.5, color: colors.foreground, fontFamily: "Inter_600SemiBold" },
    heroHint: { fontSize: 12.5, color: colors.mutedForeground, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 12 },

    sectionTitle: {
      fontSize: 15,
      color: colors.foreground,
      fontFamily: "Inter_700Bold",
      marginTop: 24,
      marginBottom: 10,
      marginLeft: 2,
    },
    sectionRow: { flexDirection: "row", alignItems: "center", marginTop: 24, marginBottom: 10, marginLeft: 2 },
    branchLink: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      maxWidth: "50%",
    },
    branchLinkText: { fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_500Medium" },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    tile: {
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 13,
      gap: 2,
    },
    tileIcon: {
      width: 36,
      height: 36,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 10,
    },
    tileTitle: { fontSize: 14, color: colors.foreground, fontFamily: "Inter_600SemiBold" },
    tileSub: { fontSize: 11.5, lineHeight: 15, color: colors.mutedForeground, fontFamily: "Inter_400Regular" },

    commitsCard: {
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
      paddingVertical: 4,
    },
    emptyBox: { alignItems: "center", justifyContent: "center", paddingVertical: 30, paddingHorizontal: 24, gap: 6 },
    emptyIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.secondary,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 6,
    },
    emptyText: { color: colors.foreground, fontSize: 13.5, fontFamily: "Inter_600SemiBold", textAlign: "center" },
    emptyHint: { color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
  });
}
