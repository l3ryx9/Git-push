/**
 * Sessions de l'agent IA, une par dépôt : historique envoyé au modèle,
 * éléments affichés, lots d'annulation. Sauvegardées sur le téléphone
 * (une clé AsyncStorage par dépôt) pour survivre à la fermeture de l'app.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { compact, type Preview, type UndoEntry } from "./agent";
import type { AiMsg, ToolCall } from "./providers";

export type UiItem =
  | { key: string; kind: "user"; text: string }
  | { key: string; kind: "assistant"; text: string }
  | { key: string; kind: "tool"; call: ToolCall; status: "running" | "done" | "refused" | "error"; output?: string }
  | { key: string; kind: "approval"; call: ToolCall; preview: Preview; answer?: boolean }
  | { key: string; kind: "error"; text: string };

export type Session = {
  history: AiMsg[];
  items: UiItem[];
  mode: "chat" | "agent";
  provider?: string;
  repoId?: string;
  /** Lots d'annulation (un par demande ayant modifié le dépôt). Gardés en mémoire seulement. */
  undo: UndoEntry[][];
  /** Note à transmettre au modèle avec le prochain message (ex. modifications annulées). */
  note?: string;
};

export const sessions = new Map<string, Session>();

const PREFIX = "@gitcrush_ai_session_";
const MAX_JSON = 350000;
const MAX_ITEMS = 80;

let loaded = false;
let loading: Promise<void> | null = null;

export const sessionsReady = () => loaded;

export function newSession(): Session {
  return { history: [], items: [], mode: "agent", undo: [] };
}

/** Met à jour (ou crée) la session d'un dépôt sans perdre ses autres champs. */
export function upsertSession(id: string, patch: Partial<Session>): Session {
  const cur = sessions.get(id) ?? newSession();
  const next = { ...cur, ...patch };
  sessions.set(id, next);
  return next;
}

export function ensureSessionsLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!loading) {
    loading = (async () => {
      try {
        const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
        const pairs = await AsyncStorage.multiGet(keys);
        for (const [key, raw] of pairs) {
          if (!raw || !key) continue;
          try {
            const p = JSON.parse(raw) as Partial<Session>;
            const items = (p.items ?? []).map((it): UiItem => {
              if (it.kind === "approval" && it.answer === undefined) return { ...it, answer: false };
              if (it.kind === "tool" && it.status === "running") return { ...it, status: "error", output: "Interrompu" };
              return it;
            });
            sessions.set(key.slice(PREFIX.length), { history: p.history ?? [], items, mode: p.mode ?? "agent", provider: p.provider, repoId: p.repoId, undo: [] });
          } catch {
            /* session corrompue : ignorée */
          }
        }
      } catch {
        /* stockage indisponible : sessions en mémoire seulement */
      }
      loaded = true;
    })();
  }
  return loading;
}

/** Version allégée d'un élément d'affichage (sans diffs ni gros résultats). */
function slim(it: UiItem): UiItem {
  if (it.kind === "approval") return { ...it, preview: { title: it.preview.title, path: it.preview.path, detail: it.preview.detail?.slice(0, 300) } };
  if (it.kind === "tool") return { ...it, output: it.output?.slice(0, 300) };
  return it;
}

function pack(s: Session): string {
  let history = compact(s.history, 2);
  const body = () => JSON.stringify({ mode: s.mode, provider: s.provider, repoId: s.repoId, items: s.items.slice(-MAX_ITEMS).map(slim), history });
  let json = body();
  // Trop gros : on retire les plus anciennes demandes (on repart toujours d'un message utilisateur).
  while (json.length > MAX_JSON) {
    const next = history.findIndex((m, i) => i > 0 && m.role === "user");
    if (next < 0) break;
    history = history.slice(next);
    json = body();
  }
  return json;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Enregistre la session (différé de 400 ms pour regrouper les mises à jour). */
export function saveSession(id: string) {
  const old = timers.get(id);
  if (old) clearTimeout(old);
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      const s = sessions.get(id);
      if (!s) return;
      AsyncStorage.setItem(PREFIX + id, pack(s)).catch(() => undefined);
    }, 400)
  );
}

export function dropSession(id: string) {
  const old = timers.get(id);
  if (old) clearTimeout(old);
  timers.delete(id);
  sessions.delete(id);
  AsyncStorage.removeItem(PREFIX + id).catch(() => undefined);
}
