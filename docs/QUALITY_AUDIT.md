# Audit technique — Git-Push

Date de la passe : 2026-11-12

## État du projet

Le dépôt contenait déjà une application Expo / React Native assez complète, et non un squelette :
moteur Git local basé sur `isomorphic-git`, dépôts multiples, branches, remotes, commits,
diffs et résolution de conflits, synchronisation planifiée et reprise réseau, module Android natif,
agent IA multi-fournisseur avec prévisualisation des modifications, maintenance, workflows CI
et documentation bilingue.

## Changements réalisés dans cette passe

1. **Moteur Git** — `pullRemote` utilise désormais le fetch ciblé sur la branche active, avec
   fallback vers le fetch complet pour les serveurs ou configurations incompatibles.
2. **Performances stockage** — mesure de l'espace disque en parallèle limité à deux dépôts ;
   parcours interne limité à quatre dossiers simultanés.
3. **Explorateur** — métadonnées de fichiers lues avec une concurrence maximale de douze.
4. **Dépendances** — suppression de la déclaration Expo dupliquée dans `devDependencies` ;
   la dépendance runtime Expo SDK 54 est conservée.
5. **TypeScript** — suppression d'une référence de projet vers `../../lib/api-client-react`,
   absente de l'archive et non nécessaire à ce projet autonome.
6. **CI** — `npm test` est maintenant bloquant.
7. **Sécurité et maintenance** — ajout d'une politique de signalement dans `SECURITY.md` et
   consignation des changements dans `CHANGELOG.md`.

## Vérifications effectuées

- `node --experimental-strip-types --test tests/*.test.mjs` : **23 tests réussis, 0 échec**.
- Contrôle manuel des déclarations de dépendances, du flux de fetch/pull et des limites de
  concurrence du stockage.
- Aucune compilation Android n'a été lancée dans cet environnement.

## À valider avant publication

- `npm install` puis `npm run typecheck` dans un environnement Node 22.6+.
- Build Android réel avec JDK 17 et Android SDK, puis test sur appareil physique.
- Essais de synchronisation avec GitHub, GitLab et un serveur Gitea/Forgejo réel.
- Essais de conflits, reprise hors ligne, tâche de fond, tuile Android, widget et service
  d'accessibilité sur plusieurs versions Android.
- Vérification de la politique de confidentialité et des conditions de chaque fournisseur IA.
- Revue des permissions Android et test de restauration / migration sur une installation existante.

## Limites assumées

Les identifiants Git/IA, les comptes externes, les serveurs distants et le comportement du système
Android ne peuvent pas être certifiés par les seuls tests unitaires. Aucun résultat de build ou
de test sur appareil n'est revendiqué dans ce rapport.


## Phase 2 — Historique des commits (12 novembre 2026)

- Ajout d'un champ de recherche local dans l'écran d'historique : message, nom/e-mail de l'auteur et SHA complet.
- Ajout d'un compteur qui précise le nombre de commits chargés et le nombre de résultats filtrés.
- Amélioration de la lisibilité des entrées : repère vertical, SHA mis en évidence et badge pour les commits de merge.
- Ajout de libellés d'accessibilité pour la recherche, l'effacement et l'ouverture d'un commit.
- Protection contre les déclenchements simultanés de pagination lorsque la liste atteint sa fin.

Limite connue : la recherche porte uniquement sur les commits déjà chargés en mémoire (40 au départ). Elle ne lance pas une recherche exhaustive sur tout l'historique du dépôt. Le graphe affiché est un repère visuel linéaire et non une représentation complète des branches/parents Git.

## Complément — Phase 3

- La liste des dépôts est filtrable par nom, URL et branche courante.
- La liste des branches locales/distantes dispose d'une recherche.
- Un écran compare deux branches locales au niveau des arbres de fichiers et ouvre le diff d'un fichier à partir des deux commits de tête.
- Limite volontaire : la comparaison affiche les différences de fichiers entre les deux pointes de branches, pas un calcul de merge-base ni un graphe d'historique complet. Les branches distantes doivent d'abord être suivies localement pour être comparées dans cet écran.
- Tests automatisés : 23/23 réussis. Typecheck et build Android non vérifiés faute de `node_modules` / SDK dans l'environnement.


## Phase 5 — Ergonomie du parcours quotidien

- Résumé de l'état du dépôt ajouté au-dessus des actions.
- Actions de synchronisation secondaires masquées par défaut sous « Autres options ».
- Parcours de commit expliqué en trois étapes.
- Action d'annulation des changements exposée par un bouton accessible au lieu d'un appui long caché.
- Libellés localisés en français et anglais.
- À valider sur appareil : tailles tactiles, lecteur d'écran, compilation TypeScript et build Android.


## Phase 6 — Harmonisation visuelle

