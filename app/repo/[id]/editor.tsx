import { Image } from "expo-image";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { DiffApprovalModal, useAiSettings } from "@/components/AiUi";
import { describeError, IconBtn, MONO, PromptModal, ScreenHeader } from "@/components/GitUi";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import { showAlert, showConfirm } from "@/utils/dialogs";
import { aiErrorText } from "@/utils/ai/providers";
import { aiReady } from "@/utils/ai/settings";
import { aiEditFile } from "@/utils/ai/tasks";
import { isBinary, unifiedDiff, type DiffResult } from "@/utils/git/diff";
import { decodeUtf8, pathInfo, readBytes, toUri, writeTextDeep } from "@/utils/git/fs";
import { repoDir } from "@/utils/git/store";
import { C } from "@/constants/colors";

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i;
const MAX_EDIT = 1024 * 1024;

// ─── Coloration syntaxique légère ─────────────────────────────────────────────

const KEYWORDS = new Set(
  (
    "abstract as async await break case catch class const continue data def default defer del delete do elif else enum export extends " +
    "false final finally fn for from fun func function go if impl implements import in interface is let match mod module mut new nil " +
    "none not null object of or override package pass private protected pub public raise readonly return sealed self static struct " +
    "super suspend switch this throw throws true try type typeof undefined use val var void when where while with yield"
  ).split(" ")
);
const HASH_COMMENT = /\.(py|sh|bash|zsh|rb|ya?ml|toml|conf|ini|properties|gitignore|dockerfile|r|pl|mk)$|(^|\/)(\.gitignore|exclude|Makefile|Dockerfile|\.env.*)$/i;
const NO_HIGHLIGHT = /\.(md|markdown|txt|csv|log|rst)$/i;

type Tok = { s: string; c?: string };

