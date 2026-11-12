/**
 * Autocorrection du build : pousse le code, attend le résultat de GitHub Actions
 * et, en cas d'échec, demande UNE correction à l'IA à partir des erreurs et des
 * fichiers concernés (déjà fournis), puis recommence. Le commit, le push et
 * l'attente sont faits par le code (aucun appel IA) pour économiser le quota.
 */
import * as engine from "@/utils/git/engine";
import { decodeUtf8, pathExists, readBytes } from "@/utils/git/fs";
import { getContainer } from "@/utils/git/store";
import { syncContainer } from "@/utils/git/sync";

import { runAgent, systemPrompt, type AgentEvent, type Preview, type RepoToolCtx } from "./agent";
import { ciCheck, type CiResult } from "./ci";
import type { AiMsg, ToolCall } from "./providers";
import type { AiSettings } from "./settings";
import { isSensitivePath, pathCandidates, signature } from "./pure";
import { lintChangedWorkflows, workflowFiles, workflowScopeHint } from "./workflows";
import { autoStagePaths } from "@/utils/git/securityPure";

export const CI_MAX_ATTEMPTS = 3;

export type CiEvent =
  | AgentEvent
  | { type: "ci"; key: string; vars?: Record<string, string | number> };

export interface AutoFixResult {
  ok: boolean;
  attempts: number;
  history: AiMsg[];
  /** Clé de texte (i18n) expliquant l'arrêt. */
  reason: string;
}

/** Chemins de fichiers cités dans les erreurs et présents dans le dépôt (4 au plus). */
async function failingFiles(dir: string, log: string, noJobs: boolean): Promise<string[]> {
  const found: string[] = [];
  for (const p of pathCandidates(log)) {
    if (p.includes("node_modules") || p.startsWith("..") || found.includes(p)) continue;
    if (await pathExists(`${dir}/${p}`)) found.push(p);
    if (found.length >= 4) break;
  }
  if (noJobs || found.length === 0) {
    for (const w of await workflowFiles(dir)) if (!found.includes(w) && found.length < 5) found.push(w);
  }
  return found;
}

async function readFor(dir: string, paths: string[]): Promise<string> {
  const out: string[] = [];
  for (const p of paths) {
    if (isSensitivePath(p)) continue; // clés / mots de passe : jamais envoyés à l'IA
    const b = await readBytes(`${dir}/${p}`).catch(() => null);
    if (!b || b.length > 40000) continue;
    const text = decodeUtf8(b);
    out.push(`--- ${p}\n${text.length > 5000 ? `${text.slice(0, 5000)}\n…[tronqué]` : text}`);
  }
  return out.join("\n\n");
}

const FIX_RULES = [
  "MODE AUTO-CORRECTION DU BUILD. Le build GitHub Actions a échoué. Corrige la CAUSE RACINE avec le minimum de modifications (edit_file), en t'appuyant sur le rapport et les fichiers fournis ci-dessous.",
  "N'appelle NI git_commit, NI git_sync, NI ci_status : le commit, le push et la vérification sont faits automatiquement après tes modifications.",
  "Si l'erreur vient d'un fichier workflow (.github/workflows), corrige le YAML (indentation, clés valides, versions d'actions existantes) ; valide-le avec validate_workflow.",
  "Si la cause est externe et non corrigeable dans le code (secret manquant, réseau, quota, panne GitHub), n'invente aucune modification : explique-le brièvement.",
  "Réponds en un seul tour si possible : tes edit_file + un court résumé suivi de [[FIN]] dans le même message.",
].join("\n");

