// Tests de la logique pure : `npm test` (Node 22.6+, sans dépendance à installer).
import assert from "node:assert/strict";
import test from "node:test";

import { applyEdits, createDirMemo, fmtBytes, locate, pathCandidates, signature, slugRepoName, summarizeTree, TEMPLATE_FOR, workflowTemplate } from "../utils/ai/pure.ts";

test("applyEdits garde les motifs $ du code tels quels", () => {
  const r = applyEdits("a\nfoo(1);\nb\n", { edits: [{ old_text: "foo(1);", new_text: "foo($1 $&);" }] });
  assert.deepEqual(r, { text: "a\nfoo($1 $&);\nb\n" });
});

test("applyEdits tolère les espaces de fin de ligne et CRLF", () => {
  assert.deepEqual(applyEdits("a\nfoo(1);   \nb\n", { old_text: "foo(1);\nb", new_text: "X" }), { text: "a\nX\n" });
  assert.deepEqual(applyEdits("a\r\nfoo\r\nb\r\n", { old_text: "foo\nb", new_text: "X" }).text?.includes("X"), true);
});

test("applyEdits refuse les passages absents ou ambigus", () => {
  assert.match(applyEdits("x\nx\n", { edits: [{ old_text: "x", new_text: "y" }] }).error, /plusieurs fois/);
  assert.match(applyEdits("abc", { edits: [{ old_text: "zzz", new_text: "y" }] }).error, /introuvable/);
  assert.match(applyEdits("abc", { edits: [{ old_text: "", new_text: "y" }] }).error, /vide/);
});

test("applyEdits applique plusieurs modifications dans l'ordre, ou aucune", () => {
  assert.deepEqual(applyEdits("one\ntwo\nthree\n", { edits: [{ old_text: "one", new_text: "1" }, { old_text: "three", new_text: "3" }] }), { text: "1\ntwo\n3\n" });
  const r = applyEdits("one\ntwo\n", { edits: [{ old_text: "one", new_text: "1" }, { old_text: "nope", new_text: "3" }] });
  assert.ok("error" in r);
});

test("locate renvoie la position exacte", () => {
  assert.deepEqual(locate("hello world", "world"), { start: 6, end: 11 });
  assert.equal(locate("aa", "a"), "many");
  assert.equal(locate("abc", "z"), "none");
});

test("summarizeTree regroupe par dossier", () => {
  const files = [];
  for (let i = 0; i < 300; i++) files.push(i % 3 ? `app/screens/s${i}.tsx` : `src/lib/util/u${i}.ts`);
  files.push("package.json", "README.md");
  const out = summarizeTree(files);
  assert.match(out, /package\.json, README\.md/);
  assert.match(out, /app\/screens\/ \(200 fichiers\)/);
  assert.match(out, /src\/lib\/ \(100 fichiers\)/);
});

test("signature ignore les numéros de ligne", () => {
  const a = "e: App.kt:42:13 Unresolved reference: foo\nFAILURE: Build failed";
  const b = "e: App.kt:57:2 Unresolved reference: foo\nFAILURE: Build failed";
  assert.equal(signature(a), signature(b));
  assert.notEqual(signature(a), signature("Error: Cannot find module './x'"));
});

test("slugRepoName produit un nom GitHub valide", () => {
  assert.equal(slugRepoName("  Mon Projet Été  "), "Mon-Projet-Ete");
  assert.equal(slugRepoName("..hidden"), "hidden");
  assert.equal(slugRepoName("a/b\\c?"), "abc");
  assert.equal(slugRepoName("???"), "");
});

test("fmtBytes", () => {
  assert.equal(fmtBytes(0), "0 o");
  assert.equal(fmtBytes(512), "512 o");
  assert.equal(fmtBytes(1536), "1,5 Ko");
  assert.equal(fmtBytes(5 * 1024 * 1024), "5,0 Mo");
  assert.equal(fmtBytes(250 * 1024 * 1024), "250 Mo");
});

test("pathCandidates gère les chemins Expo Router et les chemins du runner", () => {
  const log = "e: file:///home/runner/work/proj/proj/app/src/main/java/App.kt:42:13 Unresolved\nError in (app/(tabs)/index.tsx:10)\nin ./src/a.ts and node_modules/x/y.js";
  const c = pathCandidates(log);
  assert.ok(c.includes("app/src/main/java/App.kt"));
  assert.ok(c.includes("app/(tabs)/index.tsx"));
  assert.ok(c.includes("src/a.ts"));
});

