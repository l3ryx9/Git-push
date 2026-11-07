import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { Btn, ScreenHeader } from "@/components/GitUi";
import { useI18n } from "@/context/LanguageContext";
import { useRepos } from "@/context/ReposContext";
import { useColors } from "@/hooks/useColors";
import { fmtBytes } from "@/utils/ai/pure";
import { buildReport, runChecks, type Check } from "@/utils/diagnostics";
import { showConfirm } from "@/utils/dialogs";
import { clearErrors, readErrors, type ErrorEntry } from "@/utils/errorLog";
import { measureUsage, removeOrphans, type Usage } from "@/utils/git/storage";
import { secretsStatus } from "@/utils/secrets";
import { C } from "@/constants/colors";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

/**
 * Maintenance : un seul écran pour vérifier que tout va bien, libérer de l'espace
 * et obtenir un rapport à partager en cas de problème. Chaque action = un bouton.
 */
export default function MaintenanceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { containers, remove } = useRepos();

  const [sec, setSec] = useState<{ secure: boolean; degraded: boolean } | null>(null);
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [measuring, setMeasuring] = useState("");
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    secretsStatus().then(setSec);
    readErrors().then(setErrors);
  }, []);

  async function analyze() {
    setMeasuring("…");
    try {
      setUsage(await measureUsage(containers, (done, total) => setMeasuring(`${done}/${total}`)));
    } finally {
      setMeasuring("");
    }
  }

  async function freeOrphans() {
    if (!usage?.orphans.length) return;
    const freed = await removeOrphans(usage.orphans);
    setUsage({ ...usage, orphans: [], total: Math.max(0, usage.total - freed) });
  }

  function deleteRepo(id: string, name: string) {
    showConfirm({
      title: t("maint.sto.deleteTitle"),
      message: t("maint.sto.deleteBody", { name }),
      confirmText: t("g.common.delete"),
      cancelText: t("msg.cancel"),
      destructive: true,
      onConfirm: () => {
        void remove(id).then(() => {
          setUsage((u) => {
            if (!u) return u;
            const gone = u.repos.find((r) => r.id === id);
            return { ...u, repos: u.repos.filter((r) => r.id !== id), total: Math.max(0, u.total - (gone?.bytes ?? 0)) };
          });
        });
      },
    });
  }

  async function verify() {
    setRunning(true);
    setChecks([]);
    try {
      await runChecks((c) => setChecks((cur) => [...cur, c]));
      setErrors(await readErrors());
    } finally {
      setRunning(false);
    }
  }

  async function share() {
    const text = await buildReport(checks, usage, (id) => t(`maint.check.${id}`));
    Share.share({ message: text }).catch(() => undefined);
  }

  const todo: string[] = [];
  if (sec && (!sec.secure || sec.degraded)) todo.push(t("maint.sec.degraded"));
  if (usage?.orphans.length) todo.push(t("maint.sto.orphans", { size: fmtBytes(usage.orphans.reduce((n, o) => n + o.bytes, 0)) }));
  if (checks.some((c) => !c.ok)) todo.push(t("maint.diag.failed"));
  if (errors.length) todo.push(t("maint.err.some", { n: errors.length }));

  const section = (icon: FeatherName, title: string, hint: string, children: React.ReactNode) => (
    <View style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: colors.radius, padding: 14, marginBottom: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Feather name={icon} size={16} color={colors.accent} />
        <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: "Inter_700Bold" }}>{title}</Text>
      </View>
      <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 17, marginBottom: 12 }}>{hint}</Text>
      {children}
    </View>
  );

  const line = (left: string, right?: string, color?: string, onTrash?: () => void) => (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 7, borderTopWidth: 1, borderColor: colors.border, gap: 8 }}>
      <Text style={{ flex: 1, color: color ?? colors.foreground, fontSize: 13 }} numberOfLines={2}>
        {left}
      </Text>
      {right ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{right}</Text> : null}
      {onTrash ? (
        <Pressable hitSlop={8} onPress={onTrash}>
          <Feather name="trash-2" size={16} color={colors.destructive} />
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppBackground />
      <ScreenHeader title={t("maint.title")} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 40 }}>
        {/* Bilan */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: todo.length ? "#2a2208" : colors.greenBg, borderRadius: colors.radius, padding: 14, marginBottom: 12 }}>
          <Feather name={todo.length ? "alert-circle" : "check-circle"} size={26} color={todo.length ? C.warning : colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: "Inter_700Bold" }}>
              {todo.length ? t("maint.healthTodo", { n: todo.length }) : t("maint.healthOk")}
            </Text>
            {todo.map((x) => (
              <Text key={x} style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}>
                • {x}
              </Text>
            ))}
          </View>
        </View>

        {section(
          "lock",
          t("maint.sec.title"),
          t("maint.sec.hint"),
          sec ? (
            <Text style={{ color: sec.secure && !sec.degraded ? colors.primary : C.warning, fontSize: 13, fontFamily: "Inter_600SemiBold" }}>
              {sec.secure && !sec.degraded ? `✓ ${t("maint.sec.ok")}` : `⚠ ${t("maint.sec.degraded")}`}
            </Text>
          ) : (
            <ActivityIndicator color={colors.accent} />
          )
        )}

        {section(
          "hard-drive",
          t("maint.sto.title"),
          t("maint.sto.hint"),
          <>
            <Btn label={measuring ? t("maint.sto.analyzing", { p: measuring }) : usage ? t("maint.sto.again") : t("maint.sto.analyze")} icon="search" onPress={analyze} loading={!!measuring} />
            {usage ? (
              <View style={{ marginTop: 12 }}>
                <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 6 }}>{t("maint.sto.total", { size: fmtBytes(usage.total) })}</Text>
                {usage.repos.map((r) => line(r.name, fmtBytes(r.bytes), undefined, () => deleteRepo(r.id, r.name)))}
                {usage.orphans.length ? (
                  <View style={{ marginTop: 10 }}>
                    {line(t("maint.sto.orphansLabel"), fmtBytes(usage.orphans.reduce((n, o) => n + o.bytes, 0)), C.warning)}
                    <Btn label={t("maint.sto.free")} icon="trash-2" onPress={freeOrphans} style={{ marginTop: 8 }} />
                  </View>
                ) : null}
              </View>
            ) : null}
          </>
        )}

        {section(
          "activity",
          t("maint.diag.title"),
          t("maint.diag.hint"),
          <>
            <Btn label={running ? t("maint.diag.running") : t("maint.diag.run")} icon="check-circle" variant="primary" onPress={verify} loading={running} />
            {checks.length ? (
              <View style={{ marginTop: 12 }}>
                {checks.map((c) => line(`${c.ok ? "✓" : "✗"} ${t(`maint.check.${c.id}`)}${c.detail ? ` — ${c.detail}` : ""}`, undefined, c.ok ? undefined : colors.destructive))}
                {!running ? <Btn label={t("maint.diag.share")} icon="share-2" onPress={share} style={{ marginTop: 10 }} /> : null}
              </View>
            ) : null}
          </>
        )}

        {section(
          "alert-triangle",
          t("maint.err.title"),
          errors.length ? t("maint.err.hint") : t("maint.err.none"),
          errors.length ? (
            <>
              {errors.slice(0, 5).map((e) => line(`[${e.source}] ${e.message}`, new Date(e.at).toLocaleTimeString()))}
              <Btn
                label={t("maint.err.clear")}
                icon="x"
                onPress={() => {
                  void clearErrors();
                  setErrors([]);
                }}
                style={{ marginTop: 10 }}
              />
            </>
          ) : null
        )}
      </ScrollView>
    </View>
  );
}
