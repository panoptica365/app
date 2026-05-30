---
title: "Pourriel sortant et SMTP AUTH — contrôler le rayon d'impact quand le client est l'attaquant"
subtitle: "Limites d'envoi sortant, réponse automatique Restricted Users et désactivation de SMTP AUTH pour contenir rapidement un compte compromis."
icon: "send"
last_updated: 2026-05-29
---

# Pourriel sortant et SMTP AUTH — contrôler le rayon d'impact quand le client est l'attaquant

L'associée principale d'une petite firme comptable se fait hameçonner à 7 h 14 un mercredi matin. Style AiTM : elle se connecte à ce qui ressemble à la page de connexion Microsoft sur son téléphone avant son premier café. À 7 h 22, l'attaquant a le cookie de session et est connecté à sa boîte aux lettres.

À 7 h 35, l'attaquant commence à envoyer. Le script est automatisé et ambitieux. L'associée a 1 847 contacts dans son carnet d'adresses — clients, fournisseurs, collègues, amis, famille, listes de diffusion du réseau comptable. L'attaquant envoie à chacun un message identique : « Désolée pour l'urgence — veuillez réviser ce fichier confidentiel : [lien vers un récolteur d'identifiants à l'effigie de la firme]. » 1 847 messages sortants sur environ quatre-vingt-dix minutes.

À 8 h 53, l'attaquant frappe une limite de messages sortants. Le tenant du client fait basculer le compte de l'associée à l'état Restricted Users. Le courrier sortant de sa boîte aux lettres s'arrête. Un courriel d'alerte va au contact TI du client (le MSP) disant « L'utilisateur X a été restreint de l'envoi de courrier sortant en raison d'une compromission soupçonnée. »

L'astreinte du MSP voit l'alerte à 8 h 54. À 9 h 10, ils ont révoqué les sessions, réinitialisé les identifiants, confirmé la compromission, verrouillé le compte, et démarré la réponse à incident. Les dommages à ce point : environ 1 800 courriels d'hameçonnage envoyés. Mauvais — mais borné. Environ 150 des destinataires ont cliqué sur le lien (taux de clic d'hameçonnage typique); environ 25 ont entré des identifiants (taux de suite typique). Le MSP passe un long mercredi à faire la réponse à incident de suivi avec les organisations et équipes TI de ces destinataires.

Imaginez maintenant le même scénario sans la limite sortante. L'attaquant continue d'envoyer. Le temps que quelqu'un remarque — peut-être ce soir-là, quand l'associée revient de ses réunions clients du matin et vérifie son dossier d'envois — l'attaquant a envoyé 18 000 messages. Le domaine principal du client a été listé sur trois grandes listes de blocage de pourriel. Microsoft a suspendu au niveau du tenant le courrier sortant pour toute l'organisation. Le MSP passe la semaine suivante à sortir le client des listes de blocage, restaurer la délivrabilité pour tout le tenant, et expliquer aux équipes TI des 18 000 destinataires pourquoi ils se sont fait hameçonner depuis un domaine maintenant taché.

C'est le problème du rayon d'impact post-compromission, et la politique d'anti-pourriel sortant est le plafond dessus.

## La politique anti-pourriel sortante de Microsoft — ce qu'elle contrôle

La politique anti-pourriel sortante dans Defender (Threat policies → Anti-spam → Outbound spam) gouverne ce qui arrive quand une boîte aux lettres dans le tenant envoie plus de courrier sortant que sa base de référence le devrait. Trois contrôles de seuil :

- **Limite de messages externes par heure.** Combien de messages vers des destinataires extérieurs à l'organisation une seule boîte aux lettres peut envoyer en une heure. Le défaut de Microsoft est 500. La plupart des boîtes aux lettres légitimes ne frappent jamais ça; les boîtes aux lettres compromises qui lancent des scripts d'hameçonnage le frappent en vingt minutes.
- **Limite de messages internes par heure.** Combien de messages vers des destinataires internes par heure. Défaut 1 000.
- **Limite quotidienne de messages par boîte aux lettres.** Total de messages par jour à travers interne et externe. Défaut 10 000 pour la plupart des tenants.

Trois options d'action quand une limite est dépassée :

- **Alerter les admins seulement.** Les notifications sortent; l'utilisateur continue d'envoyer. Utile pour les configurations visibilité-seulement; inutile comme contrôle de rayon d'impact.
- **Restreindre l'utilisateur d'envoyer du courriel.** L'utilisateur est ajouté à une liste Restricted Users. Le courrier sortant de sa boîte aux lettres est bloqué à l'échelle du tenant. Il peut encore recevoir du courrier; il peut encore se connecter; il ne peut juste pas envoyer.
- **Aucune action.** Le défaut pour certains tenants plus anciens. Microsoft a resserré ça dans les nouveaux tenants mais les configurations héritées peuvent encore être à Aucune action.

