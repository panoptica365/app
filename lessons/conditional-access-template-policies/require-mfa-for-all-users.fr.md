---
title: "Exiger MFA pour tous les utilisateurs — la fondation"
subtitle: "La politique d'AC qui bloque 99,9 % des compromissions automatisées — et pourquoi elle doit passer en premier."
icon: "shield-check"
last_updated: 2026-05-29
---

# Exiger MFA pour tous les utilisateurs — la fondation

L'équipe Microsoft Identity Security répète la même chose depuis six ans : l'activation du MFA bloque plus de 99,9 % des tentatives de compromission de compte automatisées. Le chiffre a été cité dans chaque formation Conditional Access que Microsoft a publiée et dans chaque formulaire de souscription d'assurance cyber depuis 2022.

L'autre côté de cette statistique est la partie que personne ne cite : dans les tenants où le MFA n'est *pas* universellement appliqué, le même 99,9 % décrit simplement ce qui arrive à tous les autres tenants. L'utilisateur non protégé dans le tenant non protégé est exactement celui que les botnets de credential stuffing cherchent.

C'est le modèle qui ferme cet écart.

**Panoptica365 - Require MFA for all users.** Octroi : Exiger MFA. Utilisateurs : Tous les utilisateurs. Applications : Toutes les applications infonuagiques.

C'est la politique d'AC la plus simple de la bibliothèque, la plus importante, et celle qui devrait être activée sur chaque tenant Business Premium et au-dessus avant tout autre travail d'AC.

## Ce qu'elle fait

La mécanique est sans complication. Chaque fois qu'un utilisateur se connecte à n'importe quelle application infonuagique, Microsoft évalue la politique. Si l'utilisateur a déjà satisfait au MFA dans sa session actuelle, la connexion procède. Sinon, Microsoft demande le MFA avant de laisser la connexion continuer.

Le contrôle unique est `Exiger l'authentification multifacteur`. Il n'y a aucune condition au-delà de « tous les utilisateurs, toutes les apps ». C'est la base — chaque connexion complète le MFA avant que quoi que ce soit d'autre se passe.

Ce dont la politique *ne se soucie pas* :

- L'emplacement de l'utilisateur. Qu'il soit au bureau, à la maison, ou dans un café à Lisbonne, le MFA est exigé.
- L'appareil. Portables personnels, appareils gérés, téléphones mobiles — MFA sur tous.
- L'application. Outlook, SharePoint, Teams, Power BI, le centre d'administration — toutes.
- L'heure de la journée ou le rôle de l'utilisateur. Tout le monde, toujours, à chaque connexion.

Cette uniformité est la force et la faiblesse de la politique. La force : aucun cas limite n'est non couvert, aucune brèche « mais mon compte de service n'a pas de MFA » n'existe. La faiblesse : chaque connexion, même depuis un appareil géré parfaitement digne de confiance, frappe le chemin MFA. C'est le compromis que la leçon 5 revisitera.

## Ce qu'elle défait

À peu près la moitié inférieure du catalogue de menaces de la carte 2.

**Credential stuffing** (carte 2 leçon 1) — le mot de passe est correct parce que l'attaquant l'a acheté dans un dump de brèche, mais il n'a pas la méthode MFA, donc la connexion échoue. C'est exactement l'attaque contre laquelle la statistique de 99,9 % a été mesurée.

**Password spray** — même défense. L'attaquant a essayé « Printemps2024! » contre 50 000 comptes; les quelques comptes où le mot de passe correspond ont encore besoin du MFA que l'attaquant n'a pas.

**Identifiants volés dans des brèches sans rapport** — même défense. L'utilisateur a réutilisé son mot de passe LinkedIn sur M365; l'attaquant l'a; le prompt MFA l'arrête.

Ce qu'elle ne défait pas :

- **Fatigue MFA** (carte 2 leçon 2) — l'utilisateur est celui qui approuve le prompt; le MFA n'aide pas quand l'utilisateur est le maillon faible.
- **Hameçonnage AiTM** (carte 2 leçon 3) — l'attaquant relaie le prompt MFA; l'utilisateur complète le MFA sur le faux site.
- **Hameçonnage par consentement OAuth** (leçon 4) — aucun mot de passe ni MFA n'est impliqué; l'attaque passe par la boîte de dialogue de consentement.
- **Abus du code d'appareil** (leçon 5) — l'utilisateur complète le MFA correctement sur la vraie page Microsoft; l'attaquant obtient quand même le jeton.

