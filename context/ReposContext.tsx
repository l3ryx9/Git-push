import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { useGitHub } from "@/context/GitHubContext";
import { refreshBackgroundSchedule } from "@/utils/git/background";
import * as engine from "@/utils/git/engine";
import type { GitCtx, Progress, SyncSummary } from "@/utils/git/engine";
import { makeDir, removePath } from "@/utils/git/fs";
import {
  addContainer,
  ctxFor,
  DEFAULT_SYNC,
  loadContainers,
  newId,
  removeContainer,
  repoDir,
  repoNameFromUrl,
  splitUrlCredentials,
  subscribeContainers,
  updateContainer,
  type AuthMode,
  type Container,
  type SyncReason,
} from "@/utils/git/store";
import { retryPendingSyncs, runExclusive, startRetryWatcher, stopRetryWatcher, syncContainer } from "@/utils/git/sync";

export interface CloneParams {
  url: string;
  name?: string;
  branch?: string;
  depth?: number;
  singleBranch?: boolean;
  insecureSsl?: boolean;
  auth: AuthMode;
  accountId?: string;
  username?: string;
  password?: string;
}

interface ReposContextType {
  containers: Container[];
  ready: boolean;
  busy: Record<string, string | undefined>;
  progress: Record<string, Progress | undefined>;
  get: (id: string) => Container | undefined;
  findByUrl: (url: string) => Container | undefined;
  clone: (p: CloneParams, onProgress?: (p: Progress) => void) => Promise<Container>;
  remove: (id: string) => Promise<void>;
  update: (id: string, patch: Partial<Container>) => Promise<void>;
  /** Opération Git exclusive avec indicateur « occupé » et progression. */
  run: <T>(id: string, label: string, fn: (ctx: GitCtx, c: Container) => Promise<T>) => Promise<T>;
  /** Lecture exclusive sans indicateur visible (statut, historique…). */
  read: <T>(id: string, fn: (ctx: GitCtx, c: Container) => Promise<T>) => Promise<T>;
  sync: (id: string, reason?: SyncReason) => Promise<SyncSummary>;
  /** Affiche l'indicateur « occupé » pendant fn (fn gère lui-même le verrou). */
  withBusy: <T>(id: string, label: string, fn: (onProgress: (p: Progress) => void) => Promise<T>) => Promise<T>;
}

const ReposContext = createContext<ReposContextType | null>(null);

function normUrl(u: string) {
  return u.trim().toLowerCase().replace(/\/+$/, "").replace(/\.git$/, "");
}

