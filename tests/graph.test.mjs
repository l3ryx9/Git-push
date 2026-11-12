import assert from "node:assert/strict";
import test from "node:test";

import { buildGitGraph } from "../utils/git/graphPure.ts";

const commit = (oid, parents, timestamp, message = oid) => ({
  oid,
  commit: {
    message: `${message}\nsecond line`,
    author: { name: "Dev", timestamp },
    parent: parents,
  },
});

test("buildGitGraph déduplique les commits partagés et attache les refs aux têtes", () => {
  const graph = buildGitGraph([
    { name: "main", entries: [commit("c3", ["c2"], 30), commit("c2", ["c1"], 20), commit("c1", [], 10)] },
    { name: "origin/main", entries: [commit("c3", ["c2"], 30), commit("c2", ["c1"], 20), commit("c1", [], 10)] },
  ]);
  assert.deepEqual(graph.lanes, ["main", "origin/main"]);
  assert.equal(graph.commits.length, 3);
  assert.deepEqual(graph.commits[0].refs, ["main", "origin/main"]);
  assert.deepEqual(graph.commits.map((item) => item.oid), ["c3", "c2", "c1"]);
  assert.equal(graph.commits[0].message, "c3");
});

test("buildGitGraph garde les parents après leurs enfants même si les dates sont décalées", () => {
  const graph = buildGitGraph([
    { name: "main", entries: [commit("tip", ["base"], 1), commit("base", [], 100)] },
  ]);
  assert.deepEqual(graph.commits.map((item) => item.oid), ["tip", "base"]);
});

test("buildGitGraph représente les fusions avec deux voies parentes", () => {
  const graph = buildGitGraph([
    { name: "main", entries: [commit("merge", ["main-1", "feature-1"], 50), commit("main-1", ["root"], 40), commit("root", [], 10)] },
    { name: "feature", entries: [commit("feature-1", ["root"], 45), commit("root", [], 10)] },
  ]);
  const merge = graph.commits.find((item) => item.oid === "merge");
  assert.ok(merge);
  assert.equal(merge.merge, true);
  assert.equal(merge.parentLanes.length, 2);
  assert.notEqual(merge.parentLanes[0], merge.parentLanes[1]);
  assert.equal(graph.commits.filter((item) => item.oid === "root").length, 1);
  const mainParent = graph.commits.find((item) => item.oid === "main-1");
  const featureParent = graph.commits.find((item) => item.oid === "feature-1");
  const root = graph.commits.find((item) => item.oid === "root");
  assert.ok(mainParent && featureParent && root);
  assert.equal(mainParent.parentLanes[0], featureParent.lane);
  assert.equal(root.lane, featureParent.lane);
});

test("buildGitGraph respecte la limite demandée", () => {
  const graph = buildGitGraph([
    { name: "main", entries: [commit("c3", ["c2"], 3), commit("c2", ["c1"], 2), commit("c1", [], 1)] },
  ], 2);
  assert.equal(graph.commits.length, 2);
});
