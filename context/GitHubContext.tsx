import AsyncStorage from "@react-native-async-storage/async-storage";
import { getGitHubToken, setGitHubToken } from "@/utils/secrets";
import React, { useRef, createContext, useContext, useEffect, useState } from "react";

export interface GitHubUser {
  login: string;
  name: string;
  avatar_url: string;
  public_repos: number;
  email: string | null;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  default_branch: string;
  updated_at: string;
  description: string | null;
}

export interface GitHubBranch {
  name: string;
  commit: { sha: string };
}

export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
  author: { login: string; avatar_url: string } | null;
}

interface GitHubContextType {
  token: string | null;
  user: GitHubUser | null;
  repos: GitHubRepo[];
  selectedRepo: GitHubRepo | null;
  branches: GitHubBranch[];
  currentBranch: string;
  commits: GitHubCommit[];
  loading: boolean;
  reposLoading: boolean;
  login: (token: string) => Promise<boolean>;
  logout: () => Promise<void>;
  selectRepo: (repo: GitHubRepo | null) => Promise<void>;
  selectBranch: (branch: string) => Promise<void>;
  fetchRepos: () => Promise<void>;
  refreshCommits: () => Promise<void>;
  pushFile: (path: string, content: string, message: string) => Promise<{ ok: boolean; error?: string; strategy?: string }>;
  pushFiles: (
    files: { path: string; content: string }[],
    message: string,
    onProgress?: (done: number, total: number) => void
  ) => Promise<{ ok: boolean; error?: string; pushedCount?: number }>;
  deleteDirectory: (dirPath: string, message: string) => Promise<{ ok: boolean; error?: string; deletedCount?: number; skipped?: string[] }>;
  clearRepo: (message: string) => Promise<{ ok: boolean; error?: string; deletedCount?: number; skipped?: string[] }>;
  deleteRepos: (fullNames: string[]) => Promise<{ ok: boolean; deleted: string[]; failed: { name: string; error: string }[]; needsScope: boolean }>;
}

const GitHubContext = createContext<GitHubContextType | null>(null);

const REPOS_CACHE_KEY = "@gitcrush_repos_cache_v1";
const REPO_KEY = "@gitcrush_repo";
const BRANCH_KEY = "@gitcrush_branch";

