# Quoi de neuf dans Panoptica365

Notes de version destinées aux clients. Chaque version ci-dessous décrit ce
qui a changé dans cette version, les plus récentes en premier.

---

## Version 0.1.44 — 2026-06-05

### Nouveau : acceptation du contrat de licence

Panoptica365 présente désormais son contrat de licence utilisateur final lors de la configuration initiale. Sur une nouvelle installation, l’assistant de configuration s’arrête à l’étape de bienvenue jusqu’à ce que vous lisiez le contrat, saisissiez votre nom complet et cliquiez sur **Accepter et continuer** — une acceptation délibérée et consignée au nom de votre organisation. L’acceptation (votre nom saisi, la version du contrat, la langue dans laquelle vous l’avez lu et l’heure exacte) est conservée de façon permanente.

Une nouvelle carte **Contrat de licence** dans les Paramètres (réservée aux administrateurs) vous permet de relire le contrat à tout moment et indique qui l’a accepté et quand. Si une mise à jour ultérieure propose un contrat révisé, les administrateurs sont invités à examiner et à accepter la nouvelle version à la prochaine connexion avant de poursuivre — vos techniciens et observateurs continuent de travailler sans interruption, la surveillance ne s’arrête donc jamais.

---

## Version 0.1.43 — 2026-06-05

### Nouveau : regroupez une avalanche d’alertes liées en un seul regroupement

Lorsqu’un même client déclenche de nombreuses alertes pour un même problème sous-jacent — par exemple six alertes « MFA disabled users » lors d’une intégration — vous pouvez désormais les rassembler en une seule. Sélectionnez les alertes (le nouveau bouton **Fusionner** de la barre d’actions s’active dès que deux alertes ou plus sont cochées), confirmez un titre, et Panoptica crée une seule alerte de **regroupement** pour suivre l’enquête. Les alertes d’origine sont marquées comme résolues et reliées dans les deux sens : le regroupement énumère chaque alerte absorbée (chacune accessible d’un clic), et chaque alerte d’origine affiche un lien « Regroupée dans → » vers le regroupement.

Tant que le regroupement reste ouvert, les détections répétées des mêmes conditions s’accumulent discrètement sur les alertes d’origine au lieu de générer de nouveaux doublons — le bruit cesse sans rien masquer. Résolvez le regroupement et, si une condition est toujours présente, une toute nouvelle alerte se déclenche à la vérification suivante — votre signal « je pensais que c’était réglé ». Un regroupement ne peut combiner que des alertes d’un même locataire, et il est volontairement exclu de chaque statistique, rapport et infolettre matinale (les alertes d’origine demeurent l’enregistrement compté).

### Amélioré : la barre d’actions groupées ne fait plus sauter le tableau

La barre d’actions groupées du tableau de bord des alertes est maintenant toujours visible, à hauteur fixe, ses boutons grisés tant que rien n’est sélectionné. Auparavant, la barre n’apparaissait qu’au premier cochage, ce qui décalait le tableau vers le bas et pouvait faire atterrir votre clic sur la mauvaise ligne. Ce décalage de mise en page a disparu.

---

## Version 0.1.42 — 2026-06-04

### Nouveau : moniteur d’espace disque

Les Paramètres comportent désormais une carte **Espace disque** indiquant l’espace de stockage utilisé par votre serveur — utilisé, libre, total, ainsi qu’un pourcentage avec une barre d’utilisation. Surtout, Panoptica le **surveille pour vous** : une bannière apparaît en haut de l’application à **80 % d’utilisation** (et passe au rouge à **90 %**) pour vous laisser le temps de libérer de l’espace avant toute panne. Le même signal alimente l’indicateur d’état dans la barre d’état. Cela comble une lacune réelle — un disque plein peut faire tomber toute l’application, et vous êtes maintenant averti bien à l’avance.

### Fiabilité : les journaux ne peuvent plus remplir votre serveur

Nous avons renforcé la gestion des journaux de bout en bout afin qu’un processus bavard en arrière-plan ne puisse jamais saturer le disque : la journalisation PowerShell du moteur de surveillance est réduite à la source (dans l’image de l’application, donc chaque installation est protégée de la même façon) et les journaux des conteneurs sont plafonnés. Rien à configurer — c’est intégré.

---

## Version 0.1.41 — 2026-06-03

### Nouveau : Diagnostics — capturez un dossier de soutien en un clic

Les Paramètres comportent désormais une carte **Diagnostics** (administrateurs seulement). Lorsqu'un problème survient, cliquez sur **Capturer les diagnostics** et Panoptica assemble un dossier unique, téléchargeable, contenant tout ce dont nous avons besoin pour enquêter : journaux de l'application, résumés de configuration, état de la base de données, statistiques récentes d'alertes et d'ingestion, espace disque et — sur les installations Docker — les journaux des conteneurs. Envoyez-le au soutien technique et nous pouvons déboguer à distance, même sur des serveurs auxquels nous n'avons aucun accès direct.

Le dossier peut être **envoyé en toute sécurité** : il ne contient aucun secret, mot de passe ni identifiant. Chaque valeur figurant sur la liste des secrets est masquée, et une passe d'expurgation retire les jetons et les clés de chaque fichier avant l'empaquetage. (Les noms des clients sont inclus volontairement, afin que le soutien puisse vous orienter vers le client concerné.) Si un élément ne peut être collecté — par exemple si la base de données est hors service — le dossier est tout de même produit avec le reste, et un manifeste à l'intérieur indique précisément ce qui manquait. Les trois dossiers les plus récents sont conservés pour un nouveau téléchargement.

### En coulisses : journaux fichiers durables + module de mise à jour renforcé

Les journaux de l'application sont désormais aussi écrits dans des fichiers quotidiens avec rotation (conservation de 7 jours), afin de survivre au redémarrage d'un conteneur et d'alimenter le nouveau dossier de Diagnostics. De plus, le module d'auto-mise à jour exécute maintenant une **charge utile signée cryptographiquement** que le composant de mise à jour vérifie avant chaque utilisation — une amélioration de défense en profondeur qui verrouille la partie la plus privilégiée du système. Aucune action requise de votre part.

---

## Version 0.1.40 — 2026-06-03

### Nouveau : activation guidée de la première mise en service de la stratégie de sécurité préconfigurée Standard (MDO)

Microsoft ne crée les stratégies de sécurité de courrier préconfigurées Standard/Strict d’un client que la **première fois** qu’elles sont activées dans le portail Defender — aucune API ni commande PowerShell ne peut les créer de toutes pièces. Jusque-là, appliquer le paramètre dans Panoptica n’avait rien sur quoi agir, ce qui pouvait donner l’impression que la stratégie « ne tenait pas ».

Panoptica **détecte désormais lorsqu’un client n’a jamais activé le préréglage** et, dans l’onglet Remédier du paramètre, remplace les boutons Restaurer/Accepter par un **guide étape par étape**. Il vous accompagne dans l’assistant Defender — Exchange Online Protection et Defender pour Office 365 pour tous les destinataires, qui ajouter comme personnes protégées contre l’usurpation (cadres, finances, RH), l’ajout du domaine du client et l’activation de la stratégie — puis explique comment redonner la surveillance à Panoptica. Une fois activé, cliquez sur **Actualiser**, puis sur **Accepter ce changement** pour adopter le préréglage Microsoft en direct comme base de référence. À partir de là, Panoptica en surveille les dérives comme tout autre paramètre.

Sur les clients qui n’ont pas encore Defender pour Office 365 (par exemple Business Standard), le guide bascule automatiquement vers une version plus courte **EOP seulement**. L’Exchange Online Protection du préréglage Standard (anti-pourriel, anti-programme malveillant, anti-hameçonnage) s’applique tout de même et doit y être activée — l’assistant Microsoft saute simplement les étapes Liens fiables/Pièces jointes fiables et usurpation. Panoptica les active désormais correctement et ne signale plus l’erreur d’interrogation déroutante qu’il produisait auparavant sur ces clients.

---

## Version 0.1.39 — 2026-06-02

### Nouveau : carte Licences dans les Paramètres

