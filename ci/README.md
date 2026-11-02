# CI — Build Android (sans IA)

Compile l'APK de **Git-Push** sur GitHub Actions (`expo prebuild` puis Gradle). Aucun service externe, aucune clé d'IA : le build est déterministe.

## Fichiers

```
ci/
├── retryBuild.js    # Orchestrateur : lance Gradle, analyse les erreurs, relance si utile
├── analyzeLogs.js   # Détection des erreurs Gradle / Kotlin / Metro / npm / Expo
├── config.js        # Configuration (variables d'environnement)
├── prepare.js       # Nettoyage du package.json pour la CI
├── sign-android.js  # Signature release (keystore optionnel)
└── logs/            # Journaux générés à chaque run (créé automatiquement)
```

## Relances automatiques (3 essais au plus)

`retryBuild.js` ne relance le build que dans **deux cas** où cela peut aider :

| Cas | Action |
|---|---|
| Échec causé par **R8** (minification) | Relance **sans minification** (APK un peu plus gros, mais le build passe) |
| **Coupure réseau passagère** (téléchargement de dépendances) | Une nouvelle tentative après 20 s |

Toute autre erreur (code, configuration) **arrête le build tout de suite** : relancer à l'identique donnerait le même résultat. Les erreurs sont alors listées dans la page **Summary** du run, et les journaux complets sont dans l'artefact `build-logs-N`.

## Variables d'environnement (facultatives)

| Variable | Défaut | Description |
|---|---|---|
| `BUILD_TYPE` | `release` | `debug` ou `release` |
| `MAX_BUILD_ATTEMPTS` | `5` (3 dans le workflow) | Nombre maximum d'essais (1 à 10) |
| `GRADLE_TIMEOUT_MS` | `1200000` (20 min) | Délai maximum d'une compilation |

## Journaux

Chaque essai écrit `ci/logs/build-attempt-N.log` et, en cas d'échec, `analysis-attempt-N.json`. `build-summary.json` résume le run (succès, nombre d'essais, minification désactivée ou non, relance réseau).

## Lancer en local

```bash
# Prérequis : JDK 17, Android SDK (ANDROID_HOME), Node.js 22, projet Android généré (npx expo prebuild)
BUILD_TYPE=debug node ci/retryBuild.js
```

## Réparer un build qui échoue

Le build n'utilise pas d'IA. Pour faire corriger une erreur avec l'IA, utilise l'application : **Git-Push → onglet Agent IA → bouton 🔧** (auto-correction du build, avec ta propre clé).
