# Audit technique et sécurité — Git-Push 1.1.0

Date : 12 novembre 2026
Archive auditée : `Git-push-main` (189 fichiers, 95 fichiers TypeScript/TSX, module natif Kotlin, 2 workflows GitHub Actions)
Statut : **rapport initial mis à jour après la passe de corrections P0** (voir section I).

---

## Méthode et limites (à lire en premier)

Lecture intégrale des fichiers critiques : `utils/secrets.ts`, `utils/secretsMigration.ts`, `utils/accounts.ts`, `utils/oauth.ts`, `utils/git/http.ts`, `utils/git/fs.ts`, `utils/git/engine.ts`, `utils/git/store.ts`, `utils/git/sync.ts`, `utils/git/background.ts`, `utils/errorLog.ts`, `utils/native.ts`, `app/sync.tsx`, `app/oauth-callback.tsx`, les 6 fichiers Kotlin, le manifeste natif, la config d'accessibilité, `app.json`, `eas.json`, `package.json`, `.npmrc`, `.gitignore`, `tsconfig.json`, les 2 workflows, `ci/sign-android.js`, `ci/prepare.js` (début), `SECURITY.md`, `docs/QUALITY_AUDIT.md`, `CHANGELOG.md`.

Lecture ciblée (fonctions sensibles, recherche par motifs sur tout le code) : `utils/ai/agent.ts`, `utils/ai/pure.ts`, `utils/ai/providers.ts`, `utils/batchPush.ts`, `context/GitHubContext.tsx`, `context/ReposContext.tsx`, `app/(tabs)/files.tsx`, `app/repo/[id]/{index,files,editor,conflicts,branches,remotes}.tsx`, `app/clone.tsx`, `utils/diagnostics.ts`, `app/maintenance.tsx`.

Non lus en détail : composants purement visuels (`Illustration.tsx`, `HomeUi.tsx`, `MatrixPushProgress.tsx`…), fichiers de traduction, `server/serve.js` (déjà durci en phase 17, seulement survolé), `scripts/build.js`, `ci/retryBuild.js`, `ci/analyzeLogs.js`. Ces fichiers restent à couvrir dans la passe suivante ; aucun constat n'est formulé sur eux.

Environnement : Node 22.23, pas de `node_modules`, **aucun accès réseau**, pas d'Android SDK. Conséquences : ni `npm install`, ni `npm audit`, ni typecheck complet, ni build APK, ni test sur appareil. Voir la section H.

Légende de certitude : **Confirmé** = démontré par la lecture du code, chemin d'exécution complet identifié. **Probable** = mécanisme identifié mais dépend du comportement d'une bibliothèque ou du système non vérifiable ici. **Recommandation** = pas un défaut, une amélioration.

---

## A. Résumé exécutif

**État général.** Application Expo SDK 54 / React Native 0.81 réellement fonctionnelle et ambitieuse : moteur Git local (isomorphic-git), multi-forges, agent IA avec validation, module Android natif. Plusieurs bonnes pratiques sont déjà en place : secrets dans SecureStore, `allowBackup: false`, OAuth PKCE avec `state`, Device Flow GitHub, clés IA en en-têtes et vers des hôtes HTTPS fixes, masquage des secrets dans les journaux et dans les messages envoyés aux IA, validation humaine des actions de l'agent par défaut, permissions GitHub Actions minimales, garde-fou de signature.

**Maturité.** Bêta avancée. La logique est riche, mais il n'existe aucun test d'intégration du moteur Git, aucun lockfile, aucun linter, et le typecheck n'a jamais été validé.

**Niveau de sécurité.** Moyen. Quatre défauts de sécurité de gravité haute, tous liés à la circulation des identifiants ou à des déclenchements non authentifiés.