Les Paramètres comportent désormais une carte **Licences** (administrateurs seulement). Elle affiche votre nombre total de sièges sous licence, le nombre de sièges actuellement utilisés dans l’ensemble des clients que vous surveillez, le titulaire de la licence, votre palier et la date d’expiration. Un bouton **Actualiser maintenant** transmet immédiatement le nombre de sièges actuel au serveur de licences, sans attendre l’actualisation hebdomadaire.

Si le nombre actuel dépasse votre total sous licence, la carte indique de combien de sièges vous êtes en dépassement afin que vous puissiez en ajouter auprès de votre fournisseur.

---

## Version 0.1.38 — 2026-06-02

### Récupération simplifiée lorsqu’un ajout de client rencontre un incident de consentement

À l’occasion, la finalisation du consentement administrateur d’un nouveau client échoue avec l’erreur Microsoft **AADSTS650051**. Il s’agit généralement d’un problème temporaire lors de la première tentative de consentement de Microsoft — réessayer fonctionne. Au lieu d’afficher une erreur obscure, Panoptica365 explique désormais ce qui s’est passé et propose un bouton **Réessayer** qui relance le consentement (ce qui règle le problème dans la plupart des cas). Pour le cas plus rare où l’échec persiste — une inscription d’application résiduelle d’une connexion précédente subsistant dans le client — la fenêtre inclut une section « Afficher les étapes de nettoyage » avec un script PowerShell prêt à exécuter, pré-rempli avec les identifiants du client et de l’application, qui supprime complètement le résidu afin d’ajouter le client proprement.

Astuce : lorsque vous retirez un client de Panoptica365, vous n’avez pas besoin de supprimer l’application d’entreprise dans le client — le rajout la réutilise simplement, ce qui évite complètement cette situation.

### Correction : le résumé quotidien fonctionne désormais sur les nouvelles installations

Sur une toute nouvelle installation, une incohérence interne dans la configuration de la base de données empêchait le résumé quotidien (briefing du matin) d’être enregistré ou chargé — la fonction ne produisait donc jamais de résumé, sans erreur visible. La structure de la base de données est maintenant réconciliée automatiquement au démarrage, y compris l’autoréparation de toute installation déjà touchée. Les nouvelles installations obtiennent la bonne structure dès le départ, et les installations existantes se réparent au prochain redémarrage.

---

## Version 0.1.37 — 2026-06-01

### Correction : la surveillance d'Exchange Online et de la Conformité se configure maintenant pendant l'intégration

Plusieurs lecteurs de sécurité de Panoptica365 utilisent Exchange Online et Microsoft Purview, qui exigent l'attribution de deux rôles d'annuaire Entra — **Administrateur Exchange** et **Administrateur de conformité** — à l'application dans chaque client. L'octroi du consentement administrateur crée l'application et ses autorisations, mais n'attribue **pas** ces rôles; ils devaient donc auparavant être ajoutés manuellement dans chaque client — et s'ils étaient oubliés, les lecteurs Exchange/Purview restaient bloqués à « En attente d'infrastructure ».

Panoptica365 attribue désormais ces deux rôles automatiquement juste après qu'un client a accordé le consentement administrateur, à l'aide d'une autorisation qu'il détient déjà. Plus aucune étape manuelle dans le portail par client.

Si l'attribution automatique n'aboutit pas du premier coup — par exemple lorsque le principal de service de l'application est encore en cours de propagation dans un tout nouveau client — vous pouvez réessayer à partir de **Clients → Modifier → Réattribuer les rôles Exchange** (administrateurs seulement). L'action peut être exécutée plusieurs fois sans risque.

---

## Version 0.1.36 — 2026-06-01

### Nouveau : supprimer un client et toutes ses données

Vous pouvez maintenant retirer un client de Panoptica365. C'est utile lorsqu'un MSP perd un client, ou lorsque vous souhaitez retirer puis rajouter un client pour relancer l'intégration.

Dans la section **Clients**, cliquez sur **Modifier** pour un client : vous y trouverez un bouton rouge **Supprimer le client** (visible uniquement par les administrateurs). Il ouvre une confirmation qui précise exactement ce qui sera retiré — alertes, instantanés, paramètres de sécurité, attributions d'accès conditionnel, audits et historique des modifications. Cliquez sur **Non, conserver** pour annuler, ou sur **Oui, tout supprimer** pour retirer définitivement le client et toutes les données qui s'y rapportent. La suppression est consignée dans le journal d'audit.

Cette action est irréversible.

---

## Version 0.1.35 — 2026-06-01

### Correction : la progression de la mise à jour signalait parfois un faux échec

Lors de l'application d'une mise à jour dans l'application, la fenêtre de progression pouvait afficher brièvement « la mise à jour ne s'est pas terminée » alors que la mise à jour réussissait en réalité en arrière-plan. Cela se produisait lorsqu'un enregistrement d'état provenant d'une tentative de mise à jour précédente se trouvait encore sur le disque — la fenêtre lisait cet ancien enregistrement un instant avant que la nouvelle mise à jour ne le remplace.

La fenêtre de progression suit désormais la mise à jour précise qu'elle a lancée et ignore tout état résiduel d'une tentative antérieure, de sorte qu'elle indique toujours le résultat de la mise à jour que vous avez réellement déclenchée.

---

## Version 0.1.34 — 2026-06-01

### Instructions d'inscription d'application Entra plus claires

Le guide d'inscription d'application Entra intégré à l'assistant affiche maintenant les trois URI de redirection dont votre application a besoin — pas seulement celui de la connexion. Les installations précédentes n'enregistraient que l'URL de connexion, ce qui fonctionnait pour se connecter mais faisait rejeter par Microsoft la toute première intégration d'un locataire client, avec l'erreur « AADSTS50011 : l'URI de redirection ne correspond pas ». La page de configuration affiche désormais les deux URL supplémentaires — une pour l'intégration des locataires clients, une pour les fonctions de configuration de Microsoft Teams — chacune avec un bouton de copie et l'endroit exact où l'ajouter.

L'étape des autorisations d'API est aussi beaucoup plus claire sur l'emplacement de chaque autorisation. Les autorisations Microsoft Graph se trouvent sous un onglet, mais celles d'Exchange Online, des API de gestion Office 365 et de Microsoft Teams sont sous un autre (`API utilisées par mon organisation`) et doivent être recherchées par nom. L'assistant indique maintenant quel onglet utiliser pour chaque API, donne le nom et l'ID d'application exacts à rechercher, signale que l'autorisation Teams `user_impersonation` est masquée dans un groupe replié `Autres autorisations`, et explique quoi faire si une API n'apparaît pas du tout sur un locataire tout neuf.

---

## Version 0.1.33 — 2026-06-01

### Correctif de fiabilité pour la configuration du certificat

Suivi de la configuration guidée du certificat introduite dans la version 0.1.32. Sur certaines nouvelles installations, le certificat ne pouvait pas être généré parce que le dossier de destination n'était pas accessible en écriture, et l'étiquette du bouton **Télécharger le certificat** était difficile à lire. Les deux problèmes sont corrigés : Panoptica365 écrit désormais toujours le certificat dans un emplacement accessible en écriture, et le bouton est lisible. Aucune action n'est requise au-delà de l'installation de cette mise à jour.

---

## Version 0.1.32 — 2026-06-01

### Configuration guidée du certificat pour la surveillance d'Exchange Online

Les nouvelles installations provisionnent désormais le certificat requis par la surveillance d'Exchange Online, directement dans l'assistant de configuration. Auparavant, une nouvelle installation pouvait lire l'essentiel de la posture de sécurité de vos clients via Microsoft Graph, mais la vingtaine de paramètres qui dépendent d'Exchange Online PowerShell restaient grisés à « En attente d'infrastructure » — parce qu'Exchange, contrairement à Graph, refuse un secret client et exige un certificat, et que rien n'en créait un pour vous.

