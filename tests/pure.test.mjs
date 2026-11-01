// Tests de la logique pure : `npm test` (Node 22.6+, sans dépendance à installer).
import assert from "node:assert/strict";
import test from "node:test";

import { applyEdits, fmtBytes, locate, pathCandidates, signature, slugRepoName, summarizeTree, TEMPLATE_FOR, workflowTemplate } from "../utils/ai/pure.ts";

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