Le paramètre protecteur, c'est **Restreindre l'utilisateur d'envoyer du courriel**, avec les alertes allant au contact TI du client (typiquement la boîte partagée du MSP). Quand déclenchée, l'alerte est le signal d'avertissement précoce qu'un compte est probablement compromis; la restriction est le plafond sur combien de dommages se font avant que l'opérateur puisse répondre.

## L'auto-libération de 24 heures — friction par conception

Quand un utilisateur est restreint, il reste restreint jusqu'à ce qu'une de deux choses arrive :

1. **Un admin l'enlève manuellement de la liste Restricted Users** (portail Defender → Email & collaboration → Review → Restricted users; ou via PowerShell avec `Remove-BlockedSenderAddress`).
2. **L'auto-libération de 24 heures se déclenche** et Microsoft l'enlève automatiquement.

L'auto-libération de 24 heures est le filet de sécurité pour les faux positifs. Si un expéditeur légitime à fort volume frappe la limite, il n'est pas coincé hors-ligne pour toujours — il attend jusqu'au jour suivant. Pour les compromissions réelles, la restriction tient le temps que le MSP a besoin pour enquêter; pour les faux positifs, ça se résout tout seul.

Le paramètre de sécurité Panoptica365 « Configure Anti-Spam Outbound Policy (Restrict Compromised Accounts) » pousse cette configuration : l'action mise à « Restrict the user », les destinataires d'alerte pointés sur la bonne adresse, l'auto-libération de 24 heures engagée. Le détecteur de dérive surveille si l'action reste à Restrict. Quelqu'un qui la change à « Alert admins only » — typiquement en réponse à un ticket de faux positif — déclenche l'alerte de dérive.

## Ajuster les seuils — la conversation sur le volume légitime

Les seuils par défaut (500 externes/heure, 1 000 internes/heure, 10 000 quotidien) sont généreux pour la plupart des tenants PME. Certains expéditeurs légitimes les frappent quand même, et l'ajustement doit être une conversation délibérée :

- **Expéditeurs de marketing / liste de diffusion.** Le CRM ou la plateforme marketing du client envoyant des campagnes légitimes à fort volume depuis une boîte aux lettres du tenant.
- **Automatisation du service à la clientèle.** Auto-répondeurs, notifications de tickets, confirmations de compte envoyées depuis une boîte aux lettres de service.
- **Infolettres internes.** Une équipe de communications envoyant une mise à jour hebdomadaire à tout le personnel à 500 destinataires internes.

Pour chacun, la bonne réponse, c'est habituellement *pas* « élever le seuil global ». C'est soit :

- **Déplacer l'expéditeur légitime à fort volume vers un mécanisme de transport différent** (Microsoft a des services de courriel en masse dédiés; une plateforme courriel tierce via connecteur authentifié; etc.) pour que la boîte aux lettres du tenant ne fasse pas l'envoi.
- **Créer une politique anti-pourriel sortante personnalisée** ciblée sur la boîte aux lettres spécifique (ou le groupe) avec des seuils plus élevés, tout en gardant la politique par défaut stricte pour tout le monde d'autre.

N'élevez pas le seuil pour tout le tenant juste parce qu'une boîte aux lettres a un cas d'usage légitime. Ça rend le plafond de rayon d'impact inutile pour les 31 autres boîtes aux lettres du tenant.

## Soumission SMTP AUTH — la porte arrière héritée

Séparément de la politique anti-pourriel sortante, M365 a un autre vecteur qui vaut la peine de fermer : **la soumission SMTP AUTH**.

La soumission SMTP AUTH est le protocole qui laisse une application ou un appareil s'authentifier à `smtp.office365.com:587` avec un nom d'utilisateur et un mot de passe et envoyer du courrier à travers M365 comme cet utilisateur. C'est là depuis toujours. Les imprimantes multifonctions héritées l'utilisent pour le scan-vers-courriel. Les vieilles applications métier l'utilisent pour envoyer des notifications. Les scripts personnalisés l'utilisent pour envoyer des courriels de rapport.

