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
    const lists = await mapLimit(level, 8, (d) => listEntries(d).catch(() => []));
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
  const repos: Usage["repos"] = [];
  for (const c of containers) {
    repos.push({ id: c.id, name: c.name, bytes: await dirSize(`${REPOS_PATH}/${c.folder}`) });
    tick();
  }
  const orphans: Usage["orphans"] = [];
  for (const folder of orphanNames) {
    orphans.push({ folder, bytes: await dirSize(`${REPOS_PATH}/${folder}`) });
    tick();
  }
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