test("modèles de workflows", async () => {
  const info = { kind: "android", hasGradlew: true, hasLockfile: false };
  assert.equal(TEMPLATE_FOR.expo, "expo-apk");
  assert.equal(workflowTemplate("inconnu", info), null);
  const android = workflowTemplate("android-apk", info);
  assert.match(android, /assembleDebug/);
  assert.match(android, /chmod \+x \.\/gradlew/);
  assert.match(workflowTemplate("android-apk", { ...info, hasGradlew: false }, { buildType: "release" }), /gradle assembleRelease/);
  assert.match(workflowTemplate("expo-apk", { kind: "expo", hasGradlew: false, hasLockfile: true }), /npm ci/);
  assert.match(workflowTemplate("node-ci", { kind: "node", hasGradlew: false, hasLockfile: false }), /npm install/);
  // Si la bibliothèque yaml est installée (après `npm install`), chaque modèle doit être un YAML valide.
  const yaml = await import("yaml").catch(() => null);
  if (yaml) {
    for (const t of ["android-apk", "expo-apk", "node-ci"]) {
      const doc = yaml.parseDocument(workflowTemplate(t, { ...info, hasLockfile: true }));
      assert.equal(doc.errors.length, 0, `${t} : ${doc.errors[0]?.message}`);
      assert.ok(doc.toJS().jobs);
    }
  }
});

