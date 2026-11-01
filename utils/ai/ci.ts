/**
 * Suivi des builds GitHub Actions d'un dépôt : attend le run du commit courant,
 * puis, en cas d'échec, en extrait les étapes fautives et des extraits d'erreurs.
 * Aucun appel au modèle IA ici (juste l'API GitHub).
 */
import * as engine from "@/utils/git/engine";
import { pathExists } from "@/utils/git/fs";
import { credsFor, getContainer } from "@/utils/git/store";

import { lintAllWorkflows, WORKFLOW_DIR } from "./workflows";

export interface CiTarget {
  dir: string;
  containerId: string;
  signal?: AbortSignal;
}

export interface CiResult {
  state: "success" | "failure" | "pending" | "none" | "error";
  /** Résumé lisible (pour l'IA et pour l'utilisateur). */
  text: string;
  /** Extraits d'erreurs des journaux (sert à repérer les fichiers fautifs et à détecter une erreur qui se répète). */
  log: string;
  /** Le run a échoué sans lancer aucun job : fichier workflow invalide. */
  noJobs: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function ghRepoOf(url: string): { owner: string; repo: string } | null {
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? { owner: m[1], repo: m[2] } : null;
}

async function ghGet(token: string, path: string): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
}

const res = (state: CiResult["state"], text: string, log = "", noJobs = false): CiResult => ({ state, text, log, noJobs });

/**
 * Résultat du build du commit courant. Avec `wait`, attend la fin (max ~2 min 30).
 * `onTick` reçoit un court statut à chaque interrogation.
 */
export async function ciCheck(t: CiTarget, wait: boolean, onTick?: (s: string) => void): Promise<CiResult> {
  const c = await getContainer(t.containerId);
  const gh = c ? ghRepoOf(c.url) : null;
  if (!c || !gh) return res("error", "ERREUR : ce dépôt n'est pas un dépôt GitHub distant.");
  const token = (await credsFor(c))?.password;
  if (!token) return res("error", "ERREUR : pas de token GitHub pour ce dépôt.");
  if (!(await pathExists(`${t.dir}/${WORKFLOW_DIR}`))) {
    return res("none", "Aucun workflow dans le dépôt (.github/workflows absent) : utilise create_workflow pour en créer un.");
  }

  const head = await engine.resolveOrNull(t.dir, "HEAD");
  const branch = await engine.currentBranch(t.dir);
  const base = `/repos/${gh.owner}/${gh.repo}`;
  const deadline = Date.now() + 150000;
  let mine: any[] = [];
  for (;;) {
    if (t.signal?.aborted) return res("error", "Interrompu.");
    const r = await ghGet(token, `${base}/actions/runs?per_page=10${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`);
    if (!r.ok) return res("error", `ERREUR : GitHub HTTP ${r.status} (le token doit avoir accès à « Actions »).`);
    const runs: any[] = ((await r.json()) as any).workflow_runs ?? [];
    mine = runs.filter((x) => !head || x.head_sha === head);
    const pending = mine.some((x) => x.status !== "completed");
    onTick?.(mine.length ? (pending ? "running" : "done") : "queued");
    if ((!mine.length || pending) && wait && Date.now() < deadline) {
      await sleep(mine.length ? 10000 : 8000);
      continue;
    }
    if (!mine.length) {
      return res("none", `Aucun build GitHub Actions pour le commit ${head?.slice(0, 7) ?? "?"} : le workflow ne se déclenche pas sur cette branche (vérifie \`on:\`), ou il n'est pas encore parti.`);
    }
    if (pending) return res("pending", `Build encore en cours après l'attente : ${mine.map((x) => `${x.name} (${x.status})`).join(", ")}`);
    break;
  }

  const lines = mine.map((x) => `${x.name} : ${x.conclusion} — ${x.html_url}`);
  const failed = mine.find((x) => ["failure", "timed_out", "startup_failure", "action_required"].includes(x.conclusion));
  if (!failed) return res("success", lines.join("\n"));

  let detail = "";
  let log = "";
  let noJobs = false;
  try {
    const jr = await ghGet(token, `${base}/actions/runs/${failed.id}/jobs`);
    const jobs: any[] = ((await jr.json()) as any).jobs ?? [];
    if (!jobs.length) {
      noJobs = true;
      const issues = await lintAllWorkflows(t.dir).catch(() => []);
      detail = `\nAucun job n'a démarré : le fichier workflow est invalide (syntaxe ou clé inconnue).${issues.length ? `\nProblèmes trouvés localement :\n${issues.slice(0, 8).join("\n")}` : ""}`;
      log = `workflow invalide ${failed.name} ${issues.join(" ")}`;
    }
    for (const j of jobs.filter((x) => x.conclusion === "failure").slice(0, 2)) {
      const steps = (j.steps ?? []).filter((x: any) => x.conclusion === "failure").map((x: any) => x.name).join(", ");
      detail += `\nJob « ${j.name} » en échec${steps ? ` à l'étape : ${steps}` : ""}`;
      try {
        const lr = await ghGet(token, `${base}/actions/jobs/${j.id}/logs`);
        if (lr.ok) {
          const all = (await lr.text()).split("\n").map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, ""));
          const errs = all.filter((l) => /error|failed|exception|cannot|not found|FAILURE|unresolved|invalid/i.test(l)).slice(-40);
          const pick = (errs.length ? errs : all.slice(-40)).join("\n").slice(-3500);
          detail += `\n${pick}`;
          log += `\n${pick}`;
        }
      } catch {
        /* journaux indisponibles : on garde le nom de l'étape */
      }
    }
  } catch {
    /* détail indisponible */
  }
  return res("failure", `${lines.join("\n")}${detail}`, log, noJobs);
}
