---
title: "Règles de flux de courrier et MailTips — les outils chirurgicaux et les voyants d'avertissement"
subtitle: "Utiliser les règles de transport Exchange pour imposer une politique sur le flux courriel, et les MailTips pour afficher des avertissements avant l'envoi."
icon: "scroll-text"
last_updated: 2026-05-29
---

# Règles de flux de courrier et MailTips — les outils chirurgicaux et les voyants d'avertissement

Le gestionnaire TI d'un client se fait hameçonner un vendredi après-midi. C'est un admin global dans le tenant. L'attaquant utilise ses identifiants pour se connecter au centre d'administration M365. Le MFA est activé, mais l'attaquant a capturé le cookie de session via Evilginx2 — le cookie satisfait la revendication MFA-déjà-complété. L'attaquant a une fenêtre d'une heure avant que la session expire normalement.

Pendant cette heure, l'attaquant crée deux règles de transport :

- **Règle un** — condition : l'expéditeur est `controller@customer.com`; action : BCC chaque message à `archive-helper@protonmail.com`. L'attaquant va lire silencieusement chaque message sortant que le contrôleur envoie.
- **Règle deux** — condition : tout message entrant de l'extérieur de l'organisation; action : mettre l'en-tête de message `X-MS-Exchange-Organization-SkipSafeLinksProcessing` pour contourner l'encapsulation Safe Links. L'attaquant va envoyer des liens d'hameçonnage non encapsulés au contrôleur à partir de maintenant.

Le cookie de session expire. Le défi MFA se déclenche à la prochaine tentative de connexion et l'attaquant ne peut pas y répondre. L'utilisateur reprend son compte. Les identifiants fonctionnent bien. Rien n'a l'air anormal sur la surface visible à l'utilisateur.

Les règles de transport restent en place. Ce sont des objets au niveau du tenant. Les réinitialisations de mot de passe, les révocations de session, et les réinscriptions MFA n'y touchent pas. Le courrier sortant du contrôleur se fait BCC à protonmail.com pendant les trois prochaines semaines. Le client paie l'attaquant pour lire silencieusement tout ce que le directeur financier écrit, et le client ne le sait pas.

C'est le patron d'abus qui fait des règles de transport une préoccupation spéciale. Les règles de boîte de réception sont par boîte aux lettres, visibles à l'utilisateur, visibles dans le panneau Règles de boîte de réception de Panoptica365 (leçon 5). Les règles de transport sont *au niveau du tenant*, invisibles aux utilisateurs finaux, et exigent un balayage opérateur délibéré pour les faire apparaître.

Cette leçon parle de ce que les règles de transport peuvent légitimement faire, des patrons d'abus à surveiller, et de la configuration MailTips qui donne aux utilisateurs l'avertissement du moment-de-vérité avant qu'ils envoient quelque chose qu'ils regretteraient.

## Ce que les règles de flux de courrier peuvent faire — les cas d'usage légitimes

Les règles de transport (la marque de Microsoft pour les règles de flux de courrier) sont des politiques condition-action qui tournent sur chaque message qui coule à travers le tenant. Elles vivent dans le centre d'administration Exchange → Mail flow → Rules et peuvent aussi être gérées via PowerShell (`New-TransportRule`, `Get-TransportRule`, `Set-TransportRule`, `Remove-TransportRule`).

Les conditions peuvent correspondre à essentiellement n'importe quoi : expéditeur, destinataire, sujet, contenu du corps, en-têtes de message, noms ou types de pièces jointes, taille du message, domaine de l'expéditeur, si le destinataire est interne ou externe, heure de la journée. Les actions sont aussi larges : bloquer, rediriger, BCC, transférer, modifier les en-têtes, ajouter en préfixe au sujet, ajouter un avertissement, appliquer une étiquette de conformité, mettre la classification du message, router à travers un connecteur spécifique.

Pour les opérateurs PME, les cas d'usage légitimes se groupent en un petit nombre de patrons :

**Avertissements d'expéditeur externe.** Une règle qui ajoute en préfixe `[EXTERNE]` au sujet de tout message entrant de l'extérieur de l'organisation, ou qui ajoute une bannière d'avertissement jaune en haut du corps. L'avertissement « votre collègue a envoyé ça de l'extérieur ». Vaut la peine de déployer pour la plupart des clients; c'est le signal visible-à-l'utilisateur le moins cher qu'un message n'est pas du répertoire interne de confiance.

**Blocages de pièces jointes exécutables.** Même avec Safe Attachments en place, certains clients veulent un blocage dur sur des extensions de fichiers spécifiques à haut risque (`.exe`, `.bat`, `.scr`, `.js`, `.vbs`). Une règle de transport qui rejette les messages avec ces pièces jointes est une couche de défense en profondeur par-dessus le bac à sable de Safe Attachments.