test("workflows : aucune valeur non guillemetée ne contient « ${{ … # … }} » (le # couperait l'expression : Startup failure)", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = new URL("../.github/workflows/", import.meta.url);
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    readFileSync(new URL(f, dir), "utf8")
      .split("\n")
      .forEach((line, i) => {
        const m = /^\s*(?:- )?[\w.-]+:\s+([^"'|>#\s].*)$/.exec(line);
        if (m && /\$\{\{(?:(?!\}\}).)*\s#/.test(m[1])) assert.fail(`${f} ligne ${i + 1} : mets la valeur entre guillemets (« # » = commentaire YAML)`);
      });
  }
});

test("createDirMemo : résultat réutilisé, puis invalidé par une écriture n'importe où sous le dossier", async () => {
  let clock = 0;
  let calls = 0;
  const memo = createDirMemo(3000, () => clock);
  const compute = async () => ++calls;
  assert.equal(await memo.get("/data/diag-git", compute), 1);
  assert.equal(await memo.get("/data/diag-git", compute), 1, "réutilisé dans le délai");
  // Cas réel du bug : un dépôt qui n'est PAS sous « repos/ » doit être invalidé aussi.
  memo.invalidatePath("/data/diag-git/a.txt");
  assert.equal(await memo.get("/data/diag-git", compute), 2, "invalidé par l'écriture d'un fichier du dépôt");
  memo.invalidatePath("/data/diag-git/.git/index");
  assert.equal(await memo.get("/data/diag-git", compute), 3, "invalidé aussi par un fichier de .git");
});

test("createDirMemo : ne confond pas deux dossiers voisins, expire, et ne garde pas les échecs", async () => {
  let clock = 0;
  let calls = 0;
  const memo = createDirMemo(3000, () => clock);
  const compute = async () => ++calls;
  await memo.get("/data/repo", compute);
  memo.invalidatePath("/data/repo2/x.txt"); // « repo2 » n'est pas dans « repo »
  memo.invalidatePath("/data/other/x.txt");
  assert.equal(await memo.get("/data/repo", compute), 1);
  clock = 3001;
  assert.equal(await memo.get("/data/repo", compute), 2, "expiré après le délai");

  let n = 0;
  const flaky = async () => {
    if (++n === 1) throw new Error("boum");
    return "ok";
  };
  await assert.rejects(memo.get("/data/f", flaky));
  assert.equal(await memo.get("/data/f", flaky), "ok", "un échec n'est pas mémorisé");
});

test("createDirMemo : une écriture pendant un calcul empêche de réutiliser ce résultat", async () => {
  const memo = createDirMemo(3000, () => 0);
  let release;
  let calls = 0;
  const slow = () =>
    new Promise((resolve) => {
      calls++;
      release = () => resolve("ancien");
    });
  const first = memo.get("/d", slow);
  memo.invalidatePath("/d/f.txt"); // écriture pendant le calcul
  const second = memo.get("/d", async () => "frais");
  release();
  assert.equal(await first, "ancien");
  assert.equal(await second, "frais", "le nouveau calcul n'a pas réutilisé le résultat périmé");
  assert.equal(calls, 1);
});

// ─── Ajouts : édition robuste, contenu vérifié, secrets, budget d'historique ──

import { contentProblem, fitHistory, isSensitivePath, maskSecrets, redactSecrets, unmaskSecrets, usesCrlf } from "../utils/ai/pure.ts";

test("applyEdits tolère une indentation différente et garde celle du fichier", () => {
  const file = "function a() {\n    if (x) {\n        go();\n    }\n}\n";
  const r = applyEdits(file, { old_text: "if (x) {\n    go();\n}", new_text: "if (x) {\n    go();\n    done();\n}" });
  assert.deepEqual(r, { text: "function a() {\n    if (x) {\n        go();\n        done();\n    }\n}\n" });
});

test("applyEdits conserve les fins de ligne CRLF", () => {
  const r = applyEdits("a\r\nb\r\nc\r\n", { old_text: "b", new_text: "x\ny" });
  assert.equal(r.text, "a\r\nx\r\ny\r\nc\r\n");
  assert.equal(usesCrlf("a\r\nb\r\n"), true);
  assert.equal(usesCrlf("a\nb\n"), false);
});

test("applyEdits indique les lignes en cas d'échec", () => {
  assert.match(applyEdits("x = 1\ny = 2\nx = 1\n", { old_text: "x = 1", new_text: "z" }).error, /lignes 1, 3/);
  assert.match(applyEdits("alpha\nconst value = compute();\n", { old_text: "const value = compute();\nreturn 1;", new_text: "z" }).error, /L2/);
});

test("contentProblem refuse un JSON cassé mais tolère tsconfig (JSONC)", () => {
  assert.match(contentProblem("package.json", "{ \"a\": 1, }", "{}"), /JSON invalide/);
  assert.equal(contentProblem("package.json", "{ \"a\": 1 }", "{}"), null);
  assert.equal(contentProblem("tsconfig.json", "{ // commentaire\n }", "{}"), null);
  assert.equal(contentProblem("data.json", "pas du json", "pas du json non plus"), null);
});

test("redactSecrets masque tokens, clés et mots de passe d'URL", () => {
  const out = redactSecrets("push https://bob:hunter2secret@github.com/x.git ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123 sk-ant-abcdefghijklmnopqrstu AIzaSyA1234567890abcdefghijklmnopqrstuv");
  assert.doesNotMatch(out, /hunter2|ghp_ABC|sk-ant-abc|AIzaSyA/);
  assert.match(out, /bob:\[URL_PASSWORD masqué\]@github\.com/);
});

test("maskSecrets / unmaskSecrets : aller-retour sans perte", () => {
  const vault = new Map();
  const src = "API_KEY=abcdef1234567890XYZ\nconst k = process.env.API_KEY;\nTOKEN: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123\n";
  const masked = maskSecrets(src, vault);
  assert.doesNotMatch(masked, /abcdef1234567890XYZ|ghp_ABC/);
  assert.match(masked, /process\.env\.API_KEY/);
  assert.equal(maskSecrets(masked, vault), masked);
  assert.deepEqual(unmaskSecrets(masked, vault), { text: src, missing: [] });
  assert.deepEqual(unmaskSecrets("x __SECRET_00000000__", vault).missing, ["__SECRET_00000000__"]);
});

test("isSensitivePath repère les fichiers de secrets", () => {
  for (const p of [".env", "app/.env.production", "release.keystore", "certs/server.pem", "id_ed25519", ".git-credentials"]) assert.equal(isSensitivePath(p), true, p);
  for (const p of [".env.example", "id_ed25519.pub", "src/env.ts", "package.json", "keys.ts"]) assert.equal(isSensitivePath(p), false, p);
});

test("fitHistory tronque les anciens résultats et respecte le budget", () => {
  const big = "x".repeat(5000);
  const msgs = [];
  for (let i = 0; i < 6; i++) {
    msgs.push({ role: "user", text: `demande ${i}` });
    msgs.push({ role: "assistant", text: "", calls: [{ id: `c${i}`, name: "write_file", args: {} }], raw: [{ type: "tool_use", id: `c${i}`, name: "write_file", input: { path: "a", content: big } }], provider: "anthropic" });
    msgs.push({ role: "tool", results: [{ id: `c${i}`, name: "write_file", output: big }] });
  }
  const fitted = fitHistory(msgs, 2, 1e9);
  assert.equal(fitted.length, msgs.length);
  assert.ok(fitted[2].results[0].output.length < 1000);
  assert.ok(fitted[1].raw[0].input.content.length < 1000);
  assert.equal(fitted[fitted.length - 1].results[0].output.length, 5000);
  assert.equal(fitted[fitted.length - 2].raw[0].input.content.length, 5000);
  const small = fitHistory(msgs, 2, 20000);
  assert.equal(small[0].role, "user");
  assert.ok(JSON.stringify(small).length <= 20000 || small.length <= 3);
  assert.match(small[0].text, /retiré/);
});

// ─── Phase 8 : régression Git (diff, fusion, fichiers binaires) ────────────────
import { splitLines, diffOps, unifiedDiff, merge3, isBinary, hasConflictMarkers } from "../utils/git/diff.ts";

test("splitLines conserve exactement les fins de ligne et les fichiers sans saut final", () => {
  assert.deepEqual(splitLines("a\r\nb\nlast"), ["a\r\n", "b\n", "last"]);
  assert.deepEqual(splitLines(""), []);
  assert.deepEqual(splitLines("one\n"), ["one\n"]);
});

test("diffOps reconstruit les séquences après insertions et suppressions", () => {
  const before = ["a\n", "b\n", "c\n"];
  const after = ["a\n", "x\n", "c\n", "d\n"];
  const ops = diffOps(before, after);
  assert.equal(ops.filter((o) => o.t === 1).map((o) => after[o.bi]).join(""), "x\nd\n");
  assert.equal(ops.filter((o) => o.t === -1).map((o) => before[o.ai]).join(""), "b\n");
  assert.equal(ops.filter((o) => o.t === 0).map((o) => before[o.ai]).join(""), "a\nc\n");
});

test("unifiedDiff compte les ajouts/suppressions et produit les hunks", () => {
  const result = unifiedDiff("a\nb\nc\nd\n", "a\nB\nc\nd\n");
  assert.equal(result.adds, 1);
  assert.equal(result.dels, 1);
  assert.ok(result.rows.some((r) => r.kind === "hunk"));
  assert.ok(result.rows.some((r) => r.kind === "line" && r.t === 1 && r.text === "B"));
  assert.ok(result.rows.some((r) => r.kind === "line" && r.t === -1 && r.text === "b"));
});

test("merge3 fusionne les modifications indépendantes sans conflit", () => {
  const base = "titre\nalpha\nbeta\nomega\n";
  const ours = "titre modifié\nalpha\nbeta\nomega\n";
  const theirs = "titre\nalpha\nbeta modifié\nomega\n";
  assert.deepEqual(merge3(base, ours, theirs, { ours: "local", theirs: "distant" }), {
    clean: true,
    text: "titre modifié\nalpha\nbeta modifié\nomega\n",
  });
});

test("merge3 signale les modifications concurrentes de la même zone", () => {
  const result = merge3("a\nb\nc\n", "a\nlocal\nc\n", "a\ndistant\nc\n", { ours: "main", theirs: "origin/main" });
  assert.equal(result.clean, false);
  assert.match(result.text, /<<<<<<< main/);
  assert.match(result.text, /=======/);
  assert.match(result.text, />>>>>>> origin\/main/);
  assert.equal(hasConflictMarkers(result.text), true);
});

test("merge3 gère les cas triviaux et deux changements identiques", () => {
  assert.deepEqual(merge3("a\n", "a\n", "b\n", { ours: "L", theirs: "R" }), { clean: true, text: "b\n" });
  assert.deepEqual(merge3("a\n", "b\n", "b\n", { ours: "L", theirs: "R" }), { clean: true, text: "b\n" });
});

test("merge3 préserve CRLF et signale proprement les conflits sans saut final", () => {
  const clean = merge3("a\r\nb\r\nc\r\n", "A\r\nb\r\nc\r\n", "a\r\nb\r\nC\r\n", { ours: "L", theirs: "R" });
  assert.equal(clean.clean, true);
  assert.equal(clean.text, "A\r\nb\r\nC\r\n");
  const conflict = merge3("line", "ours", "theirs", { ours: "L", theirs: "R" });
  assert.equal(conflict.clean, false);
  assert.match(conflict.text, /<<<<<<< L/);
});

test("isBinary limite la détection aux 8000 premiers octets", () => {
  assert.equal(isBinary(new Uint8Array([65, 0, 66])), true);
  assert.equal(isBinary(new Uint8Array([65, 66, 67])), false);
  const lateNull = new Uint8Array(8002).fill(65);
  lateNull[8001] = 0;
  assert.equal(isBinary(lateNull), false);
});

test("hasConflictMarkers exige les marqueurs Git attendus", () => {
  assert.equal(hasConflictMarkers("<<<<<<< ours\na\n=======\nb\n>>>>>>> theirs\n"), true);
  assert.equal(hasConflictMarkers("texte avec ======= seulement"), false);
  assert.equal(hasConflictMarkers("=======\n>>>>>>> theirs"), false);
});
