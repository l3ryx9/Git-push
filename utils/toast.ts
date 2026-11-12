/**
 * Notifications discrètes (« toasts ») : confirment une action réussie sans
 * bloquer l'écran avec une boîte de dialogue à fermer. Utilisable hors React.
 */
import * as Haptics from "expo-haptics";

export type ToastKind = "success" | "info" | "warning" | "error";
export interface Toast {
  id: number;
  title?: string;
  message: string;
  kind: ToastKind;
}

let seq = 0;
const listeners = new Set<(t: Toast) => void>();

export function subscribeToasts(fn: (t: Toast) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function showToast(message: string, kind: ToastKind = "success", title?: string) {
  const t: Toast = { id: ++seq, message, kind, title };
  if (kind === "success") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  else if (kind === "error") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
  else if (kind === "warning") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
  listeners.forEach((fn) => fn(t));
}
