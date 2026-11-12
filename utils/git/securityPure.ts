/**
 * Règles de sécurité pures (sans React Native) : testables avec `npm test`.
 * Corrections de l'audit du 12/11/2026 (AUDIT-001, 002, 003, 006, 008, 009, 012, 014, 019).
 */

/** Hôte (minuscules, sans port ni identifiants) d'une URL http(s) ; "" si illisible. */
export function hostOfUrl(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^/:?#]+)/i.exec(String(url ?? "").trim());
  return m ? m[1].toLowerCase().replace(/\.$/, "") : "";
}

/** Résout un en-tête Location (absolu, //hôte, /chemin ou relatif) sans dépendre de l'URL de React Native. */
export function resolveLocation(location: string, base: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(location)) return location;
  const m = /^([a-z][a-z0-9+.-]*:)\/\/([^/?#]*)([^?#]*)/i.exec(base);
  if (!m) return location;
  const [, scheme, authority, path] = m;
  if (location.startsWith("//")) return `${scheme}${location}`;
  if (location.startsWith("/")) return `${scheme}//${authority}${location}`;
  const dir = path.replace(/[^/]*$/, "") || "/";
  return `${scheme}//${authority}${dir}${location}`;
}

// ─── AUDIT-001 : identifiants liés à des hôtes ────────────────────────────────

export type AuthKind = "github" | "account" | "basic" | "none";

/**
 * Hôtes auxquels les identifiants d'un dépôt peuvent être envoyés.
 * - github  : uniquement github.com (le token GitHub ne doit jamais partir ailleurs) ;
 * - account : l'hôte de la forge du compte ;
 * - basic   : l'hôte de l'URL du dépôt telle qu'enregistrée.
 */
export function credentialHosts(auth: AuthKind, repoUrl: string, accountBaseUrl?: string): string[] {
  if (auth === "github") return ["github.com"];
  if (auth === "account") {
    const h = accountBaseUrl ? hostOfUrl(/^[a-z]+:\/\//i.test(accountBaseUrl) ? accountBaseUrl : `https://${accountBaseUrl}`) : "";
    return h ? [h] : [];
  }
  if (auth === "basic") {
    const h = hostOfUrl(repoUrl);
    return h ? [h] : [];
  }
  return [];
}

/** Vrai si une requête vers `url` peut porter les identifiants. */
export function credentialAllowed(url: string, hosts: readonly string[] | undefined): boolean {
  if (!hosts || hosts.length === 0) return false;
  const h = hostOfUrl(url);
  return !!h && hosts.includes(h);
}

/** Copie des en-têtes sans « Authorization » si l'hôte n'est pas autorisé. */
export function stripForeignAuth(url: string, headers: Record<string, string> | undefined, hosts: readonly string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const allowed = credentialAllowed(url, hosts);
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (!allowed && k.toLowerCase() === "authorization") continue;
    out[k] = v;
  }
  return out;
}

// ─── AUDIT-002 : une seule opération en vol PAR clé ───────────────────────────

/** Partage les appels simultanés de même clé, sans jamais mélanger deux clés. */
export function createSingleFlight<T>() {
  const inflight = new Map<string, Promise<T>>();
  return (key: string, fn: () => Promise<T>): Promise<T> => {
    const known = inflight.get(key);
    if (known) return known;
    const p = (async () => {
      try {
        return await fn();
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  };
}

// ─── AUDIT-003 : liens gitcrush://sync ─────────────────────────────────────────

/** Comparaison en temps constant (longueur comprise). */
function sameSecret(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/**
 * Un lien de synchronisation ne s'exécute seul que s'il porte la clé secrète de
 * cette installation (tuile, widget, service d'accessibilité). Sinon : confirmation.
 */
export function syncIntentDecision(keyParam: string | undefined | null, expectedKey: string | undefined | null): "run" | "confirm" {
  if (!expectedKey || expectedKey.length < 16 || !keyParam) return "confirm";
  return sameSecret(String(keyParam), expectedKey) ? "run" : "confirm";
}

// ─── AUDIT-008 / AUDIT-009 : chemins relatifs au dépôt ────────────────────────

/**
 * Normalise un chemin relatif au dépôt : retire « ./ », les « / » en trop et les
 * segments « . ». Refuse « .. ». Le résultat vide désigne la racine du dépôt.
 */
export function cleanRelPath(p: unknown): string {
  const raw = String(p ?? "").trim().replace(/\\/g, "/");
  const segs = raw.split("/").filter((s) => s !== "" && s !== ".");
  if (segs.some((s) => s === "..")) throw new Error(`Chemin refusé : ${raw}`);
  return segs.join("/");
}

/** Chemin modifiable (écriture / suppression / déplacement) : ni racine, ni .git. */
export function isWritableRelPath(rel: string): boolean {
  if (!rel) return false;
  const first = rel.split("/")[0].toLowerCase();
  return first !== ".git";
}

/** Version « sans exception » pour les paramètres de route (null si refusé). */
export function safeRouteRelPath(p: unknown): string | null {
  try {
    return cleanRelPath(p);
  } catch {
    return null;
  }
}

// ─── AUDIT-006 : fichiers sensibles exclus de l'indexation automatique ────────

export function isSensitiveFile(path: string): boolean {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  if (/^\.env(\..+)?$/.test(name)) return !/\.(example|sample|template|dist|defaults)$/.test(name);
  if (/\.(pem|key|p12|pfx|jks|keystore|ppk|p8|mobileprovision)$/.test(name)) return true;
  if (/^(id_rsa|id_dsa|id_ecdsa|id_ed25519)$/.test(name)) return true;
  return [".netrc", ".git-credentials", ".pgpass", "credentials", "credentials.json", "service-account.json", "secrets.json", "keystore.properties", "local.properties"].includes(name);
}

/**
 * Fichiers à indexer automatiquement : les fichiers sensibles NON SUIVIS sont exclus
 * (un fichier sensible déjà suivi reste géré normalement : il est déjà dans l'historique).
 */
export function autoStagePaths(items: { path: string; unstaged: boolean; row: [number, number, number] }[]): { stage: string[]; skipped: string[] } {
  const stage: string[] = [];
  const skipped: string[] = [];
  for (const it of items) {
    if (!it.unstaged) continue;
    const untracked = it.row[0] === 0 && it.row[2] === 0;
    if (untracked && isSensitiveFile(it.path)) skipped.push(it.path);
    else stage.push(it.path);
  }
  return { stage, skipped };
}

// ─── AUDIT-012 : fichiers non suivis menacés par une fusion ───────────────────

/** Chemins non suivis (absents de HEAD et de l'index, présents sur le disque) d'une statusMatrix. */
export function untrackedFromMatrix(rows: readonly [string, number, number, number][]): string[] {
  return rows.filter(([, head, wd, stage]) => head === 0 && wd === 2 && stage === 0).map(([p]) => p);
}

/**
 * Fichiers non suivis qu'une fusion écraserait : présents dans la branche fusionnée
 * avec un contenu différent du fichier local.
 */
export function untrackedAtRisk(
  untracked: readonly string[],
  incoming: (path: string) => Uint8Array | null,
  local: (path: string) => Uint8Array | null
): string[] {
  const out: string[] = [];
  for (const p of untracked) {
    const theirs = incoming(p);
    if (!theirs) continue;
    const mine = local(p);
    if (!mine || mine.length !== theirs.length || mine.some((b, i) => b !== theirs[i])) out.push(p);
  }
  return out;
}

// ─── AUDIT-014 : mises à jour séquentielles d'une liste ───────────────────────

/** File d'écritures qui applique chaque modification sur la valeur COURANTE. */
export function createSerialUpdater<T>(read: () => Promise<T>, write: (v: T) => Promise<void>) {
  let chain: Promise<unknown> = Promise.resolve();
  return (change: (current: T) => T): Promise<T> => {
    const next = chain.then(async () => {
      const value = change(await read());
      await write(value);
      return value;
    });
    chain = next.catch(() => undefined);
    return next;
  };
}

// ─── AUDIT-019 : planification persistante ────────────────────────────────────

/** Faut-il (ré)inscrire la tâche ? On compare avec l'intervalle MÉMORISÉ, pas avec l'état du processus. */
export function scheduleAction(registered: boolean, storedMinutes: number | null, wantedMinutes: number | null): "keep" | "register" | "unregister" {
  if (wantedMinutes === null) return registered ? "unregister" : "keep";
  if (registered && storedMinutes === wantedMinutes) return "keep";
  return "register";
}
