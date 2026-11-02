/**
 * Création d'un NOUVEAU dépôt : dossier local initialisé (git init) et, au choix,
 * dépôt distant créé sur GitHub puis relié comme « origin ».
 * Module sans React : utilisable par l'écran « Nouveau dépôt » comme par l'agent IA.
 */
import { slugRepoName } from "@/utils/ai/pure";
import { getGitHubToken } from "@/utils/secrets";

export { slugRepoName };

import * as engine from "./engine";
import { makeDir, removePath } from "./fs";
import { addContainer, DEFAULT_SYNC, loadContainers, newId, repoDir, type Container } from "./store";

export interface NewRepoOptions {
  name: string;
  description?: string;
  /** Crée aussi le dépôt sur GitHub (nécessite d'être connecté). */
  onGitHub: boolean;
  isPrivate: boolean;
  author: engine.Author;
  branch?: string;
}

export async function hasGitHubToken(): Promise<boolean> {
  return !!(await getGitHubToken());
}

async function createOnGitHub(token: string, name: string, description: string, isPrivate: boolean): Promise<string> {
  const res = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ name, description, private: isPrivate, auto_init: false }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (res.ok) return String(json.clone_url);
  if (res.status === 422) throw new Error(`Un dépôt « ${name} » existe déjà sur ton compte GitHub (ou le nom est invalide).`);
  if (res.status === 401) throw new Error("Token GitHub invalide ou expiré : reconnecte-toi.");
  if (res.status === 403 || res.status === 404) {
    throw new Error("GitHub refuse la création : il faut un token classique avec le scope « repo » (les tokens fine-grained ne peuvent pas créer de dépôt).");
  }
  throw new Error(`GitHub : HTTP ${res.status} — ${json?.message ?? "erreur"}`);
}

export async function createRepository(o: NewRepoOptions): Promise<Container> {
  const name = slugRepoName(o.name);
  if (!name) throw new Error("Nom de dépôt invalide (lettres, chiffres, - _ . uniquement).");
  const existing = (await loadContainers()).find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (existing) throw new Error(`Un dépôt local nommé « ${name} » existe déjà.`);

  let url = "";
  if (o.onGitHub) {
    const token = await getGitHubToken();
    if (!token) throw new Error("Connexion GitHub requise pour créer le dépôt distant.");
    url = await createOnGitHub(token, name, o.description ?? "", o.isPrivate);
  }

  const id = newId();
  const c: Container = {
    id,
    name,
    url,
    folder: id,
    createdAt: Date.now(),
    auth: o.onGitHub ? "github" : "none",
    author: o.author,
    remote: "origin",
    sync: { ...DEFAULT_SYNC },
    merge: null,
  };
  const dir = repoDir(c);
  try {
    await makeDir(dir);
    await engine.initRepo(dir, o.author, o.branch || "main");
    if (url) await engine.addRemote(dir, "origin", url);
    c.branch = o.branch || "main";
    await addContainer(c);
  } catch (e) {
    engine.dropCache(dir);
    await removePath(dir).catch(() => undefined);
    throw e;
  }
  return c;
}
