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
