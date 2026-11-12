/**
 * Agent IA sur un dépôt local : lit, cherche, modifie les fichiers et
 * exécute des actions Git. Chaque action qui modifie quelque chose peut
 * être soumise à validation (aperçu du diff) avant exécution.
 */
import { isBinary, unifiedDiff, type DiffResult } from "@/utils/git/diff";
import * as engine from "@/utils/git/engine";
import { decodeUtf8, listEntries, mapLimit, movePath, pathInfo, readBytes, removePath, writeBytesDeep, writeTextDeep } from "@/utils/git/fs";
import { syncContainer } from "@/utils/git/sync";

import { createRepository, hasGitHubToken } from "@/utils/git/create";
import { ctxFor, getContainer, repoDir, type Container } from "@/utils/git/store";

import { ciCheck } from "./ci";
import { applyEdits, contentProblem, fitHistory, isSensitivePath, maskSecrets, summarizeTree, unmaskSecrets } from "./pure";
import { detectProject, lintAllWorkflows, lintChangedWorkflows, lintWorkflow, TEMPLATE_FOR, workflowNote, workflowScopeHint, workflowTemplate, WORKFLOW_DIR } from "./workflows";
import { chat, type AiMsg, type ToolCall, type ToolDef } from "./providers";
import type { AiProvider, AiSettings } from "./settings";

const MAX_READ = 60000;

/**
 * Coffre des secrets masqués (mémoire du téléphone uniquement, jamais envoyé ni
 * enregistré) : les tokens / clés trouvés dans les fichiers sont remplacés par
 * __SECRET_xxxxxxxx__ avant d'être montrés à l'IA, puis remis en place quand
 * l'IA réécrit le fichier.
 */
const SECRET_VAULT = new Map<string, string>();

/** Texte destiné au modèle : secrets masqués. */
export function forModel(text: string): string {
  return maskSecrets(text, SECRET_VAULT);
}

/** Texte écrit par le modèle : secrets remis en place (erreur si un marqueur est inconnu). */
export function fromModel(text: string): string {
  const r = unmaskSecrets(text, SECRET_VAULT);
  if (r.missing.length) throw new Error(`marqueur de secret inconnu (${r.missing[0]}) : relis le fichier avant de le réécrire, sans modifier les marqueurs __SECRET_…__.`);
  return r.text;
}

const SENSITIVE_MSG = "fichier sensible (clés, mots de passe) : son contenu n'est jamais transmis à l'IA. Demande à l'utilisateur de le modifier lui-même si besoin.";

function guardRead(p: string) {
  if (isSensitivePath(p)) throw new Error(`${p} : ${SENSITIVE_MSG}`);
}

/** Vérifie qu'un contenu ne casse pas un fichier structuré (JSON) ; lève une erreur sinon. */
function guardContent(p: string, next: string, previous: string | null) {
  const problem = contentProblem(p, next, previous);
  if (problem) throw new Error(problem);
}

/** Arguments d'edit_file avec les secrets remis en place (old_text et new_text). */
function unmaskEdits(a: Record<string, any>): Record<string, any> {
  const list: { old_text?: unknown; new_text?: unknown }[] = Array.isArray(a.edits) && a.edits.length ? a.edits : [{ old_text: a.old_text, new_text: a.new_text }];
  return { edits: list.map((e) => ({ old_text: fromModel(String(e?.old_text ?? "")), new_text: fromModel(String(e?.new_text ?? "")) })) };
}
/** Marqueur que le modèle ajoute quand tout est terminé : évite un appel final juste pour le résumé. */
const END_MARK = "[[FIN]]";

/** Une action annulable (journal par demande) : contenu d'un fichier avant modification, ou position d'une branche avant commit. */
export type UndoEntry =
  | { kind: "file"; dir: string; path: string; before: Uint8Array | null }
  | { kind: "commit"; dir: string; branch: string; prevOid: string | null };

export interface RepoToolCtx {
  /** Journal d'annulation de la demande en cours. */
  undo?: UndoEntry[];
  signal?: AbortSignal;
  dir: string;
  containerId: string;
  author: engine.Author;
  gitCtx: () => Promise<engine.GitCtx>;
  /** Appelé quand l'agent crée un nouveau dépôt et y bascule (les outils ciblent ensuite ce dépôt). */
  onRepoChanged?: (c: Container) => void;
}

export interface Preview {
  title: string;
  path?: string;
  diff?: DiffResult;
  /** Plusieurs fichiers dans une seule action (write_files). */
  files?: { path: string; diff: DiffResult }[];
  detail?: string;
}

type Tool = ToolDef & {
  mutating: boolean;
  preview?: (ctx: RepoToolCtx, a: Record<string, any>) => Promise<Preview>;
  /** Renvoie un message si l'action ne changerait rien (aucune validation demandée, aucun écrit). */
  noop?: (ctx: RepoToolCtx, a: Record<string, any>) => Promise<string | null>;
  run: (ctx: RepoToolCtx, a: Record<string, any>) => Promise<string>;
};

function cleanPath(p: unknown): string {
  const s = String(p ?? "").trim().replace(/^\.?\/+/, "").replace(/\/+$/, "");
  if (s.split("/").some((seg) => seg === "..")) throw new Error(`Chemin refusé : ${s}`);
  return s;
}

function guardWrite(p: string) {
  if (!p || p === ".git" || p.startsWith(".git/")) throw new Error(`Écriture interdite dans .git : ${p}`);
}

async function readTextFile(dir: string, p: string): Promise<string | null> {
  const bytes = await readBytes(`${dir}/${p}`);
  if (!bytes) return null;
  if (isBinary(bytes)) throw new Error(`Fichier binaire : ${p}`);
  return decodeUtf8(bytes);
}

const FILE_ARG = {
  type: "array",
  description: "Liste de fichiers",
  items: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string", description: "Contenu COMPLET du fichier" } },
    required: ["path", "content"],
  },
};

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".expo", ".gradle", "Pods", ".next", ".idea", "__pycache__"]);

