/**
 * Diff de lignes (algorithme de Myers) + fusion à trois voies (diff3).
 * Module pur, sans dépendance : utilisé pour l'affichage des diffs et pour
 * la résolution des fusions (pull, merge de branches).
 */

export type Op = { t: 0 | 1 | -1; ai: number; bi: number };

/** Découpe en lignes en CONSERVANT les fins de ligne (fusion fidèle à l'octet près). */
export function splitLines(text: string): string[] {
  if (!text) return [];
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** Myers O((N+M)·D). Renvoie null si le diff dépasse maxD modifications. */
function myers(a: string[], b: string[], maxD: number): Op[] | null {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((_, j) => ({ t: 1, ai: -1, bi: j }));
  if (m === 0) return a.map((_, i) => ({ t: -1, ai: i, bi: -1 }));
  const max = n + m;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  v[max + 1] = 0;
  const limit = Math.min(max, maxD);
  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice(max - d, max + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[max + k - 1] < v[max + k + 1])) x = v[max + k + 1];
      else x = v[max + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[max + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], n: number, m: number): Op[] {
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const w = trace[d];
    const get = (k: number) => w[k + d];
    const k = x - y;
    let prevX = 0;
    let prevY = 0;
    if (d > 0) {
      const prevK = k === -d || (k !== d && get(k - 1) < get(k + 1)) ? k + 1 : k - 1;
      prevX = get(prevK);
      prevY = prevX - prevK;
    }
    while (x > prevX && y > prevY) {
      ops.push({ t: 0, ai: x - 1, bi: y - 1 });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) ops.push({ t: 1, ai: -1, bi: y - 1 });
      else ops.push({ t: -1, ai: x - 1, bi: -1 });
    }
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

/** Opérations de diff ligne à ligne entre a et b (préfixe/suffixe communs retirés d'abord). */
export function diffOps(a: string[], b: string[], maxD = 4000): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let ea = a.length;
  let eb = b.length;
  while (ea > start && eb > start && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  const ops: Op[] = [];
  for (let i = 0; i < start; i++) ops.push({ t: 0, ai: i, bi: i });
  const ma = a.slice(start, ea);
  const mb = b.slice(start, eb);
  let mid = myers(ma, mb, maxD);
  if (!mid) {
    // Trop de différences : tout supprimer puis tout ajouter.
    mid = [
      ...ma.map((_, i) => ({ t: -1 as const, ai: i, bi: -1 })),
      ...mb.map((_, j) => ({ t: 1 as const, ai: -1, bi: j })),
    ];
  }
  for (const o of mid) {
    ops.push({ t: o.t, ai: o.ai >= 0 ? o.ai + start : -1, bi: o.bi >= 0 ? o.bi + start : -1 });
  }
  for (let i = 0; i < a.length - ea; i++) ops.push({ t: 0, ai: ea + i, bi: eb + i });
  return ops;
}

// ─── Affichage ────────────────────────────────────────────────────────────────

export type DiffRow =
  | { kind: "line"; t: 0 | 1 | -1; text: string; a?: number; b?: number }
  | { kind: "hunk"; text: string };

export interface DiffResult {
  rows: DiffRow[];
  adds: number;
  dels: number;
}

const strip = (s: string) => s.replace(/\r?\n$/, "");

/** Diff unifié prêt à afficher. full = tout le fichier, sinon seulement les blocs (contexte = 3 lignes). */
export function unifiedDiff(oldText: string, newText: string, full = false, context = 3): DiffResult {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops = diffOps(a, b);
  const lines: { t: 0 | 1 | -1; text: string; a?: number; b?: number }[] = ops.map((o) =>
    o.t === 0
      ? { t: 0, text: strip(a[o.ai]), a: o.ai + 1, b: o.bi + 1 }
      : o.t === -1
        ? { t: -1, text: strip(a[o.ai]), a: o.ai + 1 }
        : { t: 1, text: strip(b[o.bi]), b: o.bi + 1 }
  );
  const adds = lines.filter((l) => l.t === 1).length;
  const dels = lines.filter((l) => l.t === -1).length;
  if (full) return { rows: lines.map((l) => ({ kind: "line" as const, ...l })), adds, dels };

  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.t !== 0) {
      for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) keep[j] = true;
    }
  });
  const rows: DiffRow[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!keep[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && keep[j]) j++;
    const block = lines.slice(i, j);
    const aStart = block.find((l) => l.a !== undefined)?.a ?? 0;
    const bStart = block.find((l) => l.b !== undefined)?.b ?? 0;
    const aLen = block.filter((l) => l.t !== 1).length;
    const bLen = block.filter((l) => l.t !== -1).length;
    rows.push({ kind: "hunk", text: `@@ -${aStart},${aLen} +${bStart},${bLen} @@` });
    for (const l of block) rows.push({ kind: "line", ...l });
    i = j;
  }
  return { rows, adds, dels };
}

