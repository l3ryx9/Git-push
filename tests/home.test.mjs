// Tests de la logique de l'accueil : `npm test`.
import assert from "node:assert/strict";
import test from "node:test";

import { conflictCount, favoriteRepos, recentOps, recentRepos, resolveRepoTarget, shouldTouchOpened, syncState } from "../utils/homePure.ts";

const repo = (id, extra = {}) => ({ id, name: id, ...extra });

test("resolveRepoTarget : aucun dépôt → on guide vers le clonage", () => {
  assert.deepEqual(resolveRepoTarget([]), { kind: "none" });
  assert.deepEqual(resolveRepoTarget([], true), { kind: "none" });
});

test("resolveRepoTarget : un seul dépôt → ouverture directe", () => {
  assert.deepEqual(resolveRepoTarget([repo("a")]), { kind: "direct", id: "a" });
});

test("resolveRepoTarget : plusieurs dépôts → l'utilisateur choisit", () => {
  assert.deepEqual(resolveRepoTarget([repo("a"), repo("b")]), { kind: "choose", ids: ["a", "b"] });
});

test("resolveRepoTarget : raccourci Conflits cible le dépôt en conflit", () => {
  const list = [repo("a"), repo("b", { merge: { conflicts: ["x"], resolved: [] } }), repo("c")];
  assert.deepEqual(resolveRepoTarget(list, true), { kind: "direct", id: "b" });
  // Sans conflit nulle part : retombe sur le comportement normal (l'écran affichera « aucune fusion »).
  assert.deepEqual(resolveRepoTarget([repo("a"), repo("c")], true), { kind: "choose", ids: ["a", "c"] });
});

test("conflictCount ne compte que les fichiers non résolus", () => {
  assert.equal(conflictCount(repo("a")), 0);
  assert.equal(conflictCount(repo("a", { merge: { conflicts: ["x", "y", "z"], resolved: ["y"] } })), 2);
});

test("syncState suit l'ordre de priorité conflit > échec > hors ligne > jamais > ok", () => {
  const ok = { at: 1, ok: true };
  assert.equal(syncState(repo("a", { merge: { conflicts: ["x"], resolved: [] }, lastSync: ok })), "conflict");
  assert.equal(syncState(repo("a", { lastSync: { at: 1, ok: false } })), "failed");
  assert.equal(syncState(repo("a", { pendingRetry: true, lastSync: ok })), "waiting");
  assert.equal(syncState(repo("a")), "never");
  assert.equal(syncState(repo("a", { lastSync: ok })), "ok");
});

test("recentRepos ignore les dépôts jamais ouverts et trie du plus récent", () => {
  const list = [repo("a", { lastOpenedAt: 10 }), repo("b"), repo("c", { lastOpenedAt: 30 }), repo("d", { lastOpenedAt: 20 })];
  assert.deepEqual(recentRepos(list).map((c) => c.id), ["c", "d", "a"]);
  assert.equal(recentRepos(list, 2).length, 2);
});

test("favoriteRepos ne garde que les favoris, triés par nom", () => {
  const list = [repo("zeta", { favorite: true }), repo("beta"), repo("alpha", { favorite: true })];
  assert.deepEqual(favoriteRepos(list).map((c) => c.id), ["alpha", "zeta"]);
});

test("recentOps ne renvoie que de vraies synchronisations, les plus récentes d'abord", () => {
  const list = [
    repo("a", { lastSync: { at: 100, ok: true, reason: "manual" } }),
    repo("b"),
    repo("c", { lastSync: { at: 300, ok: false } }),
    repo("d", { lastSync: { at: 200, ok: true } }),
  ];
  assert.deepEqual(recentOps(list, 2).map((o) => o.id), ["c", "d"]);
  assert.equal(recentOps([repo("x")]).length, 0);
});

test("shouldTouchOpened évite d'écrire à chaque rendu", () => {
  assert.equal(shouldTouchOpened(repo("a"), 1000), true);
  assert.equal(shouldTouchOpened(repo("a", { lastOpenedAt: 1000 }), 30_000), false);
  assert.equal(shouldTouchOpened(repo("a", { lastOpenedAt: 1000 }), 100_000), true);
});