async function walk(dir: string, rel: string, out: string[], limit: number) {
  // Parcours par niveaux, 6 dossiers à la fois (beaucoup plus rapide que dossier par dossier).
  let level = [rel];
  while (level.length && out.length < limit) {
    const lists = await mapLimit(level, 6, (r) => listEntries(r ? `${dir}/${r}` : dir).catch(() => []));
    const next: string[] = [];
    lists.forEach((list, i) => {
      for (const e of list) {
        if (out.length >= limit) return;
        if (IGNORED_DIRS.has(e.name)) continue;
        const p = level[i] ? `${level[i]}/${e.name}` : e.name;
        if (e.isDir) next.push(p);
        else if (e.size < 300000) out.push(p);
      }
    });
    level = next;
  }
}

/** Tous les fichiers d'un dossier, sans filtre de taille (sauvegarde avant suppression). */
async function walkAll(dir: string, rel: string, out: string[]) {
  const list = await listEntries(rel ? `${dir}/${rel}` : dir);
  for (const e of list) {
    if (e.name === ".git") continue;
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDir) await walkAll(dir, p, out);
    else out.push(p);
  }
}

/** Mémorise l'état d'un fichier (ou d'un dossier entier) AVANT modification, pour pouvoir annuler. */
async function snap(ctx: RepoToolCtx, p: string) {
  if (!ctx.undo) return;
  const known = (path: string) => ctx.undo!.some((e) => e.kind === "file" && e.dir === ctx.dir && e.path === path);
  const info = await pathInfo(`${ctx.dir}/${p}`);
  if (info.exists && info.isDirectory) {
    const files: string[] = [];
    await walkAll(ctx.dir, p, files);
    for (const f of files) if (!known(f)) ctx.undo.push({ kind: "file", dir: ctx.dir, path: f, before: await readBytes(`${ctx.dir}/${f}`) });
    return;
  }
  if (known(p)) return;
  ctx.undo.push({ kind: "file", dir: ctx.dir, path: p, before: info.exists ? await readBytes(`${ctx.dir}/${p}`) : null });
}

/** Annule un lot d'actions (dans l'ordre inverse). Renvoie le nombre d'éléments restaurés. */
export async function undoBatch(entries: UndoEntry[]): Promise<number> {
  const touched = new Map<string, Set<string>>();
  const commitDirs = new Set<string>();
  let n = 0;
  for (const e of [...entries].reverse()) {
    if (e.kind === "file") {
      const abs = `${e.dir}/${e.path}`;
      if (e.before === null) await removePath(abs);
      else await writeBytesDeep(abs, e.before);
      if (!touched.has(e.dir)) touched.set(e.dir, new Set());
      touched.get(e.dir)!.add(e.path);
      n++;
    } else {
      await engine.moveBranchTo(e.dir, e.branch, e.prevOid);
      commitDirs.add(e.dir);
    }
  }
  // L'index doit refléter HEAD : sinon les fichiers restaurés apparaîtraient comme « indexés ».
  for (const dir of commitDirs) {
    const staged = (await engine.getStatus(dir).catch(() => [])).filter((x) => x.staged).map((x) => x.path);
    if (staged.length) await engine.unstagePaths(dir, staged);
  }
  for (const [dir, paths] of touched) {
    await engine.unstagePaths(dir, [...paths]);
    engine.dropCache(dir);
  }
  return n;
}

