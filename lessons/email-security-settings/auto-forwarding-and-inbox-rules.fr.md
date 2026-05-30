---
title: "Transfert automatique et règles de boîte de réception — la paire d'indicateurs post-compromission"
subtitle: "Comment les attaquants utilisent le transfert automatique et les règles cachées pour persister après une compromission — et les contrôles qui les arrêtent."
icon: "forward"
last_updated: 2026-05-29
---

# Transfert automatique et règles de boîte de réception — la paire d'indicateurs post-compromission

La comptable d'un client appelle paniquée un mardi matin. « Mon contact chez notre fournisseur vient d'appeler. Il a dit qu'il avait répondu à mon courriel sur le virement la semaine dernière et n'avait jamais eu de nouvelles, puis avait envoyé deux relances, et finalement appelé. Je n'ai jamais reçu aucun de ses courriels. Je ne lui ai jamais envoyé de courriel sur un virement. Il regarde trois messages dans son dossier d'envois de ma part. »

Vous vous connectez à la boîte aux lettres de la comptable. Dans Outlook sur le web, vous vérifiez les règles. Il y en a une que vous n'avez pas créée :

- **Nom de règle :** `.` (un point seul)
- **Condition :** le sujet contient « wire » ou « payment » ou « supplier » ou « transfer »
- **Action :** déplacer vers le dossier `RSS Subscriptions`; marquer comme lu; supprimer

Vous vérifiez les paramètres de Forwarding. Pas configuré. Vous vérifiez le Unified Audit Log. La règle a été créée à 3 h 42 du matin le mercredi précédent depuis une IP dans un pays que la comptable n'a jamais visité, en utilisant une session qui s'est authentifiée avec succès — ce qui veut dire que soit l'attaquant avait un cookie de session volé (AiTM), soit il avait précédemment hameçonné l'identifiant et utilisé une méthode qui contournait le MFA d'une façon ou d'une autre.

L'attaquant lit le courriel de la comptable depuis six jours. Il a envoyé trois instructions de virement au fournisseur, intercepté les réponses du fournisseur (la règle les a déplacées vers RSS Subscriptions et marquées comme lues), et récolté au moins un virement réussi de 52 000 $. La comptable n'a jamais vu une seule trace entrante ou sortante de l'attaque.

C'est le scénario courriel post-compromission de manuel, et il s'appuie sur deux choses que presque chaque attaquant fait après avoir pris le contrôle d'une boîte aux lettres :

1. **Règles de boîte de réception** pour cacher l'activité à l'utilisateur légitime.
2. **Transfert automatique** (parfois) pour s'assurer que l'attaquant reçoit une copie de chaque message entrant sans rester continuellement connecté au compte compromis.

Cette leçon vise à fermer les deux vecteurs, les limites de ce qu'on peut fermer, et ce que les surfaces de surveillance de Panoptica365 vous donnent.

## Deux contrôles distincts, deux histoires différentes

Les opérateurs confondent « transfert » et « règles de boîte de réception » parce qu'elles se ressemblent dans l'interface utilisateur. Elles sont différentes, et elles ont besoin de contrôles différents.

**Le transfert automatique vers domaines externes** est une fonctionnalité au niveau boîte aux lettres (ou tenant) qui copie chaque message entrant vers une adresse courriel externe. Configurable dans les paramètres de la boîte aux lettres ou via une règle de boîte de réception avec une action « transférer à ». Microsoft a resserré le comportement par défaut en 2020 — les nouveaux tenants bloquent le transfert automatique externe par défaut. Les tenants plus anciens, et les tenants où des admins précédents ont explicitement permis le transfert pour une raison ou une autre, peuvent encore l'avoir activé.

**Les règles de boîte de réception** sont des filtres au niveau utilisateur qui agissent sur le courrier entrant : déplacer, supprimer, marquer comme lu, marquer comme important, transférer, rediriger, mettre des catégories, lancer des scripts (dans les clients hérités), et ainsi de suite. Les utilisateurs en créent légitimement pour des raisons organisationnelles tout le temps. Les attaquants en créent post-compromission pour cacher leurs traces.

Le transfert automatique est le signal plus bruyant — plus facile à bloquer à l'échelle du tenant, plus facile à détecter, plus difficile à utiliser pour les attaquants sans se faire attraper. Les règles de boîte de réception sont le signal plus subtil — impossible à bloquer (les utilisateurs légitimes en ont besoin), détectable seulement en surveillant les patrons anormaux.

