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
import { useToggleFavorite } from "@/components/FavoriteButton";
import { timeAgo } from "@/components/GitUi";
import { FavoriteCard, HomeSection, HScroll, OperationRow, RecentRepoCard, ShortcutCard } from "@/components/HomeUi";
import { HeroGraph, Illustration, type IllustrationKind } from "@/components/Illustration";
import { PickerModal } from "@/components/PickerModal";
import { withAlpha } from "@/constants/colors";
import { TAB_BAR_SPACE } from "@/constants/layout";
import { useGitHub } from "@/context/GitHubContext";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import { showConfirm } from "@/utils/dialogs";
import { conflictCount, favoriteRepos, recentOps, recentRepos, resolveRepoTarget } from "@/utils/homePure";

const ICON = require("../../assets/images/icon.png");

function hapticLight() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {/**/});
}

type Colors = ReturnType<typeof useColors>;

/** Écran de dépôt vers lequel un raccourci mène ("" = la page principale du dépôt : modifications). */
type RepoScreen = "" | "branches" | "commits" | "conflicts";

interface Shortcut {
  key: string;
  kind: IllustrationKind;
  title: string;
  sub: string;
  badge?: string;
  /** Pas de dépôt cloné : la carte reste cliquable mais invite à en cloner un. */
  dimmed?: boolean;
  go: () => void;
}

interface GitHubAction {
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
  const { containers, ready, findByUrl } = useRepos();
  const toggleFavorite = useToggleFavorite();
  const [refreshing, setRefreshing] = useState(false);
  const [showRepoModal, setShowRepoModal] = useState(false);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  /** Sélecteur « quel dépôt local ? » quand un raccourci a plusieurs cibles possibles. */
  const [chooser, setChooser] = useState<{ title: string; ids: string[]; onPick: (id: string) => void } | null>(null);

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

  // Clone le dépôt GitHub actif sur le téléphone (ou ouvre le clone existant).
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

  // ── Raccourcis vers les dépôts locaux ─────────────────────────────────────
  function openRepo(id: string, screen: RepoScreen = "") {
    router.push({ pathname: screen ? `/repo/[id]/${screen}` : "/repo/[id]", params: { id } } as any);
  }

  /** Aucun dépôt cloné : on explique et on propose directement de cloner. */
  function guideToClone() {
    showConfirm({
      title: t("hm.noRepo.title"),
      message: t("hm.noRepo.body"),
      confirmText: t("g.repos.cloneFirst"),
      cancelText: t("msg.cancel"),
      onConfirm: () => router.push("/clone" as any),
    });
  }

  /** Ouvre `screen` du bon dépôt : directement s'il n'y en a qu'un, sinon l'utilisateur choisit. */
  function openRepoScreen(screen: RepoScreen, needConflicts = false) {
    const target = resolveRepoTarget(containers, needConflicts);
    if (target.kind === "none") return guideToClone();
    if (target.kind === "direct") return openRepo(target.id, screen);
    setChooser({
      title: needConflicts ? t("hm.choose.conflicts") : t("hm.choose.title"),
      ids: target.ids,
      onPick: (id) => openRepo(id, screen),
    });
  }

  // Synchroniser = vraie synchronisation Git (commit → récupération → fusion → envoi), avec progression.
  function onSyncShortcut() {
    if (!containers.length) return guideToClone();
    if (containers.length === 1) {
      router.push({ pathname: "/sync", params: { repo: containers[0].id } } as any);
      return;
    }
    const eligible = containers.filter((c) => !c.merge && c.url).length;
    if (!eligible) {
      // Tous les dépôts ont une fusion en cours ou n'ont pas de serveur distant : on laisse choisir.
      setChooser({ title: t("hm.choose.title"), ids: containers.map((c) => c.id), onPick: (id) => openRepo(id) });
      return;
    }
    showConfirm({
      title: t("g.repos.syncAllConfirmTitle"),
      message: t("g.repos.syncAllConfirmBody", { n: eligible }),
      confirmText: t("g.repos.syncAll"),
      cancelText: t("msg.cancel"),
      onConfirm: () => router.push("/sync" as any),
    });
  }

  const totalConflicts = containers.reduce((n, c) => n + conflictCount(c), 0);
  const none = ready && containers.length === 0;