L'étape Inscription d'application de l'assistant comporte maintenant une nouvelle section **Téléverser le certificat de surveillance**. Panoptica365 génère le certificat pour vous automatiquement ; il vous suffit de cliquer sur **Télécharger le certificat (.cer)**, de téléverser ce seul fichier sur la page **Certificats &amp; secrets** de votre inscription d'application dans le portail Microsoft, puis de continuer. Pas d'`openssl`, pas d'empreinte à saisir, pas d'accès à l'interpréteur de commandes. Le bouton **Tester la connexion** à l'étape suivante confirme désormais aussi que le certificat a bien été téléversé et vous indique clairement s'il manque.

Cela ne concerne que les nouvelles installations — les installations existantes ont déjà configuré leur certificat lors de l'intégration et restent inchangées.

---

## Version 0.1.31 — 2026-05-31

### Mises à jour logicielles en un clic, avec retour arrière automatique

Panoptica365 peut maintenant se mettre à jour lui-même. Lorsqu'une version plus récente est publiée, chaque opérateur voit une bannière discrète l'informant de sa disponibilité, et un administrateur peut l'appliquer d'un seul clic depuis le menu du compte — sans terminal, sans commande `docker`, sans accès à l'interpréteur de commandes.

Lorsque vous cliquez sur **Mettre à jour maintenant**, Panoptica365 prend une copie de sécurité de sa base de données, télécharge la nouvelle version, la met en place, et confirme que celle-ci démarre correctement avant de déclarer la réussite. Si la nouvelle version ne démarre **pas** correctement, elle est **automatiquement annulée** au profit de la version que vous utilisiez, et le résultat vous est clairement indiqué — votre instance n'est jamais laissée dans un état défectueux. La base de données n'est jamais restaurée automatiquement; la copie de sécurité est conservée uniquement à titre d'assurance.

La bannière de mise à jour s'affiche pour tout le monde, mais seuls les administrateurs voient l'action **Mettre à jour**. Une mise à jour requise est signalée par un libellé plus ferme, mais son application demeure toujours un choix délibéré de l'administrateur. Chaque tentative de mise à jour — réussite, retour arrière ou échec — est consignée dans le journal d'audit.

---

## Version 0.1.30 — 2026-05-31

### Correction : la configuration d'une nouvelle installation tient enfin — et se termine d'elle-même

La première chose à faire sur un nouveau serveur Panoptica365 est d'exécuter l'assistant de configuration. Jusqu'à maintenant, sur une nouvelle installation conteneurisée, l'assistant pouvait sembler réussir alors que les identifiants saisis — votre inscription d'application Entra, votre clé de licence et le reste — n'étaient pas conservés, laissant l'application incapable de vous connecter. La configuration est désormais d'une fiabilité à toute épreuve : tout ce que l'assistant recueille est enregistré sur l'hôte et survit aux redémarrages de conteneur et aux mises à niveau d'image.

La dernière étape se termine aussi toute seule. Lorsque vous terminez l'assistant, Panoptica365 redémarre une fois pour appliquer votre configuration, affiche brièvement un écran **« Finalisation de la configuration — reconnexion… »**, puis vous amène directement à l'écran de connexion (ou au consentement d'administrateur) dès qu'il est de retour — aucune commande au terminal, aucun redémarrage manuel.

C'est la correction principale pour les premières installations. Si vous avez configuré une installation antérieure à la main, rien ne change pour vous.

### Également dans cette version

- Les états vides de premier affichage de la console principale — « aucun locataire » et « aucun résumé quotidien » — apparaissent maintenant dans la langue de votre interface (français, anglais ou espagnol) au lieu de toujours en anglais.
- Renforcement d'une migration interne de base de données afin qu'une nouvelle installation ne consigne plus d'avertissements transitoires pendant son démarrage.

---

## Version 0.1.29 — 2026-05-31

### Nouveauté : personnalisez vos rapports avec votre nom et votre logo

Les rapports Panoptica365 peuvent désormais porter votre image de marque plutôt que la nôtre. Une nouvelle carte **Image de marque des rapports**, sous **Paramètres**, vous permet d'inscrire le nom de votre entreprise et de téléverser un logo. Un PNG transparent donne le meilleur résultat — il s'intègre proprement à la page couverture, sans boîte blanche derrière lui.

Votre logo apparaît maintenant sur la page couverture de chaque rapport — Posture de sécurité, Documentation de configuration et Évaluation rapide — dans le coin supérieur gauche, avec le titre, le nom du client et la date alignés à gauche en dessous. La ligne « Préparé par » de la couverture affiche le nom de la personne qui a généré le rapport plutôt qu'un nom d'entreprise générique : un représentant peut ainsi remettre à un client un rapport portant son propre nom. Le nom de votre entreprise demeure dans le pied de page confidentiel de chaque page.

Si vous ne téléversez rien, les rapports conservent la page couverture Panoptica365 par défaut.

---

## Version 0.1.28 — 2026-05-31

### Nouveauté : chronologie de l'identité — un clic depuis une alerte vers toute l'histoire

Quand une alerte d'identité se déclenche — le plus souvent un verrouillage de compte après des connexions échouées répétées — la question est toujours la même : s'agit-il d'un mot de passe oublié et d'une pulvérisation sans danger venue de l'étranger, ou de la seule fois où un compte a vraiment été pris d'assaut? Jusqu'ici, y répondre voulait dire quitter l'alerte, ouvrir l'Activité quotidienne, choisir le locataire et filtrer à la main les connexions de l'utilisateur.

Le nouveau bouton **Voir la chronologie de l'identité**, sur le panneau de détail de toute alerte d'identité, réduit tout cela à un seul clic. Un panneau en lecture seule glisse à l'écran et montre les dernières 24 h d'activité de l'utilisateur (extensible à 7 jours), assemblées à partir de quatre sources que Panoptica365 recueille déjà — connexions, journal d'audit unifié, incidents Defender et autres alertes Panoptica — sur un seul écran trié par heure. Les connexions réussies et échouées sont distinguées par couleur, de sorte qu'une seule réussite dans un mur d'échecs est impossible à manquer; les rafales répétées d'une même action sont regroupées en une ligne avec un compte, et chaque adresse IP est étiquetée IPv4 ou IPv6.

En haut, Claude lit l'ensemble du portrait et rédige une courte évaluation en langage clair — s'agit-il d'une tentative de force brute à laquelle le compte a résisté, ou d'une compromission possible qui exige une action — en citant les événements exacts sur lesquels il s'appuie. Les attaques uniquement en échec sont clairement signalées comme « compte protégé », et non maquillées en intrusions. L'évaluation est rédigée dans la langue de votre interface et mise en cache, de sorte que rouvrir la même alerte ne coûte rien; appuyez sur **Réanalyser** pour la rafraîchir. Panoptica365 ne touche jamais au locataire : le panneau est en lecture seule, avec des liens vers le Carrefour d'apprentissage et les consoles Entra et Defender pour le moment où vous voudrez agir.

---

## Version 0.1.26 — 2026-05-30

### Nouveauté : onglet Applications — connaissez chaque application d'un locataire, et repérez celles qui changent

Chaque locataire Microsoft 365 accumule des applications consenties — des outils tiers auxquels quelqu'un a cliqué « accepter », plus des inscriptions d'applications créées pour des scripts et des intégrations. Avec le temps, plus personne ne se souvient de la moitié d'entre elles, et n'importe laquelle peut détenir un accès permanent au courrier, aux fichiers ou à l'annuaire. Le nouvel onglet **Applications**, dans le tableau de bord de chaque locataire entre Alertes et Stratégies AC, les répertorie toutes au même endroit, montre exactement ce que chacune peut faire, et vous permet de marquer celles que vous reconnaissez comme **Approuvées**.

Approuver une application enregistre ses permissions actuelles comme base de référence. À partir de là, Panoptica365 surveille cette application et ne vous avertit que si elle **gagne** par la suite des permissions au-delà de ce que vous avez approuvé — le même modèle d'acceptation de la dérive que vous utilisez déjà pour l'accès conditionnel. Le retrait de permissions ne déclenche jamais d'alerte; seule la croissance au-delà de votre base le fait, car c'est la direction qui ajoute du risque. Une application qui dérive déclenche une seule alerte **Dérive d'application approuvée**, accompagnée d'une fiche explicative complète en langage clair.

Les applications que vous n'avez pas révisées reçoivent une évaluation de triage ponctuelle de Claude (Sonnet) : une pastille verte, jaune ou rouge qui vous indique par où commencer. Dépliez une application pour lire le raisonnement complet de Claude, ses permissions regroupées par type, et son historique. La pastille est un triage, jamais un verdict de « sûre » — seule l'approbation d'une application enregistre une base de référence protégée.

Lorsque vous approuvez une application, toute alerte de consentement OAuth ouverte à son sujet se résout automatiquement, et cette alerte pointe désormais directement vers la ligne de l'application. Panoptica365 ne modifie toujours jamais un locataire lui-même : pour retirer une application morte, chaque ligne comporte un lien **Supprimer** qui ouvre cette application précise dans le centre d'administration Entra, où vous confirmez la suppression (Microsoft la garde récupérable pendant 30 jours).

### Correctif : les listes d'applications de la Vue d'ensemble affichent maintenant toutes les applications

Dans la Vue d'ensemble du locataire, les panneaux **Applications d'entreprise** et **Inscriptions d'applications** n'affichaient que les 30 premières lignes avec un « +N de plus » silencieux — une liste de sécurité incomplète qui avait l'air complète. Elles affichent maintenant toutes les applications dans une liste défilante, et le décompte des applications d'entreprise correspond à ce que vous voyez dans le portail Entra.

---

## Version 0.1.25 — 2026-05-30

### Nouveauté : Fil de messages Microsoft — soyez prévenu quand Microsoft déplace le plancher

Il existe un troisième type de dérive de configuration, et jusqu'ici
Panoptica365 n'en surveillait que deux. Vous êtes déjà alerté quand un
opérateur change quelque chose (dérive causée par un opérateur) et quand un
attaquant change quelque chose (dérive causée par un attaquant). Celle que vous
ne pouviez pas voir, c'était Microsoft modifiant discrètement une valeur par
défaut, retirant un contrôle ou réduisant la portée d'une stratégie — la
**dérive causée par Microsoft**. Personne n'a touché au locataire; le paramètre
a simplement cessé de vouloir dire ce qu'il voulait dire la semaine dernière, et
il n'y a aucune connexion à examiner ni rien dans le journal d'audit.

Le nouveau **Fil de messages Microsoft** comble cette lacune. Choisissez un
locataire dans **Paramètres → Fil de messages Microsoft** (votre propre
locataire de FSG ou n'importe quel client intégré — c'est la même feuille de
route Microsoft dans les deux cas), et une fois par jour Panoptica365 lit le
Centre de messages Microsoft 365 de ce locataire, soumet chaque nouvelle annonce
à Claude, et déclenche une alerte **uniquement lorsque le changement semble
toucher un paramètre que nous surveillons déjà pour vous**. La plupart des
publications du Centre de messages sont du bruit; ceci fait ressortir les
quelques-unes qui comptent, généralement avec des semaines de préavis pour que
vous puissiez vous ajuster à votre rythme plutôt que de l'apprendre quand
quelque chose brise.

Ces alertes visent **l'ensemble du parc**, pas un seul client. Un changement de
Microsoft qui touche tout votre portefeuille produit **une seule** alerte qui
nomme les locataires concernés — jamais une douzaine d'alertes presque
identiques. Chaque alerte contient une explication en langage clair dans votre
langue, un lien direct vers la publication originale de Microsoft, et l'explicatif
(icône mortier) si vous voulez le « pourquoi ça compte » au complet. La
fonctionnalité est livrée **désactivée** — rien ne se passe tant que vous n'avez
pas choisi un locataire source, et vous pouvez en changer ou revenir à « Aucun »
à tout moment.

Par défaut, ces alertes apparaissent **uniquement dans le tableau de bord** et
ne sont pas envoyées par courriel, car la dérive causée par Microsoft relève de
la sensibilisation, pas de l'incident. Si vous préférez aussi être averti par
courriel, réglez la stratégie d'alerte **« Changement prévu par Microsoft »** sur
support/personnel/les deux. Et la première fois qu'un locataire source est lu,
tout son historique du Centre de messages est versé d'un coup dans le tableau de
bord sans vous envoyer de courriel, afin que l'activation du fil n'inonde jamais
votre boîte de réception.

Cela nécessite une nouvelle permission Microsoft, `ServiceMessage.Read.All`,
accordée sur le locataire que vous lisez. Les nouvelles installations la captent
dans le guide de configuration; les installations existantes l'accordent une fois
sur le locataire source choisi.

---

## Version 0.1.24 — 2026-05-30

### Nouveauté : Carte thermique — la posture de sécurité de chaque locataire, côte à côte

Une nouvelle page **Carte thermique** s'ajoute à la section Console (juste
au-dessus de Locataires). Elle présente la posture de sécurité de chaque
locataire géré selon les mêmes catégories — Identité, Courriel et Exchange,
SharePoint, Teams, Conformité — dans une seule grille, afin de repérer d'un
coup d'œil quel contrôle est faible dans l'ensemble du parc et de lancer une
seule campagne « corriger partout ».