En d'autres mots : Exiger MFA pour tous les utilisateurs défait les attaques *basées sur les identifiants*. Elle ne défait pas les attaques *basées sur les jetons* ou *basées sur le consentement*. Celles-ci ont besoin de couches supplémentaires — exigences d'appareil conforme (leçons 4 et 5), MFA résistant à l'hameçonnage pour les utilisateurs à haute valeur (leçon 6), et le blocage du flux de code d'appareil (leçon 7).

Mais avant que n'importe laquelle de ces couches importe, la fondation doit être en place. Un tenant sans MFA universel est exposé à la classe d'attaque la plus simple, la moins chère, la plus automatisée. Il n'y a pas de raison défendable de laisser cet écart ouvert en 2026.

## À qui elle s'applique

Le modèle livre avec **Utilisateurs : Tous les utilisateurs**. L'intention est une couverture universelle.

En pratique, la politique a presque toujours une poignée d'exclusions :

- **Le ou les comptes break-glass** — de la leçon 1 du pré-déploiement. Exclus par défaut. Leur MFA est appliqué par d'autres moyens (la clé FIDO2 stockée physiquement), pas par l'AC.
- **Comptes de service documentés** qui n'ont pas encore été migrés vers des identités gérées — temporairement exclus avec une date d'expiration documentée. Chaque exclusion de compte de service est une faille de sécurité connue et devrait être sur un plan de coucher de soleil.
- **Comptes invités spécifiques dans des configurations inhabituelles** — rare. La plupart des invités B2B devraient avoir du MFA. Si un compte invité est exclu, documentez pourquoi.

Ce qui ne devrait *pas* être dans la liste d'exclusions :

