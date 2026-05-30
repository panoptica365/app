---
title: "Bloquer l'authentification héritée — fermer le contournement par auth de base"
subtitle: "Pourquoi IMAP et SMTP AUTH contournent le MFA, et comment une politique d'AC ferme cette faille."
icon: "ban"
last_updated: 2026-05-29
---

# Bloquer l'authentification héritée — fermer le contournement par auth de base

Vous activez Exiger MFA pour tous les utilisateurs un lundi matin. Le mardi après-midi, l'attaquant qui avait déjà le mot de passe d'un utilisateur d'une brèche LinkedIn de 2019 se connecte à la boîte aux lettres de cet utilisateur par IMAP. Pas de prompt MFA. Pas de défi. Pas d'alerte. Juste une connexion réussie à une boîte à laquelle il ne devrait pas avoir accès.

La politique MFA n'a pas aidé parce que IMAP ne parle pas MFA. Ni POP3, ni SMTP AUTH, ni aucun des demi-douzaine d'autres protocoles d'« authentification héritée » que Microsoft essaie de retirer depuis une décennie. Pour une politique d'AC qui dit « exiger MFA », un client d'auth héritée se connecte *comme si le MFA n'avait jamais été demandé*. L'utilisateur a les bons identifiants. Il n'y a pas de prompt MFA. La connexion réussit.

C'est la faille que le modèle Bloquer l'authentification héritée ferme.

**Panoptica365 - Block Legacy Authentication.** Octroi : Aucun (c'est-à-dire bloquer). Utilisateurs : Tous les utilisateurs. Applications : Toutes les applications infonuagiques.

C'est la politique appariée à la leçon 2. Sans elle, Exiger MFA pour tous les utilisateurs a un trou. Ensemble, elles ferment le chemin d'attaque par vol d'identifiants le plus courant dans M365.

## Qu'est-ce que « l'authentification héritée », exactement

Le terme couvre tout protocole d'authentification qui ne supporte pas les fonctionnalités modernes comme MFA, l'accès conditionnel ou la liaison de jetons. Les principaux délinquants :

- **Authentification de base** — le protocole nom-d'utilisateur-et-mot-de-passe-sur-HTTP-Basic-Auth. Utilisé historiquement par Outlook pour Mac, Mail.app sur iOS avant iOS 11, envoyeurs SMTP scriptés.
- **IMAP / POP3 / SMTP AUTH** — les protocoles de courriel classiques. Utilisés par des clients de courriel tiers, des appareils scan-vers-courriel, de vieux scripts.
- **Exchange ActiveSync (EAS) auth de base** — la variante d'ActiveSync qui ne supporte pas l'auth moderne. Utilisée par des clients de courriel mobiles plus anciens.
- **MAPI sur HTTP auth de base** — la variante MAPI héritée. Utilisée par des clients Outlook très anciens.
- **Outlook Anywhere (RPC sur HTTP) auth de base** — même famille.

Microsoft retire ceux-ci depuis des années. En octobre 2022, ils ont désactivé l'auth de base pour la plupart des protocoles Exchange Online. En 2023 et 2024, ils ont étendu la dépréciation aux chemins hérités restants. À partir de 2026, la surface est significativement plus petite qu'elle ne l'était — mais des poches restent, et toute poche est un trou.

L'alternative non héritée est l'**authentification moderne** — basée sur OAuth 2.0, supporte MFA, supporte l'accès conditionnel, supporte les contrôles de session basés sur les jetons. Chaque client M365 supporté depuis 2020 parle l'auth moderne.

## Pourquoi cette politique est encore nécessaire en 2026

Si Microsoft a retiré la plupart de l'auth héritée, pourquoi livrer une politique qui la bloque?

Trois raisons :

**1. La retraite est incomplète.** Microsoft a désactivé l'auth de base pour *la plupart* des protocoles Exchange Online, mais l'état « désactivé par défaut » ne signifie pas désactivé partout. Certains principaux de service peuvent encore s'authentifier par des chemins hérités. SMTP AUTH est encore disponible (Microsoft l'a réactivé et redésactivé tenant par tenant pendant des années). Des tenants spécifiques qui ont demandé des exceptions pendant la dépréciation peuvent encore avoir l'auth de base activée pour un ou plusieurs protocoles.

