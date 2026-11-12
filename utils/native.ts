/**
 * Pont vers le module natif Android « GitCrushNative » (modules/gitcrush-native) :
 * tuile des Réglages rapides, widget, service d'accessibilité et HTTP sans
 * vérification SSL. Absent (null) dans Expo Go, sur le web ou dans un build
 * réalisé avant l'ajout du module : toute utilisation doit tester `Native`.
 */
import { requireOptionalNativeModule } from "expo-modules-core";

export interface WatchRule {
  pkg: string;
  label: string;
  /** Identifiant du dépôt (conteneur) ; vide = tous les dépôts. */
  repo: string;
  onOpen: boolean;
  onClose: boolean;
}

export interface NativeHttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string; // base64
}

interface NativeApi {
  isAccessibilityEnabled(): boolean;
  openAccessibilitySettings(): void;
  getWatchRules(): string;
  setWatchRules(json: string): void;
  getLaunchableApps(): Promise<{ pkg: string; label: string }[]>;
  /** 2 = ajoutée, 1 = déjà présente, 0 / 3 = refusée ou fermée, ≥ 1000 = erreur, -1 = non prise en charge (Android < 13). */
  requestAddTile(): Promise<number>;
  requestPinWidget(): boolean;
  setWidgetStatus(timestampMs: number, ok: boolean): void;
  /** Clé secrète des liens gitcrush://sync internes (absente des anciens builds). */
  getSyncKey?(): string;
  httpRequest(
    url: string,
    method: string,
    headers: Record<string, string>,
    bodyBase64: string,
    insecure: boolean
  ): Promise<NativeHttpResponse>;
}

export const Native: NativeApi | null = requireOptionalNativeModule<NativeApi>("GitCrushNative");

export function getWatchRules(): WatchRule[] {
  if (!Native) return [];
  try {
    const list = JSON.parse(Native.getWatchRules());
    return Array.isArray(list) ? (list as WatchRule[]) : [];
  } catch {
    return [];
  }
}

export function saveWatchRules(rules: WatchRule[]) {
  Native?.setWatchRules(JSON.stringify(rules));
}

/** Met à jour l'état affiché par le widget (jamais bloquant). */
export function reportSyncToWidget(ok: boolean) {
  try {
    Native?.setWidgetStatus(Date.now(), ok);
  } catch {
    /* widget indisponible : sans importance */
  }
}

/** Clé attendue sur les liens gitcrush://sync lancés par la tuile, le widget ou l'accessibilité (AUDIT-003). */
export function getSyncKey(): string | null {
  try {
    return Native?.getSyncKey?.() ?? null;
  } catch {
    return null;
  }
}
