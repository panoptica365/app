---
title: "Politiques anti-hameçonnage — l'écart d'usurpation d'identité que Microsoft laisse ouvert par défaut"
subtitle: "Protection contre l'usurpation d'identité, réglage de l'anti-spoofing et schémas BEC que les défauts Microsoft ne détectent pas."
icon: "fish"
last_updated: 2026-05-29
---

# Politiques anti-hameçonnage — l'écart d'usurpation d'identité que Microsoft laisse ouvert par défaut

Une contrôleuse dans une compagnie manufacturière de 40 personnes reçoit un courriel de son PDG un mardi après-midi. Sujet : « Confidentiel — paiement nécessaire aujourd'hui. » Corps : « S'il vous plaît payez la facture jointe de notre nouveau fournisseur d'équipement. Détails de virement à l'intérieur. N'incluez pas la comptabilité tout de suite — je vous expliquerai jeudi. » Signé avec le bloc de signature réel du PDG, formaté exactement comme ses vrais courriels.

La contrôleuse lit le courriel sur son téléphone. Le nom d'affichage dit « James Wilson, PDG » — le même que chaque autre courriel du PDG. Elle ouvre la pièce jointe, voit ce qui ressemble à une facture légitime avec les détails bancaires, et lance le virement. 46 000 $.

L'adresse expéditrice réelle — visible seulement si vous touchez le nom d'affichage et plissez les yeux — était `james.wilson.ceo@gmail.com`. Pas le domaine du client. Loin de là. Mais sur un téléphone, dans la vue boîte de réception, vous voyez le nom d'affichage. Le nom d'affichage disait la bonne chose.

C'est le patron BEC le plus commun en 2026 et celui que la politique anti-hameçonnage par défaut de Microsoft n'attrape pas. L'anti-spoofing sur le domaine réel du client fonctionne très bien — l'attaquant n'usurpe pas le domaine du client, il utilise Gmail. La défense qui *aurait* attrapé ça, c'est la **protection contre l'usurpation d'identité d'utilisateur**, et Microsoft la livre désactivée.

Cette leçon vise à combler cet écart.

## Les quatre couches de l'anti-hameçonnage M365 — et lesquelles sont activées

La protection anti-hameçonnage de Microsoft 365 est quatre mécanismes distincts qui vivent sous le même parapluie de politique. La plupart des opérateurs les traitent comme une fonctionnalité. Ils ne le sont pas. Savoir qui est qui, c'est tout le jeu.

**Anti-spoofing.** Attrape le courriel qui *prétend venir du domaine du client lui-même* mais a échoué à l'authentification SPF / DKIM / DMARC. Défaut : **activé**. C'est le plancher de base — si quelqu'un envoie un message falsifié prétendant être `ceo@customer.com` depuis un serveur qui n'a rien à faire à envoyer pour `customer.com`, l'anti-spoofing l'attrape. Les défauts de Microsoft sont raisonnables ici.

**Mailbox intelligence.** Utilise l'apprentissage machine de Microsoft sur l'historique de communication du destinataire. Si un utilisateur n'a jamais reçu de courriel d'un expéditeur particulier, mais que l'identité de l'expéditeur ressemble à quelqu'un avec qui il communique régulièrement, mailbox intelligence le signale. Défaut : **activée avec conseil de sécurité de premier contact**, mais les *actions d'application* (déplacer vers indésirables, mettre en quarantaine) sont typiquement configurées à la position **Off** tant que vous ne réglez pas la politique.

**Protection contre l'usurpation d'identité d'utilisateur.** Vous spécifiez les « utilisateurs protégés » — typiquement le PDG, le directeur financier, le contrôleur, n'importe qui à qui on pourrait plausiblement demander de virer de l'argent. La politique signale alors le courriel d'expéditeurs dont le nom d'affichage correspond étroitement à l'un de ces utilisateurs protégés *mais dont l'adresse expéditrice ne correspond pas*. Défaut : **désactivée**. C'est l'écart dans l'histoire d'ouverture.

**Protection contre l'usurpation de domaine.** Vous spécifiez les « domaines protégés » — typiquement le ou les domaines propres du client et tous les domaines de partenaires / fournisseurs avec qui le client transige régulièrement. La politique signale les domaines sosies (`trilogiam.com` vs `trilogiam-corp.com`, `customer.com` vs `customer.co`, les attaques classiques d'homoglyphe où un 'a' cyrillique remplace un 'a' latin). Défaut : **désactivée**.

