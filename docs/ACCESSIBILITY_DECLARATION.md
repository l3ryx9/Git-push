# Déclaration du service d'accessibilité / Accessibility service declaration

Texte prêt à reprendre dans la Play Console (« Déclaration relative à l'API Accessibility »), dans la politique de confidentialité et sur la fiche de l'application.

---

## Français

**Fonction principale concernée** : synchronisation Git automatique. L'utilisateur choisit des applications (par exemple son application de notes) ; Git-Push synchronise alors ses dépôts quand il ouvre ou quitte ces applications.

**Pourquoi l'API Accessibility est nécessaire** : Android ne propose aucun autre moyen, sans interrogation permanente, d'être prévenu qu'une autre application passe au premier plan ou le quitte. Le service n'écoute qu'un seul type d'événement (`typeWindowStateChanged`).

**Ce que fait le service** : il compare le **nom de paquet** de la fenêtre au premier plan aux règles définies par l'utilisateur, et, si une règle correspond, ouvre Git-Push pour lancer la synchronisation.

**Ce que le service ne fait pas** :
- il ne lit pas le contenu de l'écran (`canRetrieveWindowContent="false"`), ni les champs de texte, ni ce que l'utilisateur tape ;
- il n'effectue aucun geste, clic ou saisie à la place de l'utilisateur ;
- il ne collecte, n'enregistre ni ne transmet aucune donnée ; les règles restent sur l'appareil.

**Contrôle de l'utilisateur** : le service est désactivé par défaut. Il n'est activé que par l'utilisateur, dans les réglages d'accessibilité d'Android, après une **divulgation visible** (écran de confirmation dans l'application) qui explique l'usage ci-dessus. Il peut être désactivé à tout moment.

**Phrase pour la politique de confidentialité** : « Git-Push peut utiliser le service d'accessibilité d'Android, uniquement si vous l'activez, pour détecter le nom de l'application au premier plan et lancer une synchronisation Git quand vous ouvrez ou quittez les applications que vous avez choisies. Aucune donnée n'est collectée, enregistrée ni partagée. »

---

## English

**Core feature**: automatic Git sync. The user picks apps (for example their notes app); Git-Push then syncs their repositories when they open or leave those apps.

**Why the Accessibility API is needed**: Android offers no other way, without constant polling, to be told that another app comes to the foreground or leaves it. The service listens to a single event type (`typeWindowStateChanged`).

**What the service does**: it compares the **package name** of the foreground window with the user's rules and, when a rule matches, opens Git-Push to start the sync.

**What it does not do**:
- it does not read screen content (`canRetrieveWindowContent="false"`), text fields, or what the user types;
- it performs no gestures, clicks or input on the user's behalf;
- it does not collect, store or transmit any data; rules stay on the device.

**User control**: the service is off by default. Only the user turns it on, in Android's accessibility settings, after a **prominent in-app disclosure** (confirmation screen) explaining the use above. It can be turned off at any time.

**Privacy policy sentence**: "Git-Push may use Android's accessibility service, only if you turn it on, to detect the foreground app's name and start a Git sync when you open or leave the apps you chose. No data is collected, stored or shared."
