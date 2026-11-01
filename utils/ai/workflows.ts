/**
 * Workflows GitHub Actions : détection du type de projet, modèles prêts à
 * l'emploi (aucun appel IA nécessaire) et vérification locale du YAML AVANT
 * le push (un workflow invalide échoue sans même démarrer, et chaque essai
 * coûte du temps et du quota).
 */
import { parseDocument } from "yaml";

import * as engine from "@/utils/git/engine";
import { decodeUtf8, listEntries, pathExists, readBytes } from "@/utils/git/fs";

import { TEMPLATE_FOR, workflowTemplate, type ProjectInfo, type ProjectKind, type WorkflowTemplate } from "./pure";

export { TEMPLATE_FOR, workflowTemplate };
export type { ProjectInfo, ProjectKind, WorkflowTemplate };

export const WORKFLOW_DIR = ".github/workflows";
export const isWorkflowPath = (p: string) => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(p);

async function readJson(dir: string, p: string): Promise<any | null> {
  const b = await readBytes(`${dir}/${p}`).catch(() => null);
  if (!b) return null;
  try {
    return JSON.parse(decodeUtf8(b));
  } catch {
    return null;
  }
}

/** Devine le type de projet à partir de ses fichiers de configuration. */
export async function detectProject(dir: string): Promise<ProjectInfo> {
  const has = (p: string) => pathExists(`${dir}/${p}`);
  const pkg = await readJson(dir, "package.json");
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const info: ProjectInfo = {
    kind: null,
    hasGradlew: await has("gradlew"),
    hasLockfile: (await has("package-lock.json")) || (await has("npm-shrinkwrap.json")),
  };
  const gradle = (await has("settings.gradle.kts")) || (await has("settings.gradle")) || (await has("build.gradle.kts")) || (await has("build.gradle"));
  if (pkg && (deps.expo || (await has("app.json")) || (await has("app.config.js")) || (await has("app.config.ts")))) info.kind = "expo";
  else if (gradle) info.kind = "android";
  else if (pkg) info.kind = "node";
  return info;
}

/** Vérifie un workflow : syntaxe YAML et structure minimale attendue par GitHub Actions. */
export function lintWorkflow(text: string): string[] {
  const issues: string[] = [];
  if (!text.trim()) return ["fichier vide"];
  if (/^ *\t/m.test(text)) issues.push("tabulation dans l'indentation (YAML n'accepte que des espaces)");
  const doc = parseDocument(text);
  for (const e of doc.errors) issues.push(`YAML ligne ${e.linePos?.[0]?.line ?? "?"} : ${String(e.message).split("\n")[0]}`);
  if (doc.errors.length) return issues;
  const js: any = doc.toJS();
  if (!js || typeof js !== "object" || Array.isArray(js)) return [...issues, "le fichier doit être un objet YAML (name / on / jobs)"];
  if (js.on === undefined && js[true as any] === undefined) issues.push("clé `on` (déclencheurs) manquante");
  const jobs = js.jobs;
  if (!jobs || typeof jobs !== "object" || Array.isArray(jobs) || !Object.keys(jobs).length) {
    issues.push("clé `jobs` manquante ou vide");
    return issues;
  }
  for (const [id, job] of Object.entries<any>(jobs)) {
    if (!job || typeof job !== "object") {
      issues.push(`job « ${id} » invalide`);
      continue;
    }
    if (job.uses) continue; // workflow réutilisable
    if (!job["runs-on"]) issues.push(`job « ${id} » : \`runs-on\` manquant`);
    if (!Array.isArray(job.steps) || !job.steps.length) {
      issues.push(`job « ${id} » : \`steps\` manquant ou vide`);
      continue;
    }
    const needs: string[] = ([] as string[]).concat(job.needs ?? []);
    for (const n of needs) if (!(n in jobs)) issues.push(`job « ${id} » : \`needs\` référence « ${n} » qui n'existe pas`);
    job.steps.forEach((st: any, i: number) => {
      const label = `job « ${id} », étape ${i + 1}`;
      if (!st || typeof st !== "object") return void issues.push(`${label} : étape invalide`);
      if (!st.uses && !st.run) issues.push(`${label} : il faut \`uses\` ou \`run\``);
      if (st.uses && st.run) issues.push(`${label} : \`uses\` et \`run\` ensemble sont interdits`);
      if (typeof st.uses === "string" && !st.uses.startsWith("./") && !st.uses.startsWith("docker://") && !st.uses.includes("@")) {
        issues.push(`${label} : \`uses: ${st.uses}\` sans version (ajoute @vX)`);
      }
    });
  }
  text.split("\n").forEach((line, i) => {
    const open = (line.match(/\$\{\{/g) ?? []).length;
    const close = (line.match(/\}\}/g) ?? []).length;
    if (open > close) issues.push(`ligne ${i + 1} : expression \${{ non fermée`);
  });
  return issues;
}

/** Texte d'avertissement à ajouter au résultat d'un outil si le fichier écrit est un workflow invalide. */
export function workflowNote(path: string, text: string): string {
  if (!isWorkflowPath(path)) return "";
  const issues = lintWorkflow(text);
  return issues.length ? `\n⚠ Workflow INVALIDE (${path}) : ${issues.join(" ; ")}. Corrige avant de synchroniser.` : "";
}

async function workflowFiles(dir: string): Promise<string[]> {
  if (!(await pathExists(`${dir}/${WORKFLOW_DIR}`))) return [];
  const list = await listEntries(`${dir}/${WORKFLOW_DIR}`);
  return list.filter((e) => !e.isDir && /\.ya?ml$/i.test(e.name)).map((e) => `${WORKFLOW_DIR}/${e.name}`);
}

async function lintFiles(dir: string, paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    const b = await readBytes(`${dir}/${p}`).catch(() => null);
    if (!b) continue;
    for (const issue of lintWorkflow(decodeUtf8(b))) out.push(`${p} : ${issue}`);
  }
  return out;
}

/** Problèmes dans les workflows MODIFIÉS localement (à vérifier avant un push). */
export async function lintChangedWorkflows(dir: string): Promise<string[]> {
  const st = await engine.getStatus(dir).catch(() => []);
  return lintFiles(dir, st.filter((s) => s.kind !== "deleted" && isWorkflowPath(s.path)).map((s) => s.path));
}

/** Problèmes dans TOUS les workflows du dépôt. */
export async function lintAllWorkflows(dir: string): Promise<string[]> {
  return lintFiles(dir, await workflowFiles(dir));
}

export { workflowFiles };

/** Message d'aide si GitHub refuse un push de workflow faute du bon droit du token. */
export function workflowScopeHint(e: any): string | null {
  const m = String(e?.message ?? e);
  if (/workflow/i.test(m) && /(scope|permission|refus)/i.test(m)) {
    return "GitHub refuse le push d'un fichier .github/workflows : le token doit avoir le scope « workflow » (token classique) ou « Workflows : Read and write » (fine-grained). Reconnecte-toi avec un token qui a ce droit.";
  }
  return null;
}
