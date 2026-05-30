---
title: "Désactiver le flux de code d'appareil — la défense Storm-2372"
subtitle: "Comment Storm-2372 abuse du code d'appareil pour contourner le MFA, et la politique d'AC qui ferme ce vecteur."
icon: "smartphone"
last_updated: 2026-05-29
---

# Désactiver le flux de code d'appareil — la défense Storm-2372

La leçon 5 de la carte 2 a parcouru ce qu'est l'abus du code d'appareil, pourquoi il contourne le MFA, et comment Storm-2372 — un acteur de menace aligné avec la Russie — l'utilise à grande échelle contre les gouvernements, ONG, services IT et autres cibles depuis août 2024. La défense dans cette leçon était une politique d'AC unique : bloquer le flux d'authentification par code d'appareil pour les utilisateurs qui n'en ont pas besoin.

C'est cette politique.

**Panoptica365 - Disable Device Code Flow.** Description : *Empêche l'exploitation du flux de code d'appareil.* Octroi : Aucun (bloquer). Utilisateurs : Tous les utilisateurs. Applications : Toutes les applications infonuagiques.

C'est une des politiques d'AC les moins chères et à plus haut levier que vous pouvez déployer sur un tenant client. La plupart des tenants n'ont aucun besoin légitime du flux de code d'appareil. Le bloquer ne coûte rien dans ces tenants et ferme toute la surface d'attaque Storm-2372.

Cette leçon couvre le détail opérationnel — ce que la politique fait, quand la déployer, ce qu'il faut surveiller, quand les exceptions rares s'appliquent.

## Ce qu'elle fait

La politique utilise la condition **flux d'authentification** de l'accès conditionnel — une condition d'AC relativement récente (preview jusqu'en 2024, généralement disponible en 2025) qui vous permet de cibler les connexions par *comment* elles se sont authentifiées. Un des interrupteurs à l'intérieur de cette condition est « Flux de code d'appareil ».

La politique est configurée :

- **Condition de flux d'authentification : Flux de code d'appareil.**
- **Octroi : Bloquer.**
- **Utilisateurs : Tous les utilisateurs.**
- **Applications : Toutes les applications infonuagiques.**

Toute tentative de connexion qui utilise le flux de code d'appareil est rejetée d'emblée. Le code utilisateur qu'un attaquant a envoyé à la victime par WhatsApp / Teams / Signal ne peut pas être utilisé. Le manuel Storm-2372 échoue à la toute première étape.

La mécanique de la leçon 5 de la carte 2 vaut la peine d'être répétée en une phrase : l'hameçonnage par code d'appareil fonctionne parce que l'utilisateur complète correctement le MFA sur la vraie page de Microsoft, mais l'appareil recevant le jeton résultant appartient à l'attaquant. Bloquer le flux de code d'appareil à la couche de la politique signifie que le jeton n'est jamais émis, peu importe si l'utilisateur a complété le MFA.

## Pourquoi « Tous les utilisateurs » est le bon défaut

La plupart des politiques d'AC sont déployées avec un cadrage réfléchi — groupes d'utilisateurs spécifiques, apps spécifiques. Celle-ci se déploie par défaut sur « Tous les utilisateurs / Toutes les applications infonuagiques » et c'est correct.

La raison : le flux de code d'appareil est un *chemin d'authentification Microsoft légitime*, mais il est utilisé par un ensemble très étroit de clients légitimes. Spécifiquement :

- Imprimantes et appareils IoT faisant du scan-vers-courriel ou similaire — mais ceux-ci utilisent habituellement des comptes de service, pas des comptes utilisateurs, et le compte de service a souvent sa propre politique d'AC dédiée.
- Microsoft Graph PowerShell ou Microsoft 365 CLI quand exécuté sur une machine qui n'a pas de navigateur disponible — cas d'usage étroit, habituellement un développeur ou admin faisant du travail d'automatisation.
- Vieilles apps d'exemples Microsoft et tutoriels — rares en 2026, surtout retirés.

Pour la grande majorité des utilisateurs dans la grande majorité des tenants, le flux de code d'appareil n'est pas légitimement utilisé. Les quelques exceptions (comptes de service spécifiques, scénarios de développeur spécifiques) sont exclues par nom plutôt que par découpe large de populations d'utilisateurs.

Un tenant avec zéro cas d'usage documenté de code d'appareil devrait bloquer le flux pour tous les utilisateurs. Un tenant avec un ou deux cas d'usage documentés devrait bloquer pour tous les utilisateurs *sauf* les comptes de service spécifiques qui en ont besoin. Il n'y a aucun scénario où « flux de code d'appareil ouvert pour tout le monde » est le bon réglage en 2026.

## Ce qui peut briser — et comment le gérer

La rupture la plus courante quand cette politique est activée :

**Automatisation PowerShell multi-tenant.** Un MSP qui utilise Microsoft Graph PowerShell pour gérer plusieurs tenants clients exécute souvent des scripts qui s'authentifient par code d'appareil. Le script affiche un code, l'opérateur l'entre dans un navigateur, le script opère ensuite sur le tenant du client. Si le tenant du client a le blocage de code d'appareil activé, le script échoue.

