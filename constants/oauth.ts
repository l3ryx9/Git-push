/**
 * Connexion OAuth à GitHub (Device Flow — aucun secret dans l'app).
 *
 * Pour l'activer une fois pour toutes :
 *  1. github.com → Settings → Developer settings → OAuth Apps → New OAuth App
 *     - Homepage URL : n'importe quelle URL (ex : https://github.com/<toi>)
 *     - Authorization callback URL : gitcrush://oauth-callback
 *  2. Coche « Enable Device Flow », enregistre.
 *  3. Copie le « Client ID » ici (ou colle-le dans l'app au moment de la connexion).
 *
 * Le Client ID n'est pas secret : il peut être versionné.
 */
export const GITHUB_OAUTH_CLIENT_ID = "";

/** Adresse de retour OAuth (GitLab / Gitea) : à déclarer dans l'application OAuth. */
export const OAUTH_REDIRECT_URI = "gitcrush://oauth-callback";

/** Droits demandés à GitHub (dépôts, workflows, profil, suppression de dépôts). */
export const GITHUB_SCOPES = "repo workflow read:user user:email delete_repo";
export const GITLAB_SCOPES = "api read_user";
