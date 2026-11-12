/**
 * Vérification de sécurité renforcée pour les actions destructrices ou sensibles
 * (vider un dépôt, supprimer des dépôts sur GitHub, supprimer un dépôt local…).
 *
 * Une simple fenêtre « OK / Annuler » se valide d'un réflexe. Ici l'utilisateur doit
 * RECOPIER une phrase (nom du dépôt, ou mot de sécurité) et attendre un court délai
 * avant que le bouton ne devienne actif. Utilisable hors React, comme les toasts.
 */

export interface TypedConfirmRequest {
  id: number;
  title: string;
  message: string;
  /** Texte exact à recopier (comparaison insensible à la casse et aux espaces de bord). */
  phrase: string;
  confirmText: string;
  cancelText: string;
  /** Délai (ms) avant activation du bouton, pour éviter un appui réflexe. */
  delayMs: number;
  onConfirm: () => void;
}

/** Normalise une saisie : espaces de bord retirés, casse ignorée, espaces multiples réduits. */
export function normalizePhrase(s: string): string {
  return s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Vrai si la saisie correspond exactement à la phrase attendue (jamais pour une phrase vide). */
export function phraseMatches(input: string, expected: string): boolean {
  const e = normalizePhrase(expected);
  return e.length > 0 && normalizePhrase(input) === e;
}

let seq = 0;
const listeners = new Set<(r: TypedConfirmRequest) => void>();

export function subscribeTypedConfirm(fn: (r: TypedConfirmRequest) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Ouvre la confirmation par saisie. Si aucun hôte n'est monté (cas anormal), l'action
 * n'est PAS exécutée : on préfère ne rien faire plutôt que supprimer sans vérification.
 */
export function showTypedConfirm(opts: {
  title: string;
  message: string;
  phrase: string;
  confirmText: string;
  cancelText: string;
  delayMs?: number;
  onConfirm: () => void;
}): boolean {
  if (listeners.size === 0 || !opts.phrase.trim()) return false;
  const req: TypedConfirmRequest = { id: ++seq, delayMs: 2000, ...opts };
  req.delayMs = opts.delayMs ?? 2000;
  listeners.forEach((fn) => fn(req));
  return true;
}
