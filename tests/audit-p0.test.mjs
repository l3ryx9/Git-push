// Tests de régression des corrections de l'audit du 12/11/2026 (P0 + compléments).
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  autoStagePaths,
  cleanRelPath,
  createSerialUpdater,
  createSingleFlight,
  credentialAllowed,
  credentialHosts,
  hostOfUrl,
  isWritableRelPath,
  resolveLocation,
  safeRouteRelPath,
  scheduleAction,
  stripForeignAuth,
  syncIntentDecision,
  untrackedAtRisk,
  untrackedFromMatrix,
} from "../utils/git/securityPure.ts";

const AUTH = { Authorization: "Basic c2VjcmV0", Accept: "*/*" };

// ─── AUDIT-001 ────────────────────────────────────────────────────────────────

test("AUDIT-001 : hostOfUrl ignore identifiants, port et casse", () => {
  assert.equal(hostOfUrl("https://user:pw@GitHub.com:443/a/b.git"), "github.com");
  assert.equal(hostOfUrl("https://github.com@evil.example/x.git"), "evil.example");
  assert.equal(hostOfUrl("pas une url"), "");
});

test("AUDIT-001 : le token GitHub n'est autorisé que vers github.com", () => {
  const hosts = credentialHosts("github", "https://gitlab.example/x.git");
  assert.deepEqual(hosts, ["github.com"]);
  assert.equal(credentialAllowed("https://gitlab.example/x.git/info/refs", hosts), false);
  assert.equal(credentialAllowed("https://github.com/o/r.git/info/refs", hosts), true);
});

test("AUDIT-001 : un second remote ne reçoit pas les identifiants de origin", () => {
  const hosts = credentialHosts("basic", "https://git.maison.lan/o/r.git");
  const h = stripForeignAuth("https://serveur-controle.example/x.git/info/refs?service=git-upload-pack", AUTH, hosts);
  assert.equal(Object.keys(h).some((k) => k.toLowerCase() === "authorization"), false);
  assert.equal(h.Accept, "*/*");
  assert.equal(stripForeignAuth("https://git.maison.lan/o/r.git/info/refs", AUTH, hosts).Authorization, AUTH.Authorization);
});

test("AUDIT-001 : un compte de forge n'est valable que pour son hôte", () => {
  const hosts = credentialHosts("account", "https://autre.example/x.git", "gitea.exemple.fr");
  assert.deepEqual(hosts, ["gitea.exemple.fr"]);
  assert.equal(credentialAllowed("https://autre.example/x.git", hosts), false);
  assert.deepEqual(credentialHosts("none", "https://github.com/x"), []);
  assert.equal(credentialAllowed("https://github.com/x", undefined), false);
});

test("AUDIT-001 / 004 : résolution des redirections (Location)", () => {
  const base = "https://git.exemple.fr/o/r.git/info/refs?service=x";
  assert.equal(resolveLocation("https://cdn.example/a", base), "https://cdn.example/a");
  assert.equal(resolveLocation("//cdn.example/a", base), "https://cdn.example/a");
  assert.equal(resolveLocation("/autre/r.git/info/refs", base), "https://git.exemple.fr/autre/r.git/info/refs");
  assert.equal(resolveLocation("refs2", base), "https://git.exemple.fr/o/r.git/info/refs2");
});

// ─── AUDIT-002 ────────────────────────────────────────────────────────────────

test("AUDIT-002 : deux comptes rafraîchis en même temps gardent chacun leur token", async () => {
  const once = createSingleFlight();
  let calls = 0;
  const slow = (tok) => async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return tok;
  };
  const [a, b, a2] = await Promise.all([once("A", slow("token-A")), once("B", slow("token-B")), once("A", slow("autre"))]);
  assert.equal(a, "token-A");
  assert.equal(b, "token-B");
  assert.equal(a2, "token-A"); // même compte : appel partagé
  assert.equal(calls, 2);
  assert.equal(await once("A", slow("token-A2")), "token-A2"); // terminé : nouvel appel possible
});

// ─── AUDIT-003 ────────────────────────────────────────────────────────────────

