---
title: "Politiques de quarantaine et libération par l'utilisateur — là où les bons défauts vont mourir"
subtitle: "Restreindre les permissions de libération de quarantaine pour que les utilisateurs finaux ne puissent pas libérer eux-mêmes du hameçonnage à haute confiance."
icon: "inbox"
last_updated: 2026-05-29
---

# Politiques de quarantaine et libération par l'utilisateur — là où les bons défauts vont mourir

L'assistante du PDG d'un client reçoit un courriel quotidien de notification de quarantaine de la part de Microsoft. Sujet : « Vous avez 3 messages en quarantaine. » Le corps liste trois messages avec l'expéditeur, le sujet, et un bouton Libérer à côté de chacun.

Un des trois vient de quelqu'un qu'elle ne reconnaît pas, avec un sujet comme « Votre enveloppe DocuSign est prête pour signature. » Elle n'attendait pas d'enveloppe DocuSign. Mais le PDG signe des choses tout le temps, et elle gère son calendrier, et peut-être que c'est quelque chose qu'il doit voir, et elle ne veut pas avoir l'air de l'assistante qui a bloqué quelque chose d'important. Elle clique sur Libérer.

Le message arrive dans sa boîte de réception. Elle l'ouvre. Elle clique sur le lien à l'effigie DocuSign. Le lien va vers un récolteur d'identifiants tournant sur un domaine fraîchement enregistré avec un certificat Let's Encrypt valide. Elle tape les identifiants du PDG, parce que le PDG lui avait demandé de gérer DocuSign pour lui, et elle a le mot de passe. L'attaquant capture à la fois l'identifiant et le cookie de session. Douze minutes plus tard, l'attaquant est dans la boîte aux lettres du PDG.

L'assistante a fait exactement ce que la notification de quarantaine par défaut de Microsoft l'*invitait à faire*. Elle avait un bouton Libérer. Elle l'a utilisé.

C'est le vecteur de suivi BEC qui reçoit moins d'attention qu'il ne le mérite : même quand Defender met avec succès en quarantaine un courriel d'hameçonnage, l'utilisateur du client lui-même peut le libérer dans la boîte de réception en un clic. La défense contre l'hameçonnage existe; la défense contre l'utilisateur qui défait la défense, c'est ce dont cette leçon parle.

## Les quatre (ou cinq) catégories de quarantaine

Microsoft classe les messages en quarantaine en catégories distinctes, chacune avec ses propres règles de libération par défaut. Connaître les catégories compte parce que la bonne configuration est *spécifique à la catégorie*.

- **Spam** (pourriel à faible confiance) — messages que Microsoft soupçonne d'être du pourriel avec confiance modérée. Défaut : les utilisateurs peuvent libérer avec notification.
- **Pourriel à haute confiance** — Microsoft est plus certain. Défaut : les utilisateurs peuvent libérer avec notification.
- **Bulk** — courrier de masse style infolettre. Défaut : les utilisateurs peuvent libérer avec notification.
- **Phishing** — Microsoft soupçonne que c'est une tentative d'hameçonnage. Défaut : l'admin doit libérer.
- **Hameçonnage à haute confiance** — Microsoft est hautement confiant. Défaut : l'admin doit libérer; le message ne peut pas être libéré par les utilisateurs.
- **Maliciel** — pièce jointe ou lien a correspondu à un patron malveillant. Défaut : l'admin doit libérer.
- **Spoof** — l'authentification de l'expéditeur (SPF/DKIM/DMARC) a échoué d'une façon qui suggère une usurpation d'expéditeur. Défaut variable selon la configuration du tenant.

