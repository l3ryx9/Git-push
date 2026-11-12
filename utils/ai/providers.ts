/**
 * Client IA unifié pour Gemini, OpenAI (API Responses) et Anthropic Claude
 * (API Messages), avec appel d'outils (function calling).
 *
 * Les tours de l'assistant gardent la réponse brute du fournisseur (`raw`)
 * et la renvoient telle quelle : indispensable pour les signatures de
 * réflexion de Gemini 3 et les éléments de raisonnement d'OpenAI.
 */
import { redactSecrets } from "./pure";
import { bumpUsage, type AiProvider, type AiSettings } from "./settings";

export interface ToolDef {
  name: string;
  description: string;
  /** Schéma JSON simplifié (les tableaux utilisent `items`). */
  parameters: { type: "object"; properties: Record<string, any>; required?: string[] };
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export type AiMsg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; calls: ToolCall[]; raw: any; provider: AiProvider }
  | { role: "tool"; results: { id: string; name: string; output: string }[] };

export interface ChatResult {
  text: string;
  calls: ToolCall[];
  raw: any;
  /** Réponse coupée par la limite de sortie du modèle (appels d'outils écartés). */
  truncated?: boolean;
}

/** Réponse coupée : on ne garde que le texte (un appel d'outil partiel rendrait l'historique invalide). */
function cutOff(text: string): ChatResult {
  return { text, calls: [], raw: [{ type: "text", text: text || "(réponse coupée)" }], truncated: true };
}

type AiErr = Error & { code: string; data: { statusCode: number }; retryAfterMs?: number; daily?: boolean };

function aiError(status: number, message: string): AiErr {
  const e = new Error(message) as AiErr;
  e.code = "AiHttpError";
  e.data = { statusCode: status };
  return e;
}

/** Délai conseillé par le fournisseur après un 429 (en-tête Retry-After ou RetryInfo de Gemini). */
function parseRetryAfter(res: Response, json: any): number | undefined {
  const h = Number(res.headers.get("retry-after"));
  if (h > 0) return h * 1000;
  const details: any[] = json?.error?.details ?? [];
  for (const d of details) {
    const m = /^(\d+(?:\.\d+)?)s$/.exec(String(d?.retryDelay ?? ""));
    if (m) return Math.ceil(Number(m[1]) * 1000);
  }
  return undefined;
}

/** Délai maximum d'une réponse du fournisseur (une génération longue peut prendre plusieurs minutes). */
const REQUEST_TIMEOUT_MS = 240000;

/**
 * fetch avec délai maximum + annulation par l'utilisateur. Sans délai, une
 * connexion mobile qui « décroche » laissait l'agent bloqué indéfiniment.
 */
async function fetchWithTimeout(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  if (signal?.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, REQUEST_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e: any) {
    if (signal?.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    if (timedOut) throw aiError(408, "Délai dépassé : le fournisseur IA n'a pas répondu à temps.");
    // Erreur réseau (connexion coupée, DNS…) : marquée pour une nouvelle tentative.
    const err = aiError(0, `Réseau indisponible (${String(e?.message ?? e).slice(0, 120)})`);
    (err as AiErr & { network?: boolean }).network = true;
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<any> {
  const res = await fetchWithTimeout(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }, signal);
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.message ?? json?.raw?.slice?.(0, 300) ?? `HTTP ${res.status}`;
    const err = aiError(res.status, `HTTP ${res.status} — ${redactSecrets(String(msg))}`);
    if (res.status === 429 || res.status === 529 || res.status === 503) {
      err.retryAfterMs = parseRetryAfter(res, json);
      // Quota JOURNALIER épuisé : inutile de réessayer dans la minute.
      err.daily = /PerDay/i.test(JSON.stringify(json?.error ?? json));
    }
    throw err;
  }
  return json;
}

function safeParse(s: unknown): Record<string, any> {
  if (s && typeof s === "object") return s as Record<string, any>;
  try {
    return JSON.parse(String(s || "{}"));
  } catch {
    return {};
  }
}

// ─── Gemini ───────────────────────────────────────────────────────────────────

async function gemini(s: AiSettings, system: string, msgs: AiMsg[], tools: ToolDef[], signal?: AbortSignal): Promise<ChatResult> {
  const contents = msgs.map((m) => {
    if (m.role === "user") return { role: "user", parts: [{ text: m.text }] };
    if (m.role === "assistant") return { role: "model", parts: m.raw ?? [{ text: m.text }] };
    return {
      role: "user",
      parts: m.results.map((r) => ({ functionResponse: { name: r.name, ...(r.id.startsWith("gem-") ? {} : { id: r.id }), response: { result: r.output } } })),
    };
  });
  const body: Record<string, unknown> = { systemInstruction: { parts: [{ text: system }] }, contents };
  if (tools.length) body.tools = [{ functionDeclarations: tools }];
  const model = encodeURIComponent(s.models.gemini);
  const j = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    { "x-goog-api-key": s.keys.gemini.trim() },
    body,
    signal
  );
  const cand = j.candidates?.[0];
  const cut = cand?.finishReason === "MAX_TOKENS";
  if (cut && !cand?.content?.parts) return { ...cutOff(""), raw: [{ text: "(réponse coupée)" }] };
  if (!cand?.content?.parts) {
    const reason = j.promptFeedback?.blockReason ?? cand?.finishReason ?? "empty response";
    throw aiError(200, `Gemini : ${reason}`);
  }
  const parts: any[] = cand.content.parts;
  const text = parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
  const calls: ToolCall[] = parts
    .filter((p) => p.functionCall)
    .map((p, i) => ({ id: p.functionCall.id ?? `gem-${Date.now()}-${i}`, name: p.functionCall.name, args: safeParse(p.functionCall.args) }));
  if (cut) return { ...cutOff(text), raw: [{ text: text || "(réponse coupée)" }] };
  return { text, calls, raw: parts };
}