Deux sur quatre. Activées par défaut : les deux qui attrapent les attaques faciles. Désactivées par défaut : les deux qui attrapent les attaques pour lesquelles les clients PME tombent réellement.

## Le patron des expéditeurs de confiance — ce que les clients demandent vraiment

Vous allez recevoir ce ticket. Probablement cette semaine :

> « Arrêtez votre truc anti-hameçonnage de bloquer les courriels de notre partenaire ABC Corp. On a besoin que leurs factures passent. »

**Avant de toucher à un seul paramètre, vérifiez l'authentification courriel de l'expéditeur.** Ça prend deux personnes pour danser quand il s'agit de courriel — et la plupart du temps, le partenaire de danse a des pas manquants.

Ouvrez un outil de recherche DNS. Celui qu'on recommande pour ce genre de travail, c'est [DomainGuardian](https://domainguardian.nebiatek.com/) — un vérificateur visuel net construit par un collègue de la communauté cybersécurité du Québec. Vous y collez un domaine, vous obtenez une décomposition codée par couleur de SPF, DKIM, DMARC, MX, et enregistrements connexes avec des indicateurs clairs sur ce qui va et ce qui est brisé. Conçu pour les techs L1 qui ne devraient pas avoir à mémoriser la syntaxe de `dig` pour faire leur travail. (Les opérateurs en ligne de commande peuvent encore prendre `dig` ou `nslookup` si c'est plus rapide pour eux.)

Vérifiez `abccorp.com` pour :

- **SPF.** Y a-t-il un enregistrement TXT qui commence par `v=spf1`? Inclut-il les IP ou services depuis lesquels ABC Corp envoie réellement? Échec commun : SPF existe mais finit par `~all` (soft-fail) ou `+all` (autoriser tout — essentiellement brisé).
- **DKIM.** Y a-t-il un enregistrement de sélecteur DKIM publié? Essayez les sélecteurs communs (`default._domainkey`, `selector1._domainkey`, `s1._domainkey`, plus les sélecteurs spécifiques pour Microsoft 365, Google Workspace, Mailchimp, ou ce par quoi ils envoient réellement).
- **DMARC.** Y a-t-il un enregistrement TXT à `_dmarc.abccorp.com`? Quelle est la politique — `p=none`, `p=quarantine`, `p=reject`? Est-ce que `aspf` et `adkim` sont configurés?

Dans une grande fraction de ces tickets — confortablement la majorité du courriel PME-à-PME — l'expéditeur a SPF configuré (souvent à moitié), aucun DKIM du tout, et aucun DMARC. Du point de vue de Microsoft, le courriel ressemble exactement au genre de courriel qu'un attaquant enverrait : mal authentifié, échoue parfois l'alignement, sans politique du domaine de l'expéditeur disant aux récepteurs quoi en faire. La quarantaine n'est pas un bogue — c'est Microsoft qui fait exactement ce que vous voulez qu'il fasse.

Le premier mouvement, c'est la conversation, pas l'exception :

> « L'authentification courriel d'ABC Corp est mal configurée — spécifiquement, ils n'ont pas de DKIM et pas de DMARC publié. C'est pourquoi leurs courriels sont signalés. La correction est de *leur* côté : leur équipe TI doit publier la signature DKIM et un enregistrement DMARC. Une fois que c'est fait, Microsoft fera confiance à leur courriel et on n'aura pas besoin d'exception du tout. Pouvez-vous joindre votre contact chez ABC Corp et leur demander que leur TI regarde ça? »

La moitié du temps, cette conversation règle l'enjeu proprement en une semaine — la TI d'ABC Corp publie DKIM et DMARC, Microsoft commence à faire confiance au courriel, le client ne vous en parle plus jamais, et l'écosystème courriel plus large gagne un cran de santé. L'autre moitié du temps, ABC Corp ne peut pas ou ne veut pas réparer son authentification (petit fournisseur sans TI, le MSP du fournisseur hausse les épaules, le « contact » du client n'a pas le capital politique pour pousser), le client revient à la charge, et *là* vous tombez sur l'un de deux patrons d'exception : un correct, un tentant.

**La voie tentante.** Ouvrir le centre d'administration Exchange. Créer une règle de flux de courrier qui contourne le filtrage anti-pourriel pour tout courriel de `*@abccorp.com`. Le ticket du client se ferme. Demain, le domaine d'ABC Corp est compromis par une attaque d'hameçonnage et les attaquants envoient des factures truffées de maliciels à la contrôleuse du client. La règle de flux de courrier que vous avez créée contourne joyeusement chaque défense que Microsoft appliquerait autrement. La contrôleuse ouvre la pièce jointe. Vous passez la fin de semaine sur la réponse à incident.

**La bonne voie.** Ouvrez la politique anti-hameçonnage. Ajoutez `abccorp.com` à la liste d'expéditeurs de confiance au *niveau de la politique anti-hameçonnage*, ciblé sur *cette protection spécifique* (typiquement l'usurpation d'identité d'utilisateur et mailbox intelligence). L'entrée d'expéditeurs de confiance dit à la politique anti-hameçonnage « les messages de ce domaine ne devraient pas déclencher de signalisation d'usurpation d'identité ». Filtrage anti-pourriel, analyse anti-maliciel, Safe Links, Safe Attachments — tout ça s'applique encore. Si le domaine d'ABC Corp est compromis demain, le maliciel dans leurs factures se fait attraper par Safe Attachments avant d'atteindre la boîte de réception de la contrôleuse.

La différence entre les deux approches, c'est le rayon d'impact quand l'expéditeur de confiance est plus tard compromis. Les clients ne pensent pas à cette partie. Vous, vous devez.

## Configurer la protection contre l'usurpation d'identité d'utilisateur — la partie pratique

Pour un client PME typique, la configuration est sans complication et la discipline, c'est de savoir *qui* protéger.

**Qui protéger.** Quiconque dans une position où l'usurper conduirait un destinataire à envoyer de l'argent, partager des identifiants, ou accorder un accès. Liste réelle :

- Le PDG, le directeur financier, et n'importe quel niveau C
- Le contrôleur, le chef des finances, le chef de la comptabilité
- Le chef des RH (arnaques de W-2 / paye)
- Le chef des TI (demandes d'identifiants et d'accès)
- Le propriétaire / fondateur / directeur principal (petites compagnies)

Une compagnie de 40 personnes peut avoir 5 à 8 utilisateurs protégés. Une compagnie de 200 personnes peut en avoir 12 à 20. N'essayez pas de protéger tout le monde — la politique devient bruyante et l'équipe d'opérateurs perd le signal.

Pour chaque utilisateur protégé, la politique a besoin :

- Du nom d'affichage de l'utilisateur (exactement comme il apparaît dans Entra ID)
- De l'adresse courriel de l'utilisateur (typiquement `prenom.nom@customer.com`)

La politique signale tout message entrant dont le nom d'affichage de l'expéditeur correspond étroitement à un nom d'affichage protégé OU dont l'adresse de l'expéditeur correspond étroitement à une adresse protégée — mais l'expéditeur n'est pas réellement cet utilisateur. L'anecdote d'ouverture (`james.wilson.ceo@gmail.com` avec nom d'affichage « James Wilson, PDG ») se fait attraper parce que le nom d'affichage correspond à un utilisateur protégé mais l'adresse non.

