import { Alert, Platform } from "react-native";

/**
 * Alert.alert est un no-op sur react-native-web : les boutons ne s'affichent
 * jamais et les callbacks ne sont jamais appelés. Ces helpers utilisent
 * window.alert / window.confirm sur le web et Alert.alert sur natif,
 * pour que les confirmations (suppression de répertoire, vidage du dépôt…)
 * fonctionnent partout.
 */

export function showAlert(
  title: string,
  message?: string,
  buttons?: { text: string; onPress?: () => void }[]
) {
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    window.alert(message ? `${title}\n\n${message}` : title);
    // Sur le web on exécute le premier bouton "action" éventuel (ex: OK)
    const primary = buttons?.find((b) => b.onPress);
    primary?.onPress?.();
    return;
  }
  Alert.alert(title, message, buttons?.map((b) => ({ text: b.text, onPress: b.onPress })));
}

export function showConfirm(opts: {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    const ok = window.confirm(`${opts.title}\n\n${opts.message}`);
    if (ok) opts.onConfirm();
    return;
  }
  Alert.alert(opts.title, opts.message, [
    { text: opts.cancelText, style: "cancel" },
    {
      text: opts.confirmText,
      style: opts.destructive ? "destructive" : "default",
      onPress: opts.onConfirm,
    },
  ]);
}