export async function autoFixBuild(o: {
  settings: AiSettings;
  lang: string;
  repoName: string;
  ctx: RepoToolCtx;
  history: AiMsg[];
  approve: (call: ToolCall, preview: Preview) => Promise<boolean | "all">;
  onEvent: (e: CiEvent) => void;
  signal?: AbortSignal;
  maxAttempts?: number;
}): Promise<AutoFixResult> {
  const max = o.maxAttempts ?? CI_MAX_ATTEMPTS;
  const ctx = o.ctx;
  ctx.signal = o.signal;
  let history = o.history;
  let lastSig = "";
  const say = (key: string, vars?: Record<string, string | number>) => o.onEvent({ type: "ci", key, vars });
  const stop = (ok: boolean, attempts: number, reason: string): AutoFixResult => ({ ok, attempts, history, reason });
  // L'utilisateur peut valider « tout » une fois pour toute la boucle.
  let approveAll = false;
  const approve = async (call: ToolCall, pv: Preview) => {
    if (approveAll || o.settings.autoApprove) return true;
    const r = await o.approve(call, pv);
    if (r === "all") approveAll = true;
    return r;
  };

  const c0 = await getContainer(ctx.containerId);
  if (!c0?.url) return stop(false, 0, "ci.local");

  for (let attempt = 1; attempt <= max; attempt++) {
    if (o.signal?.aborted) return stop(false, attempt - 1, "ci.aborted");

    // 1) Commit éventuel + push (sans IA)
    const bad = await lintChangedWorkflows(ctx.dir).catch(() => []);
    if (bad.length && attempt === 1) {
      // Workflow invalide AVANT même de pousser : on le corrige d'abord (c'est la cause du prochain échec).
      history = await fixWith(`Les workflows suivants sont INVALIDES (GitHub refuserait de les lancer) :\n${bad.join("\n")}`, bad.join("\n"), true);
      if (!ctx.undo?.length) return stop(false, attempt, "ci.noChange");
    }
    say("ci.pushing", { n: attempt, max });
    try {
      const st = await engine.getStatus(ctx.dir);
      if (st.length) {
        const prevOid = await engine.resolveOrNull(ctx.dir, "HEAD");
        await engine.stagePaths(ctx.dir, autoStagePaths(st).stage); // fichiers sensibles non suivis exclus (AUDIT-006)
        await engine.commitStaged(await ctx.gitCtx(), attempt === 1 ? "chore(ci): préparation du build" : `fix(ci): correction automatique du build (essai ${attempt})`);
        const branch = await engine.currentBranch(ctx.dir);
        if (branch) ctx.undo?.push({ kind: "commit", dir: ctx.dir, branch, prevOid });
      }
      const sum = await syncContainer(ctx.containerId, "manual");
      if (sum.pulled === "conflict") return stop(false, attempt, "ci.conflict");
      if (sum.pushed && ctx.undo) ctx.undo.length = 0; // après un push, plus d'annulation locale possible
    } catch (e: any) {
      const hint = workflowScopeHint(e);
      if (hint) {
        say("ci.scope");
        return stop(false, attempt, "ci.scopeStop");
      }
      throw e;
    }

    // 2) Attente du build (sans IA)
    say("ci.waiting", { n: attempt, max });
    const r: CiResult = await ciCheck(ctx, true);
    if (r.state === "success") {
      return stop(true, attempt, "ci.success");
    }
    if (r.state === "none") return stop(false, attempt, "ci.noRun");
    if (r.state === "pending") return stop(false, attempt, "ci.timeout");
    if (r.state === "error") {
      say("ci.error", { msg: r.text.slice(0, 200) });
      return stop(false, attempt, "ci.errorStop");
    }
    if (attempt === max) {
      return stop(false, attempt, "ci.max");
    }

    // 3) Même erreur qu'à l'essai précédent : la correction n'a rien changé
    const sig = signature(r.log || r.text);
    if (sig && sig === lastSig) return stop(false, attempt, "ci.same");
    lastSig = sig;

    // 4) UNE correction par l'IA, avec les fichiers fautifs déjà fournis
    say("ci.fixing", { n: attempt, max });
    const before = ctx.undo?.length ?? 0;
    history = await fixWith(`Le build a échoué (essai ${attempt}/${max}).\n\nRAPPORT :\n${r.text}`, r.log || r.text, r.noJobs);
    if ((ctx.undo?.length ?? 0) === before) return stop(false, attempt, "ci.noChange");
  }
  return stop(false, max, "ci.max");

  /** Une demande à l'IA : rapport + contenu des fichiers cités, outils de commit/synchro retirés. */
  async function fixWith(report: string, log: string, noJobs: boolean): Promise<AiMsg[]> {
    const files = await readFor(ctx.dir, await failingFiles(ctx.dir, log, noJobs));
    const text = `${report}\n\nFICHIERS CONCERNÉS :\n${files || "(aucun fichier identifié : utilise find_files / search)"}`;
    const last = history[history.length - 1];
    const base = last?.role === "user" ? history.slice(0, -1) : history;
    return runAgent({
      settings: o.settings,
      mode: "agent",
      system: `${systemPrompt("agent", o.repoName, o.lang, o.settings.freeTier)}\n\n${FIX_RULES}`,
      history: [...base, { role: "user", text }],
      ctx,
      approve,
      onEvent: o.onEvent,
      signal: o.signal,
      maxSteps: o.settings.freeTier ? 5 : 12,
      excludeTools: ["git_commit", "git_sync", "ci_status", "create_repository"],
    });
  }
}