function tokenize(line: string, hash: boolean, palette: Record<string, string>): Tok[] {
  const re = hash
    ? /(#.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g
    : /(\/\/.*$|\/\*.*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
  const out: Tok[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ s: line.slice(last, m.index) });
    const w = m[0];
    let c: string | undefined;
    if (w.startsWith("//") || w.startsWith("/*") || w.startsWith("#")) c = palette.comment;
    else if (/^["'`]/.test(w)) c = palette.string;
    else if (/^\d/.test(w)) c = palette.number;
    else if (KEYWORDS.has(w)) c = palette.keyword;
    out.push({ s: w, c });
    last = m.index + w.length;
  }
  if (last < line.length) out.push({ s: line.slice(last) });
  return out;
}

export default function EditorScreen() {
  const { id, path = "" } = useLocalSearchParams<{ id: string; path: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, lang } = useI18n() as ReturnType<typeof useI18n> & { lang: string };
  const navigation = useNavigation();
  const ai = useAiSettings();
  const [askAi, setAskAi] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [proposal, setProposal] = useState<{ text: string; diff: DiffResult; instruction: string } | null>(null);
  const repos = useRepos();
  const c = repos.get(id);
  const abs = c ? `${repoDir(c)}/${path}` : "";
  const isImage = IMAGE_RE.test(path);

  const [loading, setLoading] = useState(true);
  const [binary, setBinary] = useState<number | null>(null);
  const [original, setOriginal] = useState("");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(false);
  const dirty = text !== original;
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    if (!c || isImage) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const info = await pathInfo(abs);
        if (!info.exists) {
          setEditing(true); // fichier à créer (ex : .git/info/exclude)
          return;
        }
        if (info.size > MAX_EDIT * 4) {
          setBinary(info.size);
          return;
        }
        const bytes = (await readBytes(abs)) ?? new Uint8Array(0);
        if (isBinary(bytes)) {
          setBinary(bytes.length);
          return;
        }
        const s = decodeUtf8(bytes);
        setOriginal(s);
        setText(s);
        if (!s.length) setEditing(true);
      } catch (e) {
        showAlert(path, describeError(e, t));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abs]);

  // Avertit avant de quitter avec des modifications non enregistrées.
  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove" as any, (e: any) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      showConfirm({
        title: t("g.editor.unsavedTitle"),
        message: t("g.editor.unsavedBody"),
        confirmText: t("g.editor.discard"),
        cancelText: t("msg.cancel"),
        destructive: true,
        onConfirm: () => {
          dirtyRef.current = false;
          navigation.dispatch(e.data.action);
        },
      });
    });
    return unsub;
  }, [navigation, t]);

  const palette = useMemo(
    () => ({ comment: "#6a737d", string: "#9ecbff", number: "#f8c555", keyword: "#ff7b72" }),
    []
  );
  const hash = HASH_COMMENT.test(path);
  const plain = NO_HIGHLIGHT.test(path) || text.length > 400000;
  const lines = useMemo(() => (editing ? [] : text.split("\n")), [text, editing]);
  const gutter = String(lines.length).length * 8 + 14;

  async function save() {
    setSaving(true);
    try {
      await writeTextDeep(abs, text);
      setOriginal(text);
      setEditing(false);
    } catch (e) {
      showAlert(t("g.editor.save"), describeError(e, t));
    } finally {
      setSaving(false);
    }
  }

  async function runAi(values: Record<string, string>) {
    const instruction = (values.instruction ?? "").trim();
    setAskAi(false);
    if (!instruction || !ai) return;
    setAiBusy(true);
    try {
      const next = await aiEditFile(ai, path, text, instruction, lang ?? "fr");
      setProposal({ text: next, diff: unifiedDiff(text, next), instruction });
    } catch (e) {
      showAlert(t("ai.editFile"), aiErrorText(e, t));
    } finally {
      setAiBusy(false);
    }
  }

  async function acceptProposal() {
    const p = proposal;
    setProposal(null);
    if (!p) return;
    setText(p.text);
    setSaving(true);
    try {
      await writeTextDeep(abs, p.text);
      setOriginal(p.text);
      setEditing(false);
    } catch (e) {
      showAlert(t("g.editor.save"), describeError(e, t));
    } finally {
      setSaving(false);
    }
  }

  if (!c) return null;
  const name = path.split("/").pop() ?? path;

  const right = isImage || binary !== null ? null : (
    <View style={{ flexDirection: "row" }}>
      {aiReady(ai) && !path.startsWith(".git/") ? (
        aiBusy ? (
          <ActivityIndicator size="small" color={C.ai} style={{ paddingHorizontal: 8 }} />
        ) : (
          <IconBtn icon="zap" color={C.ai} onPress={() => setAskAi(true)} />
        )
      ) : null}
      {dirty ? <IconBtn icon="save" color={colors.accent} onPress={save} disabled={saving} /> : null}
      <IconBtn icon={editing ? "eye" : "edit-2"} onPress={() => setEditing((v) => !v)} />
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <AppBackground />
      <ScreenHeader art="editor" title={name + (dirty ? " •" : "")} subtitle={path} right={right} onBack={() => router.back()} />
      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} />
      ) : isImage ? (
        <ScrollView maximumZoomScale={5} minimumZoomScale={1} contentContainerStyle={{ flexGrow: 1 }} centerContent>
          <Image source={{ uri: toUri(abs) }} style={{ flex: 1, minHeight: 300 }} contentFit="contain" />
        </ScrollView>
      ) : binary !== null ? (
        <Text style={{ color: colors.mutedForeground, padding: 20, textAlign: "center" }}>{t("g.editor.binary", { size: binary })}</Text>
      ) : editing ? (
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          autoFocus={!original}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          textAlignVertical="top"
          style={{
            flex: 1,
            color: colors.foreground,
            fontFamily: MONO,
            fontSize: 13,
            lineHeight: 19,
            padding: 12,
            paddingBottom: insets.bottom + 30,
          }}
        />
      ) : (
        <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ minWidth: "100%" }}>
          <FlatList
            data={lines}
            keyExtractor={(_, i) => String(i)}
            style={{ flex: 1 }}
            initialNumToRender={60}
            windowSize={15}
            contentContainerStyle={{ paddingVertical: 8, paddingBottom: insets.bottom + 30 }}
            renderItem={({ item, index }) => (
              <View style={{ flexDirection: "row" }}>
                <Text style={{ width: gutter, textAlign: "right", paddingRight: 10, color: colors.mutedForeground, fontFamily: MONO, fontSize: 12, lineHeight: 19 }}>
                  {index + 1}
                </Text>
                <Text style={{ color: colors.foreground, fontFamily: MONO, fontSize: 13, lineHeight: 19, paddingRight: 16 }}>
                  {plain
                    ? item
                    : tokenize(item, hash, palette).map((tk, i) =>
                        tk.c ? (
                          <Text key={i} style={{ color: tk.c }}>
                            {tk.s}
                          </Text>
                        ) : (
                          tk.s
                        )
                      )}
                </Text>
              </View>
            )}
          />
        </ScrollView>
      )}
      <PromptModal
        visible={askAi}
        title={t("ai.editFile")}
        fields={[{ key: "instruction", label: t("ai.instruction"), placeholder: t("ai.instructionPh") }]}
        confirmText={t("ai.run")}
        cancelText={t("msg.cancel")}
        onConfirm={runAi}
        onClose={() => setAskAi(false)}
      />
      <DiffApprovalModal
        visible={!!proposal}
        title={proposal ? `${name} — ${proposal.instruction}` : ""}
        diff={proposal?.diff ?? null}
        onAccept={acceptProposal}
        onReject={() => setProposal(null)}
      />
    </KeyboardAvoidingView>
  );
}