  const shortcuts: Shortcut[] = [
    {
      key: "repos",
      kind: "repos",
      title: t("hm.sc.repos"),
      sub: containers.length ? t("hm.sc.repos.sub", { n: containers.length }) : t("hm.sc.repos.none"),
      go: () => router.push("/(tabs)/repos"),
    },
    {
      key: "clone",
      kind: "clone",
      title: t("hm.sc.clone"),
      sub: t("hm.sc.clone.sub"),
      go: () => router.push("/clone" as any),
    },
    {
      key: "new",
      kind: "newRepo",
      title: t("hm.sc.new"),
      sub: t("hm.sc.new.sub"),
      go: () => router.push("/new-repo" as any),
    },
    {
      key: "sync",
      kind: "sync",
      title: t("hm.sc.sync"),
      sub: none ? t("hm.sc.needRepo") : t("hm.sc.sync.sub"),
      dimmed: none,
      go: onSyncShortcut,
    },
    {
      key: "branches",
      kind: "branches",
      title: t("hm.sc.branches"),
      sub: none ? t("hm.sc.needRepo") : t("hm.sc.branches.sub"),
      dimmed: none,
      go: () => openRepoScreen("branches"),
    },
    {
      key: "history",
      kind: "history",
      title: t("hm.sc.history"),
      sub: none ? t("hm.sc.needRepo") : t("hm.sc.history.sub"),
      dimmed: none,
      go: () => openRepoScreen("commits"),
    },
    {
      key: "changes",
      kind: "changes",
      title: t("hm.sc.changes"),
      sub: none ? t("hm.sc.needRepo") : t("hm.sc.changes.sub"),
      dimmed: none,
      go: () => openRepoScreen(""),
    },
    {
      key: "conflicts",
      kind: "conflicts",
      title: t("hm.sc.conflicts"),
      sub: none ? t("hm.sc.needRepo") : t("hm.sc.conflicts.sub"),
      badge: totalConflicts ? t("hm.sc.conflicts.count", { n: totalConflicts }) : undefined,
      dimmed: none,
      go: () => openRepoScreen("conflicts", true),
    },
  ];