C'est aussi un rêve de credential stuffing. La soumission SMTP AUTH utilise **l'authentification de base** — nom d'utilisateur et mot de passe, pas de MFA, pas de Conditional Access dans la plupart des configurations. Un attaquant avec le mot de passe de l'utilisateur (d'une liste de credential stuffing ou d'un hameçonnage qui n'a pas eu le cookie de session) peut s'authentifier à SMTP AUTH et envoyer du courrier comme l'utilisateur, contournant toutes les défenses d'authentification modernes.

Microsoft déprécie Basic Auth depuis des années à travers tous les protocoles hérités (IMAP, POP, EWS, MAPI/RPC, Remote PowerShell). La soumission SMTP AUTH était le dernier survivant parce que tant d'appareils et d'applications hérités en dépendent encore. À partir de 2025-2026, Microsoft désactive la soumission SMTP AUTH par défaut pour les nouveaux tenants, mais les tenants plus anciens et les tenants qui l'ont explicitement activée peuvent encore l'avoir active.

Le paramètre de sécurité Panoptica365 « Disable Basic Auth for SMTP AUTH Submission » pousse `Set-TransportConfig -SmtpClientAuthenticationDisabled $true` au niveau du tenant. Le détecteur de dérive surveille s'il reste désactivé.

## La conversation des cas d'usage hérités

Quand vous poussez le blocage à l'échelle du tenant, vous pouvez briser des flux légitimes. Trouvez-les pendant le pré-vol (travail « audit de l'état actuel » de la leçon 1), pas après le déploiement.

Utilisateurs SMTP AUTH hérités communs :

- **Imprimantes multifonctions** configurées il y a des années pour le scan-vers-courriel. La correction, c'est habituellement de reconfigurer l'imprimante pour utiliser le mécanisme *direct send* de Microsoft (SMTP non authentifié depuis l'IP interne de l'imprimante via un connecteur de tenant) ou de mettre à niveau le firmware de l'imprimante pour supporter l'authentification moderne.
- **Applications métier héritées** envoyant des notifications courriel. La correction dépend du fournisseur — les versions modernes supportent habituellement la soumission SMTP basée sur OAuth via Microsoft Graph; les versions plus anciennes peuvent avoir besoin d'un mot de passe par application (moins sûr) ou d'un remplacement.
- **Scripts personnalisés.** La correction, c'est de réécrire pour utiliser l'API `sendMail` de Microsoft Graph ou Azure Communication Services. Les scripts sont habituellement uniques et faciles à mettre à jour.
- **Boîtes aux lettres de service spécifiques que le client ne peut pas facilement migrer.** En dernier recours, la soumission SMTP AUTH peut être activée par boîte aux lettres tout en restant désactivée à l'échelle du tenant (`Set-CASMailbox <user> -SmtpClientAuthenticationDisabled $false`). Documentez l'exception; révisez-la annuellement; planifiez la migration éventuelle.

Évitez le raccourci tentant de laisser SMTP AUTH activé à l'échelle du tenant juste parce qu'une imprimante en a besoin. Ça rouvre la porte arrière pour tout le monde. Le remplacement par boîte aux lettres existe exactement pour ce cas.

## Ce que Panoptica365 voit

Deux paramètres de sécurité sur la liste de catégorie Exchange :

**« Configure Anti-Spam Outbound Policy (Restrict Compromised Accounts). »** Panoptica365 surveille la propriété d'action de la politique anti-pourriel sortante. La valeur recommandée est « Restrict the user from sending email » avec l'auto-libération de 24 heures engagée. La dérive se déclenche si l'action change ou si les alertes sont désactivées.

**« Disable Basic Auth for SMTP AUTH Submission. »** Panoptica365 surveille la propriété `SmtpClientAuthenticationDisabled` de la configuration de transport du tenant. La valeur recommandée est `$true` (désactivé). La dérive se déclenche si SMTP AUTH est réactivé à l'échelle du tenant.

Au-delà de la dérive, le **moteur d'alertes** ingère les événements de restriction de pourriel sortant de Microsoft quand ils se déclenchent — un événement utilisateur-restreint est l'un des indicateurs de compromission à plus haut signal que Microsoft fait remonter, et Panoptica365 le transfère à travers le pipeline d'alertes standard pour qu'il ne se perde pas dans le déluge de notifications Microsoft.

Ce que Panoptica365 ne fait *pas* remonter dans le tableau de bord : l'historique d'activité SMTP AUTH par boîte aux lettres, un explorateur Restricted Users, un historique de limite de taux sortant par boîte aux lettres. Ceux-là vivent dans la surface de révision des utilisateurs restreints du portail Defender et dans les journaux d'audit de Microsoft.

## Ce qui peut briser

**Un expéditeur légitime frappe la limite sortante et se fait restreindre.** Vendeur dans une grosse journée de campagne; personne du marketing envoyant une infolettre ponctuelle depuis sa propre boîte aux lettres; personne des communications envoyant la lettre annuelle aux employés. L'utilisateur appelle paniqué. La correction, c'est soit de l'enlever des Restricted Users manuellement (et l'avertir sur le mécanisme approprié de courrier en masse), soit d'attendre l'auto-libération de 24 heures. Ajustez pour les patrons de volume légitime du client pendant l'accueil.

