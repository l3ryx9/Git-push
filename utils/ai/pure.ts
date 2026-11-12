/**
 * Logique pure (sans React Native ni accès disque) : édition tolérante de fichiers,
 * résumé d'arborescence, signature d'erreur, modèles de workflows…
 * Isolée ici pour être testée directement par Node (`npm test`).
 */

/** Indentation (espaces / tabulations) en début de ligne. */
function indentOf(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? "";
}

export type Located = { start: number; end: number; reindent?: { from: string; to: string } };

/**
 * Position unique de `needle` dans `text`, par tolérance croissante :
 * 1. texte exact ;
 * 2. espaces de fin de ligne et CRLF ignorés ;
 * 3. indentation ignorée (le modèle s'est trompé de niveau) : `reindent` indique
 *    comment décaler le texte de remplacement pour garder l'indentation du fichier.
 */
export function locate(text: string, needle: string): Located | "none" | "many" {
  const exact = text.split(needle).length - 1;
  if (exact === 1) {
    const start = text.indexOf(needle);
    return { start, end: start + needle.length };
  }
  if (exact > 1) return "many";
  const hay = text.split("\n");
  const want = needle.replace(/\r\n/g, "\n").split("\n");
  while (want.length && want[want.length - 1].trim() === "") want.pop();
  while (want.length && want[0].trim() === "") want.shift();
  if (!want.length) return "none";
  const span = (i: number) => {
    const before = hay.slice(0, i).join("\n");
    const start = i === 0 ? 0 : before.length + 1;
    return { start, end: start + hay.slice(i, i + want.length).join("\n").length };
  };
  const find = (norm: (l: string) => string) => {
    const w = want.map(norm);
    const hits: number[] = [];
    for (let i = 0; i + w.length <= hay.length; i++) {
      if (w.every((x, j) => norm(hay[i + j]) === x)) hits.push(i);
    }
    return hits;
  };
  const trailing = find((l) => l.replace(/\s+$/, ""));
  if (trailing.length === 1) return span(trailing[0]);
  if (trailing.length > 1) return "many";
  const loose = find((l) => l.trim());
  if (loose.length > 1) return "many";
  if (loose.length === 0) return "none";
  const i = loose[0];
  const firstIdx = want.findIndex((l) => l.trim() !== "");
  const from = indentOf(want[firstIdx]);
  const to = indentOf(hay[i + firstIdx]);
  return from === to ? span(i) : { ...span(i), reindent: { from, to } };
}

/** Décale l'indentation d'un bloc : préfixe `from` remplacé par `to` sur chaque ligne. */
export function reindentBlock(block: string, from: string, to: string): string {
  return block
    .split("\n")
    .map((l) => {
      if (l.trim() === "") return l;
      if (from && l.startsWith(from)) return to + l.slice(from.length);
      if (!from) return to + l;
      return l;
    })
    .join("\n");
}

/** Le fichier utilise-t-il des fins de ligne Windows (CRLF) ? */
export function usesCrlf(text: string): boolean {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length;
  return crlf > 0 && crlf * 2 >= lf;
}

/** Numéros de ligne (1-indexés) où apparaît une ligne de référence (pour guider le modèle). */
function linesContaining(text: string, probe: string, max = 5): number[] {
  const p = probe.trim();
  if (!p) return [];
  const out: number[] = [];
  text.split("\n").forEach((l, i) => {
    if (out.length < max && l.includes(p)) out.push(i + 1);
  });
  return out;
}

/** Indice précis quand old_text est introuvable : où se trouve la ligne la plus proche. */
function nearestHint(text: string, needle: string): string {
  const lines = needle.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  for (const l of lines) {
    const probe = l.length > 60 ? l.slice(0, 60) : l;
    const at = linesContaining(text, probe, 3);
    if (at.length) return ` — ligne proche : ${at.map((n) => `L${n}`).join(", ")} (« ${probe.slice(0, 50)} »). Relis ce passage avec read_file start_line/end_line.`;
  }
  return " — aucun passage proche : relis le fichier.";
}

/**
 * Applique une ou plusieurs modifications (old_text → new_text) ; toutes ou aucune.
 * Garde les fins de ligne (CRLF) et l'indentation du fichier ; en cas d'échec,
 * l'erreur indique les lignes concernées pour que le modèle corrige du premier coup.
 */
