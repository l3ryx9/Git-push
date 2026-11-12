/**
 * Conteneurs = dépôts clonés sur le téléphone, chacun avec ses propres
 * réglages (authentification, auteur, modes de synchronisation…).
 * Stockés dans AsyncStorage ; utilisable hors React (tâche d'arrière-plan).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { getAccount, gitCredsFor } from "@/utils/accounts";
import { getGitHubToken, getSecret, setSecret } from "@/utils/secrets";

import type { Author, Creds, GitCtx, MergeState, Progress, SyncSummary } from "./engine";
import { REPOS_PATH } from "./fs";
import { createSerialUpdater, credentialHosts } from "./securityPure";

export type AuthMode = "github" | "account" | "basic" | "none";
export type SyncReason = "manual" | "open" | "close" | "schedule" | "retry" | "intent" | "tile" | "widget" | "watch";

export interface SyncSettings {
  onOpen: boolean;
  onClose: boolean;
  scheduled: boolean;
  intervalMin: number;
  retryOnNetwork: boolean;
  message: string;
}

export interface Container {
  id: string;
  name: string;
  url: string;
  folder: string;
  createdAt: number;
  auth: AuthMode;
  accountId?: string;
  username?: string;
  password?: string;
  author: Author;
  remote: string;
  /** Désactive la vérification SSL pour ce dépôt (serveur à certificat auto-signé). */
  insecureSsl?: boolean;
  sync: SyncSettings;
  branch?: string;
  lastSync?: { at: number; ok: boolean; reason: SyncReason; summary?: SyncSummary; error?: string };
  lastScheduledAt?: number;
  pendingRetry?: boolean;
  merge?: MergeState | null;
  /** Dépôt épinglé sur l'accueil (étoile). */
  favorite?: boolean;
  /** Dernière ouverture de l'écran du dépôt (section « Activité récente »). */
  lastOpenedAt?: number;
}

export const DEFAULT_SYNC: SyncSettings = {
  onOpen: false,
  onClose: false,
  scheduled: false,
  intervalMin: 60,
  retryOnNetwork: true,
  message: "Sync auto {date} {time} — {files} fichier(s)",
};

export const INTERVALS = [15, 30, 60, 180, 360, 720, 1440];

const KEY = "@gitcrush_containers_v1";

/** Les mots de passe ne sont jamais écrits dans la liste des dépôts : ils vont dans le coffre du téléphone. */
const PW = (id: string) => `gitcrush_pw_${id}`;
const savedPw = new Map<string, string | undefined>();

let memory: Container[] | null = null;
let writeChain: Promise<void> = Promise.resolve();
const listeners = new Set<(list: Container[]) => void>();

