# Quoi de neuf dans Panoptica365

Notes de version destinées aux clients. Chaque version ci-dessous décrit ce
qui a changé dans cette version, les plus récentes en premier.

---

## Version 0.3.2 — 2026-07-02

### Correctif : fausses alertes « politique supprimée » lors de la limitation de débit Microsoft

Dans de rares conditions, lorsque les serveurs de Microsoft limitaient le débit des lectures de Panoptica suffisamment longtemps (par exemple lors d'un pic d'activité juste après un redémarrage, ou lors d'un ralentissement du service Microsoft), une lecture des politiques Intune d'un locataire pouvait revenir vide et être interprétée à tort comme si ces politiques avaient été **supprimées** du locataire. Cela déclenchait de fausses alertes *« Tenant-sourced Intune policy was removed from the tenant outside Panoptica »* — y compris leurs notifications par courriel et leurs billets PSA — alors que rien n'avait changé dans le locataire.

C'est maintenant corrigé à la racine, dans la couche de lecture Microsoft Graph partagée par tous les moniteurs : une lecture qui épuise ses tentatives face à la limitation de débit, ou qui reçoit une réponse malformée, est désormais traitée comme une **lecture échouée à reprendre au prochain cycle** — jamais comme un locataire vide. De plus, le moniteur des politiques provenant du locataire ne signale une politique comme supprimée que si sa catégorie a réellement pu être lue pendant ce cycle, de sorte qu'une lecture partielle ne peut jamais être interprétée comme une suppression massive.

Aucune configuration de locataire n'a jamais été touchée par ce problème, et les suppressions réelles sont toujours détectées exactement comme avant. Si vous avez reçu une série de ces alertes, marquez-les comme faux positifs — les fiches de politiques concernées se rétablissent d'elles-mêmes à la prochaine vérification horaire.

---

## Version 0.3.1 — 2026-07-02

### Correctif : erreur « module non prêt » lors de la soumission d'un déploiement

Sur certaines installations, le tout premier démarrage après la mise à jour vers 0.3.0 pouvait laisser la nouvelle fonctionnalité Déploiements à moitié initialisée : les groupes de locataires et les ensembles fonctionnaient, mais la soumission d'un déploiement échouait avec « Bundle-deploy module not ready — schema migration failed. » Il s'agissait d'une course ponctuelle entre les migrations de base de données au premier démarrage. C'est maintenant corrigé à la racine — les migrations sont explicitement ordonnées et, si quelque chose interrompt malgré tout un premier démarrage, le module se répare désormais de lui-même à la prochaine utilisation au lieu de rester bloqué jusqu'à un redémarrage. Si vous avez vu cette erreur sur 0.3.0, la mise à jour vers 0.3.1 (ou un simple redémarrage de l'application) la fait disparaître.

---

## Version 0.3.0 — 2026-07-02

### Groupes de locataires — organisez votre flotte et filtrez chaque vue

Vous pouvez désormais regrouper les locataires comme vous pensez votre portefeuille. Créez des **groupes manuels** (choisissez les membres dans une liste) ou des **groupes dynamiques** dont l'appartenance suit une règle — niveau de service et/ou représentant — et reste à jour d'elle-même quand les locataires changent. Les briques de base sont deux nouvelles listes gérées dans les **Paramètres** : **Niveaux de service** et **Représentants**, attribués à chaque locataire depuis sa fenêtre de modification. Un nouveau filtre **Groupe de locataires** sur la **Carte thermique** et les **Tendances** limite ces vues à n'importe quel groupe — un représentant voit ses propres comptes en un clic.

### Ensembles de configuration — votre base de référence en paquet réutilisable

Un **ensemble de configuration** est une collection nommée de stratégies d'accès conditionnel et de paramètres Intune tirés de vos bibliothèques de modèles, avec les choix par élément enregistrés dans l'ensemble : chaque stratégie d'accès conditionnel est marquée **Rapport uniquement** (le choix sûr par défaut) ou **Activé (appliqué)**, et chaque paramètre Intune porte sa cible d'attribution (Aucune / Tous les utilisateurs / Tous les appareils) ainsi qu'un remplacement facultatif du routage des alertes. Construisez l'ensemble une fois dans la nouvelle section **Déploiements**, puis déployez-le autant de fois que vous le souhaitez.

### Déploiements — déploiement de flotte avec vérifications préalables obligatoires

La nouvelle page **Déploiements** (menu Stratégies) déploie un ensemble vers un ou plusieurs locataires — ou vers des groupes entiers, chaque locataire compté une seule fois — en une seule tâche. La sécurité fait partie du flux et ne peut pas être contournée : **Soumettre** ne fait que créer la tâche et exécuter des vérifications préalables déterministes (consentement valide, détection des éléments déjà présents, garde des locataires gérés, avertissements de changement de cible d'attribution) ; rien n'est écrit tant que vous n'avez pas examiné les résultats et appuyé sur **Déployer** sur la tâche vérifiée. Les éléments déjà présents sur un locataire sont ignorés par défaut — l'écrasement est un choix explicite, par élément ou en une seule action. L'onglet **File des tâches** présente chaque tâche comme un registre repliable Tâche ▸ Locataire ▸ Paramètre avec la progression en direct et les résultats par élément, et sert aussi d'historique de déploiement. Les écritures elles-mêmes sont prudentes par conception : un paramètre à la fois dans chaque locataire, un rythme mesuré entre les locataires, et l'échec d'un locataire n'arrête jamais les autres. Les stratégies déployées par ensemble atterrissent exactement comme si vous les aviez déployées à la main depuis le tableau de bord du locataire — mêmes enregistrements, même surveillance de dérive — et chaque étape figure dans le journal d'audit.

### Nouveau guide dans le centre d'apprentissage

Un nouveau guide **Ensembles de configuration** parcourt toute la fonctionnalité — groupes de locataires, ensembles et flux de déploiement — offert dans les trois langues.

---

## Version 0.2.32 — 2026-07-01

### Choisissez votre canal de versions : Stable ou Anticipé

Panoptica365 vous permet désormais de décider quel flux de versions cette installation suit. Une nouvelle carte **Paramètres de versions**, dans les **Paramètres**, offre deux choix. **Stable** (par défaut) livre chaque mise à jour après qu'elle a fonctionné quelques jours sur les installations anticipées — le bon choix pour presque tout le monde. **Anticipé** livre les nouvelles versions avant qu'elles ne soient largement testées, pour les opérateurs qui veulent aider à valider les mises à jour et peuvent tolérer quelques imperfections occasionnelles. Le paramètre s'applique à toute l'installation et est réservé aux administrateurs. Le changement prend effet immédiatement : il ne modifie que la version à laquelle la bannière *« mise à jour disponible »* se compare — les mises à jour sont toujours appliquées par vous depuis la bannière, jamais automatiquement. Si une version anticipée cause un problème, vous pouvez revenir à **Stable** ici en tout temps.

### Navigation allégée — la Sécurité vit dans chaque locataire

Les paramètres de sécurité par locataire se trouvent maintenant uniquement dans l'onglet **Sécurité** de chaque locataire; l'entrée de menu **Sécurité** de premier niveau, devenue redondante, a donc été retirée. Rien n'est perdu : ouvrez un locataire et choisissez l'onglet **Sécurité** pour retrouver les mêmes paramètres, vérifications et actions — désormais avec le contexte complet de ce locataire.

---

## Version 0.2.31 — 2026-06-30

### Analyse IA plus fine, maintenant propulsée par Claude Sonnet 5

Les analyses IA approfondies de Panoptica365 utilisent désormais **Claude Sonnet 5**, le plus récent modèle Sonnet d'Anthropic, en remplacement de Claude Sonnet 4.6. C'est le modèle derrière les fonctions qui interprètent votre environnement et l'expliquent en langage clair : le **triage des applications** connues-bonnes, la chronologie de **corrélation des menaces d'identité**, le **résumé des alertes** sur 24 heures, le texte du rapport **Posture de sécurité** et les résumés d'**authentification du courriel**. Sonnet 5 offre un raisonnement plus solide et un jugement mieux calibré, de sorte que ces verdicts et ces textes sont plus exacts. Rien ne change dans votre utilisation de Panoptica365 — les mêmes actions produisent simplement une meilleure analyse.

---

## Version 0.2.30 — 2026-06-29

### Les alertes de consentement OAuth sont plus claires — et n'inondent plus

Lorsqu'un utilisateur ou un administrateur consent à une application, l'alerte nomme désormais l'**application** à laquelle l'accès a été accordé et la **ressource** qu'elle peut atteindre — par exemple *« …a consenti à Acme Mail Connector pour l'accès à Microsoft Graph »* — au lieu d'une chaîne illisible d'identifiants Microsoft. Les consentements identiques répétés du même utilisateur à la même application sont maintenant **regroupés en une seule alerte** avec un compteur de récurrence, plutôt que de créer une nouvelle ligne chaque fois — ainsi, une application qu'un utilisateur réapprouve sans cesse n'ensevelit plus le tableau de bord. Le consentement utilisateur courant à des autorisations sûres est maintenant de gravité **faible** (il était moyen) ; un consentement administrateur, ou tout consentement demandant une autorisation à risque élevé, demeure **élevé** ou **grave**. Et une escalade — le même utilisateur et la même application passant au consentement administrateur ou demandant une autorisation à risque — déclenche toujours une nouvelle alerte signalée séparément, au lieu d'être absorbée discrètement dans l'alerte courante.

### Ajouter des alertes à un regroupement existant

Les regroupements permettent de réunir des alertes connexes sous un même élément pour les examiner ensemble. Jusqu'ici, vous ne pouviez regrouper des alertes qu'au moment de créer le regroupement. Vous pouvez maintenant **ajouter d'autres alertes à un regroupement ouvert existant**, à deux endroits : sélectionnez des alertes dans la liste et choisissez **Ajouter au regroupement**, ou ouvrez un regroupement et utilisez **Ajouter des alertes** pour choisir parmi les alertes ouvertes de ce client. Les alertes ajoutées y sont intégrées exactement comme lors d'une fusion, la gravité du regroupement augmente si une alerte plus grave s'y joint, et tout billet PSA lié est mis à jour sur place au lieu d'en ouvrir un nouveau. Un seul client à la fois ; offert aux opérateurs Membre et Administrateur.

### Mettre en sourdine une alerte d'expiration d'identifiant en attendant un tiers

Lorsque Panoptica365 signale qu'un secret client ou un certificat d'une application a expiré ou est sur le point d'expirer, la correction échappe parfois à votre contrôle — par exemple le greffon de messagerie WordPress d'un client dont seul son agence web peut renouveler le secret. Jusqu'ici, cette alerte revenait à chaque sondage. Vous pouvez maintenant cliquer sur **Créer une exception** sur une alerte d'expiration d'identifiant, ajouter une note (p. ex. *« client avisé, en attente de leur agence web »*), et elle cesse de se redéclencher — pour **cet identifiant uniquement**. Toutes les autres applications et tous les autres identifiants continuent d'alerter, et lorsque l'identifiant est enfin renouvelé, le remplaçant est suivi séparément et avertira à sa propre expiration. Révoquez l'exception à tout moment depuis la page Exemptions.

---

## Version 0.2.29 — 2026-06-29

### Guides opérateur mis à jour pour la dernière version

Les **Guides Panoptica365** du carrefour Apprendre sont maintenant à jour avec les dernières versions. Les guides Accès conditionnel et Intune décrivent la nouvelle importation groupée par fichier (avec gestion des noms en double et résultats par élément), la surveillance de dérive sur la stratégie entière, les vérifications horaires des stratégies adoptées, et l'acceptation de l'état actuel d'une stratégie dérivée comme nouvelle référence. Le guide des paramètres de sécurité reflète le modèle de conformité en un coup d'œil, où un paramètre passe au vert de lui-même dès qu'il correspond, **Appliquer** et **Accepter l'état actuel comme référence** étant les deux actions. Les guides d'alertes ajoutent les nouveaux types d'alertes — expiration de secret/certificat d'application, un utilisateur bloqué pour l'envoi de courrier, et les nouvelles stratégies non gérées découvertes — ainsi que la **Créer une exception** en un clic pour le pourriel entrant déjà bloqué. Les guides du tableau de bord, des applications, des rapports et des exemptions intègrent le stockage en GB, l'onglet **Audits** de SharePoint, les badges d'expiration d'identifiant, et la liste plus complète des administrateurs dans le rapport de Documentation de configuration. Le guide du tableau de bord couvre désormais les dix onglets, et un tout nouveau guide **Authentification des courriels** explique l'onglet Auth. courriel — le SPF, le DKIM et le DMARC de chaque domaine, notés et surveillés contre la dérive. Tous les guides sont mis à jour en français, en anglais et en espagnol.

---

## Version 0.2.28 — 2026-06-28

### L'importation d'un lot de modèles de stratégies Intune n'échoue plus

L'importation d'un export complet de stratégies de configuration Intune — par exemple un ZIP de onze stratégies — dans votre bibliothèque de modèles échouait auparavant avec **« Échec de l'importation : HTTP 500 »**, et il fallait les importer une à la fois. Panoptica365 importe désormais le lot par petits groupes : un ZIP volumineux passe en une seule action, avec un indicateur de progression **« Importation de X sur Y… »** en direct. Si une stratégie ne peut pas être importée, les autres réussissent quand même : la fenêtre d'importation reste ouverte et indique exactement quelles stratégies ont échoué et pourquoi — par exemple *« La stratégie est trop volumineuse pour être importée »* — afin que vous puissiez réessayer uniquement celles-ci en un clic au lieu de tout recommencer. Cela ne concerne que la bibliothèque de modèles de Panoptica365 ; vos locataires clients ne sont pas touchés.

### L'importation d'accès conditionnel, simplifiée

L'importation de modèles d'accès conditionnel fonctionne désormais comme celle d'Intune : téléversez un **ZIP** exporté (ou le fichier JSON d'une seule stratégie), choisissez les stratégies à importer, et elles sont ajoutées par lots robustes — avec progression en direct, résultats par élément et réessai en un clic. Le nom et la description du modèle proviennent directement de chaque stratégie; il n'y a donc plus de formulaire à remplir. Lorsque le ZIP provient d'un locataire géré par Panoptica365, les références aux emplacements nommés sont automatiquement converties en espaces réservés portables.