**2. Les clients réactivent l'auth de base.** Quand le vieil appareil scan-vers-courriel d'un client cesse de fonctionner, le chemin de moindre résistance est d'appeler le support Microsoft et demander de réactiver l'auth de base pour SMTP. Certains clients l'ont fait. La politique d'AC est ce qui attrape cette décision — et l'empêche d'être prise silencieusement.

**3. Certaines applications non Microsoft l'utilisent encore.** Les applications tierces qui s'intègrent à M365 par IMAP ou SMTP — outils d'automatisation de marketing plus anciens, applications métier avec identifiants codés en dur, le script auto-construit occasionnel — parlent l'auth héritée par conception. La politique d'AC force une conversation : soit moderniser l'intégration, soit documenter l'exclusion.

La politique d'AC est le filet de sécurité durable. La dépréciation de Microsoft au niveau du protocole peut être inversée au niveau du tenant; une politique d'AC activée et surveillée ne peut pas être inversée silencieusement.

## Ce qu'elle fait

La mécanique de la politique est simple :

- **Octroi : Bloquer.** Les connexions correspondant à la politique sont rejetées d'emblée. Pas de prompt MFA, pas de défi — juste rejetées.
- **Conditions : Applications clientes = Autres clients.** C'est la condition d'AC qui capture tout ce qui *n'est pas* l'auth moderne : Exchange ActiveSync auth de base, IMAP, POP3, SMTP AUTH, MAPI sur HTTP, et quelques autres. La politique s'applique seulement aux connexions de ces clients hérités; les connexions par auth moderne ne sont pas affectées.

Donc un utilisateur qui ouvre Outlook (auth moderne) n'est pas affecté; un vieux script qui essaie SMTP AUTH depuis une boîte Linux est bloqué. L'expérience utilisateur pour la vaste majorité des utilisateurs est *aucun changement* — ils sont déjà sur l'auth moderne et ne remarquent rien.

## Ce qui peut se briser quand vous l'activez

Le pré-déploiement compte ici, parce que le blocage de l'auth héritée est une des politiques les plus susceptibles de faire remonter des intégrations inconnues.

Bris courants :

**Scan-vers-courriel sur les imprimantes.** Les imprimantes multifonctions plus anciennes ont été configurées il y a des années pour envoyer du courriel via SMTP AUTH avec un compte de service. Quand l'auth héritée est bloquée, l'imprimante ne peut plus envoyer. La solution : soit reconfigurer l'imprimante pour utiliser un relais SMTP moderne (la plupart des imprimantes modernes supportent SMTP OAuth 2.0 maintenant), soit faire passer le scan-vers-courriel par un connecteur qui gère le chemin hérité.

**Vieilles applications métier avec identifiants SMTP codés en dur.** Plusieurs apps internes ont une fonction « envoyer un courriel quand ça arrive » configurée avec des identifiants SMTP codés en dur depuis 2017. Elles échouent silencieusement quand bloquées. Le client le remarque quand un flux de travail qui envoyait des notifications cesse d'envoyer.

**Outils CRM / marketing tiers avec intégration courriel basée sur IMAP.** Vieilles intégrations Salesforce, vieilles configurations HubSpot, outils personnalisés d'analyse de courriel. Certains utilisent encore IMAP par défaut. La plupart des versions modernes supportent IMAP OAuth 2.0, mais les installations héritées peuvent ne pas avoir été mises à niveau.

**Macs qui font tourner de vieilles versions de Mail.app.** Mail.app pré-iOS 11 / pré-macOS 10.14 utilise l'auth de base. Les utilisateurs sur du matériel vraiment vieux ne peuvent pas se connecter. La solution est habituellement « votre ordinateur est trop vieux pour s'authentifier à un système de courriel d'entreprise moderne; voici un budget de 400 $ pour un nouveau ». Cette conversation est inconfortable mais correcte.