Solution : utiliser l'authentification par principal de service (secret client ou certificat) au lieu de code d'appareil. Graph PowerShell moderne le supporte. Le script change d'une « connexion interactive par code d'appareil » à une « connexion non interactive par principal de service », ce qui est plus sécurisé de toute façon parce qu'il n'y a pas d'étape humain-dans-la-boucle où l'ingénierie sociale peut détourner le flux.

**Tutoriels d'exemples Microsoft spécifiques.** La documentation Microsoft utilise parfois le code d'appareil comme exemple de flux d'authentification pour les nouveaux venus. Suivre ces tutoriels contre un tenant avec cette politique activée échouera. La solution est habituellement d'utiliser le flux de connexion interactif à la place, qui fonctionne par un navigateur normal.

**Vieilles imprimantes et appareils IoT.** Certains appareils multifonctions hérités utilisent le code d'appareil pour la configuration scan-vers-courriel. Les appareils plus récents sont passés à SMTP OAuth 2.0 avec identifiants stockés. Si vous avez une vieille imprimante qui utilise encore le code d'appareil, vous avez un choix : exclure le compte de service de l'imprimante de cette politique (avec une justification documentée et une date de coucher de soleil pour le remplacement d'imprimante), ou remplacer l'imprimante par un modèle moderne.

**Outils maison du client.** Occasionnellement un client a un outil construit maison qui s'authentifie par code d'appareil. Même réponse que pour les imprimantes : exclure le compte spécifique avec documentation, ou migrer l'outil vers l'authentification par principal de service.

Le patron dans chaque cas : l'exception est *un compte spécifique sur un cas d'usage spécifique*. Les exclusions larges comme « exclure le département IT » sont le mauvais mouvement. Le département IT n'a pas besoin du code d'appareil comme classe.

## Déploiement

Déploiement le plus court de la carte parce que la surface d'usage légitime est petite. L'inventaire pré-déploiement est l'essai à blanc.

Inventaire pré-déploiement : vérifiez le journal de connexion Entra des 30 derniers jours, filtré sur `authenticationProtocol == "deviceCode"`. Listez chaque compte qui a utilisé avec succès le code d'appareil. Pour la plupart des clients, cette liste sera très courte ou vide.

Pour chaque correspondance du pré-déploiement :

- Cas d'usage légitime (compte de service, automatisation documentée) → ajouter à la liste d'exclusion de la politique avec une date de coucher de soleil *avant* le déploiement.
- Utilisateur inattendu → indicateur potentiel de compromission (un attaquant peut déjà être en train d'hameçonner cet utilisateur par code d'appareil). Enquêtez immédiatement, *avant* de déployer cette politique.

Une fois le pré-déploiement complet, déployez. Le modèle s'active à l'état Activé — typiquement avec zéro impact sur les utilisateurs légitimes parce que presque personne sur un tenant de petite entreprise n'utilise le code d'appareil légitimement. Surveillez les 48 premières heures pour tout utilisateur inattendu bloqué par la politique. Soit vous avez raté quelque chose dans le pré-déploiement (rare mais possible), soit un attaquant vient d'être contrecarré (la politique fonctionne).

Pour les tenants plus grands ou plus complexes avec plusieurs cas d'usage documentés de code d'appareil, l'étape manuelle de rapport uniquement dans le portail Entra peut être utilisée comme prudence supplémentaire — mais pour la plupart des tenants, l'inventaire pré-déploiement est suffisant et l'approche déploiement-à-chaud est appropriée.

## À surveiller après l'application

Le widget Activité quotidienne montrera des blocages d'AC sur cette politique. Dans un tenant en santé, le volume devrait être :

- **Proche de zéro** en régime permanent. Les vrais utilisateurs sur de vrais appareils n'utilisent pas le code d'appareil, donc ils ne déclenchent pas la politique.
- **Pointes occasionnelles** quand un attaquant sonde — typiquement des campagnes de style Storm-2372 qui essaient de démarrer un flux de code d'appareil sur le tenant. Chaque pointe est une *défense réussie* — la politique fait son travail.

Ce que vous voulez spécifiquement voir si Storm-2372 cible un jour un client :

1. **Une rafale de connexions échouées** avec `authenticationProtocol == "deviceCode"` — l'initiation automatisée de code d'appareil de l'attaquant frappant la politique.
2. **Aucune connexion réussie par code d'appareil** — la politique bloque l'abus tenté avant qu'il ne puisse se compléter.
3. **Aucun nouvel enregistrement d'appareil** dans le journal d'audit suivant les tentatives échouées.

Le troisième point compte spécifiquement à cause de l'évolution de février 2025 de Storm-2372 : l'attaquant essaie d'enregistrer son propre appareil dans Entra ID en utilisant le jeton acquis par code d'appareil. Si le flux de code d'appareil a été bloqué, aucun jeton n'a été émis, et aucun enregistrement d'appareil ne suit. Toute la chaîne d'attaque s'arrête à la première étape.

