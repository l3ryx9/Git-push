/**
 * Orchestration des synchronisations (sans React) :
 * - une seule opération Git à la fois par dépôt (file d'attente) ;
 * - mémorisation du résultat et de l'état de fusion ;
 * - nouvelle tentative automatique au retour du réseau ;
 * - exécution des synchronisations planifiées (tâche d'arrière-plan).
 */
import { AppState } from "react-native";

import { redactSecrets } from "../ai/pure";
import { logError } from "../errorLog";
import { reportSyncToWidget } from "../native";
import * as engine from "./engine";
import type { MergeOutcome, Progress, SyncSummary } from "./engine";
import {
  ctxFor,
  formatSyncMessage,
  getContainer,
  hostOf,
  loadContainers,
  updateContainer,
  type SyncReason,
} from "./store";

const chains = new Map<string, Promise<unknown>>();

/** Exécute fn après les opérations déjà en cours sur ce dépôt. */
export function runExclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(id) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  chains.set(
    id,
    next.catch(() => undefined)
  );
  return next;
}

export async function syncContainer(id: string, reason: SyncReason, onProgress?: (p: Progress) => void): Promise<SyncSummary> {
  return runExclusive(id, async () => {
    const c = await getContainer(id);
    if (!c) throw engine.codeError("ContainerNotFound");
    if (c.merge) throw engine.codeError("MergePending");
    const ctx = await ctxFor(c, onProgress);
    try {
      const { summary, merge } = await engine.syncRepo(ctx, {
        message: (files, branch) => formatSyncMessage(c.sync.message, files, branch, reason),
      });
      const branch = (await engine.currentBranch(ctx.dir)) ?? c.branch;
      await updateContainer(id, {
        lastSync: { at: Date.now(), ok: !merge, reason, summary },
        pendingRetry: false,
        merge: merge ?? null,
        branch,
      });
      reportSyncToWidget(!merge);
      return summary;
    } catch (e: any) {
      reportSyncToWidget(false);
      const network = engine.isNetworkError(e);
      if (!network) void logError(`sync:${reason}`, e);
      await updateContainer(id, (cur) => ({
        lastSync: { at: Date.now(), ok: false, reason, error: redactSecrets(String(e?.message ?? e)).slice(0, 300) },
        pendingRetry: network && cur.sync.retryOnNetwork ? true : cur.pendingRetry,
      }));
      throw e;
    }
  });
}

/** Pull manuel (fetch + fusion) avec mémorisation d'un éventuel conflit. */
export async function pullContainer(id: string, onProgress?: (p: Progress) => void): Promise<MergeOutcome> {
  return runExclusive(id, async () => {
    const c = await getContainer(id);
    if (!c) throw engine.codeError("ContainerNotFound");
    if (c.merge) throw engine.codeError("MergePending");
    const outcome = await engine.pullRemote(await ctxFor(c, onProgress));
    if (outcome.kind === "conflict") await updateContainer(id, { merge: outcome.merge });
    return outcome;
  });
}

/** Fusionne une autre branche locale (ou distante) dans la branche courante. */
export async function mergeRefIntoContainer(id: string, ref: string, label: string): Promise<MergeOutcome> {
  return runExclusive(id, async () => {
    const c = await getContainer(id);
    if (!c) throw engine.codeError("ContainerNotFound");
    if (c.merge) throw engine.codeError("MergePending");
    const outcome = await engine.mergeInto(await ctxFor(c), ref, label);
    if (outcome.kind === "conflict") await updateContainer(id, { merge: outcome.merge });
    return outcome;
  });
}

// ─── Retour du réseau ─────────────────────────────────────────────────────────

async function isOnline(url: string): Promise<boolean> {
  const host = hostOf(url) || "github.com";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    await fetch(`https://${host}/`, { method: "HEAD", signal: ctrl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let retryRunning = false;

/** Relance les synchronisations échouées faute de réseau, si le réseau est revenu. */
export async function retryPendingSyncs(): Promise<number> {
  if (retryRunning) return 0;
  retryRunning = true;
  let done = 0;
  try {
    const pending = (await loadContainers()).filter((c) => c.pendingRetry && !c.merge);
    for (const c of pending) {
      if (!(await isOnline(c.url))) continue;
      try {
        await syncContainer(c.id, "retry");
        done++;
      } catch {
        /* restera en attente si c'est encore une erreur réseau */
      }
    }
  } finally {
    retryRunning = false;
  }
  return done;
}

let watcher: ReturnType<typeof setInterval> | null = null;

export function startRetryWatcher(intervalMs = 30000) {
  if (watcher) return;
  watcher = setInterval(() => {
    // App en arrière-plan : la tâche système planifiée s'en charge, inutile de réveiller le réseau.
    if (AppState.currentState !== "active") return;
    void retryPendingSyncs();
  }, intervalMs);
}

export function stopRetryWatcher() {
  if (watcher) clearInterval(watcher);
  watcher = null;
}

// ─── Synchronisation planifiée (appelée par la tâche d'arrière-plan) ──────────

export async function runBackgroundSyncs(): Promise<void> {
  const list = await loadContainers(true);
  const now = Date.now();
  for (const c of list) {
    if (c.merge) continue;
    const due = c.sync.scheduled && now - (c.lastScheduledAt ?? 0) >= c.sync.intervalMin * 60000 - 60000;
    if (!due && !c.pendingRetry) continue;
    if (due) await updateContainer(c.id, { lastScheduledAt: now });
    try {
      await syncContainer(c.id, due ? "schedule" : "retry");
    } catch {
      /* résultat mémorisé dans lastSync */
    }
  }
}
