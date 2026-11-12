import { Feather, Octicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import JSZip from "jszip";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { Illustration, illustrationColor } from "@/components/Illustration";
import { PickerModal } from "@/components/PickerModal";
import { useGitHub } from "@/context/GitHubContext";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { createBatchPusher, SPLIT_ABOVE_B64, type BatchSummary } from "@/utils/batchPush";
import { showAlert } from "@/utils/dialogs";
import { showTypedConfirm } from "@/utils/safeConfirm";
import { C, withAlpha } from "@/constants/colors";

interface SelectedFile {
  name: string;
  uri: string;
  size: number;
  type: string;
}

/** Entrées parasites générées par macOS / Windows dans les archives. */
const JUNK_ENTRY = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i;

/**
 * Calcule le préfixe de répertoires commun à TOUS les chemins.
 * Ex: ["projet-main/src/a.ts", "projet-main/b.ts"] → "projet-main/"
 * Ex: ["projet-main/src/a.ts", "projet-main/src/b.ts"] → "projet-main/src/"
 * Ainsi le contenu de l'archive est poussé à la racine du dépôt,
 * sans recréer le sous-dossier de l'archive.
 */
function commonDirPrefix(paths: string[]): string {
  if (paths.length === 0) return "";
  const dirParts = paths.map((p) => p.split("/").slice(0, -1));
  let prefix = dirParts[0];
  for (let i = 1; i < dirParts.length && prefix.length > 0; i++) {
    const segs = dirParts[i];
    let j = 0;
    while (j < prefix.length && j < segs.length && prefix[j] === segs[j]) j++;
    prefix = prefix.slice(0, j);
  }
  return prefix.length > 0 ? `${prefix.join("/")}/` : "";
}

const workflowNote = (skipped?: string[]) =>
  skipped && skipped.length
    ? `\n\n⚠ ${skipped.length} .github/workflows : non supprimé(s) — token sans scope « workflow ».`
    : "";

export default function FilesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const {
    user, repos, selectedRepo, branches, currentBranch,
    selectRepo, selectBranch, pushFile, pushFiles, clearRepo, deleteRepos,
    reposLoading, loading,
  } = useGitHub();
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [commitMsg, setCommitMsg] = useState("feat: upload via Git-Push");
  const [targetPath, setTargetPath] = useState("");
  const [pushing, setPushing] = useState(false);
  const [showRepoModal, setShowRepoModal] = useState(false);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const [clearing, setClearing] = useState(false);
  const [deletingRepo, setDeletingRepo] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteSel, setDeleteSel] = useState<string[]>([]);
  const [deleteSearch, setDeleteSearch] = useState("");
  const [clearMsg, setClearMsg] = useState("chore: vidage du dépôt via Git-Push");
  const [pushProgress, setPushProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchNum, setBatchNum] = useState(0);

  React.useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user]);

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
      <AppBackground />
      <ActivityIndicator color={C.accent} size="large" />
    </View>
  );

  if (!user) return null;

  const filteredRepos = repos.filter((r) =>
    r.full_name.toLowerCase().includes(repoSearch.trim().toLowerCase())
  );

  async function pickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const a = result.assets[0];
      setFile({
        name: a.name,
        uri: a.uri,
        size: a.size ?? 0,
        type: a.mimeType ?? "application/octet-stream",
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {/**/});
    } catch {
      showAlert(t("msg.error"), t("msg.pickFail"));
    }
  }

  function removeFile() {
    setFile(null);
  }

  function isZipFile(f: SelectedFile) {
    return (
      f.name.toLowerCase().endsWith(".zip") ||
      f.type === "application/zip" ||
      f.type === "application/x-zip-compressed"
    );
  }

  function isRarFile(f: SelectedFile) {
    return (
      f.name.toLowerCase().endsWith(".rar") ||
      f.type === "application/vnd.rar" ||
      f.type === "application/x-rar-compressed"
    );
  }

  async function readFileAsBase64(uri: string): Promise<string> {
    if (Platform.OS === "web") {
      const resp = await fetch(uri);
      const buf = await resp.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      return btoa(binary);
    }
    return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  }

  /** Texte récapitulatif commun (lots, fichiers découpés, fichiers ignorés). */
  function batchNotes(res: BatchSummary, skipped: number): string {
    const lines: string[] = [];
    if (res.commits > 1) lines.push(t("msg.batchesInfo", { n: res.commits }));
    if (res.splitFiles.length > 0) {
      const list = res.splitFiles.slice(0, 3).join(", ") + (res.splitFiles.length > 3 ? "…" : "");
      lines.push(t("msg.splitInfo", { list }));
    }
    if (skipped > 0) lines.push(t("msg.skippedFiles", { n: skipped }));
    return lines.join("\n");
  }

  async function handlePush() {
    if (!selectedRepo) {
      showAlert(t("msg.error"), t("msg.selectRepoFirst"));
      return;
    }
    if (!file) {
      showAlert(t("msg.error"), t("msg.noFileSelected"));
      return;
    }
    if (!commitMsg.trim()) {
      showAlert(t("msg.error"), t("msg.enterCommitMsg"));
      return;
    }
    if (isRarFile(file)) {
      showAlert(t("msg.error"), t("msg.rarUnsupported"));
      return;
    }

    setPushing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {/**/});

    try {
      const base64 = await readFileAsBase64(file.uri);

      if (isZipFile(file)) {
        const zip = await JSZip.loadAsync(base64, { base64: true });
        // Filtrer dossiers et fichiers parasites (__MACOSX, .DS_Store, …)
        const entries = Object.values(zip.files).filter(
          (e) => !e.dir && !JUNK_ENTRY.test(e.name)
        );

        if (entries.length === 0) {
          setPushing(false);
          setPushProgress(null);
          showAlert(t("msg.error"), t("msg.zipEmpty"));
          return;
        }

        // Analyse de l'archive : détecter le(s) sous-dossier(s) racine
        // commun(s) et les retirer pour ne pas pusher le sous-répertoire
        // dans la racine du dépôt.
        const rawPaths = entries.map((e) => e.name.replace(/^\/+/, ""));
        const stripPrefix = commonDirPrefix(rawPaths);

        // Lecture et envoi PAR LOTS : on lit les fichiers un à un, on remplit
        // un lot (limité en taille et en nombre), on le pousse dans un commit
        // dédié, on libère la mémoire, puis on passe au lot suivant. Les
        // fichiers > 80 Mo sont découpés en parties (nom.part001, …).
        setPushProgress({ done: 0, total: entries.length });
        setBatchNum(0);
        const readErrors: string[] = [];
        const pusher = createBatchPusher({
          push: pushFiles,
          message: commitMsg.trim(),
          onProgress: (done) => setPushProgress({ done, total: entries.length }),
          onBatch: (n) => setBatchNum(n),
        });

        for (const entry of entries) {
          try {
            const content = await entry.async("base64");
            const raw = entry.name.replace(/^\/+/, "");
            const relPath = stripPrefix && raw.startsWith(stripPrefix)
              ? raw.slice(stripPrefix.length)
              : raw;
            if (!relPath) continue;
            const path = targetPath.trim()
              ? `${targetPath.trim().replace(/\/$/, "")}/${relPath}`
              : relPath;
            const ok = await pusher.addFile(path, content);
            if (!ok) break;
          } catch (e) {
            readErrors.push(`${entry.name}: ${String(e)}`);
          }
        }
        const res = await pusher.finish();

        setPushing(false);
        setPushProgress(null);
        setBatchNum(0);

        if (res.ok) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {/**/});
          setFile(null);
          const body = [
            t("msg.filesPushed", {
              done: res.filesPushed,
              total: entries.length,
              repo: selectedRepo.name,
              branch: currentBranch,
            }),
            stripPrefix
              ? t("msg.subfolderStripped", { prefix: stripPrefix.replace(/\/$/, "") })
              : "",
            batchNotes(res, readErrors.length),
          ].filter(Boolean).join("\n");
          showAlert(t("msg.success"), body, [
            { text: t("msg.viewCommits"), onPress: () => router.push("/(tabs)") },
            { text: t("msg.ok") },
          ]);
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {/**/});
          const partial = res.filesPushed > 0
            ? t("msg.partialPushed", { n: res.filesPushed, c: res.commits })
            : "";
          showAlert(
            t("msg.errors"),
            [res.error, partial, ...readErrors].filter(Boolean).join("\n")
          );
        }
        return;
      }

      // Fichier simple (non zip)
      const path = targetPath.trim()
        ? `${targetPath.trim().replace(/\/$/, "")}/${file.name}`
        : file.name;

      // Fichier simple > 80 Mo : même mécanisme de découpage en parties.
      if (base64.length > SPLIT_ABOVE_B64) {
        setBatchNum(0);
        const pusher = createBatchPusher({
          push: pushFiles,
          message: commitMsg.trim(),
          onBatch: (n) => setBatchNum(n),
        });
        await pusher.addFile(path, base64);
        const big = await pusher.finish();
        setPushing(false);
        setBatchNum(0);
        if (big.ok) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {/**/});
          setFile(null);
          showAlert(
            t("msg.success"),
            [
              t("msg.filesPushed", { done: 1, total: 1, repo: selectedRepo.name, branch: currentBranch }),
              batchNotes(big, 0),
            ].filter(Boolean).join("\n"),
            [
              { text: t("msg.viewCommits"), onPress: () => router.push("/(tabs)") },
              { text: t("msg.ok") },
            ]
          );
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {/**/});
          showAlert(t("msg.error"), big.error ?? t("msg.unknownError"));
        }
        return;
      }

      const res = await pushFile(path, base64, commitMsg.trim());
      setPushing(false);

      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {/**/});
        setFile(null);
        showAlert(
          t("msg.success"),
          t("msg.filePushed", {
            repo: selectedRepo.name,
            branch: currentBranch,
            strategy: res.strategy ?? "1",
          }),
          [
            { text: t("msg.viewCommits"), onPress: () => router.push("/(tabs)") },
            { text: t("msg.ok") },
          ]
        );
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {/**/});
        showAlert(t("msg.error"), res.error ?? t("msg.unknownError"));
      }
    } catch (e) {
      setPushing(false);
      setPushProgress(null);
      setBatchNum(0);
      showAlert(t("msg.error"), String(e));
    }
  }

  function handleClearRepo() {
    if (!selectedRepo) {
      showAlert(t("msg.error"), t("msg.selectRepoFirst"));
      return;
    }
    if (!clearMsg.trim()) {
      showAlert(t("msg.error"), t("msg.enterCommitMsg"));
      return;
    }

    const armed = showTypedConfirm({
      title: t("msg.confirmClearTitle"),
      message: t("safe.clearBody", { repo: selectedRepo.name, branch: currentBranch }),
      phrase: selectedRepo.name,
      confirmText: t("msg.clearAction"),
      cancelText: t("msg.cancel"),
      onConfirm: async () => {
        setClearing(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {/**/});
        const res = await clearRepo(clearMsg.trim());
        setClearing(false);
        if (res.ok) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {/**/});
          showAlert(t("msg.success"), t("msg.repoCleared", { n: res.deletedCount ?? 0 }) + workflowNote(res.skipped));
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {/**/});
          showAlert(t("msg.error"), res.error ?? t("msg.unknownError"));
        }
      },
    });
    if (!armed) showAlert(t("msg.error"), t("safe.unavailable"));
  }

  function toggleDeleteSel(key: string) {
    setDeleteSel((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {/**/});
  }

  function handleDeleteRepos() {
    const chosen = repos.filter((r) => deleteSel.includes(String(r.id)));
    if (chosen.length === 0) return;

    setShowDeleteModal(false);
    // Laisse le temps à la modale de se fermer avant d'ouvrir la confirmation (iOS).
    setTimeout(() => {
      const armed = showTypedConfirm({
        title: t("msg.confirmDeleteReposTitle", { n: chosen.length }),
        message: t("safe.reposBody", { repos: chosen.map((r) => `• ${r.full_name}`).join("\n") }),
        // Un seul dépôt : on exige son nom complet ; plusieurs : le mot de sécurité.
        phrase: chosen.length === 1 ? chosen[0].full_name : t("safe.word"),
        confirmText: t("msg.deleteRepoAction"),
        cancelText: t("msg.cancel"),
        onConfirm: async () => {
          setDeletingRepo(true);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {/**/});
          const res = await deleteRepos(chosen.map((r) => r.full_name));
          setDeletingRepo(false);

          // On ne garde sélectionnés que les dépôts en échec (pour réessayer).
          const failedNames = new Set(res.failed.map((x) => x.name));
          setDeleteSel(chosen.filter((r) => failedNames.has(r.full_name)).map((r) => String(r.id)));

          if (res.ok) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {/**/});
            showAlert(t("msg.success"), t("msg.reposDeleted", { n: res.deleted.length }));
          } else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {/**/});
            const errors = res.failed.map((x) => `• ${x.name} : ${x.error}`).join("\n");
            const body = t("msg.reposDeletePartial", { ok: res.deleted.length, ko: res.failed.length, errors });
            showAlert(t("msg.error"), res.needsScope ? `${body}\n\n${t("msg.deleteScopeHint")}` : body);
          }
        },
      });
      if (!armed) showAlert(t("msg.error"), t("safe.unavailable"));
    }, 350);
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const s = makeStyles(colors);
  const webTop = Platform.OS === "web" ? 67 : 0;

  return (
    <KeyboardAvoidingView
      style={[s.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <AppBackground />
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + webTop, flexDirection: "row", alignItems: "center", gap: 10 }]}>
        <View style={{ width: 46, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: withAlpha(illustrationColor("changes", colors), 0.12), borderWidth: 1, borderColor: withAlpha(illustrationColor("changes", colors), 0.22) }}>
          <Illustration kind="changes" size={40} />
        </View>
        <Text style={s.headerTitle}>{t("files.title")}</Text>
      </View>

      <ScrollView style={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Repo selector — ouvre un modal défilable */}
        <View style={s.card}>
          <Text style={s.cardLabel}>{t("files.repo")}</Text>
          <Pressable accessibilityRole="button"
            style={({ pressed }) => [s.selector, pressed && { opacity: 0.7 }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {/**/});
              setShowRepoModal(true);
            }}
          >
            <Octicons name="repo" size={15} color={colors.mutedForeground} />
            <Text style={[s.selectorText, !selectedRepo && { color: colors.mutedForeground }]}>
              {selectedRepo ? selectedRepo.full_name : t("files.selectRepo")}
            </Text>
            <Feather name="chevron-down" size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {/* Branch selector — ouvre un modal défilable */}
        {selectedRepo && (
          <View style={s.card}>
            <Text style={s.cardLabel}>{t("files.branch")}</Text>
            <Pressable accessibilityRole="button"
              style={({ pressed }) => [s.selector, pressed && { opacity: 0.7 }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {/**/});
                setShowBranchModal(true);
              }}
            >
              <Octicons name="git-branch" size={15} color={colors.accent} />
              <Text style={s.selectorText}>{currentBranch}</Text>
              <Feather name="chevron-down" size={15} color={colors.mutedForeground} />
            </Pressable>
          </View>
        )}

        {/* Target path */}
        <View style={s.card}>
          <Text style={s.cardLabel}>{t("files.targetPath")}</Text>
          <View style={s.inputRow}>
            <Feather name="folder" size={15} color={colors.mutedForeground} />
            <TextInput
              style={s.pathInput}
              value={targetPath}
              onChangeText={setTargetPath}
              placeholder={t("files.targetPathPh")}
              placeholderTextColor={colors.mutedForeground}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>
        </View>

        {/* Commit message */}
        <View style={s.card}>
          <Text style={s.cardLabel}>{t("files.commitMsg")}</Text>
          <View style={s.inputRow}>
            <Octicons name="git-commit" size={15} color={colors.mutedForeground} />
            <TextInput
              style={s.pathInput}
              value={commitMsg}
              onChangeText={setCommitMsg}
              placeholder={t("files.commitMsgPh")}
              placeholderTextColor={colors.mutedForeground}
            />
          </View>
        </View>

        {/* File picker */}
        <View style={s.card}>
          <Text style={s.cardLabel}>{t("files.file")}</Text>
          {!file ? (
            <Pressable accessibilityRole="button" style={({ pressed }) => [s.pickBtn, pressed && { opacity: 0.7 }]} onPress={pickFile}>
              <Feather name="upload" size={16} color={colors.foreground} />
              <Text style={s.pickBtnText}>{t("files.pickFile")}</Text>
            </Pressable>
          ) : (
            <View style={s.fileList}>
              <View style={s.fileRow}>
                <Feather name={isZipFile(file) || isRarFile(file) ? "archive" : "file"} size={14} color={colors.mutedForeground} />
                <View style={{ flex: 1 }}>
                  <Text style={s.fileName} numberOfLines={1}>{file.name}</Text>
                  <Text style={s.fileSize}>{formatSize(file.size)}</Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={t("a11y.removeFile")} onPress={removeFile} hitSlop={14}>
                  <Feather name="x" size={16} color={colors.destructive} />
                </Pressable>
              </View>
              <Pressable accessibilityRole="button" style={({ pressed }) => [s.pickBtn, { marginTop: 0 }, pressed && { opacity: 0.7 }]} onPress={pickFile}>
                <Feather name="refresh-cw" size={14} color={colors.foreground} />
                <Text style={s.pickBtnText}>{t("files.replaceFile")}</Text>
              </Pressable>
            </View>
          )}
          <Text style={s.hint}>{t("files.zipHint")}</Text>
        </View>

        {/* Push button */}
        <Pressable accessibilityRole="button"
          style={({ pressed }) => [
            s.pushBtn,
            { opacity: pressed || pushing || !selectedRepo || !file ? 0.6 : 1 },
          ]}
          onPress={handlePush}
          disabled={pushing || !selectedRepo || !file}
        >
          {pushing ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <ActivityIndicator color={colors.primaryForeground} />
              {pushProgress && (
                <Text style={s.pushBtnText}>
                  {pushProgress.done}/{pushProgress.total}
                  {batchNum > 0 ? ` · ${t("files.batchLabel", { n: batchNum })}` : ""}
                </Text>
              )}
            </View>
          ) : (
            <>
              <Octicons name="upload" size={16} color={colors.primaryForeground} />
              <Text style={s.pushBtnText}>
                {file && isZipFile(file) ? t("files.pushZip") : t("files.pushFile")}
              </Text>
            </>
          )}
        </Pressable>

        {/* Vider le dépôt — supprime TOUS les fichiers */}
        {selectedRepo && (
          <View style={[s.card, { marginTop: 20, borderColor: colors.destructive }]}>
            <Text style={[s.cardLabel, { color: colors.destructive }]}>{t("files.clearRepo")}</Text>
            <Text style={s.dangerHint}>{t("files.clearRepoHint")}</Text>
            <View style={[s.inputRow, { borderTopWidth: 1, borderColor: colors.border }]}>
              <Octicons name="git-commit" size={15} color={colors.mutedForeground} />
              <TextInput
                style={s.pathInput}
                value={clearMsg}
                onChangeText={setClearMsg}
                placeholder={t("files.commitMsgPh")}
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
            <Pressable accessibilityRole="button"
              style={({ pressed }) => [
                s.deleteBtn,
                { opacity: pressed || clearing ? 0.6 : 1 },
              ]}
              onPress={handleClearRepo}
              disabled={clearing}
            >
              {clearing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Feather name="trash" size={16} color="#fff" />
                  <Text style={s.pushBtnText}>{t("files.clearRepoBtn")}</Text>
                </>
              )}
            </Pressable>
          </View>
        )}

        {/* Supprimer des dépôts — suppression définitive sur GitHub (multi-sélection) */}
        <View style={[s.card, { marginTop: 12, borderColor: colors.destructive }]}>
          <Text style={[s.cardLabel, { color: colors.destructive }]}>{t("files.deleteRepo")}</Text>
          <Text style={s.dangerHint}>{t("files.deleteRepoHint")}</Text>
          <Pressable accessibilityRole="button"
            style={({ pressed }) => [
              s.deleteBtn,
              { opacity: pressed || deletingRepo ? 0.6 : 1 },
            ]}
            onPress={() => setShowDeleteModal(true)}
            disabled={deletingRepo}
          >
            {deletingRepo ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Feather name="trash-2" size={16} color="#fff" />
                <Text style={s.pushBtnText}>
                  {deleteSel.length > 0
                    ? t("files.deleteRepoPickN", { n: deleteSel.length })
                    : t("files.deleteRepoPick")}
                </Text>
              </>
            )}
          </Pressable>
        </View>

        <View style={{ height: insets.bottom + (Platform.OS === "web" ? 34 : 90) }} />
      </ScrollView>

      {/* Sélecteur de dépôt (modal défilable) */}
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
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {/**/});
          }
          setShowRepoModal(false);
          setRepoSearch("");
        }}
        onClose={() => { setShowRepoModal(false); setRepoSearch(""); }}
      />

      {/* Sélecteur de branche (modal défilable) */}
      {/* Sélecteur multiple : dépôts à supprimer (case à cocher devant chaque dépôt) */}
      <PickerModal
        visible={showDeleteModal}
        title={t("files.deleteReposTitle")}
        loading={reposLoading}
        searchable
        searchValue={deleteSearch}
        onSearchChange={setDeleteSearch}
        searchPlaceholder={t("files.search")}
        emptyLabel={t("files.noRepoFound")}
        multiSelect
        selectAllLabel={t("files.selectAll")}
        onSelectAll={() => {
          const visibleIds = repos
            .filter((r) => r.full_name.toLowerCase().includes(deleteSearch.trim().toLowerCase()))
            .map((r) => String(r.id));
          setDeleteSel((prev) => Array.from(new Set([...prev, ...visibleIds])));
        }}
        items={repos
          .filter((r) => r.full_name.toLowerCase().includes(deleteSearch.trim().toLowerCase()))
          .map((r) => ({
            key: String(r.id),
            label: r.full_name,
            icon: r.private ? ("lock" as const) : ("repo" as const),
            checked: deleteSel.includes(String(r.id)),
          }))}
        onSelect={toggleDeleteSel}
        confirmLabel={t("files.deleteReposBtn", { n: deleteSel.length })}
        confirmDisabled={deleteSel.length === 0}
        onConfirm={handleDeleteRepos}
        onClose={() => setShowDeleteModal(false)}
      />

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
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {/**/});
          setShowBranchModal(false);
        }}
        onClose={() => setShowBranchModal(false)}
      />
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    headerTitle: { flex: 1, fontSize: 20, fontWeight: "700" as const, color: colors.foreground, fontFamily: "Inter_700Bold" },
    scroll: { flex: 1 },
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      margin: 12,
      marginBottom: 0,
      overflow: "hidden",
    },
    cardLabel: {
      fontSize: 11,
      color: colors.mutedForeground,
      fontFamily: "Inter_600SemiBold",
      letterSpacing: 0.8,
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 6,
    },
    selector: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    selectorText: { flex: 1, fontSize: 14, color: colors.foreground, fontFamily: "Inter_500Medium" },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    pathInput: { flex: 1, fontSize: 14, color: colors.foreground, fontFamily: "Inter_400Regular" },
    pickBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      margin: 12,
      marginTop: 4,
      padding: 14,
      borderRadius: colors.radius,
      borderWidth: 1.5,
      borderColor: colors.border,
      borderStyle: "dashed",
    },
    pickBtnText: { fontSize: 14, color: colors.foreground, fontFamily: "Inter_500Medium" },
    fileList: { borderTopWidth: 1, borderColor: colors.border },
    fileRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    fileName: { fontSize: 13, color: colors.foreground, fontFamily: "Inter_500Medium" },
    fileSize: { fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
    hint: {
      fontSize: 11,
      color: colors.mutedForeground,
      fontFamily: "Inter_400Regular",
      paddingHorizontal: 14,
      paddingBottom: 12,
      paddingTop: 2,
      lineHeight: 15,
    },
    dangerHint: {
      fontSize: 12,
      color: colors.mutedForeground,
      fontFamily: "Inter_400Regular",
      paddingHorizontal: 14,
      paddingBottom: 8,
      lineHeight: 17,
    },
    pushBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      backgroundColor: colors.primary,
      margin: 12,
      marginTop: 16,
      padding: 16,
      borderRadius: colors.radius,
    },
    pushBtnText: { fontSize: 16, fontWeight: "700" as const, color: colors.primaryForeground, fontFamily: "Inter_700Bold" },
    deleteBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      backgroundColor: colors.destructiveSolid,
      margin: 12,
      marginTop: 4,
      padding: 16,
      borderRadius: colors.radius,
    },
  });
}
