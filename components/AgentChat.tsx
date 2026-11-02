import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { aiLabel, DiffBlock, useAiSettings } from "@/components/AiUi";
import { Btn, IconBtn, MONO, ScreenHeader, Segmented } from "@/components/GitUi";
import { TAB_BAR_SPACE } from "@/constants/layout";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import { buildContext, runAgent, systemPrompt, undoBatch, type Preview, type UndoEntry } from "@/utils/ai/agent";
import { ghRepoOf } from "@/utils/ai/ci";
import { autoFixBuild, CI_MAX_ATTEMPTS, type CiEvent } from "@/utils/ai/ciFix";
import { aiErrorText, type AiMsg, type ToolCall } from "@/utils/ai/providers";
import { aiReady } from "@/utils/ai/settings";
import { dropSession, ensureSessionsLoaded, saveSession, sessions, sessionsReady, upsertSession, type UiItem } from "@/utils/ai/sessions";
import { showConfirm } from "@/utils/dialogs";
import { ctxFor, repoDir } from "@/utils/git/store";

let seq = 0;
const k = () => `i${Date.now()}-${seq++}`;

const TOOL_ICON: Record<string, React.ComponentProps<typeof Feather>["name"]> = {
  list_files: "folder",
  read_file: "file-text",
  read_files: "file-text",
  write_files: "file-plus",
  create_repository: "plus-square",
  search: "search",
  git_status: "activity",
  git_diff: "git-pull-request",
  git_log: "git-commit",
  write_file: "file-plus",
  edit_file: "edit-3",
  delete_file: "trash-2",
  move_file: "move",
  git_commit: "git-commit",
  git_sync: "refresh-cw",
  find_files: "search",
  ci_status: "activity",
  create_workflow: "play-circle",
  validate_workflow: "check-square",
};

/** Hauteur approximative de la barre d'onglets (elle est en position absolue). */
// Place occupée par la barre d'onglets flottante (hors zone système).
const TAB_BAR = TAB_BAR_SPACE;

/**
 * Discussion / agent IA sur un dépôt local. Utilisé par l'onglet « Agent IA »
 * (embedded) : les sessions sont conservées par dépôt.
 */
type ChatProps = { id: string; prompt?: string; embedded?: boolean; onPickRepo?: () => void };

export function AgentChat(props: ChatProps) {
  const colors = useColors();
  const [ready, setReady] = useState(sessionsReady());
  useEffect(() => {
    if (!ready) void ensureSessionsLoaded().then(() => setReady(true));
  }, [ready]);
  // Les conversations enregistrées sont chargées avant l'affichage.
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.background }}><AppBackground /></View>;
  return <AgentChatInner {...props} />;
}

