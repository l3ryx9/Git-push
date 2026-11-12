import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Text } from "react-native";

import { Field, Segmented } from "@/components/GitUi";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { hostOfUrl, loadAccounts, subscribeAccounts, type Account } from "@/utils/accounts";
import type { AuthMode } from "@/utils/git/store";

export function useAccounts(): Account[] {
  const [list, setList] = useState<Account[]>([]);
  useEffect(() => {
    loadAccounts().then((l) => setList([...l]));
    return subscribeAccounts((l) => setList([...l]));
  }, []);
  return list;
}

/** Mode d'authentification conseillé pour une URL. */
export function suggestAuth(url: string, accounts: Account[]): { auth: AuthMode; accountId?: string } {
  const host = hostOfUrl(url);
  if (host === "github.com") return { auth: "github" };
  const acc = accounts.find((a) => hostOfUrl(a.baseUrl) === host);
  if (acc) return { auth: "account", accountId: acc.id };
  return { auth: "basic" };
}

export function AuthPicker({
  auth,
  accountId,
  username,
  password,
  onChange,
}: {
  auth: AuthMode;
  accountId?: string;
  username: string;
  password: string;
  onChange: (p: { auth?: AuthMode; accountId?: string; username?: string; password?: string }) => void;
}) {
  const colors = useColors();
  const { t } = useI18n();
  const accounts = useAccounts();

  return (
    <>
      <Segmented
        value={auth}
        onChange={(v) => onChange({ auth: v, accountId: v === "account" ? accountId ?? accounts[0]?.id : accountId })}
        options={[
          { value: "github", label: t("g.auth.github") },
          { value: "account", label: t("f.auth.account") },
          { value: "basic", label: t("g.auth.basic") },
          { value: "none", label: t("g.auth.none") },
        ]}
      />
      {auth === "account" ? (
        accounts.length ? (
          <Segmented
            value={accountId ?? ""}
            onChange={(v) => onChange({ accountId: v })}
            options={accounts.map((a) => ({ value: a.id, label: `${a.username} · ${hostOfUrl(a.baseUrl)}` }))}
          />
        ) : (
          <Text style={{ color: colors.accent, fontSize: 12, marginBottom: 12 }} onPress={() => router.push("/accounts" as any)}>
            {t("f.auth.noAccount")} ›
          </Text>
        )
      ) : null}
      {auth === "basic" ? (
        <>
          <Field label={t("g.auth.username")} value={username} onChangeText={(v) => onChange({ username: v })} placeholder="oauth2 / git / pseudo" />
          <Field label={t("g.auth.password")} value={password} onChangeText={(v) => onChange({ password: v })} secure hint={t("g.auth.basicHint")} />
        </>
      ) : null}
      {auth === "github" ? <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 12 }}>{t("g.auth.githubHint")}</Text> : null}
    </>
  );
}
