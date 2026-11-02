/**
 * Adaptateur « fs » (API promesses façon Node) au-dessus d'expo-file-system,
 * au format attendu par isomorphic-git, + petites fonctions utilitaires pour
 * l'explorateur de fichiers.
 *
 * isomorphic-git manipule des chemins POSIX (/data/user/0/…/files/repos/x/…) ;
 * expo-file-system attend des URI file:// encodées. Les codes d'erreur Node
 * (ENOENT, EEXIST, ENOTEMPTY…) sont reproduits car isomorphic-git s'en sert.
 */
import { Buffer } from "buffer";
import * as FS from "expo-file-system/legacy";

const DOC = FS.documentDirectory ?? "file:///data/local/tmp/";

/** Dossier documents de l'app, en chemin POSIX sans « / » final. */
export const ROOT_PATH = decodeURIComponent(DOC.replace(/^file:\/\//, "")).replace(/\/+$/, "");
/** Dossier qui contient tous les dépôts clonés (les « conteneurs »). */
export const REPOS_PATH = `${ROOT_PATH}/repos`;

export function toUri(path: string): string {
  const clean = String(path).replace(/\/+/g, "/");
  return "file://" + clean.split("/").map((seg) => encodeURIComponent(seg)).join("/");
}

function fsError(code: string, path: string): Error & { code: string } {
  const e = new Error(`${code}: ${path}`) as Error & { code: string; errno: string; path: string };
  e.code = code;
  e.errno = code;
  e.path = path;
  return e;
}

type Info = { exists: boolean; isDirectory: boolean; size: number; modificationTime: number };

async function info(path: string): Promise<Info> {
  const i = (await FS.getInfoAsync(toUri(path))) as any;
  return {
    exists: !!i.exists,
    isDirectory: !!i.isDirectory,
    size: typeof i.size === "number" ? i.size : 0,
    modificationTime: typeof i.modificationTime === "number" ? i.modificationTime : 0,
  };
}

function makeStats(isDir: boolean, size: number, mtimeSec: number) {
  const ms = Math.floor(mtimeSec * 1000);
  return {
    type: isDir ? "dir" : "file",
    mode: isDir ? 0o40000 : 0o100644,
    size,
    ino: 0,
    dev: 0,
    uid: 0,
    gid: 0,
    mtimeMs: ms,
    ctimeMs: ms,
    mtime: new Date(ms),
    ctime: new Date(ms),
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isSymbolicLink: () => false,
  };
}

function encodingOf(opts: unknown): string | undefined {
  if (typeof opts === "string") return opts;
  if (opts && typeof opts === "object" && "encoding" in opts) return (opts as { encoding?: string }).encoding;
  return undefined;
}

function toBase64(data: unknown, enc?: string): string {
  if (typeof data === "string") return Buffer.from(data, (enc as BufferEncoding) || "utf8").toString("base64");
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString("base64");
  const v = data as Uint8Array;
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
}

const promises = {
  async readFile(path: string, opts?: unknown): Promise<string | Buffer> {
    if (typeof path !== "string") throw fsError("EINVAL", String(path));
    const i = await info(path);
    if (!i.exists) throw fsError("ENOENT", path);
    if (i.isDirectory) throw fsError("EISDIR", path);
    const enc = encodingOf(opts);
    if (enc === "utf8" || enc === "utf-8") {
      return FS.readAsStringAsync(toUri(path), { encoding: FS.EncodingType.UTF8 });
    }
    const b64 = await FS.readAsStringAsync(toUri(path), { encoding: FS.EncodingType.Base64 });
    return Buffer.from(b64, "base64");
  },

  async writeFile(path: string, data: unknown, opts?: unknown): Promise<void> {
    const enc = encodingOf(opts);
    if (typeof data === "string" && (!enc || enc === "utf8" || enc === "utf-8")) {
      await FS.writeAsStringAsync(toUri(path), data, { encoding: FS.EncodingType.UTF8 });
      return;
    }
    await FS.writeAsStringAsync(toUri(path), toBase64(data, enc), { encoding: FS.EncodingType.Base64 });
  },

  async mkdir(path: string): Promise<void> {
    const i = await info(path);
    if (i.exists) throw fsError("EEXIST", path);
    await FS.makeDirectoryAsync(toUri(path), { intermediates: true });
  },

  async rmdir(path: string): Promise<void> {
    const i = await info(path);
    if (!i.exists) throw fsError("ENOENT", path);
    if (!i.isDirectory) throw fsError("ENOTDIR", path);
    const list = await FS.readDirectoryAsync(toUri(path));
    if (list.length > 0) throw fsError("ENOTEMPTY", path);
    await FS.deleteAsync(toUri(path), { idempotent: true });
  },

  async rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const i = await info(path);
    if (!i.exists) {
      if (opts?.force) return;
      throw fsError("ENOENT", path);
    }
    await FS.deleteAsync(toUri(path), { idempotent: true });
  },

  async unlink(path: string): Promise<void> {
    const i = await info(path);
    if (!i.exists) throw fsError("ENOENT", path);
    if (i.isDirectory) throw fsError("EISDIR", path);
    await FS.deleteAsync(toUri(path), { idempotent: true });
  },

  async stat(path: string) {
    const i = await info(path);
    if (!i.exists) throw fsError("ENOENT", path);
    return makeStats(i.isDirectory, i.size, i.modificationTime);
  },

  async lstat(path: string) {
    const i = await info(path);
    if (!i.exists) throw fsError("ENOENT", path);
    return makeStats(i.isDirectory, i.size, i.modificationTime);
  },

  async readdir(path: string): Promise<string[]> {
    const i = await info(path);
    if (!i.exists) throw fsError("ENOENT", path);
    if (!i.isDirectory) throw fsError("ENOTDIR", path);
    return FS.readDirectoryAsync(toUri(path));
  },

  // Pas de vrais liens symboliques sur Android sans code natif : le lien est
  // stocké comme un petit fichier texte contenant sa cible.
  async readlink(path: string): Promise<string> {
    return (await promises.readFile(path, "utf8")) as string;
  },

  async symlink(target: string, path: string): Promise<void> {
    await promises.writeFile(path, target, "utf8");
  },

  async chmod(): Promise<void> {
    /* non supporté : ignoré */
  },
};

// ─── Notification des écritures (invalide les caches : statut Git…) ───────────

let writeHook: ((path: string) => void) | null = null;

/** Enregistre une fonction appelée avec le chemin de chaque fichier ou dossier modifié. */
export function onRepoWrite(fn: (path: string) => void) {
  writeHook = fn;
}

function touched(path: unknown) {
  if (writeHook && typeof path === "string") writeHook(path);
}

for (const name of ["writeFile", "mkdir", "rmdir", "rm", "unlink", "symlink"] as const) {
  const orig = (promises as any)[name] as (...a: any[]) => Promise<unknown>;
  (promises as any)[name] = async (...args: any[]) => {
    const r = await orig(...args);
    touched(name === "symlink" ? args[1] : args[0]);
    return r;
  };
}

/** Exécute fn sur chaque élément, `limit` à la fois (évite de saturer le stockage sur les gros dossiers). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Objet passé à isomorphic-git (`fs`). */
export const fs = { promises };

// ─── Fonctions utilitaires pour l'interface ───────────────────────────────────

export type Entry = { name: string; path: string; isDir: boolean; size: number; mtime: number };

export async function listEntries(absDir: string): Promise<Entry[]> {
  const names = await FS.readDirectoryAsync(toUri(absDir));
  const entries = await mapLimit<string, Entry>(names as string[], 16, async (name) => {
    const p = `${absDir}/${name}`;
    const i = await info(p);
    return { name, path: p, isDir: i.isDirectory, size: i.size, mtime: i.modificationTime };
  });
  return entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
}

export async function pathInfo(abs: string): Promise<Info> {
  return info(abs);
}

export async function pathExists(abs: string): Promise<boolean> {
  return (await info(abs)).exists;
}

export async function makeDir(abs: string): Promise<void> {
  if (await pathExists(abs)) return;
  await FS.makeDirectoryAsync(toUri(abs), { intermediates: true });
}

function parentOf(abs: string): string {
  return abs.replace(/\/[^/]+\/?$/, "") || "/";
}

export async function readBytes(abs: string): Promise<Uint8Array | null> {
  const i = await info(abs);
  if (!i.exists || i.isDirectory) return null;
  const b64 = await FS.readAsStringAsync(toUri(abs), { encoding: FS.EncodingType.Base64 });
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export async function writeBytesDeep(abs: string, data: Uint8Array): Promise<void> {
  await makeDir(parentOf(abs));
  await FS.writeAsStringAsync(toUri(abs), toBase64(data), { encoding: FS.EncodingType.Base64 });
  touched(abs);
}

export async function readText(abs: string): Promise<string | null> {
  const i = await info(abs);
  if (!i.exists || i.isDirectory) return null;
  return FS.readAsStringAsync(toUri(abs), { encoding: FS.EncodingType.UTF8 });
}

export async function writeTextDeep(abs: string, text: string): Promise<void> {
  await makeDir(parentOf(abs));
  await FS.writeAsStringAsync(toUri(abs), text, { encoding: FS.EncodingType.UTF8 });
  touched(abs);
}

export async function removePath(abs: string): Promise<void> {
  await FS.deleteAsync(toUri(abs), { idempotent: true });
  touched(abs);
}

export async function movePath(from: string, to: string): Promise<void> {
  await makeDir(parentOf(to));
  await FS.moveAsync({ from: toUri(from), to: toUri(to) });
  touched(from);
  touched(to);
}

export function decodeUtf8(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");
}

export function encodeUtf8(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "utf8"));
}