Si vous voyez jamais des connexions réussies par code d'appareil dans un tenant où cette politique est censée être activée, c'est une alerte qui vaut la peine d'être enquêtée immédiatement — soit la politique a été désactivée (dérive), soit une exclusion est trop large (mauvaise configuration). Les deux sont urgents.

## Ce que Panoptica365 voit

Deux catégories de signaux principales :

**Tentatives de connexion par code d'appareil suspectes (échouées ou réussies).** Le pipeline d'ingestion UAL de Panoptica365 inclut des évaluateurs qui cherchent l'activité de code d'appareil. Quand la politique est activée et fonctionne, vous devriez voir des tentatives échouées (la politique les a bloquées) et très peu ou aucune tentative réussie. Une connexion par code d'appareil réussie à un compte inattendu vaut la peine d'être enquêtée.

**Nouvel appareil enregistré.** Quand un attaquant complète avec succès l'attaque évoluée de Storm-2372 (la variante Microsoft Authentication Broker de février 2025), l'étape suivante est d'enregistrer sa machine comme appareil dans le tenant. Panoptica365 alerte sur les événements de nouvel enregistrement d'appareil. Croisez avec l'activité de connexion — y avait-il une connexion récente par code d'appareil pour cet utilisateur avant l'enregistrement de l'appareil? C'est la chaîne d'attaque.

L'anneau Activité quotidienne fait aussi remonter les blocages d'AC en quasi-temps-réel, y compris les blocages sur cette politique.

## La conversation avec le client

Quand vous proposez d'activer cette politique sur un tenant client, la question typique du client est « qu'est-ce que ça brise? » La réponse honnête est « presque rien, parce que presque rien n'utilise légitimement le code d'appareil dans votre environnement ». L'inventaire pré-déploiement vous le dira à coup sûr — et s'il y a un ou deux cas d'usage légitimes, vous excluez ces comptes et procédez.

Le pitch :

- La menace Storm-2372 est réelle, documentée, en cours.
- Microsoft elle-même recommande de bloquer le code d'appareil pour les tenants sans cas d'usage documentés depuis février 2025.
- La politique s'active d'abord en rapport uniquement, donc vous pouvez vérifier que rien ne se brise avant d'appliquer.
- Le coût est essentiellement zéro (aucune friction pour les utilisateurs normaux; exclusions spécifiques pour toute automatisation légitime).

Pour les tenants dans des secteurs cibles (gouvernement, ONG, services IT, défense, télécoms, santé, enseignement supérieur, énergie — la liste de cibles Storm-2372), cette politique est spécialement recommandée. Pour d'autres secteurs, elle est encore recommandée; le ciblage de l'acteur peut changer, et la politique est assez peu chère pour que la défense en profondeur s'applique.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**Ajoutez ceci à la liste de vérification d'accueil des nouveaux clients.** De tous les modèles d'AC de la carte 3, celui-ci a le plus haut ratio impact-effort pour la plupart des tenants. Déploiement de trois jours, friction utilisateur proche de zéro, défense complète contre une menace sophistiquée identifiée.

**Surveillez le journal de connexion pour l'usage légitime de code d'appareil comme ligne de base.** Si vous trouvez un tenant où le code d'appareil est utilisé par quelque chose que vous n'attendiez pas, c'est intéressant — ça pourrait être légitime (un script oublié) ou ça pourrait être une compromission partielle existante. Dans les deux cas, enquêtez avant de déployer la politique.

**Cette politique ne remplace pas les autres.** Elle est étroitement cadrée — seulement le flux de code d'appareil. Le reste de la bibliothèque d'AC (application MFA, restrictions géo, durcissement admin) est encore nécessaire. Cette politique ferme un vecteur d'attaque spécifique que les politiques plus larges n'adressent pas.

## Ce qui suit

- **Leçon 8 : Importer vos propres modèles d'AC.** Comment prendre une politique d'AC personnalisée d'un tenant et la transformer en modèle Panoptica365 qui se déploie à travers la base de clients du MSP. La généralisation d'emplacements nommés qui rend les modèles portables.
- **Leçon 9 : Opérer l'AC à l'échelle.** Le closer méta sur la dérive, les exclusions et le cycle de vie.

Pour l'instant : déployez cette politique sur chaque tenant client qui n'a pas d'exigence documentée de code d'appareil. Le risque du client face à la menace Storm-2372 passe d'« exposé » à « couvert » avec trois jours de travail et une friction proche de zéro. Il n'y a pas beaucoup d'autres politiques d'AC avec ce ROI.

---

*Sources des données dans cette leçon — Microsoft Security Blog sur la campagne d'hameçonnage par code d'appareil de Storm-2372 ([Microsoft Security Blog — Storm-2372 conducts device code phishing campaign, février 2025](https://www.microsoft.com/en-us/security/blog/2025/02/13/storm-2372-conducts-device-code-phishing-campaign/)); condition de flux d'authentification de l'accès conditionnel ([Microsoft Learn — Conditional Access: Authentication flows](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-cloud-apps#authentication-flows)); référence technique du flux d'autorisation d'appareil OAuth 2.0 ([Microsoft Learn — OAuth 2.0 device code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code)).*
