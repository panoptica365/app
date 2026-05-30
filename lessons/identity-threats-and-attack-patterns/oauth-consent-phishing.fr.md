---
title: "Hameçonnage par consentement OAuth — l'attaque qui survit à une réinitialisation de mot de passe"
subtitle: "Tromper des utilisateurs pour leur faire accorder des permissions OAuth à une application malveillante donne un accès persistant à la boîte aux lettres."
icon: "link"
last_updated: 2026-05-29
---

# Hameçonnage par consentement OAuth — l'attaque qui survit à une réinitialisation de mot de passe

Un utilisateur reçoit un courriel : « Voir le fichier partagé dans PerformanceReview-Pro. » Il clique. Une boîte de dialogue de consentement Microsoft d'apparence familière apparaît. La boîte dit : « PerformanceReview-Pro voudrait la permission de : lire vos courriels, envoyer des courriels en votre nom, lire tous les fichiers auxquels vous avez accès. » L'utilisateur est pressé. Il clique « Accepter ».

Il n'y a pas de mot de passe à taper. Pas de prompt MFA. Rien qui *donne l'impression* d'une attaque. La boîte ressemble aux boîtes de consentement que l'utilisateur voit une fois par mois pour des applications légitimes. Deux secondes et un clic, et l'utilisateur vient de donner à un attaquant un accès persistant à sa boîte aux lettres et à ses fichiers.

Trois semaines plus tard, l'équipe sécurité réinitialise le mot de passe de l'utilisateur à cause d'une alerte sans rapport. L'attaquant est encore dans la boîte aux lettres. Parce que l'attaquant n'a jamais eu besoin du mot de passe.

C'est ça, l'hameçonnage par consentement OAuth, et c'est l'attaque dangereuse la plus silencieuse dans l'écosystème M365.

## Pourquoi cette attaque est structurellement différente

Chaque autre attaque dans cette carte repose sur obtenir *l'authentification* de l'utilisateur — son mot de passe, son MFA, son cookie de session. L'utilisateur change son mot de passe et l'attaque s'arrête.

L'hameçonnage par consentement OAuth ne touche pas à l'authentification. Il convainc l'utilisateur d'accorder à une application tierce *la permission* d'accéder à ses données en son nom. Microsoft émet à cette application un jeton de rafraîchissement lié à *l'application*, pas au mot de passe de l'utilisateur. L'application peut maintenant demander de nouveaux jetons d'accès quand elle veut, indéfiniment, jusqu'à ce que l'utilisateur révoque le consentement ou qu'un admin désactive l'enregistrement d'entreprise de l'application.

Réinitialiser le mot de passe de l'utilisateur ne révoque pas le consentement. Désactiver le compte de l'utilisateur ne révoque pas toujours le consentement (selon la configuration). Forcer l'utilisateur à refaire le MFA ne révoque pas le consentement. Le consentement est l'attaque, et le consentement colle.

C'est ce qui rend cette attaque uniquement précieuse pour les attaquants en 2026 : *la persistance*. La plupart des compromissions s'arrêtent à la réinitialisation du mot de passe. Pas celle-ci.

## Le flux OAuth, brièvement

OAuth 2.0 est le protocole légitime qui vous permet de dire « je veux utiliser cette application de calendrier, et l'application de calendrier a besoin de lire mon calendrier Outlook. » Au lieu de donner à l'application votre mot de passe Microsoft (ce qui serait imprudent), vous vous connectez à Microsoft, Microsoft demande si vous êtes sûr de vouloir donner à l'application les permissions spécifiques qu'elle demande, et si vous dites oui, Microsoft remet à l'application un jeton qu'elle peut utiliser pour agir en votre nom pour ces permissions spécifiques.

C'est un *bon* protocole. Toute intégration de productivité légitime l'utilise — votre extension Zoom, votre Calendly, votre Trello, votre assistant IA de la semaine. Le patron est correct.