**Principaux risques.**
1. Les identifiants d'un dépôt (y compris le token GitHub principal) peuvent partir vers un autre hôte que celui du dépôt (AUDIT-001).
2. Le rafraîchissement OAuth partagé entre comptes peut remettre le token d'une forge à une autre (AUDIT-002).
3. N'importe quelle application ou page web peut déclencher « tout commiter et tout pousser » via `gitcrush://sync` (AUDIT-003).
4. Deux scénarios de fusion peuvent écraser des fichiers non suivis ou annuler silencieusement des changements distants (AUDIT-012, AUDIT-013).
5. Builds non reproductibles (pas de lockfile) et publication possible d'un APK debug dans les Releases (AUDIT-022, AUDIT-023).

**Avis de publication : NON publiable en l'état.** Les points P0 (section G) doivent être corrigés et validés par un build CI et des tests sur appareil.

---

## B. Vulnérabilités et défauts

### Gravité haute

**AUDIT-001 — Identifiants envoyés à des hôtes non liés au dépôt**
Gravité : Haute · Catégorie : Sécurité · Certitude : Confirmé
Fichiers / fonctions : `utils/git/store.ts` `credsFor` (l. 198-209), `ctxFor` (l. 211-220) ; `utils/git/engine.ts` `remoteOpts` (l. 104-117), `fetchRemote` (l. 277-289), `pushRemote` (l. 321-347) ; `app/repo/[id]/remotes.tsx` l. 57.
Description : les identifiants sont choisis d'après le *conteneur*, jamais d'après l'URL réellement contactée, et sont envoyés de façon préemptive (`Authorization: Basic …` dans `headers`). Trois cas concrets : (a) l'écran Remotes fait `fetchRemote(ctx, r.remote)` sur un second remote (`upstream`, fork…) avec les identifiants de `origin` ; (b) un dépôt en mode d'authentification `github` dont l'URL n'est pas `github.com` reçoit le token GitHub principal ; (c) un compte GitLab/Gitea est envoyé à l'URL du dépôt sans vérifier qu'elle correspond à `baseUrl`.
Reproduction : cloner un dépôt GitHub (auth `github`), ajouter un remote `test` → `https://serveur-controle.example/x.git`, lancer « Fetch » sur ce remote. Le serveur reçoit `Authorization: Basic eC1hY2Nlc3MtdG9rZW46…` contenant le token GitHub.
Impact : vol du token GitHub (scopes `repo`, `workflow`, éventuellement `delete_repo`) ou d'un token de forge.
Correction : lier les identifiants à une liste d'hôtes autorisés (hôte de l'URL du dépôt ; `github.com` pour le mode `github` ; hôte de `baseUrl` pour un compte). Retirer l'en-tête `Authorization` dans la couche HTTP pour tout autre hôte.
Test : test unitaire de la couche HTTP — une requête vers un hôte non autorisé ne porte aucun en-tête `Authorization` ; une requête vers l'hôte autorisé le porte.

**AUDIT-002 — Rafraîchissement OAuth partagé entre comptes**
Gravité : Haute · Catégorie : Sécurité / Fonctionnel · Certitude : Confirmé
Fichier / fonction : `utils/accounts.ts` `accessToken` (l. 150-173).
Description : la variable `refreshing` est unique pour tout le module. Si le compte A est en cours de rafraîchissement, un appel `accessToken(B)` retourne la promesse de A, donc **le token de A**.
Reproduction : deux comptes OAuth (GitLab.com et une instance Gitea) dont les jetons expirent ; « Tout synchroniser » traite deux dépôts à la fois (CHANGELOG 1.1.0) → le second dépôt reçoit le token du premier compte.
Impact : token d'une forge envoyé à une autre forge (fuite), échecs d'authentification aléatoires.
Correction : une promesse de rafraîchissement par identifiant de compte (`Map<string, Promise<string>>`).
Test : deux appels simultanés `accessToken(A)` et `accessToken(B)` avec un `refreshOAuth` simulé retournent chacun le bon token.

