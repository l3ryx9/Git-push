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
- Protégez les secrets de signature Android dans les secrets GitHub Actions, jamais dans le dépôt.
- Vérifiez l'historique Git avant de rendre un dépôt public : supprimer un secret du dernier commit
  ne l'efface pas des commits antérieurs.

## Portée

Git-Push exécute le moteur Git et conserve les dépôts sur l'appareil. Les fournisseurs Git et IA
reçoivent les requêtes nécessaires à leurs fonctions respectives. Les règles de sécurité des
fournisseurs externes s'appliquent également.
