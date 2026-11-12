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
