🇬🇧 [English](BUILD_APK.en.md) · 🇫🇷 Français

# Construire l'APK sur GitHub (sans compte Expo)

Le workflow `.github/workflows/build-apk.yml` compile l'application directement sur GitHub : `expo prebuild` puis Gradle. Il n'utilise ni EAS, ni `EXPO_TOKEN`, ni compte Expo (les champs `owner`, `updates` et `extra.eas` d'`app.json` sont retirés pendant le build, sans toucher à ton dépôt).

## Lancer un build (depuis le téléphone)

1. Dans ton dépôt GitHub : onglet **Actions** → **Build APK Android** → **Run workflow**.
2. Choisis les options (les valeurs par défaut conviennent) :
   - **build_type** : `release` (APK normal) ou `debug`.
   - **abi** : `arm64-v8a` (téléphones récents, plus rapide et plus léger) ou `all` (tous les processeurs, y compris émulateurs).
   - **minify** : réduit et obfusque le code natif (R8), APK plus léger. Coché par défaut ; si R8 fait échouer le build, il est relancé automatiquement sans minification.
   - **attempts** et **publish** : voir plus bas.
3. Attends 10 à 25 minutes (le premier build est le plus long, ensuite le cache aide).
4. Télécharge l'APK dans l'onglet **Releases** (lien direct) ou dans les **Artifacts** du run.

Un `push` sur `main` ou `master` lance aussi un build (sans publier de Release).

## Secrets et variables (facultatifs)

Dépôt → Settings → Secrets and variables → Actions.

| Nom | Type | Rôle |
|---|---|---|
| `GEMINI_API_KEY` | secret | Active la correction automatique par IA entre deux tentatives (`ci/`). Sans elle : un seul essai (deux si la minification est active : le second sans R8). |
| `GEMINI_MODEL` | variable | Modèle Gemini à utiliser (défaut : `gemini-3.5-flash`). |
| `ANDROID_KEYSTORE_BASE64` | secret | Ton keystore de release encodé en base64. |
| `ANDROID_STORE_PASSWORD` | secret | Mot de passe du keystore. |
| `ANDROID_KEY_ALIAS` | secret | Alias de la clé. |
| `ANDROID_KEY_PASSWORD` | secret | Mot de passe de la clé. |

## Signature

- **Sans keystore** : l'APK release est signé avec la clé de debug du modèle Expo. Il s'installe normalement ; c'est suffisant pour un usage personnel. Il n'est pas publiable sur le Play Store.
- **Avec keystore** : renseigne les 4 secrets `ANDROID_*`. `ci/sign-android.js` branche alors la vraie signature sur le build release.

## En cas d'échec

Ouvre le run → page **Summary** : un bloc « Le build a échoué » liste les erreurs Gradle / Kotlin à copier. Les journaux complets sont dans l'artefact `build-logs-N`.

## Coût

Dépôt public : minutes gratuites. Dépôt privé : tu consommes le quota mensuel de ton offre GitHub (un build Android prend 10 à 25 minutes).