### La détection de dérive d'accès conditionnel surveille toute la stratégie

Auparavant, vous choisissiez *quels champs* d'une stratégie d'accès conditionnel surveiller. Désormais, Panoptica365 surveille la **stratégie entière** — exactement comme pour Intune — et signale tout changement significatif, en ignorant le bruit comme les identifiants internes et les horodatages. Rien à configurer. **À noter :** comme une plus grande partie de chaque stratégie est maintenant comparée, les affectations existantes peuvent faire apparaître une dérive sur des champs qui n'étaient pas surveillés auparavant (emplacements, contrôles de session, risque de connexion/utilisateur, plateformes…), et toute dérive que vous aviez déjà *acceptée* peut réapparaître une fois — il suffit de l'accepter à nouveau pour l'effacer.

### Les stratégies adoptées sont désormais vérifiées toutes les heures

Lorsque vous adoptez une stratégie d'accès conditionnel ou Intune qui existe déjà dans un locataire, Panoptica365 en surveille les modifications. Cette vérification s'exécute maintenant **toutes les heures** au lieu d'une fois par jour : un changement affaiblissant une stratégie adoptée est détecté dans l'heure plutôt que le lendemain. Les nouvelles stratégies qui apparaissent dans un locataire sont prises en compte lors de ce même passage horaire : chacune devient une carte surveillée et déclenche une seule alerte **« nouvelle stratégie apparue »** à examiner — ainsi, une stratégie ajoutée en dehors de Panoptica365 n'est jamais silencieusement considérée comme normale.

### Accepter l'état actuel d'une stratégie adoptée comme nouvelle référence

Lorsqu'une stratégie adoptée a dérivé et que vous estimez le changement intentionnel, vous pouvez désormais cliquer sur **Accepter comme référence** sur sa carte. Panoptica365 enregistre l'état actuel comme nouvelle référence surveillée, efface la dérive et résout l'alerte — puis surveille par rapport à cet état. Cela ne met à jour que l'enregistrement de Panoptica365 ; rien n'est écrit dans le locataire. La réimportation de vos paramètres existants ne déplace jamais une référence d'elle-même, de sorte qu'un changement silencieux ne peut pas s'y glisser.

### L'importation d'un modèle qui existe déjà vous demande quoi faire

Si vous importez une stratégie dont le nom correspond à un modèle que vous possédez déjà, Panoptica365 ne crée plus de doublon silencieux. Il s'arrête et vous laisse choisir, pour chaque conflit : **importer comme nouvelle copie** (l'original reste intact) ou **écraser** le modèle existant. Si le modèle à écraser est déjà déployé sur des locataires, vous êtes averti du nombre — l'écrasement modifie leur référence de conformité et les signale en dérive jusqu'au redéploiement, qui demeure une étape distincte et délibérée.

### Nouvelle alerte : un compte bloqué pour l'envoi de courrier (compromission possible)

Lorsque Microsoft bloque l'un des comptes d'un locataire pour l'envoi de courrier parce que son volume sortant a dépassé les seuils anti-pourriel, il s'agit presque toujours d'un compte compromis utilisé pour envoyer du pourriel ou de l'hameçonnage. Panoptica365 signale désormais cela comme une alerte dédiée de **gravité élevée**, avec sa propre explication et sa marche à suivre, au lieu de la fondre dans une alerte « Defender » générique. Cela fonctionne avec Business Premium — Defender pour Office 365 P2 n'est pas requis. Les autres alertes Microsoft Defender sont inchangées.

---

## Version 0.2.27 — 2026-06-27

### Les réglages de sécurité affichent maintenant la conformité réelle d'un coup d'œil

