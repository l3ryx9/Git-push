/** Aides pures pour le client HTTP Git (testables avec `npm test`). */

/**
 * Corps de réponse au format attendu par isomorphic-git (itérateur asynchrone).
 * Itérateur écrit à la main (pas de générateur async) : fonctionne partout sous Hermes.
 */
export function singleChunkBody(chunk: Uint8Array): AsyncIterableIterator<Uint8Array> {
  let done = false;
  const it: AsyncIterableIterator<Uint8Array> = {
    next: async () => {
      if (done) return { done: true, value: undefined };
      done = true;
      return { done: false, value: chunk };
    },
    return: async () => {
      done = true;
      return { done: true, value: undefined };
    },
    [Symbol.asyncIterator]() {
      return it;
    },
  };
  return it;
}