**Quoi faire quand signalé.** Trois options : déplacer vers indésirables, mettre en quarantaine, ou « livrer et ajouter conseil de sécurité ». Pour les clients PME, la **quarantaine** est typiquement le bon choix. L'option conseil-de-sécurité suppose que les utilisateurs lisent les conseils de sécurité; beaucoup ne le font pas. Les indésirables laissent l'utilisateur libérer le message lui-même; pour des signalements d'usurpation d'identité à haute confiance, vous ne voulez pas que l'utilisateur prenne cette décision. La quarantaine route à travers le flux de travail opérateur.

## Configurer la protection contre l'usurpation de domaine

Même idée, ciblée sur les domaines.

**Domaines à protéger :**

- Le domaine courriel principal du client (toujours)
- N'importe quel autre domaine courriel que le client utilise activement
- Domaines clés de partenaires / fournisseurs / vendeurs avec qui le client transige (top 10 à 20 par volume de transactions)

La politique signale le courrier entrant de domaines qui sont visuellement similaires à l'un des domaines protégés. Le cas classique : le client est `acme.com`, l'attaquant enregistre `acne.com` ou `acrne.com` (où le 'r' et le 'n' ensemble ressemblent à un 'm' sur un écran de téléphone) ou `аcme.com` (avec un 'а' cyrillique). Les trois se font attraper.

Le choix d'action sur signalement (déplacer vers indésirables, mettre en quarantaine, conseil de sécurité) suit la même logique que l'usurpation d'identité d'utilisateur. La quarantaine est typiquement la bonne pour la PME.

## Spoof intelligence — la traîne gérable

