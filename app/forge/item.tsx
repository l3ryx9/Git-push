import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { forgeErrorText, PatchView, StateBadge, useForgeRef } from "@/components/ForgeUi";
import { AiButton } from "@/components/AiUi";
import { Btn, Card, IconBtn, MONO, ScreenHeader, SectionTitle, timeAgo } from "@/components/GitUi";
import { draftText } from "@/utils/ai/tasks";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { showAlert } from "@/utils/dialogs";
import {
  addComment,
  getItem,
  listComments,
  listPullFiles,
  setItemState,
  type Comment,
  type FileChange,
  type ItemDetail,
  type Kind,
} from "@/utils/forge";
import { C } from "@/constants/colors";

export default function ForgeItemScreen() {
  const ref = useForgeRef();
  const kind: Kind = ref.raw.kind === "pulls" ? "pulls" : "issues";
  const n = Number(ref.raw.number);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, lang } = useI18n() as ReturnType<typeof useI18n> & { lang: string };
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [files, setFiles] = useState<FileChange[] | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [it, cs] = await Promise.all([getItem(ref, kind, n), listComments(ref, kind, n)]);
      setItem(it);
      setComments(cs);
      setError(null);
    } catch (e) {
      setError(forgeErrorText(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.project, kind, n]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadFiles() {
    try {
      setFiles(await listPullFiles(ref, n));
    } catch (e) {
      showAlert(t("f.files"), forgeErrorText(e, t));
    }
  }

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      await addComment(ref, kind, n, body);
      setDraft("");
      await load();
    } catch (e) {
      showAlert(t("f.comment"), forgeErrorText(e, t));
    } finally {
      setSending(false);
    }
  }

  async function toggleState() {
    if (!item) return;
    try {
      await setItemState(ref, kind, n, item.state !== "open");
      await load();
    } catch (e) {
      showAlert(`#${n}`, forgeErrorText(e, t));
    }
  }

  const mergeLabel: Record<string, string> = {
    clean: t("f.merge.clean"),
    conflict: t("f.merge.conflict"),
    merged: t("f.state.merged"),
    unknown: t("f.merge.unknown"),
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <AppBackground />
      <ScreenHeader art="forge"
        title={`#${n}`}
        subtitle={ref.project}
        right={item ? <IconBtn icon="external-link" onPress={() => WebBrowser.openBrowserAsync(item.url).catch(() => undefined)} /> : null}
      />
      {error ? (
        <Text style={{ color: colors.destructive, padding: 20 }}>{error}</Text>
      ) : !item ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
          <Text selectable style={{ color: colors.foreground, fontSize: 17, fontFamily: "Inter_700Bold", lineHeight: 23 }}>
            {item.title}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <StateBadge state={item.state} draft={item.draft} t={t} />
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
              {item.author} · {timeAgo(new Date(item.createdAt).getTime(), t)}
            </Text>
          </View>
          {kind === "pulls" && item.head ? (
            <Card style={{ padding: 12, marginTop: 12, gap: 6 }}>
              <Text style={{ color: colors.foreground, fontFamily: MONO, fontSize: 12 }}>
                {item.head} → {item.base}
              </Text>
              {item.mergeable ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{mergeLabel[item.mergeable]}</Text> : null}
            </Card>
          ) : null}
          {item.labels.length ? <Text style={{ color: colors.accent, fontSize: 11, marginTop: 10 }}>{item.labels.join(" · ")}</Text> : null}

          <Card style={{ padding: 14, marginTop: 12 }}>
            <Text selectable style={{ color: item.body ? colors.foreground : colors.mutedForeground, fontSize: 13, lineHeight: 19 }}>
              {item.body || t("f.noDescription")}
            </Text>
          </Card>

          {kind === "pulls" ? (
            <>
              <SectionTitle>{t("f.files")}</SectionTitle>
              {files === null ? (
                <Btn small label={t("f.showFiles")} icon="file-text" onPress={loadFiles} />
              ) : (
                <Card>
                  {files.map((f, i) => (
                    <View key={f.path} style={i < files.length - 1 ? { borderBottomWidth: 1, borderColor: colors.border } : undefined}>
                      <Pressable onPress={() => setOpen((o) => ({ ...o, [f.path]: !o[f.path] }))} style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 11 }}>
                        <Feather name={open[f.path] ? "chevron-down" : "chevron-right"} size={14} color={colors.mutedForeground} />
                        <Text style={{ flex: 1, color: colors.foreground, fontFamily: MONO, fontSize: 12 }} numberOfLines={1} ellipsizeMode="head">
                          {f.path}
                        </Text>
                        {f.additions !== undefined ? (
                          <Text style={{ fontFamily: MONO, fontSize: 11 }}>
                            <Text style={{ color: C.diffAdd }}>+{f.additions}</Text> <Text style={{ color: C.diffDel }}>−{f.deletions}</Text>
                          </Text>
                        ) : (
                          <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{f.status}</Text>
                        )}
                      </Pressable>
                      {open[f.path] ? (
                        f.patch ? (
                          <ScrollView horizontal>
                            <PatchView patch={f.patch} />
                          </ScrollView>
                        ) : (
                          <Text style={{ color: colors.mutedForeground, fontSize: 11, padding: 10 }}>{t("f.noPatch")}</Text>
                        )
                      ) : null}
                    </View>
                  ))}
                  {!files.length ? <Text style={{ color: colors.mutedForeground, padding: 12 }}>{t("g.commit.noFiles")}</Text> : null}
                </Card>
              )}
            </>
          ) : null}

          <SectionTitle>{t("f.comments", { n: comments.length })}</SectionTitle>
          {comments.map((c) => (
            <Card key={c.id} style={{ padding: 12, marginBottom: 8 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 11, marginBottom: 6 }}>
                {c.author} · {timeAgo(new Date(c.createdAt).getTime(), t)}
              </Text>
              <Text selectable style={{ color: colors.foreground, fontSize: 13, lineHeight: 19 }}>
                {c.body}
              </Text>
            </Card>
          ))}

          <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 4 }}>
            <AiButton
              label={t("ai.draftReply")}
              run={(ai) =>
                draftText(
                  ai,
                  "comment",
                  `${kind === "pulls" ? "Pull request" : "Issue"} #${n} « ${item.title} » (${ref.project})\n\n${item.body.slice(0, 6000)}\n\nFil :\n${comments
                    .slice(-15)
                    .map((c) => `${c.author} : ${c.body.slice(0, 1500)}`)
                    .join("\n---\n")}`,
                  draft,
                  lang ?? "fr"
                )
              }
              onResult={setDraft}
            />
          </View>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t("f.commentPh")}
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={{
              backgroundColor: colors.input,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: colors.radius,
              color: colors.foreground,
              padding: 12,
              minHeight: 70,
              textAlignVertical: "top",
              marginTop: 6,
            }}
          />
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            {item.state !== "merged" ? (
              <Btn
                label={item.state === "open" ? t("f.close") : t("f.reopen")}
                icon={item.state === "open" ? "x-circle" : "rotate-ccw"}
                variant={item.state === "open" ? "danger" : "secondary"}
                onPress={toggleState}
                style={{ flex: 1 }}
              />
            ) : null}
            <Btn label={t("f.comment")} icon="send" variant="primary" onPress={send} loading={sending} disabled={!draft.trim()} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}