L'attaque abuse du patron. L'attaquant enregistre une application malveillante dans Entra ID (soit son propre tenant, soit un tenant compromis), lui donne un nom convaincant, et trompe les utilisateurs pour qu'ils y consentent. Le protocole fonctionne correctement; l'utilisateur a cliqué sur le bouton. Du point de vue de Microsoft, le consentement est légitime.

## Quelles permissions comptent

Toutes les portées OAuth ne sont pas également dangereuses. Le catalogue de permissions Microsoft Graph est tentaculaire, et un raccourci utile pour le triage est de regarder trois choses :

**Permissions déléguées vs permissions d'application.** Les permissions déléguées agissent *comme l'utilisateur* — l'application peut faire tout ce que l'utilisateur peut faire. Les permissions d'application sont *autonomes* — l'application peut agir au nom du tenant entier sans qu'un utilisateur soit présent. Les permissions d'application sont beaucoup plus dangereuses et demandent un consentement d'admin (vous ne pouvez pas les approuver comme utilisateur régulier). La plupart des attaques d'hameçonnage par consentement ciblent les permissions déléguées parce qu'elles passent par un flux de consentement utilisateur normal.

**Read vs ReadWrite.** Une portée `Mail.Read` permet à l'application de lire le courriel. Une portée `Mail.ReadWrite` lui permet d'envoyer du courriel et de modifier l'état de la boîte. Read seul, c'est mauvais; ReadWrite, c'est bien pire. Cherchez `.ReadWrite`, `.Send`, `.Manage`, `.All` dans les portées demandées — ce sont celles à haute valeur.

**Mail, Files, Contacts, Calendar — les portées de données.** `Mail.ReadWrite`, `Files.ReadWrite.All`, `Contacts.Read`, `Calendars.Read`. C'est ce que veulent les attaquants. Une application malveillante avec `Mail.ReadWrite` peut lire chaque courriel que l'utilisateur a et envoyer du courriel en son nom. C'est assez pour mener une opération BEC entièrement à travers OAuth, sans qu'aucun mot de passe ne change de mains.

**La portée mortelle : `offline_access`.** C'est celle qui accorde un jeton de rafraîchissement. Sans elle, l'application ne peut agir que pendant que l'utilisateur interagit. Avec elle, l'application peut agir sur les données de l'utilisateur indéfiniment, même quand l'utilisateur n'est pas en ligne. Presque toutes les applications de productivité légitimes la demandent, c'est pourquoi elle n'a pas l'air suspecte. Presque toutes les malveillantes aussi.

## Ce que voit l'utilisateur

La boîte de dialogue de consentement est la dernière ligne de défense de Microsoft, et elle marche seulement aussi bien que l'utilisateur la lit.

La plupart des utilisateurs voient quelque chose comme ceci et cliquent Accepter sans lire :

> **PerformanceReview-Pro** veut :
> - Vous connecter et lire votre profil
> - Lire vos courriels
> - Avoir un accès complet à votre boîte aux lettres
> - Maintenir l'accès aux données auxquelles vous lui avez donné accès
> - Lire tous les fichiers auxquels vous avez accès

Si l'utilisateur lit, les signes d'avertissement sont là. « Lire vos courriels » n'est pas une chose dont la plupart des applications ont besoin. « Avoir un accès complet à votre boîte aux lettres », c'est le tueur. « Maintenir l'accès aux données auxquelles vous lui avez donné accès », c'est la portée `offline_access` sous un autre nom.

Mais les gens ne lisent pas les boîtes de dialogue de consentement. La recherche de Microsoft sur leur guide d'hameçonnage par consentement est sans ambiguïté à ce sujet : les utilisateurs cliquent à travers les boîtes presque universellement si le nom de l'application a l'air plausible. La boîte est un contrôle de défense en profondeur; ce n'est pas, par lui-même, la défense.

## Comment l'attaquant enregistre l'application malveillante

Deux chemins, tous les deux courants :

