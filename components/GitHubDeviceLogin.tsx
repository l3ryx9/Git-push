import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";

import { Btn, Field, MONO } from "@/components/GitUi";
import { useI18n } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { getGitHubClientId, setGitHubClientId } from "@/utils/accounts";
import { githubDevicePoll, githubDeviceStart, type DeviceCode } from "@/utils/oauth";

/**
 * Connexion GitHub OAuth par Device Flow : l'app affiche un code, l'utilisateur
 * le saisit sur github.com/login/device, l'app reçoit le token.
 */
export function GitHubDeviceLogin({
  visible,
  onClose,
  onToken,
}: {
  visible: boolean;
  onClose: () => void;
  onToken: (token: string) => Promise<boolean>;
}) {
  const colors = useColors();
  const { t } = useI18n();
  const [clientId, setClientId] = useState("");
  const [needClient, setNeedClient] = useState(false);
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const cancelled = useRef(false);

  async function start(id: string) {
    setError(null);
    setCode(null);
    cancelled.current = false;
    try {
      const dc = await githubDeviceStart(id);
      setCode(dc);
      WebBrowser.openBrowserAsync(dc.verificationUri).catch(() => undefined);
      const token = await githubDevicePoll(id, dc, () => cancelled.current);
      setFinishing(true);
      const ok = await onToken(token);
      setFinishing(false);
      if (ok) onClose();
      else setError(t("login.tokenInvalid"));
    } catch (e: any) {
      if (cancelled.current) return;
      setFinishing(false);
      setCode(null);
      const map: Record<string, string> = {
        DeviceFlowDisabled: t("f.oauth.deviceDisabled"),
        OAuthDenied: t("f.oauth.denied"),
        OAuthExpired: t("f.oauth.expired"),
      };
      setError(map[e?.code] ?? `${t("f.oauth.failed")} ${e?.message ?? ""}`);
    }
  }

  useEffect(() => {
    if (!visible) {
      cancelled.current = true;
      return;
    }
    (async () => {
      const id = await getGitHubClientId();
      setClientId(id);
      if (!id) setNeedClient(true);
      else {
        setNeedClient(false);
        void start(id);
      }
    })();
    return () => {
      cancelled.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function saveClient() {
    const id = clientId.trim();
    if (!id) return;
    await setGitHubClientId(id);
    setNeedClient(false);
    void start(id);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "center", padding: 22 }}>
        <View style={{ backgroundColor: colors.cardSolid, borderColor: colors.border, borderWidth: 1, borderRadius: colors.radius + 4, padding: 18 }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14 }}>
            <Feather name="github" size={20} color={colors.foreground} />
            <Text style={{ flex: 1, marginLeft: 10, color: colors.foreground, fontSize: 16, fontFamily: "Inter_700Bold" }}>{t("f.oauth.githubTitle")}</Text>
            <Pressable hitSlop={10} onPress={onClose}>
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {needClient ? (
            <>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 17, marginBottom: 12 }}>{t("f.oauth.clientHelp")}</Text>
              <Field label="CLIENT ID" value={clientId} onChangeText={setClientId} placeholder="Ov23li…" />
              <Btn
                label={t("f.oauth.createApp")}
                icon="external-link"
                onPress={() => WebBrowser.openBrowserAsync("https://github.com/settings/applications/new").catch(() => undefined)}
                style={{ marginBottom: 8 }}
              />
              <Btn label={t("f.oauth.continue")} variant="primary" onPress={saveClient} disabled={!clientId.trim()} />
            </>
          ) : code ? (
            <>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 18 }}>{t("f.oauth.enterCode")}</Text>
              <Text selectable style={{ color: colors.accent, fontFamily: MONO, fontSize: 30, letterSpacing: 4, textAlign: "center", marginVertical: 18 }}>
                {code.userCode}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 11, textAlign: "center", marginBottom: 14 }}>{t("f.oauth.copyHint")}</Text>
              <Btn
                label={code.verificationUri.replace(/^https:\/\//, "")}
                icon="external-link"
                variant="primary"
                onPress={() => WebBrowser.openBrowserAsync(code.verificationUri).catch(() => undefined)}
              />
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14 }}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{finishing ? t("f.oauth.finishing") : t("f.oauth.waiting")}</Text>
              </View>
            </>
          ) : !error ? (
            <ActivityIndicator color={colors.accent} style={{ padding: 20 }} />
          ) : null}

          {error ? (
            <>
              <Text style={{ color: colors.destructive, fontSize: 13, marginTop: 12, lineHeight: 18 }}>{error}</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                <Btn label={t("f.oauth.changeClient")} onPress={() => setNeedClient(true)} style={{ flex: 1 }} small />
                <Btn label={t("f.oauth.retry")} variant="primary" onPress={() => void start(clientId)} style={{ flex: 1 }} small />
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