// ─── OpenAI (API Responses) ───────────────────────────────────────────────────

async function openai(s: AiSettings, system: string, msgs: AiMsg[], tools: ToolDef[], signal?: AbortSignal): Promise<ChatResult> {
  const input: any[] = [];
  for (const m of msgs) {
    if (m.role === "user") input.push({ role: "user", content: m.text });
    else if (m.role === "assistant") {
      if (Array.isArray(m.raw)) input.push(...m.raw);
      else input.push({ role: "assistant", content: m.text });
    } else {
      for (const r of m.results) input.push({ type: "function_call_output", call_id: r.id, output: r.output });
    }
  }
  const body: Record<string, unknown> = { model: s.models.openai, instructions: system, input };
  if (tools.length) body.tools = tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters }));
  const j = await postJson("https://api.openai.com/v1/responses", { Authorization: `Bearer ${s.keys.openai.trim()}` }, body, signal);
  const output: any[] = j.output ?? [];
  const text = output
    .filter((o) => o.type === "message")
    .flatMap((o) => (o.content ?? []).filter((c: any) => c.type === "output_text").map((c: any) => c.text))
    .join("");
  const calls: ToolCall[] = output
    .filter((o) => o.type === "function_call")
    .map((o) => ({ id: o.call_id, name: o.name, args: safeParse(o.arguments) }));
  if (j.status === "incomplete") return { ...cutOff(text), raw: [{ role: "assistant", content: text || "(réponse coupée)" }] };
  return { text, calls, raw: output };
}

// ─── Anthropic Claude (API Messages) ──────────────────────────────────────────

async function anthropic(s: AiSettings, system: string, msgs: AiMsg[], tools: ToolDef[], signal?: AbortSignal): Promise<ChatResult> {
  const messages: { role: string; content: any }[] = msgs.map((m) => {
    if (m.role === "user") return { role: "user", content: [{ type: "text", text: m.text }] };
    if (m.role === "assistant") return { role: "assistant", content: m.raw ?? [{ type: "text", text: m.text || "…" }] };
    return { role: "user", content: m.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.output })) };
  });
  // Cache de prompt : outils + consignes + historique déjà envoyés sont relus depuis le
  // cache au tour suivant (≈ 10 % du prix, réponse plus rapide). Trois points de cache.
  const CACHE = { type: "ephemeral" };
  const last = messages[messages.length - 1];
  if (last && last.role === "user" && Array.isArray(last.content) && last.content.length) {
    const blocks = [...last.content];
    blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: CACHE };
    messages[messages.length - 1] = { ...last, content: blocks };
  }
  const body: Record<string, unknown> = {
    model: s.models.anthropic,
    max_tokens: 16000,
    system: [{ type: "text", text: system, cache_control: CACHE }],
    messages,
  };
  if (tools.length) {
    body.tools = tools.map((t, i) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
      ...(i === tools.length - 1 ? { cache_control: CACHE } : {}),
    }));
  }
  const j = await postJson(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": s.keys.anthropic.trim(), "anthropic-version": "2023-06-01" },
    body,
    signal
  );
  const content: any[] = j.content ?? [];
  const text = content.filter((c) => c.type === "text").map((c) => c.text).join("");
  const calls: ToolCall[] = content.filter((c) => c.type === "tool_use").map((c) => ({ id: c.id, name: c.name, args: safeParse(c.input) }));
  if (j.stop_reason === "max_tokens") return cutOff(text);
  return { text, calls, raw: content };
}