/** Construit le workflow demandé (modèle prêt à l'emploi, type de projet détecté si non précisé). */
async function buildWorkflow(ctx: RepoToolCtx, a: Record<string, any>): Promise<{ path: string; text: string; template: string } | { error: string }> {
  const info = await detectProject(ctx.dir);
  const template = String(a.template ?? "").trim() || (info.kind ? TEMPLATE_FOR[info.kind] : "");
  if (!template) return { error: "Type de projet non reconnu : précise template (android-apk | expo-apk | node-ci) ou écris le YAML avec write_file." };
  const text = workflowTemplate(template, info, { buildType: a.build_type === "release" ? "release" : "debug" });
  if (!text) return { error: `Modèle inconnu « ${template} » (android-apk | expo-apk | node-ci).` };
  let file = String(a.file ?? "").trim().replace(/^.*\//, "") || (template === "node-ci" ? "ci.yml" : "build-apk.yml");
  if (!/\.ya?ml$/i.test(file)) file += ".yml";
  return { path: `${WORKFLOW_DIR}/${file}`, text, template };
}

const TOOLS: Tool[] = [
  {
    name: "list_files",
    description: "Liste le contenu d'un dossier du dépôt (dossiers suffixés par /). Sans chemin : racine. recursive=true liste tous les fichiers (max 500).",
    parameters: { type: "object", properties: { path: { type: "string" }, recursive: { type: "boolean" } } },
    mutating: false,
    run: async (ctx, a) => {
      const p = cleanPath(a.path);
      if (a.recursive) {
        const out: string[] = [];
        await walk(ctx.dir, p, out, 500);
        return out.join("\n") || "(vide)";
      }
      const list = await listEntries(p ? `${ctx.dir}/${p}` : ctx.dir);
      return list.filter((e) => e.name !== ".git").map((e) => (e.isDir ? `${e.name}/` : `${e.name} (${e.size} o)`)).join("\n") || "(vide)";
    },
  },
  {
    name: "read_file",
    description: "Lit un fichier texte du dépôt (contenu brut). Options start_line / end_line (1-indexées) pour les gros fichiers.",
    parameters: { type: "object", properties: { path: { type: "string" }, start_line: { type: "number" }, end_line: { type: "number" } }, required: ["path"] },
    mutating: false,
    run: async (ctx, a) => {
      const p = cleanPath(a.path);
      guardRead(p);
      const text = await readTextFile(ctx.dir, p);
      if (text === null) return `ERREUR : fichier introuvable : ${p}`;
      let out = text;
      if (a.start_line || a.end_line) {
        const lines = text.split("\n");
        const s = Math.max(1, Number(a.start_line) || 1);
        const e = Math.min(lines.length, Number(a.end_line) || lines.length);
        out = lines.slice(s - 1, e).join("\n");
      }
      return out.length > MAX_READ ? `${out.slice(0, MAX_READ)}\n…[tronqué : ${out.length} caractères, utilise start_line/end_line]` : out;
    },
  },
  {
    name: "read_files",
    description: "Lit PLUSIEURS fichiers texte en un seul appel (préfère-le à read_file répété).",
    parameters: { type: "object", properties: { paths: { type: "array", items: { type: "string" }, description: "Chemins des fichiers (max 15)" } }, required: ["paths"] },
    mutating: false,
    run: async (ctx, a) => {
      const paths: string[] = (Array.isArray(a.paths) ? a.paths : []).slice(0, 15).map((x: unknown) => cleanPath(x));
      if (!paths.length) return "ERREUR : paths vide";
      const per = Math.floor(MAX_READ / paths.length);
      const out: string[] = [];
      for (const p of paths) {
        try {
          guardRead(p);
          const text = await readTextFile(ctx.dir, p);
          if (text === null) out.push(`=== ${p}\nERREUR : fichier introuvable`);
          else out.push(`=== ${p}\n${text.length > per ? `${text.slice(0, per)}\n…[tronqué : ${text.length} caractères]` : text}`);
        } catch (e: any) {
          out.push(`=== ${p}\nERREUR : ${e?.message ?? e}`);
        }
      }
      return out.join("\n\n");
    },
  },
  {
    name: "search",
    description: "Recherche un texte (insensible à la casse) ou une regex (regex=true) dans le contenu des fichiers texte. Renvoie chemin:ligne: extrait (max 60 résultats).",
    parameters: { type: "object", properties: { query: { type: "string" }, path: { type: "string" }, regex: { type: "boolean" } }, required: ["query"] },
    mutating: false,
    run: async (ctx, a) => {
      const q = String(a.query ?? "").toLowerCase();
      if (!q) return "ERREUR : requête vide";
      let re: RegExp | null = null;
      if (a.regex) {
        try {
          re = new RegExp(String(a.query), "i");
        } catch (e: any) {
          return `ERREUR : regex invalide (${e?.message ?? e})`;
        }
      }
      const files: string[] = [];
      await walk(ctx.dir, cleanPath(a.path), files, 1500);
      const hits: string[] = [];
      for (const f of files) {
        if (hits.length >= 60) break;
        if (isSensitivePath(f)) continue;
        const bytes = await readBytes(`${ctx.dir}/${f}`);
        if (!bytes || isBinary(bytes)) continue;
        decodeUtf8(bytes)
          .split("\n")
          .forEach((line, i) => {
            if (hits.length < 60 && (re ? re.test(line) : line.toLowerCase().includes(q))) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 160)}`);
          });
      }
      return hits.join("\n") || "Aucun résultat.";
    },
  },
  {
    name: "git_status",
    description: "Liste les fichiers modifiés / ajoutés / supprimés dans la copie de travail.",
    parameters: { type: "object", properties: {} },
    mutating: false,
    run: async (ctx) => {
      const st = await engine.getStatus(ctx.dir);
      const branch = await engine.currentBranch(ctx.dir);
      return `Branche : ${branch ?? "?"}\n` + (st.map((s) => `${s.kind}${s.staged ? " (indexé)" : ""}: ${s.path}`).join("\n") || "Aucune modification.");
    },
  },
  {
    name: "git_diff",
    description: "Diff unifié d'un fichier entre le dernier commit (HEAD) et la copie de travail.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    mutating: false,
    run: async (ctx, a) => {
      const p = cleanPath(a.path);
      guardRead(p);
      const [x, y] = await Promise.all([engine.fileAt(ctx.dir, "HEAD", p), engine.fileAt(ctx.dir, "WORKDIR", p)]);
      if ((x && isBinary(x)) || (y && isBinary(y))) return "Fichier binaire modifié.";
      const d = unifiedDiff(x ? decodeUtf8(x) : "", y ? decodeUtf8(y) : "");
      const txt = d.rows.map((r) => (r.kind === "hunk" ? r.text : `${r.t === 1 ? "+" : r.t === -1 ? "-" : " "}${r.text}`)).join("\n");
      return txt.slice(0, MAX_READ) || "Aucune différence.";
    },
  },
  {
    name: "git_log",
    description: "Derniers commits de la branche courante.",
    parameters: { type: "object", properties: { count: { type: "number" } } },
    mutating: false,
    run: async (ctx, a) => {
      const log = await engine.getLog(ctx.dir, "HEAD", Math.min(50, Number(a.count) || 15));
      return log.map((c) => `${c.oid.slice(0, 7)} ${c.commit.author.name}: ${c.commit.message.split("\n")[0]}`).join("\n") || "Aucun commit.";
    },
  },
  {
    name: "find_files",
    description: "Trouve des fichiers par NOM sur tout le dépôt (sous-chaîne, ou regex avec regex=true, insensible à la casse). Renvoie les chemins (max 100).",
    parameters: { type: "object", properties: { query: { type: "string" }, regex: { type: "boolean" } }, required: ["query"] },
    mutating: false,
    run: async (ctx, a) => {
      const q = String(a.query ?? "");
      if (!q) return "ERREUR : requête vide";
      let test: (p: string) => boolean;
      if (a.regex) {
        try {
          const re = new RegExp(q, "i");
          test = (p) => re.test(p);
        } catch (e: any) {
          return `ERREUR : regex invalide (${e?.message ?? e})`;
        }
      } else {
        const low = q.toLowerCase();
        test = (p) => p.toLowerCase().includes(low);
      }
      const files: string[] = [];
      await walk(ctx.dir, "", files, 5000);
      const hits = files.filter(test).slice(0, 100);
      return hits.join("\n") || "Aucun fichier trouvé.";
    },
  },
  {
    name: "validate_workflow",
    description: "Vérifie la syntaxe et la structure des workflows GitHub Actions (un fichier via path, sinon tous ceux de .github/workflows). À faire avant de synchroniser.",
    parameters: { type: "object", properties: { path: { type: "string" } } },
    mutating: false,
    run: async (ctx, a) => {
      if (a.path) {
        const p = cleanPath(a.path);
        const text = await readTextFile(ctx.dir, p);
        if (text === null) return `ERREUR : fichier introuvable : ${p}`;
        const issues = lintWorkflow(text);
        return issues.length ? `INVALIDE (${p}) :\n${issues.join("\n")}` : `OK : ${p} est valide.`;
      }
      const issues = await lintAllWorkflows(ctx.dir);
      return issues.length ? `INVALIDE :\n${issues.join("\n")}` : "OK : tous les workflows sont valides (ou aucun workflow dans .github/workflows).";
    },
  },
  {
    name: "create_workflow",
    description:
      "Crée un workflow GitHub Actions prêt à l'emploi dans .github/workflows, SANS écrire de YAML à la main. Modèles : android-apk (Kotlin/Gradle), expo-apk (Expo / React Native), node-ci (lint, types, tests, build Node). Sans `template`, le type de projet est détecté. Le YAML est vérifié. Ensuite : git_commit puis git_sync pour le lancer.",
    parameters: {
      type: "object",
      properties: {
        template: { type: "string", description: "android-apk | expo-apk | node-ci (défaut : détection automatique)" },
        build_type: { type: "string", description: "debug (défaut, aucune clé de signature requise) ou release" },
        file: { type: "string", description: "Nom du fichier dans .github/workflows (défaut : build-apk.yml ou ci.yml)" },
      },
    },
    mutating: true,
    preview: async (ctx, a) => {
      const w = await buildWorkflow(ctx, a);
      if ("error" in w) return { title: "create_workflow", detail: w.error };
      const old = await readTextFile(ctx.dir, w.path).catch(() => null);
      return { title: "create_workflow", path: w.path, diff: unifiedDiff(old ?? "", w.text) };
    },
    noop: async (ctx, a) => {
      const w = await buildWorkflow(ctx, a);
      if ("error" in w) return null;
      const old = await readTextFile(ctx.dir, w.path).catch(() => null);
      return old === w.text ? `OK : ${w.path} existe déjà à l'identique.` : null;
    },
    run: async (ctx, a) => {
      const w = await buildWorkflow(ctx, a);
      if ("error" in w) return `ERREUR : ${w.error}`;
      await snap(ctx, w.path);
      await writeTextDeep(`${ctx.dir}/${w.path}`, w.text);
      return `OK : workflow créé : ${w.path} (modèle ${w.template}). Pour le lancer : git_commit puis git_sync.${workflowNote(w.path, w.text)}`;
    },
  },
  {
    name: "ci_status",
    description:
      "Résultat du build GitHub Actions du commit courant (à utiliser APRÈS git_sync). Avec wait=true (défaut) attend la fin du build (max ~2 min) ; en cas d'échec renvoie les étapes et extraits d'erreurs pour que tu corriges. Corrige puis re-synchronise, 2 essais maximum.",
    parameters: { type: "object", properties: { wait: { type: "boolean" } } },
    mutating: false,
    run: async (ctx, a) => (await ciCheck(ctx, a.wait !== false)).text,
  },
  {
    name: "write_file",
    description: "Crée ou remplace ENTIÈREMENT un fichier texte. Pour une petite modification d'un fichier existant, préfère edit_file.",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
    mutating: true,
    preview: async (ctx, a) => {
      const p = cleanPath(a.path);
      const old = (await readTextFile(ctx.dir, p).catch(() => null)) ?? "";
      const next = fromModel(String(a.content ?? ""));
      const problem = contentProblem(p, next, old || null);
      return { title: old ? "write" : "create", path: p, diff: unifiedDiff(old, next), detail: problem ?? undefined };
    },
    noop: async (ctx, a) => {
      const p = cleanPath(a.path);
      const old = await readTextFile(ctx.dir, p).catch(() => null);
      return old !== null && old === unmaskSecrets(String(a.content ?? ""), SECRET_VAULT).text ? `OK : ${p} déjà identique, rien écrit.` : null;
    },
    run: async (ctx, a) => {
      const p = cleanPath(a.path);
      guardWrite(p);
      const next = fromModel(String(a.content ?? ""));
      const old = await readTextFile(ctx.dir, p).catch(() => null);
      guardContent(p, next, old);
      await snap(ctx, p);
      await writeTextDeep(`${ctx.dir}/${p}`, next);
      return `OK : ${p} écrit (${next.length} caractères).${workflowNote(p, next)}`;
    },
  },
  {
    name: "write_files",
    description: "Crée ou remplace ENTIÈREMENT PLUSIEURS fichiers texte en un seul appel (idéal pour un nouveau projet). Chaque fichier : path + content complet.",
    parameters: { type: "object", properties: { files: FILE_ARG }, required: ["files"] },
    mutating: true,
    preview: async (ctx, a) => {
      const files: { path: string; diff: DiffResult }[] = [];
      const problems: string[] = [];
      for (const f of Array.isArray(a.files) ? a.files : []) {
        const p = cleanPath(f?.path);
        const old = await readTextFile(ctx.dir, p).catch(() => null);
        const next = fromModel(String(f?.content ?? ""));
        if (old !== null && old === next) continue; // identique : rien à valider
        const problem = contentProblem(p, next, old);
        if (problem) problems.push(problem);
        files.push({ path: p, diff: unifiedDiff(old ?? "", next) });
      }
      return { title: "write_files", files, detail: problems.length ? problems.join("\n") : undefined };
    },
    noop: async (ctx, a) => {
      const files: any[] = Array.isArray(a.files) ? a.files : [];
      if (!files.length) return null;
      for (const f of files) {
        const old = await readTextFile(ctx.dir, cleanPath(f?.path)).catch(() => null);
        if (old === null || old !== unmaskSecrets(String(f?.content ?? ""), SECRET_VAULT).text) return null;
      }
      return `OK : ${files.length} fichier(s) déjà identiques, rien écrit.`;
    },
    run: async (ctx, a) => {
      const files: any[] = Array.isArray(a.files) ? a.files : [];
      if (!files.length) return "ERREUR : files vide";
      const ok: string[] = [];
      const bad: string[] = [];
      let notes = "";
      for (const f of files) {
        try {
          const p = cleanPath(f?.path);
          guardWrite(p);
          const next = fromModel(String(f?.content ?? ""));
          const old = await readTextFile(ctx.dir, p).catch(() => null);
          if (old !== null && old === next) continue;
          guardContent(p, next, old);
          await snap(ctx, p);
          await writeTextDeep(`${ctx.dir}/${p}`, next);
          ok.push(p);
          notes += workflowNote(p, next);
        } catch (e: any) {
          bad.push(`${f?.path} (${e?.message ?? e})`);
        }
      }
      return `${bad.length ? "ERREUR partielle : " : "OK : "}${ok.length} fichier(s) écrit(s) : ${ok.join(", ")}${bad.length ? `\nÉchecs : ${bad.join("; ")}` : ""}${notes}`;
    },
  },
  {
    name: "edit_file",
    description:
      "Modifie un fichier existant. Donne UNE ou PLUSIEURS modifications dans `edits` (chaque old_text = passage exact et unique du fichier, new_text = remplacement). Toutes sont appliquées ou aucune. Lis le fichier avant.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        edits: {
          type: "array",
          description: "Modifications à appliquer dans l'ordre",
          items: { type: "object", properties: { old_text: { type: "string" }, new_text: { type: "string" } }, required: ["old_text", "new_text"] },
        },
      },
      required: ["path", "edits"],
    },
    mutating: true,
    preview: async (ctx, a) => {
      const p = cleanPath(a.path);
      const old = (await readTextFile(ctx.dir, p)) ?? "";
      const r = applyEdits(old, unmaskEdits(a));
      if ("error" in r) return { title: "edit", path: p, detail: r.error };
      const problem = contentProblem(p, r.text, old);
      return { title: "edit", path: p, diff: unifiedDiff(old, r.text), detail: problem ?? undefined };
    },
    noop: async (ctx, a) => {
      const p = cleanPath(a.path);
      const old = await readTextFile(ctx.dir, p).catch(() => null);
      if (old === null) return null;
      let r: ReturnType<typeof applyEdits>;
      try {
        r = applyEdits(old, unmaskEdits(a));
      } catch {
        return null;
      }
      return !("error" in r) && r.text === old ? `OK : ${p} inchangé (les modifications ne changent rien).` : null;
    },
    run: async (ctx, a) => {
      const p = cleanPath(a.path);
      guardWrite(p);
      const old = await readTextFile(ctx.dir, p);
      if (old === null) return `ERREUR : fichier introuvable : ${p}`;
      const r = applyEdits(old, unmaskEdits(a));
      if ("error" in r) return `ERREUR : ${p} — ${r.error}`;
      guardContent(p, r.text, old);
      await snap(ctx, p);
      await writeTextDeep(`${ctx.dir}/${p}`, r.text);
      return `OK : ${p} modifié.${workflowNote(p, r.text)}`;
    },
  },
  {
    name: "create_repository",
    description:
      "Crée un NOUVEAU dépôt (dossier Git local, plus dépôt GitHub si on_github=true) et bascule dessus : les write_files / write_file / git_commit / git_sync suivants s'y appliquent. À utiliser quand l'utilisateur veut un nouveau projet / dépôt.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nom du dépôt (lettres, chiffres, - _ .)" },
        description: { type: "string" },
        private: { type: "boolean", description: "Dépôt privé (défaut : true)" },
        on_github: { type: "boolean", description: "Créer aussi le dépôt sur GitHub (défaut : true)" },
      },
      required: ["name"],
    },
    mutating: true,
    preview: async (_ctx, a) => ({
      title: "create_repo",
      detail: `${String(a.name ?? "")}\n${a.private === false ? "public" : "privé"} · ${a.on_github === false ? "local seulement" : "+ GitHub"}${a.description ? `\n${String(a.description)}` : ""}`,
    }),
    run: async (ctx, a) => {
      const onGitHub = a.on_github !== false;
      if (onGitHub && !(await hasGitHubToken())) return "ERREUR : pas connecté à GitHub. Relance avec on_github=false (dépôt local) ou demande à l'utilisateur de se connecter.";
      const c = await createRepository({ name: String(a.name ?? ""), description: a.description ? String(a.description) : undefined, onGitHub, isPrivate: a.private !== false, author: ctx.author });
      ctx.dir = repoDir(c);
      ctx.containerId = c.id;
      ctx.gitCtx = async () => ctxFor((await getContainer(c.id)) ?? c);
      ctx.onRepoChanged?.(c);
      return `OK : dépôt « ${c.name} » créé${c.url ? ` (${c.url})` : " (local)"}. Il est vide : écris maintenant les fichiers avec write_files, puis git_commit et git_sync.`;
    },
  },
  {
    name: "delete_file",
    description: "Supprime un fichier ou un dossier de la copie de travail.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    mutating: true,
    preview: async (_ctx, a) => ({ title: "delete", path: cleanPath(a.path) }),
    run: async (ctx, a) => {
      const p = cleanPath(a.path);
      guardWrite(p);
      if (!(await pathInfo(`${ctx.dir}/${p}`)).exists) return `ERREUR : introuvable : ${p}`;
      await snap(ctx, p);
      await removePath(`${ctx.dir}/${p}`);
      return `OK : ${p} supprimé.`;
    },
  },
  {
    name: "move_file",
    description: "Déplace ou renomme un fichier / dossier.",
    parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] },
    mutating: true,
    preview: async (_ctx, a) => ({ title: "move", path: `${cleanPath(a.from)} → ${cleanPath(a.to)}` }),
    run: async (ctx, a) => {
      const from = cleanPath(a.from);
      const to = cleanPath(a.to);
      guardWrite(from);
      guardWrite(to);
      await snap(ctx, from);
      await snap(ctx, to);
      await movePath(`${ctx.dir}/${from}`, `${ctx.dir}/${to}`);
      return `OK : ${from} → ${to}`;
    },
  },
  {
    name: "git_commit",
    description: "Indexe toutes les modifications et crée un commit avec ce message.",
    parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
    mutating: true,
    preview: async (ctx, a) => {
      const st = await engine.getStatus(ctx.dir);
      return { title: "commit", detail: `${String(a.message ?? "")}\n\n${st.map((s) => `${s.kind}: ${s.path}`).join("\n")}` };
    },
    run: async (ctx, a) => {
      const st = await engine.getStatus(ctx.dir);
      if (!st.length) return "Rien à commiter.";
      await engine.stagePaths(ctx.dir, st.filter((s) => s.unstaged).map((s) => s.path));
      const prevOid = await engine.resolveOrNull(ctx.dir, "HEAD");
      const oid = await engine.commitStaged(await ctx.gitCtx(), String(a.message ?? "Update"));
      const branch = await engine.currentBranch(ctx.dir);
      if (branch) ctx.undo?.push({ kind: "commit", dir: ctx.dir, branch, prevOid });
      return `OK : commit ${oid.slice(0, 7)} (${st.length} fichier(s)).`;
    },
  },
  {
    name: "git_sync",
    description: "Synchronise avec le dépôt distant (commit des changements restants, pull, push).",
    parameters: { type: "object", properties: {} },
    mutating: true,
    preview: async () => ({ title: "sync" }),
    run: async (ctx) => {
      if (!(await getContainer(ctx.containerId))?.url) return "ERREUR : ce dépôt est local (aucun dépôt distant). Rien à synchroniser.";
      const bad = await lintChangedWorkflows(ctx.dir).catch(() => []);
      if (bad.length) return `ERREUR : workflow(s) invalide(s), corrige avant de synchroniser (sinon le build échoue sans démarrer) :\n${bad.slice(0, 8).join("\n")}`;
      let s;
      try {
        s = await syncContainer(ctx.containerId, "manual");
      } catch (e: any) {
        const hint = workflowScopeHint(e);
        if (hint) return `ERREUR : ${hint}`;
        throw e;
      }
      // Après un push, on ne peut plus tout annuler localement : on vide le journal.
      if (s.pushed && ctx.undo) ctx.undo.length = 0;
      if (s.pulled === "conflict") return `Conflits de fusion à résoudre par l'utilisateur : ${s.conflicts.join(", ")}`;
      return `OK : ${s.committed} fichier(s) commité(s), pull=${s.pulled}, push=${s.pushed ? "oui" : "non"}.`;
    },
  },
];

