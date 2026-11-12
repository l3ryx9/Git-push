/**
 * Vérifications exécutées SUR le téléphone : stockage, coffre sécurisé, moteur Git,
 * lecture YAML, réseau. Si quelque chose casse après une mise à jour, on le voit
 * en un tap, avec un rapport à partager.
 */
import Constants from "expo-constants";
import { Platform } from "react-native";

import { applyEdits, fmtBytes, redactSecrets, summarizeTree } from "@/utils/ai/pure";
import { loadAi } from "@/utils/ai/settings";
import { lintWorkflow, workflowTemplate } from "@/utils/ai/workflows";
import { readErrors } from "@/utils/errorLog";
import * as engine from "@/utils/git/engine";
import { makeDir, readText, removePath, ROOT_PATH, writeTextDeep } from "@/utils/git/fs";
import type { Usage } from "@/utils/git/storage";
import { getSecret, secretsStatus, setSecret } from "@/utils/secrets";

export interface Check {
  id: string;
  ok: boolean;
  detail?: string;
}

async function guard(id: string, fn: () => Promise<string | void>): Promise<Check> {
  try {
    const detail = await fn();
    return { id, ok: true, detail: detail || undefined };
  } catch (e: any) {
    return { id, ok: false, detail: String(e?.message ?? e).slice(0, 200) };
  }
}

export async function runChecks(onCheck?: (c: Check) => void): Promise<Check[]> {
  const out: Check[] = [];
  const add = async (id: string, fn: () => Promise<string | void>) => {
    const c = await guard(id, fn);
    out.push(c);
    onCheck?.(c);
  };

  await add("edit", async () => {
    const r = applyEdits("a\nfoo($1)\nb\n", { edits: [{ old_text: "foo($1)", new_text: "bar($&)" }] });
    if (!("text" in r) || r.text !== "a\nbar($&)\nb\n") throw new Error("édition inattendue");
    if (!summarizeTree(["a/b/c.ts"]).includes("Dossiers")) throw new Error("résumé inattendu");
  });

  await add("yaml", async () => {
    const yml = workflowTemplate("node-ci", { kind: "node", hasGradlew: false, hasLockfile: false });
    const issues = yml ? lintWorkflow(yml) : ["modèle introuvable"];
    if (issues.length) throw new Error(issues[0]);
  });

  await add("secrets", async () => {
    const st = await secretsStatus();
    await setSecret("gitcrush_diag", "ok");
    const back = await getSecret("gitcrush_diag");
    await setSecret("gitcrush_diag", null);
    if (back !== "ok") throw new Error("lecture impossible");
    return st.secure && !st.degraded ? "coffre du téléphone" : "repli sans coffre (moins sûr)";
  });

  await add("files", async () => {
    const dir = `${ROOT_PATH}/diag-tmp`;
    await makeDir(dir);
    await writeTextDeep(`${dir}/t.txt`, "ok");
    const back = await readText(`${dir}/t.txt`);
    await removePath(dir);
    if (back !== "ok") throw new Error("relecture différente");
  });

  await add("git", async () => {
    const dir = `${ROOT_PATH}/diag-git`;
    await removePath(dir).catch(() => undefined);
    try {
      await makeDir(dir);
      const author = { name: "Diag", email: "diag@localhost" };
      await engine.initRepo(dir, author, "main");
      await writeTextDeep(`${dir}/a.txt`, "x");
      const st = await engine.getStatus(dir);
      if (st.length !== 1) throw new Error(`statut inattendu (${st.length})`);
      await engine.stagePaths(dir, ["a.txt"]);
      const oid = await engine.commitStaged({ dir, creds: null, author, remote: "origin" }, "diag");
      if (!oid) throw new Error("commit impossible");
      if ((await engine.getStatus(dir)).length) throw new Error("statut non vide après commit");
    } finally {
      engine.dropCache(dir);
      await removePath(dir).catch(() => undefined);
    }
  });

  await add("network", async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch("https://api.github.com/zen", { signal: ctrl.signal });
      return `GitHub répond (HTTP ${r.status})`;
    } finally {
      clearTimeout(timer);
    }
  });

  return out;
}

/** Rapport texte à partager (aucune clé, aucun token). */
export async function buildReport(checks: Check[], usage: Usage | null, labels: (id: string) => string): Promise<string> {
  const ai = await loadAi();
  const errors = await readErrors();
  const lines = [
    `Git-Push ${Constants.expoConfig?.version ?? "?"} · ${Platform.OS} ${Platform.Version}`,
    `IA : ${ai.enabled ? "activée" : "désactivée"} · ${ai.provider} · ${ai.models[ai.provider]} · clé ${ai.keys[ai.provider] ? "présente" : "absente"} · quota gratuit ${ai.freeTier ? "oui" : "non"}`,
    usage ? `Stockage : ${fmtBytes(usage.total)} (${usage.repos.length} dépôt(s), ${usage.orphans.length} dossier(s) orphelin(s))` : "",
    "",
    "Vérifications :",
    ...checks.map((c) => `${c.ok ? "✓" : "✗"} ${labels(c.id)}${c.detail ? ` — ${c.detail}` : ""}`),
    "",
    `Erreurs récentes (${errors.length}) :`,
    ...errors.slice(0, 8).map((e) => `- ${new Date(e.at).toISOString()} [${e.source}] ${e.message}`),
  ];
  // Dernier filet : aucun secret ne doit partir dans un rapport partagé.
  return redactSecrets(lines.filter((l, i) => l !== "" || i > 0).join("\n"));
}
