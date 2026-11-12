/**
 * Espace disque : taille de chaque dépôt cloné et dossiers orphelins
 * (restes d'un clonage interrompu) qui ne servent plus à rien.
 */
import { listEntries, mapLimit, pathExists, REPOS_PATH, removePath } from "./fs";
import type { Container } from "./store";

/** Taille totale d'un dossier (octets). `onTick` reçoit le cumul au fil du calcul. */
export async function dirSize(abs: string, onTick?: (bytes: number) => void): Promise<number> {
  let total = 0;
  let level = [abs];
  while (level.length) {
    const lists = await mapLimit(level, 4, (d) => listEntries(d).catch(() => []));
    const next: string[] = [];
    for (const list of lists) {
      for (const e of list) {
        if (e.isDir) next.push(e.path);
        else total += e.size;
      }
    }
    onTick?.(total);
    level = next;
  }
  return total;
}

export interface Usage {
  repos: { id: string; name: string; bytes: number }[];
  orphans: { folder: string; bytes: number }[];
  total: number;
}

export async function measureUsage(containers: Container[], onProgress?: (done: number, total: number) => void): Promise<Usage> {
  const known = new Set(containers.map((c) => c.folder));
  const orphanNames = (await pathExists(REPOS_PATH)) ? (await listEntries(REPOS_PATH)).filter((e) => e.isDir && !known.has(e.name)).map((e) => e.name) : [];
  const jobs = containers.length + orphanNames.length;
  let done = 0;
  const tick = () => onProgress?.(++done, jobs);
  // Mesure quelques dépôts en parallèle sans saturer le stockage mobile.
  const repoResults = await mapLimit(containers, 2, async (c) => {
    const bytes = await dirSize(`${REPOS_PATH}/${c.folder}`);
    tick();
    return { id: c.id, name: c.name, bytes };
  });
  const orphanResults = await mapLimit(orphanNames, 2, async (folder) => {
    const bytes = await dirSize(`${REPOS_PATH}/${folder}`);
    tick();
    return { folder, bytes };
  });
  const repos: Usage["repos"] = repoResults;
  const orphans: Usage["orphans"] = orphanResults;
  repos.sort((a, b) => b.bytes - a.bytes);
  const total = repos.reduce((n, r) => n + r.bytes, 0) + orphans.reduce((n, o) => n + o.bytes, 0);
  return { repos, orphans, total };
}

/** Supprime les dossiers orphelins ; renvoie le nombre d'octets libérés. */
export async function removeOrphans(orphans: Usage["orphans"]): Promise<number> {
  let freed = 0;
  for (const o of orphans) {
    await removePath(`${REPOS_PATH}/${o.folder}`).catch(() => undefined);
    freed += o.bytes;
  }
  return freed;
}