export function toolsFor(mode: "chat" | "agent"): Tool[] {
  return mode === "agent" ? TOOLS : TOOLS.filter((t) => !t.mutating);
}

export function systemPrompt(mode: "chat" | "agent", repoName: string, lang: string, freeTier = true): string {
  const language = { fr: "français", en: "English", es: "español", zh: "中文", ru: "русский" }[lang] ?? "français";
  return [
    `Tu es l'assistant Git intégré à l'application mobile Git-Push. Dépôt ouvert : « ${repoName} ».`,
    `Réponds toujours en ${language}, de façon concise (écran de téléphone).`,
    "Le message de l'utilisateur commence par un CONTEXTE (arborescence + fichiers clés) : utilise-le, ne relis pas ce que tu as déjà.",
    freeTier
      ? "IMPORTANT — chaque appel au modèle consomme un quota gratuit limité. Sois ÉCONOME : fais plusieurs appels d'outils dans le MÊME tour (en parallèle), lis tous les fichiers utiles d'un coup avec read_files, écris/crée tous les fichiers d'un coup avec write_files, regroupe les changements d'un fichier dans un seul edit_file (edits[]). Vise 3 tours au total."
      : "Regroupe tes appels d'outils : plusieurs appels dans le même tour, read_files, write_files, edit_file avec edits[].",
    "Explore avec find_files (par nom), search (dans le contenu, regex possible), list_files, read_files, git_status, git_diff, git_log seulement si le contexte ne suffit pas.",
    "WORKFLOWS GitHub Actions : pour compiler / tester dans le cloud, utilise create_workflow (modèles prêts, YAML déjà vérifié) plutôt que d'écrire le YAML à la main ; validate_workflow vérifie un fichier ; ne synchronise jamais un workflow invalide.",
    "SECRETS : les tokens / clés / mots de passe des fichiers apparaissent sous la forme __SECRET_xxxxxxxx__ ; recopie ces marqueurs tels quels (ils sont remis en place à l'écriture), ne les invente jamais. Les fichiers sensibles (.env, clés, keystores) ne te sont pas lisibles.",
    "QUALITÉ : modifications minimales et ciblées, pas de reformatage du reste du fichier ; old_text = quelques lignes exactes et uniques copiées du fichier lu ; garde imports, types et style existants ; un JSON (package.json…) doit rester valide.",
    "LONGUEUR : une réponse trop longue est COUPÉE et perdue. write_files : 4 fichiers maximum (ou ~10 000 caractères au total) par appel ; s'il y en a davantage, écris-les en plusieurs tours successifs, jamais tous dans une seule réponse.",
    mode === "agent"
      ? [
          "Tu peux modifier le dépôt : lis un fichier avant de le modifier, préfère edit_file (passages exacts et uniques) à write_file pour les petites modifications, garde le style du code existant.",
          "Nouveau projet ou nouveau dépôt demandé : appelle create_repository (il bascule sur le nouveau dépôt), puis write_files avec TOUS les fichiers du projet, complets et fonctionnels (pas de « ... » ni de morceaux manquants).",
          "Ne commite ou ne synchronise que si l'utilisateur le demande (ou s'il a demandé un nouveau dépôt prêt à l'emploi : dans ce cas commit puis git_sync).",
          "Si une action est refusée, n'insiste pas et propose une alternative.",
          "Après un git_sync, si l'utilisateur veut vérifier le build, appelle ci_status ; en cas d'échec, corrige puis re-synchronise (2 essais maximum).",
          `Quand TOUT est terminé, mets un court résumé des changements suivi de ${END_MARK} dans le MÊME message que tes derniers appels d'outils (n'attends pas un tour de plus). N'écris ${END_MARK} que si rien d'autre n'est à faire.`,
        ].join(" ")
      : "Mode discussion : tu ne peux PAS modifier les fichiers. Explique, analyse, et si l'utilisateur veut des modifications, propose-lui le mode Agent.",
  ].join("\n");
}

