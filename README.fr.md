🇬🇧 [English](README.md) · 🇫🇷 Français

# Git-Push

**Un client Git complet dans ta poche, avec un agent IA qui modifie ton code à ta place.**

Git-Push est une application Android (Expo / React Native) qui clone tes dépôts directement sur le téléphone, te laisse les modifier, les synchroniser et les publier — sans ordinateur. Un agent IA (Gemini, GPT ou Claude, avec ta propre clé) peut lire le projet, modifier les fichiers, créer de nouveaux dépôts, écrire des workflows GitHub Actions et corriger seul un build qui échoue.

> Tout le moteur Git tourne **sur le téléphone** (isomorphic-git). Aucun serveur intermédiaire : l'app parle directement à GitHub, GitLab ou Gitea, et à ton fournisseur d'IA.

---

## Ce que tu peux faire

### Gérer tes dépôts
- **Cloner** un dépôt (complet ou *léger* : dernier état seulement, bien plus rapide et petit), depuis GitHub, GitLab, Gitea / Forgejo ou n'importe quelle URL HTTPS.
- **Valider et envoyer** : statut, indexation, commit, push, pull, fusion avec résolution de conflits, branches, remotes, historique et diffs lisibles.
- **Éditer** les fichiers dans l'app.
- **Envoyer des fichiers ou des ZIP** vers GitHub, et supprimer des dépôts (onglet Fichiers).
- **Issues, pull requests et exécutions** (GitHub Actions / CI GitLab) consultables et créables.

### Synchronisation automatique
- À l'ouverture et/ou à la fermeture de l'app, ou **planifiée** (toutes les 15 min à 24 h, au rythme que choisit Android).
- **Reprise automatique** quand le réseau revient après un échec.
- Android : **tuile des Réglages rapides**, **widget** d'écran d'accueil et synchro au lancement ou à la fermeture d'**autres applications** (par exemple ton application de notes) via un service d'accessibilité **désactivé par défaut** et sans lecture de l'écran — voir [`docs/ACCESSIBILITY_DECLARATION.md`](docs/ACCESSIBILITY_DECLARATION.md).

### L'agent IA (onglet « Agent IA »)
- Choisis un dépôt, décris ce que tu veux : l'agent explore le code, propose les modifications et **te montre chaque diff avant de l'appliquer** (« Tout accepter » pour aller plus vite).
- **Crée un nouveau dépôt** (local et/ou GitHub) et y écrit tous les fichiers d'un projet.
- **Crée des workflows GitHub Actions** prêts à l'emploi (APK Android Kotlin, APK Expo, CI Node) et vérifie leur YAML avant le push.
- **Auto-correction du build** (bouton 🔧) : l'app pousse le code, attend GitHub Actions, envoie les erreurs à l'IA, applique la correction, recommence (3 essais maximum).
- **Annuler** (↩) les modifications de la dernière demande.
- Pensé pour le **quota gratuit de Gemini** : peu d'appels, attente automatique après une erreur de quota, modèle léger pour les tâches simples, compteur d'appels du jour.
- Fonctionne avec **Gemini, GPT (OpenAI) ou Claude** : tu fournis ta clé API.

### Maintenance (onglet Profil → Maintenance)
Espace occupé par chaque dépôt (et nettoyage des restes de clonages interrompus), vérifications en un tap (stockage, coffre sécurisé, Git, réseau), journal des erreurs et rapport à partager.

### Langues
Français, English, Español, 中文, Русский.

---

## Installer l'application

### Option A — Télécharger l'APK (le plus simple)
1. Ouvre l'onglet **Releases** de ce dépôt sur ton téléphone.
2. Télécharge le fichier `Git-Push-release-N.apk` de la dernière version.
3. Ouvre-le et autorise l'installation depuis cette source si Android le demande.

### Option B — Compiler l'APK toi-même sur GitHub (sans ordinateur)
1. Fais un **fork** de ce dépôt (ou utilise ton propre dépôt).
2. Onglet **Actions** → **Build APK Android** → **Run workflow**.
3. Attends 10 à 25 minutes, puis récupère l'APK dans **Releases** ou dans les **Artifacts** du run.

Détails, secrets facultatifs (signature, correction IA du build) : [`docs/BUILD_APK.md`](docs/BUILD_APK.md).

### Option C — Développer en local
Prérequis : Node.js 22, JDK 17, Android SDK.

```bash
npm install
npx expo prebuild --platform android
npx expo run:android     # build de développement sur appareil ou émulateur
npm test                 # tests unitaires (Node 22.6+)
```

> **Expo Go ne suffit pas** : l'app utilise un module natif (`modules/gitcrush-native`), des tâches d'arrière-plan et le coffre sécurisé. Utilise un build de développement.

---

## Première utilisation

1. **Connexion GitHub** : colle un *Personal Access Token* ou utilise la connexion par code (*Device Flow*).
   - Token classique : cases **`repo`** et **`workflow`** (obligatoire pour pousser des fichiers `.github/workflows`). Ajoute **`delete_repo`** seulement si tu veux supprimer des dépôts depuis l'app.
   - Connexion par code : crée une *OAuth App* (GitHub → Settings → Developer settings → OAuth Apps) avec **Enable Device Flow**, puis colle son *Client ID* dans l'app (ou dans `constants/oauth.ts`). Le Client ID n'est pas secret.
2. **Clone un dépôt** (onglet Dépôts → Cloner) ou **crée-en un** (bouton ＋).
3. **Active l'IA** (onglet Profil → Paramètres IA) : choisis un fournisseur et colle ta clé.
   - Gemini gratuit : <https://aistudio.google.com/app/apikey>.
4. Ouvre l'onglet **Agent IA** et demande ce que tu veux.

---

## Confidentialité et sécurité

- Tes **tokens GitHub, clés API IA, mots de passe et jetons de comptes** sont stockés dans le **coffre sécurisé du téléphone** (Android Keystore), jamais en clair. Les anciennes installations sont migrées automatiquement.
- Aucune télémétrie, aucun serveur Git-Push : l'app n'envoie rien à son auteur.
- **Ce qui part vers le fournisseur d'IA** : les fichiers que l'assistant lit et les diffs, uniquement quand tu utilises l'IA. Sur un quota gratuit, le fournisseur peut utiliser ces données pour améliorer ses produits. **N'utilise pas l'IA sur des dépôts contenant des secrets.**
- Le service d'accessibilité (synchro au lancement d'autres apps) est optionnel, désactivé par défaut, et ne lit jamais le contenu de l'écran.

---

## Structure du projet

```
app/            écrans (Expo Router) : onglets, dépôts, forge, maintenance…
components/     composants d'interface (dont AgentChat, l'agent IA)
context/        GitHub, dépôts, langues
utils/git/      moteur Git local (clone, commit, push, fusion, stockage…)
utils/ai/       agent IA, fournisseurs (Gemini/OpenAI/Claude), workflows, auto-correction
modules/        module natif Android (tuile, widget, accessibilité)
ci/             compilation CI avec correction IA (retryBuild.js, fixProject.js…)
.github/        workflow « Build APK Android »
tests/          tests unitaires (npm test)
docs/           guides (build APK, accessibilité, publication)
```

## Contribuer

Les issues et pull requests sont les bienvenues. Avant de proposer une modification : `npm test` doit passer. Pour signaler un bug, joins le **rapport** de onglet Profil → Maintenance (il ne contient ni clé ni token).

## Licence

À définir par l'auteur — voir [`docs/PUBLIER.md`](docs/PUBLIER.md), étape « Licence ». Sans licence, personne d'autre n'a le droit de réutiliser le code.
