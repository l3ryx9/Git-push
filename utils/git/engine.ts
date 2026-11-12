/**
 * Moteur Git local — enveloppe isomorphic-git pour Git-Push.
 *
 * Module SANS React : il est utilisé par l'interface ET par la tâche de
 * synchronisation en arrière-plan.
 */
import { Buffer } from "buffer";
import * as git from "isomorphic-git";

import { createDirMemo } from "@/utils/ai/pure";
import { hasConflictMarkers, isBinary, merge3 } from "./diff";
import { decodeUtf8, encodeUtf8, fs, onRepoWrite, pathExists, readBytes, removePath, writeBytesDeep } from "./fs";
import { http, httpInsecure } from "./http";
import { buildGitGraph, type GitGraphData } from "./graphPure";
export type { GraphCommit, GitGraphData } from "./graphPure";

export type Author = { name: string; email: string };
export type Creds = { username: string; password: string } | null;
export type Progress = { phase: string; loaded: number; total?: number };

export interface GitCtx {
  dir: string;
  creds: Creds;
  author: Author;
  remote: string;
  /** Dépôt dont la vérification SSL est désactivée (certificat auto-signé). */
  insecure?: boolean;
  onProgress?: (p: Progress) => void;
}

export type FileKind = "new" | "added" | "modified" | "deleted";
export interface FileStatus {
  path: string;
  kind: FileKind;
  staged: boolean;
  unstaged: boolean;
  row: [number, number, number];
}

export interface MergeState {
  oursOid: string;
  theirOid: string;
  label: string;
  message: string;
  conflicts: string[];
  resolved: string[];
  touched: string[];
}

export type MergeOutcome =
  | { kind: "uptodate" }
  | { kind: "fastforward"; oid: string }
  | { kind: "merged"; oid: string }
  | { kind: "conflict"; merge: MergeState };

export interface SyncSummary {
  committed: number;
  pulled: "uptodate" | "fastforward" | "merged" | "conflict";
  pushed: boolean;
  conflicts: string[];
}

export type Change = { path: string; kind: "added" | "modified" | "deleted"; a: string | null; b: string | null };

// ─── Erreurs ──────────────────────────────────────────────────────────────────

export function codeError(code: string, message?: string, data?: unknown): Error & { code: string; data?: unknown } {
  const e = new Error(message ?? code) as Error & { code: string; data?: unknown };
  e.code = code;
  e.data = data;
  return e;
}

export function isNetworkError(e: any): boolean {
  if (!e) return false;
  if (e.code === "HttpError") {
    const s = Number(e.data?.statusCode);
    return s >= 500 || s === 408 || s === 429;
  }
  const msg = String(e.message ?? e).toLowerCase();
  return /network|timeout|timed out|failed to connect|unable to resolve host|unknownhost|enotfound|econnreset|econnrefused|offline|internet|socket|connection (reset|refused|abort)/.test(
    msg
  );
}

// ─── Cache (packfiles gardés en mémoire entre les commandes) ──────────────────

const caches = new Map<string, object>();
function cacheFor(dir: string): object {
  let c = caches.get(dir);
  if (!c) {
    c = {};
    caches.set(dir, c);
  }
  return c;
}
export function dropCache(dir: string) {
  caches.delete(dir);
  invalidateStatus(dir);
}

const httpFor = (ctx: GitCtx) => (ctx.insecure ? httpInsecure : http);

function remoteOpts(ctx: GitCtx) {
  const opts: Record<string, unknown> = {};
  if (ctx.creds) {
    const { username, password } = ctx.creds;
    opts.headers = { Authorization: "Basic " + Buffer.from(`${username}:${password}`, "utf8").toString("base64") };
    opts.onAuth = () => ({ username, password });
  }
  if (ctx.onProgress) {
    const cb = ctx.onProgress;
    opts.onProgress = (p: { phase: string; loaded: number; total?: number }) =>
      cb({ phase: p.phase, loaded: p.loaded, total: p.total });
  }
  return opts;
}

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// ─── Références ───────────────────────────────────────────────────────────────

export async function resolveOrNull(dir: string, ref: string): Promise<string | null> {
  try {
    return await git.resolveRef({ fs, dir, ref });
  } catch {
    return null;
  }
}

