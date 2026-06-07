---
title: "Audit de boîte aux lettres — le dossier forensique qui ne vous manque que quand vous en avez besoin"
subtitle: "Activer et vérifier les journaux d'audit de boîte aux lettres pour reconstruire exactement ce qu'un attaquant a lu, déplacé ou supprimé lors d'une brèche."
icon: "eye"
last_updated: 2026-05-29
---

# Audit de boîte aux lettres — le dossier forensique qui ne vous manque que quand vous en avez besoin

La contrôleuse d'un client se fait hameçonner un mercredi. L'attaquant a sa boîte aux lettres pendant six jours. Le MSP attrape la compromission le mardi suivant — un partenaire appelle au sujet d'instructions de virement frauduleuses, le MSP confirme la brèche, réinitialise les identifiants, révoque les sessions, ouvre un incident.

Maintenant la question qui détermine tout ce qui suit en aval : **qu'est-ce que l'attaquant a vu?**

L'avocat du client a besoin de le savoir. Le souscripteur d'assurance a besoin de le savoir. Le responsable de la protection des données a besoin de savoir si les seuils de notification de brèche ont été franchis. Les clients, contractants et contreparties du client peuvent avoir besoin d'être informés selon ce qu'il y avait dans ces messages. La fraude par virement est déjà en cours — quantifier la *divulgation d'information*, c'est la prochaine étape.

Le MSP ouvre le Unified Audit Log. Événements de connexion : présents. Création de règles de boîte de réception : présente. Messages sortants envoyés par l'attaquant : présents. Requêtes de recherche que l'attaquant a lancées dans la boîte aux lettres : présentes. La liste exacte des messages que l'attaquant a effectivement ouverts et lus?

Rien. Parce que **MailItemsAccessed n'était pas audité.**

La configuration d'audit de boîte aux lettres par défaut que Microsoft livre n'inclut pas MailItemsAccessed dans la liste des actions auditées. Le MSP peut prouver que l'attaquant s'est connecté. Le MSP peut prouver que l'attaquant a envoyé du courriel malveillant. Le MSP ne peut pas prouver quels messages entrants l'attaquant a lus, quels fils historiques il a exfiltrés, à quelles discussions confidentielles il avait visibilité.

La portée de notification de brèche enfle à « il faut supposer tout ». Six ans de courriel. Chaque pièce jointe de contrat, chaque discussion de fusion-acquisition, chaque dossier RH que la contrôleuse avait dans sa boîte aux lettres. La réclamation d'assurance enflant d'un ordre de grandeur. Les obligations de divulgation enflant pour correspondre.

C'est le coût de sauter le travail de posture d'audit de boîte aux lettres. Cette leçon vise à ne pas le payer.

## Ce que l'audit de boîte aux lettres enregistre vraiment

L'audit de boîte aux lettres est la propriété par boîte aux lettres qui détermine quelles actions sont journalisées au Unified Audit Log quand elles se produisent dans cette boîte aux lettres. Il est activé par défaut depuis 2019 — mais « activé » ne veut pas dire « tout journalisé », et la liste d'actions par défaut est beaucoup plus étroite que la plupart des opérateurs le supposent.

Trois classes d'acteur sont auditées indépendamment :