- Contraste du texte secondaire et des bordures renforcé.
- Surfaces des cartes rendues plus opaques pour améliorer la lecture au-dessus du fond.
- Fond décoratif assombri par une couche de contraste.
- Barre d'onglets, tuiles de l'accueil et cartes de dépôts ajustées pour une meilleure lisibilité et des zones tactiles plus confortables.
- Le mode clair reste hors périmètre : le hook `useColors` retourne actuellement un thème sombre fixe.
- À valider sur appareils réels : rendu iOS/Android, petits écrans, tailles de police système et navigation avec lecteur d'écran.


## Phase 7 — Aide et accompagnement

- Ajout de `HelpTip`, panneau contextuel repliable et accessible.
- Conseils ajoutés à l'écran dépôt, à l'écran branches et à l'écran conflits.
- Les erreurs courantes (modifications locales, fusion en cours, branche absente, push refusé, authentification, réseau, certificat) proposent une action suivante.
- Textes disponibles en français et en anglais.
- Les actions destructives conservent leurs confirmations explicites.
- À valider : parcours réel sur appareil, compréhension utilisateur et compilation TypeScript/Android.

## Phase 8 — Régression du moteur de diff et de fusion (12 novembre 2026)

### Couverture ajoutée

- `splitLines` : conservation des fins LF/CRLF et des fichiers sans saut de ligne final.
- `diffOps` et `unifiedDiff` : insertions, suppressions, lignes inchangées, compteurs et hunks.
- `merge3` : modifications indépendantes fusionnées, modifications concurrentes marquées en conflit, modifications identiques, cas triviaux et préservation des fins CRLF.
- `isBinary` : présence d'octet nul et limite d'inspection des 8 000 premiers octets.
- `hasConflictMarkers` : reconnaissance des marqueurs Git de conflit.

### Résultat

- `node --experimental-strip-types --test tests/*.test.mjs` : **32 tests réussis, 0 échec**.
- L'exécution a d'abord révélé un défaut dans le test de limite binaire (le tableau de test était initialisé avec des octets nuls) ; le jeu de données du test a été corrigé et la suite complète repasse.
- Archive vérifiée après création.

### Non vérifié dans cet environnement

- Tests d'intégration `createRepository` / commit / push / pull avec un dépôt temporaire et un serveur Git distant : non exécutés ; le moteur utilise l'adaptateur de fichiers Expo/React Native et des dépendances natives.
- `npm run typecheck` : non exécuté, les dépendances (`node_modules`) ne sont pas installées.
- Build APK et essai sur appareil : non exécutés ; aucun Android SDK/ADB n'est disponible dans cet environnement. La présence de Java seule ne suffit pas.

### Validation avant diffusion

Installer les dépendances sur Node 22.6+, lancer `npm test` et `npm run typecheck`, puis exécuter le workflow GitHub Actions de build APK. Tester ensuite sur un appareil Android : création d'un dépôt local, ajout/modification/suppression de fichiers, commit, push, pull, mode hors ligne, reprise réseau et résolution d'un conflit réel.


## Passe visuelle — Phase 11

- Ajout d'un système d'illustrations vectorielles dédiées aux écrans, réutilisé dans `ScreenHeader`.
- Les pages Git principales, les écrans de compte/synchronisation, les écrans Forge et les réglages disposent maintenant d'un visuel contextuel.
- Les onglets Dépôts, Fichiers et Paramètres ont un titre illustré ; Accueil et IA conservent leurs identités propres.
- Les illustrations sont purement décoratives, locales et sans dépendance supplémentaire.
- Tests automatisés : 42 réussis, 0 échec. TypeScript/build Android non validés dans cet environnement (dépendances Expo absentes).

## Phase 12 — Mouvement et accessibilité

- En-têtes : fondu et translation verticale très courte à l'affichage, pilotés nativement.
- Mouvement désactivé si la préférence système de réduction des animations est active.
- Aucun minuteur JavaScript ni animation continue supplémentaire ; pas de dépendance ajoutée.
- Les interactions pressées et les squelettes conservent leurs animations existantes.

## Phase 13 — Navigation et feedback

- Navigation : glissement horizontal pour la consultation, transition « fade_from_bottom » sur Cloner / Nouveau dépôt / Synchroniser, transitions d'onglets « shift » et fondu sur la connexion.
- Feedback : les opérations Git auparavant silencieuses affichent désormais un toast de réussite après confirmation réelle de l'opération.
- Les erreurs continuent d'afficher leur diagnostic ; les fusions conservent leur résultat détaillé et la détection des conflits.
- Le ToastHost global est monté au niveau racine, ce qui permet d'afficher le retour même lorsque l'opération change de route.

## Phase 14 — Tableau de bord Git

- Nouvel écran `app/repo/[id]/graph.tsx`, accessible depuis le bouton Git de l'en-tête du dépôt.
- Les données proviennent du moteur Git local : branches, refs distantes, `aheadBehind` et journal de HEAD.
- Le graphe charge jusqu'à 80 commits par référence locale/distante et affiche jusqu'à 80 commits dédupliqués ; les commits de fusion sont repérés par leurs parents multiples.
- Les branches locales ouvrent leur propre historique ; les commits ouvrent leur écran de détail.
- Les statistiques de divergence reflètent le résultat du calcul `aheadBehind` existant (limité à 150 commits par côté dans le moteur).
- Les tests automatisés passent ; le typecheck global n'est pas validable dans cet environnement sans les dépendances Expo/React Native installées.