export function applyEdits(old: string, a: Record<string, any>): { text: string } | { error: string } {
  const edits: { old_text?: unknown; new_text?: unknown }[] = Array.isArray(a.edits) && a.edits.length ? a.edits : [{ old_text: a.old_text, new_text: a.new_text }];
  const crlf = usesCrlf(old);
  let text = old;
  for (let i = 0; i < edits.length; i++) {
    const needle = String(edits[i]?.old_text ?? "");
    if (!needle) return { error: `modification n°${i + 1} : old_text vide` };
    const at = locate(text, needle);
    if (at === "none") return { error: `modification n°${i + 1} : old_text introuvable${nearestHint(text, needle)}` };
    if (at === "many") {
      const first = needle.split("\n").find((l) => l.trim()) ?? needle;
      const where = linesContaining(text, first.length > 60 ? first.slice(0, 60) : first);
      return { error: `modification n°${i + 1} : old_text apparaît plusieurs fois${where.length ? ` (lignes ${where.join(", ")})` : ""} — ajoute des lignes de contexte pour le rendre unique` };
    }
    let repl = String(edits[i]?.new_text ?? "").replace(/\r\n/g, "\n");
    if (at.reindent) repl = reindentBlock(repl, at.reindent.from, at.reindent.to);
    if (crlf) repl = repl.replace(/\n/g, "\r\n");
    text = text.slice(0, at.start) + repl + text.slice(at.end);
  }
  return { text };
}

// ─── Vérification du contenu écrit par l'IA ───────────────────────────────────

/** Fichiers .json qui tolèrent commentaires et virgules finales (JSONC) : pas de vérification stricte. */
const JSONC = /(^|\/)(tsconfig[^/]*|jsconfig[^/]*|\.eslintrc[^/]*|devcontainer|\.devcontainer\/[^/]*|\.vscode\/[^/]*|[^/]*\.jsonc)$/i;

/**
 * Refuse un contenu qui casserait un fichier structuré (ex. package.json invalide
 * → build cassé → boucle de corrections). Renvoie un message d'erreur ou null.
 */
export function contentProblem(path: string, next: string, previous: string | null): string | null {
  if (/\.json$/i.test(path) && !JSONC.test(path)) {
    const wasValid = previous === null || previous.trim() === "" || isJson(previous);
    if (wasValid && next.trim() !== "" && !isJson(next)) {
      try {
        JSON.parse(next);
      } catch (e: any) {
        return `JSON invalide dans ${path} (${String(e?.message ?? e).slice(0, 120)}) : rien n'a été écrit, corrige la syntaxe.`;
      }
    }
  }
  return null;
}