- **AuditOwner** — actions effectuées par le propriétaire principal de la boîte aux lettres (c.-à-d. l'utilisateur connecté à sa propre boîte aux lettres).
- **AuditDelegate** — actions effectuées par des utilisateurs avec un accès délégué (assistants, membres de boîtes partagées, n'importe qui avec des permissions sur la boîte aux lettres).
- **AuditAdmin** — actions effectuées par les administrateurs sur la boîte aux lettres (via PowerShell, eDiscovery, etc.).

Chacun est une liste d'actions auditées. Les défauts de Microsoft incluent des choses comme :

- **Update** — propriétés de message changées.
- **Move** / **MoveToDeletedItems** — message déplacé vers un dossier ou vers Éléments supprimés.
- **SoftDelete** / **HardDelete** — message supprimé de façon récupérable ou permanente.
- **SendAs** / **SendOnBehalf** — message envoyé sous une autre identité.
- **Create** — nouvel élément créé (typiquement par admins/scripts).
- **MailboxLogin** — propriétaire se connectant à la boîte aux lettres.

Ce qui n'est **pas** dans les défauts (pour la plupart des tenants) et compte le plus pour la forensique :

- **MailItemsAccessed** — le message a été ouvert ou téléchargé. C'est l'action qui répond à « qu'est-ce que l'attaquant a vu? » Sans elle dans la liste auditée, vous ne pouvez pas reconstruire l'activité de lecture post-compromission.
- **Send** — message envoyé depuis la boîte aux lettres. Les défauts journalisent SendAs et SendOnBehalf mais pas l'action Send propre de l'utilisateur dans certaines configurations. Vaut la peine de vérifier par boîte aux lettres.
- **SearchQueryInitiatedExchange** — recherche effectuée dans la boîte aux lettres. Vous dit ce que l'attaquant cherchait.

## La barrière de l'audit Premium (essentiellement fermée pour Business Premium maintenant)

MailItemsAccessed et SearchQueryInitiatedExchange étaient autrefois E5-seulement — étiquetés actions « Premium audit ». Microsoft a élargi la disponibilité en 2024-2025 et ces actions spécifiques sont maintenant disponibles dans les tenants Microsoft 365 Business Premium aussi. Le bénéfice qui reste limité à E5, c'est la **durée de rétention** : l'audit Standard garde les enregistrements 180 jours; la rétention Premium s'étend à 1 an par défaut. Pour les clients PME sans E5, 180 jours suffit habituellement pour la réponse à incident (le scénario de contrôleuse hameçonnée ci-dessus se résout en semaines), mais ça vaut la peine de connaître la limite quand on définit la portée d'une investigation à plus longue traîne.

## Audit Bypass — la sortie silencieuse de l'attaquant

Il y a une propriété par boîte aux lettres appelée `AuditBypassEnabled`. Quand mise à `$true` (via `Set-MailboxAuditBypassAssociation`), les actions effectuées sur cette boîte aux lettres par l'identité contournée *ne sont pas journalisées du tout*. C'est typiquement utilisé pour des comptes de service légitimes dont l'activité normale générerait du bruit d'audit.

C'est aussi la propriété de rêve de l'attaquant. Un compte compromis avec des droits d'admin peut mettre sa propre boîte aux lettres (ou une autre qu'il compromet) à AuditBypassEnabled=$true et opérer ensuite sans laisser de trace d'audit. Le temps que le MSP enquête, les événements pertinents n'ont jamais été écrits.

La posture stricte d'audit de boîte aux lettres a un travail spécifique ici : **attraper les drapeaux `AuditBypassEnabled` inattendus**. La liste de contournement devrait être vide ou contenir seulement des comptes de service connus qui ont une raison documentée d'y être. N'importe quelle boîte aux lettres que vous ne vous attendiez pas à voir dans la liste de contournement mérite enquête.

## La posture stricte d'audit de boîte aux lettres — ce qu'elle configure vraiment

Deux choses distinctes, que Panoptica365 surveille comme deux paramètres de sécurité distincts sur la liste de catégorie Exchange :

**« Enable Mailbox Auditing for All Users »** — vérifie que chaque boîte aux lettres utilisateur dans le tenant a `AuditEnabled=$true`. Microsoft active ça par défaut pour les nouveaux tenants, mais les boîtes aux lettres héritées de configurations plus anciennes, de migrations, ou de scripts d'approvisionnement spécifiques peuvent l'avoir désactivé. Si même une boîte aux lettres a l'audit éteint, cette boîte aux lettres est un angle mort. Panoptica365 vérifie la propriété à travers toutes les boîtes aux lettres et rapporte conforme/non conforme.

**« Strict Mailbox Audit Posture (Bypass + Action List) »** — la plus impliquée. Deux vérifications enroulées dans un paramètre :

1. **La liste de contournement est propre.** Aucune boîte aux lettres n'a `AuditBypassEnabled=$true` sauf si explicitement approuvée. Toute entrée de contournement inattendue fait échouer le paramètre.
2. **La liste d'actions est complète.** Les listes `AuditOwner`, `AuditDelegate` et `AuditAdmin` de la boîte aux lettres incluent les actions à haute valeur (MailItemsAccessed, Send, SearchQueryInitiatedExchange, les variantes de suppression, les variantes SendAs / SendOnBehalf). Les boîtes aux lettres avec la liste d'actions par défaut plus étroite font échouer le paramètre.

Les deux paramètres peuvent être appliqués à l'échelle du tenant via PowerShell. La commande fondamentale est `Set-Mailbox <identity> -AuditEnabled $true -AuditOwner @{Add="MailItemsAccessed","Send","SearchQueryInitiatedExchange",...} -AuditLogAgeLimit 180.00:00:00`. Le flux d'application de Panoptica365 lance ça sur chaque boîte aux lettres dans le tenant du client quand le paramètre est poussé.

## La dérive de nouvelle boîte aux lettres — la réalité opérationnelle

Voici le piège opérationnel, et c'est le scénario de dérive d'audit de boîte aux lettres canonique :

Vous appliquez la posture stricte d'audit de boîte aux lettres à travers les 32 boîtes aux lettres du client. Les 32 passent la vérification. État du paramètre : Surveillé — OK. Deux semaines plus tard, le client embauche quelqu'un de nouveau. Les RH approvisionnent le compte à travers votre processus standard. Entra ID crée l'utilisateur; M365 approvisionne la boîte aux lettres; l'utilisateur se connecte et commence à travailler.

La boîte aux lettres fraîchement approvisionnée a les paramètres d'audit par défaut de Microsoft. Pas la posture stricte que vous avez configurée pour les 32 existantes. **Les nouvelles boîtes aux lettres n'héritent pas automatiquement de votre configuration d'audit.**

Le détecteur de dérive de Panoptica365 attrape ça. La prochaine fois que le sondage de paramètres de sécurité tourne, la vérification rapporte : « 32 boîtes aux lettres sur 33 ont la posture d'audit stricte. 1 ne l'a pas. » Une alerte de dérive se déclenche.

Vous ouvrez le paramètre de sécurité, appuyez sur l'action d'application, et Panoptica365 réapplique la posture stricte à travers toutes les boîtes aux lettres — y compris la nouvelle. La dérive se résout. Le paramètre retourne à Surveillé — OK. La nouvelle boîte aux lettres a maintenant la même posture d'audit que le reste de la flotte.

Ça va arriver chaque fois qu'une nouvelle boîte aux lettres est créée. Il n'y a pas de mécanisme Microsoft pour auto-appliquer la posture stricte au moment de l'approvisionnement; l'étape de réapplication de l'opérateur est le contournement. Prévoyez-le dans votre flux d'accueil : quand le client ajoute un utilisateur, attendez-vous à une alerte de dérive dans la journée, et lancez la réapplication.

## Ce que Panoptica365 voit

La posture d'audit de boîte aux lettres est l'un des exemples les plus forts du modèle de détection de dérive de Panoptica365 du côté Exchange.

**Deux paramètres de sécurité** surveillés par tenant :
- « Enable Mailbox Auditing for All Users » — vérifie `AuditEnabled` par boîte aux lettres.
- « Strict Mailbox Audit Posture (Bypass + Action List) » — vérifie la propreté de la liste de contournement d'audit et la complétude de la liste d'actions par boîte aux lettres.

**Alertes de dérive** quand l'un des deux paramètres passe de conforme à non conforme — le cas de nouvelle boîte aux lettres étant le déclencheur le plus commun. L'alerte apparaît dans le pipeline d'alertes standard avec attribution au client.

**L'action d'application** sur chaque paramètre, qui lance le PowerShell pertinent à travers toutes les boîtes aux lettres dans le tenant du client pour les ramener à la conformité.

Ce que Panoptica365 ne fait *pas* remonter dans le tableau de bord : le détail de configuration d'audit par boîte aux lettres, le volume d'événements d'audit par boîte aux lettres, le contenu réel du journal d'audit. Pour le journal d'audit lui-même — quels événements ont été enregistrés, quelles recherches ont été lancées, ce que l'attaquant a effectivement accédé — plongez dans la recherche du journal d'audit Microsoft Purview dans le portail Defender.

## Ce qui peut briser

**Le plafond de rétention de 180 jours pour les incidents qui émergent tard.** Une brèche découverte six mois après les faits peut être partiellement hors de la fenêtre d'audit — la plus ancienne activité d'attaquant peut déjà avoir été expirée. La correction est soit E5 / Premium Audit pour une rétention plus longue (la plupart des PME ne paieront pas pour ça), soit une détection plus précoce (ce dont le reste du curriculum parle).

**Entrées de contournement d'audit de comptes de service que vous n'avez pas documentées.** Certains comptes de service légitimes ont AuditBypassEnabled mis pour des raisons opérationnelles valides — un outil de sauvegarde qui touche chaque boîte aux lettres, un archiveur tiers, une plateforme d'intégration. Quand le paramètre de posture d'audit stricte déclenche une alerte de dérive sur une entrée de contournement inattendue, la bonne réponse est d'enquêter, documenter la raison si légitime, et ajouter le compte à une liste d'exceptions de contournement approuvées dans votre runbook. *Ne désactivez pas* simplement la vérification de dérive; c'est comme ça que l'entrée de contournement légitime-d'apparence-mais-malveillante glisse plus tard.

**Préoccupations de bruit d'audit de la part des clients.** Certains clients demandent « êtes-vous en train de lire les courriels de nos employés? » quand ils entendent le mot « audit ». La réponse honnête : l'audit de boîte aux lettres enregistre des *métadonnées sur les événements* (qui a accédé à quoi, quand), pas le contenu des messages. Les entrées du journal d'audit disent « l'utilisateur X a ouvert le message Y à 14 h 23 »; elles ne disent pas ce que le message contenait. Communiquez ça clairement pour éviter la conversation gênante plus tard.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**L'audit de boîte aux lettres est le dossier forensique qui ne vous manque que quand vous en avez besoin.** Les clients ne demandent pas la posture d'audit de boîte aux lettres tant qu'ils n'ont pas été compromis et que l'avocat ne demande pas quelles données ont été exfiltrées. À ce moment-là, la configuration d'audit est fixée; vous ne pouvez pas rétroactivement décider d'avoir journalisé MailItemsAccessed. Mettez-la stricte, mettez-la sur toutes les boîtes aux lettres, acceptez le rythme dérive-et-réapplique comme coût opérationnel permanent.

**Les nouvelles boîtes aux lettres sont la source de dérive récurrente.** Chaque nouvel utilisateur approvisionné crée une boîte aux lettres avec les paramètres d'audit par défaut de Microsoft — pas votre configuration stricte. L'alerte de dérive est le signal; la réapplication est le flux de travail. Les guides d'accueil devraient explicitement inclure « attendre l'alerte de dérive Panoptica365, lancer la réapplication » comme étape.

**La liste de contournement, c'est l'endroit où l'attaquant se cache.** Périodiquement — et certainement comme partie de tout triage de réponse à incident — auditez la propriété AuditBypassEnabled à travers toutes les boîtes aux lettres. Une entrée inattendue mérite enquête jusqu'à preuve de légitimité. La posture stricte d'audit attrape la dérive de routine; l'œil de l'opérateur attrape la rare dérive adversariale.

## Ce qui suit

- **Leçon 7 : Politiques de quarantaine et libération par l'utilisateur.** Qui peut libérer les messages en quarantaine, pourquoi les défauts sont dangereux, et comment la libération de quarantaine ciblant les utilisateurs devient un vecteur de suivi BEC.
- **Leçon 8 : Règles de flux de courrier et MailTips.** Les règles de transport — le pouvoir qu'elles donnent aux opérateurs et l'abus qu'elles permettent quand configurées librement.

Pour l'instant : ouvrez le panneau des paramètres de sécurité du client dans Panoptica365. Trouvez les deux paramètres d'audit de boîte aux lettres. S'ils ne sont pas verts, appliquez-les maintenant. La première application peut prendre quelques minutes pour un grand nombre de boîtes aux lettres; les applications suivantes (après les dérives de nouvelle boîte aux lettres) sont rapides. Préparez le client pour la bonne réponse à la question que l'avocat finira par poser.

---

*Sources des données dans cette leçon — Microsoft Learn sur la vue d'ensemble de l'audit de boîte aux lettres et les actions par défaut ([Microsoft Learn — Manage mailbox auditing](https://learn.microsoft.com/en-us/purview/audit-mailboxes)); référence des paramètres d'audit Set-Mailbox ([Microsoft Learn — Set-Mailbox](https://learn.microsoft.com/en-us/powershell/module/exchange/set-mailbox)); MailItemsAccessed et changements de disponibilité de l'audit Premium ([Microsoft Learn — Audit Solutions in Microsoft Purview](https://learn.microsoft.com/en-us/purview/audit-solutions-overview)); référence Set-MailboxAuditBypassAssociation ([Microsoft Learn — Set-MailboxAuditBypassAssociation](https://learn.microsoft.com/en-us/powershell/module/exchange/set-mailboxauditbypassassociation)); flux de recherche du Unified Audit Log ([Microsoft Learn — Audit log search](https://learn.microsoft.com/en-us/purview/audit-log-search)).*