const KEY_FILES: { path: string; max: number }[] = [
  { path: "AGENTS.md", max: 3000 },
  { path: "CLAUDE.md", max: 2000 },
  { path: "README.md", max: 1500 },
  { path: "package.json", max: 2000 },
  { path: "app/build.gradle.kts", max: 1500 },
  { path: "app/build.gradle", max: 1500 },
  { path: "pubspec.yaml", max: 1200 },
  { path: "requirements.txt", max: 800 },
];

const STOP = new Set(["dans", "pour", "avec", "cette", "mettre", "faire", "fichier", "fichiers", "modifie", "modifier", "ajoute", "ajouter", "crée", "créer", "corrige", "corriger", "the", "that", "with", "from", "file", "files", "make", "please", "dépôt", "projet"]);

/** Fichiers dont le NOM contient des mots de la demande (au plus 3) : lus d'avance pour éviter un appel. */
async function relevantFiles(dir: string, files: string[], request: string, skip: Set<string>): Promise<string[]> {
  const words = [...new Set((request.toLowerCase().match(/[a-zà-ÿ0-9_]{4,}/g) ?? []).filter((w) => !STOP.has(w)))];
  if (!words.length) return [];
  const scored = files
    .filter((f) => !skip.has(f) && !isSensitivePath(f))
    .map((f) => ({ f, score: words.filter((w) => f.toLowerCase().includes(w)).length }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || x.f.length - y.f.length)
    .slice(0, 6);
  const out: string[] = [];
  for (const { f } of scored) {
    if (out.length >= 3) break;
    const text = await readTextFile(dir, f).catch(() => null);
    if (text && text.length < 20000) out.push(`--- ${f} (probablement concerné)\n${text.length > 3500 ? `${text.slice(0, 3500)}\n…` : text}`);
  }
  return out;
}

/**
 * Contexte fourni d'emblée au modèle (arborescence + fichiers clés + fichiers
 * liés à la demande + statut) : évite 2 à 5 appels d'exploration, précieux sur
 * un quota gratuit.
 */
export async function buildContext(dir: string, request = ""): Promise<string> {
  const files: string[] = [];
  await walk(dir, "", files, 1500);
  files.sort();
  const parts: string[] = [];
  if (!files.length) {
    parts.push("Arborescence : (dépôt VIDE)");
  } else if (files.length <= 250) {
    const tree = files.join("\n");
    parts.push(`Arborescence (${files.length} fichiers) :\n${tree.length > 7000 ? `${tree.slice(0, 7000)}\n…` : tree}`);
  } else {
    parts.push(`Gros dépôt (${files.length}${files.length >= 1500 ? "+" : ""} fichiers) :\n${summarizeTree(files)}`);
  }
  const shown = new Set<string>();
  for (const k of KEY_FILES) {
    if (!files.includes(k.path) || isSensitivePath(k.path)) continue;
    const text = await readTextFile(dir, k.path).catch(() => null);
    if (text) {
      shown.add(k.path);
      parts.push(`--- ${k.path}\n${text.length > k.max ? `${text.slice(0, k.max)}\n…` : text}`);
    }
  }
  try {
    const info = await detectProject(dir);
    const wfs = files.filter((f) => f.startsWith(`${WORKFLOW_DIR}/`));
    parts.push(`Projet détecté : ${info.kind ?? "inconnu"} · workflows GitHub Actions : ${wfs.length ? wfs.join(", ") : "aucun"}`);
  } catch {
    /* détection facultative */
  }
  if (request) parts.push(...(await relevantFiles(dir, files, request, shown)));
  try {
    const st = await engine.getStatus(dir);
    const branch = await engine.currentBranch(dir);
    parts.push(`Branche : ${branch ?? "?"} · ${st.length ? `${st.length} fichier(s) modifié(s) non commités : ${st.slice(0, 15).map((x) => x.path).join(", ")}` : "aucune modification en cours"}`);
  } catch {
    /* dépôt sans commit : statut indisponible */
  }
  return forModel(parts.join("\n\n"));
}

export type AgentEvent =
  | { type: "assistant"; text: string }
  | { type: "tool"; call: ToolCall; status: "running" | "done" | "refused" | "error"; output?: string }
  | { type: "wait"; seconds: number }
  | { type: "notice"; key: string }
  | { type: "limit"; steps: number };

/** Allège l'historique ENVOYÉ : les vieux résultats d'outils volumineux sont tronqués (le stock reste intact). */
export function compact(msgs: AiMsg[], keepRecent = 3): AiMsg[] {
  const toolIdx = msgs.map((m, i) => (m.role === "tool" ? i : -1)).filter((i) => i >= 0);
  const old = new Set(toolIdx.slice(0, Math.max(0, toolIdx.length - keepRecent)));
  if (!old.size) return msgs;
  return msgs.map((m, i) =>
    m.role === "tool" && old.has(i)
      ? { ...m, results: m.results.map((r) => (r.output.length > 1500 ? { ...r, output: `${r.output.slice(0, 700)}\n…[ancien résultat tronqué : relis le fichier si besoin]` } : r)) }
      : m
  );
}

/**
 * Boucle d'agent : appelle le modèle, exécute les outils demandés (avec
 * validation éventuelle) et renvoie les résultats jusqu'à la réponse finale.
 * `approve` peut répondre « all » pour valider tout le reste de la demande.
 */
export async function runAgent(opts: {
  settings: AiSettings;
  mode: "chat" | "agent";
  system: string;
  history: AiMsg[];
  ctx: RepoToolCtx;
  approve: (call: ToolCall, preview: Preview) => Promise<boolean | "all">;
  onEvent: (e: AgentEvent) => void;
  signal?: AbortSignal;
  maxSteps?: number;
  /** Outils interdits pour cette exécution (ex. commit / synchro pilotés par le code). */
  excludeTools?: string[];
}): Promise<AiMsg[]> {
  opts.ctx.signal = opts.signal;
  const tools = toolsFor(opts.mode).filter((t) => !opts.excludeTools?.includes(t.name));
  const defs: ToolDef[] = tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
  // Les messages utilisateur (contexte, journaux de build…) passent aussi par le masquage des secrets.
  const msgs: AiMsg[] = opts.history.map((m) => (m.role === "user" ? { ...m, text: forModel(m.text) } : m));
  const free = opts.settings.freeTier;
  const maxSteps = opts.maxSteps ?? (free ? 8 : 25);
  // Budget de l'historique envoyé : évite les dépassements de contexte (erreur 400) et réduit le coût.
  const keepRecent = free ? 3 : 8;
  const maxChars = free ? 120000 : 400000;
  let approveAll = opts.settings.autoApprove;
  let finished = false;

  try {
    for (let step = 0; step < maxSteps; step++) {
      if (opts.signal?.aborted) {
        finished = true;
        break;
      }
      const res = await chat(opts.settings, opts.system, fitHistory(msgs, keepRecent, maxChars), defs, opts.signal, {
        onWait: (seconds) => opts.onEvent({ type: "wait", seconds }),
      });
      const done = res.text.includes(END_MARK);
      const text = res.text.split(END_MARK).join("").trim();
      msgs.push({ role: "assistant", text, calls: res.calls, raw: res.raw, provider: opts.settings.provider });
      if (text) opts.onEvent({ type: "assistant", text });
      if (res.truncated) {
        // Réponse coupée par la limite de sortie : on demande de recommencer en plus petit.
        opts.onEvent({ type: "notice", key: "ai.truncated" });
        msgs.push({
          role: "user",
          text: "Ta réponse précédente a été COUPÉE (trop longue) et aucune action n'a été exécutée. Recommence en écrivant 2 à 4 fichiers par appel au maximum (un fichier volumineux seul), et continue là où tu t'étais arrêté.",
        });
        continue;
      }
      if (!res.calls.length) {
        finished = true;
        break;
      }

      const results: { id: string; name: string; output: string }[] = [];
      let allOk = true;
      for (const call of res.calls) {
        const tool = tools.find((t) => t.name === call.name);
        if (!tool) {
          allOk = false;
          results.push({ id: call.id, name: call.name, output: `ERREUR : outil inconnu ${call.name}` });
          continue;
        }
        if (tool.mutating && tool.noop) {
          const skipped = await tool.noop(opts.ctx, call.args).catch(() => null);
          if (skipped) {
            opts.onEvent({ type: "tool", call, status: "done", output: skipped });
            results.push({ id: call.id, name: call.name, output: skipped });
            continue;
          }
        }
        if (tool.mutating && !approveAll) {
          const preview = tool.preview ? await tool.preview(opts.ctx, call.args).catch((e) => ({ title: call.name, detail: String(e?.message ?? e) })) : { title: call.name };
          const ok = await opts.approve(call, preview);
          if (ok === "all") approveAll = true;
          if (!ok) {
            allOk = false;
            opts.onEvent({ type: "tool", call, status: "refused" });
            results.push({ id: call.id, name: call.name, output: "REFUSÉ par l'utilisateur." });
            continue;
          }
        }
        opts.onEvent({ type: "tool", call, status: "running" });
        try {
          const output = forModel(await tool.run(opts.ctx, call.args));
          const failed = output.startsWith("ERREUR");
          if (failed) allOk = false;
          opts.onEvent({ type: "tool", call, status: failed ? "error" : "done", output });
          results.push({ id: call.id, name: call.name, output });
        } catch (e: any) {
          allOk = false;
          const output = forModel(`ERREUR : ${e?.message ?? e}`);
          opts.onEvent({ type: "tool", call, status: "error", output });
          results.push({ id: call.id, name: call.name, output });
        }
      }
      msgs.push({ role: "tool", results });
      // Le modèle a annoncé la fin dans ce même tour et tout a réussi : pas d'appel de plus.
      if (done && allOk) {
        // On referme proprement l'historique (un tour assistant après les résultats d'outils).
        msgs.push({ role: "assistant", text: text || "OK", calls: [], raw: undefined, provider: opts.settings.provider });
        finished = true;
        break;
      }
    }
  } catch (e: any) {
    // Erreur ou arrêt en cours de route : on garde ce qui a déjà été fait (fichiers modifiés,
    // résultats d'outils) pour que le modèle ne refasse pas tout au prochain message.
    if (e && typeof e === "object") e.history = closeHistory(msgs, opts.settings.provider);
    throw e;
  }
  if (!finished) opts.onEvent({ type: "limit", steps: maxSteps });
  return msgs;
}

/** Historique valide après une interruption : jamais d'appel d'outil sans résultat. */
export function closeHistory(msgs: AiMsg[], provider: AiProvider): AiMsg[] {
  const out = [...msgs];
  const last = out[out.length - 1];
  if (last?.role === "assistant" && last.calls.length) out.pop();
  const tail = out[out.length - 1];
  if (tail?.role === "tool") out.push({ role: "assistant", text: "(interrompu)", calls: [], raw: undefined, provider });
  return out;
}

// ─── Tâches ponctuelles ───────────────────────────────────────────────────────

/**
 * Extrait le contenu entre la PREMIÈRE et la DERNIÈRE clôture ``` (les blocs
 * de code internes, ex. dans un README, sont conservés). Texte brut sinon.
 */
export function stripFences(text: string): string {
  const t = text.trim();
  const start = t.indexOf("```");
  if (start === -1) return text;
  const firstNl = t.indexOf("\n", start);
  const end = t.lastIndexOf("```");
  if (firstNl === -1 || end <= firstNl) return text;
  return t.slice(firstNl + 1, end).replace(/\n$/, "");
}
