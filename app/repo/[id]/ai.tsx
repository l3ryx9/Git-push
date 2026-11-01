import { Redirect, useLocalSearchParams } from "expo-router";
import React from "react";

/** L'assistant IA vit maintenant dans l'onglet « Agent IA » ; cette route redirige (anciens liens). */
export default function AiRedirect() {
  const { id, prompt } = useLocalSearchParams<{ id: string; prompt?: string }>();
  return <Redirect href={{ pathname: "/(tabs)/ai", params: { repo: id, ...(prompt ? { prompt } : {}) } } as any} />;
}
