/**
 * Logique pure de la page d'accueil (aucune dépendance React / Expo) :
 * choix du dépôt visé par un raccourci, favoris, activité récente.
 * Testée par `npm test` (tests/home.test.mjs).
 */

export interface RepoLike {
  id: string;
  name: string;
  branch?: string;
  createdAt?: number;
  favorite?: boolean;
  lastOpenedAt?: number;
  pendingRetry?: boolean;
  merge?: { conflicts: string[]; resolved: string[] } | null;
  lastSync?: { at: number; ok: boolean; reason?: string; error?: string };
}

export type SyncState = "conflict" | "failed" | "waiting" | "never" | "ok";

/** Nombre de fichiers encore en conflit pour un dépôt (0 si aucune fusion en cours). */
export function conflictCount(c: RepoLike): number {
  if (!c.merge) return 0;
  return c.merge.conflicts.filter((p) => !c.merge!.resolved.includes(p)).length;
}

/** État de synchronisation affiché sur les cartes (priorité : conflit > échec > hors ligne > jamais > ok). */
export function syncState(c: RepoLike): SyncState {
  if (c.merge) return "conflict";
  if (c.lastSync && !c.lastSync.ok) return "failed";
  if (c.pendingRetry) return "waiting";
  if (!c.lastSync) return "never";
  return "ok";
}

/** Dépôts ouverts récemment (du plus récent au plus ancien) ; ceux jamais ouverts sont ignorés. */
export function recentRepos<T extends RepoLike>(list: T[], limit = 6): T[] {
  return list
    .filter((c) => typeof c.lastOpenedAt === "number")
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
    .slice(0, limit);
}

/** Dépôts favoris, triés par nom. */
export function favoriteRepos<T extends RepoLike>(list: T[]): T[] {
  return list.filter((c) => c.favorite).sort((a, b) => a.name.localeCompare(b.name));
}

export interface RecentOp {
  id: string;
  name: string;
  at: number;
  ok: boolean;
  reason?: string;
}

/** Dernières synchronisations réellement effectuées, toutes sources confondues. */
export function recentOps(list: RepoLike[], limit = 4): RecentOp[] {
  return list
    .filter((c) => !!c.lastSync)
    .map((c) => ({ id: c.id, name: c.name, at: c.lastSync!.at, ok: c.lastSync!.ok, reason: c.lastSync!.reason }))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

export type RepoTarget =
  | { kind: "none" }
  | { kind: "direct"; id: string }
  | { kind: "choose"; ids: string[] };

/**
 * Quel dépôt un raccourci doit-il ouvrir ?
 * - aucun dépôt cloné → « none » (on guide vers le clonage) ;
 * - un seul → ouverture directe ;
 * - plusieurs → l'utilisateur choisit.
 * `needConflicts` : pour le raccourci « Conflits », on ne propose que les dépôts réellement en conflit s'il y en a.
 */
export function resolveRepoTarget(list: RepoLike[], needConflicts = false): RepoTarget {
  if (!list.length) return { kind: "none" };
  const pool = needConflicts && list.some((c) => c.merge) ? list.filter((c) => c.merge) : list;
  if (pool.length === 1) return { kind: "direct", id: pool[0].id };
  return { kind: "choose", ids: pool.map((c) => c.id) };
}

/** Throttle : ne réécrit « dernière ouverture » que si la valeur a plus d'une minute. */
export function shouldTouchOpened(c: RepoLike, now: number): boolean {
  return !c.lastOpenedAt || now - c.lastOpenedAt > 60_000;
}
