---
title: "Durcissement courriel — pré-vol — ce qu'il faut savoir avant de toucher à un seul paramètre"
subtitle: "Réalité des licences, inventaire préalable et erreurs courantes à éviter avant de commencer le durcissement courriel."
icon: "clipboard-check"
last_updated: 2026-05-29
---

# Durcissement courriel — pré-vol — ce qu'il faut savoir avant de toucher à un seul paramètre

Le contrôleur d'un client reçoit un courriel du PDG. Urgent — un fournisseur en difficulté, besoin d'un virement de 84 000 $ vers un nouveau compte avant la fin de la journée. Le contrôleur fait le virement. Douze heures plus tard, le vrai PDG revient d'un vol et demande à quoi servait le virement. Le courriel était falsifié. Le « fournisseur » était un compte mule roumain. L'assurance du client en couvre la moitié. L'avocat du client demande au MSP, poliment au début et de moins en moins ensuite, pourquoi les défenses de courriel qu'il paie n'ont pas attrapé ça.

Le post-mortem est déprimant dans ses détails :

- Le domaine du client n'avait aucun enregistrement DMARC. SPF était à `~all` (soft-fail), ce que Microsoft 365 acceptait quand même parce que rejeter aurait été « trop perturbateur ».
- La politique anti-hameçonnage était celle par défaut de Microsoft. La protection contre l'usurpation d'identité pour le PDG n'était pas activée. L'anti-spoofing n'était pas réglé.
- Safe Links était sous licence (Business Premium inclut Defender for Office 365 Plan 1) mais n'avait jamais été configuré. Le lien cliquable dans le courriel d'instructions de virement était une redirection non encapsulée vers une page de récolte d'identifiants.
- La libération de quarantaine était sur le défaut Microsoft par utilisateur, donc même si le message avait été mis en quarantaine, la contrôleuse aurait pu le libérer elle-même.
- Le client payait pour toute cette protection. Chaque mois. Depuis des années.

La carte 5 vise à combler cet écart. L'environnement courriel du client est la surface la plus attaquée dans M365 — hameçonnage, BEC, usurpation d'identité, maliciel, attaques de consentement OAuth arrivent toutes par courriel — et les défauts de Microsoft sont réglés pour la compatibilité, pas pour la sécurité. Le travail de la carte 5, c'est de prendre les défenses qui sont *disponibles* et *payées* et de les *activer pour de vrai, réglées correctement, avec la bonne discipline autour des flux de travail humains*.

Cette leçon est le pré-vol : la réalité des licences, l'inventaire dont vous avez besoin avant de toucher à un paramètre, ce que M365 livre déjà configuré, et les erreurs communes que les opérateurs font avant même de commencer.

## La réalité des licences — ce que vous avez, ce que vous n'avez pas

La défense courriel dans M365 se déploie sur trois services en couches. Savoir lesquels le client possède est le prérequis pour tout le reste de la carte 5.

**Exchange Online Protection (EOP).** Gratuit, inclus avec n'importe quelle licence de boîte aux lettres M365. EOP est la couche anti-pourriel, anti-maliciel, filtrage de connexion. Il attrape le gros du pourriel évident et des maliciels connus. Chaque tenant M365 l'a. Vous ne payez pas plus pour lui, mais vous devez quand même le configurer — les défauts sont délibérément permissifs.