**Application d'une liste de blocage du tenant.** Domaines d'expéditeurs spécifiques qui ne devraient jamais atteindre le tenant — patrons d'arnaque connus, fournisseurs qui ont mal tourné, ex-employés qui tentent l'usurpation d'identité. Une règle qui rejette ou met en quarantaine les messages de ces domaines.

**Avertissement / pied de page pour conformité.** Certaines industries réglementées exigent du texte spécifique sur le courrier sortant (avertissements légaux, mentions de confidentialité). Les règles de transport ajoutent l'avertissement à la passerelle, donc les utilisateurs n'ont pas à s'en souvenir.

**Listes de distribution internes seulement.** Une règle qui bloque les expéditeurs externes de livrer à des groupes de distribution spécifiques (p. ex., `all-employees@customer.com` ne devrait pas être joignable de l'extérieur).

**Auto-classification pour les étiquettes de sensibilité.** Règles qui correspondent à certains mots-clés ou patrons de pièces jointes et appliquent des étiquettes Microsoft Information Protection pour DLP en aval.

Chacune est légitime. Aucune de celles-ci ne devrait faire que le client active réflexivement les défenses de Microsoft ailleurs — ce sont des contrôles additifs.

## Les patrons d'abus de l'attaquant — ce qu'il faut surveiller

L'anecdote d'ouverture couvrait deux patrons. La taxonomie complète est plus large.

**La règle BCC-sortant.** Condition : l'expéditeur est une boîte aux lettres à haute valeur (directeur financier, PDG, directeur des finances, juridique). Action : BCC à une adresse externe contrôlée par l'attaquant. Exfiltration persistante silencieuse. Survit aux réinitialisations de mot de passe.

**La règle de dépouillement d'en-tête.** Action : modifier ou mettre un en-tête de message pour contourner les contrôles en aval. Dépouiller `X-MS-Exchange-Organization-SkipSafeLinksProcessing` pour évader l'encapsulation Safe Links; modifier les en-têtes liés à l'authentification; supprimer le score anti-pourriel; ajouter de faux remplacements SCL (Spam Confidence Level).

**La règle de suppression de rebond.** Condition : le sujet contient « Undeliverable » ou des patrons `Mail Delivery Failure`; action : supprimer silencieusement. L'attaquant envoie des courriels de fraude par virement depuis la boîte aux lettres compromise et ne veut pas que les rebonds atteignent l'utilisateur.

**La règle de redirection totale.** Condition : tout courrier entrant vers un destinataire spécifique; action : rediriger vers une boîte aux lettres contrôlée par l'attaquant. Plus agressif que BCC parce que le destinataire original ne voit jamais le message du tout.

**La règle de suppression sélective.** Condition : l'expéditeur correspond à un partenaire à haute valeur (le plus gros client du client, un organisme de surveillance, un fournisseur spécifique); action : supprimer de la livraison ou déplacer dans un dossier. Utilisé pour supprimer les communications que l'attaquant ne veut pas voir émerger.

**La règle de ralentissement.** Condition : l'expéditeur correspond à une personne spécifique; action : retarder la livraison de N heures. Utilisé pour retarder les courriels du propriétaire légitime pour que les messages usurpés de l'attaquant arrivent en premier.

**Le contournement Safe Links / Safe Attachments.** Conditions qui correspondent à des expéditeurs entrants spécifiques et actions qui mettent le message à contourner le scan MDO. L'attaquant envoie du contenu malveillant depuis une adresse externe spécifique et veut évader les défenses.

La caractéristique partagée : l'attaquant utilise les règles de transport pour rendre son activité post-compromission *invisible à l'utilisateur* et *survivable aux réinitialisations d'identifiants*. La défense, c'est la détection — revue périodique par l'opérateur des règles de transport dans le tenant, plus alertes sur les événements de création de règles suspectes.

## Le travail d'hygiène — auditer les règles existantes

La plupart des tenants clients accumulent du crud de règles de transport. Trois ans de changements d'anciens admins, migrations qui ont amené des règles de domaines acquis, règles spécifiques à un fournisseur créées pour des problèmes qui n'existent plus. Le travail d'inventaire de pré-vol de la leçon 1 inclut « auditer les règles de transport existantes »; c'est la section qui parcourt l'audit.

Pour chaque règle de transport existante, demandez :

- **Qu'est-ce qu'elle fait?** Lisez les conditions et actions soigneusement. Résumé en français clair, une ligne.
- **Pourquoi existe-t-elle?** Regardez les notes de la règle, la date de création, l'admin qui la modifie. Si la règle n'a pas de notes, pas de modification récente, et a été créée par un admin qui n'est plus chez le client, c'est un drapeau rouge pour une règle périmée.
- **Est-elle encore nécessaire?** Testez ce qui arrive si elle est désactivée (la plupart des tenants vous laissent mettre une règle en mode audit ou la désactiver temporairement). Si rien ne brise pendant une semaine, la règle est du poids mort.
- **Affaiblit-elle une défense?** Les règles qui contournent Safe Links, contournent l'anti-pourriel, contournent l'anti-hameçonnage, ou BCC n'importe où en externe ont besoin d'une justification explicite.

Documentez chaque règle survivante avec son but. Enlevez le crud. À l'avenir, chaque nouvelle règle de transport devrait avoir un but documenté, une raison de création dans les notes de la règle, et un propriétaire qui peut parler de pourquoi elle existe.

## MailTips — les voyants d'avertissement

Séparément des règles de transport, M365 a des **MailTips** — les petits avertissements infobar qu'Outlook montre aux utilisateurs quand ils composent ou répondent à un message. Le plus conséquent pour la défense BEC, c'est le tip **Destinataires externes**, la barre jaune qui dit « Vous envoyez ce courriel à des destinataires extérieurs à votre organisation » avec le domaine externe listé.

Pour un utilisateur sur le point de répondre-par-fraude-par-virement à un faux courriel « PDG » provenant d'un attaquant à Gmail-avec-nom-d'affichage, cette barre jaune est parfois le moment de pause qui empêche le virement. Pas toujours. Mais c'est gratuit, c'est visible à l'utilisateur, et ça ne coûte rien opérationnellement.

Autres MailTips incluent :

- **Absent du bureau** — le destinataire a un répondeur automatique.
- **Boîte aux lettres pleine** — la boîte aux lettres du destinataire ne peut pas recevoir de nouveau courrier.
- **Grand auditoire** — la liste de destinataires dépasse un seuil configurable.
- **Destinataire modéré** — le message va exiger une modération avant la livraison.
- **Destinataire restreint** — le destinataire est configuré pour rejeter certains expéditeurs.
- **Répondre-à-tous à un grand auditoire** — appuyer sur Répondre à tous enverrait à beaucoup de personnes.

Pour un client PME typique, la bonne configuration, c'est **tous les tips activés, y compris le tip Destinataires externes**. Le paramètre de sécurité Panoptica365 « Enable MailTips (All Tips + External Recipients) » pousse cette configuration et surveille la dérive. Si l'admin d'un client désactive MailTips — parfois fait en réponse à une plainte d'utilisateur « la barre jaune est agaçante » — le signal de dérive est l'avertissement précoce. Vous réactivez, parlez à l'utilisateur de pourquoi l'avertissement existe, et passez.

Le PowerShell en dessous : `Set-OrganizationConfig -MailTipsAllTipsEnabled $true -MailTipsExternalRecipientsTipsEnabled $true`. Le seuil pour le tip grand-auditoire peut être ajusté (`MailTipsLargeAudienceThreshold`) — le défaut de Microsoft de 25 va habituellement bien pour la PME.

## Ce que Panoptica365 voit

**Dérive sur le paramètre de sécurité « Enable MailTips (All Tips + External Recipients) ».** Panoptica365 surveille les propriétés MailTips de la configuration d'organisation. Désactiver MailTips au niveau du tenant déclenche l'alerte de dérive; la réapplication restaure la configuration.

**Alertes Defender XDR sur la création de règles de transport suspectes.** Quand MDO fait remonter un événement de haute gravité lié à une règle de transport créée avec des caractéristiques correspondant aux patrons d'attaquant (BCC externe, contournement d'en-tête, contournement Safe Links), l'alerte coule dans le moteur d'alertes de Panoptica365 à travers le pipeline standard.