## Phase 15 — Graphe Git animé

- `utils/git/graphPure.ts` construit un DAG visuel depuis les historiques des branches locales et des références distantes.
- Les commits sont dédupliqués par OID ; l'ordre topologique garde les parents après les enfants connus même si les horodatages d'auteur sont incohérents.
- Chaque commit conserve ses OID parents, ses voies, ses refs de tête et son indicateur de fusion.
- `components/GitCommitGraph.tsx` dessine les liens entre les vrais commits parents, avec des voies colorées, des marqueurs de fusion et les étiquettes de branches.
- Les liens se révèlent progressivement et les nœuds apparaissent avec un ressort natif ; le réglage Réduire les animations désactive ces mouvements.
- Chaque commit reste accessible au toucher et ouvre son écran de détail.
- Tests purs du graphe : déduplication/refs, ordre topologique, fusion multi-parents et limite de profondeur.

## Phase 16 — Progression Push Matrix

- `engine.pushRemote` relaie le callback `ctx.onProgress` vers `git.push` d'isomorphic-git.
- L'écran du dépôt affiche `MatrixPushProgress` pendant l'opération Push.
- Le pourcentage est calculé uniquement à partir des valeurs `loaded` et `total` fournies par Git ; avant disponibilité du total, une animation indéterminée est affichée.
- L'interface affiche la phase de transfert et les objets traités, avec une animation néon Matrix indépendante du calcul de progression.

## Phase 17 — Corrections de sécurité et de fiabilité (12 novembre 2026)

### Corrections apportées

1. **Serveur statique — origine de la page d'accueil** : le serveur n'utilise plus `X-Forwarded-Host` fourni par le client. L'en-tête `Host` est validé et canonicalisé par `URL`; le protocole transféré est limité à `http` / `https`. Le nom de l'application est échappé avant insertion dans le HTML.
2. **Serveur statique — fichiers servis** : résolution des chemins après décodage URI, refus des traversées hors racine, contrôle du chemin réel pour bloquer les liens symboliques sortant de `static-build`, refus des méthodes autres que GET/HEAD, streaming des fichiers au lieu de les charger intégralement en mémoire et ajout d'en-têtes de sécurité.
3. **Serveur HTTP** : les URL malformées et les ports invalides sont rejetés proprement ; le préfixe `BASE_PATH` est reconnu uniquement sur une frontière de segment.
4. **CI — dépendances catalog** : `ci/prepare.js` échoue désormais si une entrée `catalog:` n'a pas de version approuvée ; il ne remplace plus silencieusement une dépendance inconnue par `latest`.
5. **CI — signature Android** : une release publiée exige un keystore et les trois secrets de signature. Une configuration incomplète fait échouer le pipeline au lieu de publier un APK release signé avec la clé de debug.
6. **CI — permissions** : les jobs de compilation et de validation utilisent `contents: read`; seul le job de publication reçoit `contents: write`. Le job de validation de version du workflow de release est également en lecture seule.
7. **CI — qualité** : `npm run typecheck` est ajouté au pipeline, après les tests unitaires et avant le build Android.
8. **Tests** : ajout de tests sur l'origine HTTP, l'échappement HTML, les chemins encodés, le refus des catalogues inconnus et les secrets de signature incomplets.

### Résultats vérifiés dans cet environnement

- `node --experimental-strip-types --test tests/*.test.mjs` : **52 tests réussis, 0 échec**.
- Syntaxe Node vérifiée sur le serveur et les scripts CI modifiés.
- Les deux workflows GitHub Actions sont syntaxiquement lisibles en YAML.
- Les contrôles de chemins, de Host, de méthodes HTTP, de liens symboliques et de signature sont couverts par des tests automatisés.

### Points qui restent à valider avant publication

- **TypeScript et build APK** : non exécutés localement, car `node_modules`, Android SDK et ADB ne sont pas présents dans cet environnement. Le typecheck est maintenant bloquant dans le workflow GitHub Actions.
- **Dépendances** : aucun `package-lock.json` n'est fourni dans l'archive ; une installation propre et un audit npm des dépendances transitives restent nécessaires avant publication.
- **Git distant** : tests d'intégration push/pull/fetch et callback de progression avec GitHub, GitLab et Gitea/Forgejo non exécutés ici.
- **Android réel** : permissions, accessibilité, tuile, widget, sauvegarde/restauration, migration et tâche de fond à tester sur appareil.
- **Secrets de publication** : le nouveau garde-fou a été testé avec des secrets manquants ; une release signée doit être vérifiée avec le vrai keystore du mainteneur dans GitHub Actions.

Aucune vulnérabilité CVE n'est déclarée corrigée : le rapport initial ne fournissait pas d'identifiant CVE ni de constat d'audit externe reproductible. Cette passe corrige des risques identifiés lors de la revue du code et documente les validations qui nécessitent un environnement réel.
