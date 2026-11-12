/**
 * Client HTTP pour isomorphic-git basé sur expo/fetch (implémentation native,
 * conforme au standard : corps binaires en envoi et en réception).
 */
import { Buffer } from "buffer";
import { fetch as expoFetch } from "expo/fetch";
import type { GitHttpRequest, GitHttpResponse, HttpClient } from "isomorphic-git";

import { Native } from "../native";

import { singleChunkBody } from "./httpPure";
import { hostOfUrl, resolveLocation } from "./securityPure";
import { isPrivateHost } from "./store";

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

/**
 * Refuse d'envoyer un mot de passe / token en clair (http://) vers Internet :
 * n'importe quel intermédiaire (Wi-Fi public, opérateur) pourrait le lire.
 * Le réseau local (LAN, VPN) reste autorisé pour les serveurs auto-hébergés.
 */
function guardTransport(url: string, headers: Record<string, string>) {
  if (!/^http:\/\//i.test(url)) return;
  const hasAuth = Object.keys(headers).some((k) => k.toLowerCase() === "authorization");
  if (!hasAuth) return;
  const host = /^http:\/\/(?:[^@/]+@)?([^/:]+)/i.exec(url)?.[1] ?? "";
  if (isPrivateHost(host)) return;
  const e = new Error(`Connexion non chiffrée (http://) vers ${host} : identifiants non envoyés`) as Error & { code: string };
  e.code = "InsecureTransport";
  throw e;
}

export const http: HttpClient = {
  async request({ url, method = "GET", headers = {}, body }: GitHttpRequest): Promise<GitHttpResponse> {
    guardTransport(url, headers);
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
      body: singleChunkBody(buffer),
      headers: outHeaders,
    };
  },
};

/**
 * Variante pour les dépôts dont la vérification SSL est désactivée (certificat auto-signé) :
 * la requête passe par le module natif Android. Le corps transite en base64, donc à réserver
 * aux serveurs concernés (les très gros dépôts consomment beaucoup de mémoire).
 */
export const httpInsecure: HttpClient = {
  async request({ url, method = "GET", headers = {}, body }: GitHttpRequest): Promise<GitHttpResponse> {
    if (!Native) {
      const e = new Error("Native module unavailable") as Error & { code: string };
      e.code = "NativeUnavailable";
      throw e;
    }
    const data = await collect(body);
    const bodyBase64 = data ? Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64") : "";
    // Les redirections sont suivies ICI (le module natif ne les suit plus) : l'en-tête
    // Authorization est retiré dès que l'hôte change (AUDIT-001 / AUDIT-004).
    let current = url;
    let currentHeaders = headers;
    let currentMethod = method;
    let currentBody = bodyBase64;
    for (let hop = 0; ; hop++) {
      guardTransport(current, currentHeaders);
      const res = await Native.httpRequest(current, currentMethod, currentHeaders, currentBody, true);
      const location = res.status >= 300 && res.status < 400 ? (res.headers?.location ?? "") : "";
      if (!location || hop >= 5) {
        return {
          url: current,
          method: currentMethod,
          statusCode: res.status,
          statusMessage: res.statusText ?? "",
          body: singleChunkBody(new Uint8Array(Buffer.from(res.body, "base64"))),
          headers: res.headers ?? {},
        };
      }
      const next = resolveLocation(location, current);
      if (hostOfUrl(next) !== hostOfUrl(current) || (/^https:/i.test(current) && !/^https:/i.test(next))) {
        currentHeaders = Object.fromEntries(Object.entries(currentHeaders).filter(([k]) => k.toLowerCase() !== "authorization"));
      }
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && currentMethod === "POST")) {
        currentMethod = "GET";
        currentBody = "";
      }
      current = next;
    }
  },
};