Sur la page Tenant Security, le voyant d'état d'un réglage reflète désormais la configuration **réelle** du locataire à chaque vérification — et non plus seulement le fait que vous ayez cliqué sur **Apply** ou **Match Current** dans Panoptica365. Un réglage déjà correctement configuré (par exemple le journal d'audit unifié déjà activé) s'affiche maintenant en **vert**, sans aucune action requise, au lieu de rester en gris jusqu'à une modification inutile.

Le voyant a quatre états clairs : **vert** — conforme à la valeur recommandée, ou à une valeur que vous avez explicitement acceptée comme référence; **orange** — une valeur lisible qui s'écarte du réglage recommandé et n'a jamais été acceptée, un simple signal à examiner (sans alerte); **gris** — rien de lisible à évaluer, donc rien à surveiller (sans alerte); **rouge** — un réglage qui était conforme et qui a depuis dérivé, le seul cas qui déclenche une alerte de dérive. L'action **Accept** est maintenant offerte sur l'orange comme sur le rouge : elle adopte la valeur actuelle comme référence surveillée, pour les locataires qui exécutent volontairement une valeur différente. L'ajout d'un nouveau locataire ne produit jamais de fausses alertes à sa première vérification.

---

## Version 0.2.26 — 2026-06-27

### Les audits SharePoint sont maintenant des tâches en arrière-plan suivies, avec un onglet Audits

Les audits de bibliothèques SharePoint ne bloquent plus l'écran et ne vous redirigent plus vers le résultat à la fin — lancer un audit le met simplement en file et vous laisse où vous êtes, ce qui permet d'en enchaîner plusieurs. Un nouvel onglet **Audits** dans la section SharePoint affiche chaque tâche d'audit — en cours, en file, et récemment terminée, en échec ou annulée — avec sa progression, ses horodatages et la personne qui l'a lancée, de sorte que rien n'est perdu une fois que vous changez de page. Vous pouvez auditer une seule bibliothèque, **toutes les bibliothèques d'un site**, ou **tous les sites d'un locataire** en une seule action, chacune avec une confirmation proportionnée à l'ampleur de l'opération. Les tâches s'exécutent quelques-unes à la fois en arrière-plan pour ne jamais ralentir la surveillance de sécurité, réessaient automatiquement lorsque Microsoft Graph limite le débit, et reprennent après un redémarrage. Vous pouvez annuler les tâches en file (une ou toutes) et relancer une tâche en échec, et une case **Afficher les tâches de tous les locataires** permet de suivre les audits sur l'ensemble de vos locataires gérés d'un seul coup d'œil.

### Inventaire SharePoint : date du dernier audit, et rapports dans la langue du locataire

L'inventaire SharePoint affiche désormais une **date du dernier audit** pour chaque site et bibliothèque (ou « Jamais » s'il n'a pas été audité). Les deux rapports de permissions SharePoint (permissions de bibliothèque et permissions par utilisateur) sont maintenant produits dans la langue configurée de chaque locataire — français, anglais ou espagnol — comme les autres rapports de Panoptica.

### Rapport PDF des permissions SharePoint : plus de lignes qui se chevauchent

Dans l'export PDF des permissions, les entrées dont la source de permission s'étend sur trois ou quatre lignes ne chevauchent plus la ligne suivante — la hauteur des lignes est maintenant dynamique et le texte se replie proprement dans la cellule. Les identifiants de groupe bruts qui apparaissaient parfois dans le PDF sont remplacés par une étiquette lisible, afin que les rapports destinés aux clients n'affichent aucun identifiant interne.

### Alerte préventive d'expiration des secrets et certificats d'applications

Panoptica surveille désormais les secrets clients et les certificats des inscriptions d'applications de vos locataires et vous avertit avant qu'ils n'expirent — à 30 jours, de nouveau à 7 jours, et une fois expirés (une seule alerte par identifiant, pour ne jamais vous inonder). L'expiration est aussi affichée directement dans l'onglet **Applications** : une pastille sur la ligne de l'application, la date mise en évidence dans le détail, et un compteur dans le résumé de l'onglet — afin que vous puissiez renouveler un identifiant à votre rythme plutôt que de le découvrir le matin où une intégration cesse de fonctionner.

---

## Version 0.2.25 — 2026-06-27

### Faites taire en un clic les alertes « déjà traitées »

Microsoft bloque une grande quantité de pourriels, de maliciels et d'hameçonnage entrants avant même qu'ils n'atteignent une boîte aux lettres — et jusqu'ici, chacun générait tout de même une alerte, encombrant le tableau de bord d'éléments ne nécessitant aucune action. Vous pouvez maintenant cliquer sur **Créer une exception** pour une telle alerte et choisir de la faire taire pour **ce locataire seulement** ou pour **tous les locataires gérés**. L'exception envoie immédiatement les alertes ouvertes correspondantes à l'historique et résout automatiquement les suivantes, tout en laissant le reste se déclencher comme avant — y compris le pourriel sortant d'un compte compromis, qui relève d'une autre politique et constitue un véritable signal de compromission de compte. Les exceptions sont permanentes jusqu'à ce que vous les révoquiez sur la page **Exemptions**, où elles apparaissent avec leur portée afin que vous puissiez les revoir ou les supprimer à tout moment.

### Le rapport de documentation de configuration liste maintenant tous les administrateurs

Le rapport de documentation de configuration ne listait auparavant que les administrateurs globaux. Il liste désormais **tout compte détenant un rôle d'administration** — Exchange, SharePoint, Teams, Intune, administrateur d'utilisateurs, du service d'assistance et plus encore — avec les rôles qu'il détient, l'état du compte (activé ou non) et son statut MFA. Le nombre d'administrateurs globaux demeure affiché comme valeur sommaire. (Note : le rapport affiche les rôles activement attribués ; les attributions admissibles via PIM mais non activées ne sont pas listées.)

### Aperçu du stockage SharePoint — totaux exacts

L'aperçu du stockage SharePoint surévaluait le stockage. Comme les bibliothèques de documents d'un site partagent un même espace de stockage, le stockage de chaque site était compté une fois par bibliothèque puis additionné, gonflant le total du locataire. Chaque site apparaît maintenant **une seule fois**, avec son stockage réel et le nombre de ses bibliothèques, et les barres indiquent la part de chaque site dans le total corrigé au lieu de toujours remplir la barre pour le plus gros site.

### Corrections mineures

Les valeurs de stockage des panneaux « principaux utilisateurs » et « principales boîtes aux lettres » du tableau de bord du locataire s'affichent maintenant en gigaoctets plutôt qu'en mégaoctets bruts. Le message de vérification de l'état de l'écran de mise à jour intégré est plus clair. Et en mode sombre, les titres de version de la fenêtre Quoi de neuf ne sont plus en sombre sur sombre.

---

## Version 0.2.24 — 2026-06-24

### Rapports — révisés et peaufinés

Nous avons passé en revue les trois rapports — le **rapport de posture de sécurité**, l'**évaluation rapide** et la **documentation de configuration** — et les avons révisés et peaufinés en anglais, en français et en espagnol.

La principale nouveauté est une nouvelle section **Authentification du courriel** dans chaque rapport : la posture DNS publiée (SPF, DKIM, DMARC et mécanismes connexes, avec une cote de A à F) pour les domaines d'envoi du client, afin que le rapport montre dans quelle mesure le client est protégé contre l'usurpation de courriel. En complément, les comptes inactifs sont maintenant clairement séparés entre membres et comptes externes/invités, et de nombreux ajustements de mise en page et de formulation rendent chaque rapport plus clair.

---

## Version 0.2.23 — 2026-06-23

### Auth. courriel : détection DKIM corrigée pour le nouveau format d'enregistrement de Microsoft 365

Un suivi rapide du nouvel onglet Auth. courriel. Microsoft fait migrer la DKIM de Microsoft 365 de l'ancienne cible CNAME `*.onmicrosoft.com` vers une nouvelle cible `*.dkim.mail.microsoft`. La première version ne reconnaissait que l'ancienne forme; un domaine au nouveau format — même avec DKIM correctement publié et signant activement — était signalé à tort comme **DKIM en échec** (« sélecteurs attendus introuvables »). Cette version reconnaît les deux et, surtout, ne traite plus du tout le nom d'hôte cible du fournisseur comme un critère de réussite ou d'échec : tout sélecteur Microsoft 365 qui se résout avec une clé valide est désormais considéré comme conforme, de sorte que les futurs changements à l'infrastructure DKIM de Microsoft ne provoqueront pas non plus de faux échec.

Aussi dans cette version : l'analyse IA ne répète plus le score numérique (elle le recalculait parfois de façon erronée et pouvait contredire la jauge à l'écran), et une analyse IA périmée est maintenant effacée plutôt qu'affichée lorsque les enregistrements d'un domaine changent mais que l'analyse ne peut pas être régénérée.

---

## Version 0.2.22 — 2026-06-22

### Nouvel onglet Auth. courriel — vérifiez, évaluez et surveillez le DNS anti-usurpation de chaque domaine

Chaque tableau de bord de client comporte un nouvel onglet **Auth. courriel** qui vérifie la configuration DNS publique d'authentification des courriels d'un client et continue de la surveiller. Cliquez sur **Actualiser** et Panoptica365 lit les enregistrements en direct de chaque domaine accepté — MX, SPF, DKIM et DMARC, ainsi que les mécanismes complémentaires (DNSSEC, MTA-STS, TLS-RPT, BIMI, DANE) — évalue la posture sur une jauge pondérée de A à F et utilise l'IA pour expliquer chaque enregistrement en langage clair, avec une courte liste de correctifs prioritaires à appliquer chez le registraire.

Ce qui en fait plus qu'un vérificateur générique, c'est l'**intelligence DKIM**. Panoptica365 détecte qui envoie réellement du courrier pour le domaine (à partir des enregistrements MX et SPF) et recoupe cela avec les sélecteurs DKIM publiés. Ainsi, un locataire qui fonctionne sur Microsoft 365 mais dont les enregistrements `selector1`/`selector2` sont absents est correctement signalé comme **courrier sortant non signé** — au lieu de recevoir une fausse note de 100 % parce qu'un sélecteur marketing sans rapport a répondu. Et lorsqu'un expéditeur utilise légitimement des sélecteurs imprévisibles propres à chaque compte (Amazon SES, Salesforce, Mimecast, etc.), le résultat est un honnête **« indéterminé »** assorti d'un conseil pour confirmer à partir d'un message envoyé — jamais un faux échec.

Surtout, il s'agit d'une **surveillance continue, pas d'un instantané ponctuel**. Après la première lecture, Panoptica365 revérifie chaque jour les domaines des locataires gérés et déclenche une alerte de dérive dès que la posture régresse — DMARC affaibli de reject à none, sélecteur DKIM retiré ou révoqué, SPF assoupli à `~all` ou `+all`. L'alerte indique exactement ce qui a changé (avant → après). Si vous avez fait le changement, cliquez sur **Accepter** pour définir une nouvelle référence et résoudre l'alerte; sinon, enquêtez chez votre hébergeur DNS.

Comme toujours, Panoptica365 **lit le DNS seulement et ne modifie jamais vos enregistrements** — il détecte, conseille et fournit des liens directs; vous faites la correction chez le registraire. Actualiser est disponible pour les locataires gérés et en mode audit; la surveillance quotidienne et les alertes de dérive s'appliquent aux locataires gérés.

---

## Version 0.2.21 — 2026-06-22

### Des indications plus claires lorsqu'un locataire obtient Defender pour Office 365 après une mise à niveau de licence

Lorsqu'un client passe d'une licence sans Defender pour Office 365 (par exemple Business Standard) à une licence qui l'inclut (Business Premium), le paramètre **Activer la stratégie de sécurité prédéfinie** gère désormais ce changement correctement, au lieu de se retrouver dans une impasse.

Si vous aviez déjà activé la stratégie prédéfinie Standard (ou Strict) de Microsoft pendant que le locataire était sur la licence inférieure, la mise à niveau débloque les protections Defender pour Office 365 — Liens fiables, Pièces jointes fiables et protection contre l'usurpation d'identité — mais Microsoft ne les active pas automatiquement, et il n'y a aucun moyen de les activer en dehors du portail Defender. Panoptica365 signalait correctement l'écart comme une dérive, mais les boutons **Appliquer** et **Accepter** s'arrêtaient tous deux avec un message déroutant : « ne correspond à aucune option documentée ».

