# Politique de sécurité

## Signaler une vulnérabilité

Ne publiez pas de jeton, de clé API, de mot de passe ou de détail exploitable dans une issue publique.
Pour un signalement privé, utilisez la fonction **Report a vulnerability** de l'onglet
**Security** du dépôt GitHub lorsqu'elle est activée. À défaut, contactez les mainteneurs
par un canal privé avant toute divulgation publique.

## Bonnes pratiques

- Révoquez immédiatement tout jeton ou toute clé suspecte, puis créez un nouvel identifiant.
- N'utilisez pas l'agent IA sur un dépôt contenant des secrets que vous ne souhaitez pas transmettre
  à votre fournisseur IA. Les fichiers sensibles connus sont exclus de la lecture de l'agent,
  mais cette protection ne remplace pas une revue humaine.
- N'activez `insecureSsl` que pour un serveur de confiance avec certificat auto-signé.
- Préférez HTTPS pour les remotes ; les identifiants ne doivent jamais être placés dans une URL
  destinée à être conservée dans la configuration Git.
- Protégez les secrets de signature Android dans les secrets GitHub Actions, jamais dans le dépôt. Le workflow refuse maintenant de publier une release sans keystore de production et sans mots de passe/alias complets.
- Le serveur statique ne doit être exposé que derrière un proxy qui remplace `X-Forwarded-Proto` par une valeur fiable (`http` ou `https`). `X-Forwarded-Host` n'est pas utilisé pour construire les liens.
- Les dépendances `catalog:` inconnues font échouer la préparation CI : ne remplacez jamais une dépendance non résolue par `latest` sans revue.
- Vérifiez l'historique Git avant de rendre un dépôt public : supprimer un secret du dernier commit
  ne l'efface pas des commits antérieurs.

- Les liens `gitcrush://sync` lancés par une autre application ou une page web demandent une confirmation. L'URL affichée dans les réglages d'un dépôt contient une clé secrète : ne la partagez pas.
- Les identifiants d'un dépôt ne sont envoyés qu'à l'hôte de ce dépôt (github.com pour le compte GitHub principal).

- Les actions destructrices (vider un dépôt, supprimer des dépôts GitHub ou locaux, supprimer une branche distante) exigent de recopier le nom du dépôt ou un mot de sécurité, avec un délai de 2 s.

## Portée

Git-Push exécute le moteur Git et conserve les dépôts sur l'appareil. Les fournisseurs Git et IA
reçoivent les requêtes nécessaires à leurs fonctions respectives. Les règles de sécurité des
fournisseurs externes s'appliquent également.