**AUDIT-003 — Lien profond `gitcrush://sync` déclenchable par n'importe qui**
Gravité : Haute · Catégorie : Sécurité · Certitude : Confirmé
Fichiers / fonctions : `app/sync.tsx` (l. 36-76) ; `NativePrefs.kt` `SyncLauncher` (l. 60-74).
Description : l'écran exécute immédiatement, sans confirmation, une synchronisation de tous les dépôts (commit de toutes les modifications locales, puis push), dès réception du lien. Le schéma `gitcrush://` est public : n'importe quelle application, page web ou QR code peut l'ouvrir. Le paramètre `reason=tile` est falsifiable.
Reproduction : depuis le navigateur du téléphone, ouvrir `gitcrush://sync?close=1`. Tous les dépôts sont commités et poussés, puis l'app se ferme.
Impact : publication involontaire de travail en cours ou de fichiers non ignorés (voir AUDIT-006), commits parasites, consommation réseau et batterie.
Correction : clé aléatoire par installation, stockée côté natif et ajoutée par la tuile, le widget et le service d'accessibilité ; sans clé valide, l'écran affiche la liste des dépôts et attend une confirmation explicite. Tasker/MacroDroid reste possible en copiant la clé depuis les réglages.
Test : test pur de la fonction de décision (clé absente ou fausse → confirmation requise ; clé valide → exécution).

**AUDIT-012 — Fichiers non suivis écrasés puis supprimés lors d'une fusion manuelle**
Gravité : Haute · Catégorie : Perte de données · Certitude : Confirmé
Fichiers / fonctions : `utils/git/engine.ts` `ensureClean` (l. 258-261), `materializeMerge` (l. 415-427), `abortMerge` (l. 544-561).
Description : `ensureClean` ignore volontairement les fichiers non suivis. Quand isomorphic-git signale un conflit, `materializeMerge` écrit la version distante de chaque fichier « ajouté côté distant » sans vérifier qu'un fichier non suivi du même nom existe. `abortMerge` supprime ensuite ces fichiers (absents de « notre » commit).
Reproduction : localement, créer `notes.txt` sans le commiter. À distance, ajouter un `notes.txt` différent et modifier aussi un fichier déjà modifié localement et commité (pour provoquer un conflit). Lancer « Pull » : `notes.txt` local est remplacé. « Abandonner la fusion » : `notes.txt` disparaît.
Impact : perte définitive de fichiers jamais commités.
Correction : avant toute fusion, comparer les fichiers non suivis aux fichiers de la branche fusionnée ; si un fichier serait écrasé, refuser avec `DirtyWorktree` et la liste des fichiers.
Test : test pur de la fonction de détection (non suivis × fichiers distants → liste des fichiers en danger).

