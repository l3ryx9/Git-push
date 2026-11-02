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
