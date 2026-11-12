import test from "node:test";
import assert from "node:assert/strict";
import { normalizePhrase, phraseMatches, showTypedConfirm, subscribeTypedConfirm } from "../utils/safeConfirm.ts";

const base = { title: "t", message: "m", confirmText: "ok", cancelText: "no", onConfirm: () => {} };

test("la phrase doit être recopiée exactement (casse et espaces de bord ignorés)", () => {
  assert.equal(phraseMatches("  Mon-Repo ", "mon-repo"), true);
  assert.equal(phraseMatches("mon-rep", "mon-repo"), false);
  assert.equal(phraseMatches("owner/repo", "repo"), false);
  assert.equal(normalizePhrase("a   b"), "a b");
});

test("une phrase attendue vide n'est jamais validée", () => {
  assert.equal(phraseMatches("", ""), false);
  assert.equal(phraseMatches("   ", "  "), false);
});

test("sans hôte monté, ou avec une phrase vide, l'action n'est pas armée ni exécutée", () => {
  let ran = false;
  assert.equal(showTypedConfirm({ ...base, phrase: "x", onConfirm: () => { ran = true; } }), false);
  const off = subscribeTypedConfirm(() => {});
  assert.equal(showTypedConfirm({ ...base, phrase: "  " }), false);
  assert.equal(showTypedConfirm({ ...base, phrase: "x" }), true);
  off();
  assert.equal(ran, false);
});

test("l'hôte reçoit la requête avec le délai par défaut", () => {
  let got;
  const off = subscribeTypedConfirm((r) => { got = r; });
  showTypedConfirm({ ...base, phrase: "repo" });
  off();
  assert.equal(got.phrase, "repo");
  assert.equal(got.delayMs, 2000);
});
