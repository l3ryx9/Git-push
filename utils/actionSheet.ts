/**
 * Menus d'actions (feuille du bas) : remplace les menus Alert.alert natifs, limités
 * à 3 boutons sur Android (d'où l'ancien sous-menu « Plus… ») et sans icônes.
 * Utilisable hors React, comme les toasts.
 */
import type { ComponentProps } from "react";
import type { Feather } from "@expo/vector-icons";

export interface SheetAction {
  label: string;
  icon?: ComponentProps<typeof Feather>["name"];
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

export interface SheetRequest {
  id: number;
  title?: string;
  message?: string;
  actions: SheetAction[];
}

let seq = 0;
const listeners = new Set<(r: SheetRequest) => void>();

export function subscribeActionSheet(fn: (r: SheetRequest) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Ouvre le menu ; « Annuler » est ajouté automatiquement par l'hôte. */
export function showActionSheet(opts: { title?: string; message?: string; actions: SheetAction[] }) {
  const req: SheetRequest = { id: ++seq, title: opts.title, message: opts.message, actions: opts.actions.filter(Boolean) };
  listeners.forEach((fn) => fn(req));
}
