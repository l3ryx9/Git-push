/**
 * Client HTTP pour isomorphic-git basé sur expo/fetch (implémentation native,
 * conforme au standard : corps binaires en envoi et en réception).
 */
import { Buffer } from "buffer";
import { fetch as expoFetch } from "expo/fetch";

import { Native } from "../native";

type Body = Uint8Array | Iterable<Uint8Array> | AsyncIterable<Uint8Array> | undefined | null;

async function collect(body: Body): Promise<Uint8Array | undefined> {
  if (body == null) return undefined;
  if (body instanceof Uint8Array) return body;
  const anyBody = body as any;
  const iter =
    typeof Symbol.asyncIterator !== "undefined" && anyBody[Symbol.asyncIterator]
      ? anyBody[Symbol.asyncIterator]()
      : anyBody[Symbol.iterator]
        ? anyBody[Symbol.iterator]()
        : anyBody;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await iter.next();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export const http = {
  async request({
    url,
    method = "GET",
    headers = {},
    body,
  }: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: Body;
  }) {
    const data = await collect(body);
    const res = await expoFetch(url, { method, headers, body: data as any });
    const buffer = new Uint8Array(await res.arrayBuffer());
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((value: string, key: string) => {
      outHeaders[key.toLowerCase()] = value;
    });
    return {
      url: (res as any).url || url,
      method,
      statusCode: res.status,
      statusMessage: res.statusText ?? "",
      body: [buffer],
      headers: outHeaders,
    };
  },
};

/**
 * Variante pour les dépôts dont la vérification SSL est désactivée (certificat auto-signé) :
 * la requête passe par le module natif Android. Le corps transite en base64, donc à réserver
 * aux serveurs concernés (les très gros dépôts consomment beaucoup de mémoire).
 */
export const httpInsecure = {
  async request({
    url,
    method = "GET",
    headers = {},
    body,
  }: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: Body;
  }) {
    if (!Native) {
      const e = new Error("Native module unavailable") as Error & { code: string };
      e.code = "NativeUnavailable";
      throw e;
    }
    const data = await collect(body);
    const bodyBase64 = data ? Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64") : "";
    const res = await Native.httpRequest(url, method, headers, bodyBase64, true);
    return {
      url,
      method,
      statusCode: res.status,
      statusMessage: res.statusText ?? "",
      body: [new Uint8Array(Buffer.from(res.body, "base64"))],
      headers: res.headers ?? {},
    };
  },
};