## Transfert automatique — le blocage à l'échelle du tenant

La surface de contrôle à connaître, c'est **Remote Domains** dans le centre d'administration Exchange (Mail flow → Remote Domains; PowerShell : `Set-RemoteDomain Default -AutoForwardEnabled $false`). Chaque entrée Remote Domain définit le comportement de flux de courrier pour les messages quittant votre tenant vers un domaine externe spécifique. L'entrée **Default** est le fourre-tout — chaque domaine externe que vous n'avez pas explicitement configuré tombe sous ses règles. Mettre la propriété d'auto-transfert de Default à **disabled** bloque le transfert automatique externe à l'échelle du tenant sauf pour les domaines que vous avez explicitement permis via des entrées Remote Domain par domaine (couvert dans « Ce qui peut briser » plus bas).

Le paramètre de sécurité Panoptica365 « Disable Automatic Forwarding to External Domains » opère exactement ici : il pousse le Remote Domain Default à AutoForwardEnabled=$false sur le tenant du client et surveille cette valeur pour la dérive. Quelqu'un qui ouvre le centre d'administration Exchange et la rebascule à activé — typiquement en réponse à un ticket client genre « mon utilisateur ne peut plus transférer son courriel de travail vers son Gmail personnel » — déclenche une alerte de dérive. Vous revenez en arrière (ou, s'il y a un vrai besoin d'affaires, vous appliquez le flux d'exception par domaine ci-dessous) et vous parlez au client pour expliquer pourquoi le blocage existe.

Microsoft expose un contrôle connexe mais séparé dans la **politique anti-pourriel sortant** (portail Defender → Threat policies → Anti-spam → Outbound spam) — trois valeurs, Automatic / On / Off, contrôlant la politique de transfert automatique à l'échelle de la politique. Certains MSP utilisent ça comme bretelles-et-ceinture à côté du blocage Remote Domain Default. Panoptica365 n'opère pas sur cette surface ni ne la surveille aujourd'hui; le Remote Domain Default est le contrôle canonique pour le paramètre de sécurité.

**Une exception qui mérite d'être connue :** les règles de flux de courrier (transport rules) qui redirigent ou BCC du courrier vers des adresses externes ne sont *pas* du transfert automatique du point de vue de ce contrôle. Elles ont leurs propres paramètres et leur propre surveillance. La leçon 8 couvre les règles de flux de courrier; pour l'instant, sachez que les contrôles de transfert automatique n'attrapent pas le transfert basé sur règle de transport.

## Règles de boîte de réception — pourquoi on ne peut pas les désactiver

Les utilisateurs ont besoin de règles de boîte de réception. La comptable dans l'histoire d'ouverture en a une demi-douzaine de légitimes — filtrer les infolettres vers un dossier, marquer comme importants les courriels de son patron, auto-catégoriser les courriels clients par projet. Les règles de boîte de réception font partie de la façon dont le courriel fonctionne vraiment comme outil de productivité.

Il n'y a aucun contrôle à l'échelle du tenant pour désactiver les règles de boîte de réception. Il ne peut pas y en avoir — les désactiver briserait le cas d'usage légitime de productivité.

Ce qu'il y a *par contre* :

- **Des entrées au Unified Audit Log** quand des règles de boîte de réception sont créées, modifiées, ou supprimées. Les noms d'opérations incluent `New-InboxRule`, `Set-InboxRule`, `Remove-InboxRule`, et `UpdateInboxRules` (pour la gestion des règles d'Outlook bureau).
- **Des alertes Microsoft Defender** quand une règle de boîte de réception correspond à des patrons suspects. L'apprentissage machine de Microsoft signale les règles qui ressemblent à du comportement d'attaquant — noms à un caractère, actions de redirection externe, filtrer-sur-mots-clés-de-finance, combinaisons supprimer-et-marquer-lu.
- **Énumération par boîte aux lettres** via `Get-InboxRule -Mailbox user@domain.com` dans Exchange Online PowerShell. Les opérateurs peuvent lancer ça manuellement; Panoptica365 le fait remonter pour tout le tenant.

La posture défensive pour les règles de boîte de réception, c'est **détection, pas prévention**. Vous ne pouvez pas empêcher les utilisateurs de créer des règles. Vous pouvez surveiller pour les règles que les attaquants créent.

