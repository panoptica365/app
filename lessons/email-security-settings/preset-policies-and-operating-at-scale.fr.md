---
title: "Politiques de sécurité prédéfinies et opérer la sécurité courriel à grande échelle"
subtitle: "Utiliser les politiques Standard et Strict de Microsoft pour imposer une posture courriel cohérente sur tous les tenants gérés."
icon: "layers"
last_updated: 2026-05-29
---

# Politiques de sécurité prédéfinies et opérer la sécurité courriel à grande échelle

Un tech junior, deux semaines dans le poste, demande au senior un mardi après-midi : « C'est quand la dernière fois que tu as regardé les paramètres de sécurité du Client X? »

Le senior réfléchit une seconde. « Honnêtement? Leur revue annuelle il y a six mois. Avant ça, l'accueil en 2024. »

« Donc tu ne les *vérifies* pas? »

« Je ne *vérifie* pas. Panoptica365 vérifie. Chaque cycle de sondage, chaque paramètre, chaque client. Si quelque chose dérive — quelqu'un éteint MailTips parce qu'un utilisateur s'est plaint, une nouvelle boîte aux lettres se fait créer et n'hérite pas de la posture d'audit stricte, l'action de la politique anti-pourriel sortante est affaiblie — j'ai une alerte. J'agis sur l'alerte. Puis je passe. Le panneau des paramètres, c'est là que je vais *quand une alerte se déclenche*, pas un endroit où je patrouille. »

« Donc tu fais vraiment ça en mode set-and-forget? »

« Mettre, configurer, documenter les exceptions dans les notes du client, puis oui — laisser le détecteur de dérive surveiller. La file d'alertes, c'est là que je passe mon temps. C'est tout le but du modèle. Sans ça, j'ouvrirais 28 tableaux de bord clients chaque lundi matin pour vérifier que rien n'a changé. Avec ça, les changements viennent me trouver. »

Cette leçon parle de comment ça se met à l'échelle. Les politiques de sécurité prédéfinies Standard et Strict qui vous donnent la plupart des contrôles de la carte 5 en un bundle. Le modèle opérationnel piloté par les alertes qui transforme un carnet de 28 clients en file de triage gérable plutôt qu'en corvée d'inspection manuelle. La plongée annuelle en profondeur qui attrape les choses que la détection de dérive ne peut pas. Et le registre d'exceptions spécifiques au client qui vous empêche de refaire le même travail par tenant chaque année.

## Les politiques de sécurité prédéfinies de Microsoft — Built-in, Standard, Strict

Microsoft livre trois niveaux de politique de sécurité prédéfinie dans Defender for Office 365. Chacun est un bundle de politiques préconfigurées couvrant anti-pourriel, anti-hameçonnage, anti-maliciel, Safe Links, et Safe Attachments — toutes les surfaces MDO que la carte 5 a couvertes. Chaque préréglage inclut les *paramètres*, le *ciblage* (qui reçoit quel préréglage), et les *mappages de politique de quarantaine* pour les messages que ces paramètres attrapent.

- **Built-in protection** — base minimale. S'applique à chaque boîte aux lettres dans chaque tenant automatiquement. Pas configurable. C'est le plancher.
- **Préréglage Standard** — défauts sensés pour la plupart des clients. Protection contre l'usurpation d'identité d'utilisateur activée avec seuils raisonnables. Actions anti-hameçonnage mises à quarantaine. Safe Links et Safe Attachments activés avec Dynamic Delivery. Politiques de quarantaine mises à AdminOnlyAccessPolicy pour l'hameçonnage à haute confiance, le maliciel et le spoof. C'est le bon choix pour la majorité des tenants PME.
- **Préréglage Strict** — seuils plus serrés sur toute la ligne. Anti-hameçonnage plus agressif (plus de messages se font mettre en quarantaine). Seuil bulk plus bas (plus de courrier en masse se fait attraper). AdminOnlyAccessPolicy étendu à Phishing (pas juste haute confiance). C'est le bon choix pour les industries réglementées, les clients à plus haut risque (juridique, finance, comptabilité), ou les clients avec un historique récent de compromission.