const GH_HEADERS = (tok: string) => ({
  Authorization: `Bearer ${tok}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Encode chaque segment d'un chemin (espaces, #, ?, accents…) en gardant les "/". */
function encPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Une seule requête, avec délai maximum (évite les push bloqués indéfiniment). */
async function ghFetchOnce(tok: string, path: string, options?: RequestInit): Promise<Response> {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 300000) : null;
  try {
    return await fetch(`https://api.github.com${path}`, {
      ...options,
      ...(ctrl && !options?.signal ? { signal: ctrl.signal } : {}),
      headers: { ...GH_HEADERS(tok), ...(options?.headers ?? {}) },
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Requête GitHub avec nouvelles tentatives : erreurs réseau, 408, 5xx (502/503/504…),
 * 429 et limites de débit GitHub (primary/secondary rate limit).
 * Respecte Retry-After / x-ratelimit-reset quand ils sont fournis.
 */
async function ghFetchRetry(
  tok: string,
  path: string,
  options?: RequestInit,
  attempts = 5
): Promise<Response> {
  for (let i = 0; i < attempts; i++) {
    const last = i === attempts - 1;
    try {
      const res = await ghFetchOnce(tok, path, options);
      let retriable = res.status >= 500 || res.status === 429 || res.status === 408;
      if (res.status === 403) {
        const txt = await res.clone().text().catch(() => "");
        retriable = /rate limit|abuse|retry|secondary/i.test(txt);
      }
      if (!retriable || last) return res;

      const retryAfter = Number(res.headers.get("retry-after"));
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      const remaining = res.headers.get("x-ratelimit-remaining");
      let waitMs = Math.min(2000 * 2 ** i, 30000);
      if (retryAfter > 0) waitMs = Math.min(retryAfter * 1000, 65000);
      else if (remaining === "0" && reset > 0) waitMs = Math.min(Math.max(reset * 1000 - Date.now(), 1000), 65000);
      await sleep(waitMs);
    } catch (e) {
      if (last) throw e;
      await sleep(Math.min(1500 * 2 ** i, 15000));
    }
  }
  throw new Error("Tentatives épuisées (réseau indisponible ?)");
}

/** Toutes les requêtes passent par la version avec nouvelles tentatives. */
function ghFetch(tok: string, path: string, options?: RequestInit): Promise<Response> {
  return ghFetchRetry(tok, path, options, 4);
}

/** Exécute fn sur chaque élément avec au plus `limit` appels simultanés. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let aborted = false;
  async function worker() {
    while (!aborted) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        aborted = true;
        throw e;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Extrait le vrai message d'erreur renvoyé par l'API GitHub (corps JSON ou
 * texte brut/HTML d'une passerelle 502) et ajoute une explication claire
 * selon le code HTTP.
 */
const PLACEHOLDER = ".gitkeep";

async function ghError(res: Response, fallback: string): Promise<string> {
  let msg = "";
  try {
    const raw = await res.text();
    try {
      const body = JSON.parse(raw) as { message?: string; errors?: ({ message?: string } | string)[] };
      const detail = body.errors
        ?.map((e) => (typeof e === "string" ? e : e?.message))
        .filter(Boolean)
        .join("; ");
      msg = [body.message, detail].filter(Boolean).join(" — ");
    } catch {
      msg = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
    }
  } catch {/**/ }

  const hints: Record<number, string> = {
    401: "Token invalide ou expiré — reconnecte-toi avec un nouveau token.",
    403: "Permission refusée — le token doit avoir le scope « repo » (classique) ou « Contents : Read and write » (fine-grained), ou limite de débit atteinte.",
    404: "Introuvable — vérifie le dépôt/la branche et que le token a accès en écriture à ce dépôt.",
    409: "Conflit — dépôt vide ou branche modifiée entre-temps.",
    413: "Contenu trop volumineux pour GitHub.",
    422: "Données refusées par GitHub (branche non à jour, chemin invalide ou fichier trop gros).",
    429: "Trop de requêtes — réessaie dans une minute.",
  };
  let hint = hints[res.status] ?? (res.status >= 500 ? "Erreur côté GitHub — réessaie dans un instant." : "");
  if (res.status === 422 && /fast.?forward/i.test(msg)) {
    hint = "La branche a changé pendant l'envoi (ou GitHub n'était pas encore synchronisé) — relance l'envoi.";
  }
  if (/workflow/i.test(msg)) {
    hint = "Le token n'a pas le scope « workflow » (classique) ou le droit « Workflows : Read and write » (fine-grained), requis pour modifier .github/workflows.";
  }
  return [`${fallback} (HTTP ${res.status})`, msg, hint].filter(Boolean).join(" : ");
}

export function GitHubProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>("main");
  const [commits, setCommits] = useState<GitHubCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [reposLoading, setReposLoading] = useState(false);
  // Dernière tête de branche que NOUS avons créée : GitHub peut renvoyer
  // l'ancienne tête juste après une mise à jour (réplication). Sans ça, le lot
  // suivant est construit sur un vieux commit → « Update is not a fast forward » (422).
  const lastHead = useRef<{ repo: string; branch: string; commitSha: string; treeSha: string; at: number } | null>(null);

  useEffect(() => {
    restoreSession();
  }, []);

  async function restoreSession() {
    try {
      const tok = await getGitHubToken();
      if (!tok) return;
      // Liste des dépôts connue : affichée tout de suite, mise à jour ensuite.
      AsyncStorage.getItem(REPOS_CACHE_KEY)
        .then((raw) => {
          if (raw) setRepos((cur) => (cur.length ? cur : (JSON.parse(raw) as GitHubRepo[])));
        })
        .catch(() => undefined);
      const ok = await verifyToken(tok);
      if (!ok) return;
      const repoJson = await AsyncStorage.getItem(REPO_KEY);
      const branchStr = await AsyncStorage.getItem(BRANCH_KEY);
      if (repoJson) {
        const repo = JSON.parse(repoJson) as GitHubRepo;
        setSelectedRepo(repo);
        const branch = branchStr || repo.default_branch;
        setCurrentBranch(branch);
        void loadBranches(tok, repo);
        void loadCommits(tok, repo, branch);
      }
      void loadRepos(tok);
    } finally {
      setLoading(false);
    }
  }

  async function verifyToken(tok: string): Promise<boolean> {
    try {
      const res = await ghFetch(tok, "/user");
      if (!res.ok) return false;
      const u = (await res.json()) as GitHubUser;
      setToken(tok);
      setUser(u);
      return true;
    } catch {
      return false;
    }
  }

  async function login(tok: string): Promise<boolean> {
    const ok = await verifyToken(tok);
    if (ok) {
      await setGitHubToken(tok);
      void loadRepos(tok);
    }
    return ok;
  }

  async function logout() {
    await setGitHubToken(null);
    await AsyncStorage.multiRemove([REPO_KEY, BRANCH_KEY, REPOS_CACHE_KEY]);
    setToken(null);
    setUser(null);
    setRepos([]);
    setSelectedRepo(null);
    setBranches([]);
    setCommits([]);
    setCurrentBranch("main");
  }

  // Liste des dépôts : ETag (une réponse 304 ne compte pas dans la limite de débit GitHub),
  // pas de rechargement dans la minute qui suit, et copie locale pour un affichage instantané au démarrage.
  const reposMeta = useRef<{ etag?: string; at: number }>({ at: 0 });

  async function loadRepos(tok: string, force = true) {
    if (!force && Date.now() - reposMeta.current.at < 60000) return;
    setReposLoading(true);
    try {
      const headers = reposMeta.current.etag ? { "If-None-Match": reposMeta.current.etag } : undefined;
      const res = await ghFetch(tok, "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator", headers ? { headers } : undefined);
      if (res.status === 304) {
        reposMeta.current.at = Date.now();
        return;
      }
      if (res.ok) {
        const data = (await res.json()) as GitHubRepo[];
        setRepos(data);
        reposMeta.current = { etag: res.headers.get("etag") ?? undefined, at: Date.now() };
        const slim = data.map(({ id, name, full_name, private: priv, html_url, default_branch, updated_at, description }) => ({
          id, name, full_name, private: priv, html_url, default_branch, updated_at, description,
        }));
        AsyncStorage.setItem(REPOS_CACHE_KEY, JSON.stringify(slim)).catch(() => undefined);
      }
    } finally {
      setReposLoading(false);
    }
  }

  async function loadBranches(tok: string, repo: GitHubRepo) {
    try {
      const res = await ghFetch(tok, `/repos/${repo.full_name}/branches`);
      if (res.ok) {
        const data = (await res.json()) as GitHubBranch[];
        setBranches(data);
      }
    } catch {/**/ }
  }

  async function loadCommits(tok: string, repo: GitHubRepo, branch: string) {
    try {
      const res = await ghFetch(tok, `/repos/${repo.full_name}/commits?sha=${encodeURIComponent(branch)}&per_page=30`);
      if (res.ok) {
        const data = (await res.json()) as GitHubCommit[];
        setCommits(Array.isArray(data) ? data : []);
      } else {
        setCommits([]);
      }
    } catch {
      setCommits([]);
    }
  }

  async function fetchRepos() {
    if (!token) return;
    await loadRepos(token);
  }

  async function refreshCommits() {
    if (!token || !selectedRepo) return;
    await loadCommits(token, selectedRepo, currentBranch);
  }

  async function selectRepo(repo: GitHubRepo | null) {
    setSelectedRepo(repo);
    setCommits([]);
    setBranches([]);
    if (!repo) {
      await AsyncStorage.removeItem(REPO_KEY);
      return;
    }
    await AsyncStorage.setItem(REPO_KEY, JSON.stringify(repo));
    const branch = repo.default_branch;
    setCurrentBranch(branch);
    await AsyncStorage.setItem(BRANCH_KEY, branch);
    if (token) {
      void loadBranches(token, repo);
      void loadCommits(token, repo, branch);
    }
  }

  async function selectBranch(branch: string) {
    setCurrentBranch(branch);
    setCommits([]);
    await AsyncStorage.setItem(BRANCH_KEY, branch);
    if (token && selectedRepo) {
      void loadCommits(token, selectedRepo, branch);
    }
  }

  /**
   * Écrit un fichier via la Contents API (PUT /contents/{path}).
   * fresh = true → relit un SHA frais (stratégie 2, anti-cache / conflit de SHA).
   */
  async function putContents(
    tok: string,
    repo: GitHubRepo,
    branch: string,
    path: string,
    content: string,
    message: string,
    fresh: boolean
  ): Promise<{ ok: boolean; error?: string }> {
    lastHead.current = null;
    const url = `/repos/${repo.full_name}/contents/${encPath(path)}`;
    const query = `?ref=${encodeURIComponent(branch)}${fresh ? `&t=${Date.now()}` : ""}`;

    let sha: string | undefined;
    const checkRes = await ghFetch(tok, url + query);
    if (checkRes.ok) {
      const existing = (await checkRes.json().catch(() => null)) as { sha?: string } | null;
      if (existing && !Array.isArray(existing) && existing.sha) sha = existing.sha;
    } else if (checkRes.status !== 404) {
      return { ok: false, error: await ghError(checkRes, "Impossible de lire le fichier") };
    }

    const body: Record<string, string> = { message, content, branch };
    if (sha) body.sha = sha;

    const res = await ghFetch(tok, url, { method: "PUT", body: JSON.stringify(body) });
    if (res.ok) return { ok: true };
    return { ok: false, error: await ghError(res, fresh ? "Contents API (retry)" : "Contents API") };
  }

  /** Stratégie 1 — Contents API (simple, fichiers < 1 Mo). */
  function pushStrategy1(tok: string, repo: GitHubRepo, branch: string, path: string, content: string, message: string) {
    return putContents(tok, repo, branch, path, content, message, false);
  }

  /** Stratégie 2 — Contents API avec SHA rafraîchi. */
  function pushStrategy2(tok: string, repo: GitHubRepo, branch: string, path: string, content: string, message: string) {
    return putContents(tok, repo, branch, path, content, message, true);
  }

  /**
   * Crée UN commit à partir de blobs déjà envoyés (arbre + commit + mise à jour
   * de la branche).
   * - Le premier essai part du dernier commit que nous avons nous-mêmes créé
   *   (évite la lecture périmée de GitHub entre deux lots).
   * - Si GitHub répond « not a fast forward » (422/409), on relit la branche
   *   en attendant de plus en plus longtemps et on recommence (6 essais).
   */
  async function commitTree(
    tok: string,
    repo: GitHubRepo,
    branch: string,
    entries: { path: string; sha: string }[],
    message: string
  ): Promise<{ ok: boolean; error?: string; emptyRepo?: boolean }> {
    const base = `/repos/${repo.full_name}`;
    const ref = encPath(branch);
    let lastErr = "";

    for (let attempt = 0; attempt < 6; attempt++) {
      let commitSha: string;
      let rootTreeSha: string;

      const known = lastHead.current;
      if (
        attempt === 0 &&
        known &&
        known.repo === repo.full_name &&
        known.branch === branch &&
        Date.now() - known.at < 120000
      ) {
        commitSha = known.commitSha;
        rootTreeSha = known.treeSha;
      } else {
        const refRes = await ghFetch(tok, `${base}/git/ref/heads/${ref}?t=${Date.now()}`);
        if (!refRes.ok) {
          const e = await ghError(refRes, "Impossible de lire la branche");
          return { ok: false, error: e, emptyRepo: refRes.status === 409 };
        }
        commitSha = ((await refRes.json()) as { object: { sha: string } }).object.sha;

        const commitRes = await ghFetch(tok, `${base}/git/commits/${commitSha}`);
        if (!commitRes.ok) return { ok: false, error: await ghError(commitRes, "Impossible de lire le commit") };
        rootTreeSha = ((await commitRes.json()) as { tree: { sha: string } }).tree.sha;
      }

      const treeRes = await ghFetch(tok, `${base}/git/trees`, {
        method: "POST",
        body: JSON.stringify({
          base_tree: rootTreeSha,
          tree: entries.map((b) => ({ path: b.path, mode: "100644", type: "blob", sha: b.sha })),
        }),
      });
      if (!treeRes.ok) return { ok: false, error: await ghError(treeRes, "Échec de la création de l'arbre") };
      const treeSha = ((await treeRes.json()) as { sha: string }).sha;

      const newCommitRes = await ghFetch(tok, `${base}/git/commits`, {
        method: "POST",
        body: JSON.stringify({ message, tree: treeSha, parents: [commitSha] }),
      });
      if (!newCommitRes.ok) return { ok: false, error: await ghError(newCommitRes, "Échec de la création du commit") };
      const newSha = ((await newCommitRes.json()) as { sha: string }).sha;

      const updateRes = await ghFetch(tok, `${base}/git/refs/heads/${ref}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: newSha }),
      });
      if (updateRes.ok) {
        lastHead.current = { repo: repo.full_name, branch, commitSha: newSha, treeSha, at: Date.now() };
        return { ok: true };
      }

      lastErr = await ghError(updateRes, "Échec de la mise à jour de la branche");
      if (updateRes.status === 422 || updateRes.status === 409) {
        lastHead.current = null; // tête connue périmée : on relit la branche
        await sleep(1500 * (attempt + 1));
        continue;
      }
      return { ok: false, error: lastErr };
    }
    return { ok: false, error: lastErr || "Échec de la mise à jour de la branche" };
  }

  /** Stratégie 3 — Git Data API (blob → arbre → commit → branche). */
  async function pushStrategy3(
    tok: string,
    repo: GitHubRepo,
    branch: string,
    path: string,
    content: string,
    message: string
  ): Promise<{ ok: boolean; error?: string }> {
    const blobRes = await ghFetch(tok, `/repos/${repo.full_name}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content, encoding: "base64" }),
    });
    if (!blobRes.ok) return { ok: false, error: await ghError(blobRes, "Stratégie 3 : impossible de créer le blob") };
    const blobSha = ((await blobRes.json()) as { sha: string }).sha;
    return commitTree(tok, repo, branch, [{ path, sha: blobSha }], message);
  }

  /**
   * pushFile — essaie les 3 stratégies dans l'ordre.
   * Retourne aussi le nom de la stratégie ayant réussi.
   */
  async function pushFile(
    path: string,
    content: string,
    message: string
  ): Promise<{ ok: boolean; error?: string; strategy?: string }> {
    if (!token || !selectedRepo) return { ok: false, error: "Non authentifié" };

    const errors: string[] = [];

    // Stratégie 1
    try {
      const r1 = await pushStrategy1(token, selectedRepo, currentBranch, path, content, message);
      if (r1.ok) {
        void loadCommits(token, selectedRepo, currentBranch);
        return { ok: true, strategy: "1" };
      }
      errors.push(`S1: ${r1.error}`);
    } catch (e) {
      errors.push(`S1: ${String(e)}`);
    }

    // Stratégie 2 (refetch SHA)
    try {
      const r2 = await pushStrategy2(token, selectedRepo, currentBranch, path, content, message);
      if (r2.ok) {
        void loadCommits(token, selectedRepo, currentBranch);
        return { ok: true, strategy: "2" };
      }
      errors.push(`S2: ${r2.error}`);
    } catch (e) {
      errors.push(`S2: ${String(e)}`);
    }

    // Stratégie 3 (Git Data API)
    try {
      const r3 = await pushStrategy3(token, selectedRepo, currentBranch, path, content, message);
      if (r3.ok) {
        void loadCommits(token, selectedRepo, currentBranch);
        return { ok: true, strategy: "3" };
      }
      errors.push(`S3: ${r3.error}`);
    } catch (e) {
      errors.push(`S3: ${String(e)}`);
    }

    return {
      ok: false,
      error: `Toutes les stratégies ont échoué :\n${errors.join("\n")}`,
    };
  }

  /**
   * pushFiles — pousse PLUSIEURS fichiers en UN SEUL commit via la Git Data
   * API : tous les blobs sont créés en parallèle, puis un seul arbre + un
   * seul commit + une seule mise à jour de branche. C'est la technique la
   * plus rapide pour un import groupé (ex: décompression d'un ZIP) — au
   * lieu d'un aller-retour réseau complet par fichier (et donc un commit
   * séparé par fichier), tout est envoyé en une poignée de requêtes.
   */
  async function pushFiles(
    files: { path: string; content: string }[],
    message: string,
    onProgress?: (done: number, total: number) => void
  ): Promise<{ ok: boolean; error?: string; pushedCount?: number }> {
    if (!token || !selectedRepo) return { ok: false, error: "Non authentifié" };
    if (files.length === 0) return { ok: false, error: "Aucun fichier à pousser" };

    try {
      const repoPath = `/repos/${selectedRepo.full_name}`;

      // Création des blobs avec une concurrence LIMITÉE (4 à la fois) et des
      // nouvelles tentatives : trop de requêtes simultanées déclenchent les
      // limites anti-abus de GitHub (403/429).
      let done = 0;
      const blobs = await mapPool(files, 4, async (f) => {
        const blobRes = await ghFetchRetry(token, `${repoPath}/git/blobs`, {
          method: "POST",
          body: JSON.stringify({ content: f.content, encoding: "base64" }),
        });
        if (!blobRes.ok) throw new Error(await ghError(blobRes, `Blob "${f.path}"`));
        const blobData = (await blobRes.json()) as { sha: string };
        done++;
        onProgress?.(done, files.length);
        return { path: f.path, sha: blobData.sha };
      });

      let res = await commitTree(token, selectedRepo, currentBranch, blobs, message);

      // Dépôt vide : l'API Git Data refuse (HTTP 409). On crée le premier
      // fichier avec la Contents API (ça crée le commit initial), puis le reste.
      if (!res.ok && res.emptyRepo) {
        const first = files[0];
        const r1 = await putContents(token, selectedRepo, currentBranch, first.path, first.content, message, false);
        if (!r1.ok) return { ok: false, error: r1.error };
        res = blobs.length > 1
          ? await commitTree(token, selectedRepo, currentBranch, blobs.slice(1), message)
          : { ok: true };
      }
      if (!res.ok) return { ok: false, error: res.error };

      void loadCommits(token, selectedRepo, currentBranch);
      return { ok: true, pushedCount: files.length };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Supprime des fichiers de la branche courante en UN commit.
   * On part de l'arbre existant (base_tree) et on marque chaque fichier à
   * supprimer avec sha: null. Plus fiable que reconstruire tout l'arbre :
   * pas d'arbre vide à créer (refusé par GitHub), sous-modules et liens
   * conservés, et reprise automatique si la branche a bougé (HTTP 422/409).
   * select reçoit la liste des chemins et renvoie ceux à supprimer.
   */
  async function removeFromBranch(
    select: (blobPaths: string[]) => string[],
    message: string,
    emptyMsg: string
  ): Promise<{ ok: boolean; error?: string; deletedCount?: number; skipped?: string[] }> {
    if (!token || !selectedRepo) return { ok: false, error: "Non authentifié" };
    const base = `/repos/${selectedRepo.full_name}`;
    const ref = encPath(currentBranch);
    let lastErr = "";
    lastHead.current = null;

    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const refRes = await ghFetch(token, `${base}/git/ref/heads/${ref}`);
        if (!refRes.ok) {
          if (refRes.status === 409) return { ok: false, error: emptyMsg };
          return { ok: false, error: await ghError(refRes, "Impossible de lire la branche") };
        }
        const commitSha = ((await refRes.json()) as { object: { sha: string } }).object.sha;

        const commitRes = await ghFetch(token, `${base}/git/commits/${commitSha}`);
        if (!commitRes.ok) return { ok: false, error: await ghError(commitRes, "Impossible de lire le commit") };
        const rootTreeSha = ((await commitRes.json()) as { tree: { sha: string } }).tree.sha;

        const treeRes = await ghFetch(token, `${base}/git/trees/${rootTreeSha}?recursive=1`);
        if (!treeRes.ok) return { ok: false, error: await ghError(treeRes, "Impossible de lire l'arborescence") };
        const treeData = (await treeRes.json()) as {
          tree: { path: string; mode: string; type: string; sha: string }[];
          truncated?: boolean;
        };

        let entries: { path: string; mode: string; type: string; sha: null }[];
        let totalCount = 0; // nombre d'éléments de l'arbre concernés par la sélection
        if (treeData.truncated) {
          // Arborescence tronquée par GitHub (dépôt énorme) : on ne peut pas
          // lister tous les fichiers. Pour vider tout le dépôt, on supprime les
          // entrées de premier niveau (dossiers inclus) ; sinon on refuse.
          const rootRes = await ghFetch(token, `${base}/git/trees/${rootTreeSha}`);
          if (!rootRes.ok) return { ok: false, error: await ghError(rootRes, "Impossible de lire la racine") };
          const rootTree = (await rootRes.json()) as { tree: { path: string; mode: string; type: string }[] };
          const wanted = select(rootTree.tree.map((e) => e.path));
          const all = wanted.length === rootTree.tree.length;
          if (!all) {
            return { ok: false, error: "Dépôt trop volumineux pour cette opération (arborescence tronquée par GitHub)" };
          }
          entries = rootTree.tree.map((e) => ({ path: e.path, mode: e.mode, type: e.type, sha: null }));
          totalCount = rootTree.tree.length;
        } else {
          const blobs = treeData.tree.filter((e) => e.type === "blob");
          const wanted = new Set(select(blobs.map((b) => b.path)));
          entries = blobs
            .filter((b) => wanted.has(b.path))
            .map((b) => ({ path: b.path, mode: b.mode, type: "blob", sha: null }));
          totalCount = blobs.length;
        }

        if (entries.length === 0) return { ok: false, error: emptyMsg };
        // Déjà vide (seul le fichier de remplacement existe) : rien à faire.
        if (entries.length === 1 && entries[0].path === PLACEHOLDER) return { ok: false, error: emptyMsg };

        // GitHub refuse de créer un arbre totalement vide (réponse « 404 Not
        // Found »). Si on supprime tout, on garde donc un fichier vide
        // « .gitkeep » pour que le commit reste valide.
        const createTree = (list: typeof entries) => {
          let tree: Record<string, unknown>[] = [...list];
          if (list.length >= totalCount) {
            tree = tree.filter((e) => e.path !== PLACEHOLDER);
            tree.push({ path: PLACEHOLDER, mode: "100644", type: "blob", content: "" });
          }
          return ghFetch(token, `${base}/git/trees`, {
            method: "POST",
            body: JSON.stringify({ base_tree: rootTreeSha, tree }),
          });
        };

        let newTreeRes = await createTree(entries);
        let skipped: string[] = [];

        // GitHub répond « 404 Not Found » quand on touche à .github/workflows
        // avec un token sans le scope « workflow ». On retire ces fichiers de
        // la suppression et on réessaie, au lieu de tout bloquer.
        const isWorkflow = (e: { path: string }) =>
          e.path === ".github" || e.path === ".github/workflows" || e.path.startsWith(".github/workflows/");
        if (!newTreeRes.ok && (newTreeRes.status === 404 || newTreeRes.status === 403 || newTreeRes.status === 422)) {
          const kept = entries.filter((e) => !isWorkflow(e));
          if (kept.length < entries.length) {
            skipped = entries.filter(isWorkflow).map((e) => e.path);
            if (kept.length === 0) {
              return {
                ok: false,
                skipped,
                error: "Seuls des fichiers .github/workflows restent : le token doit avoir le scope « workflow » (classique) ou « Workflows : Read and write » (fine-grained) pour les supprimer.",
              };
            }
            entries = kept;
            newTreeRes = await createTree(entries);
          }
        }
        if (!newTreeRes.ok) return { ok: false, error: await ghError(newTreeRes, "Échec de la création du nouvel arbre") };
        const newTreeSha = ((await newTreeRes.json()) as { sha: string }).sha;

        const newCommitRes = await ghFetch(token, `${base}/git/commits`, {
          method: "POST",
          body: JSON.stringify({ message, tree: newTreeSha, parents: [commitSha] }),
        });
        if (!newCommitRes.ok) return { ok: false, error: await ghError(newCommitRes, "Échec de la création du commit") };
        const newCommitSha = ((await newCommitRes.json()) as { sha: string }).sha;

        const updateRes = await ghFetch(token, `${base}/git/refs/heads/${ref}`, {
          method: "PATCH",
          body: JSON.stringify({ sha: newCommitSha }),
        });
        if (updateRes.ok) {
          void loadCommits(token, selectedRepo, currentBranch);
          return { ok: true, deletedCount: entries.length, skipped: skipped.length ? skipped : undefined };
        }

        lastErr = await ghError(updateRes, "Échec de la mise à jour de la branche");
        if (updateRes.status === 422 || updateRes.status === 409) {
          await sleep(800 * (attempt + 1));
          continue; // la branche a avancé : on recommence depuis la nouvelle tête
        }
        return { ok: false, error: lastErr };
      }
      return { ok: false, error: lastErr || "Échec de la mise à jour de la branche" };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function deleteDirectory(
    dirPath: string,
    message: string
  ): Promise<{ ok: boolean; error?: string; deletedCount?: number; skipped?: string[] }> {
    const cleanDir = dirPath.trim().replace(/^\/+/, "").replace(/\/+$/, "");
    if (!cleanDir) return { ok: false, error: "Chemin de répertoire invalide" };
    return removeFromBranch(
      (paths) => paths.filter((p) => p === cleanDir || p.startsWith(`${cleanDir}/`)),
      message,
      "Répertoire introuvable ou déjà vide"
    );
  }

  async function clearRepo(
    message: string
  ): Promise<{ ok: boolean; error?: string; deletedCount?: number; skipped?: string[] }> {
    return removeFromBranch((paths) => paths, message, "Le dépôt est déjà vide");
  }

  /**
   * Supprime DÉFINITIVEMENT plusieurs dépôts GitHub (DELETE /repos/{owner}/{repo}),
   * un par un. Nécessite le scope « delete_repo » (token classique) ou
   * « Administration : Read and write » (fine-grained).
   */
  async function deleteRepos(
    fullNames: string[]
  ): Promise<{ ok: boolean; deleted: string[]; failed: { name: string; error: string }[]; needsScope: boolean }> {
    const deleted: string[] = [];
    const failed: { name: string; error: string }[] = [];
    let needsScope = false;

    if (!token) {
      return { ok: false, deleted, failed: fullNames.map((name) => ({ name, error: "Non authentifié" })), needsScope };
    }

    for (const name of fullNames) {
      try {
        const res = await ghFetch(token, `/repos/${name}`, { method: "DELETE" });
        if (res.ok) {
          deleted.push(name);
        } else {
          if (res.status === 403 || res.status === 404) needsScope = true;
          failed.push({ name, error: await ghError(res, "Échec") });
        }
      } catch (e) {
        failed.push({ name, error: e instanceof Error ? e.message : String(e) });
      }
    }

    if (deleted.length > 0) {
      if (selectedRepo && deleted.includes(selectedRepo.full_name)) await selectRepo(null);
      void loadRepos(token);
    }
    return { ok: failed.length === 0, deleted, failed, needsScope };
  }

  return (
    <GitHubContext.Provider
      value={{
        token, user, repos, selectedRepo, branches, currentBranch,
        commits, loading, reposLoading,
        login, logout, selectRepo, selectBranch,
        fetchRepos, refreshCommits, pushFile, pushFiles, deleteDirectory, clearRepo, deleteRepos,
      }}
    >
      {children}
    </GitHubContext.Provider>
  );
}

export function useGitHub() {
  const ctx = useContext(GitHubContext);
  if (!ctx) throw new Error("useGitHub must be inside GitHubProvider");
  return ctx;
}