export function ReposProvider({ children }: { children: React.ReactNode }) {
  const { user } = useGitHub();
  const [containers, setContainers] = useState<Container[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<Record<string, string | undefined>>({});
  const [progress, setProgress] = useState<Record<string, Progress | undefined>>({});
  const openedOnce = useRef(false);
  /** Dépôts en cours de synchronisation : évite d'empiler la même synchro (ouverture répétée de l'app). */
  const inflight = useRef(new Set<string>());
  /** Progression : au plus ~8 mises à jour par seconde (chaque mise à jour redessine les écrans abonnés). */
  const progressTimers = useRef(new Map<string, { last: number; pending?: Progress; timer?: ReturnType<typeof setTimeout> }>());

  useEffect(() => {
    const unsub = subscribeContainers((list) => setContainers([...list]));
    loadContainers(true).then((list) => {
      setContainers([...list]);
      setReady(true);
      void refreshBackgroundSchedule();
    });
    return () => {
      unsub();
    };
  }, []);

  // Synchronisation à l'ouverture / à la fermeture de l'application,
  // et nouvelle tentative automatique au retour du réseau.
  useEffect(() => {
    startRetryWatcher();
    const syncFlag = async (flag: "onOpen" | "onClose", reason: SyncReason) => {
      const list = await loadContainers();
      const now = Date.now();
      for (const c of list.filter((x) => x.sync[flag] && !x.merge)) {
        if (inflight.current.has(c.id)) continue;
        // Retour rapide dans l'app (moins d'une minute après une synchro réussie) : rien à refaire.
        if (flag === "onOpen" && c.lastSync?.ok && now - c.lastSync.at < 60000) continue;
        void syncWithUi(c.id, reason).catch(() => undefined);
      }
    };
    if (!openedOnce.current) {
      openedOnce.current = true;
      void syncFlag("onOpen", "open");
    }
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void syncFlag("onOpen", "open");
        void retryPendingSyncs();
      } else if (state === "background") {
        void syncFlag("onClose", "close");
      }
    });
    return () => {
      sub.remove();
      stopRetryWatcher();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setBusyFor(id: string, label: string | undefined) {
    setBusy((b) => (b[id] === label ? b : { ...b, [id]: label }));
    if (!label) {
      const pt = progressTimers.current.get(id);
      if (pt?.timer) clearTimeout(pt.timer);
      progressTimers.current.delete(id);
      setProgress((p) => (p[id] === undefined ? p : { ...p, [id]: undefined }));
    }
  }

  function progressFor(id: string) {
    return (p: Progress) => {
      const map = progressTimers.current;
      const st = map.get(id) ?? { last: 0 };
      map.set(id, st);
      const now = Date.now();
      const prev = st.pending;
      const phaseChanged = !prev || prev.phase !== p.phase;
      if (phaseChanged || now - st.last >= 120) {
        if (st.timer) clearTimeout(st.timer);
        st.timer = undefined;
        st.pending = p;
        st.last = now;
        setProgress((cur) => ({ ...cur, [id]: p }));
        return;
      }
      st.pending = p;
      if (!st.timer) {
        st.timer = setTimeout(() => {
          st.timer = undefined;
          st.last = Date.now();
          const latest = st.pending;
          if (latest && map.get(id) === st) setProgress((cur) => ({ ...cur, [id]: latest }));
        }, 120);
      }
    };
  }

  async function syncWithUi(id: string, reason: SyncReason): Promise<SyncSummary> {
    inflight.current.add(id);
    setBusyFor(id, "sync");
    try {
      const res = await syncContainer(id, reason, progressFor(id));
      void refreshBackgroundSchedule();
      return res;
    } catch (e) {
      void refreshBackgroundSchedule();
      throw e;
    } finally {
      inflight.current.delete(id);
      setBusyFor(id, undefined);
    }
  }

  function defaultAuthor() {
    const name = user?.name || user?.login || "Git-Push";
    const email = user?.email || (user?.login ? `${user.login}@users.noreply.github.com` : "gitcrush@localhost");
    return { name, email };
  }

  async function clone(p: CloneParams, onProgress?: (p: Progress) => void): Promise<Container> {
    const id = newId();
    // https://user:token@hôte/… : les identifiants vont dans le coffre, jamais dans l'URL
    // (sinon ils finiraient en clair dans .git/config et dans la liste des dépôts).
    const parts = splitUrlCredentials(p.url);
    const inUrl = !!parts.password;
    const auth: AuthMode = inUrl ? "basic" : p.auth;
    const c: Container = {
      id,
      name: (p.name || repoNameFromUrl(parts.url)).trim(),
      url: parts.url,
      folder: id,
      createdAt: Date.now(),
      auth,
      accountId: auth === "account" ? p.accountId : undefined,
      username: (inUrl ? parts.username : p.username)?.trim() || undefined,
      password: (inUrl ? parts.password : p.password) || undefined,
      author: defaultAuthor(),
      remote: "origin",
      insecureSsl: p.insecureSsl || undefined,
      sync: { ...DEFAULT_SYNC },
      merge: null,
    };
    const dir = repoDir(c);
    setBusyFor(id, "clone");
    try {
      await makeDir(dir);
      const ctx = await ctxFor(c, (pr) => {
        progressFor(id)(pr);
        onProgress?.(pr);
      });
      await engine.cloneRepo(ctx, c.url, { ref: p.branch?.trim() || undefined, depth: p.depth, singleBranch: p.singleBranch });
      c.branch = (await engine.currentBranch(dir)) ?? undefined;
      await addContainer(c);
      return c;
    } catch (e) {
      engine.dropCache(dir);
      await removePath(dir).catch(() => undefined);
      throw e;
    } finally {
      setBusyFor(id, undefined);
    }
  }

  async function remove(id: string) {
    const c = containers.find((x) => x.id === id);
    await removeContainer(id);
    if (c) {
      const dir = repoDir(c);
      engine.dropCache(dir);
      await removePath(dir).catch(() => undefined);
    }
    void refreshBackgroundSchedule();
  }

  async function update(id: string, patch: Partial<Container>) {
    await updateContainer(id, patch);
    if (patch.sync) void refreshBackgroundSchedule();
  }

  async function run<T>(id: string, label: string, fn: (ctx: GitCtx, c: Container) => Promise<T>): Promise<T> {
    setBusyFor(id, label);
    try {
      return await runExclusive(id, async () => {
        const c = (await loadContainers()).find((x) => x.id === id);
        if (!c) throw engine.codeError("ContainerNotFound");
        const res = await fn(await ctxFor(c, progressFor(id)), c);
        const branch = await engine.currentBranch(repoDir(c));
        if (branch && branch !== c.branch) await updateContainer(id, { branch });
        return res;
      });
    } finally {
      setBusyFor(id, undefined);
    }
  }

  async function withBusy<T>(id: string, label: string, fn: (onProgress: (p: Progress) => void) => Promise<T>): Promise<T> {
    setBusyFor(id, label);
    try {
      return await fn(progressFor(id));
    } finally {
      setBusyFor(id, undefined);
    }
  }

  async function read<T>(id: string, fn: (ctx: GitCtx, c: Container) => Promise<T>): Promise<T> {
    return runExclusive(id, async () => {
      const c = (await loadContainers()).find((x) => x.id === id);
      if (!c) throw engine.codeError("ContainerNotFound");
      return fn(await ctxFor(c), c);
    });
  }

  return (
    <ReposContext.Provider
      value={{
        containers,
        ready,
        busy,
        progress,
        get: (id) => containers.find((c) => c.id === id),
        findByUrl: (url) => containers.find((c) => normUrl(c.url) === normUrl(url)),
        clone,
        remove,
        update,
        run,
        read,
        sync: (id: string, reason: SyncReason = "manual") => syncWithUi(id, reason),
        withBusy,
      }}
    >
      {children}
    </ReposContext.Provider>
  );
}

export function useRepos() {
  const ctx = useContext(ReposContext);
  if (!ctx) throw new Error("useRepos must be inside ReposProvider");
  return ctx;
}