// ─── Fusion à trois voies ─────────────────────────────────────────────────────

type Hunk = { s: number; e: number; lines: string[]; side: "a" | "b" };

function hunksOf(base: string[], other: string[], side: "a" | "b"): Hunk[] {
  const ops = diffOps(base, other);
  const out: Hunk[] = [];
  let cur: Hunk | null = null;
  let pos = 0;
  for (const o of ops) {
    if (o.t === 0) {
      if (cur) out.push(cur);
      cur = null;
      pos = o.ai + 1;
    } else if (o.t === -1) {
      if (!cur) cur = { s: o.ai, e: o.ai, lines: [], side };
      cur.e = o.ai + 1;
      pos = o.ai + 1;
    } else {
      if (!cur) cur = { s: pos, e: pos, lines: [], side };
      cur.lines.push(other[o.bi]);
    }
  }
  if (cur) out.push(cur);
  return out;
}

function withTrailingNewline(lines: string[]): string[] {
  if (!lines.length) return lines;
  const copy = lines.slice();
  const last = copy[copy.length - 1];
  if (!last.endsWith("\n")) copy[copy.length - 1] = last + "\n";
  return copy;
}

/**
 * Fusion à trois voies façon git : les changements qui se chevauchent ou se
 * touchent deviennent des conflits marqués <<<<<<< / ======= / >>>>>>>.
 */
export function merge3(
  base: string,
  ours: string,
  theirs: string,
  labels: { ours: string; theirs: string }
): { clean: boolean; text: string } {
  if (ours === theirs) return { clean: true, text: ours };
  if (base === ours) return { clean: true, text: theirs };
  if (base === theirs) return { clean: true, text: ours };
  const O = splitLines(base);
  const A = splitLines(ours);
  const B = splitLines(theirs);
  const all = [...hunksOf(O, A, "a"), ...hunksOf(O, B, "b")].sort((x, y) => x.s - y.s || x.e - y.e);
  const out: string[] = [];
  let pos = 0;
  let clean = true;
  let i = 0;
  while (i < all.length) {
    const gs = all[i].s;
    let ge = all[i].e;
    const group: Hunk[] = [all[i]];
    i++;
    while (i < all.length && all[i].s <= ge) {
      group.push(all[i]);
      ge = Math.max(ge, all[i].e);
      i++;
    }
    for (; pos < gs; pos++) out.push(O[pos]);
    const apply = (hs: Hunk[]) => {
      const res: string[] = [];
      let p = gs;
      for (const h of hs) {
        for (; p < h.s; p++) res.push(O[p]);
        res.push(...h.lines);
        p = h.e;
      }
      for (; p < ge; p++) res.push(O[p]);
      return res;
    };
    const ga = group.filter((h) => h.side === "a");
    const gb = group.filter((h) => h.side === "b");
    if (!gb.length) out.push(...apply(ga));
    else if (!ga.length) out.push(...apply(gb));
    else {
      const ra = apply(ga);
      const rb = apply(gb);
      if (ra.join("") === rb.join("")) out.push(...ra);
      else {
        clean = false;
        out.push(`<<<<<<< ${labels.ours}\n`, ...withTrailingNewline(ra), "=======\n", ...withTrailingNewline(rb), `>>>>>>> ${labels.theirs}\n`);
      }
    }
    pos = ge;
  }
  for (; pos < O.length; pos++) out.push(O[pos]);
  return { clean, text: out.join("") };
}

/** Un fichier est considéré binaire s'il contient un octet nul dans ses 8000 premiers octets. */
export function isBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

export function hasConflictMarkers(text: string): boolean {
  return /^<{7}( |$)/m.test(text) && /^>{7}( |$)/m.test(text);
}