**Defender for Office 365 Plan 1 (MDO P1).** Inclus avec Microsoft 365 Business Premium, la licence sur laquelle à peu près chaque client MSP PME devrait être. Ajoute Safe Links (réécriture d'URL et évaluation au moment du clic), Safe Attachments (détonation en bac à sable des pièces jointes), détections en temps réel, et anti-hameçonnage amélioré (mailbox intelligence, protection contre l'usurpation d'identité d'utilisateur, protection contre l'usurpation de domaine). C'est la mise à niveau significative par rapport à EOP et celle que les clients paient typiquement déjà sans s'en rendre compte. La plus grande partie de la carte 5 suppose que vous avez P1.

**Defender for Office 365 Plan 2 (MDO P2).** Inclus avec Microsoft 365 E5 / A5 / G5 (SKU de niveau entreprise). Ajoute Threat Explorer, l'investigation et la réponse automatisées, la formation par simulation d'attaque, et les traqueurs de menaces. Presque aucun client PME n'a ça. On mentionnera les fonctionnalités P2 au passage quand c'est pertinent; on ne s'y attardera pas. Si votre client a E5, vous le saurez, et vous voudrez vous appuyer sur la documentation Microsoft Learn pour ces fonctionnalités spécifiquement plutôt que de vous attendre à ce que la carte 5 les couvre en profondeur.

La chose à internaliser : les clients Business Premium ont une mise à niveau de sécurité significative par rapport à Business Standard, mais la mise à niveau ne compte que si vous l'activez pour de vrai. Le client de l'anecdote d'ouverture en fraude par virement payait pour P1 tout le temps. Le MSP n'avait juste pas configuré Safe Links.

## Ce que M365 livre, déjà configuré

Microsoft configure bien *certaines* défenses courriel d'emblée. Le truc, c'est de savoir lesquelles, parce qu'elles sont souvent plus faibles que les opérateurs le supposent.

**Déjà activées, avec valeurs par défaut :**

- La politique anti-pourriel entrante par défaut. Attrape le pourriel évident (niveau de confiance pourriel élevé). Le seuil de courriel en masse est mis à 7 (milieu de gamme — laisse passer la plupart du marketing). La libération de quarantaine par l'utilisateur est permise.
- La politique anti-maliciel par défaut. Attrape les pièces jointes connues-malveillantes par correspondance de hash. Extensions de fichiers communes bloquées (.exe, .bat, .cmd, et quelques autres).
- La politique anti-hameçonnage par défaut. Anti-spoofing activé. Protection anti-hameçonnage *usurpation d'identité d'utilisateur* — **pas configurée par défaut**. Protection contre l'*usurpation de domaine* — **pas configurée par défaut**.
- Politique de filtre de connexion. Aucune liste IP d'autorisation ou de blocage par défaut.
- DKIM par défaut. Microsoft génère automatiquement une clé DKIM pour le domaine `onmicrosoft.com` du tenant seulement. Les domaines personnalisés exigent une configuration manuelle.

**Pas configurées par défaut — vous devez les activer :**

- Politiques Safe Links. Même avec la licence P1, Safe Links n'est pas activé pour les utilisateurs tant que vous ne créez pas une politique et que vous ne l'assignez pas à des groupes d'utilisateurs.
- Politiques Safe Attachments. Pareil — licence présente, fonctionnalité éteinte tant que vous ne configurez pas.
- DMARC. DNS du client, responsabilité du client (ou du MSP). M365 ne publie pas d'enregistrements DMARC pour vous.
- DKIM pour domaines personnalisés. Les clés DKIM existent; vous devez publier les CNAME dans DNS et activer la signature par domaine.
- Transfert automatique vers domaines externes. Microsoft a resserré les défauts en 2020 pour bloquer ça, mais des listes d'exceptions par client peuvent encore exister depuis des projets de migration.
- Protection anti-pourriel sortante (restrictions personnalisées). La politique sortante par défaut est permissive — une boîte aux lettres compromise peut envoyer beaucoup de courriel avant de déclencher les seuils par défaut.
- Règles de flux de courrier (transport rules). Aucune par défaut.
- Journalisation de l'audit de boîte aux lettres en mode strict. L'audit est activé par défaut depuis 2019, mais l'ensemble *strict* des actions auditées (celles qui attrapent les artefacts BEC) a besoin d'une configuration explicite.

Le patron : Microsoft livre le plancher. La licence couvre le plafond. La carte 5 vise à élever la posture du client du plancher au plafond.

## Inventaire — sachez ce que vous durcissez

Avant de toucher à un seul paramètre, tirez ces faits sur l'environnement du client :

**Boîtes aux lettres.** Combien? Lancez `Get-Mailbox` dans Exchange Online PowerShell ou tirez le compte du centre d'administration Microsoft 365. Notez la répartition :

- Boîtes aux lettres utilisateur (vrais humains).
- Boîtes aux lettres partagées (accès délégué; souvent faiblement protégées et souvent la source des histoires « l'assistant du PDG s'est fait hameçonner »).
- Boîtes aux lettres de ressources (salles, équipement).
- Groupes de distribution et groupes Microsoft 365.

Pour un petit client, c'est 10 à 50 entités; pour un moyen, 100 à 300. Dans tous les cas, *écrivez l'inventaire*. Vous y reviendrez pour la portée de libération de quarantaine, la portée de posture d'audit de boîte aux lettres, et la portée de protection contre l'usurpation d'identité.

**Domaines.** Chaque domaine accepté dans le tenant. Le domaine principal (utilisé dans les UPN des utilisateurs), les domaines vanity (domaines acceptés additionnels d'où le client envoie), les domaines hérités (issus d'acquisitions ou de changements de marque), le défaut `onmicrosoft.com` (le repli plancher). Pour chacun, notez :

- L'enregistrement SPF actuel (DNS TXT — commencez avec `v=spf1 include:spf.protection.outlook.com -all` comme état cible).
- L'état DKIM actuel (activé par domaine? CNAME publiés?).
- L'enregistrement DMARC actuel (publié? `p=none` / `p=quarantine` / `p=reject`?).
- Si le domaine est utilisé en sortie de M365 du tout (certains domaines hérités existent seulement pour recevoir; ceux-là ont aussi besoin de DMARC).

**Flux de courrier actuel.** Ouvrez le centre d'administration Exchange, naviguez vers Mail flow → Rules. Lisez chaque règle. Documentez le but. Beaucoup de clients ont une couche de sédiment de règles de transport venant d'anciens admins faisant des anciennes choses — vieilles règles « si le sujet contient [URGENT] alors importance élevée », vieux avertissements destinataire-externe qui ne se déclenchent plus, vieilles règles de blocage d'exécutables rendues obsolètes par Safe Attachments. La leçon 8 vise à dompter ça; pour le pré-vol, sachez juste ce qui est là.

**État de protection actuel.** Un audit rapide de la posture actuelle avec `Get-AntiPhishPolicy`, `Get-SafeLinksPolicy`, `Get-SafeAttachmentPolicy`, et `Get-HostedContentFilterPolicy` (la politique anti-pourriel). Pour chacune, notez : est-ce la politique Microsoft par défaut, ou l'admin précédent l'a-t-il personnalisée? Les politiques personnalisées dans des états inconnus sont la source la plus commune de tickets « on a déployé Safe Links mais rien ne s'est passé ».

## Ce que le client s'attend à voir

C'est la partie molle du pré-vol, et celle que les opérateurs sautent. La défense courriel brise constamment les flux de travail des clients — les défenses réglées pour l'hameçonnage attrapent du marketing légitime; un DMARC resserré sort du courrier la plateforme marketing mal configurée du client lui-même; un Safe Attachments agressif retarde un PDF important d'un cadre de 90 secondes. Les clients sentent ça comme de la friction.

Documentez, dans le ticket ou le dossier de changement, avant de déployer :

- Qui chez le client est autorisé à libérer les messages de quarantaine? Tout-le-monde-par-défaut est dangereux; admin-seulement-par-défaut est restrictif. Souvent la bonne réponse est « le gestionnaire du contrôleur plus une ou deux personnes de confiance », et ça doit être communiqué et configuré.
- Y a-t-il des expéditeurs dont le client reçoit régulièrement du courriel qui risquent de déclencher les contrôles d'usurpation d'identité ou d'anti-hameçonnage? (Fournisseurs dont les domaines sont similaires à celui du client; plateformes marketing légitimes avec DKIM faible; applications SaaS qui envoient depuis un SMTP tiers.)
- Y a-t-il un domaine qui *ne devrait pas être durci* tout de suite parce que l'équipe marketing du client utilise une plateforme tierce pour envoyer sous ce domaine et n'a pas réglé son SPF? (Commun; c'est la bonne portée pour une conversation séparée.)
- Y a-t-il des exigences de conformité qui affectent la rétention, la conservation légale, ou les politiques de quarantaine? (Commun en santé, finance, et marchés publics.)

## Erreurs communes que les opérateurs font avant même de commencer

Trois patrons remontent à répétition :

**Supposer que « Microsoft nous couvre ».** Pas vraiment. Les défauts sont le plancher, pas le plafond. Auditer l'état actuel avant de supposer qu'une protection existe a sauvé plus de clients que n'importe quel changement de politique unique.

**Sauter DMARC parce que « c'est compliqué ».** Ce n'est pas compliqué, c'est *demandant* — il y a un parcours de `p=none` (observer) à `p=quarantine` à `p=reject` (appliquer). La leçon 4 le parcourt. Sauter DMARC, c'est comme ça que commence l'anecdote de fraude par virement en haut de cette leçon.

**Ne pas auditer les règles de flux de courrier du client.** Trois ans de règles de transport accumulées de la part d'anciens admins, c'est un dégât. Parfois il y a une règle qui route le courrier de `*@finance.com` vers une seule boîte aux lettres à cause d'une fusion oubliée depuis longtemps. Parfois il y a une règle qui désactive Safe Links sur certain courrier entrant parce qu'un fournisseur s'est plaint. Parfois il y a une règle qui transfère automatiquement *n'importe quoi* qui correspond à une regex vers une adresse externe parce que quelqu'un a débogué un problème en 2021 et a oublié de nettoyer. Trouvez-les. Documentez-les. Réparez-les ou enlevez-les. (Leçon 8.)

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**La réalité des licences est le prérequis.** Confirmez ce que le client a (EOP seulement / MDO P1 / MDO P2) avant de promettre n'importe laquelle des défenses de la carte 5. La plupart des clients PME ont MDO P1 via Business Premium; la plupart ne l'utilisent pas.

**Activé-par-défaut ne veut pas dire sécurisé-par-défaut.** Microsoft livre un plancher utilisable — l'anti-pourriel roule, les maliciels connus sont bloqués, l'anti-spoofing de base existe. Rien de ça n'est réglé. Le travail de la carte 5, c'est d'élever du plancher au plafond pour chaque fonctionnalité.

**Inventaire avant configuration.** Boîtes aux lettres, domaines, SPF/DKIM/DMARC actuels, règles de flux de courrier existantes, politiques personnalisées existantes. Sans cette liste, vous configurerez la moitié d'une passe de durcissement et re-briserez la moitié que vous avez manquée quand un ticket client fait surgir une règle que vous ne connaissiez pas.

## Ce qui suit

- **Leçon 2 : Politiques anti-hameçonnage.** Protection contre l'usurpation d'identité d'utilisateur et de domaine, spoof intelligence, mailbox intelligence — transformer la défense contre l'usurpation d'identité par défaut désactivée de Microsoft en quelque chose qui attrape vraiment l'anecdote BEC en haut de cette leçon.
- **Leçon 3 : Safe Links et Safe Attachments.** Les fonctionnalités MDO P1 que les clients ont payées sans les utiliser.
- **Leçon 4 : SPF, DKIM, DMARC.** Le trio d'authentification qui aurait attrapé le courriel falsifié dans l'histoire d'ouverture.

Pour l'instant : écrivez l'inventaire, auditez la configuration actuelle, ajustez les attentes du client sur ce qui est sur le point de changer. Le reste de la carte 5 se bâtit sur cette fondation.

---

*Sources des données dans cette leçon — Microsoft Learn sur Exchange Online Protection — vue d'ensemble ([Microsoft Learn — EOP overview](https://learn.microsoft.com/en-us/defender-office-365/eop-about)); description de service Defender for Office 365 ([Microsoft Learn — MDO service description](https://learn.microsoft.com/en-us/office365/servicedescriptions/office-365-advanced-threat-protection-service-description)); liste de fonctionnalités Microsoft 365 Business Premium ([Microsoft Learn — Business Premium for SMB](https://learn.microsoft.com/en-us/microsoft-365/business-premium/)); référence des politiques de sécurité prédéfinies ([Microsoft Learn — Preset security policies](https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies)); blocage du transfert automatique vers domaines externes ([Microsoft Learn — External email forwarding](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-policies-external-email-forwarding)); Set-MailboxAuditBypassAssociation et baseline d'audit ([Microsoft Learn — Mailbox audit logging](https://learn.microsoft.com/en-us/purview/audit-mailboxes)).*