Panoptica365 reconnaît maintenant cette situation précise et affiche un court guide vers l'étape unique, dans le portail Microsoft Defender, qui termine l'activation de la protection. Une fois cela fait et après une actualisation, Panoptica365 adopte la protection désormais complète comme référence et reprend la surveillance automatiquement.

---

## Version 0.2.20 — 2026-06-21

### Accès en un clic aux consoles d'administration Microsoft de chaque locataire

La Gestion des locataires comporte un nouvel onglet **Consoles d'administration** qui fait de Panoptica365 votre point de départ vers chaque portail d'administration Microsoft. Choisissez un locataire — ou utilisez la grille dense **Tous les locataires** — et accédez directement à sa console Entra, Azure, Exchange, Microsoft 365, Intune, Defender, SharePoint ou Teams. Chaque lien s'ouvre dans le bon contexte de locataire grâce à vos propres autorisations déléguées GDAP : plus besoin de chercher le bon portail, de copier des identifiants de locataire ni de jongler avec des connexions.

Deux façons de travailler :

- **Tous les locataires** — une matrice compacte (une ligne par locataire, une colonne par console) avec un en-tête figé et une recherche par nom insensible aux accents, pour atteindre n'importe quelle console de n'importe quel locataire en un clic, même avec une longue liste de clients.
- **Cibler un locataire** — un sélecteur de locataire avec de plus grandes cartes de console, chacune accompagnée d'un rappel en une ligne de l'usage du portail, lorsque vous travaillez sur un seul client.

Vous pouvez aussi cliquer sur le **nom** d'un locataire dans la liste pour accéder directement à ses consoles.

Tout ici est en **navigation seulement** — Panoptica365 n'écrit toujours rien dans les locataires de vos clients et n'y apporte aucune modification. Il vous donne simplement le chemin le plus rapide vers la bonne console.

Aucune configuration requise : les domaines de chaque locataire sont détectés automatiquement. Les quatre consoles qui n'ont besoin que de l'identifiant du locataire (Entra, Azure, Microsoft 365, Defender) fonctionnent immédiatement ; les autres s'activent dès que le domaine est détecté — peu après l'ajout d'un locataire — et affichent un bref état « Résolution… » en attendant.

---

## Version 0.2.19 — 2026-06-20

### La cloche d'alertes se vide maintenant une fois le tri effectué

La cloche de notification — et le compteur **Alertes** dans la barre latérale — conservait un nombre tant que toutes les alertes n'étaient pas résolues, de sorte qu'une alerte que vous aviez déjà prise en charge et marquée *En cours d'examen* allumait encore la cloche. Elle ne compte désormais que les **alertes nouvelles et non touchées** : dès que vous en marquez une En cours d'examen, la résolvez ou la rejetez comme faux positif, elle disparaît de la cloche et de la barre latérale. Autrement dit, la cloche signifie « quelque chose de nouveau mérite un coup d'œil », et non « du travail est encore en cours ».

Le nombre **Alertes ouvertes** dans la barre d'état inférieure est inchangé — il affiche toujours tout ce qui est actuellement actif (nouveau *et* en cours d'examen), pour garder un aperçu de votre charge de travail ouverte.

---

## Version 0.2.18 — 2026-06-20

### Surveillance DLP sur les nouveaux locataires — correctif finalisé

Ceci finalise le correctif DLP pour nouveaux locataires amorcé dans la version 0.2.16. Sur un locataire où Microsoft Purview n'avait jamais été ouvert, l'erreur « référence d'objet » sous-jacente était en fait levée pendant la *connexion* au service de conformité — une étape qui s'exécute avant la protection ajoutée en 0.2.16 — de sorte que la vérification **Surveiller la configuration des politiques DLP** pouvait encore afficher une *erreur d'interrogation* et **Faire correspondre** pouvait encore échouer.

Panoptica365 reconnaît désormais un service DLP jamais initialisé quelle que soit l'étape qui le signale, et le considère pour ce qu'il est : une base de référence vide valide. Cliquez sur **Faire correspondre** pour la capturer, et Panoptica365 vous alertera dès qu'une politique DLP sera créée dans ce locataire. Les locataires qui ne peuvent réellement pas être lus — un rôle d'administrateur manquant, par exemple — signalent toujours une erreur claire et exploitable plutôt qu'une fausse base de référence vide.

---

## Version 0.2.17 — 2026-06-20

### Les leçons d'Apprendre s'ouvrent maintenant sur tous les déploiements

L'ouverture d'une leçon depuis le carrefour Apprendre pouvait échouer — affichant un message « refus de connexion » au lieu de l'article — sur les installations servies par le proxy inverse sécurisé standard. La protection anti-détournement de clic du proxy refusait, avec raison, que toute page intègre l'application dans un cadre, ce qui empêchait aussi le lecteur de leçons d'afficher la leçon. Les leçons se chargent désormais par une méthode à laquelle cette protection ne s'applique pas; elles s'ouvrent donc de façon fiable sur tous les déploiements — tout en gardant la protection anti-détournement de clic pleinement active.

---

## Version 0.2.16 — 2026-06-20

### Vos boutons d'action ne peuvent plus être désactivés par le navigateur

Les confirmations qui apparaissent avant une action d'écriture — déployer une politique d'accès conditionnel, pousser un modèle, retirer un déploiement Intune, désactiver un locataire, etc. — reposaient auparavant sur la boîte de dialogue intégrée de votre **navigateur**. Si vous aviez déjà coché la case « empêcher cette page de créer des dialogues supplémentaires » du navigateur (parfois intitulée « Ne plus demander »), chacun de ces boutons cessait discrètement de répondre — sans erreur, sans dialogue — jusqu'au rechargement de la page.

Panoptica365 affiche désormais sa **propre** boîte de confirmation pour chacune de ces actions, dans tout le produit. Un réglage du navigateur ne peut plus désactiver vos boutons. Les actions qui suppriment ou retirent quelque chose présentent un bouton de confirmation rouge bien visible, pour que la conséquence soit évidente avant le clic.

### La surveillance DLP fonctionne maintenant sur les nouveaux locataires

