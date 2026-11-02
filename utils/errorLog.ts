/**
 * Journal des erreurs récentes (20 dernières), consultable et partageable depuis
 * l'écran Maintenance : plus besoin de décrire un plantage de mémoire.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@gitcrush_error_log_v1";
const MAX = 20;

export interface ErrorEntry {
  at: number;
  source: string;
  message: string;
  stack?: string;
}

let queue: Promise<void> = Promise.resolve();

export function logError(source: string, e: unknown): Promise<void> {
  const err = e as { message?: string; stack?: string } | undefined;
  const entry: ErrorEntry = {
    at: Date.now(),
    source,
    message: String(err?.message ?? e).slice(0, 300),
    stack: err?.stack ? String(err.stack).slice(0, 600) : undefined,
  };
  queue = queue
    .then(async () => {
      const list = await readErrors();
      await AsyncStorage.setItem(KEY, JSON.stringify([entry, ...list].slice(0, MAX)));
    })
    .catch(() => undefined);
  return queue;
}

export async function readErrors(): Promise<ErrorEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ErrorEntry[]) : [];
  } catch {
    return [];
  }
}

export async function clearErrors(): Promise<void> {
  await AsyncStorage.removeItem(KEY).catch(() => undefined);
}

/** À appeler une fois au démarrage : enregistre aussi les erreurs JavaScript non interceptées. */
export function installGlobalErrorLogging() {
  const EU = (globalThis as any).ErrorUtils;
  if (!EU?.setGlobalHandler) return;
  const prev = EU.getGlobalHandler?.();
  EU.setGlobalHandler((err: unknown, fatal?: boolean) => {
    void logError(fatal ? "fatal" : "js", err);
    prev?.(err, fatal);
  });
}
