/**
 * Tâche d'arrière-plan : synchronisation planifiée récurrente et nouvelles
 * tentatives en attente de réseau. Android impose un intervalle minimal de
 * 15 minutes et choisit lui-même le moment exact (économie de batterie).
 *
 * Ce module doit être importé au démarrage (app/_layout.tsx) pour que la
 * tâche soit définie avant que le système ne la déclenche.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";

import { scheduleAction } from "./securityPure";
import { loadContainers } from "./store";
import { runBackgroundSyncs } from "./sync";

export const SYNC_TASK = "gitcrush-background-sync";

try {
  TaskManager.defineTask(SYNC_TASK, async () => {
    try {
      await runBackgroundSyncs();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
} catch (e) {
  console.warn("[Git-Push] définition de la tâche d'arrière-plan impossible", e);
}

/**
 * Intervalle enregistré auprès du système, MÉMORISÉ sur le téléphone (AUDIT-019) :
 * avec une simple variable, il valait null à chaque lancement, la tâche était donc
 * réinscrite et son compte à rebours remis à zéro à chaque ouverture de l'app.
 */
const SCHEDULE_KEY = "@gitcrush_bg_schedule_minutes_v1";
let chain: Promise<void> = Promise.resolve();

async function storedMinutes(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(SCHEDULE_KEY).catch(() => null);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** (Ré)enregistre la tâche selon les réglages des conteneurs, seulement si l'intervalle change. */
export function refreshBackgroundSchedule(): Promise<void> {
  chain = chain.then(applySchedule, applySchedule);
  return chain;
}

async function applySchedule(): Promise<void> {
  try {
    const list = await loadContainers();
    const scheduled = list.filter((c) => c.sync.scheduled);
    const needed = scheduled.length > 0 || list.some((c) => c.pendingRetry && c.sync.retryOnNetwork);
    const wanted = needed ? Math.max(15, Math.min(...(scheduled.length ? scheduled.map((c) => c.sync.intervalMin) : [30]))) : null;
    const registered = await TaskManager.isTaskRegisteredAsync(SYNC_TASK);
    const action = scheduleAction(registered, await storedMinutes(), wanted);
    if (action === "keep") return;
    if (registered) await BackgroundTask.unregisterTaskAsync(SYNC_TASK);
    if (action === "unregister" || wanted === null) {
      await AsyncStorage.removeItem(SCHEDULE_KEY).catch(() => undefined);
      return;
    }
    await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: wanted });
    await AsyncStorage.setItem(SCHEDULE_KEY, String(wanted)).catch(() => undefined);
  } catch (e) {
    console.warn("[Git-Push] planification impossible", e);
  }
}
