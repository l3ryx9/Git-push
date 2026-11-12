/**
 * Accès unifié aux API GitHub et GitLab :
 * issues, pull requests / merge requests, commentaires, fichiers modifiés,
 * exécutions GitHub Actions.
 */

import { getGitHubToken } from "@/utils/secrets";
import { accessToken, findAccountForUrl, getAccount, hostOfUrl, type Account } from "./accounts";

export type Provider = "github" | "gitlab";
export type Kind = "issues" | "pulls";
export type State = "open" | "closed" | "all";

export interface ForgeRef {
  provider: Provider;
  project: string; // owner/repo ou groupe/sous-groupe/projet
  accountId?: string;
}

export interface Item {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  author: string;
  createdAt: string;
  comments: number;
  labels: string[];
  url: string;
  draft?: boolean;
}

export interface ItemDetail extends Item {
  body: string;
  head?: string;
  base?: string;
  mergeable?: string;
}

export interface Comment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface FileChange {
  path: string;
  status: string;
  additions?: number;
  deletions?: number;
  patch?: string;
}

export interface Run {
  id: number;
  title: string;
  workflow: string;
  branch: string;
  event: string;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | skipped…
  number: number;
  createdAt: string;
  actor: string;
  url: string;
}

export interface Job {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt?: string;
  completedAt?: string;
  steps: { name: string; status: string; conclusion: string | null; number: number }[];
}

function forgeError(status: number, message: string) {
  const e = new Error(message) as Error & { code: string; data: { statusCode: number } };
  e.code = "ForgeHttpError";
  e.data = { statusCode: status };
  return e;
}

/** Déduit la forge à partir de l'URL d'un dépôt (github.com ou compte GitLab connu). */
export async function forgeFromUrl(url: string, accountId?: string): Promise<ForgeRef | null> {
  const m = /^https?:\/\/(?:[^@/]+@)?[^/]+\/(.+?)(?:\.git)?\/?$/i.exec(url.trim());
  if (!m) return null;
  const project = m[1];
  if (hostOfUrl(url) === "github.com") return { provider: "github", project };
  const acc = (accountId ? await getAccount(accountId) : undefined) ?? (await findAccountForUrl(url));
  if (acc && acc.kind === "gitlab" && hostOfUrl(acc.baseUrl) === hostOfUrl(url)) return { provider: "gitlab", project, accountId: acc.id };
  return null;
}

async function target(ref: ForgeRef): Promise<{ base: string; headers: Record<string, string>; acc?: Account }> {
  if (ref.provider === "github") {
    const tok = await getGitHubToken();
    return {
      base: `https://api.github.com/repos/${ref.project}`,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
      },
    };
  }
  const acc = await getAccount(ref.accountId);
  if (!acc) throw forgeError(401, "GitLab account missing");
  const tok = await accessToken(acc);
  return {
    base: `${acc.baseUrl}/api/v4/projects/${encodeURIComponent(ref.project)}`,
    headers: { Accept: "application/json", Authorization: `Bearer ${tok}` },
    acc,
  };
}

