/**
 * Comptes de forges autres que le compte GitHub principal (GitLab, Gitea /
 * Forgejo), connectés par OAuth (PKCE) ou par token. Utilisable hors React.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { GITHUB_OAUTH_CLIENT_ID } from "@/constants/oauth";

import { createSerialUpdater, createSingleFlight } from "./git/securityPure";
import { refreshOAuth } from "./oauth";
import { getSecret, setSecret } from "./secrets";

export type ForgeKind = "gitlab" | "gitea";

export interface Account {
  id: string;
  kind: ForgeKind;
  baseUrl: string; // ex : https://gitlab.com
  username: string;
  name?: string;
  avatar?: string;
  method: "oauth" | "token";
  token: string;
  refreshToken?: string;
  expiresAt?: number; // ms
  clientId?: string;
  createdAt: number;
}

const KEY = "@gitcrush_accounts_v1";
const CLIENTS_KEY = "@gitcrush_oauth_clients_v1";

let memory: Account[] | null = null;
const listeners = new Set<(l: Account[]) => void>();

export function subscribeAccounts(fn: (l: Account[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Jeton et jeton de rafraîchissement : dans le coffre du téléphone, jamais dans la liste des comptes. */
const SEC = (id: string) => `gitcrush_acc_${id}`;
type AccSecret = { token: string; refreshToken?: string };

async function saveSecrets(a: Account) {
  const s: AccSecret = { token: a.token, refreshToken: a.refreshToken };
  await setSecret(SEC(a.id), JSON.stringify(s));
}

export async function loadAccounts(force = false): Promise<Account[]> {
  if (memory && !force) return memory;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const stored = raw ? (JSON.parse(raw) as Account[]) : [];
    let legacy = false;
    memory = await Promise.all(
      stored.map(async (a) => {
        if (a.token) {
          // Ancienne version : jeton en clair → déplacé dans le coffre.
          await saveSecrets(a);
          legacy = true;
          return a;
        }
        try {
          const sec = JSON.parse((await getSecret(SEC(a.id))) ?? "{}") as Partial<AccSecret>;
          return { ...a, token: sec.token ?? "", refreshToken: sec.refreshToken ?? a.refreshToken };
        } catch {
          return a;
        }
      })
    );
    if (legacy) await persist(memory);
  } catch {
    memory = memory ?? [];
  }
  return memory;
}

async function persist(list: Account[]) {
  memory = list;
  listeners.forEach((fn) => fn(list));
  for (const a of list) if (a.token) await saveSecrets(a);
  const stripped = list.map((a) => ({ ...a, token: "", refreshToken: undefined }));
  await AsyncStorage.setItem(KEY, JSON.stringify(stripped));
}

/** Modifications appliquées l'une après l'autre sur la liste courante (AUDIT-014). */
const mutateAccounts = createSerialUpdater<Account[]>(
  () => loadAccounts(),
  (list) => persist(list)
);

export async function saveAccount(a: Account) {
  await mutateAccounts((list) => (list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? a : x)) : [...list, a]));
}

export async function removeAccount(id: string) {
  await mutateAccounts((list) => list.filter((a) => a.id !== id));
  await setSecret(SEC(id), null);
}

export async function getAccount(id?: string): Promise<Account | undefined> {
  if (!id) return undefined;
  return (await loadAccounts()).find((a) => a.id === id);
}

export function normBase(url: string): string {
  const u = url.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

export function hostOfUrl(url: string): string {
  const m = /^[a-z]+:\/\/(?:[^@/]+@)?([^/:]+)/i.exec(url);
  return m ? m[1].toLowerCase() : "";
}

export async function findAccountForUrl(url: string): Promise<Account | undefined> {
  const host = hostOfUrl(url);
  return (await loadAccounts()).find((a) => hostOfUrl(a.baseUrl) === host);
}

// ─── Identifiants OAuth (Client ID des applications enregistrées) ─────────────

type Clients = { github?: string; byBase?: Record<string, string> };

async function loadClients(): Promise<Clients> {
  try {
    const raw = await AsyncStorage.getItem(CLIENTS_KEY);
    return raw ? (JSON.parse(raw) as Clients) : {};
  } catch {
    return {};
  }
}

export async function getGitHubClientId(): Promise<string> {
  return (await loadClients()).github || GITHUB_OAUTH_CLIENT_ID || "";
}

export async function setGitHubClientId(id: string) {
  const c = await loadClients();
  await AsyncStorage.setItem(CLIENTS_KEY, JSON.stringify({ ...c, github: id.trim() }));
}

export async function getClientIdFor(baseUrl: string): Promise<string> {
  return (await loadClients()).byBase?.[normBase(baseUrl)] ?? "";
}

export async function setClientIdFor(baseUrl: string, id: string) {
  const c = await loadClients();
  await AsyncStorage.setItem(CLIENTS_KEY, JSON.stringify({ ...c, byBase: { ...(c.byBase ?? {}), [normBase(baseUrl)]: id.trim() } }));
}

// ─── Token d'accès (avec rafraîchissement OAuth automatique) ──────────────────

/**
 * Un rafraîchissement en vol PAR compte (AUDIT-002). L'ancienne variable unique
 * renvoyait le token du compte A à un appel concernant le compte B.
 */
const refreshOnce = createSingleFlight<string>();

export async function accessToken(a: Account): Promise<string> {
  if (a.method !== "oauth" || !a.refreshToken || !a.expiresAt || a.expiresAt - Date.now() > 120000) return a.token;
  return refreshOnce(a.id, async () => {
    try {
      const r = await refreshOAuth(a);
      const next: Account = {
        ...a,
        token: r.token,
        refreshToken: r.refreshToken ?? a.refreshToken,
        expiresAt: r.expiresIn ? Date.now() + r.expiresIn * 1000 : undefined,
      };
      await saveAccount(next);
      return next.token;
    } catch {
      return a.token; // on tente quand même avec l'ancien
    }
  });
}

/** Identifiants HTTPS Git à partir d'un compte. */
export async function gitCredsFor(a: Account): Promise<{ username: string; password: string }> {
  const token = await accessToken(a);
  return a.kind === "gitlab" ? { username: "oauth2", password: token } : { username: a.username, password: token };
}