**Scripts PowerShell personnalisés qui envoient du courriel.** Scripts internes utilisant `Send-MailMessage` avec identifiants codés en dur. La solution est de migrer vers `Send-MailKitMessage` ou d'utiliser l'API Graph.

Chacun de ceux-ci est un cas d'usage *connu* d'auth héritée que l'opérateur trouve pendant la fenêtre de rapport uniquement. Aucun n'est une raison de *ne pas* activer la politique — ce sont des raisons de planifier la transition soigneusement et de migrer les intégrations affectées.

## Déploiement

Ce modèle se déploie à l'état Activé comme les autres, mais avec une différence importante : **les bris d'auth héritée sont plus difficiles à prédire que les bris MFA**. Les comptes de service qui ne s'authentifient qu'une fois par trimestre (pour le rapport de fin d'année, pour le lot de factures récurrent) ne se montrent pas dans l'inventaire pré-déploiement ni dans la première semaine de surveillance. Leur échec se manifeste des mois plus tard.

Pour cette raison, l'étape manuelle de rapport uniquement dans le portail Entra est **fortement recommandée pour cette politique spécifique peu importe la taille du tenant**, même sur des tenants de petite entreprise où les autres modèles peuvent se déployer à chaud. Déployez via Panoptica365 (crée la politique à l'état Activé), puis basculez immédiatement la politique en rapport uniquement dans le portail Entra, et exécutez une fenêtre de rapport uniquement de *14 jours*.

Pendant la fenêtre de rapport uniquement, tirez le journal de connexion filtré sur « Bloqué — Résultat rapport uniquement, Client = Autres clients ». Inventoriez :

- Quels utilisateurs? (Surtout des comptes de service; quelques vrais utilisateurs sur de vieux clients.)
- Quels protocoles? (SMTP AUTH est le plus courant.)
- Quelles IP / appareils? (Imprimantes, scripts, intégrations tierces.)

Puis travaillez à travers l'inventaire :

- Pour chaque cas d'usage légitime, identifiez un chemin de modernisation, ou acceptez que le compte reste sur l'auth héritée et documentez l'exclusion dans Panoptica365 avec une date de coucher de soleil.
- Pour chaque connexion suspecte ou inconnue, traitez comme compromission potentielle — même manuel que la réponse au credential stuffing dans la leçon 1 de la carte 2.

Communiquez aux utilisateurs avec de vieux clients sur le changement à venir. Fournissez des instructions de modernisation. Puis basculez la politique de retour à Activé dans le portail Entra.

La fenêtre de rapport uniquement de 14 jours pour l'auth héritée est plus longue que pour la plupart des politiques parce que les cas d'usage d'auth héritée se cachent dans des cycles mensuels et trimestriels. Une fenêtre de 3 jours rate trop d'intégrations silencieuses.

## À surveiller après l'application

**Tentatives de connexion avec `Autres clients` qui réussissent.** Devrait être zéro après l'application (la politique les bloque). Toute connexion réussie par des chemins hérités signifie un écart de politique — une exclusion qui est trop large, ou un protocole que la politique ne couvre pas.

**Tentatives de connexion avec `Autres clients` qui échouent avec un blocage d'AC.** Devrait être le bruit quotidien normal — des attaquants qui sondent, de vieux scripts sur des comptes exclus. Faites attention à la *source*. Une rafale de tentatives d'auth héritée sur plusieurs comptes depuis une seule IP est du credential stuffing utilisant un botnet qui n'a pas suivi l'auth moderne.

**Dérive sur la politique.** La même détection de dérive qui s'applique à Exiger MFA s'applique ici. Si la politique est désactivée ou sa portée se rétrécit, quelqu'un (l'autre admin du client, un technicien du support Microsoft) a relâché le périmètre.

## L'ordre compte

Bloquer l'Auth Héritée devrait être activé *après* Exiger MFA, pas avant. Raisonnement :

- Exiger MFA couvre toutes les connexions par auth moderne. La politique MFA met le deuxième facteur devant le chemin mot-de-passe-seul.
- Bloquer l'Auth Héritée couvre toutes les connexions par non-auth-moderne. La politique de blocage met un mur devant le chemin mot-de-passe-seul qui *ne supporte pas* le MFA.