## Les patrons de règles d'attaquant à surveiller

Après une décennie d'investigations BEC M365, les mêmes formes de règles apparaissent à travers des milliers d'incidents. Entraînez-vous et entraînez votre équipe d'opérateurs à les repérer.

**Le nom à un caractère.** Règles nommées `.` (point), `,` (virgule), `..` (deux points), ` ` (espace seul), ou un caractère Unicode de largeur zéro. L'attaquant ne veut pas que l'utilisateur remarque que la règle existe dans sa liste de règles. Plus le nom est court et bizarre, plus la suspicion est haute.

**Le filtre de mots-clés sur des termes financiers.** Conditions qui vérifient `wire`, `payment`, `transfer`, `invoice`, `account`, `bank`, `supplier`, `vendor`, plus les noms de personnes spécifiques dans la chaîne financière (directeur financier, contrôleur, comptabilité). Combiné avec une action cacher-de-l'utilisateur, c'est la règle de suivi BEC.

**La combinaison d'action de masquage.** Actions qui déplacent les messages vers des dossiers obscurs (`RSS Subscriptions`, `Junk`, `Conversation History`, `Notes`, `Sync Issues`), les marquent comme lus, et/ou les suppriment. Les règles légitimes combinent rarement « déplacer vers dossier obscur » avec « marquer comme lu » avec « supprimer après quelques jours ». Les règles d'attaquant le font.

**La redirection externe.** Règles de boîte de réception avec une action « transférer à » ou « rediriger à » où la destination est une adresse courriel externe. C'est du transfert automatique via règle de boîte de réception, et le blocage Remote Domain Default ci-dessus l'attrape la plupart du temps. Mais certains attaquants utilisent la redirection-avec-modification (p. ex., rediriger via une règle de flux de courrier) pour évader le blocage.

**La règle « supprimer les notifications de rebond ».** Conditions qui correspondent aux patrons d'expéditeurs de rapport de non-livraison communs ou aux lignes de sujet comme « Undeliverable » ou « Mail Delivery Failure ». L'attaquant envoie des courriels de fraude par virement et ne veut pas que les rebonds atteignent l'utilisateur légitime.

**Le suppresseur de réponses PDG / contrôleur.** Règles qui déplacent les messages entrants d'expéditeurs spécifiques à haute valeur (le PDG, le contact principal du client, le directeur des finances) vers des dossiers obscurs. Utilisé quand l'attaquant a détourné un fil sortant et veut empêcher l'utilisateur légitime de voir les réponses du destinataire.

Quand n'importe lequel de ces patrons apparaît dans les règles de boîte aux lettres d'un client et que l'utilisateur ne peut pas l'expliquer, traitez la boîte aux lettres comme compromise. Réinitialisez les identifiants, révoquez les sessions, auditez les éléments envoyés récents, vérifiez le Unified Audit Log pour les 14 derniers jours, et commencez un vrai flux de réponse à incident.

## Ce que Panoptica365 voit

La surveillance des règles de boîte de réception est l'une des surfaces les plus utiles de Panoptica365 du côté Exchange. C'est aussi délibérément simple — juste assez de structure pour que les règles soient scannables, sans cérémonie supplémentaire.

**Le panneau Règles de boîte de réception.** Un panneau, deux sections repliables :

- **Règles de transfert (transférer ou rediriger le courrier).** Un tableau plat montrant chaque règle dans le tenant qui transfère ou redirige du courrier. Colonnes : Utilisateur, Nom de règle, Cible (l'adresse destinataire), Type (EXTERNAL ou Internal). Les cibles externes sont visuellement signalées. Le badge de compte dans l'en-tête de section montre le total. C'est la vue à signal élevé — chaque ligne mérite un coup d'œil, parce que le transfert externe est rare dans les flux légitimes et que les cibles EXTERNAL sont spécifiquement celles que les attaquants créent.
- **Toutes les règles de boîte de réception (chaque règle activée, par utilisateur).** Un tableau plat groupé par propriétaire de boîte aux lettres, montrant chaque règle de boîte de réception activée à travers le tenant. Colonnes : Utilisateur, Nom de règle, Actions (une courte description comme « Move to folder · Stop processing » ou « FORWARD → external `address` »). Le badge de compte montre le total. C'est la vue défiler-et-scanner — la plupart des lignes sont des règles de productivité banales, et ce que vous cherchez, ce sont les suspectes (noms à un caractère, mots-clés financiers, combinaisons d'action de masquage).