test("AUDIT-003 : un lien gitcrush://sync sans la bonne clé demande une confirmation", () => {
  const key = "0123456789abcdef0123456789abcdef";
  assert.equal(syncIntentDecision(undefined, key), "confirm");
  assert.equal(syncIntentDecision("", key), "confirm");
  assert.equal(syncIntentDecision("mauvaise", key), "confirm");
  assert.equal(syncIntentDecision(key.slice(0, -1), key), "confirm");
  assert.equal(syncIntentDecision(key, key), "run");
  // Module natif absent (ancien build, web) ou clé trop courte : toujours confirmer.
  assert.equal(syncIntentDecision(key, null), "confirm");
  assert.equal(syncIntentDecision("abc", "abc"), "confirm");
});

// ─── AUDIT-006 ────────────────────────────────────────────────────────────────

test("AUDIT-006 : les fichiers sensibles NON SUIVIS ne sont pas commités automatiquement", () => {
  const r = autoStagePaths([
    { path: "src/app.ts", unstaged: true, row: [1, 2, 1] },
    { path: ".env", unstaged: true, row: [0, 2, 0] },
    { path: "keys/release.jks", unstaged: true, row: [0, 2, 0] },
    { path: ".env.example", unstaged: true, row: [0, 2, 0] },
    { path: "config/.env", unstaged: true, row: [1, 2, 1] }, // déjà suivi : géré normalement
    { path: "deja-indexe.txt", unstaged: false, row: [0, 2, 2] },
  ]);
  assert.deepEqual(r.stage, ["src/app.ts", ".env.example", "config/.env"]);
  assert.deepEqual(r.skipped, [".env", "keys/release.jks"]);
});

// ─── AUDIT-008 / AUDIT-009 ────────────────────────────────────────────────────

test("AUDIT-009 : « . » ne désigne plus un chemin supprimable", () => {
  assert.equal(cleanRelPath("."), "");
  assert.equal(cleanRelPath("./"), "");
  assert.equal(cleanRelPath("a/./b//c/"), "a/b/c");
  assert.equal(isWritableRelPath(cleanRelPath(".")), false);
  assert.equal(isWritableRelPath(cleanRelPath(".git/config")), false);
  assert.equal(isWritableRelPath(cleanRelPath("./.GIT/hooks")), false);
  assert.equal(isWritableRelPath(cleanRelPath("src/index.ts")), true);
  assert.throws(() => cleanRelPath("a/../../b"), /refusé/);
  assert.throws(() => cleanRelPath("..\\secret"), /refusé/);
});

test("AUDIT-008 : les paramètres de route avec « .. » sont refusés", () => {
  assert.equal(safeRouteRelPath("../../shared_prefs/x.xml"), null);
  assert.equal(safeRouteRelPath("docs/readme.md"), "docs/readme.md");
  assert.equal(safeRouteRelPath(undefined), "");
});

// ─── AUDIT-012 ────────────────────────────────────────────────────────────────

test("AUDIT-012 : détection des fichiers non suivis qu'une fusion écraserait", () => {
  const rows = [
    ["suivi.txt", 1, 1, 1],
    ["notes.txt", 0, 2, 0], // non suivi
    ["ajoute.txt", 0, 2, 2], // ajouté à l'index : pas « non suivi »
    ["identique.txt", 0, 2, 0],
    ["local-seulement.txt", 0, 2, 0],
  ];
  const untracked = untrackedFromMatrix(rows);
  assert.deepEqual(untracked, ["notes.txt", "identique.txt", "local-seulement.txt"]);
  const enc = (s) => new TextEncoder().encode(s);
  const theirs = { "notes.txt": enc("version distante"), "identique.txt": enc("pareil") };
  const mine = { "notes.txt": enc("mes notes"), "identique.txt": enc("pareil"), "local-seulement.txt": enc("x") };
  const atRisk = untrackedAtRisk(untracked, (p) => theirs[p] ?? null, (p) => mine[p] ?? null);
  assert.deepEqual(atRisk, ["notes.txt"]);
});

// ─── AUDIT-014 ────────────────────────────────────────────────────────────────