export async function currentBranch(dir: string): Promise<string | null> {
  try {
    return (await git.currentBranch({ fs, dir, fullname: false })) || null;
  } catch {
    return null;
  }
}

async function requireBranch(dir: string): Promise<string> {
  const b = await currentBranch(dir);
  if (!b) throw codeError("NoBranch");
  return b;
}

// ─── Clone / configuration ────────────────────────────────────────────────────

export async function cloneRepo(
  ctx: GitCtx,
  url: string,
  opts: { ref?: string; depth?: number; singleBranch?: boolean }
): Promise<void> {
  const dir = ctx.dir;
  await git.clone({
    fs,
    http: httpFor(ctx),
    dir,
    url,
    ref: opts.ref || undefined,
    singleBranch: !!opts.singleBranch,
    depth: opts.depth && opts.depth > 0 ? opts.depth : undefined,
    cache: cacheFor(dir),
    ...remoteOpts(ctx),
  });
  // Dépôt distant vide : on place HEAD sur une branche « main » non née.
  if (!(await resolveOrNull(dir, "HEAD"))) {
    await git.writeRef({ fs, dir, ref: "HEAD", value: `refs/heads/${opts.ref || "main"}`, symbolic: true, force: true });
  }
  await setAuthor(dir, ctx.author);
}

/** Crée un dépôt Git local vide (branche initiale non née) dans un dossier existant. */
export async function initRepo(dir: string, author: Author, branch = "main"): Promise<void> {
  await git.init({ fs, dir, defaultBranch: branch });
  await setAuthor(dir, author);
}

export async function setAuthor(dir: string, author: Author) {
  if (author.name) await git.setConfig({ fs, dir, path: "user.name", value: author.name });
  if (author.email) await git.setConfig({ fs, dir, path: "user.email", value: author.email });
}

// ─── Statut / index ───────────────────────────────────────────────────────────

// Le statut (comparaison HEAD / index / fichiers) est la lecture la plus coûteuse : on mémorise
// brièvement le résultat et on partage les calculs simultanés. Toute écriture sous le dossier du
// dépôt (voir fs.onRepoWrite) invalide le cache, où que se trouve ce dossier.
const statusMemo = createDirMemo<FileStatus[]>(3000);

export function invalidateStatus(dir: string) {
  statusMemo.invalidate(dir);
}
onRepoWrite((path) => statusMemo.invalidatePath(path));

export async function getStatus(dir: string): Promise<FileStatus[]> {
  return (await statusMemo.get(dir, () => computeStatus(dir))).slice();
}