**AUDIT-013 — Fusion validée mais copie de travail non mise à jour (annulation silencieuse)**
Gravité : Haute · Catégorie : Perte de données · Certitude : Probable
Fichier / fonction : `utils/git/engine.ts` `mergeInto` (l. 474-489).
Description : `git.merge` déplace la référence de branche, puis `git.checkout` met à jour la copie de travail. Si ce checkout échoue (conflit avec un fichier non suivi, erreur d'E/S, application tuée), la branche pointe déjà vers le commit fusionné alors que les fichiers sont ceux d'avant. Le statut affiche l'inverse des changements distants, et la synchronisation suivante (qui commite tout) les annule et pousse cette annulation.
Reproduction (à confirmer sur appareil) : même scénario qu'AUDIT-012 sans conflit dans les fichiers suivis.
Impact : régression poussée sur le serveur, perçue comme « mes collègues ont perdu leur travail ».
Correction : contrôle préalable d'AUDIT-012 ; et en cas d'échec du checkout, remettre la branche sur `oursOid` avant de relancer l'erreur.
Test : test d'intégration avec dépôt temporaire (nécessite un adaptateur fs Node), à ajouter au plan de tests.

**AUDIT-022 — Builds non reproductibles et chaîne de dépendances non verrouillée**
Gravité : Haute · Catégorie : Sécurité CI / Fiabilité · Certitude : Confirmé
Fichiers : absence de `package-lock.json` ; `.npmrc` (`legacy-peer-deps=true`) ; `package.json` (plages `^`) ; `build-apk.yml` l. 109-111 (`npm install`).
Description : chaque build résout de nouvelles versions transitives. Un paquet compromis publié entre deux builds est intégré et signé avec la clé de production sans revue. `legacy-peer-deps` masque les incompatibilités de pairs.
Impact : APK signé contenant du code non revu ; builds qui cassent sans changement de code.
Correction : générer et versionner `package-lock.json` (dans un run CI dédié, puisque tu travailles depuis le téléphone), passer à `npm ci`, ajouter `npm audit --omit=dev --audit-level=high` comme étape.
Test : le workflow échoue si le lockfile manque ou n'est pas synchronisé avec `package.json`.

### Gravité moyenne

**AUDIT-004 — Mode « SSL non vérifié » : confiance totale et redirections authentifiées**
Certitude : Confirmé · `Http.kt` `request` (l. 44-57).
Le gestionnaire de confiance accepte tout certificat et la vérification du nom d'hôte est désactivée : n'importe quel Wi-Fi peut intercepter le token. De plus, `instanceFollowRedirects = true` réémet l'en-tête `Authorization` vers la cible de redirection. Option volontaire et signalée, mais trop large.
Correction : épinglage de l'empreinte SHA-256 du certificat au premier usage (TOFU), redirections désactivées côté natif et gérées en JS avec retrait de l'en-tête si l'hôte change.
Test : test JS du suivi de redirection (hôte différent → pas d'`Authorization`).

**AUDIT-005 — Repli silencieux du coffre vers AsyncStorage en clair**
Certitude : Confirmé · `utils/secrets.ts` `setSecret` (l. 72-86), `getSecret` (l. 43-70).
Si SecureStore échoue une fois, le secret est écrit en clair dans AsyncStorage ; seul l'écran Maintenance l'indique. Atténué par `allowBackup: false`, mais lisible sur appareil rooté ou par sauvegarde ADB sur certains constructeurs.
Correction : ne pas stocker en clair sur Android ; garder en mémoire pour la session et afficher une alerte bloquante.

**AUDIT-006 — La synchronisation commite tous les fichiers, y compris les secrets non ignorés**
Certitude : Confirmé · `engine.ts` `syncRepo` (l. 577-589) ; `agent.ts` `git_commit` (l. 619-638).
Tous les fichiers non suivis sont indexés puis poussés (y compris en arrière-plan et via AUDIT-003). Un `.env` ou `id_rsa` absent du `.gitignore` est publié. La fonction `isSensitivePath` existe déjà pour l'IA mais n'est pas utilisée ici.
Correction : exclure les chemins sensibles de l'indexation automatique et les signaler dans le résumé de synchronisation.
Test : test pur du filtre.

**AUDIT-009 — L'agent peut supprimer tout le dépôt avec le chemin « . »**
Certitude : Confirmé · `agent.ts` `cleanPath` (l. 96-100), `guardWrite` (l. 102-104), `delete_file` (l. 587-601), `move_file` (l. 602-618).
`cleanPath(".")` renvoie `.`, `guardWrite(".")` l'accepte, puis `removePath(dir + "/.")` supprime le dossier entier, `.git` compris. Validation humaine requise par défaut, mais l'aperçu affiche seulement « delete . », et l'option d'auto-approbation existe. Un fichier du dépôt contenant une injection de prompt peut demander cette action.
Correction : refuser tout segment `.` ou `..`, et tout chemin vide après nettoyage.
Test : test pur de `cleanPath`.

**AUDIT-014 — Mises à jour perdues dans la liste des dépôts (dont l'état de fusion)**
Certitude : Confirmé · `store.ts` `updateContainer` (l. 135-138), `persist` (l. 105-124) ; `sync.ts` `runBackgroundSyncs` (l. 150-166).
Deux `updateContainer` concurrents partent du même tableau : le second écrase le premier. Exemple : la synchro planifiée écrit `lastSync` pendant que l'écran Conflits écrit `merge.resolved`. `loadContainers(true)` en arrière-plan peut aussi remplacer la mémoire par une version stockée plus ancienne. Enfin `persist` avale les erreurs : l'appelant croit l'écriture réussie.
Correction : appliquer le patch à l'intérieur de la file d'écriture, sur la valeur courante ; propager les erreurs.
Test : test pur de deux mises à jour concurrentes (les deux champs sont conservés).

**AUDIT-015 — Adaptateur de fichiers : erreurs masquées et écritures non atomiques**
Certitude : Probable · `utils/git/fs.ts` `readFile` (l. 79-94), `writeFile` (l. 96-103).
Toute erreur de lecture (mémoire, E/S) devient `ENOENT`. Si l'index `.git/index` est lu comme absent, isomorphic-git repart d'un index vide : un commit peut alors produire un arbre vide (suppression de tous les fichiers). Les écritures d'index et de références ne passent pas par un fichier temporaire + renommage.
Correction : ne convertir en `ENOENT` que si le fichier n'existe réellement pas ; écriture atomique (temporaire + `moveAsync`) pour `.git/index` et les refs.
Test : test d'intégration à prévoir.

**AUDIT-019 — La synchronisation planifiée est réarmée à chaque lancement**
Certitude : Probable · `utils/git/background.ts` (l. 31, 56-60).
`registeredMinutes` vaut `null` à chaque démarrage : la tâche est désinscrite puis réinscrite, ce qui remet le compte à rebours à zéro. Un utilisateur qui ouvre l'app plus souvent que l'intervalle choisi n'a jamais de synchro planifiée. C'est le défaut que le CHANGELOG 1.1.0 annonce corrigé : il ne l'est que pendant une même session.
Correction : mémoriser l'intervalle enregistré dans AsyncStorage.
Test : test pur de la décision « réinscrire ou non ».

**AUDIT-020 — Serveurs `http://` locaux bloqués dans l'APK release**
Certitude : Probable · `app.json`, absence de configuration réseau.
Le code autorise volontairement `http://` vers le réseau local (`isPrivateHost`), mais Android bloque le trafic en clair par défaut pour les builds release (Expo ne l'autorise qu'en debug). La fonction annoncée échouera avec « Cleartext HTTP traffic not permitted ».
Correction : décision produit nécessaire (autoriser le clair via `expo-build-properties`, ou retirer la fonction et l'indiquer clairement).

**AUDIT-023 — Publication possible d'un APK debug, sans vérification du certificat**
Certitude : Confirmé · `build-apk.yml` (l. 161-185 et job `publish` l. 258-294).
En lancement manuel avec `build_type: debug` et `publish: true`, un APK débogable signé avec la clé debug est publié dans les Releases (le garde-fou ne vérifie que la présence du keystore). Aucune étape `apksigner verify --print-certs` ne compare le certificat de l'APK publié à l'empreinte attendue.
Correction : refuser `publish` si `build_type != release` ; vérifier l'empreinte SHA-256 du certificat avec un secret ou une variable `ANDROID_CERT_SHA256`.

**AUDIT-024 — Actions tierces non épinglées**
Certitude : Confirmé · deux workflows.
`softprops/action-gh-release@v2` s'exécute avec `contents: write` sur une étiquette mobile. Les versions `actions/upload-artifact@v7`, `download-artifact@v7` et `gradle/actions/setup-gradle@v6` n'ont pas pu être vérifiées sans réseau.
Correction : épingler chaque action par SHA de commit complet.

**AUDIT-029 — Mémoire : réponses réseau et imports entièrement en mémoire**
Certitude : Confirmé · `http.ts` `collect` / `request` (l. 14-87) ; `app/(tabs)/files.tsx` `handlePush` (l. 176-215).
Chaque réponse Git (packfile complet) est chargée en mémoire, puis copiée ; en mode SSL non vérifié elle transite en base64 (×1,33, plusieurs copies). L'import ZIP lit l'archive entière en base64 avant décompression. Risque de crash OOM sur les gros dépôts, malgré `largeHeap`.
Correction : clone peu profond par défaut au-delà d'une taille, avertissement au-delà de 50 Mo pour les ZIP, refus explicite au-delà d'un plafond.

### Gravité faible

| ID | Certitude | Fichier / fonction | Constat | Correction |
|---|---|---|---|---|
| AUDIT-007 | Confirmé | `store.ts` `isPrivateHost` (l. 179-187) | La plage 100.64.0.0/10 (CGNAT opérateur, mais aussi Tailscale) et les suffixes `.lan`/`.local` autorisent l'envoi d'identifiants en clair. | Opt-in explicite par dépôt pour le clair. |
| AUDIT-008 | Confirmé | `app/repo/[id]/editor.tsx` (l. 63-74), `files.tsx` | Le paramètre de route `path` n'est pas validé : `gitcrush://repo/<id>/editor?path=../../…` lit et peut réécrire (après appui sur Enregistrer) des fichiers du bac à sable de l'app hors du dépôt. Nécessite l'identifiant du dépôt. | Validateur de chemin commun (refus de `.`, `..`). |
| AUDIT-010 | Confirmé | `agent.ts` `read_file`, `search` (l. 230-305) | L'agent peut lire `.git/config` ; une regex fournie par le modèle s'exécute sur le fil JS (blocage possible de l'interface). | Exclure `.git/` des lectures ; limite de temps ou de longueur de regex. |
| AUDIT-011 | Confirmé | `accounts.ts` `normBase` (l. 102-105), `oauth.ts` | Une forge saisie en `http://` reçoit code OAuth et token en clair (ce chemin n'utilise pas `guardTransport`). | Refuser `http://` hors réseau local. |
| AUDIT-016 | Confirmé | `fs.ts` `makeStats` (l. 45-63) | Mode toujours `100644`, liens symboliques stockés en texte : un script exécutable modifié puis synchronisé perd son bit +x. | Préserver le mode de l'index lors de l'ajout. |
| AUDIT-017 | Confirmé | `engine.ts` `aheadBehind` (l. 626-659) | Compteurs « en avance / en retard » faux au-delà de 150 commits, sans indication. | Afficher « 150+ ». |
| AUDIT-018 | Confirmé | `conflicts.tsx` `finish` (l. 63-72) | Commit de fusion puis effacement de l'état non atomiques : si l'app est tuée entre les deux, un second appui crée un deuxième commit de fusion. | Vérifier que HEAD a déjà `theirOid` pour parent. |
| AUDIT-021 | Recommandation | `g.repos.removeBody` | Le message de suppression d'un clone évoque des modifications non poussées sans les compter. | Afficher le nombre de fichiers modifiés et de commits non poussés. |
| AUDIT-025 | Confirmé | `build-apk.yml` | Un push sur `main` produit un artefact nommé « release » signé avec la clé debug. | Renommer l'artefact « unsigned-test ». |
| AUDIT-026 | Confirmé | `release.yml` | Le tag n'est pas comparé à `app.json` (1.1.0). | Étape de comparaison. |
| AUDIT-027 | Confirmé | `.tsbuildinfo` | Fichier de 495 Ko issu d'un typecheck local échoué, présent malgré `.gitignore`. | Le retirer de l'archive et du dépôt. |
| AUDIT-030 | Confirmé | `components/GitUi.tsx` `describeError` (l. 38) | Constat ajouté pendant les corrections : `\\n` dans le gabarit affichait « \n\n » en toutes lettres dans chaque message d'erreur accompagné d'une action conseillée. | Vrais sauts de ligne. |
| AUDIT-028 | Recommandation | manifeste fusionné | Permissions finales non vérifiables sans `expo prebuild`. | Ajouter `android.blockedPermissions` et contrôler le manifeste fusionné en CI. |

---

## C. Bugs techniques reproductibles

AUDIT-002 (token du mauvais compte), AUDIT-009 (suppression du dépôt par « . »), AUDIT-012 (écrasement de non suivis), AUDIT-014 (mises à jour perdues), AUDIT-019 (planification réarmée, probable), AUDIT-018 (double commit de fusion), AUDIT-017 (compteurs plafonnés). Tous sont décrits ci-dessus avec leur correction.

## D. Risques de perte de données

Fichiers non suivis : AUDIT-012 (écrasement et suppression), AUDIT-013 (annulation silencieuse poussée sur le serveur). Dépôt entier : AUDIT-009. Historique : AUDIT-015 (index lu comme absent, hypothèse). Réglages et état de fusion : AUDIT-014. Credentials : AUDIT-001, AUDIT-002, AUDIT-004, AUDIT-005. Publication non voulue : AUDIT-003 + AUDIT-006.

## E. Dépendances

Audit de vulnérabilités (`npm audit`) **non réalisé** : ni réseau ni lockfile. Constats confirmés : aucun lockfile ; `legacy-peer-deps` ; dépendances runtime déclarées en `devDependencies` (`expo-router`, `react-native-reanimated`, `expo-web-browser`… — sans effet sur l'APK final, mais trompeur) ; `@expo/ngrok` et `@expo/cli` épinglé inutiles en CI ; `babel-plugin-react-compiler` en version bêta. Versions Expo 54 / RN 0.81.5 / React 19.1 cohérentes entre elles d'après les plages déclarées, à confirmer par `npx expo install --check` en CI.

## F. Architecture

`context/GitHubContext.tsx` (39 Ko) mélange état d'interface, client API, stratégies de push et suppression de dépôts : à extraire dans `utils/github/`. Deux chemins de push coexistent (API GitHub et moteur Git local) avec des règles de sécurité différentes. Le choix des identifiants est dispersé (`store.ts`, `accounts.ts`, `engine.ts`) : cause directe d'AUDIT-001. 142 occurrences de `any` / `as any`, 25 `eslint-disable`, et aucun linter configuré. Le moteur Git n'a aucun test d'intégration : seules les fonctions pures sont testées.

## G. Plan de correction

**P0 — avant toute publication** : AUDIT-001, 002, 003, 009, 012, 013, 022, 023.
**P1 — avant diffusion publique** : AUDIT-004, 005, 006, 008, 014, 015, 019, 020, 024, 029, plus un linter et des tests d'intégration du moteur Git.
**P2 — amélioration** : AUDIT-007, 010, 011, 016, 017, 018, 021, 025, 026, 027, 028, et la séparation de `GitHubContext`.

## H. Validation — commandes réellement exécutées

| Commande | Résultat |
|---|---|
| `npm test` (`node --experimental-strip-types --test tests/*.test.mjs`) | **52 réussis, 0 échec** |
| `tsc -p tsconfig.json --noEmit` | **Non concluant** : `expo/tsconfig.base` introuvable (pas de `node_modules`). Le `tsc` disponible ici est en 6.0.3, le projet attend ~5.9.2. |
| Transpilation syntaxique des 95 fichiers `.ts`/`.tsx` (API TypeScript) | **0 erreur de syntaxe** (ne remplace pas un typecheck) |
| `npm install`, `npm audit`, lint | **Non réalisables** : pas de réseau ; aucun linter configuré dans le projet |
| Build APK, tests sur appareil, tests Git distants | **Non réalisables** : pas d'Android SDK ni de réseau |

À exécuter dans GitHub Actions après les corrections : `npm ci`, `npm test`, `npm run typecheck`, `npm audit --omit=dev`, build release signé, `apksigner verify --print-certs` sur l'APK publié.

---

## I. Corrections appliquées (passe P0 du 12/11/2026)

| ID | État | Changement | Test de régression |
|---|---|---|---|
| AUDIT-001 | **Corrigé** | `utils/git/securityPure.ts` (`credentialHosts`, `stripForeignAuth`) ; `store.ts` `credHostsFor` / `ctxFor` ; `engine.ts` `httpFor` retire `Authorization` hors des hôtes autorisés ; `http.ts` suit les redirections du mode SSL non vérifié et retire l'authentification si l'hôte change ; `Http.kt` ne suit plus les redirections. | 5 tests (`audit-p0.test.mjs`) |
| AUDIT-002 | **Corrigé** | `accounts.ts` : rafraîchissement unique par identifiant de compte (`createSingleFlight`). | 1 test |
| AUDIT-003 | **Corrigé** (Kotlin non compilé ici) | Clé aléatoire par installation (`NativePrefs.syncKey`), ajoutée par la tuile, le widget et le service d'accessibilité ; `app/sync.tsx` demande une confirmation sans clé valide et ne ferme plus l'app après un lien externe ; URL Tasker avec clé dans les réglages du dépôt. | 2 tests |
| AUDIT-006 | **Corrigé** | `autoStagePaths` dans `syncRepo`, l'outil `git_commit` de l'agent et `ciFix` ; fichiers ignorés affichés dans le résumé de synchro. | 1 test |
| AUDIT-008 | **Corrigé** | `safeRouteRelPath` dans `editor.tsx` et `files.tsx`. | 1 test |
| AUDIT-009 | **Corrigé** | `cleanRelPath` / `isWritableRelPath` dans l'agent. | 1 test |
| AUDIT-010 | **Partiel** | `.git/` illisible par l'IA (lecture et recherche). La limite de temps des regex reste à faire. | — |
| AUDIT-012 | **Corrigé** | `ensureUntrackedSafe` avant toute fusion (code d'erreur `UntrackedOverwrite`, message FR/EN). | 1 test (logique pure) |
| AUDIT-013 | **Corrigé, à valider sur appareil** | `checkoutOrRollback` remet la branche sur son commit d'origine si le checkout échoue. | Test d'intégration Git encore à écrire |
| AUDIT-014 | **Corrigé** | File de modifications sur la valeur courante (`createSerialUpdater`) pour les dépôts et les comptes ; erreurs d'écriture propagées ; relecture forcée après les écritures en cours. | 2 tests |
| AUDIT-019 | **Corrigé** | Intervalle mémorisé dans AsyncStorage (`scheduleAction`). | 1 test |
| AUDIT-022 | **Corrigé côté CI, action requise** | `npm ci` si lockfile ; publication refusée sans lockfile ; workflow `lockfile.yml` ; `npm audit` (avertissement). Le lockfile lui-même doit être généré en lançant ce workflow. | 1 test (contrôle du workflow) |
| AUDIT-023 | **Corrigé** | Refus de publier un build non release ; `apksigner verify --print-certs` ; refus d'un certificat debug ; comparaison avec `vars.ANDROID_CERT_SHA256` si définie. | (même test) |
| AUDIT-027 | **Corrigé** | `.tsbuildinfo` retiré de l'archive. | — |
| AUDIT-030 | **Corrigé** | Sauts de ligne réels dans `describeError`. | 1 test |

**Non corrigés (P1/P2, toujours ouverts)** : AUDIT-004 (épinglage du certificat en mode SSL non vérifié), 005, 007, 011, 015, 016, 017, 018, 020 (décision produit sur le `http://` local), 021, 024 (épinglage des actions par SHA : impossible à faire honnêtement sans réseau pour lire les SHA), 025, 026, 028, 029, plus l'ajout d'un linter et de tests d'intégration du moteur Git.

### Validation de la passe de corrections

| Commande | Résultat |
|---|---|
| `npm test` | **69 réussis, 0 échec** (52 existants + 17 nouveaux) |
| Transpilation syntaxique des 96 fichiers TS/TSX | 0 erreur |
| `tsc --strict` sur `utils/git/securityPure.ts` | OK |
| `tsc --strict` sur les 9 fichiers `.ts` modifiés, modules externes neutralisés | Aucune erreur dans le code modifié ; 8 erreurs restantes dues uniquement à la neutralisation des types externes, dans du code non modifié |
| Lecture YAML des 3 workflows | OK |
| Compilation Kotlin, typecheck complet, build APK, tests sur appareil | **Non réalisés** (pas de SDK, pas de réseau) |

**L'application n'est toujours pas déclarée prête à publier** : il faut un build CI vert (typecheck complet + compilation Kotlin), le lockfile généré, puis les essais sur appareil listés ci-dessous.

Essais sur appareil indispensables : tuile, widget et règle d'accessibilité lancent la synchro sans confirmation ; `gitcrush://sync` ouvert depuis le navigateur demande une confirmation ; clone, pull, push GitHub et un serveur Gitea ; fusion avec un fichier non suivi homonyme (doit être refusée avec la liste) ; synchro avec un `.env` non suivi (doit être signalé et non poussé) ; synchro planifiée qui se déclenche après plusieurs ouvertures de l'app.
