🇬🇧 [English](BUILD_APK.en.md) · 🇫🇷 Français

# Construire l'APK sur GitHub (sans compte Expo)

Le workflow `.github/workflows/build-apk.yml` compile l'application directement sur GitHub : `expo prebuild` puis Gradle. Il n'utilise ni EAS, ni `EXPO_TOKEN`, ni compte Expo (les champs `owner`, `updates` et `extra.eas` d'`app.json` sont retirés pendant le build, sans toucher à ton dépôt).

## Lancer un build (depuis le téléphone)

1. Dans ton dépôt GitHub : onglet **Actions** → **Build APK Android** → **Run workflow**.
2. Choisis les options (les valeurs par défaut conviennent) :
   - **build_type** : `release` (APK normal) ou `debug`.
   - **abi** : `arm64-v8a` (téléphones récents, plus rapide et plus léger) ou `all` (tous les processeurs, y compris émulateurs).
   - **minify** : réduit et obfusque le code natif (R8), APK plus léger. Coché par défaut ; si R8 fait échouer le build, il est relancé automatiquement sans minification.
   - **publish** : publie l'APK dans les Releases (build de test numéroté ; pour une vraie version, utilise « Publier une release »).
3. Attends 10 à 25 minutes (le premier build est le plus long, ensuite le cache aide).
4. Télécharge l'APK dans l'onglet **Releases** (lien direct) ou dans les **Artifacts** du run.

Un `push` sur `main` ou `master` lance aussi un build (sans publier de Release).

## Publier une release (version officielle)

Le workflow `.github/workflows/release.yml` compile l'APK **et le publie dans l'onglet Releases**, avec des notes de version générées automatiquement et un fichier `SHA256SUMS.txt` pour vérifier le téléchargement.

Deux façons de le lancer, depuis le téléphone :

1. **Actions** → **Publier une release** → **Run workflow** → saisis la version (`v1.0.0`, ou `v1.0.0-beta.1` pour une pré-version).
2. **Releases** → **Draft a new release** → crée le tag `v1.0.0` → **Publish**. (Un `git push` d'un tag `v*` fait pareil.)

La version doit avoir la forme `v1.2.3` : sinon le workflow s'arrête tout de suite avec un message clair. Une version avec un tiret (`-beta.1`) est automatiquement marquée « pré-version ». Le build est celui de `build-apk.yml` (réutilisé), avec tes secrets de signature s'ils sont définis.

## Secrets et variables (facultatifs)

Dépôt → Settings → Secrets and variables → Actions.

| Nom | Type | Rôle |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | secret | Ton keystore de release encodé en base64. |
| `ANDROID_STORE_PASSWORD` | secret | Mot de passe du keystore. |
| `ANDROID_KEY_ALIAS` | secret | Alias de la clé. |
| `ANDROID_KEY_PASSWORD` | secret | Mot de passe de la clé. |

## Signature

- **Sans keystore** : l'APK release est signé avec la clé de debug du modèle Expo. Il s'installe normalement ; c'est suffisant pour un usage personnel. Il n'est pas publiable sur le Play Store.
- **Avec keystore** : renseigne les 4 secrets `ANDROID_*`. `ci/sign-android.js` branche alors la vraie signature sur le build release.

## Relances automatiques

Le build n'utilise **aucune IA**. Il se relance seul dans deux cas seulement : échec causé par la minification R8 (relance sans minification) et coupure réseau passagère (une nouvelle tentative). Toute autre erreur arrête le build tout de suite, avec la liste des erreurs dans la page **Summary**.

## En cas d'échec

Ouvre le run → page **Summary** : un bloc « Le build a échoué » liste les erreurs Gradle / Kotlin à copier. Les journaux complets sont dans l'artefact `build-logs-N`.

## Coût

Dépôt public : minutes gratuites. Dépôt privé : tu consommes le quota mensuel de ton offre GitHub (un build Android prend 10 à 25 minutes).