Pour Standard et Strict, vous assignez le préréglage à des utilisateurs, groupes, ou domaines. Le préréglage pilote alors la configuration pour ces portées. Ce qui n'est pas couvert par Standard ou Strict retombe sur Built-in protection.

## Ce qui est vraiment dans le préréglage Standard

Vaut la peine d'être concret là-dessus, parce que la plupart de la carte 5 mappe directement à des paramètres que le préréglage configure :

- **Anti-hameçonnage** — usurpation d'identité d'utilisateur activée (configurez les utilisateurs protégés explicitement), usurpation de domaine activée, anti-spoofing activé, mailbox intelligence activée. Actions sur détection : quarantaine.
- **Safe Links** — protection activée, vérification d'URL au moment du clic activée, passe-droit utilisateur désactivé, protection des apps Office activée (l'extension SafeLinks-for-Office).
- **Safe Attachments** — protection activée, action Dynamic Delivery.
- **Anti-maliciel** — liste de blocage de pièces jointes communes appliquée.
- **Anti-pourriel (entrant)** — seuil bulk et seuils pourriel mis aux valeurs milieu-de-gamme de Standard.
- **Mappage de politique de quarantaine** — AdminOnlyAccessPolicy pour hameçonnage à haute confiance, Maliciel, Spoof; DefaultFullAccessWithNotificationPolicy pour Spam et Bulk.

Ce que Standard ne configure *pas* (vous devez gérer ceux-là séparément même avec le préréglage) :

- La liste d'utilisateurs protégés par la protection contre l'usurpation d'identité (le préréglage active la fonctionnalité; vous spécifiez qui).
- Les entrées personnalisées d'expéditeurs de confiance (par client, par relation).
- La politique anti-pourriel sortante (séparée du préréglage).
- La posture d'audit de boîte aux lettres, MailTips, le contrôle de transfert Remote Domain, la désactivation de la soumission SMTP AUTH — ceux-là vivent tous à l'extérieur du préréglage et ont besoin de leur propre configuration. Ce sont les sept paramètres de catégorie Exchange que Panoptica365 surveille.

## Standard vs Strict — quand utiliser lequel

L'encadrement honnête :

**Utilisez Standard pour :**
- Le client PME par défaut
- Tout tenant où on ne vous a pas demandé de défenses plus strictes
- Clients sans pilotes réglementaires spécifiques
- Le premier déploiement chez un nouveau client (vous pouvez resserrer plus tard)

**Utilisez Strict pour :**
- Clients dans des industries réglementées — santé, finance, juridique, marchés publics
- Clients avec un historique de compromissions dans les 12 derniers mois
- Clients où la valeur d'affaires des données transportées par courriel est élevée (M&A, lourds en PI, axés sur des transactions)
- Clients qui ont demandé « la protection la plus forte que vous pouvez nous donner » (et accepté les compromis dans la conversation avec le client)

Vous pouvez aussi mélanger par portée utilisateur/groupe. Le PDG, le directeur financier et l'équipe des finances obtiennent Strict; le reste de la compagnie obtient Standard. C'est raisonnable quand une partie de l'organisation a une valeur cible plus élevée que le reste.

## Le patron préréglage + superposition personnalisée

Les préréglages vous donnent un défaut défendable; les politiques personnalisées vous donnent un réglage spécifique au tenant. Le patron qui fonctionne à l'échelle MSP :

1. **Déployez un préréglage (Standard ou Strict) comme fondation** à tous les utilisateurs.
2. **Superposez une politique personnalisée avec priorité plus haute** qui ajoute les bouts spécifiques au client : les utilisateurs protégés nommés pour l'usurpation d'identité, la liste d'expéditeurs de confiance pour les partenaires légitimes, les seuils par client là où ils divergent du préréglage.
3. **Traitez le préréglage comme intouchable** — quand un client demande un changement, le changement va dans la superposition personnalisée, pas le préréglage.