function AgentChatInner({ id, prompt, embedded, onPickRepo }: ChatProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, lang } = useI18n() as ReturnType<typeof useI18n> & { lang: string };
  const settings = useAiSettings();
  const repos = useRepos();

  const initial = sessions.get(id) ?? { history: [], items: [], mode: "agent" as const, undo: [] as UndoEntry[][] };
  // Dépôt ciblé : celui de l'écran, ou un NOUVEAU dépôt créé par l'agent pendant la session.
  const [activeId, setActiveId] = useState<string>(initial.repoId ?? id);
  const activeRef = useRef(activeId);
  const c = repos.get(activeId) ?? repos.get(id);
  const [items, setItems] = useState<UiItem[]>(initial.items);
  const [mode, setMode] = useState<"chat" | "agent">(initial.mode);
  const [input, setInput] = useState(initial.items.length ? "" : (prompt ?? ""));
  const [running, setRunning] = useState(false);
  const [waitSec, setWaitSec] = useState(0);
  const [undoCount, setUndoCount] = useState(initial.undo.length);
  const [kbOpen, setKbOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setKbOpen(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKbOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const history = useRef<AiMsg[]>(initial.history);
  const resolvers = useRef(new Map<string, (ok: boolean) => void>());
  const abort = useRef<AbortController | null>(null);
  const listRef = useRef<FlatList<UiItem>>(null);

  function persist(next: UiItem[]) {
    upsertSession(id, { history: history.current, items: next, mode, provider: settings?.provider, repoId: activeRef.current });
    saveSession(id);
  }

  function push(item: UiItem) {
    setItems((cur) => {
      const next = [...cur, item];
      persist(next);
      return next;
    });
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
  }

  function patchItem(key: string, patch: Partial<UiItem>) {
    setItems((cur) => {
      const next = cur.map((x) => (x.key === key ? ({ ...x, ...patch } as UiItem) : x));
      persist(next);
      return next;
    });
  }

  if (!c) return null;
  const container = c;

  if (!aiReady(settings)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <AppBackground />
        <ScreenHeader title={t("ai.assistant")} noBack={embedded} />
        <View style={{ padding: 24, gap: 14 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 19 }}>{t("ai.notConfigured")}</Text>
          <Btn label={t("ai.settings")} icon="settings" variant="primary" onPress={() => router.push("/ai-settings" as any)} />
        </View>
      </View>
    );
  }

  /** Contexte donné aux outils de l'agent (dépôt courant, journal d'annulation). */
  function makeCtx(batch: UndoEntry[]) {
    return {
      undo: batch,
      dir: repoDir(container),
      containerId: container.id,
      author: container.author,
      gitCtx: () => ctxFor(container),
      onRepoChanged: (nc: { id: string }) => {
        activeRef.current = nc.id;
        setActiveId(nc.id);
      },
    };
  }

  /** Demande de validation d'une action : carte à accepter / refuser / tout accepter. */
  function askApprove(call: ToolCall, preview: Preview) {
    return new Promise<boolean | "all">((resolve) => {
      const key = k();
      resolvers.current.set(key, resolve);
      push({ key, kind: "approval", call, preview });
    });
  }

  /** Affiche les événements de l'agent (messages, outils, attente de quota, étapes du build). */
  function makeHandler() {
    const toolKeys = new Map<string, string>();
    return (e: CiEvent) => {
      if (e.type === "wait") {
        setWaitSec(e.seconds);
        return;
      }
      setWaitSec(0);
      if (e.type === "limit") push({ key: k(), kind: "assistant", text: t("ai.limit", { n: e.steps }) });
      else if (e.type === "notice") push({ key: k(), kind: "assistant", text: t(e.key) });
      else if (e.type === "ci") push({ key: k(), kind: "assistant", text: `🔧 ${t(e.key, e.vars)}` });
      else if (e.type === "assistant") push({ key: k(), kind: "assistant", text: e.text });
      else {
        const existing = toolKeys.get(e.call.id);
        if (existing) patchItem(existing, { status: e.status, output: e.output } as Partial<UiItem>);
        else {
          const key = k();
          toolKeys.set(e.call.id, key);
          push({ key, kind: "tool", call: e.call, status: e.status, output: e.output });
        }
      }
    };
  }

  /** Fin d'une exécution : les modifications deviennent annulables d'un seul geste. */
  function finishRun(batch: UndoEntry[]) {
    setRunning(false);
    setWaitSec(0);
    abort.current = null;
    const cur = sessions.get(id);
    const undo = [...(cur?.undo ?? [])];
    if (batch.length) undo.push(batch);
    upsertSession(id, { history: history.current, provider: settings?.provider, repoId: activeRef.current, undo: undo.slice(-10) });
    setUndoCount(Math.min(undo.length, 10));
    saveSession(id);
  }

  async function send() {
    const text = input.trim();
    if (!text || running || !settings) return;
    // Changement de fournisseur : l'historique brut n'est pas compatible.
    const sess = sessions.get(id);
    if (sess?.provider && sess.provider !== settings.provider) history.current = [];
    setInput("");
    push({ key: k(), kind: "user", text });
    setRunning(true);
    // Premier message : on joint l'arborescence et les fichiers clés (moins d'appels d'exploration).
    let sent = text;
    if (!history.current.length) {
      const pack = await buildContext(repoDir(container), text).catch(() => "");
      if (pack) sent = `CONTEXTE DU DÉPÔT « ${container.name} »\n${pack}\n\nDEMANDE :\n${text}`;
    }
    // Modifications annulées entre-temps : le modèle doit le savoir.
    const note = sessions.get(id)?.note;
    if (note) {
      sent = `[${note}]\n${sent}`;
      upsertSession(id, { note: undefined });
    }
    // Deux messages utilisateur d'affilée (réponse précédente interrompue) : on les fusionne.
    const lastMsg = history.current[history.current.length - 1];
    if (lastMsg?.role === "user") history.current = [...history.current.slice(0, -1), { role: "user", text: `${lastMsg.text}\n\n${sent}` }];
    else history.current = [...history.current, { role: "user", text: sent }];
    const batch: UndoEntry[] = [];
    abort.current = new AbortController();
    try {
      const out = await runAgent({
        settings,
        mode,
        system: systemPrompt(mode, container.name, lang ?? "fr", settings.freeTier),
        history: history.current,
        signal: abort.current.signal,
        ctx: makeCtx(batch),
        approve: askApprove,
        onEvent: makeHandler(),
      });
      history.current = out;
    } catch (e) {
      push({ key: k(), kind: "error", text: aiErrorText(e, t) });
      // On retire le dernier message utilisateur sans réponse pour garder un historique valide.
      const last = history.current[history.current.length - 1];
      if (last?.role === "user") history.current = history.current.slice(0, -1);
    } finally {
      finishRun(batch);
    }
  }

  async function runAutoFix() {
    if (!settings || running) return;
    setMode("agent");
    setRunning(true);
    const sess = sessions.get(id);
    if (sess?.provider && sess.provider !== settings.provider) history.current = [];
    push({ key: k(), kind: "user", text: t("ci.userMsg") });
    const batch: UndoEntry[] = [];
    abort.current = new AbortController();
    try {
      const res = await autoFixBuild({
        settings,
        lang: lang ?? "fr",
        repoName: container.name,
        ctx: makeCtx(batch),
        history: history.current,
        approve: askApprove,
        onEvent: makeHandler(),
        signal: abort.current.signal,
      });
      history.current = res.history;
      push({ key: k(), kind: "assistant", text: `${res.ok ? "✅" : "⚠️"} ${t(res.reason, { n: res.attempts, max: CI_MAX_ATTEMPTS })}` });
    } catch (e) {
      push({ key: k(), kind: "error", text: aiErrorText(e, t) });
      const last = history.current[history.current.length - 1];
      if (last?.role === "user") history.current = history.current.slice(0, -1);
    } finally {
      finishRun(batch);
    }
  }

  function autoFix() {
    if (running) return;
    showConfirm({
      title: t("ci.confirmTitle"),
      message: t("ci.confirmBody", { n: CI_MAX_ATTEMPTS }),
      confirmText: t("ci.start"),
      cancelText: t("msg.cancel"),
      onConfirm: () => void runAutoFix(),
    });
  }

  function answer(key: string, ok: boolean | "all") {
    resolvers.current.get(key)?.(ok);
    resolvers.current.delete(key);
    patchItem(key, { answer: !!ok } as Partial<UiItem>);
  }

  function stop() {
    abort.current?.abort();
    resolvers.current.forEach((r) => r(false));
    resolvers.current.clear();
  }

  function reset() {
    stop();
    history.current = [];
    setItems([]);
    activeRef.current = id;
    setActiveId(id);
    dropSession(id);
    setUndoCount(0);
  }

  async function undo() {
    const cur = sessions.get(id);
    const batch = cur?.undo[cur.undo.length - 1];
    if (!cur || !batch || running) return;
    try {
      const n = await undoBatch(batch);
      upsertSession(id, { undo: cur.undo.slice(0, -1), note: "Note : l'utilisateur a ANNULÉ tes dernières modifications de fichiers (le dépôt est revenu à l'état d'avant). Ne suppose pas qu'elles existent encore." });
      setUndoCount(cur.undo.length - 1);
      push({ key: k(), kind: "assistant", text: t("ai.undone", { n }) });
    } catch (e: any) {
      push({ key: k(), kind: "error", text: String(e?.message ?? e) });
    }
  }

  const argLabel = (call: ToolCall) => {
    const a = call.args;
    if (Array.isArray(a.files)) return a.files.map((f: any) => f?.path).filter(Boolean).join(", ");
    if (Array.isArray(a.paths)) return a.paths.join(", ");
    return String(a.path ?? a.query ?? a.message ?? a.name ?? a.template ?? a.file ?? (a.from ? `${a.from} → ${a.to}` : ""));
  };

  function renderItem({ item }: { item: UiItem }) {
    if (item.kind === "user") {
      return (
        <View style={{ alignSelf: "flex-end", maxWidth: "88%", backgroundColor: colors.greenBg, borderColor: colors.primary, borderWidth: 1, borderRadius: 14, padding: 11, marginVertical: 5 }}>
          <Text selectable style={{ color: colors.foreground, fontSize: 14, lineHeight: 20 }}>
            {item.text}
          </Text>
        </View>
      );
    }
    if (item.kind === "assistant") {
      return (
        <View style={{ maxWidth: "95%", paddingVertical: 6 }}>
          <Text selectable style={{ color: colors.foreground, fontSize: 14, lineHeight: 21 }}>
            {item.text}
          </Text>
        </View>
      );
    }
    if (item.kind === "error") {
      return <Text style={{ color: colors.destructive, fontSize: 13, marginVertical: 6 }}>{item.text}</Text>;
    }
    if (item.kind === "tool") {
      const color = item.status === "error" || item.status === "refused" ? colors.destructive : item.status === "running" ? "#e3b341" : colors.mutedForeground;
      return (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 3 }}>
          {item.status === "running" ? <ActivityIndicator size="small" color="#e3b341" /> : <Feather name={TOOL_ICON[item.call.name] ?? "tool"} size={13} color={color} />}
          <Text style={{ flex: 1, color, fontFamily: MONO, fontSize: 11 }} numberOfLines={1}>
            {t(`ai.tool.${item.call.name}`)} {argLabel(item.call)}
            {item.status === "refused" ? ` — ${t("ai.refused")}` : item.status === "error" ? ` — ${item.output?.replace(/^ERREUR : /, "")}` : ""}
          </Text>
        </View>
      );
    }
    // Validation d'une action
    const p = item.preview;
    return (
      <View style={{ borderWidth: 1, borderColor: item.answer === undefined ? "#7c5cff" : colors.border, borderRadius: colors.radius, marginVertical: 8, overflow: "hidden", backgroundColor: colors.card }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 11 }}>
          <Feather name={TOOL_ICON[item.call.name] ?? "tool"} size={15} color="#a78bfa" />
          <Text style={{ flex: 1, color: colors.foreground, fontSize: 13, fontFamily: "Inter_600SemiBold" }} numberOfLines={2}>
            {t(`ai.action.${p.title}`)} {p.path ? <Text style={{ fontFamily: MONO, fontSize: 12 }}>{p.path}</Text> : null}
          </Text>
          {p.diff ? (
            <Text style={{ fontFamily: MONO, fontSize: 11 }}>
              <Text style={{ color: "#56d364" }}>+{p.diff.adds}</Text> <Text style={{ color: "#f85149" }}>−{p.diff.dels}</Text>
            </Text>
          ) : null}
        </View>
        {p.diff && p.diff.rows.length ? <DiffBlock diff={p.diff} max={item.answer === undefined ? 200 : 12} /> : null}
        {p.files?.map((f) => (
          <View key={f.path}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: colors.secondary }}>
              <Text style={{ flex: 1, color: colors.foreground, fontFamily: MONO, fontSize: 11 }} numberOfLines={1}>
                {f.path}
              </Text>
              <Text style={{ fontFamily: MONO, fontSize: 11 }}>
                <Text style={{ color: "#56d364" }}>+{f.diff.adds}</Text> <Text style={{ color: "#f85149" }}>−{f.diff.dels}</Text>
              </Text>
            </View>
            {item.answer === undefined ? <DiffBlock diff={f.diff} max={40} /> : null}
          </View>
        ))}
        {p.detail ? <Text style={{ color: colors.mutedForeground, fontSize: 12, paddingHorizontal: 11, paddingBottom: 8, fontFamily: MONO }}>{p.detail}</Text> : null}
        {item.answer === undefined ? (
          <View style={{ flexDirection: "row", gap: 8, padding: 10 }}>
            <Btn small label={t("ai.reject")} icon="x" onPress={() => answer(item.key, false)} style={{ flex: 1 }} />
            <Btn small label={t("ai.accept")} icon="check" variant="primary" onPress={() => answer(item.key, true)} style={{ flex: 1 }} />
            <Btn small label={t("ai.acceptAll")} icon="check-circle" onPress={() => answer(item.key, "all")} style={{ flex: 1 }} />
          </View>
        ) : (
          <Text style={{ color: item.answer ? colors.accent : colors.destructive, fontSize: 11, padding: 10 }}>{item.answer ? t("ai.accepted") : t("ai.refused")}</Text>
        )}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <AppBackground />
      <ScreenHeader
        title={t("ai.assistant")}
        noBack={embedded}
        subtitle={`${container.name} · ${aiLabel(settings)}`}
        right={
          <View style={{ flexDirection: "row" }}>
            {ghRepoOf(container.url) ? <IconBtn icon="tool" onPress={autoFix} disabled={running} /> : null}
            <IconBtn icon="rotate-ccw" onPress={undo} disabled={!undoCount || running} />
            <IconBtn icon="trash" onPress={reset} disabled={!items.length} />
            <IconBtn icon="settings" onPress={() => router.push("/ai-settings" as any)} />
          </View>
        }
      />
      {onPickRepo ? (
        <Pressable
          onPress={onPickRepo}
          style={{ flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 12, marginTop: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}
        >
          <Feather name="git-branch" size={14} color={colors.accent} />
          <Text style={{ flex: 1, color: colors.foreground, fontSize: 13, fontFamily: "Inter_600SemiBold" }} numberOfLines={1}>
            {container.name}
          </Text>
          <Feather name="chevron-down" size={15} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
      <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
        <Segmented
          value={mode}
          onChange={(v) => {
            setMode(v);
            upsertSession(id, { history: history.current, mode: v, provider: settings?.provider, repoId: activeRef.current });
            saveSession(id);
          }}
          options={[
            { value: "chat", label: t("ai.modeChat") },
            { value: "agent", label: t("ai.modeAgent") },
          ]}
        />
      </View>
      {activeId !== id ? (
        <Pressable
          onPress={() => router.push({ pathname: "/repo/[id]", params: { id: activeId } } as any)}
          style={{ flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 12, marginTop: 8, padding: 9, borderRadius: 10, borderWidth: 1, borderColor: "#7c5cff" }}
        >
          <Feather name="plus-square" size={14} color="#a78bfa" />
          <Text style={{ flex: 1, color: colors.foreground, fontSize: 12 }} numberOfLines={1}>
            {t("ai.activeRepo", { name: container.name })}
          </Text>
          <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
      <FlatList
        ref={listRef}
        initialNumToRender={14}
        windowSize={9}
        maxToRenderPerBatch={8}
        data={items}
        keyExtractor={(x) => x.key}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 12, flexGrow: 1 }}
        ListEmptyComponent={
          <View style={{ paddingTop: 30, gap: 10 }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 19 }}>{t(mode === "agent" ? "ai.introAgent" : "ai.introChat")}</Text>
            {(mode === "agent" ? ["ai.ex.agent1", "ai.ex.agent4", "ai.ex.agent2", "ai.ex.agent3"] : ["ai.ex.chat1", "ai.ex.chat2", "ai.ex.chat3"]).map((key) => (
              <Pressable key={key} onPress={() => setInput(t(key))} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 10 }}>
                <Text style={{ color: colors.foreground, fontSize: 13 }}>{t(key)}</Text>
              </Pressable>
            ))}
          </View>
        }
      />
      {waitSec > 0 ? (
        <Text style={{ color: "#e3b341", fontSize: 12, paddingHorizontal: 14, paddingBottom: 6 }}>{t("ai.waiting", { n: waitSec })}</Text>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, paddingBottom: embedded && !kbOpen ? insets.bottom + TAB_BAR + 4 : insets.bottom + 10, borderTopWidth: 1, borderColor: colors.border }}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={t(mode === "agent" ? "ai.placeholderAgent" : "ai.placeholderChat")}
          placeholderTextColor={colors.mutedForeground}
          multiline
          style={{
            flex: 1,
            maxHeight: 140,
            backgroundColor: colors.input,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 18,
            color: colors.foreground,
            paddingHorizontal: 14,
            paddingVertical: 10,
            fontSize: 14,
          }}
        />
        <Pressable
          onPress={running ? stop : send}
          style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: running ? colors.destructive : "#7c5cff" }}
        >
          <Feather name={running ? "square" : "arrow-up"} size={20} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
