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
    if (legacy) void persist(memory);
  } catch {
    memory = memory ?? [];
  }
  return memory;
}

function persist(list: Container[]) {
  memory = list;
  listeners.forEach((fn) => fn(list));
  const stripped = list.map(({ password: _pw, ...rest }) => rest);
  writeChain = writeChain
    .then(async () => {
      await AsyncStorage.setItem(KEY, JSON.stringify(stripped));
      for (const c of list) {
        const pw = c.password || undefined;
        if (savedPw.get(c.id) !== pw) {
          await setSecret(PW(c.id), pw ?? null);
          savedPw.set(c.id, pw);
        }
      }
    })
    .catch(() => {
      /* nouvelle tentative au prochain enregistrement */
    });
  return writeChain;
}

export async function getContainer(id: string): Promise<Container | undefined> {
  return (await loadContainers()).find((c) => c.id === id);
}

export async function addContainer(c: Container) {
  const list = await loadContainers();
  await persist([...list, c]);
}

export async function updateContainer(id: string, patch: Partial<Container> | ((c: Container) => Partial<Container>)) {
  const list = await loadContainers();
  await persist(list.map((c) => (c.id === id ? { ...c, ...(typeof patch === "function" ? patch(c) : patch) } : c)));
}

export async function removeContainer(id: string) {
  const list = await loadContainers();
  savedPw.delete(id);
  await setSecret(PW(id), null);
  await persist(list.filter((c) => c.id !== id));
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

export async function ctxFor(c: Container, onProgress?: (p: Progress) => void): Promise<GitCtx> {
  return {
    dir: repoDir(c),
    creds: await credsFor(c),
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