test("AUDIT-014 : deux mises à jour simultanées sont toutes les deux conservées", async () => {
  let stored = { lastSync: 0, merge: null };
  const update = createSerialUpdater(
    async () => stored,
    async (v) => {
      await new Promise((r) => setTimeout(r, 5));
      stored = v;
    }
  );
  await Promise.all([update((c) => ({ ...c, lastSync: 42 })), update((c) => ({ ...c, merge: { resolved: ["a"] } }))]);
  assert.deepEqual(stored, { lastSync: 42, merge: { resolved: ["a"] } });
});

test("AUDIT-014 : un échec d'écriture est signalé sans bloquer la file", async () => {
  let fail = true;
  let stored = 0;
  const update = createSerialUpdater(
    async () => stored,
    async (v) => {
      if (fail) throw new Error("disque plein");
      stored = v;
    }
  );
  await assert.rejects(update((n) => n + 1), /disque plein/);
  fail = false;
  assert.equal(await update((n) => n + 5), 5);
});

// ─── AUDIT-019 ────────────────────────────────────────────────────────────────

test("AUDIT-019 : la tâche n'est pas réinscrite à chaque lancement", () => {
  assert.equal(scheduleAction(true, 60, 60), "keep");
  assert.equal(scheduleAction(true, null, 60), "register"); // première fois après mise à jour
  assert.equal(scheduleAction(true, 30, 60), "register");
  assert.equal(scheduleAction(false, 60, 60), "register");
  assert.equal(scheduleAction(true, 60, null), "unregister");
  assert.equal(scheduleAction(false, null, null), "keep");
});

// ─── AUDIT-030 et contrôles de source ─────────────────────────────────────────

test("AUDIT-030 : les messages d'erreur utilisent de vrais sauts de ligne", () => {
  const src = fs.readFileSync("components/GitUi.tsx", "utf8");
  const line = src.split("\n").find((l) => l.includes("const withNext"));
  assert.ok(line);
  assert.equal(line.includes("\\\\n"), false, "« \\\\n » afficherait un texte littéral");
  assert.ok(line.includes("\\n\\n"));
});

test("AUDIT-003 : la tuile, le widget et l'accessibilité ajoutent la clé au lien", () => {
  const dir = "modules/gitcrush-native/android/src/main/java/expo/modules/gitcrushnative/";
  assert.match(fs.readFileSync(dir + "NativePrefs.kt", "utf8"), /appendQueryParameter\("key", NativePrefs\.syncKey\(ctx\)\)/);
  for (const f of ["SyncTileService.kt", "SyncWidgetProvider.kt", "WatchAccessibilityService.kt"]) {
    assert.match(fs.readFileSync(dir + f, "utf8"), /SyncLauncher\.syncUri\((this|ctx), /, f);
  }
  assert.match(fs.readFileSync(dir + "Http.kt", "utf8"), /instanceFollowRedirects = false/);
});

test("AUDIT-022 / 023 : le workflow verrouille les dépendances et refuse un APK debug publié", () => {
  const wf = fs.readFileSync(".github/workflows/build-apk.yml", "utf8");
  assert.match(wf, /npm ci --no-audit --no-fund/);
  assert.match(wf, /seul un build « release » peut être publié/);
  assert.match(wf, /apksigner/);
  assert.match(wf, /CN=Android Debug/);
  assert.ok(fs.existsSync(".github/workflows/lockfile.yml"));
});

// ─── Typecheck CI : corps de réponse HTTP au format isomorphic-git ────────────

test("singleChunkBody est un itérateur asynchrone qui livre un seul bloc", async () => {
  const { singleChunkBody } = await import("../utils/git/httpPure.ts");
  const chunk = new Uint8Array([1, 2, 3]);
  const body = singleChunkBody(chunk);
  const seen = [];
  for await (const c of body) seen.push(c);
  assert.deepEqual(seen, [chunk]);
  // Lecture façon isomorphic-git (next() direct) après épuisement : terminé.
  assert.deepEqual(await body.next(), { done: true, value: undefined });
  const again = singleChunkBody(chunk);
  assert.deepEqual(await again.next(), { done: false, value: chunk });
});