**Chemin 1 : enregistrer dans son propre tenant.** L'attaquant crée un tenant développeur Microsoft gratuit, y enregistre une application, et configure l'application pour supporter l'authentification multi-tenant. L'application peut ensuite être invoquée contre les utilisateurs de n'importe quel autre tenant. L'attaquant contrôle l'application et reçoit tous les jetons consentis pour elle.

**Chemin 2 : enregistrer dans un tenant précédemment compromis.** Si l'attaquant a déjà violé un tenant (via AiTM, credential stuffing, ou n'importe quoi d'autre), il peut y enregistrer une application et ensuite utiliser cette application pour hameçonner des utilisateurs d'autres tenants. Le champ `publisher` de l'application montre le nom du tenant compromis, ce qui ajoute parfois une couche de fausse légitimité (« oh, ça vient d'un fournisseur avec lequel on travaille »).

Dans les deux cas, l'application malveillante finit par être signalée à Microsoft et désactivée — mais « finit par » est de jours à semaines, et l'attaquant a les jetons de consentement à ce moment-là. Désactiver l'application après ne révoque pas rétroactivement les jetons déjà émis.

## Comment le courriel arrive

Le courriel d'hameçonnage est typiquement un de trois prétextes :

**Le prétexte « fichier partagé ».** « Voir le fichier partagé dans [Nom d'application plausible]. » Le clic mène à une boîte de dialogue de consentement pour une application qui héberge prétendument le fichier.

**Le prétexte « votre outil IA/sécurité/productivité ».** « Votre compte a été provisionné pour [Outil plausible]. » Le clic mène à une boîte de dialogue de consentement sous prétexte d'accueil.

**Le prétexte OAuth-comme-contournement-MFA.** « Connectez-vous pour vérifier votre identité pour les RH / IT / Finance. » Variante la plus sophistiquée. L'utilisateur pense qu'il s'authentifie; il consent en fait.

Les trois présentent la *vraie boîte de dialogue de consentement Microsoft* parce que l'attaquant utilise le protocole OAuth légitime contre les vrais points de terminaison Microsoft. Il n'y a pas de fausse barre d'URL à remarquer. Le seul signal disponible à l'utilisateur est le *contenu* de la boîte de dialogue de consentement — qui, comme établi, il ne lit pas.

## Ce que Microsoft fait à ce sujet

Quelques défenses sont en place par défaut; certaines demandent de la configuration.

**Vérification de l'éditeur de l'application.** Microsoft offre une étiquette « éditeur vérifié » pour les applications d'organisations confirmées. Les utilisateurs peuvent être configurés pour ne consentir qu'aux applications vérifiées. C'est significatif — obtenir la vérification demande un enregistrement Microsoft Partner et un peu de paperasserie non triviale — mais les applications non vérifiées sont quand même autorisées par défaut dans la plupart des tenants.

**Politiques de consentement utilisateur (Entra ID).** L'admin peut restreindre quelles permissions les utilisateurs peuvent consentir sans approbation d'admin. Microsoft a révisé ces options à la fin 2024 / 2025, donc le menu dans le portail Entra aujourd'hui ressemble à ceci :

- *Ne pas autoriser le consentement utilisateur.* Tout demande l'approbation de l'admin. Très sécurisé, souvent trop restrictif pour les organisations avec des intégrations de productivité légitimes.
- *Autoriser le consentement utilisateur pour les applications d'éditeurs vérifiés, pour les permissions sélectionnées.* Les utilisateurs peuvent consentir à des applications d'éditeurs vérifiés ou à des applications enregistrées dans la propre organisation de l'utilisateur, et seulement pour des permissions que Microsoft classe comme « à faible impact ». Le terrain du milieu explicite et prévisible.
- *Laisser Microsoft gérer vos paramètres de consentement* (l'option recommandée de Microsoft à partir de 2025, et le nouveau défaut dans les tenants frais). Microsoft met à jour automatiquement la politique de consentement du tenant pour s'aligner sur ses lignes directrices actuelles. Un sous-interrupteur — *Activer le consentement utilisateur pour les clients de messagerie populaires* — permet aux utilisateurs de consentir à des applications de messagerie tierces populaires pour des permissions Mail spécifiques (Apple Mail, Thunderbird et similaires). Le sous-interrupteur est une concession d'utilisabilité dont la plupart des tenants ont besoin, mais il assouplit la politique dans le coin permissions-Mail de la surface.

L'ancienne option « Autoriser le consentement utilisateur pour toutes les applications » dont vous vous souvenez peut-être de l'ancien portail Entra a été retirée. Ce retrait est en lui-même une reconnaissance par Microsoft que l'ère du permissif-par-défaut est finie.

Pour un MSP qui gère des tenants clients, **l'option éditeurs-vérifiés-et-faible-impact reste habituellement le meilleur choix** — pas parce qu'elle est plus sûre que l'option gérée par Microsoft en termes absolus, mais parce qu'elle est *prévisible*. Vous savez exactement quelle est votre politique; vous contrôlez quand elle change; la piste d'audit est la vôtre. « Laisser Microsoft gérer » est approprié pour les tenants sans MSP qui veulent rester à jour avec les défauts évolutifs de Microsoft; pour les tenants que vous gérez, vous voulez être celui qui décide ce qui change et quand — et vous voulez que tout changement de politique atterrisse dans votre journal de changements, pas dans les notes de version de Microsoft.

Quelle que soit l'option non-bloquante que vous choisissez, la majorité des attaques d'hameçonnage par consentement OAuth échouent à l'étape de la boîte de dialogue de consentement parce que l'application malveillante n'est pas d'un éditeur vérifié et ne demande pas une permission « à faible impact ».

**Flux d'approbation d'admin.** Quand les utilisateurs essaient de consentir à une application qui dépasse leurs permissions autorisées, ils peuvent soumettre une « demande de consentement d'admin » à la place. L'admin révise et approuve ou rejette. Ça ajoute une étape de révision humaine avant que des applications à haute permission entrent dans le tenant.

**Découverte d'applications anormales de Defender for Cloud Apps.** MDA (E5 ou en module additionnel) détecte le comportement inhabituel d'application — une application qui commence soudainement à accéder à beaucoup plus de boîtes aux lettres que d'habitude, ou une application qui n'était pas vue hier mais exfiltre des données aujourd'hui. Les alertes se déclenchent sur l'anomalie *comportementale*, ce qui attrape même les applications qui ont réussi à se faufiler à travers la boîte de dialogue de consentement.

**Attack Disruption de Defender XDR** couvre aussi les incidents d'abus OAuth — quand la corrélation MDA + connexion atteint une haute confiance qu'une application consentie exfiltre, Disruption peut désactiver l'application et révoquer ses jetons.

## À quoi ressemble vraiment la révocation

Quand vous découvrez une application consentie malveillante — soit via une alerte, soit parce que le client a rapporté un comportement étrange — les étapes sont :

**1. Identifier l'application dans Entra ID.** Applications d'entreprise → chercher par nom ou par enregistrement récent → trouver la malveillante. Confirmer les permissions suspectes (Mail.ReadWrite + offline_access est la signature classique).

**2. Retirer le consentement de l'utilisateur.** Pour chaque utilisateur affecté, le consentement est dans sa collection `oauth2PermissionGrants`. L'admin peut révoquer par utilisateur ou à l'échelle de l'organisation.

**3. Désactiver ou supprimer le principal de service de l'application.** Ça empêche l'application de s'authentifier du tout. Fait depuis le blade applications d'entreprise.

**4. Révoquer tous les jetons de rafraîchissement pour les utilisateurs affectés.** C'est l'étape *critique*. Tant que les jetons de rafraîchissement ne sont pas révoqués, l'attaquant peut encore créer des jetons d'accès. Utilisez `Revoke-AzureADUserAllRefreshToken` (hérité) ou l'appel API Graph équivalent. Notez que Microsoft est au milieu d'une évolution de comment ça fonctionne — certains jetons de rafraîchissement sont liés à des applications spécifiques et survivent à la révocation au niveau utilisateur. Le mouvement le plus sûr est d'invalider aussi le mot de passe de l'utilisateur, même si ça ne désactive pas strictement l'application.

**5. Auditer les boîtes aux lettres affectées.** Cherchez le courriel envoyé, les règles de transfert, les téléchargements de fichiers, tout ce que l'application pourrait avoir fait pendant qu'elle avait l'accès. Traitez ça comme une compromission confirmée et exécutez le manuel de récupération BEC complet (leçon 6).

**6. Bloquer l'URL de réponse de l'application ou le tenant de l'application.** Si l'application malveillante est enregistrée dans un tenant connu-mauvais, vous pouvez utiliser l'accès conditionnel pour bloquer les connexions à ce tenant.

Le nettoyage complet est plus impliqué que pour une compromission de réinitialisation de mot de passe. C'est le point de l'attaque — elle est choisie par les attaquants parce qu'elle est difficile à nettoyer.

## Ce que Panoptica365 voit

L'hameçonnage par consentement OAuth fait surface dans Panoptica365 à travers plusieurs types d'alertes :

**Alertes de nouvelles attributions OAuth.** Quand un utilisateur consent à une nouvelle application dans le tenant d'un client, le consentement apparaît dans le journal d'audit unifié et Panoptica365 peut le faire remonter (surtout si les permissions demandées incluent `Mail.ReadWrite`, `Files.ReadWrite.All` ou `offline_access`). L'alerte exacte dépend de si le patron d'attribution-utilisateur ou d'attribution-admin a été utilisé.

**Anomalies de Defender for Cloud Apps** ingérées via Defender XDR. Quand MDA détecte qu'une application précédemment consentie se comporte anormalement (volume inhabituel de lectures de boîte aux lettres, activité soudaine dans une région où l'application n'a jamais été avant, etc.), l'alerte résultante coule dans Panoptica365.

**Activité d'application suspecte corrélée aux connexions.** Quand le compte du même utilisateur montre une attribution OAuth + un événement de suivi comme une attribution de permission de boîte aux lettres ou une règle de transfert, les deux alertes vont apparaître proches l'une de l'autre. Traitez-les comme le même incident.

Ce que Panoptica365 ne fait pas actuellement, c'est un inventaire complet d'applications OAuth par tenant avec notation de risque. Pour l'instant, le flux de travail manuel est : quand une alerte se déclenche, ouvrez la vue applications d'entreprise du portail Entra pour le tenant du client, filtrez par récemment consenti, et révisez.

## Défendre le client

Défenses en couches, par ordre d'impact :

**Mettre le consentement utilisateur à « éditeurs vérifiés, permissions à faible impact seulement ».** C'est le changement de configuration au plus haut levier. Élimine la plupart de l'hameçonnage par consentement à l'étape de la boîte de dialogue. Pour les tenants gérés par MSP, cette option explicite est préférable à « Laisser Microsoft gérer » parce que vous contrôlez la politique et tout changement à celle-ci atterrit dans votre piste d'audit plutôt que dans les notes de version de Microsoft. Configurez une fois par tenant.

**Implémenter le flux d'approbation d'admin.** Quand les utilisateurs veulent consentir à des applications au-delà de la portée autorisée, ils soumettent une demande. L'admin révise. Ajoute une vérification de bon sens sans bloquer les applications légitimes.

**Faire l'inventaire des applications consenties existantes périodiquement.** Le tenant Entra de chaque client a une liste d'applications d'entreprise. Révisez trimestriellement. Cherchez les applications avec des noms que vous ne reconnaissez pas, les applications avec des permissions larges, les applications qui ont été accordées par des utilisateurs qui ne devraient pas consentir à des applications à permissions larges. Retirez tout ce qui est suspect.

**Former les utilisateurs à lire les boîtes de dialogue de consentement.** Spécifiquement : tout ce qui demande `Mail.ReadWrite` ou `Files.ReadWrite.All` d'un éditeur inconnu est presque toujours malveillant. C'est une des rares formations de sécurité qui a une action concrète (« regardez les permissions, ensuite soit cliquez Annuler, soit vérifiez avec IT d'abord »).

**Utiliser l'accès conditionnel pour exiger l'approbation d'admin pour les nouvelles connexions d'application.** Une politique d'AC peut exiger l'approbation d'admin avant la première connexion d'un utilisateur à une application nouvellement enregistrée. Ralentit l'attaque significativement.

**Pour les tenants E5, activer Defender for Cloud Apps et configurer les politiques de gouvernance d'applications.** MDA peut mettre en quarantaine les applications à haut risque automatiquement et alerter sur le comportement anormal. Vaut la peine d'activer.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**Le consentement colle; traitez-le comme installer un logiciel.** Une fois qu'un utilisateur consent à une application, cette application a l'accès jusqu'à ce que quelqu'un le révoque explicitement. Traitez le consentement OAuth comme vous traiteriez l'installation de logiciels sur un terminal — réviser, approuver, documenter. Partout où les utilisateurs d'un client peuvent auto-consentir largement, vous avez un trou.

**Mail.ReadWrite + offline_access est l'équivalent OAuth de la « mise en scène de rançongiciel ».** Quand vous voyez cette combinaison de portées sur une application, regardez longuement. Il y a des applications légitimes qui en ont besoin, mais la plupart non, et les applications d'attaquant en ont presque toujours besoin.

**Le nettoyage est plus difficile que pour les compromissions de mot de passe.** Planifiez en conséquence. Quand l'alerte se déclenche, allouez plus de temps que vous le feriez pour un incident de réinitialisation de mot de passe, parce que les étapes sont : identifier l'application, révoquer les consentements par utilisateur, désactiver le principal de service, révoquer les jetons de rafraîchissement, auditer les données affectées, et réinitialiser le mot de passe de l'utilisateur juste au cas où. Traitez chaque incident d'application-consentie-malveillante comme un petit projet, pas une correction rapide.

## Ce qui suit

- **Leçon 5 : Abus du code d'appareil.** Étroitement lié à l'hameçonnage par consentement dans le sens qu'il abuse d'un flux d'authentification Microsoft légitime. Storm-2372 — l'acteur lié à la Russie — mène des campagnes de code d'appareil à grande échelle depuis août 2024.
- **Leçon 6 : BEC.** Là où l'accès acquis par OAuth finit souvent — surveillance silencieuse de boîte aux lettres, manipulation de factures, fraude au virement.

Pour l'instant : l'hameçonnage par consentement OAuth est la compromission persistante la plus silencieuse du catalogue M365. Les défenses sont au niveau configuration — fixer correctement les restrictions de consentement utilisateur et la plupart des attaques échouent à la boîte de dialogue. Le nettoyage est impliqué. La leçon pour les clients, c'est que toutes les menaces n'ont pas besoin d'utiliser le mot de passe.

---

*Sources des données dans cette leçon — Microsoft Learn sur les paramètres de consentement utilisateur et admin ([Microsoft Learn — Configure user consent settings](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent)); patrons d'hameçonnage par consentement OAuth ([Microsoft Learn — Illicit consent grant attacks](https://learn.microsoft.com/en-us/defender-office-365/detect-and-remediate-illicit-consent-grants)); référence des permissions Microsoft Graph ([Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference)); gouvernance d'applications Defender for Cloud Apps ([Microsoft Learn — App governance](https://learn.microsoft.com/en-us/defender-cloud-apps/app-governance-manage-app-governance)); procédure de révocation de jetons de rafraîchissement ([Microsoft Learn — Revoke user access in an emergency](https://learn.microsoft.com/en-us/entra/identity/users/users-revoke-access)).*
