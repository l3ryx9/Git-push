/**
 * Tâche d'arrière-plan : synchronisation planifiée récurrente et nouvelles
 * tentatives en attente de réseau. Android impose un intervalle minimal de
 * 15 minutes et choisit lui-même le moment exact (économie de batterie).
 *
 * Ce module doit être importé au démarrage (app/_layout.tsx) pour que la
 * tâche soit définie avant que le système ne la déclenche.
 */
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";

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

/** (Ré)enregistre la tâche selon les réglages des conteneurs. */
export async function refreshBackgroundSchedule(): Promise<void> {
  try {
    const list = await loadContainers();
    const scheduled = list.filter((c) => c.sync.scheduled);
    const needed = scheduled.length > 0 || list.some((c) => c.pendingRetry && c.sync.retryOnNetwork);
    const registered = await TaskManager.isTaskRegisteredAsync(SYNC_TASK);
    if (!needed) {
      if (registered) await BackgroundTask.unregisterTaskAsync(SYNC_TASK);
      return;
    }
    const minutes = Math.max(15, Math.min(...(scheduled.length ? scheduled.map((c) => c.sync.intervalMin) : [30])));
    if (registered) await BackgroundTask.unregisterTaskAsync(SYNC_TASK);
    await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: minutes });
  } catch (e) {
    console.warn("[Git-Push] planification impossible", e);
  }
}
