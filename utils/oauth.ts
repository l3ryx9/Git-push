/**
 * Flux OAuth sans secret embarqué :
 * - GitHub : Device Flow (un code à saisir sur github.com/login/device) ;
 * - GitLab / Gitea / Forgejo : Authorization Code + PKCE, retour via
 *   gitcrush://oauth-callback dans un onglet de navigateur sécurisé.
 */
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";

import { GITHUB_SCOPES, GITLAB_SCOPES, OAUTH_REDIRECT_URI } from "@/constants/oauth";

import type { Account, ForgeKind } from "./accounts";

function oauthError(code: string, message?: string) {
  const e = new Error(message ?? code) as Error & { code: string };
  e.code = code;
  return e;
}

function form(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function queryParam(url: string, name: string): string | undefined {
  const m = new RegExp(`[?&#]${name}=([^&#]*)`).exec(url);
  return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : undefined;
}

// ─── GitHub : Device Flow ─────────────────────────────────────────────────────

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresAt: number;
}

export async function githubDeviceStart(clientId: string): Promise<DeviceCode> {
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ client_id: clientId, scope: GITHUB_SCOPES }),
  });
  const j = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !j.device_code) {
    throw oauthError(j.error === "device_flow_disabled" ? "DeviceFlowDisabled" : "OAuthFailed", j.error_description || j.error || `HTTP ${res.status}`);
  }
  return {
    deviceCode: j.device_code,
    userCode: j.user_code,
    verificationUri: j.verification_uri || "https://github.com/login/device",
    interval: Number(j.interval) || 5,
    expiresAt: Date.now() + (Number(j.expires_in) || 900) * 1000,
  };
}

/** Attend que l'utilisateur valide le code ; renvoie le token. Annulable via isCancelled. */
export async function githubDevicePoll(clientId: string, dc: DeviceCode, isCancelled: () => boolean): Promise<string> {
  let interval = dc.interval;
  while (Date.now() < dc.expiresAt) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    if (isCancelled()) throw oauthError("OAuthCancelled");
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ client_id: clientId, device_code: dc.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
    }).catch(() => null);
    if (!res) continue; // réseau : on réessaie
    const j = (await res.json().catch(() => ({}))) as any;
    if (j.access_token) return j.access_token as string;
    if (j.error === "authorization_pending") continue;
    if (j.error === "slow_down") {
      interval = (Number(j.interval) || interval) + 1;
      continue;
    }
    if (j.error === "access_denied") throw oauthError("OAuthDenied");
    if (j.error === "expired_token") break;
    throw oauthError("OAuthFailed", j.error_description || j.error || `HTTP ${res.status}`);
  }
  throw oauthError("OAuthExpired");
}

// ─── GitLab / Gitea : PKCE ────────────────────────────────────────────────────

function endpoints(kind: ForgeKind, base: string) {
  return kind === "gitlab"
    ? { authorize: `${base}/oauth/authorize`, token: `${base}/oauth/token`, scope: GITLAB_SCOPES }
    : { authorize: `${base}/login/oauth/authorize`, token: `${base}/login/oauth/access_token`, scope: "" };
}

function base64Url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(bytes: number): string {
  const arr = Crypto.getRandomBytes(bytes);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, "0");
  return s;
}

export interface TokenResult {
  token: string;
  refreshToken?: string;
  expiresIn?: number;
  verifier?: string;
}

async function tokenRequest(url: string, data: Record<string, string>): Promise<TokenResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: form(data),
  });
  const j = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !j.access_token) throw oauthError("OAuthFailed", j.error_description || j.error || `HTTP ${res.status}`);
  return { token: j.access_token, refreshToken: j.refresh_token, expiresIn: j.expires_in ? Number(j.expires_in) : undefined };
}

export async function pkceLogin(kind: ForgeKind, base: string, clientId: string): Promise<TokenResult> {
  const ep = endpoints(kind, base);
  const verifier = randomString(48);
  const challenge = base64Url(
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 })
  );
  const state = randomString(12);
  const params: Record<string, string> = {
    client_id: clientId,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: "code",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  };
  if (ep.scope) params.scope = ep.scope;
  const result = await WebBrowser.openAuthSessionAsync(`${ep.authorize}?${form(params)}`, OAUTH_REDIRECT_URI);
  const url = result.type === "success" ? ((result as { url?: string }).url ?? "") : "";
  if (!url) throw oauthError("OAuthCancelled");
  const err = queryParam(url, "error");
  if (err) throw oauthError(err === "access_denied" ? "OAuthDenied" : "OAuthFailed", queryParam(url, "error_description") || err);
  if (queryParam(url, "state") !== state) throw oauthError("OAuthFailed", "state mismatch");
  const code = queryParam(url, "code");
  if (!code) throw oauthError("OAuthFailed", "no code");
  const tok = await tokenRequest(ep.token, {
    client_id: clientId,
    code,
    grant_type: "authorization_code",
    redirect_uri: OAUTH_REDIRECT_URI,
    code_verifier: verifier,
  });
  return { ...tok, verifier };
}

export async function refreshOAuth(a: Account): Promise<TokenResult> {
  if (!a.refreshToken || !a.clientId) throw oauthError("OAuthFailed", "no refresh token");
  return tokenRequest(endpoints(a.kind, a.baseUrl).token, {
    client_id: a.clientId,
    refresh_token: a.refreshToken,
    grant_type: "refresh_token",
    redirect_uri: OAUTH_REDIRECT_URI,
  });
}

/** Profil de l'utilisateur d'une forge (vérifie aussi le token). */
export async function fetchForgeUser(kind: ForgeKind, base: string, token: string) {
  const url = kind === "gitlab" ? `${base}/api/v4/user` : `${base}/api/v1/user`;
  const res = await fetch(url, { headers: { Authorization: kind === "gitlab" ? `Bearer ${token}` : `token ${token}`, Accept: "application/json" } });
  if (!res.ok) throw oauthError("OAuthFailed", `HTTP ${res.status}`);
  const j = (await res.json()) as any;
  return {
    username: (j.username ?? j.login) as string,
    name: (j.name ?? j.full_name ?? undefined) as string | undefined,
    avatar: (j.avatar_url ?? undefined) as string | undefined,
  };
}