async function call<T = any>(ref: ForgeRef, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const t = await target(ref);
  const res = await fetch(t.base + path, {
    method: init?.method ?? "GET",
    headers: { ...t.headers, ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: any = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    /* texte brut */
  }
  if (!res.ok) {
    const msg = json?.message ? (typeof json.message === "string" ? json.message : JSON.stringify(json.message)) : json?.error ?? text.slice(0, 200);
    throw forgeError(res.status, `HTTP ${res.status} — ${msg}`);
  }
  return json as T;
}

// ─── Conversion ───────────────────────────────────────────────────────────────

function ghItem(x: any): Item {
  return {
    number: x.number,
    title: x.title,
    state: x.merged_at ? "merged" : x.state === "open" ? "open" : "closed",
    author: x.user?.login ?? "?",
    createdAt: x.created_at,
    comments: x.comments ?? 0,
    labels: (x.labels ?? []).map((l: any) => (typeof l === "string" ? l : l.name)),
    url: x.html_url,
    draft: !!x.draft,
  };
}

function glItem(x: any): Item {
  return {
    number: x.iid,
    title: x.title,
    state: x.state === "merged" ? "merged" : x.state === "opened" ? "open" : "closed",
    author: x.author?.username ?? "?",
    createdAt: x.created_at,
    comments: x.user_notes_count ?? 0,
    labels: x.labels ?? [],
    url: x.web_url,
    draft: !!(x.draft ?? x.work_in_progress),
  };
}

const glKind = (k: Kind) => (k === "issues" ? "issues" : "merge_requests");
const glState = (s: State) => (s === "open" ? "opened" : s === "closed" ? "closed" : "all");

// ─── Issues / PR ──────────────────────────────────────────────────────────────

export async function listItems(ref: ForgeRef, kind: Kind, state: State, page: number): Promise<Item[]> {
  if (ref.provider === "github") {
    if (kind === "pulls") {
      const list = await call<any[]>(ref, `/pulls?state=${state}&per_page=30&page=${page}&sort=updated&direction=desc`);
      return list.map(ghItem);
    }
    const list = await call<any[]>(ref, `/issues?state=${state}&per_page=30&page=${page}&sort=updated`);
    return list.filter((x) => !x.pull_request).map(ghItem);
  }
  const list = await call<any[]>(ref, `/${glKind(kind)}?state=${glState(state)}&per_page=30&page=${page}&order_by=updated_at`);
  return list.map(glItem);
}

export async function getItem(ref: ForgeRef, kind: Kind, n: number): Promise<ItemDetail> {
  if (ref.provider === "github") {
    const x = await call(ref, kind === "pulls" ? `/pulls/${n}` : `/issues/${n}`);
    return {
      ...ghItem(x),
      body: x.body ?? "",
      head: x.head?.ref,
      base: x.base?.ref,
      mergeable: kind === "pulls" ? (x.merged ? "merged" : x.mergeable === false ? "conflict" : x.mergeable ? "clean" : "unknown") : undefined,
    };
  }
  const x = await call(ref, `/${glKind(kind)}/${n}`);
  return {
    ...glItem(x),
    body: x.description ?? "",
    head: x.source_branch,
    base: x.target_branch,
    mergeable: kind === "pulls" ? (x.state === "merged" ? "merged" : x.has_conflicts ? "conflict" : x.merge_status === "can_be_merged" ? "clean" : "unknown") : undefined,
  };
}

export async function listComments(ref: ForgeRef, kind: Kind, n: number): Promise<Comment[]> {
  if (ref.provider === "github") {
    const list = await call<any[]>(ref, `/issues/${n}/comments?per_page=100`);
    return list.map((c) => ({ id: String(c.id), author: c.user?.login ?? "?", body: c.body ?? "", createdAt: c.created_at }));
  }
  const list = await call<any[]>(ref, `/${glKind(kind)}/${n}/notes?sort=asc&order_by=created_at&per_page=100`);
  return list.filter((c) => !c.system).map((c) => ({ id: String(c.id), author: c.author?.username ?? "?", body: c.body ?? "", createdAt: c.created_at }));
}

export async function addComment(ref: ForgeRef, kind: Kind, n: number, body: string) {
  if (ref.provider === "github") await call(ref, `/issues/${n}/comments`, { method: "POST", body: { body } });
  else await call(ref, `/${glKind(kind)}/${n}/notes`, { method: "POST", body: { body } });
}

export async function setItemState(ref: ForgeRef, kind: Kind, n: number, open: boolean) {
  if (ref.provider === "github") {
    await call(ref, kind === "pulls" ? `/pulls/${n}` : `/issues/${n}`, { method: "PATCH", body: { state: open ? "open" : "closed" } });
  } else {
    await call(ref, `/${glKind(kind)}/${n}`, { method: "PUT", body: { state_event: open ? "reopen" : "close" } });
  }
}

export async function createIssue(ref: ForgeRef, title: string, body: string): Promise<number> {
  if (ref.provider === "github") return (await call(ref, `/issues`, { method: "POST", body: { title, body } })).number;
  return (await call(ref, `/issues`, { method: "POST", body: { title, description: body } })).iid;
}

export async function createPull(ref: ForgeRef, p: { title: string; body: string; head: string; base: string; draft?: boolean }): Promise<number> {
  if (ref.provider === "github") {
    return (await call(ref, `/pulls`, { method: "POST", body: { title: p.title, body: p.body, head: p.head, base: p.base, draft: !!p.draft } })).number;
  }
  return (
    await call(ref, `/merge_requests`, {
      method: "POST",
      body: { title: p.draft ? `Draft: ${p.title}` : p.title, description: p.body, source_branch: p.head, target_branch: p.base },
    })
  ).iid;
}

export async function listBranches(ref: ForgeRef): Promise<{ names: string[]; default?: string }> {
  if (ref.provider === "github") {
    const [list, repo] = await Promise.all([call<any[]>(ref, `/branches?per_page=100`), call(ref, ``)]);
    return { names: list.map((b) => b.name), default: repo?.default_branch };
  }
  const [list, proj] = await Promise.all([call<any[]>(ref, `/repository/branches?per_page=100`), call(ref, ``)]);
  return { names: list.map((b) => b.name), default: proj?.default_branch };
}

export async function listPullFiles(ref: ForgeRef, n: number): Promise<FileChange[]> {
  if (ref.provider === "github") {
    const list = await call<any[]>(ref, `/pulls/${n}/files?per_page=100`);
    return list.map((f) => ({ path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch }));
  }
  const list = await call<any[]>(ref, `/merge_requests/${n}/diffs?per_page=100`);
  return list.map((f) => ({
    path: f.new_path,
    status: f.new_file ? "added" : f.deleted_file ? "removed" : f.renamed_file ? "renamed" : "modified",
    patch: f.diff,
  }));
}

/** Messages des commits entre deux branches (pour rédiger une PR). */
export async function compareCommits(ref: ForgeRef, base: string, head: string): Promise<string[]> {
  if (ref.provider === "github") {
    const j = await call(ref, `/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
    return (j?.commits ?? []).map((c: any) => String(c.commit?.message ?? "").split("\n")[0]);
  }
  const j = await call(ref, `/repository/compare?from=${encodeURIComponent(base)}&to=${encodeURIComponent(head)}`);
  return (j?.commits ?? []).map((c: any) => String(c.title ?? c.message ?? ""));
}

// ─── GitHub Actions ───────────────────────────────────────────────────────────

export async function listRuns(ref: ForgeRef, page: number): Promise<Run[]> {
  const j = await call(ref, `/actions/runs?per_page=30&page=${page}`);
  return (j?.workflow_runs ?? []).map((r: any) => ({
    id: r.id,
    title: r.display_title ?? r.head_commit?.message?.split("\n")[0] ?? r.name,
    workflow: r.name,
    branch: r.head_branch,
    event: r.event,
    status: r.status,
    conclusion: r.conclusion,
    number: r.run_number,
    createdAt: r.created_at,
    actor: r.actor?.login ?? "?",
    url: r.html_url,
  }));
}

export async function getRun(ref: ForgeRef, id: number): Promise<Run> {
  const r = await call(ref, `/actions/runs/${id}`);
  return {
    id: r.id,
    title: r.display_title ?? r.name,
    workflow: r.name,
    branch: r.head_branch,
    event: r.event,
    status: r.status,
    conclusion: r.conclusion,
    number: r.run_number,
    createdAt: r.created_at,
    actor: r.actor?.login ?? "?",
    url: r.html_url,
  };
}

export async function listJobs(ref: ForgeRef, runId: number): Promise<Job[]> {
  const j = await call(ref, `/actions/runs/${runId}/jobs?per_page=100`);
  return (j?.jobs ?? []).map((x: any) => ({
    id: x.id,
    name: x.name,
    status: x.status,
    conclusion: x.conclusion,
    startedAt: x.started_at,
    completedAt: x.completed_at,
    steps: (x.steps ?? []).map((s: any) => ({ name: s.name, status: s.status, conclusion: s.conclusion, number: s.number })),
  }));
}

export async function rerunRun(ref: ForgeRef, runId: number, failedOnly: boolean) {
  await call(ref, `/actions/runs/${runId}/${failedOnly ? "rerun-failed-jobs" : "rerun"}`, { method: "POST" });
}

export async function cancelRun(ref: ForgeRef, runId: number) {
  await call(ref, `/actions/runs/${runId}/cancel`, { method: "POST" });
}