Ça garde le réglage sélectionné par Microsoft intact (donc les mises à jour de Microsoft à celui-ci coulent automatiquement) tout en vous laissant adapter là où ça compte. Le compromis, c'est d'avoir deux politiques par client au lieu d'une; l'avantage, c'est que vous pouvez répondre « est-ce que ce client est encore sur la base de référence recommandée par Microsoft? » par un oui.

Une particularité qui vaut la peine d'être connue : **les noms de règles de politique préréglée sont horodatés**. Quand vous créez un préréglage, Microsoft génère des noms de règles qui incluent l'horodatage de création — `Standard Preset Security Policy123456789...`. Si vous scriptez la création de préréglage ou cherchez des préréglages via PowerShell, utilisez la correspondance avec joker (`Get-EOPProtectionPolicyRule -Identity 'Standard*'`) plutôt que des noms exacts, parce que le nom sera unique par tenant et par événement de création.

## Opérer à grande échelle — le modèle piloté par les alertes

La carte 5 livre avec sept paramètres de sécurité de catégorie Exchange que Panoptica365 surveille par tenant :

1. Disable Automatic Forwarding to External Domains (Critique)
2. Enable Mailbox Auditing for All Users (Critique)
3. Enable Preset Security Policy (Standard or Strict) — MDO (Critique)
4. Strict Mailbox Audit Posture (Bypass + Action List) (Critique)
5. Enable MailTips (All Tips + External Recipients) (Haute)
6. Configure Anti-Spam Outbound Policy (Restrict Compromised Accounts) (Haute)
7. Disable Basic Auth for SMTP AUTH Submission (Haute)

Une fois configurés sur un tenant client, vous n'avez pas besoin de les revisiter selon un horaire. Panoptica365 sonde chaque paramètre sur chaque client continuellement. Quand un paramètre dérive de sa valeur configurée — quelqu'un éteint MailTips dans le centre d'administration Exchange, une nouvelle boîte aux lettres est créée sans la posture d'audit stricte, la politique anti-pourriel sortante est affaiblie en réponse à un ticket de faux positif — Panoptica365 déclenche une alerte de dérive. L'alerte va à l'équipe d'opérateurs via le pipeline standard : elle apparaît dans le tableau de bord d'alertes, elle génère une notification courriel, elle est attribuée au client spécifique avec le paramètre spécifique qui a changé.

Le flux de travail de l'opérateur à grande échelle est donc réactif, pas proactif :

- **Triez la file d'alertes.** Ouvrez le tableau de bord d'alertes à la cadence qui a du sens pour l'équipe (la plupart des MSP y jettent un œil quotidiennement; les notifications courriel d'alerte font que rien ne glisse même si vous ne le faites pas). Chaque alerte de dérive est quelque chose que le tenant d'un client a fait que vous devriez savoir.
- **Pour chaque alerte, décidez la réponse.** Ouvrez le paramètre de sécurité affecté. Lisez l'onglet Historique — quelle était la valeur précédente, quelle est la nouvelle valeur, quand a-t-elle changé, qui ou quoi l'a probablement causée. Décidez :
  - **Appliquer** — remettre à la valeur recommandée. L'action par défaut; approprié quand la dérive est un accident de routine ou un événement connu (nouvelle boîte aux lettres approvisionnée, etc.).
  - **Accepter la dérive** — laisser la nouvelle valeur en place, documenter la raison. Approprié quand le changement est une décision intentionnelle pilotée par le client que vous avez validée.
  - **Enquêter davantage** — quand le patron de dérive est assez suspect pour mériter un regard plus profond avant de répondre. Compte admin compromis, changement de configuration non autorisé, patron inattendu à travers plusieurs paramètres.
- **Documentez les décisions non-routinières dans les notes du client.** « Nouvelle boîte aux lettres a dérivé, réappliqué » n'a pas besoin de beaucoup. Les dérives acceptées ont toujours besoin d'une raison dans le registre (couvert plus bas). C'est ce qui rend la revue annuelle tractable.

