/**
 * Logique pure (sans React Native ni accès disque) : édition tolérante de fichiers,
 * résumé d'arborescence, signature d'erreur, modèles de workflows…
 * Isolée ici pour être testée directement par Node (`npm test`).
 */

/** Position unique de `needle` dans `text` ; tolère les espaces de fin de ligne et CRLF. */
export function locate(text: string, needle: string): { start: number; end: number } | "none" | "many" {
  const exact = text.split(needle).length - 1;
  if (exact === 1) {
    const start = text.indexOf(needle);
    return { start, end: start + needle.length };
  }
  if (exact > 1) return "many";
  const norm = (l: string) => l.replace(/\s+$/, "");
  const hay = text.split("\n");
  const want = needle.replace(/\r\n/g, "\n").split("\n").map(norm);
  while (want.length && want[want.length - 1] === "") want.pop();
  if (!want.length) return "none";
  const hits: number[] = [];
  for (let i = 0; i + want.length <= hay.length; i++) {
    if (want.every((w, j) => norm(hay[i + j]) === w)) hits.push(i);
  }
  if (hits.length !== 1) return hits.length ? "many" : "none";
  const before = hay.slice(0, hits[0]).join("\n");
  const start = hits[0] === 0 ? 0 : before.length + 1;
  const end = start + hay.slice(hits[0], hits[0] + want.length).join("\n").length;
  return { start, end };
}

/** Applique une ou plusieurs modifications (old_text → new_text) ; toutes ou aucune. */
export function applyEdits(old: string, a: Record<string, any>): { text: string } | { error: string } {
  const edits: { old_text?: unknown; new_text?: unknown }[] = Array.isArray(a.edits) && a.edits.length ? a.edits : [{ old_text: a.old_text, new_text: a.new_text }];
  let text = old;
  for (let i = 0; i < edits.length; i++) {
    const needle = String(edits[i]?.old_text ?? "");
    if (!needle) return { error: `modification n°${i + 1} : old_text vide` };
    const at = locate(text, needle);
    if (at === "none") return { error: `modification n°${i + 1} : old_text introuvable (relis le fichier)` };
    if (at === "many") return { error: `modification n°${i + 1} : old_text apparaît plusieurs fois (ajoute du contexte)` };
    text = text.slice(0, at.start) + String(edits[i]?.new_text ?? "") + text.slice(at.end);
  }
  return { text };
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