Les défauts sont raisonnables pour les catégories à haute confiance (l'admin doit libérer) et *dangereux* pour celles à plus faible confiance (les utilisateurs peuvent libérer). L'anecdote d'ouverture est arrivée parce que l'assistante a reçu un message classé comme Phishing (pas haute confiance) avec la configuration plus ancienne par défaut qui laissait les utilisateurs libérer l'hameçonnage à plus faible confiance — et Microsoft a resserré les défauts depuis, mais les tenants clients qui ont été configurés il y a des années peuvent encore porter les paramètres plus permissifs.

## Politiques de quarantaine — l'objet de configuration

Une **politique de quarantaine** dans M365 est l'objet qui définit ce que les utilisateurs sont autorisés à faire avec les messages en quarantaine. Microsoft livre trois politiques préréglées; vous pouvez en créer des personnalisées.

Les préréglages :

- **AdminOnlyAccessPolicy** — les utilisateurs n'obtiennent aucune capacité de libération du tout. Ils peuvent voir les messages en quarantaine (si la notification est activée) mais ne peuvent pas les libérer. L'admin est le seul qui peut. La posture la plus stricte.
- **DefaultFullAccessPolicy** — les utilisateurs peuvent demander une libération (l'admin approuve encore) et peuvent prévisualiser les messages. Pas de notifications.
- **DefaultFullAccessWithNotificationPolicy** — pareil que DefaultFullAccessPolicy mais avec les notifications de quarantaine activées. Le défaut le plus permissif de Microsoft.

Les politiques personnalisées vous laissent panacher : activer des actions spécifiques (demander libération, prévisualiser, bloquer l'expéditeur), spécifier si les notifications sont envoyées, et choisir à quel point la cadence de notification est agressive.

La configuration qui compte pour le durcissement PME : **appliquer AdminOnlyAccessPolicy aux catégories dangereuses** (Phishing, hameçonnage à haute confiance, Maliciel, Spoof). Les utilisateurs ne peuvent jamais libérer les messages dans ces catégories sans l'approbation de l'opérateur. Pour les catégories à plus faible confiance (Spam, Bulk), la DefaultFullAccessWithNotificationPolicy plus permissive est défendable — ce sont habituellement du courriel marketing ou du bruit, et donner aux utilisateurs un libre-service pour ceux-là réduit la charge du support.

## Cadence des notifications de quarantaine

Séparément des politiques elles-mêmes, M365 contrôle à quelle fréquence les utilisateurs reçoivent le courriel digest « vous avez des messages en quarantaine ». La fréquence de notification peut être réglée par politique de quarantaine (dans les configurations plus récentes) ou via un paramètre global (dans les plus anciennes).

Cadences communes :

- **Quotidien** — le défaut. Un courriel par jour avec les messages mis en quarantaine de la journée.
- **Toutes les 4 heures** — plus agressif; pour les boîtes aux lettres à fort volume.
- **Désactivé** — aucune notification du tout. Les utilisateurs doivent activement vérifier le portail de quarantaine s'ils veulent voir ce qui a été bloqué.

Pour les clients PME, quotidien est habituellement le bon équilibre. Des notifications plus fréquentes génèrent du bruit; désactivé génère des tickets « je n'ai jamais reçu X » parce que les utilisateurs ne pensent pas à vérifier le portail.

## Le suivi BEC — pourquoi les défauts comptent

L'anecdote d'ouverture n'est pas hypothétique. C'est le deuxième vecteur de suivi le plus commun après le transfert automatique (leçon 5). La séquence d'attaque est cohérente à travers les incidents :

1. L'attaquant envoie un courriel d'hameçonnage construit pour avoir l'air d'une communication d'affaires légitime (DocuSign, facture, RH interne, expiration de mot de passe TI).
2. Le courriel atterrit en quarantaine parce que le classificateur anti-hameçonnage de Microsoft le signale — mais avec une classification Phishing (pas haute confiance), parce que le message est techniquement bien formé et utilise une infrastructure d'hébergement légitime.
3. L'utilisateur reçoit la notification de quarantaine, voit un sujet d'apparence plausible d'affaires, ne veut pas retarder quelque chose d'important, clique Libérer.
4. Le message arrive dans la boîte de réception. L'utilisateur clique sur le lien. Les identifiants sont capturés. Le cookie de session est capturé. La boîte aux lettres est compromise.

La défense, c'est de retirer le bouton Libérer pour les catégories dangereuses. Configurez tout de Phishing, hameçonnage à haute confiance, Maliciel, et Spoof à AdminOnlyAccessPolicy. La notification peut encore venir (pour que l'utilisateur sache que son courriel a été mis en quarantaine et puisse demander à l'opérateur d'enquêter), mais le bouton Libérer n'est pas là. L'utilisateur doit appeler le support.

Ça ajoute de la charge opérationnelle — les opérateurs traitent maintenant les tickets « libérer mon message en quarantaine ». Le compromis est intentionnel : chaque ticket de demande-de-libération est une occasion de regarder le message, vérifier qu'il est légitime, et soit le libérer soit utiliser la conversation pour éduquer l'utilisateur sur ce qu'il a presque cliqué. La conversation de cinq minutes est pas chère; l'incident de fraude par virement est cher.

## Les politiques de sécurité prédéfinies rendent ça plus facile

Les politiques de sécurité prédéfinies de Microsoft (Standard et Strict — la leçon 10 les couvre en détail) incluent des configurations de politique de quarantaine. Le préréglage Standard assigne la politique d'accès stricte (AdminOnlyAccessPolicy) aux catégories Hameçonnage à haute confiance, Maliciel et Spoof par défaut. Le préréglage Strict étend ça à Phishing aussi.

Si vous avez appliqué le préréglage Standard ou Strict au client (couvert dans la leçon 3 et la leçon 10), la configuration de quarantaine est partiellement gérée. Ce que les préréglages ne remplacent pas, c'est la cadence et le mappage de politique par catégorie pour Spam et Bulk — ce sont encore des décisions spécifiques au tenant.

Ce qu'il faut retenir : si vous déployez les politiques de sécurité prédéfinies et que vous ne personnalisez pas davantage la quarantaine, vous avez déjà obtenu le blocage de libération des catégories dangereuses. Si vous configurez les politiques de quarantaine indépendamment des préréglages, vous devez rendre l'assignation AdminOnly explicite pour chaque catégorie dangereuse.

## Le flux de travail opérateur — libérer pour le compte de l'utilisateur

Quand AdminOnlyAccessPolicy est en place et qu'un utilisateur appelle pour demander une libération :

1. **Ouvrez le portail de quarantaine** (portail Defender → Email & collaboration → Review → Quarantine). Cherchez le message par destinataire, expéditeur, ou sujet.
2. **Prévisualisez le message** avant de libérer. Lisez le corps. Regardez les liens. Regardez les détails de l'expéditeur — y compris l'adresse expéditrice réelle (pas juste le nom d'affichage). Regardez les en-têtes si le message est à la limite.
3. **Vérifiez avec l'utilisateur** ce à quoi il s'attendait. « Vous dites que c'est de Bob sur la facture — est-ce que ça correspond à ce que Bob enverrait normalement? Est-ce que le lien va où vous l'attendez? »
4. **Libérez si légitime; rapportez-comme-hameçonnage sinon.** Le portail Defender de Microsoft vous laisse libérer avec une option de « soumettre à Microsoft pour révision » — ça entraîne le classificateur Microsoft et aide des messages légitimes similaires à passer automatiquement à l'avenir.

C'est un flux de travail de 3 à 5 minutes par requête. Pour les clients avec beaucoup de libérations, traitez-les par lots — gérez la file une ou deux fois par jour plutôt que de réagir à chaque appel. Pour les clients à fort volume, envisagez de resserrer le réglage anti-hameçonnage ou anti-pourriel pour que moins de messages légitimes atterrissent en quarantaine.

## Ce que Panoptica365 voit

La configuration des politiques de quarantaine fait partie de ce que les **politiques de sécurité prédéfinies** gouvernent. Le paramètre de sécurité Panoptica365 « Enable Preset Security Policy (Standard or Strict) — MDO » pousse l'activation du préréglage sur le tenant du client, et le détecteur de dérive surveille s'il reste activé. Si un admin du client ouvre le portail Defender et désactive le préréglage — ou crée une politique de quarantaine personnalisée avec des droits de libération permissifs qui remplacent le préréglage — le signal de dérive est l'avertissement précoce.

**Les alertes Defender XDR** coulent dans le moteur d'alertes de Panoptica365 quand MDO fait remonter des événements de haute gravité liés aux libérations de quarantaine initiées par l'utilisateur de messages suspects. Celles-ci apparaissent dans le pipeline d'alertes standard.

Ce que Panoptica365 ne fait *pas* remonter dans le tableau de bord : des explorateurs de file de quarantaine par tenant, un flux d'approbation de demande-de-libération par message, un historique d'activité de libération par utilisateur. La file de quarantaine elle-même, la prévisualisation par message, l'action d'approbation de libération — tout ça se passe dans le portail Microsoft Defender. Panoptica365 surveille la *configuration* du système de quarantaine; l'*opération* de la file de quarantaine est une surface Microsoft.

## Ce qui peut briser

**Plaintes de clients sur des messages « pris dans la quarantaine ».** Quand AdminOnlyAccessPolicy est en place, les utilisateurs ne peuvent vraiment pas libérer leurs propres messages. Ils vont appeler. Certains clients vivent ça comme une dégradation. Encadrez-le explicitement pendant la conversation avec le client comme « on vous protège du patron d'attaque AiTM-et-libération; le compromis, c'est que vous nous appelez pour libérer les messages ambigus, et on prend cinq minutes pour vérifier ». La plupart des clients acceptent ça une fois le compromis expliqué.

**Courriel marketing ou transactionnel légitime mis en quarantaine de façon répétée.** Factures de fournisseurs, enveloppes DocuSign, invitations de calendrier de tiers — n'importe quel système qui envoie du courrier avec des caractéristiques que Microsoft note comme adjacentes à l'hameçonnage. La correction est soit d'authentifier l'expéditeur correctement (leçon 4), soit d'ajouter le domaine de l'expéditeur à la liste d'expéditeurs de confiance anti-hameçonnage (leçon 2). Pas de créer une politique de quarantaine permissive.

**Notifications de quarantaine qui vont dans les indésirables.** Les utilisateurs mettent parfois en place des règles qui déplacent tous les courriels d'expéditeurs « noreply@ » vers les indésirables, y compris le digest de quarantaine de Microsoft. Puis ils se plaignent qu'ils ne savent pas pour les messages en quarantaine. Diagnostiquez pendant l'accueil et éduquez l'utilisateur.

**Anciennes politiques de quarantaine personnalisées laissées par d'anciens admins.** Certains tenants clients ont des politiques de quarantaine personnalisées héritées de migrations ou de MSP précédents. Auditez-les pendant le pré-vol (leçon 1) et soit alignez-les avec le modèle de préréglage Standard/Strict, soit reconstruisez-les explicitement.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**La libération de quarantaine par défaut est un vecteur de suivi BEC.** Les défauts de Microsoft laissent les utilisateurs libérer eux-mêmes les messages d'hameçonnage à plus faible confiance. L'assistante dans l'histoire d'ouverture est la victime récurrente. Mettez AdminOnlyAccessPolicy sur Phishing, hameçonnage à haute confiance, Maliciel et Spoof — au minimum.

**Soit vous déployez les préréglages, soit vous configurez explicitement les politiques de quarantaine.** Le préréglage Standard ou Strict gère la configuration de libération admin-seulement pour les catégories dangereuses. Si vous n'utilisez pas les préréglages, chaque catégorie a besoin d'une assignation de politique explicite. Il n'y a pas de troisième option qui soit sûre.

**Libérer-pour-le-compte-de est un flux de travail opérateur de cinq minutes, et ça vaut la peine de le faire correctement.** Quand les utilisateurs appellent pour libérer un message, c'est le moment de vérifier l'expéditeur, prévisualiser le lien, et soit libérer avec confiance, soit utiliser l'appel pour éduquer. La charge opérationnelle est réelle mais proportionnelle à la protection — et les conversations elles-mêmes entraînent les utilisateurs des clients à être plus sceptiques face au prochain hameçonnage.

## Ce qui suit

- **Leçon 8 : Règles de flux de courrier et MailTips.** Les règles de transport — l'objet de configuration qui donne aux opérateurs un contrôle chirurgical sur la gestion des messages, et le patron d'abus quand utilisées trop largement.
- **Leçon 9 : Pourriel sortant et SMTP AUTH.** Les contrôles du rayon d'impact post-compromission — ce qui arrive quand la boîte aux lettres d'un client est celle qui envoie l'hameçonnage.

Pour l'instant : ouvrez les politiques de quarantaine du client dans le portail Defender. Vérifiez que Phishing, hameçonnage à haute confiance, Maliciel et Spoof sont mappés à AdminOnlyAccessPolicy (ou que la politique de sécurité prédéfinie est activée et fournit le même effet). Vérifiez que la cadence de notification est quotidienne, pas désactivée. L'assistante dans l'histoire d'ouverture n'obtient pas son bouton Libérer cette semaine; vous dormez mieux par conséquent.

---

*Sources des données dans cette leçon — Microsoft Learn sur la vue d'ensemble des politiques de quarantaine ([Microsoft Learn — Quarantine policies](https://learn.microsoft.com/en-us/defender-office-365/quarantine-policies)); créer et assigner des politiques de quarantaine personnalisées ([Microsoft Learn — Manage quarantine policies](https://learn.microsoft.com/en-us/defender-office-365/quarantine-policies-configure)); référence de comportement de libération de quarantaine par l'utilisateur ([Microsoft Learn — Quarantine user permissions](https://learn.microsoft.com/en-us/defender-office-365/quarantine-end-user)); configuration des notifications de quarantaine ([Microsoft Learn — Quarantine notifications](https://learn.microsoft.com/en-us/defender-office-365/quarantine-policies#quarantine-notifications)); politiques de sécurité prédéfinies et leurs effets sur la quarantaine ([Microsoft Learn — Preset security policies](https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies)).*