Lorsque vous intégriez un locataire qui n'avait **jamais** eu de prévention contre la perte de données configurée dans le portail Microsoft Purview, la vérification **Surveiller la configuration des politiques DLP** affichait une *erreur d'interrogation* et **Faire correspondre** échouait avec un message technique. Panoptica365 considère désormais « aucune DLP configurée » pour ce que c'est : une base de référence vide valide. Cliquez sur **Faire correspondre** pour la capturer, et Panoptica365 vous alertera dès qu'une politique DLP sera créée dans ce locataire. Les locataires qui ne peuvent réellement pas être lus (par exemple, un rôle d'administrateur manquant) signalent toujours une erreur claire et exploitable plutôt qu'une fausse base de référence vide.

---

## Version 0.2.15 — 2026-06-19

### Nouvelle apparence pour les leçons + La couche humaine

Chaque leçon d'**Apprendre** — dans les huit sujets — a été refaite sous forme d'article entièrement conçu, avec diagrammes, encadrés et tableaux, et le carrefour Apprendre les affiche désormais correctement. Ouvrez un sujet et cliquez sur une leçon : elle s'ouvre dans une vue de lecture épurée avec une seule barre de défilement fluide, et elle suit le thème de votre application — leçons claires en mode clair, sombres en mode sombre. (Les diagrammes restent sur leur fond sombre, par choix de conception, pour se lire comme des figures intégrées à la page.) Tout le reste fonctionne comme avant — les pastilles bleues « non lu », les badges *Mis à jour* et le suivi de lecture par utilisateur — et les leçons suivent votre préférence de langue en français, en anglais et en espagnol.

### Un état de santé de la base de données plus clair

La vérification **Taille de la base de données** dans *Santé* n'affiche plus d'avertissement ambre simplement parce que l'historique d'un locataire a grossi — une base de données saine et active est censée grossir. Elle indique maintenant simplement la taille actuelle et les plus grandes tables, à titre de référence, et ne compte jamais dans l'état de santé global.

---

## Version 0.2.14 — 2026-06-18

### Vos données sont magnifiques!

Depuis le jour où vous avez intégré chaque locataire, Panoptica365 enregistre discrètement un instantané quotidien de sa sécurité. Cette version transforme tout cet historique en graphiques — pour que vous puissiez enfin *voir* la sécurité s'améliorer dans le temps, au lieu de seulement vérifier où elle en est aujourd'hui.

Chaque tableau de bord de locataire a maintenant un onglet **Tendances**, juste à côté de **Vue d'ensemble**. Il raconte l'histoire de ce locataire sur une période que vous choisissez — de 7 jours à une année complète : sa **cote de sécurité Microsoft** comparée à la référence des entreprises de taille comparable, la cote ventilée **par catégorie**, combien des recommandations de Microsoft vous avez **appliquées** au fil du temps, les **problèmes détectés et résolus** chaque mois, le temps qu'il a fallu pour les régler, le volume d'alertes par semaine et les politiques qui se déclenchent le plus souvent. Il est présenté en *ce que le client voit* en haut et *ce que le fournisseur voit* en bas — prêt à insérer directement dans une revue client.

Il y a aussi une toute nouvelle page **Tendances** à l'échelle du parc dans la barre latérale, juste après **Carte thermique**. Elle élargit la même idée à tout votre parc de **locataires gérés d'un coup** : une **cote de sécurité** du parc avec une plage ombrée montrant votre meilleur et votre pire locataire chaque jour ainsi que la référence Microsoft, la croissance du parc géré, les recommandations encore en suspens chez tout le monde, là où le parc est le plus faible par catégorie, et le portrait complet des opérations d'alertes — résolus, ouverts, délai de résolution, volume et vos politiques les plus bruyantes chez tous les clients. Quand vous intégrez des locataires en cours de période, une ligne distincte garde vos clients existants constants, pour qu'un nouveau locataire à faible cote ne donne pas l'impression que tout le monde a régressé.

Les deux pages lisent des données que Panoptica365 collecte déjà; elles sont donc instantanées à ouvrir et n'ajoutent aucune charge à Microsoft. Un locataire fraîchement intégré n'aura pas encore grand-chose à tracer — donnez-lui quelques semaines et le portrait se remplit. Un nouveau guide, **Tableaux de tendances**, sous **Apprendre → Guides Panoptica365**, passe en revue chaque graphique des deux pages.

---

## Version 0.2.13 — 2026-06-17

### Boîte de dialogue d'actions plus soignée pour les configurations issues du locataire

Quelques petites corrections visuelles des cartes issues du locataire (Adoption sur place) introduites dans la 0.2.11. La boîte de dialogue **Gérer la configuration** — celle que vous ouvrez depuis les **Actions** d'une carte — est désormais une rangée nette de boutons à icônes : **Arrêter la surveillance**, **Désactiver** (ou **Restaurer**) et **Supprimer**, Supprimer étant clairement en rouge. Nous avons aussi corrigé un problème de contraste du texte qui rendait cette boîte de dialogue difficile à lire dans le thème clair.

---

## Version 0.2.12 — 2026-06-16

### Le triage des applications approuvées fonctionne maintenant pour les locataires de toute taille

Sous l'onglet **Applications**, marquer des applications comme **Approuvées** puis enregistrer pouvait auparavant renvoyer **« 0 triée par Sonnet »** sans erreur sur les locataires comptant plus d'une dizaine d'applications — le triage par IA était envoyé en une seule requête surdimensionnée qui se tronquait silencieusement. Le triage s'effectue désormais par lots, de sorte que chaque application reçoit un verdict, quel qu'en soit le nombre. Si certaines applications ne peuvent pas être triées lors d'un passage (par exemple, le budget IA quotidien est atteint), un message clair **« X sur Y triées — Enregistrez de nouveau pour réessayer le reste »** s'affiche au lieu d'un zéro silencieux. Le marquage d'une application comme approuvée est aussi désormais correctement consigné dans le journal d'audit MSP.

### La capture des diagnostics est maintenant rapide

La capture d'un dossier de soutien depuis **Paramètres → Diagnostics** pouvait auparavant rester bloquée plusieurs minutes sur les installations ayant un important historique d'événements d'audit. Elle se termine désormais en quelques secondes, affiche un compteur de temps écoulé en direct pendant son exécution, et ne peut plus rester bloquée sur une requête de base de données lente.

### Nouveau contrôle de conservation pour les événements du journal d'audit unifié

**Paramètres → Conservation des données** inclut désormais les **événements du journal d'audit unifié** — l'activité Microsoft 365 brute que Panoptica365 ingère pour les alertes et la chronologie d'identité, et de loin la plus grosse table. La valeur par défaut est de **90 jours**, ce qui est amplement suffisant puisque Microsoft Purview conserve la copie de référence à long terme. Augmentez-la ou réduisez-la selon vos besoins.

---

## Version 0.2.11 — 2026-06-15

### Adoptez les paramètres d'accès conditionnel et Intune existants d'un locataire — surveillance sur place

Lorsque vous intégrez un locataire qui possède déjà ses propres stratégies d'accès conditionnel et configurations Intune, vous pouvez désormais **commencer à les surveiller sans d'abord pousser vos propres modèles**. Sous les onglets **Stratégies AC** et **Intune**, un nouveau bouton **Importer les paramètres existants** lit ce qui se trouve déjà dans le locataire et crée une carte par stratégie — marquée **Issu du locataire** (bordure gauche rouge et badge clair) pour les distinguer en un coup d'œil de vos modèles déployés. Panoptica enregistre chacune comme état initial et surveille ensuite tout changement.

Depuis chaque carte issue du locataire, vous pouvez :

- **Arrêter la surveillance** — retirer la carte ; cela **ne modifie jamais le locataire**.
- **Désactiver** — la désactiver de façon réversible (accès conditionnel : mis à désactivé ; Intune : attributions supprimées), avec l'option de continuer à la surveiller. **Restaurer** la remet exactement en place.
- **Supprimer** — la retirer définitivement du locataire, après une confirmation délibérée.

L'importation, la désactivation, la restauration et la suppression sont accessibles aux **Opérateurs et Admins** ; la confirmation est proportionnée au risque (la suppression vous demande de saisir votre propre nom), et chaque action est consignée dans le **journal d'audit** et le **journal des modifications** du locataire.

Panoptica surveille désormais **chaque** locataire afin de détecter toute **configuration créée en dehors de Panoptica** — une nouvelle stratégie AC ou un profil Intune créé directement dans la console Microsoft — et la présente sous forme de carte issue du locataire accompagnée d'une alerte, pour qu'un changement effectué hors de votre processus ne passe pas inaperçu. Pour l'accès conditionnel, c'est en **quasi-temps réel**.

Les locataires vides ou sans licence sont gérés en douceur : si un locataire n'a aucune stratégie, ou si son forfait n'inclut pas l'accès conditionnel ou Intune, vous obtenez un message clair plutôt qu'une erreur.

---

## Version 0.2.10 — 2026-06-15

### Correctif : le sommaire exécutif d'un rapport pouvait afficher du texte de code brut

Sur les locataires très actifs — beaucoup d'alertes, d'incidents, d'applications et d'administrateurs —, le texte rédigé en tête du rapport de **Posture de sécurité** (et, plus rarement, des rapports d'**Évaluation rapide** et de **Documentation de la configuration**) pouvait s'afficher avec du texte ressemblant à du code dans le sommaire exécutif, dont une étiquette `json` et des caractères `\n` visibles, au lieu d'un texte propre. Ce problème survenait surtout dans les rapports générés en **français** ou en **espagnol**, où le texte est plus long.

La cause était une limite de longueur : sur un locataire riche en données, l'analyse rédigée était coupée avant la fin, et le résultat incomplet était imprimé tel quel. Nous avons relevé la limite pour que le texte complet tienne aisément, ajouté une protection qui détecte une coupure et la remplace par un sommaire propre fondé sur les données, et garanti qu'une analyse incomplète ne pourra plus jamais être imprimée dans un rapport.

Si l'un de vos rapports présente ce problème, il suffit de le régénérer après la mise à jour — la nouvelle version sera propre.

---

## Version 0.2.9 — 2026-06-14

### Exportation CSV dans toute la console

Trois tableaux disposent maintenant d'un bouton **Exporter** qui télécharge un CSV propre, prêt pour Excel — en UTF-8 avec indicateur d'ordre des octets, afin que les accents français et espagnols survivent à l'ouverture dans Excel pour Mac :

- **Applications** (tableau de bord du locataire) — chaque application avec son éditeur, son état, son indicateur « Approuvée » et son verdict de risque enregistré.
- **Revue des accès** — deux exportations : le registre des rôles privilégiés (compte, rôles, activé, MFA, dernière activité) et la liste complète des utilisateurs (compte, type, activé, dernière activité, inactif). L'exportation des utilisateurs contient toujours **tous** les comptes, quel que soit le filtre affiché.
- **Journal d'audit** — toutes les lignes correspondant aux filtres actifs, sur **toutes** les pages (pas seulement les 100 visibles), pour la vue active (audit MSP ou chronologie unifiée).

### Les rapports couvrent désormais l'hygiène des identités et le risque applicatif

Les trois rapports — **Posture de sécurité**, **Évaluation rapide** et **Documentation de la configuration** — intègrent maintenant les mêmes signaux d'identité et d'applications que les onglets Revue des accès et Applications :

- **Comptes inactifs** et **comptes détenant des rôles d'administration** (avec leur état MFA), tirés de l'instantané de la Revue des accès et respectant le seuil d'inactivité que vous avez configuré.
- **Préparation des comptes d'urgence** — si un groupe d'accès de secours est configuré et qui en fait partie.
- **Risque applicatif** — quelles applications sont approuvées ou non, avec le verdict de risque enregistré de chaque application non approuvée et les autorisations qu'elle détient.

Dans les deux rapports IA (Posture de sécurité et Évaluation rapide), Claude intègre désormais ces signaux à l'analyse rédigée ; le rapport de Documentation de la configuration les ajoute sous forme de tableaux. Tout est entièrement localisé en anglais, français et espagnol, et se dégrade proprement lorsqu'un locataire n'a pas encore été analysé (le rapport le mentionne au lieu d'inventer des constats).

### Améliorations : une console principale entièrement localisée et un écran de mise à jour plus propre

La console principale est maintenant entièrement traduite — les en-têtes de colonnes de la liste des locataires, le graphique de sévérité des alertes (qui affiche désormais **Sévère** partout, comme le reste de l'application, au lieu de « Critique »), le nombre de locataires et le badge d'état de chaque ligne suivent tous la langue choisie. L'écran de Mise à jour logicielle de l'application n'affiche plus de ligne anglaise redondante sous chaque étape traduite.

### Fiabilité : l'enregistrement de l'onglet Applications n'expire plus

Sur les locataires comptant beaucoup d'applications, le bouton **Enregistrer** de l'onglet Applications pouvait échouer avec une erreur HTTP 504, car le triage IA des autorisations des applications non approuvées durait plus longtemps que le délai d'attente de la passerelle. L'enregistrement diffuse maintenant sa progression (comme la génération des rapports), de sorte qu'il aboutit quelle que soit la durée du triage — l'approbation est immédiate et les pastilles de triage vert/jaune/rouge se remplissent à mesure que l'analyse se termine.

---

## Version 0.2.8 — 2026-06-13

### Nouveau : Revue des accès — comptes privilégiés, comptes dormants et accès de secours

Un nouvel onglet **Revue des accès** sur le tableau de bord du locataire (entre Sécurité et Applications) répond, par locataire, à trois questions : qui détient des rôles d'administration, quels comptes sont du poids mort, et que se passe-t-il si une stratégie d'accès conditionnel verrouille tout le monde dehors.

Le premier tableau est une liste en lecture seule de chaque détenteur d'un rôle privilégié, regroupée par palier, indiquant pour chaque compte ses rôles, son état d'activation, l'enregistrement de la MFA et sa dernière activité. Le second liste tous les comptes d'utilisateurs avec des filtres **Tous / Membres / Invités / Inactifs** et vous permet de **désactiver, réactiver ou supprimer** un compte directement. Chaque écriture est confirmée, consignée à la fois dans le journal d'audit MSP et le journal des changements du locataire, et protégée côté serveur : vous ne pouvez pas supprimer un compte détenant un rôle admin, ni désactiver le dernier administrateur général, et une suppression est récupérable pendant 30 jours. L'inactivité est calculée à partir des rapports d'usage de Microsoft 365 plutôt que des journaux de connexion de l'annuaire, elle **fonctionne donc aussi sur les locataires Business Standard**.

### Comptes d'urgence (« break-glass »), configurés comme Microsoft le recommande

Depuis le même onglet, vous pouvez désigner des **comptes d'urgence** — l'administrateur de secours que vous sortez quand une stratégie d'accès conditionnel mal configurée, ou un fournisseur de MFA en panne, a verrouillé dehors tous les administrateurs normaux. Indiquez à Panoptica365 un groupe de sécurité dédié, et il exclut ce groupe de **chaque** stratégie d'accès conditionnel. Un garde-fou refuse d'exclure un groupe comptant plus que quelques membres (pour ne pas exempter toute votre entreprise par accident), et le résultat est affiché stratégie par stratégie afin qu'un échec partiel ne soit jamais présenté comme un succès. Désigner un compte revient alors simplement à l'ajouter au groupe.

Deux alertes l'accompagnent : une **alerte CRITIQUE dès qu'un compte d'urgence se connecte** — qui fonctionne sans licence Premium et continue de fonctionner même si vous avez changé le domaine du compte — et une alerte de couverture si le groupe cesse un jour d'être exclu d'une stratégie. Une note importante sur le contexte actuel : Microsoft impose désormais la MFA aux connexions des portails d'administration indépendamment de l'accès conditionnel, un compte d'urgence devrait donc disposer d'une **clé résistante à l'hameçonnage (FIDO2)** conservée avec ses identifiants. La configuration guidée vous accompagne dans tout cela, y compris les pratiques de nommage qui empêchent ces comptes de se démarquer aux yeux d'un attaquant.

### Fiabilité : les alertes du journal d'audit restent à jour entre les redémarrages

Un défaut de minutage dans l'évaluateur du journal d'audit unifié pouvait figer son repère d'évaluation sur un serveur dans un fuseau horaire hors UTC, de sorte que les alertes du journal d'audit — changements de rôle administrateur, consentements OAuth, octrois d'autorisations de boîte aux lettres, et la nouvelle alerte de connexion d'urgence — ne se déclenchaient de façon fiable que juste après un redémarrage. Le repère est désormais lu en UTC, ces alertes restent donc à jour en continu.

### Aussi dans cette version

L'en-tête du tableau de bord du locataire a été retravaillé pour que la barre d'onglets ait de la place pour grandir — le sélecteur de locataire se trouve maintenant dans la barre d'information en tant que titre de la page, et les boutons Sonder maintenant / Journaliser un changement l'ont rejoint. Un nouveau guide **Revue des accès** a été ajouté à Apprentissage (Guides Panoptica365), en anglais, en français et en espagnol.

---

## Version 0.2.7 — 2026-06-12

### Les rapports d'évaluation rapide s'ouvrent désormais sur un sommaire en langage clair pour le propriétaire d'entreprise

L'évaluation rapide a toujours produit un rapport de calibre opérateur — constats techniques, détails de configuration, modèles déployables en un clic. Cette version ajoute un nouveau **sommaire exécutif** en première page de chaque évaluation rapide, rédigé pour le propriétaire d'entreprise (ou le client potentiel) non technique à qui vous remettez le rapport.

Il dit, en termes d'affaires simples : où en est le locataire aujourd'hui, ce qui pourrait réellement mal tourner pour l'entreprise (un portable perdu exposant des fichiers clients, une prise de contrôle de compte, une interruption de service — et non les noms de contrôles techniques), la seule prochaine étape la plus importante et ce qu'elle exige, et à quoi ressemble une bonne posture une fois cette étape franchie. Il ne contient volontairement aucune clé de configuration, aucun nom de champ ni jargon de produit — vous pouvez donc le présenter à un propriétaire sans avoir à le traduire au préalable.

Rien d'autre n'a changé dans le rapport : l'évaluation technique complète — accès conditionnel, Intune, paramètres de sécurité, points forts et actions prioritaires — suit immédiatement, exactement comme avant. Le sommaire est entièrement localisé en anglais, en français et en espagnol au même titre que le reste du rapport, et tout contexte que vous saisissez dans la fenêtre d'évaluation oriente sa formulation.

---

## Version 0.2.6 — 2026-06-12

### Le volet IA ne peut plus se bloquer, s'emballer, ni entraîner les alertes avec lui

Chaque appel au service d'IA porte désormais une limite de temps stricte (auparavant, le réglage par défaut sous-jacent permettait à un appel de rester suspendu dix minutes, immobilisant un processus d'arrière-plan avec lui). Un **budget quotidien de jetons IA** sert de fusible : si un emballement venait à l'épuiser, les narratifs IA se mettent en pause jusqu'à minuit UTC, une alerte au tableau de bord vous en informe, et tout reprend automatiquement — essentiel surtout pour les installations utilisant leur propre clé IA, où un emballement se traduit par une facture surprise. Un **disjoncteur** cesse de solliciter le service d'IA après des échecs répétés et réessaie de lui-même quelques minutes plus tard. Dans chacune de ces situations, l'invariant tient : **les alertes se déclenchent toujours — seul le narratif IA est omis.**

### Les mises à jour surveillent leurs arrières pendant trois minutes

Le système de mise à jour automatique a toujours vérifié la santé d'une nouvelle version au démarrage et effectué un retour en arrière automatique en cas d'échec. Il **observe maintenant la nouvelle version pendant trois minutes après** la réussite de la vérification initiale, et revient en arrière si elle devient instable — couvrant le cas plus sournois d'une version qui démarre proprement puis plante en boucle une minute plus tard. Les versions passent aussi par un **canal anticipé** : l'installation du fournisseur absorbe chaque version quelques jours avant que les installations clientes du canal stable ne la voient.

### Télémétrie de santé — pour que le soutien voie le problème avant que vous n'écriviez

Une fois par jour, votre installation envoie un petit résumé de santé au serveur de licences : version de l'application, canal de mise à jour, états des contrôles de santé, noms des processus en retard, compteur de plantages, taille de la base de données, utilisation du disque et *nombre* de locataires. **Jamais de noms de locataires, d'identités d'utilisateurs, de contenu d'alertes ni de textes d'erreur — les données des clients et des locataires ne quittent jamais votre installation.** La liste exacte des champs est documentée dans le gabarit de configuration, et `TELEMETRY_ENABLED=false` désactive le tout.

### Chaque version passe désormais des contrôles qualité automatisés

De nouveaux contrôles d'intégration continue s'exécutent à chaque changement : une vérification de sécurité prouvant que chaque route d'API porte son garde d'authentification, un contrôle de complétude des trois langues (anglais, français, espagnol — plus de 3 400 chaînes vérifiées structurellement identiques) et un test de double démarrage sur une base de données vierge — exactement le scénario qu'un nouveau client rencontre en premier.

---

## Version 0.2.5 — 2026-06-12

### Conçu pour durer : reprise après plantage, limites de temps réseau et chiens de garde

Panoptica365 fonctionne sans surveillance; cette version durcit donc tout ce qui pouvait auparavant échouer en silence. Si l'application plante de façon inattendue, la raison complète est maintenant écrite dans le fichier journal, un compteur de plantages est enregistré (et inclus dans les bundles de diagnostic), et le processus redémarre proprement. Chaque appel sortant — Microsoft Graph, téléchargements de journaux d'audit, votre PSA, le serveur de licences — a maintenant une limite de temps stricte, de sorte qu'un point de terminaison Microsoft qui ne répond plus ne peut plus geler un processus d'arrière-plan indéfiniment. Et si un cycle se coince malgré tout, un chien de garde le détecte, le journalise clairement et laisse le cycle suivant s'exécuter — plus aucune boucle d'arrière-plan ne peut rester bloquée en permanence.

### Chaque processus d'arrière-plan signale maintenant son pouls

Le panneau de santé (cliquez sur l'indicateur d'état dans la barre du bas) comporte un nouveau contrôle **Processus d'arrière-plan**. Toutes les boucles d'arrière-plan de Panoptica365 — sondage des métriques, ingestion des journaux d'audit, synchronisation des billets PSA, planificateurs de dérive CA et Intune, résumé matinal, nettoyage nocturne et plus — enregistrent maintenant une pulsation après chaque cycle. Si l'une d'elles devient silencieuse au-delà de son rythme attendu, le panneau de santé vous indique laquelle, depuis combien de temps, avec sa dernière erreur. Les processus non configurés (par exemple le PSA sans fournisseur) s'affichent comme *inactifs par configuration* au lieu de générer de fausses alertes.

### La base de données fait maintenant son propre ménage

Un nettoyage nocturne (3 h 30) applique des fenêtres de rétention aux données historiques qui croissaient auparavant sans limite. La nouvelle carte **Réglages → Rétention des données** affiche chaque fenêtre, préremplie avec les valeurs recommandées que vous pouvez ajuster — chacune accompagnée d'une note claire sur l'impact d'un changement, et de garde-fous pour qu'une valeur ne puisse pas casser les alertes ou les rapports. Les changements s'appliquent dès le prochain nettoyage nocturne, sans redémarrage, et sont consignés dans le journal d'audit. **Les alertes ne sont jamais supprimées automatiquement.**

Le gain le plus important concerne les instantanés de sondage : le détail complet est conservé une semaine (les alertes de détection de changement n'ont besoin que du sondage précédent), tandis que l'historique plus ancien est consolidé en une valeur compacte de Secure Score par locataire et par jour — exactement ce qu'utilisent les courbes de tendance des rapports. Tableaux de bord, alertes et rapports se comportent à l'identique. Sur notre propre installation de production, une base de deux mois est passée de 28 Go à 10 Go.

### Nouveau contrôle de santé « Taille de la base de données »

Le panneau de santé gagne aussi un contrôle **Taille de la base de données** affichant le total réel et les plus grandes tables — en lisant des statistiques fraîches plutôt que celles mises en cache par MySQL, pour refléter la réalité immédiatement. Il avertit lorsque la base dépasse un seuil configurable (10 Go par défaut), vous laissant le temps de planifier l'espace disque avant que cela ne devienne un problème.

### Une couche base de données plus silencieuse et plus robuste

Sous charge ou pendant un blocage de la base de données, l'application échoue maintenant rapidement au lieu de s'empiler : la file d'attente de connexions est bornée, l'attente d'une connexion a une échéance, la taille du pool est ajustable, et toute requête de plus de deux secondes est journalisée (le texte de la requête seulement — jamais ses données) afin que les ralentissements soient diagnosticables depuis un bundle de support.

---

## Version 0.2.4 — 2026-06-11

### Les paramètres de sécurité se trouvent maintenant dans le tableau de bord de chaque locataire

Les paramètres de sécurité sont par nature propres à chaque locataire; ils ont donc maintenant leur propre onglet **Sécurité** dans le tableau de bord du locataire — entre **Alertes** et **Applications**. Vous n'avez plus à quitter le locataire en cours, à ouvrir la page Sécurité distincte et à resélectionner le locataire : tout ce qui concerne ce locataire, y compris sa posture de sécurité, est maintenant au même endroit. L'onglet comprend le même bouton **Actualiser** pour relancer le sondage des paramètres de sécurité d'un locataire à la demande, et les liens « explorer un paramètre » de la Carte thermique vous amènent maintenant directement à cet onglet, le paramètre ouvert.

La page Sécurité autonome (sous **Politiques**) fonctionne toujours exactement comme avant — rien n'a été retiré.

### Ouvrir un incident Defender directement depuis son alerte

Les alertes issues d'un incident Microsoft Defender affichent maintenant un bouton **Ouvrir l'incident dans Defender** qui vous amène directement à cet incident dans le portail Microsoft Defender — fini la copie du lien depuis les données brutes de l'alerte. Son ouverture nécessite une session de navigateur connectée avec un compte habilité GDAP pour le locataire client.

### Cliquer sur le nom d'un locataire dans une alerte pour ouvrir son tableau de bord

Dans le panneau de détail de l'alerte, le nom du locataire est maintenant un lien. Cliquez dessus pour accéder directement au tableau de bord de ce locataire, au lieu de fermer l'alerte, de revenir à la console principale et de chercher le locataire à la main. (Les alertes multilocataires du Centre de messages affichent toujours leurs locataires concernés en texte simple, puisqu'elles ne pointent pas vers un seul tableau de bord.)

### « Strict seulement » est maintenant une configuration de préréglage prise en charge

Le paramètre **préréglage de stratégie de sécurité** (Standard / Strict) reconnaît maintenant un locataire qui utilise **Strict sans la base Standard** comme une configuration valide. Auparavant, si un locataire dérivait vers cet état, **Accepter** aboutissait à une impasse (« ne correspond à aucune option documentée ») et vous deviez le corriger via Configurer. Vous pouvez maintenant accepter cet état comme base — ou le choisir délibérément — comme toute autre option de préréglage.

---

## Version 0.2.3 — 2026-06-11

### Corrigé : les billets de dérive se relient à leur alerte et se ferment quand vous acceptez la dérive

Les billets ouverts pour les **alertes de dérive de configuration** — dérive d'Accès conditionnel et dérive de politique Intune — étaient créés dans votre PSA mais **non reliés** à l'alerte. Ils n'affichaient donc aucune pastille de billet, et lorsque vous **acceptiez (ou résolviez autrement) la dérive**, le billet restait ouvert — un orphelin à fermer à la main. Ils se relient maintenant correctement et se ferment automatiquement à l'acceptation/résolution, exactement comme tout autre billet PSA. (Les alertes de verrouillage de compte et de connexion n'ont jamais été touchées.)

Remarque : les billets de dérive créés *avant* ce correctif n'ont pas de lien et ne se fermeront donc pas d'eux-mêmes — videz cet arriéré manuellement dans votre PSA une dernière fois.

### Les regroupements consolident maintenant leurs billets au lieu de les abandonner

Lorsque vous fusionnez plusieurs alertes en un **regroupement**, leurs billets PSA sont maintenant consolidés en conséquence. Le billet le **plus ancien** est conservé comme survivant — renommé selon le titre de votre regroupement et lié à l'alerte de regroupement — et les autres billets sont **fermés avec une note qui renvoie au survivant**. Auparavant, fusionner des alertes laissait ouvert le billet de chaque enfant. Comme le PSA n'offre aucune véritable opération de « fusion de billets », ceci reproduit ce que vous feriez à la main : un billet porte le travail, les autres se ferment avec un renvoi.

---

## Version 0.2.2 — 2026-06-10

### Réinitialisation de mot de passe en libre-service : chaque méthode d'authentification est maintenant une case à cocher distincte

Le contrôle **Activer la réinitialisation de mot de passe en libre-service (SSPR)** traitait auparavant Microsoft Authenticator, le SMS et le courriel comme un bloc « Standard » tout ou rien. Une stratégie de renforcement courante et recommandée par Microsoft — désactiver le SMS (la méthode la plus faible) tout en conservant Authenticator et le courriel — était donc impossible à exprimer : l'onglet Configurer ne permettait pas de décocher le SMS, et si vous le retiriez directement dans Entra, Panoptica365 détectait correctement la dérive mais **Accepter** échouait avec le message *« La valeur actuelle dérivée ne correspond à aucune option documentée. »*

L'onglet Configurer présente maintenant **chaque** méthode d'authentification comme sa propre case à cocher, le trio recommandé en tête. **Standard** et **Désactivé** deviennent des préréglages en un clic — Standard coche l'ensemble recommandé, Désactivé efface tout — mais vous êtes libre d'activer n'importe quelle combinaison. Votre choix est synchronisé exactement : les méthodes cochées sont activées pour tous les utilisateurs, les méthodes décochées sont désactivées, de sorte que la détection de dérive capte toujours tout changement externe à n'importe quelle méthode.

**Accepter** (et **Faire correspondre**) adoptent désormais la configuration en direct comme nouvelle référence, peu importe comment elle est établie; retirer le SMS — ou toute autre méthode — ne mène donc plus à une impasse. Les références existantes ne sont pas touchées : elles continuent de fonctionner exactement comme avant et passent à la nouvelle forme par méthode au prochain Appliquer, Accepter ou Faire correspondre.

---

## Version 0.2.1 — 2026-06-09

### Sélection plus claire lors du cadrage d'une exemption d'alerte

Lorsque vous créez une exemption d'alerte, les choix de **portée par pays** et de **durée** s'affichent sous forme de boutons en pastille. La pastille sélectionnée se remplit maintenant de couleur tandis que les autres restent neutres, ce qui rend évident d'un coup d'œil quelle option est active — auparavant, la surbrillance était si pâle qu'on pouvait croire qu'un clic sur une pastille n'avait rien fait. Le survol d'une pastille affiche aussi désormais un contour coloré pour indiquer qu'elle est cliquable.

Il s'agit d'un changement visuel seulement. La façon dont les exemptions correspondent aux alertes et les suppriment demeure inchangée.

---

## Version 0.2.0 — 2026-06-07

### Les billets PSA se ferment maintenant d’eux-mêmes lorsque la dérive sous-jacente est résolue

Lorsqu’une alerte de dérive de configuration est liée à un billet PSA et que cette dérive est résolue dans Panoptica365 — que vous cliquiez sur **Accepter**, **Corriger** ou **Faire correspondre** sur le paramètre, que vous poussiez un correctif confirmé à la vérification suivante, ou que quelqu’un la corrige simplement dans le portail d’administration Microsoft — Panoptica365 **ferme désormais le billet lié automatiquement** et ajoute une note explicative. Auparavant, l’alerte se résolvait mais le billet restait ouvert, laissant des billets orphelins après une série d’acceptations de dérive.

La seule exception est délibérée : si vous résolvez une alerte depuis le panneau d’alerte et choisissez **« Laisser le billet ouvert »**, le billet reste ouvert pour que votre technicien le termine. Seule une véritable résolution de dérive déclenche la fermeture automatique.

---

## Version 0.1.54 — 2026-06-07

### Changer de langue met maintenant à jour la page où vous êtes

Auparavant, changer la langue de l'interface dans les **Paramètres** basculait immédiatement la barre supérieure et la barre latérale gauche dans la nouvelle langue, mais la page au centre — un tableau de bord de locataire, un guide Apprendre, etc. — restait dans l'ancienne langue. La seule façon de la voir traduite était de recharger votre navigateur, ce qui vous renvoyait aussi à la console principale et vous obligeait à refaire toute la navigation jusqu'à l'endroit où vous étiez.

Maintenant, lorsque vous enregistrez une nouvelle langue, la page que vous consultez se rafraîchit sur place dans la nouvelle langue et vous restez exactement où vous étiez. La barre supérieure et la barre latérale continuent de basculer instantanément, et rien d'autre dans votre session ne change.

---

## Version 0.1.53 — 2026-06-07

### Nouveau dans Apprendre : la carte Guides Panoptica365

La section Apprendre s'ouvre désormais sur une nouvelle carte, **Guides Panoptica365** — 18 guides opérateur courts, étape par étape, qui couvrent toute la plateforme dans l'ordre réel d'une nouvelle installation. La séquence commence par **Commencez ici** et **Ajoutez votre premier locataire** (incluant le choix entre géré et audit seulement ainsi que le flux de consentement administrateur), puis parcourt la console principale, le tableau de bord du locataire, la revue des applications, le déploiement des stratégies d'accès conditionnel et Intune, la surveillance des paramètres de sécurité, le traitement et le réglage des alertes, les exemptions, les vues de parc, les rapports, les notifications, l'intégration PSA, les rôles d'utilisateurs et l'administration du système.

Chaque guide est volontairement court et explicite — les noms exacts des boutons, les noms exacts des onglets, quoi cliquer et dans quel ordre — et complète le curriculum existant d'Apprendre, qui couvre les connaissances en sécurité derrière la plateforme. Comme le reste de la section Apprendre, les guides sont offerts en anglais, en français et en espagnol, avec les habituels points « non lu » et insignes MISE À JOUR.

---

## Version 0.1.52 — 2026-06-07

### Nouveau : les nouvelles installations incluent la bibliothèque de modèles de départ

Une nouvelle installation de Panoptica365 arrive désormais avec la bibliothèque complète et organisée de modèles d'accès conditionnel et Intune déjà chargée — l'ensemble de départ **« Panoptica365 - … »** — au lieu d'une page Modèles vide. Vous pouvez les examiner et les déployer immédiatement dans vos locataires clients, ou les utiliser comme point de départ aux côtés de vos propres modèles importés.

**Les installations existantes ne sont pas touchées.** L'ensemble de départ ne se charge que lorsque votre bibliothèque de modèles est vide; tout ce que vous avez déjà importé ou personnalisé reste exactement tel quel — rien n'est écrasé ni dupliqué, ni lors de cette mise à jour ni d'une future.

**Conçus pour s'adapter à tout locataire.** Les modèles d'accès conditionnel fournis référencent les emplacements au moyen des espaces réservés portables de Panoptica365 (ainsi un modèle « bloquer les connexions hors du Canada » se résout vers le bon emplacement nommé dans chaque locataire client), sont livrés avec des listes d'exclusion de comptes d'urgence vides à compléter, et ne contiennent aucun identifiant propre à un locataire particulier.

---

## Version 0.1.51 — 2026-06-07

### Renforcement de la sécurité avant le déploiement élargi

Cette version resserre plusieurs réglages de sécurité par défaut pour la configuration, la connexion et les diagnostics. Aucune nouvelle fonctionnalité, et aucune modification de configuration n’est requise pour les installations existantes — mais certains comportements sont maintenant plus sûrs par défaut.

**La configuration exige désormais un groupe d’accès (RBAC).** L’assistant de premier démarrage traitait auparavant les trois groupes de rôles (Admins / Opérateurs / Lecteurs) comme facultatifs. L’**ID d’objet du groupe Admins est maintenant obligatoire** pour terminer la configuration. Cela corrige un comportement par défaut trop permissif : si les trois champs de groupe étaient laissés vides, tout compte pouvant se connecter à votre locataire Microsoft obtenait un accès Admin complet dans Panoptica365. Vous devez maintenant pointer Panoptica365 vers un groupe de sécurité Entra, et seuls les membres du ou des groupes configurés peuvent se connecter. Les installations existantes ne sont pas touchées — cela s’applique aux nouvelles installations et aux réinstallations. Les paliers Opérateurs et Lecteurs restent facultatifs.

**La connexion échoue de façon sécuritaire.** Si aucun groupe d’accès n’est configuré, Panoptica365 refuse désormais la connexion au lieu d’admettre tout le monde, et n’attribue jamais le rôle Admin par défaut. Le secret de signature de session est aussi généré et enregistré automatiquement s’il est manquant ou faible — ainsi, une installation ne peut jamais fonctionner en silence avec un secret par défaut intégré, et vous ne pouvez jamais être verrouillé dehors à cause d’une mauvaise configuration. Une vue de données interne qui était accessible sans connexion exige maintenant une session valide.

**Le lot de diagnostic est plus sûr à partager.** Le lot caviardé (Réglages → Diagnostics) masque désormais vos identifiants d’API PSA (Autotask), et son résumé de configuration est passé à un modèle « valeurs sûres connues seulement » : tout ce qu’il ne reconnaît pas explicitement comme non sensible — y compris les secrets ajoutés par de futures intégrations — est masqué plutôt qu’inclus. Le lot reste sûr à envoyer au soutien, par conception.

**Image plus petite et plus propre.** Les fichiers de travail temporaires obsolètes ne sont plus inclus dans l’image de conteneur publiée.

---

## Version 0.1.50 — 2026-06-06

### Nouveau : billetterie PSA native — intégration Autotask

Panoptica365 peut maintenant créer et gérer vos billets directement dans votre PSA au moyen de son API, au lieu de les envoyer par courriel. Le premier PSA pris en charge est **Autotask**, et il est **désactivé par défaut** — rien ne change tant que vous ne l’activez pas sous **Réglages → Intégration PSA**.

Une fois activé, et un client associé à son entreprise Autotask, toute alerte acheminée vers « support » ouvre un véritable billet Autotask — avec la bonne entreprise, la bonne file d’attente, la priorité et l’échéance, l’analyse IA et un lien vers l’alerte dans Panoptica365 — au lieu d’un courriel analysé. Les alertes répétées pour un même client et une même politique (par exemple, plusieurs alertes de verrouillage de compte d’affilée) sont regroupées : la première crée un billet et les suivantes y sont ajoutées en notes, pour ne pas inonder votre file de doublons.

La résolution reste synchronisée dans les deux sens. Lorsqu’un technicien ferme le billet dans Autotask, l’alerte liée se résout automatiquement dans Panoptica365 en quelques minutes, avec une note explicative. Lorsque vous résolvez une alerte dans Panoptica365, on vous demande s’il faut aussi fermer son billet Autotask — fermez-le (avec une note de fermeture) ou laissez-le ouvert pour que le technicien le termine. Chaque alerte affiche une pastille de billet qui mène directement au billet Autotask.

Les clients que vous n’avez pas associés — et les locataires en audit seul — continuent d’utiliser le courriel vers billet, ce qui permet une adoption client par client. Les identifiants, les choix de file d’attente, de priorité et de statut, ainsi que la correspondance client-entreprise se trouvent tous dans la nouvelle fiche **Réglages → Intégration PSA**. La prise en charge de ConnectWise Manage est prévue ensuite; l’intégration a été conçue derrière une couche fournisseur afin que son ajout ne perturbe pas Autotask.

---

## Version 0.1.49 — 2026-06-06

### Corrigé : le moniteur d’état ne signale plus comme défaillants les points de terminaison Graph limités par la licence

La vérification d’état des **points de terminaison de l’API Graph** (et l’indicateur en bas à gauche) affichait des locataires comme ayant des points de terminaison défaillants alors que le seul « problème » tenait au niveau de licence du locataire. Plusieurs points de terminaison de Microsoft Graph — journaux de connexion, détections de risque, rapports sur les méthodes d’authentification, ainsi que les files d’alertes et d’incidents de sécurité — ne sont disponibles que sur les niveaux supérieurs (Microsoft Entra ID P1/P2, Microsoft Defender XDR). Sur un locataire qui ne les possède pas, Microsoft refuse la requête, et Panoptica comptait chaque refus comme une défaillance — accumulant des milliers d’« erreurs » et affichant la boîte d’état en rouge, en permanence, pour des locataires qui se comportaient exactement comme leur licence le prévoit.

Panoptica reconnaît désormais ces réponses pour ce qu’elles sont : la fonctionnalité n’est pas incluse dans la licence du locataire (ou, pour les files de sécurité, Microsoft Defender n’a pas terminé son approvisionnement après une mise à niveau récente). Ces points de terminaison sont marqués **non disponibles** plutôt que défaillants — ils ne comptent plus dans la vérification d’état, n’allument plus la barre d’état et ne sont plus réessayés inutilement. Dès qu’un locataire est mis à niveau (ou que Defender termine son approvisionnement), le point de terminaison repasse à « sain » au prochain sondage. Les véritables problèmes d’autorisation — un consentement révoqué ou une autorisation d’API manquante — sont toujours signalés comme de vraies défaillances, de sorte que rien de réellement défectueux n’est masqué.

Ce correctif complète celui de la version 0.1.46, qui faisait la même distinction lors de la configuration initiale ; cette version l’applique à la surveillance d’état continue.

---

## Version 0.1.47 — 2026-06-06

### Corrigé : indications plus claires pour l’autorisation Exchange lors de la configuration

Le guide d’inscription d’application vous demande d’ajouter l’autorisation `Exchange.ManageAsApp`. Microsoft expose une autorisation portant ce nom exact sous **deux** API différentes — **Office 365 Exchange Online** (la bonne) et **Microsoft Exchange Online Protection** (la mauvaise). Elles semblent identiques et acceptent toutes deux le consentement de l’administrateur, mais seule la première fonctionne ; choisir la mauvaise laisse silencieusement tous les paramètres de sécurité Exchange et Conformité bloqués et illisibles.

Le guide affiche désormais un avertissement bien visible sous cette étape, précisant exactement quelle API choisir (avec son ID d’application), ainsi qu’une astuce : si « Office 365 Exchange Online » n’apparaît pas lors d’une recherche par nom, collez son ID d’application dans la zone de recherche et elle s’affichera.

### Corrigé : le champ du nom dans le contrat de licence était difficile à lire

Sur le contrat de licence au premier démarrage, la case où vous saisissez votre nom complet affichait un texte clair sur fond blanc avec le thème sombre, de sorte que votre saisie semblait vide. Le champ utilise désormais un texte foncé sur blanc et est parfaitement lisible.

---

## Version 0.1.46 — 2026-06-06

### Correction : le « Test de connexion » de la configuration ne signale plus de fausses erreurs sur les autorisations liées aux licences

L'étape **Test de connexion** de l'assistant de configuration vérifie que les autorisations de votre inscription d'application Entra sont accordées. Elle signalait deux autorisations — l'accès aux journaux de connexion (`AuditLog.Read.All`) et l'accès aux incidents de sécurité (`SecurityIncident.Read.All`) — comme des échecs, même lorsque le consentement de l'administrateur était correctement accordé. La raison : ces deux points de terminaison Microsoft Graph exigent aussi que le *locataire* dispose d'un niveau supérieur — Microsoft Entra ID P1/P2 pour les journaux de connexion, Microsoft Defender XDR pour les incidents de sécurité — et ils refusent la requête sur les locataires qui ne l'ont pas, peu importe le consentement accordé. Il s'agit d'une capacité du locataire, et non d'une mauvaise configuration.

Le Test de connexion fait maintenant la distinction. Une autorisation n'est signalée en rouge que lorsque le consentement de l'administrateur est réellement manquant; les autorisations qui ne sont tout simplement pas disponibles avec les licences actuelles de votre locataire s'affichent sous forme de note informative (« ne s'applique pas à ce locataire — vous pouvez continuer en toute sécurité ») plutôt que comme une erreur. Fini les fausses erreurs alarmantes lors d'une nouvelle installation.

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