**L'imprimante arrête de scanner-vers-courriel après la désactivation SMTP AUTH.** Commun. La correction, c'est direct send via connecteur de tenant (préféré), mise à niveau du firmware de l'imprimante vers l'authentification moderne (fonctionne pour les modèles plus récents), ou remplacement SMTP AUTH par boîte aux lettres pour le compte de service de l'imprimante en dernier recours.

**Notifications courriel des jobs de sauvegarde cessent de fonctionner.** Certains logiciels de sauvegarde hérités utilisent SMTP AUTH pour les courriels de statut. Modernisez via SMTP basé sur OAuth (si le fournisseur le supporte) ou migrez le mécanisme de notification.

**Restriction faux positif pendant un pic légitime.** Un lancement de produit, une annonce client majeure, une communication d'urgence — ceux-là peuvent brièvement ressembler à du comportement de compte compromis. Ajoutez le scénario spécifique à la liste blanche, enlevez manuellement des Restricted Users, documentez dans le runbook pour l'année prochaine.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**La limite sortante est le plafond du rayon d'impact.** Quand une compromission arrive — et elle arrivera éventuellement chez chaque client — la différence entre 1 800 hameçonnages sortants et 18 000, c'est l'action Restrict de la politique anti-pourriel sortante. Mettez-la. Confirmez que les alertes routent vers votre boîte partagée. L'auto-libération de 24 heures est votre filet de sécurité pour les faux positifs; ce n'est pas une raison d'affaiblir l'action.

**La soumission SMTP AUTH, c'est le chemin d'authentification hérité qui a survécu aux autres — désactivez-la.** L'authentification moderne est le standard depuis des années; SMTP AUTH est le dernier trou. Désactivez-la à l'échelle du tenant, identifiez les flux hérités qui ont besoin d'exceptions pendant le pré-vol, réparez-les correctement (direct send, soumission OAuth, modernisation d'application), et gardez les remplacements par boîte aux lettres documentés et bornés dans le temps.

**L'alerte Restricted Users est l'indicateur de compromission à plus haut signal que Microsoft fait remonter.** Quand elle se déclenche, traitez-la comme une compromission crédible jusqu'à preuve du contraire. Révoquez les sessions, réinitialisez les identifiants, auditez l'activité récente, vérifiez les règles de boîte de réception et les règles de transport, regardez le dossier d'envois, identifiez ce qui a été envoyé. L'associée comptable du client dans l'histoire d'ouverture garde ses relations clients parce que son MSP a répondu dans la fenêtre de 30 minutes que la restriction a achetée.

## Ce qui suit

- **Leçon 10 : Politiques de sécurité prédéfinies et opération de la sécurité courriel à grande échelle.** Les bundles Standard / Strict qui rassemblent la plupart des contrôles de la carte 5 en une configuration, le modèle de détection de dérive à travers toute la carte, et la cadence de revue annuelle.

Pour l'instant : ouvrez la politique anti-pourriel sortante du client dans le portail Defender. Vérifiez que l'action est mise à « Restrict the user from sending email » avec alertes admin activées. Vérifiez que la soumission SMTP AUTH est désactivée au niveau du tenant (`Get-TransportConfig | Select SmtpClientAuthenticationDisabled` devrait retourner `True`). Identifiez et réparez toute exception SMTP AUTH par boîte aux lettres qui n'est pas documentée. L'associée dans l'histoire d'ouverture n'a pas son téléphone qui sonne toute la journée un mercredi après-midi parce que le plafond a tenu.

---

*Sources des données dans cette leçon — Microsoft Learn sur les politiques anti-pourriel sortantes et limites de messages ([Microsoft Learn — Outbound spam policies](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-policies-configure)); flux de révision et retrait des Restricted Users ([Microsoft Learn — Restricted users](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-restore-restricted-users)); vue d'ensemble et dépréciation de la soumission SMTP AUTH ([Microsoft Learn — Authenticated SMTP submission](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission)); référence Set-TransportConfig SmtpClientAuthenticationDisabled ([Microsoft Learn — Set-TransportConfig](https://learn.microsoft.com/en-us/powershell/module/exchange/set-transportconfig)); direct send pour imprimantes et scanners ([Microsoft Learn — Submitting email using direct send](https://learn.microsoft.com/en-us/exchange/mail-flow-best-practices/how-to-set-up-a-multifunction-device-or-application-to-send-email-using-microsoft-365-or-office-365#option-2-send-mail-directly-from-your-printer-or-application-to-microsoft-365-or-office-365-direct-send-recommended)); remplacement SMTP AUTH par boîte aux lettres avec Set-CASMailbox ([Microsoft Learn — Set-CASMailbox](https://learn.microsoft.com/en-us/powershell/module/exchange/set-casmailbox)).*