export function subscribeContainers(fn: (list: Container[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function loadContainers(force = false): Promise<Container[]> {
  if (memory && !force) return memory;
  // Relecture forcée (tâche d'arrière-plan) : on attend d'abord les écritures en cours,
  // sinon une version plus ancienne du stockage remplacerait la mémoire (AUDIT-014).
  if (force) await writeChain;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Container[]) : [];
    let legacy = false;
    memory = await Promise.all(
      parsed.map(async (c) => {
        let password = c.password || undefined;
        if (password) {
          // Ancienne version : mot de passe en clair dans la liste → déplacé dans le coffre.
          await setSecret(PW(c.id), password);
          legacy = true;
        } else {
          password = (await getSecret(PW(c.id))) || undefined;
        }
        savedPw.set(c.id, password);
        return { ...c, password, sync: { ...DEFAULT_SYNC, ...(c.sync ?? {}) }, remote: c.remote || "origin" };
      })
    );
    if (legacy) void persist(memory).catch(() => undefined);
  } catch {
    memory = memory ?? [];
  }
  return memory;
}

function persist(list: Container[]) {
  memory = list;
  listeners.forEach((fn) => fn(list));
  const stripped = list.map(({ password: _pw, ...rest }) => rest);
  const job = writeChain
    .then(async () => {
      await AsyncStorage.setItem(KEY, JSON.stringify(stripped));
      for (const c of list) {
        const pw = c.password || undefined;
        if (savedPw.get(c.id) !== pw) {
          await setSecret(PW(c.id), pw ?? null);
          savedPw.set(c.id, pw);
        }
      }
    });
  // La file continue après un échec, mais l'appelant est prévenu (AUDIT-014) :
  // avant, l'erreur était avalée et l'écran croyait l'enregistrement réussi.
  writeChain = job.catch(() => undefined);
  return job;
}

/**
 * Toutes les modifications de la liste passent par cette file : chacune s'applique
 * à la valeur COURANTE (AUDIT-014). Avant, deux mises à jour simultanées partaient
 * du même tableau et la seconde effaçait la première (ex. état de fusion perdu).
 */
const mutate = createSerialUpdater<Container[]>(
  () => loadContainers(),
  (list) => persist(list)
);

export async function getContainer(id: string): Promise<Container | undefined> {
  return (await loadContainers()).find((c) => c.id === id);
}

export async function addContainer(c: Container) {
  await mutate((list) => [...list, c]);
}

export async function updateContainer(id: string, patch: Partial<Container> | ((c: Container) => Partial<Container>)) {
  await mutate((list) => list.map((c) => (c.id === id ? { ...c, ...(typeof patch === "function" ? patch(c) : patch) } : c)));
}

export async function removeContainer(id: string) {
  await mutate((list) => list.filter((c) => c.id !== id));
  savedPw.delete(id);
  await setSecret(PW(id), null);
}

export function repoDir(c: Pick<Container, "folder">): string {
  return `${REPOS_PATH}/${c.folder}`;
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/(?:[^@/]+@)?([^/:]+)/i.exec(url);
  return m ? m[1].toLowerCase() : "";
}

/**
 * Sépare les identifiants glissés dans une URL (https://user:token@hôte/…) :
 * ils ne doivent jamais être enregistrés en clair avec la liste des dépôts.
 */
export function splitUrlCredentials(raw: string): { url: string; username?: string; password?: string } {
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@(.+)$/i.exec(raw.trim());
  if (!m) return { url: raw.trim() };
  const [user, ...rest] = m[2].split(":");
  const dec = (v: string) => {
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  return { url: m[1] + m[3], username: user ? dec(user) : undefined, password: rest.length ? dec(rest.join(":")) : undefined };
}

/** Hôte du réseau local (LAN, VPN) : seul cas où des identifiants peuvent passer en http:// non chiffré. */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".home.arpa") || h.endsWith(".ts.net")) return true;
  const ip = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
  if (!ip) return false;
  const a = Number(ip[1]);
  const b = Number(ip[2]);
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
}

export function repoNameFromUrl(url: string): string {
  const clean = url.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  return clean.split("/").pop() || "repo";
}

export function defaultAuthFor(url: string): AuthMode {
  return hostOf(url) === "github.com" ? "github" : "basic";
}

export async function credsFor(c: Container): Promise<Creds> {
  if (c.auth === "github") {
    const tok = await getGitHubToken();
    return tok ? { username: "x-access-token", password: tok } : null;
  }
  if (c.auth === "account") {
    const acc = await getAccount(c.accountId);
    return acc ? gitCredsFor(acc) : null;
  }
  if (c.auth === "basic" && c.password) return { username: c.username || "git", password: c.password };
  return null;
}

/** Hôtes autorisés à recevoir les identifiants de ce dépôt (AUDIT-001). */
export async function credHostsFor(c: Container): Promise<string[]> {
  const acc = c.auth === "account" ? await getAccount(c.accountId) : undefined;
  return credentialHosts(c.auth, c.url, acc?.baseUrl);
}

export async function ctxFor(c: Container, onProgress?: (p: Progress) => void): Promise<GitCtx> {
  return {
    dir: repoDir(c),
    creds: await credsFor(c),
    credHosts: await credHostsFor(c),
    author: c.author,
    remote: c.remote || "origin",
    insecure: !!c.insecureSsl,
    onProgress,
  };
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function formatSyncMessage(template: string, files: number, branch: string, reason: SyncReason): string {
  const d = new Date();
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const out = (template || DEFAULT_SYNC.message)
    .split("{date}").join(date)
    .split("{time}").join(time)
    .split("{files}").join(String(files))
    .split("{branch}").join(branch)
    .split("{reason}").join(reason)
    .trim();
  return out || `Sync ${date} ${time}`;
}