- Les dirigeants. (« C'est plus facile comme ça » n'est pas un argument de sécurité.)
- Les travailleurs sur le terrain. (Leur MFA est sur leur téléphone; c'est déjà dans leur poche.)
- « Équipe service à la clientèle » ou autres groupes génériques. (S'ils utilisent les applications infonuagiques, ils ont besoin du MFA.)

Si un client pousse contre le MFA universel — « notre équipe des ventes trouve ça trop énervant » — la bonne réponse est de les inscrire à l'application Authenticator avec number matching, ou mieux, aux passkeys. Le prompt MFA à 8 h le lundi matin n'est pas la friction; l'alternative, c'est la friction d'expliquer une compromission par credential stuffing à toute la liste de clients de cet utilisateur.

## Déploiement

Conformément à la liste de vérification pré-déploiement de la leçon 1 : ce modèle se déploie à l'état Activé. Pour la plupart des tenants de petite entreprise, l'inventaire pré-déploiement (break-glass exclu, comptes de service catalogués, communication envoyée aux utilisateurs) est votre essai à blanc; déployez et surveillez de près. Pour les environnements complexes avec des principaux de service hérités, déployez via Panoptica365 puis basculez manuellement la politique en mode rapport uniquement dans le portail Entra pour une fenêtre de vérification de 3 à 7 jours avant de la laisser s'appliquer — la section 3 de la leçon 1 couvre le flux de rapport uniquement en détail.

Avant le déploiement, assurez-vous que chaque utilisateur a au moins une méthode MFA enregistrée. La page d'inscription combinée de Microsoft (`mysignins.microsoft.com/security-info`) est le chemin face à l'utilisateur. Envoyez le lien avec des instructions quelques jours avant le déploiement pour que les utilisateurs ne soient pas surpris par un prompt MFA un lundi matin.

Dans la première semaine après l'application, le widget Activité quotidienne de Panoptica365 montrera une pointe de défis MFA réussis. C'est la politique qui fonctionne — chaque connexion complète maintenant le deuxième facteur. Les alertes MFA-désactivé qui se déclenchaient avant le déploiement devraient être silencieuses pour les utilisateurs qui ont complété l'inscription. Les utilisateurs qui déclenchent encore des alertes MFA-désactivé une semaine après l'application sont soit des inscriptions incomplètes (chassez-les) soit des exclusions véritables (vérifiez et documentez).

Gérez la longue traîne des comptes de service et intégrations tierces à mesure que les alertes apparaissent dans la première semaine. Documentez chaque exclusion avec une justification et une date de coucher de soleil dans le système d'exemption de Panoptica365.

## À surveiller après l'application

Trois choses à surveiller :

**Échecs de défi MFA.** Une rafale soudaine de défis MFA échoués sur un utilisateur est le patron de fatigue MFA de la leçon 2 de la carte 2. L'anneau Activité quotidienne le fait remonter en quasi-temps-réel. L'approche de triage reste la même : IP étrangère + rafales de MFA échoués + succès éventuel = traitez comme compromission.

**Connexions qui complètent le MFA via SMS ou voix.** Ces méthodes sont plus faibles que le push, beaucoup plus faibles que les passkeys. Le rapport Méthodes d'authentification dans le portail Entra montre la répartition. Les clients avec trop de dépendance au SMS sont candidats à la mise à niveau de durcissement admin de la leçon 6 (MFA résistant à l'hameçonnage pour les utilisateurs à haute valeur).

**Dérive sur la politique elle-même.** Le détecteur de dérive AC de Panoptica365 signale si la politique est désactivée, si la liste d'utilisateurs se rétrécit, ou si la liste d'exclusions grandit. Une liste d'exclusions qui grandit sans votre connaissance, c'est quelqu'un d'autre qui désactive le MFA pour un utilisateur — enquêtez.

## Le chevauchement avec la leçon 5

Vous remarquerez en lisant la leçon 5 que le modèle **Require compliant or hybrid Azure AD joined device or MFA for all users** offre un chemin alternatif : les appareils gérés sautent le MFA, les appareils non gérés obtiennent le MFA. Les deux modèles existent dans la bibliothèque; ils ne sont pas censés être activés ensemble comme stratégie cohérente.

Si vous activez les deux : la combinaison la plus stricte gagne. La politique de la leçon 2 exige le MFA inconditionnellement, la politique de la leçon 5 dit « le MFA est une de trois preuves acceptables ». Quand les deux s'appliquent, le MFA est exigé parce que la leçon 2 n'accepte pas les chemins de confiance d'appareil. La leçon 5 devient redondante.

La bonne façon d'y penser :

- **Activez Exiger MFA pour tous les utilisateurs (cette leçon)** comme politique par défaut quand le tenant n'a pas encore une conformité Intune fiable, quand vous êtes tôt dans le déploiement, ou quand vous voulez la sémantique simple « toujours MFA ».
- **Activez Exiger conforme OU hybride OU MFA (leçon 5)** comme mise à niveau quand la conformité Intune est en place et fiable, le client veut une meilleure UX pour les utilisateurs sur appareils gérés, et vous faites confiance au signal de conformité.

La leçon 5 a le traitement complet du choix de stratégie. Pour l'instant : choisissez-en une. Ne faites pas tourner les deux en s'attendant à ce que les chemins OU s'appliquent — ils ne s'appliqueront pas.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**C'est la politique que vous déployez en premier.** Avant tout autre travail d'AC, avant tout modèle Intune, avant n'importe lequel des contrôles plus sophistiqués des leçons suivantes. Un tenant sans MFA universel est exposé à l'attaque la plus simple possible; fermer cet écart est la chose la plus à fort levier que vous puissiez faire pour un nouveau client.

**La statistique de 99,9 % gagne son pain ici.** Quand un client pousse contre la friction du MFA universel, cette statistique est la bonne réponse. Ce n'est pas un slogan; c'est un résultat mesuré de la propre télémétrie de Microsoft. Citez-la. Utilisez-la.

**Documentez chaque exclusion.** Chaque compte de service, chaque cas spécial, chaque entrée « cet utilisateur ne peut pas avoir le MFA parce que… » dans la liste d'exclusions est une faille dans le périmètre. Traitez chacune comme une question connue avec une date de coucher de soleil. Le système d'exemption de Panoptica365 rend ça concret — utilisez-le.

## Ce qui suit

- **Leçon 3 : Bloquer l'authentification héritée.** La politique compagne de celle-ci. Sans le blocage de l'auth héritée, l'attaquant qui a le mot de passe de l'utilisateur peut simplement utiliser un protocole hérité qui ne supporte pas le MFA et contourner toute cette politique. Les leçons 2 et 3 sont un déploiement apparié.
- **Leçon 5 : Conforme OU hybride OU MFA.** Le chemin de mise à niveau pour les tenants avec Intune en place — meilleure UX, même plancher de sécurité.

Pour l'instant : c'est la politique sans laquelle vous ne pouvez pas livrer. Faites-la déployer sur chaque tenant client. Documentez les exclusions. Passez à la leçon 3.

---

*Sources des données dans cette leçon — Microsoft Identity Security Group sur le blocage par MFA de 99,9 % des compromissions de compte automatisées ([Weinert, août 2019](https://techcommunity.microsoft.com/blog/microsoft-entra-blog/your-pa%24%24word-doesn%E2%80%99t-matter/731984)); Microsoft Learn sur la structure des politiques d'accès conditionnel ([Microsoft Learn — Conditional Access policies](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-policies)); référence de la page d'inscription combinée ([Microsoft Learn — Combined registration](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-registration-mfa-sspr-combined)).*
