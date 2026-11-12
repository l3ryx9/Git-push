# Vérification de sécurité renforcée — 12 novembre 2026

- Nouvelle fenêtre `TypedConfirmHost` (`utils/safeConfirm.ts`, testée) : pour les actions destructrices, il faut recopier une phrase (nom du dépôt, nom complet GitHub, ou mot de sécurité si plusieurs dépôts) et attendre 2 s avant que le bouton rouge ne s'active.
- Appliquée à : vider un dépôt GitHub, supprimer un ou plusieurs dépôts GitHub, supprimer un dépôt local (liste, réglages, maintenance), supprimer une branche distante.
- Si l'hôte de vérification n'est pas monté, l'action est annulée (jamais exécutée sans vérification).

# Correctifs du typecheck CI — 12 novembre 2026

Erreurs signalées par `npm run typecheck` dans GitHub Actions :
- `app/repo/[id]/graph.tsx` : import de `C` manquant (plantage de l'écran Graphe).
- `components/AgentChat.tsx` : le résolveur de validation accepte maintenant « tout accepter » (`boolean | "all"`).
- `components/ForgeUi.tsx` : paramètres de route lus sans générique incompatible avec expo-router, valeurs multiples ramenées à une seule.
- `components/GitCommitGraph.tsx` : `key` retirée de l'objet étalé.
- `utils/git/http.ts` / `engine.ts` : clients HTTP typés `HttpClient` d'isomorphic-git ; corps de réponse fourni en itérateur asynchrone (`utils/git/httpPure.ts`, testé).

# Boutons plus vifs — 12 novembre 2026

- Vert des boutons principaux saturé à 100 % (#00e865, texte foncé à 11,5:1).
- Boutons destructifs : rouge vif plein (#e3121f, texte blanc à 4,8:1), y compris la variante « danger » qui était un simple fond teinté.
- Thème sombre uniquement : le thème clair est écarté.

# Refonte de l'interface — 12 novembre 2026

Rapport : `docs/AUDIT_UI_2026-11-12.md`.

- Design system centralisé (`constants/theme.ts`) : espacements, rayons, 8 rôles typographiques, zones tactiles, durées d'animation.
- Contrastes corrigés : texte sur le vert principal (1,96:1 → 9,6:1), sur le rouge des suppressions (2,8:1 → 4,8:1), icône du bouton IA (2,75:1 → 7:1).
- Plancher de lisibilité à 11 pt sur tous les écrans ; 180 libellés passés en casse de phrase (5 langues).
- Nouvelle feuille d'actions (branches, remotes, fichiers) : toutes les actions visibles d'un coup, plus de sous-menu « Plus… ».
- Cartes allégées (décor répété retiré), un seul vert d'accent, en-tête adapté aux petits écrans.
- Accessibilité : libellé obligatoire sur les boutons icône, rôles « bouton » ajoutés (57), case d'indexation annoncée comme case à cocher, champ avec état d'erreur, « Réduire les animations » suivie en direct.
- Progression Matrix du push harmonisée : accent de l'app, textes traduits, respect des animations réduites, suppression d'un texte décoratif trompeur.
- Corrigé : plantage de l'écran Graphe (`C` utilisé sans import, bug antérieur).
- Tests : `tests/ui-design.test.mjs` (11 tests). Suite complète : 80 réussis, 0 échec.

# Corrections de sécurité — audit du 12 novembre 2026

Rapport complet : `docs/AUDIT_SECURITE_2026-11-12.md`.

## Sécurité
- Identifiants liés à leurs hôtes : le token GitHub ne part plus que vers github.com, un compte de forge vers sa forge, un mot de passe vers l'hôte du dépôt. Un autre remote, une URL modifiée ou une redirection ne reçoivent plus d'en-tête Authorization (AUDIT-001).
- Mode « SSL non vérifié » : les redirections sont suivies côté JavaScript et l'authentification est retirée quand l'hôte change (AUDIT-001 / 004, partiel).
- Rafraîchissement OAuth isolé par compte : un compte ne peut plus recevoir le token d'un autre (AUDIT-002).
- Liens `gitcrush://sync` : sans la clé secrète de l'installation (ajoutée par la tuile, le widget et le service d'accessibilité), une confirmation est demandée. L'URL Tasker des réglages contient la clé (AUDIT-003).
- Synchronisation automatique, agent IA et correction CI : les fichiers sensibles non suivis (.env, clés, keystores…) ne sont plus commités automatiquement et sont signalés (AUDIT-006).
- Agent IA : le chemin « . » ne peut plus supprimer ou déplacer tout le dépôt ; le dossier `.git` n'est plus lisible par l'IA (AUDIT-009, AUDIT-010).
- Éditeur et explorateur : un paramètre de route contenant « .. » est refusé (AUDIT-008).

## Fiabilité et données
- Fusion : refus explicite si des fichiers non suivis seraient écrasés ; si la mise à jour des fichiers échoue après la fusion, la branche revient sur son commit d'origine (AUDIT-012, AUDIT-013).
- Liste des dépôts et des comptes : les modifications simultanées ne s'écrasent plus et les échecs d'écriture sont signalés (AUDIT-014).
- Synchronisation planifiée : l'intervalle est mémorisé, la tâche n'est plus réarmée à chaque ouverture de l'app (AUDIT-019).
- Messages d'erreur : les sauts de ligne s'affichaient sous la forme « \n » littérale (AUDIT-030).

## CI / publication
- `npm ci` quand `package-lock.json` est présent ; publication refusée sans lockfile ; nouveau workflow « Générer le lockfile » (AUDIT-022).
- Publication refusée pour un build non release ; signature de l'APK vérifiée par `apksigner`, refus d'un certificat de debug, comparaison optionnelle avec la variable `ANDROID_CERT_SHA256` (AUDIT-023).
- `npm audit --omit=dev` ajouté (avertissement, non bloquant).

## Tests
- `tests/audit-p0.test.mjs` : 17 tests de régression. Suite complète : 69 réussis, 0 échec.

## Phase 9 — Refonte visuelle et accueil illustré

- Accueil repensé : message de bienvenue, logo illustré de réseau planétaire placé à droite du texte, accès au profil et aux paramètres.
- Section « Mes raccourcis » : 8 grandes cartes illustrées de dimensions strictement identiques (190 px de haut), toutes branchées sur de vraies pages — Mes dépôts, Cloner, Nouveau dépôt, Synchroniser (synchro Git réelle avec progression), Branches, Historique, Modifications, Conflits. Aucun dépôt cloné : la carte guide vers le clonage ; plusieurs dépôts : un sélecteur demande lequel ouvrir.
- Section « Activité récente » : dépôts consultés, dernières synchronisations et derniers commits du dépôt GitHub actif (données réelles uniquement).
- Section « Dépôts favoris » : étoile sur la liste et le détail d'un dépôt ; carte avec branche active, état de synchronisation et accès direct. Deux nouveaux champs optionnels sur les dépôts (`favorite`, `lastOpenedAt`) : les données existantes restent compatibles.
- Fonctions GitHub historiques de l'accueil conservées (dépôt actif, envoi de fichiers, parcourir, tickets, pull requests, Actions, synchro auto) dans la section « Compte GitHub ».
- Illustrations vectorielles dessinées en vues (components/Illustration.tsx) : aucune dépendance ajoutée, aucune image à charger, fonctionnent hors ligne.
- Nouveaux composants réutilisables : ShortcutCard, FavoriteCard, RecentRepoCard, OperationRow, HomeSection, FavoriteButton.
- Barre d'onglets : pastille d'état actif plus large, colonnes entièrement tactiles.
- Harmonisation : rayons plus généreux, boutons et en-têtes à zones tactiles ≥ 44 px, états vides illustrés (dépôts, historique, conflits), aides repliables sur le clonage et la création.
- Logique de l'accueil isolée dans utils/homePure.ts et couverte par tests/home.test.mjs (10 tests).

## Phase 7 — Aide contextuelle et erreurs compréhensibles

- Ajout d'un composant d'aide repliable pour expliquer les opérations sans encombrer les écrans.
- Aide contextuelle sur le dépôt, les branches et la résolution des conflits.
- Les erreurs Git courantes indiquent maintenant une prochaine action concrète.
- Conseils de dépannage localisés en français et en anglais.
- Les confirmations destructives déjà présentes (suppression, abandon de fusion, annulation de modifications) sont conservées.

## Phase 6 — Harmonisation visuelle

- Palette sombre harmonisée : surfaces plus opaques, contrastes de texte secondaire et bordures renforcés.
- Fond graphique Git atténué par un voile sombre pour améliorer la lisibilité.
- Barre d'onglets affinée : zone active plus cohérente, cible tactile et libellés légèrement agrandis.
- Accueil : hiérarchie et espacements affinés, tuiles plus confortables et actions principales mieux dimensionnées.
- Liste des dépôts : cartes et commandes tactiles plus généreuses.
- Le thème clair n'est pas ajouté dans cette phase : l'application utilise actuellement un thème sombre fixe dans `useColors`.

## Phase 5 — Parcours quotidien simplifié

- Ajout d'un résumé lisible de l'état du dépôt et du nombre de fichiers à traiter.
- Regroupement des actions fetch/pull/push derrière une section d'options avancées ; la synchronisation principale reste immédiatement visible.
- Ajout d'un parcours guidé pour préparer et enregistrer un commit.
- Remplacement de l'annulation uniquement par appui long par une action explicite et accessible sur chaque fichier.
- Ajout des libellés français et anglais correspondants.

# Git-Push 1.1.0

## Performances
- Ouverture instantanée : profil, dépôts et dépôt choisi sont lus depuis le téléphone et affichés tout de suite ; la vérification GitHub se fait ensuite (avant : attente du réseau, jusqu'à ~10 s hors ligne).
- Lectures GitHub limitées à 30 s (au lieu de 5 min) ; les envois gardent 5 min.
- Synchronisation : seule la branche courante est récupérée (bien moins de données).
- Moteur Git : deux fois moins d'appels natifs par lecture de fichier.
- « En avance / en retard » mémorisé par paire de commits.
- Progression limitée à ~8 rafraîchissements/s ; onglets masqués gelés (freezeOnBlur).
- Thème et traductions stables : le React Compiler réutilise enfin les styles calculés.
- « Tout synchroniser » traite deux dépôts à la fois.
- Liste des dépôts GitHub paginée (plus de 100 dépôts).

## Interface
- Palette plus sobre (vert adouci, couleurs nommées : succès, alerte, IA, diff).
- Boutons et cartes qui « s'enfoncent » au toucher (animation native) + retour haptique.
- Chargements en squelette, état vide illustré, pastilles de branche.
- Notifications discrètes (toasts) au lieu des pop-ups pour les succès.
- Champs : contour au focus, bouton afficher/masquer pour les secrets.
- Contrôle segmenté sur piste, en-têtes et lignes de réglages redessinés.
- Transitions façon iOS avec retour par geste ; tirer pour tout synchroniser.
- Accessibilité : rôles, libellés, annonces des notifications, mouvement réduit respecté.

## Stabilité
- Démarrer hors ligne ne déconnecte plus : seul un token révoqué (401) déconnecte.
- Plus de commits d'une ancienne branche affichés après un changement rapide.
- Push refusé car le serveur a avancé pendant la synchro : pull + nouvel envoi automatique.
- Synchro planifiée qui pouvait ne jamais se déclencher (planificateur réinitialisé à chaque synchro).
- Plus de synchros empilées à chaque retour dans l'app.
- Clés IA en cours de saisie écrites dans le coffre avant la mise en arrière-plan.
- Erreurs de synchro (hors réseau) ajoutées au journal de Maintenance.

## Agent IA
- Édition tolérante à l'indentation (recalée sur celle du fichier), fins de ligne CRLF conservées.
- Erreurs d'édition avec numéros de ligne : le modèle corrige du premier coup.
- JSON cassé (package.json…) refusé avant écriture.
- Ce qui a été fait est conservé après une erreur ou un arrêt (plus de travail refait).
- Budget d'historique : plus de dépassement de contexte, coût réduit sur les longues sessions.
- Claude : cache de prompt (outils + consignes + historique).
- Délai maximum par requête ; nouvelles tentatives sur coupure réseau et erreurs 500/502/503/504/529.
- Double appui sur ✦ : une seule requête.

## Sécurité
- Tokens / clés présents dans les fichiers masqués avant envoi à l'IA (__SECRET_…__), remis en place à l'écriture.
- .env, clés privées, keystores, .git-credentials… jamais lus par l'IA.
- Secrets masqués dans le journal d'erreurs, les erreurs de synchro et le rapport de diagnostic.
- URL https://user:token@… : identifiants retirés de l'URL et rangés dans le coffre.
- Identifiants jamais envoyés en http:// vers Internet (réseau local / VPN autorisé).
- Sauvegarde Android des données de l'app désactivée (allowBackup: false).
- Tests ajoutés : `npm test` (23 tests).

## Durcissement et performances — modifications appliquées

- `pull` récupère prioritairement la branche courante ; le moteur conserve un repli sur le fetch complet si le serveur ne permet pas cette récupération ciblée.
- Mesure de l'espace disque : deux dépôts sont analysés en parallèle au maximum, avec une concurrence interne réduite pour limiter la pression sur le stockage Android.
- Explorateur de fichiers : concurrence des lectures de métadonnées réduite à 12 opérations simultanées.
- Dépendances : suppression de la déclaration Expo dupliquée entre `devDependencies` et `dependencies` ; la version runtime SDK 54 reste la référence.
- TypeScript : retrait d'une référence de projet externe absente du dépôt, qui empêchait les vérifications autonomes.
- CI : les tests unitaires bloquent désormais le pipeline lorsqu'ils échouent au lieu d'être simplement informatifs.
- Node.js : version minimale documentée dans `package.json` (`>=22.6.0`).

Validation locale : `node --experimental-strip-types --test tests/*.test.mjs` — 23 tests réussis.
Le build Android et le contrôle TypeScript complet restent à exécuter dans un environnement avec dépendances, JDK et SDK Android installés.

## Interface Git — phase 2
- Historique des commits : recherche locale par message, auteur, e-mail ou SHA.
- Compteur de commits chargés et de résultats correspondant à la recherche.
- Entrées plus lisibles : repère visuel de timeline, SHA mis en évidence et badge pour les merges.
- Accessibilité améliorée pour les actions de recherche et l'ouverture d'un commit.
- Pagination protégée contre les chargements simultanés déclenchés par la fin de liste.
- Limite : la recherche couvre les commits déjà chargés (40 au départ), pas l'intégralité du dépôt ; le repère visuel n'est pas un graphe Git multi-branches.

## Phase 3 — Gestionnaire de dépôts et comparaison de branches

- Ajout d'une recherche instantanée dans la liste des dépôts, sur le nom, l'URL et la branche active, avec compteur de résultats et état « aucun résultat ».
- Ajout d'une recherche dans les branches locales et distantes.
- Ajout d'un écran de comparaison de deux branches locales : sélection des branches, résumé des fichiers ajoutés/modifiés/supprimés et ouverture du diff détaillé par fichier.
- Les sélecteurs de branches utilisent une liste défilante et recherchable, adaptée aux dépôts contenant de nombreuses branches.
- Traductions françaises et anglaises ajoutées pour les nouveaux écrans et états.

Vérification : tests automatisés existants exécutés après les modifications (23 réussis). Le contrôle TypeScript complet et le build Android restent non vérifiés dans cet environnement sans dépendances installées.

## Ergonomie — simplification du gestionnaire de dépôts
- Actions essentielles plus faciles à repérer : synchroniser et supprimer sont maintenant visibles sur chaque carte, sans devoir connaître le geste d'appui long.
- Une flèche indique clairement qu'une carte ouvre le dépôt.
- Zones tactiles agrandies pour les actions de la liste et les commandes d'en-tête.
- Recherche plus confortable sur mobile, avec zone de saisie plus haute, bouton d'effacement explicite et libellés d'accessibilité.
- Libellé « Cloner » présenté en casse normale plutôt qu'en capitales.


## Ergonomie — synchronisation plus claire

- La synchronisation de tous les dépôts demande désormais une confirmation explicite et indique ses effets (commit, récupération, envoi distant).
- Le geste de tirer pour actualiser ne déclenche plus silencieusement une synchronisation Git complète.
- La liste des dépôts explique ce que fait la synchronisation avant la première action.
- La suppression d'un dépôt ne dépend plus d'un appui long caché : elle reste accessible par son bouton dédié et sa confirmation.
- Le bouton de synchronisation globale affiche son état pendant l'opération et empêche les déclenchements répétés.

## Phase 8 — Fiabilisation et tests de régression Git

- Ajout de tests ciblés sur le découpage des lignes, le diff ligne à ligne et le diff unifié.
- Couverture de la fusion à trois voies : changements indépendants, modifications concurrentes, changements identiques, fichiers CRLF et absence de saut de ligne final.
- Vérification des marqueurs de conflit et de la détection des fichiers binaires.
- Suite de tests locale : 32 tests réussis, 0 échec (`node --experimental-strip-types --test tests/*.test.mjs`).
- Limite de validation : les tests d'intégration avec un serveur distant, la compilation TypeScript et le build APK nécessitent les dépendances du projet et un SDK Android ; ils ne sont pas revendiqués comme exécutés ici.
\n## Phase 10 — Graphisme discret et cohérent sur toutes les pages\n\n- Fond commun enrichi de halos circulaires et de petits nœuds de connexion, dans les couleurs du thème, sans intercepter les interactions.\n- Cartes partagées habillées d'un filet supérieur et d'un détail lumineux très subtil.\n- Titres de section renforcés par un repère vertical cyan ; en-têtes d'onglets dotés d'un accent de marque discret.\n- Les écrans qui utilisent `AppBackground` bénéficient automatiquement de cette identité graphique (écrans principaux, dépôts, réglages, IA, Forge et écrans secondaires).\n- Aucun ajout de dépendance, d'image distante ou de donnée fictive.\n- Vérification : `npm test` — 42 tests réussis, 0 échec. Compilation TypeScript et build Android non exécutés.\n
## Phase 11 — Illustrations dédiées aux écrans

- Extension du système d'illustrations vectorielles locales avec des scènes dédiées : comparaison, commit, remotes, réglages, compte, IA, Forge et éditeur.
- `ScreenHeader` accepte maintenant une illustration propre à l'écran, dans un cadre compact et discret.
- Ajout d'illustrations adaptées aux écrans de branches, historique, conflits, différences, fichiers, comparaison, remotes, paramètres, éditeur, détails de commit, clonage, création de dépôt, comptes, synchronisation et Forge.
- Les onglets Dépôts, Fichiers et Paramètres reçoivent eux aussi une illustration de titre ; l'accueil conserve son globe réseau et l'assistant IA sa scène dédiée.
- Illustrations dessinées avec les vues React Native et Feather : aucun asset distant, aucun appel réseau, aucune dépendance supplémentaire.
- Le contenu et les actions des écrans restent inchangés ; les illustrations sont décoratives et masquées aux lecteurs d'écran.
- Vérification : `npm test` — 42 tests réussis, 0 échec. TypeScript et build Android non vérifiés faute des dépendances Expo installées dans cet environnement.

## Phase 12 — Transitions et micro-animations

- Ajout d'une entrée douce (fondu + léger déplacement vertical de 5 px) sur l'illustration et le titre des en-têtes d'écran.
- Animation exécutée avec `Animated` et le pilote natif : elle ne modifie pas la mise en page et reste légère.
- Respect de la préférence système « Réduire les animations » : l'en-tête apparaît immédiatement lorsque cette option est active.
- Conservation des interactions tactiles à ressort et des squelettes animés déjà présents ; aucune dépendance ajoutée.

## Phase 13 — Navigation et retours des opérations Git

- Transitions de navigation affinées : glissement natif pour la consultation, animation verticale douce pour Cloner / Nouveau dépôt / Synchroniser, animation « shift » entre onglets et fondu à l'ouverture de la connexion.
- Retours de réussite ajoutés aux actions qui restaient silencieuses : fetch, commit, changement/création/renommage/suppression de branche, opérations sur les remotes et clonage.
- Les notifications réutilisent le ToastHost global : elles restent visibles pendant le changement d'écran et conservent les retours haptiques/accessibilité existants.
- Les résultats spécifiques (push, sync, pull/fusion et conflits) gardent leurs messages détaillés, sans notification de réussite en double.
- Messages de confirmation ajoutés en français et en anglais ; les autres langues utilisent le fallback existant.

## Phase 14 — Tableau de bord Git

- Ajout d'un écran Vue d'ensemble Git accessible depuis l'en-tête du dépôt.
- Indicateurs : branches locales, branches distantes et commits récents.
- État de synchronisation : dernière tentative, succès/échec, reprise en attente et avance/retard par rapport à l'upstream.
- Liste des branches locales avec leur SHA de tête et accès direct à leur historique.
- Liste des branches distantes par remote avec leurs SHAs.
- Chronologie visuelle des 30 derniers commits de HEAD ; les commits de fusion sont distingués et chaque commit ouvre sa fiche détaillée.
- Libellés français et anglais.

## Phase 15 — Graphe Git multi-branches animé

- Remplacement de la simple chronologie par un graphe de commits multi-branches fondé sur les vrais parents Git et les refs locales/distantes.
- Construction d'un ordre topologique des commits, déduplication des commits communs et voies distinctes pour visualiser les bifurcations et fusions.
- Étiquettes de branches directement sur les commits de tête ; couleurs différenciées par voie et marqueur dédié aux commits de fusion.
- Connecteurs dessinés progressivement et nœuds animés à l'apparition ; sélection d'un commit pour ouvrir sa fiche.
- Défilement horizontal pour les graphes comportant plusieurs voies.
- Respect du réglage système de réduction des animations.
- Extracteur de graphe pur avec tests unitaires dédiés.

## Phase 16 — Barre de push Matrix

- Ajout d'une barre de progression Push au style terminal Matrix : fond noir, vert néon, caractères binaires animés, segments lumineux et balayage.
- Connexion au callback `onProgress` natif d'isomorphic-git pour afficher la progression réelle des objets Git transmis (chargé/total lorsque disponible).
- Mode animé indéterminé tant que Git ne fournit pas encore de total, sans inventer de pourcentage.
- Affichage de la phase Git en cours et du nombre d'objets traités.

## Phase 17 — Sécurité et fiabilité

- Serveur HTTP durci : validation du Host, abandon de `X-Forwarded-Host`, échappement HTML, protection contre les liens symboliques sortant du répertoire statique, chemins URI décodés et contrôlés, méthodes GET/HEAD uniquement, streaming des fichiers et en-têtes de sécurité.
- CI : les entrées `catalog:` inconnues font échouer la préparation au lieu de résoudre `latest`.
- Publication Android : keystore et secrets de signature requis pour publier ; aucune release publique ne peut être signée par défaut avec la clé de debug.
- Permissions GitHub Actions réduites : lecture seule pour le build et la validation, écriture uniquement dans le job de publication.
- Ajout du typecheck au pipeline CI et de tests de sécurité / intégration HTTP.
- Validation locale : 52 tests réussis. Typecheck et build Android restent à exécuter dans l'environnement complet.