Ce que Panoptica365 ne fait *pas* remonter dans le tableau de bord : un explorateur de règles de transport par tenant, un visualiseur de diff règle-par-règle, un flux d'audit d'hygiène. Le travail d'audit se passe dans le centre d'administration Exchange ou via PowerShell. Le rôle de Panoptica365 ici, c'est la dérive sur le paramètre MailTips et le pipeline d'alertes pour la création de règle suspecte; l'audit règle-par-règle est le territoire de l'opérateur.

## Ce qui peut briser

**Règles de transport créées par le client qui entrent en conflit avec les paramètres poussés par Panoptica365.** Un client a une ancienne règle qui désactive MailTips pour une boîte aux lettres spécifique (peut-être un compte d'automatisation). Quand Panoptica365 applique MailTips à l'échelle du tenant, le vieux comportement du client se brise. La correction, c'est d'identifier le besoin légitime (s'il y en a) et de mettre à jour la règle explicitement; pas d'affaiblir la configuration MailTips à l'échelle du tenant.

**Bannières d'avertissement d'expéditeur externe doublement timbrées.** Certains tenants clients ont déjà une règle d'expéditeur externe et en ajoutent une autre sans désactiver la première. Les utilisateurs voient deux bannières jaunes. La correction, c'est de consolider en une seule règle.

**Pièces jointes exécutables légitimes bloquées par les règles d'extension.** Un fournisseur envoie un installeur `.exe` pour un outil spécifique que le client utilise. La règle de transport le bloque. La correction, c'est une exception ciblée sur l'expéditeur (permettre `.exe` de `vendor.com` seulement) plutôt qu'enlever le blocage des exécutables entièrement.

**MailTips désactivés par utilisateur.** Certains utilisateurs ont MailTips désactivé au niveau de leur boîte aux lettres (remplaçant le défaut du tenant). Auditez les politiques de boîte aux lettres OWA par utilisateur pendant le pré-vol pour attraper ça.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**Les règles de transport sont l'objet de configuration le plus puissant et le moins visible dans M365.** Elles sont au niveau du tenant, elles survivent aux réinitialisations de mot de passe, elles peuvent contourner les défenses en aval, et la plupart des utilisateurs n'ont aucune façon de les voir. Auditez-les à chaque accueil de client. Documentez chaque règle survivante avec son but. Traitez la création de nouvelle règle de transport comme une action à plus haute confiance que la création d'une boîte aux lettres utilisateur.

**Les patrons d'attaquant sont reconnaissables.** BCC externe, contournement d'en-tête, suppression de rebond, suppression sélective — entraînez votre équipe d'opérateurs à les repérer dans les listes de règles des clients. La caractéristique partagée, c'est que l'effet de la règle est invisible à l'utilisateur ciblé. Tout ce qui correspond à cette forme se fait enquêter.

**Les MailTips sont gratuits, visibles à l'utilisateur, et valent la peine d'activer partout.** Le tip Destinataires externes est l'avertissement du moment-de-vérité qui fait pause à un utilisateur sur le point d'envoyer à un domaine d'attaquant. Activez tous les tips au niveau du tenant. Repoussez doucement quand les utilisateurs se plaignent de la barre jaune — elle les protège de la fraude par virement que vous ne voulez pas passer le samedi à gérer.

## Ce qui suit

- **Leçon 9 : Pourriel sortant et SMTP AUTH.** Les contrôles du rayon d'impact post-compromission — ce qui arrive quand la boîte aux lettres d'un client devient celle qui envoie l'hameçonnage.
- **Leçon 10 : Politiques de sécurité prédéfinies et opération de la sécurité courriel à grande échelle.** Les bundles Standard / Strict, le modèle de détection de dérive à travers toute la carte 5, et la cadence de revue annuelle.

Pour l'instant : ouvrez les règles de transport du client dans le centre d'administration Exchange. Lisez chaque règle. Notez ce que chacune fait et pourquoi. Enlevez le crud. Pendant que vous y êtes, vérifiez que MailTips est activé à l'échelle du tenant (ou vérifiez l'état de dérive de Panoptica365 sur le paramètre). Le gestionnaire TI du client dans l'histoire d'ouverture n'a pas la règle BCC plantée sous sa surveillance.

---

*Sources des données dans cette leçon — Microsoft Learn sur les règles de transport Exchange Online ([Microsoft Learn — Mail flow rules in Exchange Online](https://learn.microsoft.com/en-us/exchange/security-and-compliance/mail-flow-rules/mail-flow-rules)); référence New-TransportRule et conditions / actions de règle ([Microsoft Learn — Mail flow rule actions](https://learn.microsoft.com/en-us/exchange/security-and-compliance/mail-flow-rules/mail-flow-rule-actions)); contournement Safe Links via en-tête X-MS-Exchange-Organization-SkipSafeLinksProcessing ([Microsoft Learn — Skip Safe Links via mail flow rules](https://learn.microsoft.com/en-us/defender-office-365/safe-links-policies-configure)); vue d'ensemble MailTips et configuration de tenant ([Microsoft Learn — MailTips in Exchange Online](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/mailtips/mailtips)); référence des paramètres MailTips Set-OrganizationConfig ([Microsoft Learn — Set-OrganizationConfig](https://learn.microsoft.com/en-us/powershell/module/exchange/set-organizationconfig)).*
