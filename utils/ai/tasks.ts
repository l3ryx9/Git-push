/**
 * Tâches IA ponctuelles : message de commit, modification d'un fichier selon
 * une consigne, rédaction / complétion de textes (issues, PR, commentaires).
 */
import { isBinary, unifiedDiff } from "@/utils/git/diff";
import * as engine from "@/utils/git/engine";
import { decodeUtf8 } from "@/utils/git/fs";

import { stripFences } from "./agent";
import { complete } from "./providers";
import type { AiSettings } from "./settings";

const LANG: Record<string, string> = { fr: "français", en: "English", es: "español", zh: "中文", ru: "русский" };
const lname = (lang: string) => LANG[lang] ?? "English";

/** Diff textuel des fichiers donnés (HEAD → copie de travail), limité en taille. */
export async function diffText(dir: string, paths: string[], limit = 40000): Promise<string> {
  let out = "";
  for (const p of paths) {
    if (out.length > limit) {
      out += `\n… (${paths.length} fichiers au total, diff tronqué)`;
      break;
    }
    const [a, b] = await Promise.all([engine.fileAt(dir, "HEAD", p), engine.fileAt(dir, "WORKDIR", p)]);
    if ((a && isBinary(a)) || (b && isBinary(b))) {
      out += `\n=== ${p} (binaire)\n`;
      continue;
    }
    const d = unifiedDiff(a ? decodeUtf8(a) : "", b ? decodeUtf8(b) : "");
    out += `\n=== ${p}${!a ? " (nouveau)" : !b ? " (supprimé)" : ""}\n`;
    out += d.rows.map((r) => (r.kind === "hunk" ? r.text : `${r.t === 1 ? "+" : r.t === -1 ? "-" : " "}${r.text}`)).join("\n");
  }
  return out.slice(0, limit + 200);
}

export async function suggestCommitMessage(s: AiSettings, dir: string, paths: string[], draft: string, lang: string): Promise<string> {
  const diff = await diffText(dir, paths);
  const log = await engine.getLog(dir, "HEAD", 8).catch(() => []);
  const style = log.map((c) => `- ${c.commit.message.split("\n")[0]}`).join("\n");
  const out = await complete(
    s,
    `Tu écris des messages de commit Git. Réponds UNIQUEMENT avec le message (pas de guillemets, pas de bloc de code). Langue : ${lname(lang)}, sauf si les commits récents sont dans une autre langue : suis alors leur langue et leur style. Première ligne ≤ 72 caractères, à l'impératif ; ajoute une ligne vide puis quelques puces seulement si le changement est important.`,
    `${draft ? `Début de message déjà écrit (à compléter / améliorer) : ${draft}\n\n` : ""}Commits récents :\n${style || "(aucun)"}\n\nDiff :\n${diff}`,
    undefined,
    true
  );
  return stripFences(out).replace(/^["'`]|["'`]$/g, "").trim();
}

export async function aiEditFile(s: AiSettings, path: string, content: string, instruction: string, lang: string): Promise<string> {
  const out = await complete(
    s,
    `Tu modifies des fichiers de code. On te donne un fichier et une consigne. Renvoie le fichier COMPLET modifié, dans un seul bloc de code, sans aucun texte avant ou après. Ne change que ce que demande la consigne, conserve le style, l'indentation et les fins de ligne. Les commentaires éventuels que tu ajoutes sont en ${lname(lang)}.`,
    `Fichier : ${path}\nConsigne : ${instruction}\n\n\`\`\`\n${content}\n\`\`\``
  );
  let next = stripFences(out);
  if (content.endsWith("\n") && !next.endsWith("\n")) next += "\n";
  return next;
}

export type DraftKind = "issue" | "pull" | "comment" | "generic";

export async function draftText(s: AiSettings, kind: DraftKind, context: string, current: string, lang: string): Promise<string> {
  const what = {
    issue: "la description d'une issue (contexte, comportement attendu / observé, étapes, en Markdown)",
    pull: "la description d'une pull request (résumé, liste des changements, points à vérifier, en Markdown)",
    comment: "une réponse à un fil de discussion d'issue / pull request (cordiale, précise, en Markdown)",
    generic: "le texte demandé",
  }[kind];
  const out = await complete(
    s,
    `Tu aides à rédiger ${what}. Langue : ${lname(lang)}. Réponds UNIQUEMENT avec le texte final, prêt à coller, sans introduction.`,
    `${context}\n\n${current ? `Brouillon actuel à compléter / améliorer :\n${current}` : "Pas encore de brouillon : rédige-le."}`,
    undefined,
    true
  );
  return out.trim();
}
