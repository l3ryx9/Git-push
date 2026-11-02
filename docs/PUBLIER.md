🇬🇧 [English](PUBLISHING.md) · 🇫🇷 Français

# Publier ce dépôt en public sur GitHub

Guide pas à pas, faisable **entièrement depuis un téléphone**. Compte 15 à 20 minutes.

> ⚠️ **Rendre un dépôt public rend aussi PUBLIC tout son historique** : chaque ancien commit, même supprimé depuis, reste lisible. Fais l'étape 1 avant tout le reste.

---

## 1. Vérifier qu'aucun secret n'est dans le dépôt

**À chercher** (dans les fichiers *et* dans l'historique des commits) : tokens GitHub (`ghp_…`, `github_pat_…`), clés API (`AIza…`, `sk-…`), mots de passe, fichiers `.env`, keystores Android (`*.jks`, `*.keystore`, `release.keystore`), fichiers `.pem` / `.p12` / `.key`.

Dans Git-Push : ouvre le dépôt → **Historique** → parcours les commits, ou utilise **Agent IA** en mode *Discussion* : « Cherche dans le dépôt des clés API, tokens ou mots de passe en dur. » (⚠️ l'IA lit alors tes fichiers : fais-le avec un fournisseur de confiance).

- Ce dépôt a été vérifié : **aucune clé ni aucun token en dur** dans le code actuel. Le *Client ID* OAuth (`constants/oauth.ts`) n'est pas secret.
- Le `.gitignore` exclut déjà `.env`, `*.jks`, `*.p12`, `*.key`, `*.pem`, `android/` et `ios/`.

**Si tu trouves un secret déjà commité** : considère-le comme compromis.
1. **Révoque-le immédiatement** (GitHub → Settings → Developer settings → Tokens ; console du fournisseur pour les clés API) et crée-en un nouveau.
2. Supprime-le des fichiers, puis, idéalement, **repars d'un historique propre** : crée un nouveau dépôt avec les fichiers actuels (bouton ＋ de Git-Push) au lieu de rendre public l'ancien.

## 2. Choisir et ajouter une licence

Sans licence, le code est visible mais **personne n'a le droit de le réutiliser**. Choix courants :

| Licence | En bref |
|---|---|
| **MIT** | Très permissive : on peut tout faire, en gardant ton nom. |
| **Apache-2.0** | Comme MIT, avec une protection explicite sur les brevets. |
| **GPL-3.0** | Les modifications redistribuées doivent rester libres et sous GPL. |

Le plus simple : sur GitHub (navigateur) → **Add file → Create new file** → nomme-le `LICENSE` → un bouton **Choose a license template** apparaît → choisis, renseigne ton nom et l'année, **Commit**. Mets ensuite à jour la section *Licence* du `README.md`.

## 3. Adapter les informations personnelles

- **`app.json`** : les champs liés au compte Expo (`owner`, `extra.eas.projectId`, `updates.url`) ont déjà été retirés : le fichier ne pointe plus vers ton compte. Si tu utilises plus tard EAS Build ou les mises à jour OTA, lance `npx eas init` pour les rajouter.
- **Identifiant de l'app** (`com.gitpush.app`) : garde-le si c'est ton identifiant ; quelqu'un qui fait un fork devra en choisir un autre pour publier sa propre version.
- **Nom affiché** : l'app s'appelle **Git-Push** partout (`name` dans `app.json`, interface, `README.md`, nom de l'APK dans `.github/workflows/build-apk.yml`). Si tu la renommes encore, change ces quatre endroits ensemble.
- **`README.md`** : ajoute des **captures d'écran** (dossier `docs/img/`) et, si tu veux, des badges de build.

## 4. Mettre à jour le dépôt avec tes dernières modifications

Dans Git-Push : onglet **Dépôts** → ton dépôt → **Synchroniser** (ou *Commit* puis *Push*). Vérifie sur github.com que `README.md`, `docs/` et `LICENSE` sont bien présents.

## 5. Passer le dépôt en public

1. github.com → ton dépôt → **Settings** (navigateur, mode « Version pour ordinateur » si besoin).
2. En bas : **Danger Zone → Change repository visibility → Make public**.
3. Confirme en tapant le nom du dépôt.

*(Un nouveau dépôt créé depuis Git-Push est privé par défaut : désactive « Dépôt privé » à la création pour le faire public d'emblée.)*

## 6. Configurer le dépôt public

- **Description et sujets** : roue ⚙️ à droite de « About » → description courte, site, **Topics** (`expo`, `react-native`, `git`, `android`, `ai-agent`, `github-actions`).
- **Actions** : onglet **Actions** → active les workflows si GitHub le propose. Les minutes de build sont **gratuites sur un dépôt public**.
- **Premier APK** : **Actions → Publier une release → Run workflow** → saisis `v1.0.0` → l'APK, les notes de version générées et un fichier SHA-256 apparaissent dans **Releases**, prêts à être téléchargés par tout le monde. (Ou coche `publish` dans *Build APK Android* pour un build de test rapide, sans numéro de version.)
- **Secrets du build** (Settings → Secrets and variables → Actions) : `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. **Ne les mets jamais dans le code** ; les secrets ne sont pas exposés aux pull requests venant de forks.
- **Signature** : sans keystore, l'APK est signé avec une clé de debug (installable, non publiable sur le Play Store). Pour des mises à jour continues, garde **toujours le même keystore** et sauvegarde-le hors du dépôt.

## 7. Protéger le dépôt

Settings →
- **Code security** : active **Secret scanning** et **Push protection** (gratuits en public) : GitHub bloquera un push contenant une clé connue.
- **Branches** → *Add branch protection rule* sur `main` : exige une pull request avant fusion si tu acceptes des contributions.
- **General → Features** : active **Issues** (et **Discussions** si tu veux une communauté).
- Ajoute un fichier **`SECURITY.md`** pour indiquer comment signaler une faille.

## 8. Annoncer

- Épingle une **Release** avec des notes de version (nouveautés, APK, prérequis Android).
- Partage le lien du dépôt et du dernier APK.
- Pour que d'autres puissent compiler leur propre version : ils font un **fork** puis **Actions → Run workflow** (voir [`BUILD_APK.md`](BUILD_APK.md)).

---

## Checklist finale

- [ ] Aucun secret dans les fichiers **ni** dans l'historique
- [ ] `LICENSE` ajouté, section *Licence* du README à jour
- [ ] Captures d'écran dans le README
- [ ] Dépôt synchronisé, vérifié sur github.com
- [ ] Visibilité passée en **Public**
- [ ] Description, topics, Issues activées
- [ ] Secret scanning + Push protection activés
- [ ] Premier APK publié dans **Releases**