C'est ce qui fait fonctionner le modèle à l'échelle MSP. Vous n'inspectez pas manuellement les postures des clients chaque lundi; vous répondez à un petit nombre d'alertes par semaine au fur et à mesure qu'elles émergent. Un carnet de 28 clients génère typiquement une poignée d'alertes de dérive par semaine — la plupart étant les cas de routine de nouvelle boîte aux lettres qui se résolvent avec un clic d'application. Les alertes qui ne sont pas routinières sont par définition celles qui méritent votre attention.

## La revue annuelle — quoi vérifier en profondeur

La revue de dérive hebdomadaire attrape la dérive opérationnelle — nouvelles boîtes aux lettres, désactivations accidentelles, changements de défauts Microsoft. Elle n'attrape pas la *dette de configuration* : exceptions spécifiques au client qui se sont accumulées, entrées d'expéditeurs de confiance qui ne servent plus de but, remplacements SMTP AUTH par boîte aux lettres pour des imprimantes qui ont depuis été remplacées, entrées Remote Domain pour des partenaires avec qui le client ne travaille plus.

Une fois par année, par client — synchronisé avec la revue de sécurité ou la conversation de renouvellement de contrat — faites l'audit plus profond :

- **Utilisateurs protégés anti-hameçonnage.** La liste est-elle encore à jour? Le directeur financier a-t-il changé? Y a-t-il un nouveau contrôleur? Y a-t-il des ex-employés encore dans la liste?
- **Expéditeurs de confiance.** Chaque entrée devrait avoir une raison documentée. Les entrées sans raison se font enlever.
- **Entrées Remote Domain** (exceptions d'auto-transfert par domaine). Chacune devrait référencer une relation d'affaires documentée. Les anciennes entrées pour ex-partenaires se font enlever.
- **Remplacements SMTP AUTH par boîte aux lettres.** Chacun devrait avoir un appareil hérité ou une app documenté. Les appareils qui n'existent plus; les apps qui ont été remplacées — enlevez le remplacement.
- **Règles de transport.** L'audit aux quatre questions de la leçon 8 — but, propriétaire, encore-nécessaire, impact sur la défense — appliqué à chaque règle.
- **Politiques de quarantaine personnalisées.** Même patron d'audit.
- **Règles de flux de courrier** ajoutées par le client depuis la dernière revue. Quelque chose de nouveau est-il apparu que vous n'avez pas autorisé?
- **Le compte de boîtes aux lettres du client.** Grandit-il ou rétrécit-il? Y a-t-il des boîtes aux lettres abandonnées (ex-employés) qui devraient être nettoyées?

Documentez les constats. Enlevez le poids mort. Réaffirmez les exceptions survivantes. La revue annuelle, c'est comment vous empêchez la configuration du client de devenir un cimetière de décisions prises par des gens qui ne se souviennent plus pourquoi.

## Exceptions spécifiques au client — le registre

Chaque client accumule des exceptions légitimes avec le temps. La discipline qui garde le modèle à grande échelle sain, c'est *de les écrire en un endroit par client*.

Un registre d'exceptions client minimal :

- **Expéditeurs de confiance anti-hameçonnage** — domaine, protection ciblée, raison, date d'ajout, opérateur approbateur.
- **Exceptions de politique de quarantaine** — assignations de politique non-défaut, raison, opérateur approbateur.
- **Exceptions d'auto-transfert Remote Domain** — domaine, raison, opérateur approbateur.
- **Remplacements SMTP AUTH par boîte aux lettres** — boîte aux lettres, appareil/app, raison, cible de migration prévue, opérateur approbateur.
- **Règles de transport** — nom de règle, but, propriétaire, date de dernière révision.
- **Règles personnalisées de flux de courrier** — pareil.
- **Personnalisations de politique de sécurité prédéfinie** — ce qui est remplacé dans la superposition personnalisée, pourquoi.

C'est un document, pas un système de configuration. Markdown, document Word, page de système de tickets — ce que le MSP utilise. Le point, c'est que n'importe quel opérateur qui prend en charge le compte du client peut lire le registre et comprendre pourquoi chaque exception existe, et la revue annuelle a une liste de vérification contre laquelle travailler.

Sans le registre, chaque revue annuelle recommence à zéro — les opérateurs doivent rétro-ingénier la configuration du client pour comprendre si chaque exception est encore nécessaire. Avec le registre, la revue prend une heure au lieu d'une journée.

## Ce que Panoptica365 voit

Le tableau de bord client de Panoptica365 fait remonter, par tenant :

- **Tous les paramètres de sécurité avec état actuel** (vert / dérive / non surveillé). La section catégorie Exchange contient les sept paramètres de la carte 5; les autres sections gèrent les autres surfaces.
- **Historique par paramètre** — quelles ont été les valeurs dans le temps, quand ça a changé.
- **Action Appliquer par paramètre** — réappliquer la valeur recommandée quand la dérive est détectée.
- **Le pipeline d'alertes standard** pour les événements de haute gravité : événements Restricted Users de la politique anti-pourriel sortante, création de règle de transport suspecte, patrons de règles de boîte de réception suspects, incidents ingérés Defender XDR de MDO.

Ce que Panoptica365 ne fait *pas* remonter dans le tableau de bord : une agrégation de flotte multi-clients, une matrice « chaque client en un coup d'œil », une vue de comparaison entre les paramètres de deux clients, un registre d'exceptions client intégré. Le travail multi-clients se fait par clic-à-travers par client, une revue de lundi matin à la fois. Le registre vit à l'extérieur de Panoptica365 — dans le système de documentation du MSP, la plateforme de tickets, ou là où les notes du client sont gardées.

## Ce qui peut briser (à grande échelle)

**Le réglage spécifique au client se perd quand le personnel tourne.** L'opérateur qui a configuré le client il y a deux ans est parti; l'opérateur qui hérite du compte ne sait pas pourquoi la liste d'expéditeurs de confiance a l'air comme elle a l'air. Le registre d'exceptions est l'antidote. Faites de la création d'entrées au registre une partie du flux de changement — aucune exception ne rentre sans note au registre.

**Microsoft met à jour les défauts du préréglage et les clients se comportent différemment.** Microsoft resserre ou relâche occasionnellement les configurations de préréglage. Les clients utilisant les préréglages obtiennent le nouveau comportement automatiquement. Parfois c'est bon (amélioration gratuite); parfois ça surprend les utilisateurs qui ont vécu un changement de comportement qu'ils ne comprennent pas. Surveiller les notes de version de la sécurité courriel de Microsoft vaut la peine; communiquer les changements majeurs de préréglage aux clients de façon proactive, c'est le différenciateur.

**Les alertes de dérive s'accumulent sans réponse pendant les semaines occupées.** Quand l'équipe est sous-ressourcée, les alertes de dérive sont la chose facile à déprioriser — « je vais m'en occuper vendredi ». Le coût est invisible jusqu'à ce qu'un vrai patron de compromission soit dans la file en attente de triage. Traitez le triage d'alertes comme non-optionnel; routez les notifications d'alerte quelque part où tout le monde les voit; assignez une responsabilité claire pour chaque tenant ou quart.

**Les revues annuelles s'étirent d'annuelles à « quand on aura le temps ».** Le détecteur de dérive couvre la dérive opérationnelle, mais il n'attrape pas la dette de configuration — expéditeurs de confiance périmés, entrées Remote Domain abandonnées, remplacements SMTP AUTH par boîte aux lettres pour des imprimantes qui ont été retirées. La revue annuelle est la seule chose qui attrape ceux-là. Mettez-les au calendrier; facturez-les; faites-en un livrable que les clients voient dans leur rapport de service.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**Les préréglages sont la fondation; la personnalisation est le différenciateur.** Déployez Standard ou Strict chez chaque client par défaut. Superposez une superposition personnalisée pour les utilisateurs protégés, expéditeurs de confiance et réglage spécifiques au client là où ça compte. Traitez le préréglage comme la base de référence sélectionnée par Microsoft à laquelle vous ne touchez pas; traitez la superposition comme l'endroit où les décisions spécifiques au client vivent.

**La détection de dérive transforme la sécurité courriel à grande échelle d'impossible à réactive.** Sans détection de dérive, la seule façon honnête d'opérer les postures courriel de 28 clients serait une routine d'inspection manuelle qu'aucun MSP ne peut soutenir. Avec la détection de dérive, vous configurez une fois, documentez les exceptions, et laissez les alertes venir vous trouver. Le travail de l'opérateur devient le triage d'une petite file d'événements réels — pas la patrouille pour une dérive hypothétique.

**Le registre d'exceptions est la discipline non-sexy qui compose.** Chaque exception légitime documentée est un mystère de moins pour l'opérateur qui hérite du client. Chaque revue annuelle avec un registre est une heure au lieu d'une journée. Les MSP qui gagnent à cette échelle ne sont pas ceux avec les défenses les plus ingénieuses — ce sont ceux qui écrivent les choses et les regardent une fois par année.

## Fermeture de la carte 5

Vous avez maintenant vu la posture de durcissement courriel à travers dix leçons :

1. Inventaire pré-vol et réalité des licences
2. Protection anti-hameçonnage contre l'usurpation d'identité — l'écart BEC PME
3. Safe Links et Safe Attachments — les fonctionnalités MDO P1 que les clients paient
4. SPF, DKIM, DMARC — le trio d'authentification courriel
5. Transfert automatique et règles de boîte de réception — la paire d'indicateurs post-compromission
6. Audit de boîte aux lettres — le dossier forensique qui ne vous manque que quand vous en avez besoin
7. Politiques de quarantaine et libération par l'utilisateur — là où les bons défauts vont mourir
8. Règles de flux de courrier et MailTips — les outils chirurgicaux et les voyants d'avertissement
9. Pourriel sortant et SMTP AUTH — contrôler le rayon d'impact
10. Politiques de sécurité prédéfinies et opérer à grande échelle — ce qu'on vient de couvrir

L'arc : activer ce que le client a payé, le configurer correctement, surveiller la dérive, documenter les exceptions, réviser annuellement. La sécurité courriel n'est pas à propos de déployer une balle d'argent — c'est à propos de défenses en couches appliquées avec discipline. Le client qui ne se fait jamais BEC, c'est celui dont le MSP a fait les dix leçons de travail, pas celui qui a activé Safe Links et l'a appelé terminé.

## Ce qui suit

- **Carte 6 : Secure Score.** La métrique de posture de sécurité à l'échelle du tenant de Microsoft, comment l'interpréter, où elle induit en erreur, et comment le travail MSP dans les cartes 3, 4 et 5 mappe à des recommandations Secure Score spécifiques.

Pour l'instant : ouvrez la file d'alertes de Panoptica365. Triez ce qui s'y trouve. Si la file est courte — la plupart des semaines elle l'est — fermez l'onglet et allez faire autre chose. C'est comment le modèle est censé se sentir. Le détecteur de dérive fait la surveillance pour que vous n'ayez pas à le faire.

---

*Sources des données dans cette leçon — Microsoft Learn sur la vue d'ensemble des politiques de sécurité prédéfinies ([Microsoft Learn — Preset security policies](https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies)); différences de configuration des préréglages Standard et Strict ([Microsoft Learn — Recommended settings for EOP and MDO](https://learn.microsoft.com/en-us/defender-office-365/recommended-settings-for-eop-and-office365)); gestion des politiques de sécurité prédéfinies via PowerShell ([Microsoft Learn — Manage preset security policies](https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies)); référence de portée Built-in protection ([Microsoft Learn — Built-in protection](https://learn.microsoft.com/en-us/defender-office-365/mdo-support-teams-about)); cmdlet EOPProtectionPolicyRule pour les règles de préréglage ([Microsoft Learn — Get-EOPProtectionPolicyRule](https://learn.microsoft.com/en-us/powershell/module/exchange/get-eopprotectionpolicyrule)).*
