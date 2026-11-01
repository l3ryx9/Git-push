/**
 * Coffre à secrets : tokens GitHub / forges, clés API IA, mots de passe.
 * Stockés dans le coffre du téléphone (Android Keystore / iOS Keychain) via
 * expo-secure-store au lieu d'AsyncStorage (texte en clair). Si le coffre est
 * indisponible (web, appareil défaillant), repli sur AsyncStorage : l'app
 * continue de fonctionner et l'écran « Maintenance » le signale.
 *
 * Les anciennes valeurs en clair sont migrées automatiquement au premier accès.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/** Clés autorisées par SecureStore : lettres, chiffres, « . - _ ». */
const sk = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^_+/, "") || "secret";

// AFTER_FIRST_UNLOCK : lisible par la synchro en arrière-plan, téléphone verrouillé.
const OPTS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

let secure: boolean | null = null;
let degraded = false;
const cache = new Map<string, string | null>();

async function isSecure(): Promise<boolean> {
  if (secure !== null) return secure;
  let ok = false;
  if (Platform.OS !== "web") {
    try {
      ok = await SecureStore.isAvailableAsync();
    } catch {
      ok = false;
    }
  }
  secure = ok;
  return ok;
}

/** État du coffre pour l'écran Maintenance. */
export async function secretsStatus(): Promise<{ secure: boolean; degraded: boolean }> {
  return { secure: await isSecure(), degraded };
}

export async function getSecret(key: string): Promise<string | null> {
  if (cache.has(key)) return cache.get(key) ?? null;
  let value: string | null = null;
  if (await isSecure()) {
    try {
      value = await SecureStore.getItemAsync(sk(key), OPTS);
    } catch {
      degraded = true;
    }
  }
  if (value === null) {
    // Ancienne valeur en clair (ou repli) : on la lit et, si le coffre marche, on la déplace.
    const legacy = await AsyncStorage.getItem(`@${sk(key)}`).catch(() => null);
    if (legacy !== null) {
      value = legacy;
      if (await isSecure()) {
        try {
          await SecureStore.setItemAsync(sk(key), legacy, OPTS);
          await AsyncStorage.removeItem(`@${sk(key)}`);
        } catch {
          degraded = true;
        }
      }
    }
  }
  cache.set(key, value);
  return value;
}

export async function setSecret(key: string, value: string | null): Promise<void> {
  cache.set(key, value);
  if (await isSecure()) {
    try {
      if (value === null || value === "") await SecureStore.deleteItemAsync(sk(key), OPTS);
      else await SecureStore.setItemAsync(sk(key), value, OPTS);
      await AsyncStorage.removeItem(`@${sk(key)}`).catch(() => undefined);
      return;
    } catch {
      degraded = true;
    }
  }
  if (value === null || value === "") await AsyncStorage.removeItem(`@${sk(key)}`).catch(() => undefined);
  else await AsyncStorage.setItem(`@${sk(key)}`, value).catch(() => undefined);
}

// ─── Token GitHub principal ───────────────────────────────────────────────────

export const GITHUB_TOKEN = "gitcrush_token";
export const getGitHubToken = () => getSecret(GITHUB_TOKEN);
export const setGitHubToken = (tok: string | null) => setSecret(GITHUB_TOKEN, tok);