Il n'y a aucun tri, aucun filtrage, aucune boîte de recherche. Le flux de travail, c'est de défiler à travers les listes avec des yeux calibrés pour les patrons d'attaquant ci-dessus. Le compromis que Panoptica365 fait ici : au lieu d'un explorateur de données lourd de fonctionnalités que les opérateurs devraient apprendre, c'est une liste simple et lisible optimisée pour la lecture humaine.

**Dérive sur le paramètre de sécurité « Disable Automatic Forwarding to External Domains ».** Panoptica365 surveille la propriété AutoForwardEnabled du Remote Domain Default. Si quelqu'un la bascule de désactivée à activée — typiquement via l'interface Remote Domains du centre d'administration Exchange — le détecteur de dérive se déclenche.

**Évaluateurs d'alertes basés sur UAL.** Le moteur d'alertes de Panoptica365 inclut des évaluateurs qui surveillent le Unified Audit Log pour les patrons de création de règles de boîte de réception suspectes. Quand une correspondance se déclenche, l'alerte coule à travers le pipeline standard (tableau de bord, notification courriel, attribution au client).

Ce que Panoptica365 ne fait *pas* remonter dans le tableau de bord : l'historique des règles par boîte aux lettres (deltas dans le temps), l'historique d'état de transfert par boîte aux lettres, les événements UAL bruts eux-mêmes, le tri/filtrage/recherche sur les tableaux de règles de boîte de réception. Pour le travail forensique plus profond, plongez dans la recherche d'audit log du portail Microsoft 365 Defender ou le centre d'administration Exchange.

## Ce qui peut briser

**Transfert légitime vers des partenaires d'affaires spécifiques.** De vrais flux de travail d'affaires impliquent du transfert vers des domaines externes nommés — un client qui route des courriels liés aux finances vers la compagnie de son comptable externe, un client qui transfère certaines demandes de support à un fournisseur tiers, un client qui copie du courrier thématique spécifique à la firme d'un consultant. La discipline, ce n'est pas d'affaiblir le blocage à l'échelle du tenant; c'est d'ajouter une **exception par domaine via les règles Remote Domain** dans Exchange.

