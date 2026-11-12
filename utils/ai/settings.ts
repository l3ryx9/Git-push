/**
 * Réglages IA : fournisseur (Gemini, OpenAI GPT, Anthropic Claude), clés API,
 * modèles, et interrupteur global qui masque toutes les fonctions IA.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";

import { getSecret, setSecret } from "@/utils/secrets";

export type AiProvider = "gemini" | "openai" | "anthropic";

export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  keys: Record<AiProvider, string>;
  models: Record<AiProvider, string>;
  /** Modèles légers (quota plus large) pour les tâches simples : messages de commit, brouillons. */
  fastModels: Record<AiProvider, string>;
  autoApprove: boolean;
  /**
   * Mode « quota gratuit » : espace les appels, limite le nombre d'étapes de
   * l'agent, réessaie automatiquement après une erreur 429 et allège
   * l'historique envoyé au modèle.
   */
  freeTier: boolean;
}

export const PROVIDERS: { id: AiProvider; label: string; keyUrl: string; models: string[] }[] = [
  {
    id: "gemini",
    label: "Gemini",
    keyUrl: "https://aistudio.google.com/app/apikey",
    models: ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-2.5-pro"],
  },
  {
    id: "openai",
    label: "GPT (OpenAI)",
    keyUrl: "https://platform.openai.com/api-keys",
    models: ["gpt-5.6-sol", "gpt-5.5", "gpt-5.4-mini"],
  },
  {
    id: "anthropic",
    label: "Claude",
    keyUrl: "https://platform.claude.com/settings/keys",
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
  },
];

export const DEFAULT_AI: AiSettings = {
  enabled: true,
  provider: "gemini",
  keys: { gemini: "", openai: "", anthropic: "" },
  models: { gemini: "gemini-3.5-flash", openai: "gpt-5.6-sol", anthropic: "claude-sonnet-5-5" },
  fastModels: { gemini: "gemini-3.1-flash-lite", openai: "gpt-5.4-mini", anthropic: "claude-haiku-5-5" },
  autoApprove: false,
  freeTier: true,
};

const KEY = "@gitcrush_ai_v1";
let memory: AiSettings | null = null;
const listeners = new Set<(s: AiSettings) => void>();

/** Les clés API vont dans le coffre du téléphone, jamais dans les réglages en clair. */
const secKey = (p: AiProvider) => `gitcrush_ai_key_${p}`;
const ALL: AiProvider[] = ["gemini", "openai", "anthropic"];
const secretTimers = new Map<AiProvider, { timer: ReturnType<typeof setTimeout>; write: () => Promise<void> }>();

/** Écrit tout de suite les clés en attente (l'app passe en arrière-plan : rien ne doit se perdre). */
export async function flushAiSecrets(): Promise<void> {
  const pending = [...secretTimers.values()];
  for (const p of pending) {
    clearTimeout(p.timer);
    await p.write().catch(() => undefined);
  }
}

try {
  AppState.addEventListener("change", (state: string) => {
    if (state !== "active") void flushAiSecrets();
  });
} catch {
  /* environnement sans AppState (tests) */
}

function writeJson() {
  if (!memory) return Promise.resolve();
  const { keys: _keys, ...rest } = memory;
  return AsyncStorage.setItem(KEY, JSON.stringify(rest));
}

export async function loadAi(): Promise<AiSettings> {
  if (memory) return memory;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Partial<AiSettings>) : {};
    const keys = { ...DEFAULT_AI.keys };
    let legacy = false;
    for (const prov of ALL) {
      const old = p.keys?.[prov];
      if (old) {
        // Ancienne version : clé en clair dans les réglages → déplacée dans le coffre.
        await setSecret(secKey(prov), old);
        keys[prov] = old;
        legacy = true;
      } else {
        keys[prov] = (await getSecret(secKey(prov))) ?? "";
      }
    }
    memory = {
      ...DEFAULT_AI,
      ...p,
      keys,
      models: { ...DEFAULT_AI.models, ...(p.models ?? {}) },
      fastModels: { ...DEFAULT_AI.fastModels, ...(p.fastModels ?? {}) },
    };
    if (legacy) await writeJson();
  } catch {
    memory = { ...DEFAULT_AI };
  }
  return memory;
}

export async function saveAi(patch: Partial<AiSettings>): Promise<AiSettings> {
  const cur = await loadAi();
  memory = { ...cur, ...patch, keys: { ...cur.keys, ...(patch.keys ?? {}) }, models: { ...cur.models, ...(patch.models ?? {}) }, fastModels: { ...cur.fastModels, ...(patch.fastModels ?? {}) } };
  listeners.forEach((fn) => fn(memory!));
  // Saisie d'une clé : on attend la fin de la frappe avant d'écrire dans le coffre.
  for (const prov of ALL) {
    if (patch.keys && patch.keys[prov] !== undefined && patch.keys[prov] !== cur.keys[prov]) {
      const old = secretTimers.get(prov);
      if (old) clearTimeout(old.timer);
      const value = patch.keys[prov].trim();
      const write = () => {
        secretTimers.delete(prov);
        return setSecret(secKey(prov), value ? value : null);
      };
      secretTimers.set(prov, { timer: setTimeout(() => void write(), 500), write });
    }
  }
  await writeJson();
  return memory;
}

export function subscribeAi(fn: (s: AiSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** IA visible ET configurée (clé présente pour le fournisseur choisi). */
export function aiReady(s: AiSettings | null): boolean {
  return !!s && s.enabled && !!s.keys[s.provider]?.trim();
}

// ─── Compteur d'appels (aide à surveiller le quota quotidien gratuit) ─────────

const USAGE_KEY = "@gitcrush_ai_usage_v1";
let usage: { day: string; count: number } | null = null;

const today = () => new Date().toISOString().slice(0, 10);

async function loadUsage() {
  if (usage && usage.day === today()) return usage;
  try {
    const raw = await AsyncStorage.getItem(USAGE_KEY);
    const p = raw ? (JSON.parse(raw) as { day: string; count: number }) : null;
    usage = p && p.day === today() ? p : { day: today(), count: 0 };
  } catch {
    usage = { day: today(), count: 0 };
  }
  return usage;
}

/** Compte une requête envoyée au fournisseur IA. */
export async function bumpUsage(): Promise<number> {
  const u = await loadUsage();
  u.count += 1;
  AsyncStorage.setItem(USAGE_KEY, JSON.stringify(u)).catch(() => undefined);
  return u.count;
}

/** Nombre de requêtes IA envoyées aujourd'hui (UTC) depuis ce téléphone. */
export async function usageToday(): Promise<number> {
  return (await loadUsage()).count;
}
