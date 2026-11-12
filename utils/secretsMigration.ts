/**
 * Déplace au démarrage les anciennes clés / tokens / mots de passe (en clair dans
 * AsyncStorage) vers le coffre sécurisé. Chaque module le ferait aussi à sa
 * première lecture ; ceci garantit que rien ne reste en clair si l'écran
 * concerné n'est jamais ouvert.
 */
import { loadAccounts } from "./accounts";
import { loadAi } from "./ai/settings";
import { loadContainers } from "./git/store";
import { getGitHubToken } from "./secrets";

export async function runSecretsMigration(): Promise<void> {
  try {
    await getGitHubToken();
    await loadAi();
    await loadAccounts();
    await loadContainers();
  } catch {
    /* sera retenté à la prochaine lecture */
  }
}