Dans le centre d'administration Exchange : Mail flow → Remote Domains. L'entrée Default attrape tout ce que vous n'avez pas explicitement configuré — laissez son paramètre d'auto-transfert désactivé (c'est ce que pousse le paramètre de sécurité Panoptica365). Puis créez une entrée Remote Domain spécifique pour chaque domaine externe où le client a un flux de transfert documenté — `accountant-firm.com`, `vendor-name.com`, `consultant-co.com` — et activez le transfert automatique pour ces domaines nommés seulement.

Distinction critique : les exceptions par domaine sont pour **des domaines de partenaires d'affaires nommés spécifiquement**, jamais pour des fournisseurs grand public génériques. Un utilisateur qui veut transférer son courriel de travail vers son compte Gmail / Hotmail / Outlook.com / Yahoo / iCloud personnel est exactement le cas que le blocage à l'échelle du tenant existe pour prévenir. Ce n'est pas un flux d'affaires; c'est une commodité personnelle qui met les données corporatives dans des boîtes accessibles aux attaquants et brise à la fois la défense BEC et la plupart des attentes de résidence des données. Routez ces utilisateurs vers un accès délégué, une boîte aux lettres partagée, ou la connexion à leur courriel de travail sur l'app Outlook de leur téléphone à la place — pas une entrée Remote Domain pour gmail.com.

Même discipline que le patron d'expéditeurs de confiance dans la leçon 2 : les exceptions par-partenaire-nommé sont tractables; les exceptions générales-de-domaine sont des canons à pied.

**Des règles de boîte de réception utiles se font signaler comme suspectes.** Un utilisateur crée une règle parfaitement légitime pour nettoyer son fouillis d'infolettres, et le moteur d'alertes de Panoptica365 la signale parce qu'elle correspond à un patron générique « cacher des messages ». Triez-les comme vous le feriez pour n'importe quel faux positif : confirmez la règle avec l'utilisateur, documentez-la, passez. Avec le temps, les évaluateurs du moteur d'alertes se règlent à la normale du client.

**Flux de courrier basés sur connecteurs hérités.** Certains clients ont des connecteurs Exchange Online hérités qui routent le courrier à travers une passerelle tierce. Ces passerelles injectent parfois un comportement de type transfert. L'audit des connecteurs pendant le pré-vol (leçon 1) attrape la plupart de ça; si un patron de transfert basé sur connecteur émerge plus tard, la correction est au connecteur, pas à la boîte aux lettres.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**Bloquez le transfert automatique externe à l'échelle du tenant; faites des exceptions par domaine là où elles sont justifiées.** Désactiver l'auto-transfert sur le Remote Domain Default est le contrôle à plus fort levier sur le rayon d'impact post-compromission. Quand un client a une vraie raison d'affaires de transférer vers un partenaire nommé — comptable, consultant, fournisseur — ajoutez une entrée Remote Domain par domaine pour ce domaine externe spécifique. Quand la demande est pour du transfert vers un fournisseur grand public (gmail.com, hotmail.com, etc.), routez l'utilisateur vers un accès délégué, une boîte aux lettres partagée, ou la connexion à son courriel de travail sur son téléphone à la place — pas une exception Remote Domain.

**Vous ne pouvez pas désactiver les règles de boîte de réception, seulement surveiller les patrons d'attaquant.** Les noms à un caractère, les filtres de mots-clés financiers, les combinaisons d'actions de masquage — entraînez votre équipe d'opérateurs à les reconnaître à vue. Le temps que vous les voyiez, la boîte aux lettres est déjà compromise; la vitesse de détection détermine si vous contenez l'attaque à 10 000 $ ou à 100 000 $.

**Le panneau Règles de boîte de réception de Panoptica365 est la surface quotidienne de l'opérateur.** Deux sections (Règles de transfert, Toutes les règles de boîte de réception) dans une vue. Scannez-les quand un client rapporte quoi que ce soit d'inhabituel (un courriel manquant, une livraison refusée, un fournisseur confus). Les patrons sont visibles si vous regardez. Le coût de regarder est faible. Le coût de ne pas regarder, c'est l'incident de fraude par virement de l'histoire d'ouverture.

## Ce qui suit

- **Leçon 6 : Audit de boîte aux lettres.** La posture d'audit Strict de boîte aux lettres, l'exemple de dérive de nouvelle boîte aux lettres, et ce que l'audit de boîte aux lettres vous donne pour la forensique post-incident.
- **Leçon 7 : Politiques de quarantaine et libération par l'utilisateur.** Qui peut libérer quoi; le risque de suivi BEC d'hameçonnage libéré par soi-même.

Pour l'instant : ouvrez le panneau Règles de boîte de réception du client dans Panoptica365. Lisez la liste de haut en bas. Cherchez les patrons. Si quoi que ce soit correspond, plongez dans la boîte aux lettres dans le centre d'administration Exchange, confirmez avec l'utilisateur, et démarrez le flux de réponse à incident si l'utilisateur ne peut pas l'expliquer. La comptable dans l'histoire d'ouverture aurait perdu moins d'argent si son MSP avait fait ça chaque lundi matin.

---

*Sources des données dans cette leçon — référence des paramètres d'auto-transfert Remote Domain ([Microsoft Learn — Set-RemoteDomain](https://learn.microsoft.com/en-us/powershell/module/exchange/set-remotedomain)); vue d'ensemble du blocage de transfert automatique externe ([Microsoft Learn — External email forwarding](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-policies-external-email-forwarding)); contrôles d'auto-transfert de la politique anti-pourriel sortant (surface connexe de Microsoft) ([Microsoft Learn — Outbound spam policies](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-policies-configure)); manipulation des règles de boîte de réception comme indicateur post-compromission ([Microsoft Learn — Detect and respond to suspicious inbox rules](https://learn.microsoft.com/en-us/defender-xdr/alert-grading-suspicious-inbox-manipulation-rules)); noms d'opérations de règle de boîte de réception du Unified Audit Log ([Microsoft Learn — UAL search](https://learn.microsoft.com/en-us/purview/audit-log-search)); type de ressource messageRules Microsoft Graph ([Microsoft Learn — messageRules](https://learn.microsoft.com/en-us/graph/api/resources/messagerule)).*