export interface ChatOptions {
  /** Appelé quand l'appel est retardé (espacement ou attente après un 429), en secondes. */
  onWait?: (seconds: number) => void;
}

/** Écart minimal entre deux requêtes en mode quota gratuit (≈ 12 requêtes / minute). */
const FREE_MIN_GAP_MS = 5000;
let lastCallAt = 0;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
      },
      { once: true }
    );
  });
}

export async function chat(
  s: AiSettings,
  system: string,
  msgs: AiMsg[],
  tools: ToolDef[] = [],
  signal?: AbortSignal,
  opts: ChatOptions = {}
): Promise<ChatResult> {
  if (!s.keys[s.provider]?.trim()) throw aiError(401, "API key missing");
  const send = () =>
    s.provider === "gemini" ? gemini(s, system, msgs, tools, signal) : s.provider === "openai" ? openai(s, system, msgs, tools, signal) : anthropic(s, system, msgs, tools, signal);

  for (let attempt = 0; ; attempt++) {
    if (s.freeTier) {
      const gap = lastCallAt + FREE_MIN_GAP_MS - Date.now();
      if (gap > 0) {
        opts.onWait?.(Math.ceil(gap / 1000));
        await sleep(gap, signal);
      }
    }
    lastCallAt = Date.now();
    void bumpUsage();
    try {
      return await send();
    } catch (e: any) {
      if (e?.name === "AbortError") throw e;
      const status = Number(e?.data?.statusCode);
      // 429 / 529 (surcharge) / 5xx passagers et coupures réseau : on réessaie.
      // Un délai dépassé (408) n'est PAS relancé : la génération a pu consommer du quota.
      const transient = status === 429 || status === 529 || status === 500 || status === 502 || status === 503 || status === 504 || !!e?.network;
      const maxAttempts = e?.network ? 2 : 3;
      if (!transient || e?.daily || attempt >= maxAttempts) throw e;
      const base = e?.network ? 2500 * (attempt + 1) : 8000 * (attempt + 1);
      const wait = Math.min(65000, e?.retryAfterMs ?? base) + 500;
      opts.onWait?.(Math.ceil(wait / 1000));
      await sleep(wait, signal);
    }
  }
}

/** Requêtes identiques en cours (double appui sur ✦) : partagées au lieu d'être renvoyées. */
const inflight = new Map<string, Promise<string>>();

/** Génération de texte simple (sans outils). */
export async function complete(s: AiSettings, system: string, prompt: string, signal?: AbortSignal, fast = false): Promise<string> {
  // Tâche simple : modèle léger (quota gratuit plus large) s'il est défini.
  const eff: AiSettings = fast && s.fastModels?.[s.provider]?.trim() ? { ...s, models: { ...s.models, [s.provider]: s.fastModels[s.provider].trim() } } : s;
  const key = `${eff.provider}|${eff.models[eff.provider]}|${system}|${prompt}`;
  const pending = !signal ? inflight.get(key) : undefined;
  if (pending) return pending;
  const p = chat(eff, system, [{ role: "user", text: prompt }], [], signal).then((r) => r.text.trim());
  if (!signal) {
    inflight.set(key, p);
    p.finally(() => inflight.delete(key)).catch(() => undefined);
  }
  return p;
}

export function aiErrorText(e: any, t: (k: string, v?: Record<string, string | number>) => string): string {
  const s = Number(e?.data?.statusCode);
  if (e?.name === "AbortError") return t("ai.err.aborted");
  if (s === 401 || s === 403) return `${t("ai.err.key")}\n${e?.message ?? ""}`;
  if (s === 404) return `${t("ai.err.model")}\n${e?.message ?? ""}`;
  if (s === 429) return `${t(e?.daily ? "ai.err.daily" : "ai.err.quota")}\n${e?.message ?? ""}`;
  if (s === 408) return `${t("ai.err.timeout")}\n${e?.message ?? ""}`;
  if (e?.network) return `${t("ai.err.network")}\n${e?.message ?? ""}`;
  if (s === 529 || s === 503) return `${t("ai.err.overloaded")}\n${e?.message ?? ""}`;
  return redactSecrets(String(e?.message ?? e));
}