function isJson(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

// ─── Secrets : masquage avant envoi à l'IA et dans les journaux ───────────────

/** [motif, groupe contenant le secret (0 = toute la correspondance), libellé]. */
const SECRET_RULES: [RegExp, number, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, 0, "PRIVATE_KEY"],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, 0, "GITHUB"],
  [/\bglpat-[A-Za-z0-9_-]{16,}/g, 0, "GITLAB"],
  [/\bsk-ant-[A-Za-z0-9_-]{16,}/g, 0, "ANTHROPIC"],
  [/\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g, 0, "OPENAI"],
  [/\bAIza[0-9A-Za-z_-]{35}/g, 0, "GOOGLE"],
  [/\bAKIA[0-9A-Z]{16}\b/g, 0, "AWS"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, 0, "SLACK"],
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:)([^\s/@]+)@/gi, 2, "URL_PASSWORD"],
  [/(\b(?:Bearer|Basic)\s+)([A-Za-z0-9._~+/=-]{20,})/g, 2, "AUTH_HEADER"],
  [/((?:^|\n)[ \t]*(?:export[ \t]+)?[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*[ \t]*[:=][ \t]*["']?)([A-Za-z0-9_\-+/=.]{12,})(?![A-Za-z0-9_(])/g, 2, "ENV"],
];

/** Hachage court et stable (FNV-1a) : un même secret donne toujours le même marqueur. */
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function replaceSecrets(text: string, onSecret: (secret: string, kind: string) => string): string {
  let out = text;
  for (const [re, group, kind] of SECRET_RULES) {
    out = out.replace(re, (...m: any[]) => {
      const full = m[0] as string;
      if (group === 0) return /__SECRET_[0-9a-f]{8}__/.test(full) ? full : onSecret(full, kind);
      const secret = m[group] as string;
      if (!secret || /^__SECRET_[0-9a-f]{8}__$/.test(secret) || /^\$\{?|^process\.env|^env\./.test(secret)) return full;
      const prefix = m.slice(1, group).join("");
      return prefix + onSecret(secret, kind) + full.slice(prefix.length + secret.length);
    });
  }
  return out;
}

/** Masquage définitif (journaux, rapports) : « [GITHUB masqué] ». */
export function redactSecrets(text: string): string {
  if (!text) return text;
  return replaceSecrets(String(text), (_s, kind) => `[${kind} masqué]`);
}

/**
 * Masquage réversible pour l'IA : chaque secret devient __SECRET_xxxxxxxx__ et
 * l'original est gardé dans `vault` (mémoire du téléphone uniquement) pour être
 * remis en place quand l'IA réécrit le fichier.
 */
export function maskSecrets(text: string, vault: Map<string, string>): string {
  if (!text) return text;
  return replaceSecrets(text, (secret) => {
    const tag = `__SECRET_${shortHash(secret)}__`;
    vault.set(tag, secret);
    return tag;
  });
}

/** Remet les secrets à la place des marqueurs ; `missing` liste les marqueurs inconnus. */
export function unmaskSecrets(text: string, vault: Map<string, string>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = text.replace(/__SECRET_[0-9a-f]{8}__/g, (tag) => {
    const v = vault.get(tag);
    if (v === undefined) {
      if (!missing.includes(tag)) missing.push(tag);
      return tag;
    }
    return v;
  });
  return { text: out, missing };
}

/** Fichiers qui ne doivent jamais être lus par l'IA (clés, mots de passe, environnements). */
export function isSensitivePath(path: string): boolean {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  if (/^\.env(\..+)?$/.test(name)) return !/\.(example|sample|template|dist|defaults)$/.test(name);
  if (/\.(pem|key|p12|pfx|jks|keystore|ppk|p8|mobileprovision)$/.test(name)) return true;
  if (/^(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.pub)?$/.test(name)) return !name.endsWith(".pub");
  return [".netrc", ".git-credentials", ".pgpass", "credentials", "credentials.json", "service-account.json", "secrets.json", "keystore.properties", "local.properties"].includes(name);
}

// ─── Historique envoyé au modèle : budget de taille ───────────────────────────

type HistMsg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; calls: any[]; raw: any; provider: string }
  | { role: "tool"; results: { id: string; name: string; output: string }[] };

const BIG_ARG = 1500;

/** Raccourcit les gros arguments (contenu de fichiers écrits) d'un ancien appel d'outil. */
function shrinkArgs(v: any): any {
  if (typeof v === "string") return v.length > BIG_ARG ? `${v.slice(0, 400)}\n…[ancien contenu retiré de l'historique (${v.length} car.) : relis le fichier si besoin]` : v;
  if (Array.isArray(v)) return v.map(shrinkArgs);
  if (v && typeof v === "object") {
    const o: Record<string, any> = {};
    for (const [k, x] of Object.entries(v)) o[k] = shrinkArgs(x);
    return o;
  }
  return v;
}

/** Version allégée d'un ancien tour assistant (Gemini / Claude ; OpenAI gardé tel quel : éléments liés côté serveur). */
function shrinkAssistant<M extends HistMsg>(m: M): M {
  if (m.role !== "assistant" || !Array.isArray(m.raw)) return m;
  if (m.provider === "gemini") {
    return { ...m, raw: m.raw.map((p: any) => (p?.functionCall ? { ...p, functionCall: { ...p.functionCall, args: shrinkArgs(p.functionCall.args) } } : p)) };
  }
  if (m.provider === "anthropic") {
    return { ...m, raw: m.raw.map((c: any) => (c?.type === "tool_use" ? { ...c, input: shrinkArgs(c.input) } : c)) };
  }
  return m;
}

/**
 * Prépare l'historique ENVOYÉ (l'historique stocké reste intact) :
 * - anciens résultats d'outils tronqués (sauf les `keepRecent` derniers) ;
 * - contenus volumineux des anciennes demandes retirés ;
 * - si le total dépasse `maxChars`, les plus anciennes demandes sont retirées
 *   (on repart toujours d'un message utilisateur).
 */
export function fitHistory<M extends HistMsg>(msgs: M[], keepRecent: number, maxChars: number): M[] {
  const toolIdx = msgs.map((m, i) => (m.role === "tool" ? i : -1)).filter((i) => i >= 0);
  const old = new Set(toolIdx.slice(0, Math.max(0, toolIdx.length - keepRecent)));
  let lastUser = -1;
  msgs.forEach((m, i) => {
    if (m.role === "user") lastUser = i;
  });
  let out = msgs.map((m, i) => {
    if (m.role === "tool" && old.has(i)) {
      return { ...m, results: m.results.map((r) => (r.output.length > 1500 ? { ...r, output: `${r.output.slice(0, 700)}\n…[ancien résultat tronqué : relis le fichier si besoin]` } : r)) };
    }
    if (m.role === "assistant" && i < lastUser) return shrinkAssistant(m);
    return m;
  }) as M[];
  const size = (list: M[]) => JSON.stringify(list).length;
  let trimmed = false;
  while (out.length > 1 && size(out) > maxChars) {
    const next = out.findIndex((m, i) => i > 0 && m.role === "user");
    if (next < 0) break;
    out = out.slice(next);
    trimmed = true;
  }
  if (trimmed && out[0]?.role === "user") {
    const first = out[0] as Extract<HistMsg, { role: "user" }>;
    out = [{ ...first, text: `[Début de la conversation retiré pour rester dans la limite du modèle.]\n${first.text}` } as M, ...out.slice(1)];
  }
  return out;
}

/** Gros dépôt : résumé par dossier au lieu de la liste complète. */
export function summarizeTree(files: string[]): string {
  const root: string[] = [];
  const dirs = new Map<string, number>();
  for (const f of files) {
    const seg = f.split("/");
    if (seg.length === 1) root.push(f);
    else {
      const key = seg.length >= 3 ? `${seg[0]}/${seg[1]}` : seg[0];
      dirs.set(key, (dirs.get(key) ?? 0) + 1);
    }
  }
  const lines = [...dirs.entries()].sort((x, y) => x[0].localeCompare(y[0])).slice(0, 120).map(([d, n]) => `${d}/ (${n} fichiers)`);
  return `Fichiers à la racine : ${root.slice(0, 40).join(", ") || "(aucun)"}\nDossiers :\n${lines.join("\n")}\n(utilise find_files / search pour localiser un fichier)`;
}

/** Signature de l'erreur : si elle est identique après une correction, inutile d'insister. */
export function signature(log: string): string {
  const lines = log
    .split("\n")
    .filter((l) => /error|failed|exception|unresolved|cannot|not found|invalide/i.test(l))
    .map((l) => l.replace(/\d+/g, "#").replace(/\s+/g, " ").trim())
    .slice(0, 6);
  return lines.join("|") || log.slice(0, 200).replace(/\d+/g, "#");
}

/** Nom de dépôt valide pour GitHub : lettres, chiffres, point, tiret, underscore. */
export function slugRepoName(raw: string): string {
  return raw
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/^[.-]+/, "")
    .slice(0, 80);
}

export type ProjectKind = "expo" | "android" | "node";
export type WorkflowTemplate = "expo-apk" | "android-apk" | "node-ci";

export interface ProjectInfo {
  kind: ProjectKind | null;
  hasGradlew: boolean;
  hasLockfile: boolean;
}

export const TEMPLATE_FOR: Record<ProjectKind, string> = { expo: "expo-apk", android: "android-apk", node: "node-ci" };

const TRIGGERS = `on:
  push:
    branches: [main, master]
  pull_request:
  workflow_dispatch:
`;

function upload(name: string, path: string) {
  return `      - name: Envoyer l'APK
        uses: actions/upload-artifact@v4
        with:
          name: ${name}
          path: ${path}
          if-no-files-found: error
          retention-days: 14
`;
}

/** Génère le YAML d'un modèle. Actions épinglées en v4 (versions stables et connues). */
export function workflowTemplate(template: string, p: ProjectInfo, opts: { buildType?: "debug" | "release" } = {}): string | null {
  const bt = opts.buildType === "release" ? "Release" : "Debug";
  const btLower = bt.toLowerCase();
  const install = p.hasLockfile ? "npm ci --no-audit --no-fund" : "npm install --no-audit --no-fund";
  if (template === "android-apk") {
    return `name: Build APK Android

${TRIGGERS}
jobs:
  build:
    name: Compiler l'APK
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Récupérer le code
        uses: actions/checkout@v4

      - name: Installer Java 17
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "17"

      - name: Configurer Gradle
        uses: gradle/actions/setup-gradle@v4${p.hasGradlew ? "" : "\n        with:\n          gradle-version: \"8.10.2\""}
${p.hasGradlew ? "\n      - name: Rendre gradlew exécutable\n        run: chmod +x ./gradlew\n" : ""}
      - name: Compiler (assemble${bt})
        run: ${p.hasGradlew ? "./gradlew" : "gradle"} assemble${bt} --stacktrace --no-daemon

${upload(`apk-${btLower}`, `"**/build/outputs/apk/${btLower}/*.apk"`)}`;
  }
  if (template === "expo-apk") {
    return `name: Build APK Expo

${TRIGGERS}
env:
  CI: "1"
  EXPO_NO_TELEMETRY: "1"

jobs:
  build:
    name: Compiler l'APK
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - name: Récupérer le code
        uses: actions/checkout@v4

      - name: Installer Node.js 22
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Installer Java 17
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "17"

      - name: Installer les dépendances
        run: ${install}

      - name: Générer le projet Android (expo prebuild)
        run: npx expo prebuild --platform android --no-install

      - name: Configurer Gradle
        uses: gradle/actions/setup-gradle@v4

      - name: Compiler (assemble${bt})
        working-directory: android
        run: |
          chmod +x ./gradlew
          ./gradlew assemble${bt} --stacktrace --no-daemon

${upload(`apk-${btLower}`, `android/app/build/outputs/apk/${btLower}/*.apk`)}`;
  }
  if (template === "node-ci") {
    return `name: CI Node

${TRIGGERS}
jobs:
  test:
    name: Vérifications
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - name: Récupérer le code
        uses: actions/checkout@v4

      - name: Installer Node.js 22
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Installer les dépendances
        run: ${install}

      - name: Lint
        run: npm run lint --if-present

      - name: Vérification des types
        run: npm run typecheck --if-present

      - name: Tests
        run: npm test --if-present

      - name: Build
        run: npm run build --if-present
`;
  }
  return null;
}


/** Taille lisible : 1,4 Mo, 230 Ko… */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 o";
  const units = ["o", "Ko", "Mo", "Go"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1).replace(".", ",")} ${units[i]}`;
}

/** Chemins de fichiers cités dans un journal d'erreurs (sans chemin du runner), par ordre d'apparition. */
export function pathCandidates(log: string): string[] {
  const out: string[] = [];
  const re = /([\w@.\-/()[\]]+\.(?:tsx?|jsx?|mjs|cjs|kt|kts|java|gradle|xml|ya?ml|json|swift|py|toml|properties))/g;
  for (const m of log.matchAll(re)) {
    const raw = m[1].replace(/^.*\/work\/[^/]+\/[^/]+\//, "").replace(/^\.\//, "").replace(/^\/+/, "");
    const stripped = raw.replace(/^[([]+/, "").replace(/[)\]]+$/, "");
    for (const p of [raw, stripped]) if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/**
 * Mémorisation courte (par dossier) d'un calcul coûteux, ici le statut Git.
 * - Les appels simultanés partagent un seul calcul.
 * - `invalidatePath(chemin)` oublie le résultat de tout dossier qui CONTIENT ce chemin
 *   (quel que soit l'emplacement du dépôt) ; le test `dir + "/"` évite de confondre « repo » et « repo2 ».
 * - Un calcul qui échoue n'est jamais mémorisé.
 */
export function createDirMemo<T>(ttlMs: number, now: () => number = Date.now) {
  const entries = new Map<string, { at: number; p: Promise<T> }>();
  const versions = new Map<string, number>();

  function invalidate(dir: string) {
    versions.set(dir, (versions.get(dir) ?? 0) + 1);
    entries.delete(dir);
  }

  function invalidatePath(path: string) {
    for (const dir of [...entries.keys()]) {
      if (path === dir || path.startsWith(`${dir}/`)) invalidate(dir);
    }
  }

  function get(dir: string, compute: () => Promise<T>): Promise<T> {
    const hit = entries.get(dir);
    if (hit && now() - hit.at < ttlMs) return hit.p;
    const entry = { at: now(), p: compute() };
    entries.set(dir, entry);
    entry.p.catch(() => {
      if (entries.get(dir) === entry) entries.delete(dir);
    });
    return entry.p;
  }

  return { get, invalidate, invalidatePath };
}