  // ── Compte GitHub (fonctions historiques de l'accueil, conservées) ────────
  const githubActions: GitHubAction[] = [
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
  const contentW = Math.min(width, 640) - 32;
  const cardW = Math.floor((contentW - 12) / 2);
  const wideCardW = Math.min(260, Math.floor(contentW * 0.78));
  const miniTileW = Math.floor((contentW - 10) / 2);
  const [owner, name] = selectedRepo ? selectedRepo.full_name.split("/") : ["", ""];

  const favorites = favoriteRepos(containers);
  const opened = recentRepos(containers, 6);
  const ops = recentOps(containers, 3);
  const latestCommits = selectedRepo ? commits.slice(0, 4) : [];
  const hasActivity = opened.length > 0 || ops.length > 0 || latestCommits.length > 0;
  const firstName = user.name?.split(" ")[0] || user.login;

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      <AppBackground />

      {/* Barre du haut : marque + accès au profil et aux paramètres */}
      <View style={[s.topBar, { paddingTop: insets.top + webTop + 10 }]}>
        <Image source={ICON} style={s.logo} contentFit="cover" />
        <Text style={s.brand}>Git-Push</Text>
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("hm.profile")}
          hitSlop={4}
          onPress={() => { hapticLight(); router.push("/(tabs)/settings"); }}
          style={({ pressed }) => [s.avatarRing, pressed && { opacity: 0.7 }]}
        >
          {user.avatar_url ? (
            <Image source={{ uri: user.avatar_url }} style={s.avatar} contentFit="cover" />
          ) : (
            <Feather name="user" size={20} color={colors.foreground} />
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
        {/* Message de bienvenue + visuel */}
        <View style={s.hero}>
          <View style={{ flex: 1 }}>
            <Text style={s.heroHello} numberOfLines={2}>{t("hx.greeting", { name: firstName })}</Text>
            <Text style={s.heroTag}>{t("hm.tagline")}</Text>
          </View>
          <HeroGraph width={112} height={82} />
        </View>

        {/* ── Mes raccourcis ── */}
        <HomeSection title={t("hm.shortcuts")}>
          <View style={s.grid}>
            {shortcuts.map((sc) => (
              <ShortcutCard
                key={sc.key}
                kind={sc.kind}
                title={sc.title}
                sub={sc.sub}
                badge={sc.badge}
                dimmed={sc.dimmed}
                width={cardW}
                onPress={sc.go}
              />
            ))}
          </View>
        </HomeSection>

        {/* ── Activité récente ── */}
        <HomeSection title={t("hm.recent")}>
          {!hasActivity ? (
            <View style={s.emptyCard}>
              <Illustration kind="empty" size={56} />
              <Text style={s.emptyText}>{t("hm.recent.empty")}</Text>
            </View>
          ) : (
            <View style={{ gap: 16 }}>
              {opened.length > 0 ? (
                <View>
                  <Text style={s.subTitle}>{t("hm.recent.opened")}</Text>
                  <HScroll>
                    {opened.map((c) => (
                      <RecentRepoCard key={c.id} repo={c} width={168} onOpen={() => openRepo(c.id)} />
                    ))}
                  </HScroll>
                </View>
              ) : null}

              {ops.length > 0 ? (
                <View>
                  <Text style={s.subTitle}>{t("hm.recent.ops")}</Text>
                  <View style={s.listCard}>
                    {ops.map((o, i) => (
                      <OperationRow
                        key={o.id}
                        name={o.name}
                        ok={o.ok}
                        at={o.at}
                        last={i === ops.length - 1}
                        onPress={() => openRepo(o.id)}
                      />
                    ))}
                  </View>
                </View>
              ) : null}

              {latestCommits.length > 0 ? (
                <View>
                  <View style={s.subRow}>
                    <Text style={[s.subTitle, { flex: 1, marginBottom: 0 }]} numberOfLines={1}>
                      {t("hx.commits")} · {name}
                    </Text>
                    <Pressable hitSlop={8} onPress={openBranchPicker} style={s.branchLink}>
                      <Octicons name="git-branch" size={12} color={colors.mutedForeground} />
                      <Text style={s.branchLinkText} numberOfLines={1}>{currentBranch}</Text>
                    </Pressable>
                  </View>
                  <View style={s.listCard}>
                    {latestCommits.map((item, i) => (
                      <CommitRow
                        key={item.sha}
                        colors={colors}
                        first={i === 0}
                        last={i === latestCommits.length - 1}
                        message={item.commit.message.split("\n")[0]}
                        author={item.commit.author.name}
                        when={timeAgo(new Date(item.commit.author.date).getTime(), t)}
                        sha={item.sha.slice(0, 7)}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          )}
        </HomeSection>

        {/* ── Dépôts favoris ── */}
        <HomeSection
          title={t("hm.fav")}
          action={containers.length > 0 ? { label: t("hm.seeAll"), onPress: () => router.push("/(tabs)/repos") } : undefined}
        >
          {favorites.length > 0 ? (
            <HScroll>
              {favorites.map((c) => (
                <FavoriteCard
                  key={c.id}
                  repo={c}
                  width={wideCardW}
                  onOpen={() => openRepo(c.id)}
                  onToggleFavorite={() => void toggleFavorite(c)}
                />
              ))}
            </HScroll>
          ) : (
            <View style={s.emptyCard}>
              <View style={s.starCircle}>
                <Feather name="star" size={22} color={colors.amber} />
              </View>
              <Text style={s.emptyText}>{containers.length ? t("hm.fav.empty") : t("hm.fav.noRepos")}</Text>
            </View>
          )}
        </HomeSection>

        {/* ── Compte GitHub : dépôt actif et actions en ligne ── */}
        <HomeSection title={t("hm.github")}>
          <View style={s.githubCard}>
            <Text style={s.heroLabel}>{t("hx.activeRepo")}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={selectedRepo ? `${selectedRepo.full_name}, ${t("hx.change")}` : t("hx.pickRepo")}
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
            ) : (
              <Text style={s.heroHint}>{t("hx.pickRepoHint")}</Text>
            )}

            <View style={s.heroActions}>
              <Pressable
                accessibilityRole="button"
                onPress={selectedRepo ? onClonePress : openRepoPicker}
                style={({ pressed }) => [s.primaryBtn, { flex: 1 }, pressed && { opacity: 0.85 }]}
              >
                <Feather
                  name={!selectedRepo ? "search" : localClone ? "folder" : "download-cloud"}
                  size={16}
                  color={colors.primaryForeground}
                />
                <Text style={s.primaryBtnText}>
                  {!selectedRepo ? t("hx.pickRepo") : localClone ? t("hx.open") : t("hx.clone")}
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={[s.grid, { marginTop: 10, gap: 10 }]}>
            {githubActions.map((a) => {
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
                    { width: miniTileW },
                    locked && { opacity: 0.6 },
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
        </HomeSection>

        <View style={{ height: insets.bottom + TAB_BAR_SPACE + 24 }} />
      </ScrollView>

      {/* Sélecteur de dépôt local (raccourcis Branches, Historique, Modifications, Conflits) */}
      <PickerModal
        visible={!!chooser}
        title={chooser?.title ?? ""}
        emptyLabel={t("hm.noRepo.title")}
        items={(chooser?.ids ?? []).map((id) => {
          const c = containers.find((x) => x.id === id);
          const n = c ? conflictCount(c) : 0;
          return {
            key: id,
            label: c ? (n ? `${c.name} · ${t("hm.sc.conflicts.count", { n })}` : c.name) : id,
            icon: "repo" as const,
          };
        })}
        onSelect={(key) => {
          const pick = chooser?.onPick;
          setChooser(null);
          if (pick) pick(key);
        }}
        onClose={() => setChooser(null)}
      />

      {/* Sélecteur de dépôt GitHub */}
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

      {/* Sélecteur de branche GitHub */}
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
      <View style={{ flex: 1, paddingVertical: 13, paddingLeft: 10, borderBottomWidth: last ? 0 : 1, borderColor: colors.border }}>
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
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 16,
      paddingBottom: 10,
    },
    logo: {
      width: 38,
      height: 38,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    brand: { fontSize: 21, color: colors.foreground, fontFamily: "Inter_700Bold", letterSpacing: -0.4 },
    avatarRing: {
      width: 48,
      height: 48,
      borderRadius: 24,
      borderWidth: 2,
      borderColor: colors.borderStrong,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.card,
      overflow: "hidden",
    },
    avatar: { width: 44, height: 44, borderRadius: 22 },

    hero: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.card,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      paddingVertical: 18,
      paddingLeft: 18,
      paddingRight: 12,
      overflow: "hidden",
    },
    heroHello: { fontSize: 24, lineHeight: 30, color: colors.foreground, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
    heroTag: { marginTop: 6, fontSize: 13.5, lineHeight: 19, color: colors.mutedForeground, fontFamily: "Inter_400Regular" },

    grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },

    subTitle: { fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_600SemiBold", marginBottom: 8, marginLeft: 2 },
    subRow: { flexDirection: "row", alignItems: "center", marginBottom: 8, marginLeft: 2 },
    branchLink: { flexDirection: "row", alignItems: "center", gap: 5, maxWidth: "45%", minHeight: 32 },
    branchLinkText: { fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_500Medium" },
    listCard: {
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
      paddingVertical: 2,
    },
    emptyCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
    },
    emptyText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
    starCircle: {
      width: 56,
      height: 56,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: withAlpha(colors.amber, 0.14),
    },

    githubCard: {
      backgroundColor: colors.card,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
    },
    heroLabel: { fontSize: 12.5, color: colors.mutedForeground, fontFamily: "Inter_500Medium", marginBottom: 10 },
    repoRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 },
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
      minHeight: 40,
      paddingHorizontal: 12,
      borderRadius: 20,
      backgroundColor: colors.secondary,
      borderWidth: 1,
      borderColor: colors.border,
    },
    changeText: { fontSize: 12.5, color: colors.foreground, fontFamily: "Inter_600SemiBold" },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      maxWidth: "100%",
      minHeight: 36,
      paddingHorizontal: 12,
      borderRadius: 18,
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
      minHeight: 50,
      backgroundColor: colors.accent,
      borderRadius: 16,
      paddingHorizontal: 16,
    },
    primaryBtnText: { fontSize: 14.5, color: colors.primaryForeground, fontFamily: "Inter_700Bold" },
    heroHint: { fontSize: 12.5, color: colors.mutedForeground, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 12 },

    tile: {
      backgroundColor: colors.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      minHeight: 112,
      gap: 2,
    },
    tileIcon: {
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 10,
    },
    tileTitle: { fontSize: 14, color: colors.foreground, fontFamily: "Inter_600SemiBold" },
    tileSub: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
  });
}