Le spoof intelligence de Microsoft est l'inverse de la protection contre l'usurpation d'identité. Là où l'usurpation d'identité attrape les expéditeurs *illégitimes* qui essaient de ressembler à des *légitimes*, le spoof intelligence gère les expéditeurs *légitimes* qui échouent à l'authentification pour des raisons d'infrastructure ennuyeuses.

Le cas le plus commun : le client utilise un service tiers (une plateforme marketing, un envoyeur de courriel d'outil RH, un fournisseur de sondages) qui envoie « depuis » le domaine du client mais n'a pas l'autorisation SPF / DKIM appropriée. L'anti-spoofing de Microsoft veut bloquer ça; le spoof intelligence vous laisse réviser les expéditeurs, autoriser les légitimes, et bloquer ceux qui sont vraiment des attaquants.

C'est la surface « Tenant Allow/Block Lists » dans le portail Defender. La discipline de l'opérateur :

- Réviser les renseignements de spoof intelligence mensuellement
- Pour chaque expéditeur non-authentifié-mais-légitime (plateforme marketing, fournisseur de paye, etc.), ajouter une entrée d'autorisation explicite
- Pour chaque expéditeur non-authentifié-et-illégitime, ajouter un blocage explicite
- Dire à l'équipe marketing du client de réparer sa configuration SPF / DKIM pour que vous n'ayez pas à continuer d'ajouter des autorisations

## L'alternative de la politique de sécurité prédéfinie

Pour les clients où vous ne voulez pas régler à la main la politique anti-hameçonnage, les **politiques de sécurité prédéfinies** de Microsoft (Standard et Strict, couvertes en détail à la leçon 10) incluent des règles anti-hameçonnage préconfigurées. Le préréglage Standard active la protection contre l'usurpation d'identité d'utilisateur avec des défauts sensés; le préréglage Strict tourne les boutons plus haut.

Le compromis de l'approche prédéfinie : vous obtenez la configuration sélectionnée par Microsoft, vous perdez le contrôle granulaire sur les seuils et les listes d'expéditeurs de confiance. Pour la plupart des clients PME, c'est le bon échange. Pour les clients avec des besoins d'usurpation d'identité spécifiques (beaucoup d'utilisateurs protégés, exceptions complexes d'expéditeurs de confiance), une politique personnalisée vous donne la flexibilité.

En pratique : déployez un préréglage (Standard pour la plupart; Strict pour les clients à plus haut risque comme les firmes comptables ou les cabinets d'avocats) comme *fondation*, puis superposez une politique anti-hameçonnage personnalisée *avec priorité plus haute* pour les utilisateurs protégés et expéditeurs de confiance spécifiques au client. Ce patron garde les défauts sélectionnés par Microsoft comme plancher tout en vous laissant personnaliser là où ça compte.

## Ce qui peut briser

**Les courriels du dirigeant du client vers lui-même se font mettre en quarantaine.** Quand le PDG envoie un courriel à son propre assistant depuis son adresse Gmail personnelle et que le nom d'affichage correspond à la liste d'utilisateurs protégés, la protection contre l'usurpation d'identité l'attrape. La correction est soit d'ajouter l'adresse personnelle du dirigeant à la liste d'expéditeurs de confiance, soit de faire en sorte que le dirigeant utilise son compte de travail pour le courriel de travail (la bonne réponse).

**Fournisseurs légitimes avec une mauvaise hygiène courriel se font bloquer.** Un petit fournisseur sans DMARC, SPF mal aligné, et une habitude d'envoyer depuis des adresses IP aléatoires déclenchera plusieurs vérifications anti-hameçonnage. Les ajouter aux expéditeurs de confiance règle le problème; idéalement, le fournisseur répare son authentification, mais c'est une conversation lente.

**Plateformes marketing qui envoient sous le domaine du client.** Si l'équipe marketing du client utilise HubSpot, Mailchimp, Marketo, ou similaire pour envoyer sous le domaine du client sans autorisation SPF / DKIM appropriée, ces courriels échouent à l'anti-spoofing et se font attraper par l'usurpation d'identité quand le nom d'affichage correspond à un utilisateur protégé. La correction est soit la configuration d'authentification dans la plateforme marketing (bonne réponse), soit des entrées d'expéditeurs de confiance (solution de contournement).

## Ce que Panoptica365 voit

L'état des politiques anti-hameçonnage est l'un des paramètres de sécurité que Panoptica365 surveille par tenant. Spécifiquement :

- **Dérive sur l'activation de la politique de sécurité prédéfinie.** Si la politique de sécurité prédéfinie (Standard ou Strict) de Microsoft est désactivée sur un tenant client — quelqu'un ouvre le portail Defender et l'éteint, soit par erreur soit en réponse à une plainte — le détecteur de dérive déclenche une alerte. L'opérateur peut revenir, réappliquer, ou accepter.
- **Évaluateurs du moteur d'alertes sur les événements liés à l'hameçonnage.** Quand Defender XDR détecte un incident à patron d'hameçonnage sur un tenant client, l'alerte coule dans le moteur d'alertes de Panoptica365, où elle apparaît à côté des autres alertes de sécurité avec attribution au client.

Ce que Panoptica365 ne fait pas remonter aujourd'hui : le volume de signalisation d'usurpation d'identité par utilisateur, les seuils par politique, la liste de renseignements de spoof intelligence, ni la posture d'hameçonnage par boîte aux lettres. Ceux-là vivent dans le portail Microsoft 365 Defender — plongez-y quand vous avez besoin de la vue diagnostique profonde.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**L'écart d'usurpation d'identité, c'est l'écart BEC.** L'anti-spoofing par défaut de Microsoft attrape les attaques faciles; la protection contre l'usurpation d'identité attrape celles auxquelles les clients PME tombent vraiment. Si vous faites une chose pour le client ce trimestre, activez l'usurpation d'identité d'utilisateur et de domaine avec action de quarantaine et une liste d'utilisateurs protégés réfléchie.

**Quand un client vous demande de « laisser passer X », vérifiez d'abord l'authentification de X.** Ça prend deux pour danser — et la plupart des plaintes de quarantaine remontent au DKIM et DMARC manquants de l'expéditeur, pas à un filtrage trop agressif du côté récepteur. Poussez d'abord la conversation vers l'expéditeur. Quand une exception est encore nécessaire après ça, routez-la à travers la liste d'expéditeurs de confiance de la politique anti-hameçonnage, ciblée sur la protection spécifique — jamais un contournement par règle de flux de courrier. Filtrage anti-pourriel, Safe Links, Safe Attachments restent en vigueur.

**La politique prédéfinie est un défaut défendable; la personnalisation, c'est là où la valeur se trouve.** Déployez un préréglage (Standard ou Strict) comme plancher; superposez une politique anti-hameçonnage personnalisée avec les utilisateurs protégés et expéditeurs de confiance spécifiques au client. Ça vous donne le réglage sélectionné par Microsoft plus la défense spécifique au client dont vous avez besoin.

## Ce qui suit

- **Leçon 3 : Safe Links et Safe Attachments.** Les fonctionnalités Defender for Office 365 P1 que le client a payées et n'utilise pas. Où elles attrapent de vraies attaques et où elles tombent court.
- **Leçon 4 : SPF, DKIM, DMARC.** Le trio d'authentification qui ferme le côté usurpation de l'écart — la moitié que l'anti-hameçonnage n'attrape pas.

Pour l'instant : ouvrez la politique anti-hameçonnage du client. Activez l'usurpation d'identité d'utilisateur. Listez les utilisateurs protégés. Activez l'usurpation de domaine. Listez les domaines protégés. Mettez l'action à quarantaine. Superposez une liste personnalisée d'expéditeurs de confiance pour les partenaires légitimes. Ce seul changement de configuration ferme le vecteur BEC PME le plus commun — celui auquel la contrôleuse de l'histoire d'ouverture est tombée.

---

*Sources des données dans cette leçon — Microsoft Learn sur la configuration des politiques anti-hameçonnage ([Microsoft Learn — Anti-phishing policies in EOP and MDO](https://learn.microsoft.com/en-us/defender-office-365/anti-phishing-policies-about)); protection contre l'usurpation d'identité d'utilisateur ([Microsoft Learn — Impersonation protection in anti-phishing](https://learn.microsoft.com/en-us/defender-office-365/anti-phishing-policies-mdo-configure)); spoof intelligence et les Tenant Allow/Block Lists ([Microsoft Learn — Spoof intelligence insight](https://learn.microsoft.com/en-us/defender-office-365/anti-spoofing-spoof-intelligence)); mailbox intelligence ([Microsoft Learn — Mailbox intelligence](https://learn.microsoft.com/en-us/defender-office-365/anti-phishing-mdo-impersonation-insight)); politiques de sécurité prédéfinies ([Microsoft Learn — Preset security policies](https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies)).*