Chaque cellule de catégorie affiche une rangée de pastilles d'état, une par
contrôle, colorée selon l'état réel du contrôle : vert (sain), rouge (dérive),
ambre (pas encore configuré), une pastille neutre hachurée (non disponible sur
ce locataire) et une pastille texturée (aucune donnée pour l'instant). Cliquez
sur un en-tête de catégorie pour la développer en contrôles individuels, et
cliquez sur n'importe quel locataire, cellule ou pastille pour accéder
directement à la page de détail Sécurité de ce locataire. Toute la page est en
lecture seule — elle ne modifie jamais rien sur un locataire.

Au-dessus de la grille : un pourcentage de santé pour l'ensemble du parc, un
panneau « Faiblesses générales » classant les contrôles faibles chez le plus
de locataires (cliquez sur l'un d'eux pour voir les locataires touchés et la
description du contrôle), et un panneau « Variations » qui mettra en évidence
le locataire ayant le plus régressé sur une fenêtre glissante de 7 jours. Le
panneau Variations affiche un message « constitution de la référence » jusqu'à
ce qu'une semaine d'historique quotidien soit accumulée, puis commence à
présenter les tendances réelles.

Le pourcentage principal sous le nom de chaque locataire se lit « sains ÷
contrôles applicables » et affiche désormais aussi la fraction brute — p. ex.
**100 % (17/17)** — afin qu'il soit clair qu'il signifie « parmi les contrôles
qui s'appliquent à ce locataire, voici combien sont sains », et non une
proportion de tous les contrôles offerts par Panoptica365. Les locataires en
mode audit sont exclus partout, avec une légende dans l'en-tête expliquant la
différence de nombre par rapport à la liste Locataires.

La Carte thermique s'appuie sur les mêmes verdicts par contrôle qui alimentent
la page Sécurité de chaque locataire, de sorte que les deux ne peuvent jamais
se contredire. Elle est accessible à tous les niveaux d'utilisateur
(administrateur, opérateur, observateur) et entièrement traduite en anglais,
français et espagnol.

---

## Version 0.1.23 — 2026-05-30

### Précision des alertes : fini les fausses vagues lors d'un échec de collecte

Lorsque Panoptica vérifie un client, il compare ce qu'il voit maintenant à ce
qu'il a vu la dernière fois, et vous alerte sur la différence — une nouvelle
application d'entreprise, une règle de boîte de réception supprimée, etc. Le
problème : si une vérification touchait une API Microsoft momentanément limitée
ou indisponible, Panoptica pouvait lire l'inventaire du client comme
brièvement *vide*, enregistrer cette lecture vide, puis — à la vérification
suivante réussie — signaler **tout** l'inventaire comme nouvellement créé (ou,
dans l'autre sens, entièrement supprimé). Résultat : une rafale de fausses
alertes, souvent datées de la création d'origine de l'objet, des mois ou des
années plus tôt.

Les vérifications échouées n'écrasent plus les bonnes données. Lorsqu'une
collecte échoue ou revient incomplète, Panoptica conserve maintenant la
dernière image valide au lieu d'en enregistrer une vide ; un raté temporaire de
Microsoft ne peut donc plus fabriquer une vague de fausses alertes « créé » /
« supprimé ».

### Les alertes MFA nomment l'utilisateur

Les alertes « MFA non enregistré » affichaient auparavant `undefined` au lieu
du nom de la personne et regroupaient tous les utilisateurs touchés en une
seule alerte. Elles affichent désormais l'utilisateur réel et suivent une
alerte par personne.

### Les rapports excluent les alertes rejetées

Les alertes que vous marquez comme **faux positif** ne comptent plus dans les
chiffres des rapports PDF, du breffage du matin ni des tuiles du tableau de
bord. Les alertes que vous marquez **résolues** demeurent — une alerte résolue
est un véritable historique de sécurité, et vos rapports doivent en tenir
compte.

---

## Version 0.1.22 — 2026-05-29

### Nouveau : Apprendre — le programme de formation en sécurité intégré

Panoptica365 comprend maintenant une section **Apprendre** dans la barre
latérale (sous SharePoint). Elle intègre tout le programme de formation en
sécurité directement à la console : 49 leçons réparties en six sujets — d'une
orientation au paysage de sécurité de Microsoft 365, jusqu'aux attaques
d'identité réelles qui visent les locataires aujourd'hui, en passant par
l'accès conditionnel, Intune, la sécurité du courriel et le Secure Score.

Cliquez sur **Apprendre** pour voir les six cartes de sujets, ouvrez un sujet
pour parcourir ses leçons, puis cliquez sur une leçon pour la lire dans un
grand espace de lecture confortable. Un point bleu signale les leçons que vous
n'avez pas encore lues — il disparaît dès que vous les ouvrez — et une
étiquette **MIS À JOUR** indique les leçons modifiées au cours des deux
dernières semaines, pour repérer d'un coup d'œil ce qui est nouveau. Tout suit
la langue de votre interface : français, anglais ou espagnol.

La section est en lecture seule. Elle est là pour apprendre, que vous formiez
un nouveau technicien ou que vous révisiez un contrôle précis avant de le
configurer.

---

## Version 0.1.21 — 2026-05-29

### L'Évaluation rapide fonctionne maintenant avec Claude Opus 4.8

Le rapport d'Évaluation rapide — l'analyse approfondie des lacunes de la
posture de sécurité d'un locataire, rédigée par l'IA — utilise désormais le
modèle de plus haut niveau le plus récent d'Anthropic, Claude Opus 4.8, sorti
cette semaine. Auparavant, il était fixé à Opus 4.7.

Il s'agit uniquement d'une mise à niveau du modèle : rien ne change dans la
façon dont vous générez une évaluation ni dans le contenu du rapport. Opus 4.8
apporte un raisonnement plus solide et une analyse plus précise — attendez-vous
donc à des constats mieux ciblés et mieux priorisés. Le modèle peut toujours
être remplacé par installation via la variable d'environnement `OPUS_MODEL`
pour les opérateurs qui souhaitent fixer une version précise.

---

## Version 0.1.20 — 2026-05-28

### Tableau de bord du locataire : les nombres d'appareils Intune se réconcilient

Le tableau de bord du locataire affichait trois nombres d'appareils qui ne
concordaient pas : la tuile **Appareils** (total des appareils enregistrés
dans Entra), le sous-titre `X/Y conformes` en dessous (appareils ayant un
verdict de conformité enregistré dans Entra) et le compteur du tableau
**Appareils gérés par Intune** (appareils inscrits à Intune). Entra et
Intune comptent des populations différentes — Entra compte chaque appareil
qui s'est déjà enregistré dans le répertoire, Intune ne compte que les
appareils actuellement inscrits en MDM — donc les trois chiffres étaient
chacun corrects isolément mais semblaient se contredire côte à côte.

Les tuiles Appareils et Gérés ont été remplacées par une seule tuile
**Appareils conformes**. Elle affiche le pourcentage d'appareils Intune
évaluables qui sont conformes — la seule source où Microsoft produit
réellement un verdict de conformité par appareil. Le sous-titre indique
`X sur Y conformes`, plus `Z non évalués` lorsque certains appareils
tombent dans le panier non évalué (typiquement les serveurs gérés par
Defender for Endpoint plutôt que par Intune). Les serveurs sur MDE ne
font plus baisser le score — ils ne font tout simplement pas partie du
pourcentage.

Une petite flèche de tendance apparaît à côté du pourcentage lorsque le
score de conformité a changé depuis le dernier sondage : `▲ +N%` vert si
amélioration, `▼ −N%` rouge si régression, rien quand c'est stable ou
qu'il s'agit du premier sondage. La tendance est calculée par locataire
à chaque cycle de sondage et embarquée dans le métrique
`intune_compliance`.

### Tableau de bord du locataire : le tableau Intune montre tous les appareils

Le panneau **Appareils gérés par Intune** était plafonné à 30 lignes avec
un substitut `... et N de plus` — inutile sur les locataires avec
100+ appareils. Le panneau affiche maintenant chaque appareil dans un
conteneur défilant (≈25 lignes visibles, le reste accessible par
défilement) avec un en-tête fixe. La colonne **Conformité** affiche
`Conforme`, `Non conforme` ou `Non évalué` au lieu du vocabulaire brut de
huit états de Microsoft (`unknown`, `inGracePeriod`, `conflict`, `error`,
`notAssigned`, `configManager`, etc.). Les règles de regroupement :
`compliant` et `inGracePeriod` comptent comme conformes (Microsoft
lui-même traite les appareils en période de grâce comme conformes pour
les besoins de l'accès conditionnel) ; `noncompliant`, `conflict` et
`error` comptent comme non conformes ; tout le reste est non évalué.

### Tableau de bord du locataire : le sous-titre Utilisateurs totaux se réconcilie

Le sous-titre de la tuile **Utilisateurs totaux** affichait auparavant
`{licensed} licenciés, {guests} invités` — ce qui omettait silencieusement
les membres non licenciés, de sorte que les deux chiffres ne s'additionnaient
pas au total (par exemple, un locataire avec 58 utilisateurs affichait
`8 licenciés, 40 invités`, laissant 10 membres non licenciés invisibles).
Le sous-titre indique désormais `{licensed} licenciés, {unlicensed} non
licenciés, {guests} invités` pour que les trois chiffres se réconcilient
toujours au total.

Le compte `licensed` dans le sous-titre exclut maintenant les invités
licenciés — utile pour comprendre la taille de l'effectif interne. La
télémétrie interne de facturation des sièges vers le serveur de licence
reste inchangée (compte toujours tous les utilisateurs licenciés, membre
ou invité) ; seul le sous-titre du tableau de bord a été resserré.

---

## Version 0.1.19 — 2026-05-25

### Correctif : instanciation MSAL de auth.js désormais paresseuse

Une installation entièrement neuve (installateur + `ENTRA_CLIENT_SECRET`
vide dans `.env` jusqu’à ce que l’assistant le collecte) faisait planter
l’application au démarrage, avant que `setupMiddleware` ne puisse
rediriger l’utilisateur vers `/setup`. Cause racine :
`new ConfidentialClientApplication(...)` de MSAL était appelé au
chargement du module dans `src/auth.js` et lance
`invalid_client_credential` sur un secret vide.

Le client MSAL unique est désormais construit paresseusement via
`getCCA()` à la première utilisation. Le module se charge proprement
avec une configuration Entra vide ; tout appel de route d’authentification
avant que l’assistant ne soit terminé échoue avec un message clair
« terminez l’assistant à /setup d’abord » au lieu de faire planter le
processus. L’export `cca` est remplacé par `getCCA` (aucun appelant
externe n’utilisait `auth.cca`).

C’était le dernier bogue qui bloquait le flux
`curl install.panoptica365.com/run` → démarrage de la pile Docker →
parcours de l’assistant → arrivée sur la Console principale. Détecté
par le test de bout en bout de la phase 4 partie A sur P365-Test, qui
est le premier chemin d’installation à avoir réellement testé une
configuration Entra entièrement vide au démarrage.

---

## Version 0.1.18 — 2026-05-25

### Assistant : étape Nom d’hôte supprimée (7 étapes maintenant)

L’assistant de configuration initiale ne demande plus le nom d’hôte ni le
courriel Let’s Encrypt. Ces valeurs sont maintenant collectées par
l’installateur de la phase 4 à `install.panoptica365.com/run` AVANT que
la pile Docker démarre — Caddy provisionne donc le TLS dès le démarrage,
et l’opérateur va directement à l’URL `https://<nom-d-hôte>/setup` avec
un TLS valide déjà en place. L’assistant passe de 8 à 7 étapes :
Bienvenue → Inscription d’application → Identifiants Entra → SMTP →
Anthropic → Licence → Premier locataire.

Les installations existantes déjà au-delà de la configuration ne sont
pas affectées. Les installations qui ont exécuté l’assistant des versions
v0.1.10 à v0.1.17 ont déjà le nom d’hôte marqué comme terminé dans leur
état de configuration ; la nouvelle liste d’étapes respecte toujours le
filet de sécurité `setup-completed-once.flag`. Le point de terminaison
hérité `/api/setup/hostname` reste dans `api-setup.js` pour la
rétrocompatibilité mais n’est plus appelé par le frontend.

---

## Version 0.1.17 — 2026-05-25

### Console principale : boîte de recherche de locataires

Le panneau des locataires sur la console principale dispose maintenant
d’une boîte de recherche juste sous l’en-tête. Tapez n’importe quelle
partie du nom d’affichage d’un locataire — la liste se filtre en temps
réel, sans tenir compte de la casse, par correspondance de sous-chaîne.
Utile lorsqu’un MSP a des dizaines (ou des centaines) de clients et doit
sauter rapidement à l’un d’eux sans faire défiler.

- **Sous-chaîne, pas préfixe.** Taper `CAE` correspond à tous les
  locataires contenant « CAE » n’importe où dans le nom, pas seulement
  ceux qui commencent par `CAE`.
- **Insensible à la casse.** `cae`, `CAE` et `Cae` retournent toutes
  les mêmes correspondances.
- **Bouton d’effacement + Échap.** Un bouton `×` apparaît dans la barre
  de recherche quand un filtre est actif ; cliquer dessus efface le
  champ et restaure la liste complète. Appuyer sur Échap pendant que la
  boîte de recherche a le focus fait la même chose.
- **Survit au rafraîchissement automatique.** Le panneau des locataires
  recharge les scores toutes les 5 minutes ; votre filtre et ce que
  vous avez tapé sont conservés à travers le rafraîchissement.
- **Le compteur reflète le filtre.** Le compteur d’en-tête passe de
  « 12 locataires » à « 3 sur 12 locataires » pendant le filtrage,
  donc il est évident combien de la liste complète est masqué.

Localisé en/fr/es.

---

## Version 0.1.16 — 2026-05-25

### Remédiation automatique CA retirée — correctif de sécurité

Le vérificateur de dérive d’accès conditionnel ne ré-applique plus
automatiquement (PATCH) les stratégies actives vers l’état du modèle,
même sur les affectations précédemment réglées à « Surveiller + Corriger ».
Il s’agit d’un correctif de sécurité.

**Pourquoi.** La liste de refus `NON_REMEDIABLE_FIELDS` ajoutée en avril
devait protéger les listes `excludeUsers` / `excludeGroups` propres au
locataire en omettant ces champs du corps du PATCH. Mais la sémantique
PATCH de Microsoft Graph sur un objet imbriqué (`conditions.users`)
**remplace tout le sous-objet** par ce qui est envoyé — donc omettre
`excludeUsers` faisait que Graph le vidait en tableau vide. Confirmé en
production le 2026-05-25 : neuf exclusions d’utilisateurs ont été effacées
sur cinq locataires dans un seul cycle de dérive, juste après que v0.1.15
ait activé la détection de dérive sur la liste d’exclusions du modèle
Canada seulement.

**Ce qui change.**

- L’ordonnanceur de dérive horaire ne fait plus que **détecter** la dérive
  et déclencher des alertes. Il ne PATCH jamais une stratégie active. La
  colonne `enforcement` est conservée pour la compatibilité ascendante
  mais n’est plus lue par le code applicatif.
- Le bouton **PASSER À SURVEILLANCE / PASSER À CORRIGER** est retiré de
  la tuile d’affectation CA. La ligne « Application » est aussi retirée.
- L’ancien bouton « CORRIGER » sur une affectation en dérive est renommé
  **POUSSER LE MODÈLE** et stylisé comme action destructrice. Le dialogue
  de confirmation avertit explicitement de la sémantique d’effacement
  d’`excludeUsers` / `excludeGroups`, pour qu’un opérateur ne puisse pas
  se faire piéger sans consentement.
- Le modal d’affectation de modèle ne demande plus de mode d’application
  — toutes les nouvelles affectations sont créées en mode surveillance
  par défaut.

**Modèle opérationnel à partir de maintenant** (correspond maintenant à
Déploiements Intune) : la dérive est détectée → l’alerte se déclenche →
l’opérateur clique soit **Accepter la dérive** pour reconnaître la
variation propre au locataire comme intentionnelle (état orange ACCEPTÉE,
supprimé par hachage), soit **Pousser le modèle** pour écraser
explicitement la stratégie active avec l’état du modèle, en acceptant
l’effacement.

**Pour les locataires affectés** : neuf exclusions d’utilisateurs chez
Calogy Solutions, Dienamex, Tatum, Thymox et Trilogiam ont été effacées
pendant la fenêtre de l’incident v0.1.15. La table `ca_drift_log` de
Panoptica365 conserve chaque GUID effacé dans `actual_value`, la
restauration consiste donc à coller les GUID dans le sélecteur
d’utilisateurs du portail Entra. Action de l’opérateur requise.

---

## Version 0.1.15 — 2026-05-25

### Détection de dérive CA : les changements de listes d’exclusion sont désormais captés

L’ajout ou le retrait d’un utilisateur/groupe de la liste **excludeUsers**
ou **excludeGroups** d’une politique d’accès conditionnel passait
silencieusement inaperçu pour la détection de dérive sur certains
modèles — le comparateur ne comparait jamais ces champs parce qu’ils ne
figuraient pas dans la liste des champs surveillés du modèle. Un opérateur
ajoutant un utilisateur exclu à une politique CA déployée (par ex. «
N’autoriser l’accès qu’à partir du Canada ») ne voyait aucune dérive,
aucune alerte, aucune entrée sur la tuile CA.

Le correctif réinjecte `conditions.users.excludeUsers` et
`conditions.users.excludeGroups` dans les champs surveillés de chaque
modèle CA au démarrage du serveur. Idempotent — les modèles qui les
contenaient déjà sont laissés intacts. Les mêmes valeurs par défaut
s’appliquaient déjà aux *nouveaux* imports de modèles depuis l’arrivée du
système d’exemptions, mais le rattrapage pour les modèles préexistants
n’existait que dans une migration SQL manuelle non câblée au démarrage —
ce qui faisait qu’une installation neuve, ou tout import postérieur au
correctif, pouvait se retrouver dans l’état cassé. Les deux chemins
convergent maintenant.

Après la mise à niveau, le prochain cycle de dérive (ou un « Vérifier la
dérive » manuel sur la tuile CA) détectera correctement les changements
de listes d’exclusion et déclenchera l’alerte informationnelle « Liste
d’exemption CA modifiée », que vous pouvez ensuite accepter comme une
exemption volontaire ou repousser via la politique en direct.

---

## Version 0.1.14 — 2026-05-24

### Modal d’inscription d’app : balises gras s’affichent + plus d’icône de copie en double

Deux petits correctifs détectés lors de la vérification de v0.1.13 sur
P365-Test :

- Trois puces dans le modal (étapes 3.5, 3.6 sur le secret client, et
  étape 1.5 sur le clic sur Inscrire) affichaient
  `<strong>Ajouter</strong>`, `<strong>Valeur</strong>` et
  `<strong>S’inscrire</strong>` comme texte HTML brut au lieu de mettre
  les mots en gras. Même correctif qu’en v0.1.12 — trois attributs
  `data-i18n` basculés en `data-i18n-html`.

- Les lignes de permissions dans le modal avaient deux icônes de copie
  côte à côte par ligne. Causé par le passage du caractère d’icône comme
  texte d’affichage du bouton en plus du span d’icône toujours présent.
  Utilise maintenant un assistant de bouton de copie icône seule dédié.

---

## Version 0.1.13 — 2026-05-24

### Assistant : guide complet d’inscription d’app Entra + bouton Tester la connexion

L’étape Entra de l’assistant de configuration initiale était le plus
long bloc manuel de l’installation — les opérateurs devaient savoir
créer eux-mêmes l’inscription d’app avec le bon paramètre multi-locataire,
les ~58 bonnes autorisations, le consentement d’administrateur et les
deux rôles RBAC pour les modules PowerShell. Facile de manquer quelque
chose et de s’en rendre compte des mois plus tard, quand une
fonctionnalité ne marche pas en silence.

Cette version ajoute une étape **Inscription d’application** dédiée avec
un grand modal contenant des instructions clic par clic détaillées :

- Le catalogue complet des 58 autorisations (47 Microsoft Graph
  application + 6 déléguées, 1 Exchange Online, 2 Management APIs, 2
  Skype/Teams), ordonné pour correspondre à l’interface du portail
  Entra, avec une icône de copie sur chaque nom d’autorisation (plus
  un bouton « tout copier » par catégorie).
- L’URI de redirection dérivée du nom d’hôte, copiable en un clic.
- Attributions de rôles du principal de service étape par étape
  (Administrateur Exchange + Administrateur de la conformité), avec
  des avertissements explicites contre les rôles aux noms similaires
  « Administrateur des destinataires Exchange » / « Administrateur des
  données de conformité » qui ont l’air bons mais ne fonctionneront pas.
- Guide pour créer les trois groupes RBAC (Panoptica365 Admins /
  Operators / Viewers) avec des noms suggérés correspondant à la
  nomenclature interne des rôles de Panoptica365, plus boutons de copie.
- Encadrés codés en couleur : rouge pour les pièges « ne pas faire »,
  ambre pour les étapes faciles à manquer, vert pour les indices
  « vous devriez voir » de confirmation.
- Lien « J’ai déjà une inscription d’app — passer » pour les opérateurs
  qui ont provisionné via PowerShell ou qui réinstallent.

L’étape de collage des identifiants a maintenant :

- Trois champs d’ID de groupe (Admins / Operators / Viewers) au lieu
  d’uniquement l’admin, avec admin marqué recommandé et les deux autres
  facultatifs.
- Un bouton **Tester la connexion** qui acquiert un jeton applicatif
  et lance ~9 appels Graph représentatifs en parallèle. Si la demande
  de jeton échoue, il diagnostique les codes d’erreur Microsoft courants
  (AADSTS7000215 = mauvaise valeur de secret collée, AADSTS90002 =
  mauvais ID de locataire, etc.). Si le jeton fonctionne mais que les
  appels Graph retournent 403, il liste exactement quelles autorisations
  sont manquantes (la cause la plus fréquente est « oublié de cliquer
  sur Accorder le consentement de l’administrateur »).
- Un lien « Rouvrir le modal d’instructions d’inscription d’app » au cas
  où l’opérateur doit revérifier une étape.

Entièrement localisé en/fr/es.

---

## Version 0.1.12 — 2026-05-24

### Assistant : les liens et blocs de code intégrés s'affichent correctement

Plusieurs descriptions de l'assistant font référence à Entra
(entra.microsoft.com), à la console Anthropic, à des exemples de noms
d'hôte et au format de clé d'activation `PNX-...`. Ces liens `<a>` et
fragments `<code>` étaient affichés sous forme de texte HTML brut. Le
rendu utilise maintenant le bon mode innerHTML pour les clés i18n
contenant du balisage.

(Détecté lors de la vérification du peaufinage de v0.1.11 sur P365-Test.)

---

## Version 0.1.11 — 2026-05-24

### Peaufinage de l'assistant

Deux petits correctifs détectés lors de la vérification de bout en bout
sur P365-Test (v0.1.10) :

- **Le bouton Retour préserve désormais les valeurs saisies.** Les
  champs du formulaire (y compris les longs GUID Entra, le serveur,
  l'utilisateur et le mot de passe SMTP, la clé Anthropic et la clé
  d'activation de licence) ne sont plus réinitialisés lorsque vous
  cliquez sur Retour. Les valeurs sont mémorisées lors de la navigation
  entre les étapes au sein de la même session d'assistant.

- **Bandeau d'en-tête redessiné.** L'assistant dispose maintenant d'un
  bandeau chromé pleine largeur en haut, avec un logo Panoptica365 bien
  visible et le sélecteur de langue, dans le style visuel de l'en-tête
  de l'application principale. Remplace le petit logo flottant qui
  était peu visible sur le fond sombre.

---

## Version 0.1.10 — 2026-05-24

### Assistant de configuration initiale

Les nouvelles installations démarrent maintenant dans un assistant web
guidé de 7 étapes plutôt que d'exiger une édition manuelle du fichier
`.env` et un appel `curl` d'activation de licence. L'assistant guide
les opérateurs à travers le nom d'hôte et TLS, l'inscription
d'application Entra, le SMTP avec envoi de test, la clé API Anthropic
avec appel de test, l'activation de licence contre le serveur de
licence et un onboarding facultatif du premier locataire.

Les installations existantes sont détectées automatiquement — si un
`LICENSE_TOKEN` valide est déjà présent dans `.env`, la configuration
est marquée comme terminée rétroactivement et l'assistant n'apparaît
jamais. Aucune action requise pour les opérateurs actuels.

L'assistant est entièrement localisé en anglais, français québécois et
espagnol. Les opérateurs choisissent la langue via le sélecteur en haut
à droite ; le choix se reporte sur leurs préférences d'opérateur une
fois la configuration terminée.

---

## Version 0.1.9 — 2026-05-24

### Les images de conteneur proviennent maintenant du GitHub Container Registry

Les nouvelles installations clients ne construisent plus l'image
Panoptica365 à partir du code source. L'image Docker publiée est désormais
publiquement disponible à `ghcr.io/panoptica365/app:latest`, et
`docker-compose.yml` la récupère directement. Il s'agit du prérequis pour
l'installateur de la phase 4 (`install.panoptica365.com/run`, à venir sous
peu) — une commande d'installation d'une ligne permettra de monter une
pile Panoptica365 fonctionnelle sur un hôte Ubuntu vierge en quelques
minutes, sans environnement de développement.

Les installations existantes ne voient aucun changement de comportement.
Pour ceux qui itèrent sur le code source local en mode développement, le
bloc `build:` du fichier compose est conservé — `docker compose build &&
docker compose up` fonctionne exactement comme avant.

---

## Version 0.1.8 — 2026-05-24

### Validation de licence

Panoptica365 exige désormais une licence valide pour démarrer. Chaque
installation s'active une fois contre `license.panoptica365.com` pour
échanger une clé d'activation contre un jeton signé, puis renouvelle ce
jeton chaque semaine pour rester à jour. Le serveur de licence n'est
contacté que pour l'activation et le renouvellement — la vérification
quotidienne est entièrement hors ligne, donc une panne du serveur de
licence ne peut pas mettre votre installation hors service.

L'activation est unique par installation. Une fois que l'installateur (ou
un `curl` contre `/api/v1/activate`) a déposé le jeton dans `.env`, le
démarrage le vérifie et conserve une copie de sauvegarde dans
`data/state/license-cache.json`, de sorte qu'un effacement accidentel de
`.env` ne vous coûte jamais de temps d'arrêt.

### Bannière d'expiration

Si une licence payante dépasse sa date d'expiration, une bannière apparaît
en haut de page — ambre pendant la période d'avertissement de 14 jours,
légèrement plus foncée pour les jours 15 à 21 lorsque l'ajout de nouveaux
locataires, modèles Intune et modèles d'accès conditionnel est désactivé,
puis rouge à partir du jour 22 lorsque l'installation passe en mode
lecture seule. Les licences NFR ne voient jamais la bannière, car elles
sont perpétuelles par conception.

Le texte de la bannière et le bouton **Contactez license@panoptica365.com**
sont entièrement localisés en anglais, en français québécois et en
espagnol.

### Ce qui NE change PAS

Les alertes existantes, l'interrogation, la détection de dérive, les
paramètres de sécurité, les rapports et toutes les autres fonctionnalités
continuent exactement comme avant. La validation de licence est une couche
mince au niveau du démarrage et d'un middleware — elle ne touche à aucun
comportement opérationnel sur une licence en règle.

---

## Version 0.1.7 — 2026-05-22

### Voir les nouveautés — dans l'application

L'en-tête comporte désormais un menu **Quoi de neuf** (cliquez sur votre nom
en haut à droite). Chaque version place ses faits saillants à un clic — la
version la plus récente s'affiche par défaut, avec un onglet déroulant
**Versions antérieures** pour consulter l'historique complet.

Vous verrez aussi un petit point non lu à côté de votre nom dès qu'il existe
une version que vous n'avez pas encore consultée, et une notification unique
au premier chargement après une mise à jour — pour qu'aucune nouvelle
version ne vous échappe.

Deux autres petits ajouts dans la même zone : le bouton **Se déconnecter** a
été intégré au même menu déroulant (à côté de Préférences), et la version
actuelle de l'application est désormais affichée au bas de la barre latérale
gauche.

---

## Version 0.1.6 — 2026-05-22

### Nouveau rapport — Évaluation rapide

Un nouveau type de rapport est disponible sous **Rapports → Évaluation
rapide**. Alors que le rapport Documentation de configuration est un
instantané purement factuel, l'Évaluation rapide est un rapport *consultatif*
: il prend la configuration actuelle d'un locataire et la passe à une analyse
approfondie par IA qui met en lumière les forces, les faiblesses et — surtout
— **ce qui manque**.

Il passe en revue l'Accès conditionnel, Intune et l'ensemble des paramètres
de sécurité, et signale les écarts par rapport aux références recommandées
par Microsoft : politiques d'Accès conditionnel manquantes, politiques Intune
absentes ou faibles, paramètres de sécurité qui ont dérivé de leur état
recommandé. Lorsque Panoptica365 dispose déjà d'un modèle capable de combler
une lacune, la recommandation est signalée comme un déploiement en un clic —
et un écart est tout de même rapporté même si aucun modèle n'existe pour le
combler.

Lorsque vous cliquez sur **Générer le rapport**, une boîte apparaît dans
laquelle vous pouvez ajouter du contexte en texte libre pour l'analyse — le
type d'entreprise du client, ses préoccupations connues, tout élément que
l'analyse doit prendre en compte (vous pouvez y coller des notes). Le rapport
est un instantané ponctuel — sans plage de dates — et il est disponible pour
les locataires en mode audit uniquement, ce qui en fait un livrable naturel
pour un engagement d'essai.

### « Interroger maintenant » ne signale plus d'expiration erronée

Le déclenchement d'une interrogation à la demande d'un locataire — surtout
s'il vient d'être ajouté, où la première interrogation doit tout récupérer —
pouvait afficher une erreur « Échec de l'interrogation : HTTP 504 » alors
même que l'interrogation se poursuivait et se terminait avec succès.

Les interrogations à la demande s'exécutent désormais en arrière-plan.
L'interrogation démarre immédiatement, le tableau de bord conserve son état
« Sondage… », et la page se rafraîchit d'elle-même dès que l'interrogation
se termine (ou signale une erreur claire si elle échoue réellement). Une
interrogation de longue durée ne peut plus déclencher d'expiration de la
passerelle.

### Les rapports PDF se génèrent désormais sur les installations serveur

La génération d'un rapport de Documentation ou de Posture de sécurité d'un
locataire pouvait échouer sur une installation serveur avec une erreur
« No module named … » — le programme d'installation n'aprovisionnait pas les
bibliothèques Python (ReportLab, matplotlib) dont dépendent les générateurs
PDF. Le script d'installation crée maintenant un environnement Python dédié
avec ces bibliothèques, de sorte que la génération de rapports PDF fonctionne
dès l'installation.

### L'ajout d'un nouveau locataire est désormais fiable dès la première tentative

L'intégration d'un tout nouveau locataire pouvait échouer dès la première
tentative avec une erreur de consentement — l'application Panoptica365
finissait enregistrée dans le locataire client avec ses permissions
accordées, mais le locataire n'apparaissait pas dans votre liste, vous
obligeant à exécuter **Ajouter un locataire** une seconde fois pour qu'il
s'affiche.

La cause : le point de terminaison de consentement administrateur de
Microsoft échouait par intermittence à la redirection lorsque des permissions
pour deux API différentes (Microsoft Graph et l'API d'administration Teams)
étaient demandées dans un même consentement — alors même que le consentement
lui-même avait réussi. Ajouter un locataire les demande maintenant en deux
étapes de consentement distinctes : la première enregistre le locataire, la
seconde accorde les permissions d'administration Teams. Une défaillance à la
première tentative ne se produit plus. Vous verrez deux écrans de
consentement Microsoft pendant l'ajout d'un locataire au lieu d'un, et le
locataire est enregistré après le premier, quel que soit le résultat du
second.

---

## Version 0.1.5 — 2026-05-21

### Suppressions plus propres des locataires en mode audit uniquement

Lorsqu'un locataire en mode audit uniquement atteint la fin de son cycle de
vie de 21 jours et est automatiquement nettoyé de Panoptica365, l'opérateur
reçoit un courriel récapitulatif confirmant ce qui a été supprimé.
Auparavant, ce courriel pouvait inclure un avertissement parasite « 1 erreur
lors de la cascade » qui faisait référence à une table de catalogue de règles
globales que le nettoyage n'avait jamais besoin de toucher. L'avertissement
était visuellement alarmant mais n'avait aucun effet sur le nettoyage réel.

L'inventaire de nettoyage a été corrigé. Les futures suppressions de
locataires en mode audit uniquement signaleront zéro erreur dans le courriel
récapitulatif — ce que vous voyez dans le courriel correspond désormais à ce
qui s'est réellement passé.

### Document de conception du mode audit uniquement mis à jour

Le document de conception à `Documentation/Audit-Only-Tenant-Mode.docx` a été
enrichi d'une annexe d'état en date du 2026-05-21. L'annexe consigne la
validation en production de bout en bout sur le premier locataire payant en
mode audit (consentement → interrogation → exportation d'instantané →
courriel d'avertissement à 14 jours → suppression en cascade à 21 jours +
rappel de révocation), le balayage d'intégration ajouté le 29 avril pour
exclure les locataires en mode audit des alertes/IA/notifications/
vérifications de santé, l'extraction Graph en direct ajoutée au regroupeur
d'instantanés le même jour, et la correction de l'inventaire de cascade
ci-dessus.

---

## Version 0.1.4 — 2026-05-21

### Basculement rapide entre locataires depuis le tableau de bord

L'en-tête du tableau de bord du locataire inclut désormais un **sélecteur de
locataire** — une liste déroulante répertoriant tous vos locataires, à
l'emplacement où se trouvait auparavant le nom du locataire.

- Passez directement du tableau de bord d'un locataire à celui d'un autre
  sans revenir à la console principale et choisir un locataire dans la liste.
- Votre onglet actuel est conservé lors du basculement. Si vous consultez
  les **Politiques Intune** d'un locataire, choisir un autre locataire vous
  amène directement aux **Politiques Intune** de ce locataire — et il en va
  de même pour les onglets Vue d'ensemble, Alertes, Politiques AC et
  Journal des modifications.

Cela élimine plusieurs clics dans la tâche courante de passer en revue la
même zone sur plusieurs locataires.