async function computeStatus(dir: string): Promise<FileStatus[]> {
  const matrix = await git.statusMatrix({ fs, dir, cache: cacheFor(dir) });
  const out: FileStatus[] = [];
  for (const [path, head, wd, st] of matrix as [string, number, number, number][]) {
    if (head === 1 && wd === 1 && st === 1) continue;
    const staged = head === 0 ? st !== 0 : st !== 1;
    const unstaged = wd === 0 ? st !== 0 : wd === 1 ? st !== 1 : st !== 2;
    if (!staged && !unstaged) continue;
    let kind: FileKind;
    if (wd === 0) kind = "deleted";
    else if (head === 0) kind = st === 0 ? "new" : "added";
    else kind = "modified";
    out.push({ path, kind, staged, unstaged, row: [head, wd, st] });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export async function stagePaths(dir: string, paths: string[]) {
  const cache = cacheFor(dir);
  for (const filepath of paths) {
    if (await pathExists(`${dir}/${filepath}`)) await git.add({ fs, dir, filepath, cache });
    else await git.remove({ fs, dir, filepath, cache });
  }
}

export async function unstagePaths(dir: string, paths: string[]) {
  const cache = cacheFor(dir);
  for (const filepath of paths) {
    try {
      await git.resetIndex({ fs, dir, filepath, cache });
    } catch {
      await git.remove({ fs, dir, filepath, cache });
    }
  }
}

/** Replace une branche sur un commit (null : supprime la branche, retour à l'état « non né »). */
export async function moveBranchTo(dir: string, branch: string, oid: string | null) {
  const ref = `refs/heads/${branch}`;
  if (oid) await git.writeRef({ fs, dir, ref, value: oid, force: true });
  else await git.deleteRef({ fs, dir, ref });
  dropCache(dir);
}

/** Annule les modifications locales (restaure depuis HEAD, supprime les nouveaux fichiers). */
export async function discardChanges(dir: string, items: FileStatus[]) {
  const cache = cacheFor(dir);
  const tracked = items.filter((i) => i.row[0] === 1).map((i) => i.path);
  const fresh = items.filter((i) => i.row[0] === 0).map((i) => i.path);
  if (tracked.length) await git.checkout({ fs, dir, filepaths: tracked, force: true, cache });
  for (const filepath of fresh) {
    try {
      await git.remove({ fs, dir, filepath, cache });
    } catch {
      /* pas dans l'index */
    }
    await removePath(`${dir}/${filepath}`);
  }
}

async function ensureClean(dir: string) {
  const dirty = (await getStatus(dir)).filter((s) => s.staged || (s.unstaged && s.kind !== "new"));
  if (dirty.length) throw codeError("DirtyWorktree", undefined, { files: dirty.map((d) => d.path) });
}

export async function commitStaged(ctx: GitCtx, message: string, parents?: string[]): Promise<string> {
  return git.commit({
    fs,
    dir: ctx.dir,
    message,
    author: ctx.author,
    committer: ctx.author,
    parent: parents,
    cache: cacheFor(ctx.dir),
  });
}

// ─── Réseau : fetch / push ────────────────────────────────────────────────────

export async function fetchRemote(ctx: GitCtx, remote = ctx.remote) {
  return git.fetch({
    fs,
    http: httpFor(ctx),
    dir: ctx.dir,
    remote,
    singleBranch: false,
    tags: false,
    prune: true,
    cache: cacheFor(ctx.dir),
    ...remoteOpts(ctx),
  });
}

/**
 * Fetch limité à la branche courante (synchronisation) : beaucoup moins de
 * données à négocier et à télécharger qu'un fetch de toutes les branches.
 * Branche absente du serveur (jamais poussée) : repli sur le fetch complet.
 */
async function fetchBranch(ctx: GitCtx, branch: string) {
  try {
    return await git.fetch({
      fs,
      http: httpFor(ctx),
      dir: ctx.dir,
      remote: ctx.remote,
      ref: branch,
      singleBranch: true,
      tags: false,
      cache: cacheFor(ctx.dir),
      ...remoteOpts(ctx),
    });
  } catch (e: any) {
    if (isNetworkError(e) || e?.code === "HttpError" || e?.code === "UserCanceledError") throw e;
    return fetchRemote(ctx);
  }
}

/** Le push a-t-il été refusé parce que le serveur a avancé entre-temps ? */
function isStaleRemote(e: any): boolean {
  const msg = String(e?.message ?? e).toLowerCase();
  return e?.code === "PushRejectedError" && /fast.?forward|fetch first|rejected|failed to update|stale/.test(msg);
}

export async function pushRemote(
  ctx: GitCtx,
  branch: string,
  opts: { force?: boolean; remote?: string; remoteRef?: string; delete?: boolean } = {}
) {
  const res = await git.push({
    fs,
    http: httpFor(ctx),
    dir: ctx.dir,
    remote: opts.remote ?? ctx.remote,
    ref: branch,
    remoteRef: opts.remoteRef,
    force: !!opts.force,
    delete: !!opts.delete,
    onProgress: ctx.onProgress,
    cache: cacheFor(ctx.dir),
    ...remoteOpts(ctx),
  });
  if (!res.ok) {
    const details = Object.values(res.refs ?? {})
      .map((r: any) => r?.error)
      .filter(Boolean)
      .join("; ");
    throw codeError("PushRejectedError", res.error || details || "push rejected");
  }
  return res;
}

// ─── Fusion ───────────────────────────────────────────────────────────────────

async function readBlobOrNull(dir: string, commitOid: string, filepath: string): Promise<Uint8Array | null> {
  try {
    const { blob } = await git.readBlob({ fs, dir, oid: commitOid, filepath, cache: cacheFor(dir) });
    return blob;
  } catch {
    return null;
  }
}

async function blobByOid(dir: string, oid: string): Promise<Uint8Array> {
  const { blob } = await git.readBlob({ fs, dir, oid, cache: cacheFor(dir) });
  return blob;
}

/**
 * Fusion manuelle à trois voies (utilisée quand isomorphic-git signale un
 * conflit) : applique dans la copie de travail les changements « leurs »,
 * fusionne ligne à ligne les fichiers modifiés des deux côtés et écrit les
 * marqueurs de conflit. Gère correctement les fichiers binaires et les
 * suppressions. Les fichiers sans conflit sont indexés.
 */
async function materializeMerge(
  dir: string,
  baseOid: string | null,
  oursOid: string,
  theirOid: string,
  labels: { ours: string; theirs: string }
): Promise<{ conflicts: string[]; touched: string[] }> {
  const cache = cacheFor(dir);
  type Item = { path: string; b: string | null; o: string | null; t: string | null };
  const items: Item[] = [];
  const unsupported: string[] = [];
  const trees = [git.TREE({ ref: baseOid ?? EMPTY_TREE }), git.TREE({ ref: oursOid }), git.TREE({ ref: theirOid })];

  await git.walk({
    fs,
    dir,
    cache,
    trees,
    map: async (filepath: string, entries: any[]) => {
      if (filepath === ".") return undefined;
      const [B, O, T] = entries;
      const types = await Promise.all([B, O, T].map((e) => (e ? e.type() : Promise.resolve(null))));
      const present = types.filter((x) => x !== null);
      if (present.every((x) => x === "tree")) {
        const oids = await Promise.all([B, O, T].map((e) => (e ? e.oid() : Promise.resolve(null))));
        if (oids[1] === oids[2]) return null; // sous-arbre identique des deux côtés
        return undefined;
      }
      if (present.some((x) => x === "tree") || present.some((x) => x === "commit")) {
        unsupported.push(filepath);
        return null;
      }
      const [b, o, t] = await Promise.all([B, O, T].map((e) => (e ? e.oid() : Promise.resolve(null))));
      if (o === t || t === b) return undefined; // identique, ou seul « nous » a changé
      items.push({ path: filepath, b, o, t });
      return undefined;
    },
  });

  if (unsupported.length) throw codeError("MergeNotSupportedError", undefined, { files: unsupported });

  const conflicts: string[] = [];
  const touched: string[] = [];
  for (const it of items) {
    const abs = `${dir}/${it.path}`;
    touched.push(it.path);
    if (it.o === it.b) {
      // Seul « leur » côté a changé : on applique.
      if (it.t) {
        await writeBytesDeep(abs, await blobByOid(dir, it.t));
        await git.add({ fs, dir, filepath: it.path, cache });
      } else {
        await removePath(abs);
        await git.remove({ fs, dir, filepath: it.path, cache });
      }
      continue;
    }
    // Modifié des deux côtés (ou supprimé d'un côté et modifié de l'autre).
    if (!it.o && !it.t) continue;
    if (it.o && it.t) {
      const ours = await blobByOid(dir, it.o);
      const theirs = await blobByOid(dir, it.t);
      const base = it.b ? await blobByOid(dir, it.b) : new Uint8Array(0);
      if (!isBinary(ours) && !isBinary(theirs) && !isBinary(base)) {
        const r = merge3(decodeUtf8(base), decodeUtf8(ours), decodeUtf8(theirs), labels);
        await writeBytesDeep(abs, encodeUtf8(r.text));
        if (r.clean) await git.add({ fs, dir, filepath: it.path, cache });
        else conflicts.push(it.path);
        continue;
      }
      conflicts.push(it.path); // binaire : on garde « notre » version, l'utilisateur choisit
      continue;
    }
    if (!it.o && it.t) await writeBytesDeep(abs, await blobByOid(dir, it.t));
    conflicts.push(it.path);
  }
  return { conflicts, touched };
}

/**
 * Fusionne `theirsRef` dans la branche courante.
 * Avance rapide si possible, sinon commit de fusion ; en cas de conflit, la
 * copie de travail contient les marqueurs et un MergeState est renvoyé.
 */
export async function mergeInto(ctx: GitCtx, theirsRef: string, label: string): Promise<MergeOutcome> {
  const dir = ctx.dir;
  const cache = cacheFor(dir);
  const branch = await requireBranch(dir);
  const theirOid = await resolveOrNull(dir, theirsRef);
  if (!theirOid) return { kind: "uptodate" };
  const oursOid = await resolveOrNull(dir, `refs/heads/${branch}`);

  if (!oursOid) {
    // Branche locale encore vide : elle prend simplement la tête distante.
    await git.writeRef({ fs, dir, ref: `refs/heads/${branch}`, value: theirOid, force: true });
    await git.checkout({ fs, dir, ref: branch, cache });
    return { kind: "fastforward", oid: theirOid };
  }
  if (oursOid === theirOid) return { kind: "uptodate" };

  await ensureClean(dir);
  const message = `Merge ${label} into ${branch}`;
  try {
    const res = await git.merge({
      fs,
      dir,
      ours: branch,
      theirs: theirsRef,
      fastForward: true,
      abortOnConflict: true,
      author: ctx.author,
      committer: ctx.author,
      message,
      cache,
    });
    if (res.alreadyMerged) return { kind: "uptodate" };
    await git.checkout({ fs, dir, ref: branch, cache });
    return res.fastForward ? { kind: "fastforward", oid: res.oid! } : { kind: "merged", oid: res.oid! };
  } catch (e: any) {
    if (e?.code !== "MergeConflictError" && e?.code !== "MergeNotSupportedError") throw e;
  }

  const bases = await git.findMergeBase({ fs, dir, oids: [oursOid, theirOid], cache });
  const baseOid = (bases && bases[0]) || null;
  const { conflicts, touched } = await materializeMerge(dir, baseOid, oursOid, theirOid, {
    ours: branch,
    theirs: label,
  });
  const merge: MergeState = { oursOid, theirOid, label, message, conflicts, resolved: [], touched };
  if (conflicts.length === 0) {
    // Tout a pu être fusionné ligne à ligne : on crée le commit de fusion.
    await finishMerge(ctx, merge);
    return { kind: "merged", oid: (await resolveOrNull(dir, "HEAD")) ?? "" };
  }
  return { kind: "conflict", merge };
}

export async function pullRemote(ctx: GitCtx): Promise<MergeOutcome> {
  const branch = await requireBranch(ctx.dir);
  await fetchBranch(ctx, branch);
  return mergeInto(ctx, `refs/remotes/${ctx.remote}/${branch}`, `${ctx.remote}/${branch}`);
}

export async function resolveConflict(
  dir: string,
  merge: MergeState,
  filepath: string,
  choice: "ours" | "theirs" | "worktree"
): Promise<{ markersLeft: boolean }> {
  const cache = cacheFor(dir);
  const abs = `${dir}/${filepath}`;
  if (choice !== "worktree") {
    const blob = await readBlobOrNull(dir, choice === "ours" ? merge.oursOid : merge.theirOid, filepath);
    if (blob) await writeBytesDeep(abs, blob);
    else await removePath(abs);
  }
  let markersLeft = false;
  const bytes = await readBytes(abs);
  if (bytes) {
    if (!isBinary(bytes)) markersLeft = hasConflictMarkers(decodeUtf8(bytes));
    await git.add({ fs, dir, filepath, cache });
  } else {
    await git.remove({ fs, dir, filepath, cache });
  }
  return { markersLeft };
}

export async function finishMerge(ctx: GitCtx, merge: MergeState): Promise<string> {
  const head = (await resolveOrNull(ctx.dir, "HEAD")) ?? merge.oursOid;
  return commitStaged(ctx, merge.message, [head, merge.theirOid]);
}

export async function abortMerge(dir: string, merge: MergeState) {
  const cache = cacheFor(dir);
  for (const filepath of merge.touched) {
    const blob = await readBlobOrNull(dir, merge.oursOid, filepath);
    const abs = `${dir}/${filepath}`;
    if (blob) await writeBytesDeep(abs, blob);
    else await removePath(abs);
    try {
      await git.resetIndex({ fs, dir, filepath, cache });
    } catch {
      try {
        await git.remove({ fs, dir, filepath, cache });
      } catch {
        /* ignoré */
      }
    }
  }
}

// ─── Synchronisation complète ─────────────────────────────────────────────────

/**
 * Synchronisation façon GitSync : commit de toutes les modifications locales,
 * fetch, fusion de la branche distante, puis push.
 */
export async function syncRepo(
  ctx: GitCtx,
  opts: { message: (files: number, branch: string) => string }
): Promise<{ summary: SyncSummary; merge?: MergeState }> {
  const dir = ctx.dir;
  const branch = await requireBranch(dir);
  let committed = 0;

  const status = await getStatus(dir);
  if (status.length) {
    ctx.onProgress?.({ phase: "commit", loaded: 0 });
    await stagePaths(
      dir,
      status.filter((s) => s.unstaged).map((s) => s.path)
    );
    const staged = (await getStatus(dir)).filter((s) => s.staged);
    if (staged.length) {
      await commitStaged(ctx, opts.message(staged.length, branch));
      committed = staged.length;
    }
  }

  const remoteRef = `refs/remotes/${ctx.remote}/${branch}`;
  const label = `${ctx.remote}/${branch}`;
  let pulled: SyncSummary["pulled"] = "uptodate";
  let pushed = false;

  // Deux passes au plus : si quelqu'un pousse pendant notre synchro, le push est refusé ;
  // on récupère alors la nouvelle tête, on fusionne et on renvoie (au lieu d'échouer).
  for (let pass = 0; pass < 2; pass++) {
    ctx.onProgress?.({ phase: "fetch", loaded: 0 });
    await fetchBranch(ctx, branch);
    const outcome = await mergeInto(ctx, remoteRef, label);
    if (outcome.kind === "conflict") {
      return {
        summary: { committed, pulled: "conflict", pushed: false, conflicts: outcome.merge.conflicts },
        merge: outcome.merge,
      };
    }
    if (outcome.kind !== "uptodate") pulled = outcome.kind;

    const local = await resolveOrNull(dir, `refs/heads/${branch}`);
    const upstream = await resolveOrNull(dir, remoteRef);
    if (!local || local === upstream) break;
    ctx.onProgress?.({ phase: "push", loaded: 0 });
    try {
      await pushRemote(ctx, branch);
      pushed = true;
      break;
    } catch (e) {
      if (pass === 0 && isStaleRemote(e)) continue;
      throw e;
    }
  }
  return { summary: { committed, pulled, pushed, conflicts: [] } };
}

export async function aheadBehind(
  dir: string,
  branch: string,
  remote: string
): Promise<{ ahead: number; behind: number; upstream: boolean }> {
  const local = await resolveOrNull(dir, `refs/heads/${branch}`);
  const up = await resolveOrNull(dir, `refs/remotes/${remote}/${branch}`);
  if (!up) return { ahead: local ? -1 : 0, behind: 0, upstream: false };
  if (!local) return { ahead: 0, behind: -1, upstream: true };
  if (local === up) return { ahead: 0, behind: 0, upstream: true };
  // Le résultat ne dépend que des deux commits : inutile de reparcourir l'historique à chaque affichage.
  const memoKey = `${dir}|${local}|${up}`;
  const known = abMemo.get(memoKey);
  if (known) return known;
  const cache = cacheFor(dir);
  const safeLog = async (ref: string) => {
    try {
      return await git.log({ fs, dir, ref, depth: 150, cache });
    } catch {
      return [];
    }
  };
  const [l, r] = await Promise.all([safeLog(local), safeLog(up)]);
  const ls = new Set(l.map((c) => c.oid));
  const rs = new Set(r.map((c) => c.oid));
  const res = {
    ahead: l.filter((c) => !rs.has(c.oid)).length,
    behind: r.filter((c) => !ls.has(c.oid)).length,
    upstream: true,
  };
  if (abMemo.size > 200) abMemo.clear();
  abMemo.set(memoKey, res);
  return res;
}

const abMemo = new Map<string, { ahead: number; behind: number; upstream: boolean }>();

// ─── Historique / diffs ───────────────────────────────────────────────────────

export type LogEntry = Awaited<ReturnType<typeof git.log>>[number];

/**
 * Construit un graphe de références à partir des commits atteignables depuis les refs
 * locales et distantes. Les OID complets servent d'identifiants stables entre les voies.
 */
export async function getGitGraph(dir: string, depth = 80): Promise<GitGraphData> {
  const [localNames, remotes] = await Promise.all([listLocalBranches(dir), git.listRemotes({ fs, dir })]);
  const refs: { name: string; ref: string }[] = [];
  for (const name of localNames) refs.push({ name, ref: `refs/heads/${name}` });
  for (const remote of remotes) {
    const names = await listRemoteBranches(dir, remote.remote).catch(() => []);
    for (const name of names) refs.push({ name: `${remote.remote}/${name}`, ref: `refs/remotes/${remote.remote}/${name}` });
  }
  const histories = await Promise.all(refs.map(async (ref) => {
    try {
      const entries = await git.log({ fs, dir, ref: ref.ref, depth, cache: cacheFor(dir) });
      return { name: ref.name, entries };
    } catch {
      return { name: ref.name, entries: [] };
    }
  }));
  return buildGitGraph(histories, depth);
}

export async function getLog(dir: string, ref: string, depth: number): Promise<LogEntry[]> {
  try {
    return await git.log({ fs, dir, ref, depth, cache: cacheFor(dir) });
  } catch (e: any) {
    if (e?.code === "NotFoundError") return [];
    throw e;
  }
}

export async function readCommit(dir: string, oid: string) {
  return git.readCommit({ fs, dir, oid, cache: cacheFor(dir) });
}

/** Fichiers modifiés entre deux commits (a = null → commit racine). */
export async function diffCommits(dir: string, a: string | null, b: string): Promise<Change[]> {
  const result = await git.walk({
    fs,
    dir,
    cache: cacheFor(dir),
    trees: [git.TREE({ ref: a ?? EMPTY_TREE }), git.TREE({ ref: b })],
    map: async (filepath: string, entries: any[]) => {
      if (filepath === ".") return undefined;
      const [A, B] = entries;
      const at = A ? await A.type() : null;
      const bt = B ? await B.type() : null;
      const aBlob = at === "blob";
      const bBlob = bt === "blob";
      if (!aBlob && !bBlob) {
        if (at === "tree" && bt === "tree" && (await A.oid()) === (await B.oid())) return null;
        return undefined;
      }
      const ao = aBlob ? await A.oid() : null;
      const bo = bBlob ? await B.oid() : null;
      if (ao === bo) return undefined;
      const kind: Change["kind"] = !ao ? "added" : !bo ? "deleted" : "modified";
      return { path: filepath, kind, a: ao, b: bo } as Change;
    },
  });
  return (Array.isArray(result) ? result : []).filter((x: any) => x && x.path) as Change[];
}

/** Contenu d'un fichier à une révision : oid de commit, « HEAD » ou « WORKDIR ». */
export async function fileAt(dir: string, rev: string, filepath: string): Promise<Uint8Array | null> {
  if (!rev) return null;
  if (rev === "WORKDIR") return readBytes(`${dir}/${filepath}`);
  const oid = rev === "HEAD" ? await resolveOrNull(dir, "HEAD") : rev;
  if (!oid) return null;
  return readBlobOrNull(dir, oid, filepath);
}

// ─── Branches ─────────────────────────────────────────────────────────────────

export async function listLocalBranches(dir: string): Promise<string[]> {
  return git.listBranches({ fs, dir });
}

export async function listRemoteBranches(dir: string, remote: string): Promise<string[]> {
  const list = await git.listBranches({ fs, dir, remote });
  return list.filter((b) => b !== "HEAD");
}

export async function createBranch(dir: string, name: string, checkout: boolean) {
  await git.branch({ fs, dir, ref: name, checkout });
}

export async function checkoutBranch(dir: string, name: string, remote?: string) {
  await git.checkout({ fs, dir, ref: name, remote, cache: cacheFor(dir) });
}

export async function deleteBranch(dir: string, name: string) {
  await git.deleteBranch({ fs, dir, ref: name });
}

export async function renameBranch(dir: string, oldName: string, newName: string) {
  const current = await currentBranch(dir);
  await git.renameBranch({ fs, dir, oldref: oldName, ref: newName, checkout: current === oldName });
}

// ─── Distants ─────────────────────────────────────────────────────────────────

export async function listRemotes(dir: string): Promise<{ remote: string; url: string }[]> {
  return git.listRemotes({ fs, dir });
}

export async function addRemote(dir: string, remote: string, url: string) {
  await git.addRemote({ fs, dir, remote, url });
}

export async function deleteRemote(dir: string, remote: string) {
  await git.deleteRemote({ fs, dir, remote });
}