Ensemble, elles ferment la surface : toute connexion soit a du MFA (moderne), soit est bloquée d'emblée (héritée). Il n'y a pas de chemin à travers avec seulement un mot de passe.

Si vous activiez Bloquer l'Auth Héritée *en premier*, les connexions par auth moderne sans MFA réussiraient encore. Si vous activiez Exiger MFA *en premier* sans Bloquer l'Auth Héritée, les connexions par auth héritée réussiraient encore. La paire doit être déployée ensemble; l'ordre est « MFA d'abord, puis Bloquer l'Auth Héritée quelques jours plus tard ». La politique MFA peut être activée avec une portée plus large et un risque de bris plus faible; Bloquer l'Auth Héritée ferme ensuite le trou restant.

## Ce que Panoptica365 voit

La détection réussie des tentatives bloquées par cette politique passe par l'ingestion standard du journal de connexion. Trois signaux qui comptent :

- **Une rafale de blocages d'auth héritée** sur plusieurs comptes depuis une seule IP — credential stuffing par un protocole hérité. Même triage que le patron de credential stuffing par auth moderne.
- **Une connexion réussie inattendue par auth héritée** — quelqu'un a relâché la politique. Enquêtez.
- **Une liste d'exclusions qui a grandi de manière inattendue** — dérive sur la politique elle-même, faite remonter par le détecteur de dérive AC de Panoptica365.

L'anneau Activité quotidienne fait remonter le volume de blocages d'AC en quasi-temps-réel, y compris les blocages d'auth héritée. Après l'application, le volume de blocages d'auth héritée devrait être un nombre faible et stable (des attaquants qui sondent) sans pointes.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**Bloquer l'Auth Héritée est la compagne d'Exiger MFA, pas un remplacement.** Les deux sont nécessaires. La politique MFA couvre le chemin que les utilisateurs utilisent; la politique Bloquer l'Auth Héritée couvre le chemin que les attaquants préfèrent.

**La fenêtre de rapport uniquement est plus longue ici que pour les autres politiques.** Les cas d'usage d'auth héritée se cachent dans des automatisations mensuelles et trimestrielles qui ne se montrent pas dans un échantillon de rapport uniquement de 3 jours. Budgétez deux semaines.

**Résistez à la pression du client de faire des exclusions larges.** « Notre imprimante a besoin de SMTP AUTH » est vrai; « on doit exclure tout le département IT » ne l'est pas. Chaque exclusion est un compte spécifique sur une IP spécifique avec un cas d'usage documenté et une date de coucher de soleil. Les exclusions larges sont comment cette politique se fait compromettre au ralenti.

## Ce qui suit

- **Leçon 4 : Emplacement de confiance OU appareil conforme.** La prochaine couche d'AC — basée sur l'emplacement avec une soupape de sécurité intelligente pour les appareils conformes.
- **Leçon 5 : Conforme OU hybride OU MFA.** Le chemin de mise à niveau qui utilise les signaux de confiance d'appareil pour réduire la friction sur les connexions par appareil géré.

Pour l'instant : cette politique plus Exiger MFA de la leçon 2 sont la base. Tant que les deux ne sont pas activées et vérifiées sur un tenant client, aucun des travaux d'AC plus sophistiqués des leçons suivantes n'a d'importance — le chemin d'attaque par identifiants seuls est encore ouvert.

---

*Sources des données dans cette leçon — Microsoft Learn sur l'authentification héritée et la retraite de l'auth de base ([Microsoft Learn — Deprecation of Basic authentication in Exchange Online](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/deprecation-of-basic-authentication-exchange-online)); référence de la condition d'AC « Autres clients » ([Microsoft Learn — Conditional Access: Client apps condition](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-conditions#client-apps)); vue d'ensemble de l'authentification moderne ([Microsoft Learn — Modern authentication](https://learn.microsoft.com/en-us/microsoft-365/enterprise/modern-auth-for-office-2013-and-2016)).*
