/**
 * Découpage d'un gros import (zip) pour respecter les limites de GitHub.
 *
 * 1. LOTS : au lieu d'un seul commit géant, les fichiers sont envoyés par
 *    lots successifs (un commit par lot) limités en taille et en nombre
 *    de fichiers. La mémoire est libérée entre chaque lot.
 * 2. GROS FICHIERS : GitHub refuse tout fichier > 100 Mo via l'API. Un
 *    fichier au-dessus de 80 Mo est découpé en parties de 36 Mo :
 *    nom.part001, nom.part002, … (à recoller avec `cat nom.part* > nom`).
 *    Il n'y a donc plus de limite de taille totale.
 * 3. PIPELINE : pendant qu'un lot est envoyé, le lot suivant est déjà lu et
 *    décompressé (au plus un lot en vol → 2 lots en mémoire maximum).
 */

/** Taille max d'un lot, en caractères base64 (~30 Mo de données brutes). */
export const MAX_BATCH_B64 = 40 * 1024 * 1024;
/** Nombre max de fichiers par lot (= par commit). */
export const MAX_BATCH_FILES = 400;
/** Au-dessus de 80 Mo bruts, un fichier est découpé en parties (limite GitHub : 100 Mo). */
export const SPLIT_ABOVE_B64 = Math.ceil((80 * 1024 * 1024) / 3) * 4;
/**
 * Taille d'une partie : 36 Mo bruts. Multiple de 3 octets → les tranches de
 * base64 (multiples de 4 caractères) restent chacune un base64 valide.
 */
export const PART_B64 = ((36 * 1024 * 1024) / 3) * 4;

export type PushFilesFn = (
  files: { path: string; content: string }[],
  message: string,
  onProgress?: (done: number, total: number) => void
) => Promise<{ ok: boolean; error?: string; pushedCount?: number }>;

export interface BatchSummary {
  ok: boolean;
  error?: string;
  /** Nombre de commits créés. */
  commits: number;
  /** Nombre de fichiers d'origine entièrement poussés. */
  filesPushed: number;
  /** Chemins des fichiers qui ont dû être découpés en parties. */
  splitFiles: string[];
}

/** Découpe un contenu base64 en tranches valides de PART_B64 caractères. */
export function splitBase64(content: string): string[] {
  if (content.length <= SPLIT_ABOVE_B64) return [content];
  const parts: string[] = [];
  for (let i = 0; i < content.length; i += PART_B64) {
    parts.push(content.slice(i, i + PART_B64));
  }
  return parts;
}

export function partPath(path: string, index: number): string {
  return `${path}.part${String(index + 1).padStart(3, "0")}`;
}

interface Item {
  path: string;
  content: string;
}

export function createBatchPusher(opts: {
  push: PushFilesFn;
  message: string;
  /** done = fichiers d'origine poussés (progression fine à l'intérieur d'un lot). */
  onProgress?: (done: number) => void;
  /** Appelé au début de l'envoi de chaque lot (numéro 1, 2, 3, …). */
  onBatch?: (n: number) => void;
}) {
  let batch: Item[] = [];
  let batchBytes = 0;
  let batchOrig = 0;
  let launched = 0; // lots lancés (numérotation des commits)
  let commits = 0; // lots terminés avec succès
  let filesPushed = 0;
  let error: string | undefined;
  let inflight: Promise<void> | null = null;
  const splitFiles: string[] = [];

  /** Attend le lot en cours d'envoi. Retourne false s'il a échoué. */
  async function waitInflight(): Promise<boolean> {
    if (inflight) {
      await inflight;
      inflight = null;
    }
    return !error;
  }

  async function send(items: Item[], orig: number, n: number, message: string): Promise<void> {
    opts.onBatch?.(n);
    let res: { ok: boolean; error?: string };
    try {
      res = await opts.push(items, message, (done, total) => {
        const inBatch = total > 0 ? Math.floor((orig * done) / total) : 0;
        opts.onProgress?.(filesPushed + inBatch);
      });
    } catch (e) {
      res = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (!res.ok) {
      error = res.error ?? "Échec de l'envoi";
      return;
    }
    commits = n;
    filesPushed += orig;
    opts.onProgress?.(filesPushed);
  }

  /**
   * Lance l'envoi du lot courant SANS l'attendre : le lot suivant peut être
   * lu pendant ce temps. Les commits restent séquentiels (on attend le
   * précédent avant de lancer le suivant).
   */
  async function flush(final: boolean): Promise<boolean> {
    if (!(await waitInflight())) return false;
    if (batch.length === 0) return true;

    const items = batch;
    const orig = batchOrig;
    batch = [];
    batchBytes = 0;
    batchOrig = 0;

    const n = ++launched;
    // Si ce n'est pas le dernier flush, d'autres lots suivent forcément.
    const multi = !final || n > 1;
    const message = multi ? `${opts.message} (lot ${n})` : opts.message;
    inflight = send(items, orig, n, message);
    return true;
  }

  /**
   * Ajoute un fichier (contenu base64). Découpe automatiquement s'il est
   * trop gros. Retourne false dès qu'un lot a échoué (il faut s'arrêter).
   */
  async function addFile(path: string, content: string): Promise<boolean> {
    if (error) return false;

    const parts = splitBase64(content);
    if (parts.length > 1) splitFiles.push(path);

    for (let i = 0; i < parts.length; i++) {
      const p = parts.length > 1 ? partPath(path, i) : path;
      const size = parts[i].length;

      // Le fichier ne rentre pas dans le lot courant → on envoie le lot.
      if (
        batch.length > 0 &&
        (batchBytes + size > MAX_BATCH_B64 || batch.length >= MAX_BATCH_FILES)
      ) {
        if (!(await flush(false))) return false;
      }

      batch.push({ path: p, content: parts[i] });
      batchBytes += size;
      // Seule la dernière partie compte comme « un fichier terminé ».
      if (i === parts.length - 1) batchOrig += 1;
    }
    return true;
  }

  async function finish(): Promise<BatchSummary> {
    await flush(true);
    await waitInflight();
    return { ok: !error, error, commits, filesPushed, splitFiles };
  }

  return { addFile, finish };
}
