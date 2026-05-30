---
title: "Conforme OU hybride OU MFA — la politique OU de signaux de confiance"
subtitle: "Le successeur Intune-compatible de Exiger MFA : accès si l'appareil est géré, hybrid-joined, ou si MFA est satisfait."
icon: "git-branch"
last_updated: 2026-05-29
---

# Conforme OU hybride OU MFA — la politique OU de signaux de confiance

La leçon 2 a couvert la politique Exiger MFA pour tous les utilisateurs : simple, fondamentale, toujours-MFA-peu-importe-quoi. Cette leçon est sa successeure — la version plus sophistiquée pour les tenants qui ont Intune qui fonctionne et qui veulent donner aux utilisateurs sur appareils gérés une expérience plus fluide sans abandonner le plancher de sécurité.

**Panoptica365 - Require compliant or hybrid Azure AD joined device or MFA for all users.** Description : *Vérifier plusieurs conditions pour permettre les connexions.* Octroi : Exiger MFA, Exiger appareil conforme, Exiger Hybrid Azure AD joined (OU). Utilisateurs : Tous les utilisateurs. Applications : Toutes les applications infonuagiques.

Ce modèle utilise le même patron de condition OU que la leçon 4 a introduit — plusieurs chemins pour satisfaire la même intention. La politique de la leçon 4 combinait la confiance d'emplacement avec la confiance d'appareil. La politique de cette leçon combine trois façons différentes de prouver que la posture de l'utilisateur est digne de confiance : appareil géré, appareil hybride-joined, ou MFA.

Choisissez n'importe lequel, la connexion procède. Choisissez aucun, la connexion est bloquée.

## Les trois chemins

**Chemin 1 : Appareil conforme.** L'appareil depuis lequel l'utilisateur se connecte est inscrit à Intune et rapporte actuellement conforme. La conformité signifie typiquement : chiffrement activé, OS patché dans une fenêtre acceptable, AV actif, pas de jailbreak, la politique spécifique du client est respectée. Si l'appareil passe cette barre, la connexion procède — *aucun prompt MFA nécessaire*. L'appareil a prouvé que la posture de l'utilisateur est digne de confiance.

**Chemin 2 : Appareil Hybrid Azure AD joined.** L'appareil est une machine Windows gérée par l'entreprise jointe à la fois à l'Active Directory sur site et à Entra ID. Les appareils hybride-joined sont typiquement des postes de travail d'entreprise dans des environnements où le client maintient un contrôleur de domaine. Comme les appareils conformes, les appareils hybride-joined ont prouvé qu'ils sont gérés et dignes de confiance. La connexion procède sans MFA.

**Chemin 3 : MFA.** L'utilisateur complète un défi d'authentification multifacteur. C'est le chemin de repli pour les utilisateurs sur appareils personnels, appareils non gérés, ou appareils pas encore inscrits. S'ils peuvent prouver leur identité par MFA, ils entrent.

N'importe lequel des trois suffit. Le contrôle d'octroi est configuré avec « Exiger un des contrôles sélectionnés » plutôt qu'« Exiger tous les contrôles sélectionnés » — c'est la différence structurelle entre ce modèle et une politique naïve « exiger tout ».

## Ce que ça fait *réellement*

Lisez l'intention de la politique à travers la lentille de la carte 1 : *qui, quoi, où, quand, bizarre?* Cette politique répond à une question — « cette connexion est-elle digne de confiance? » — et accepte trois preuves différentes :

- **L'appareil le prouve** (conforme ou hybride-joined). Microsoft et Intune ont déjà validé l'appareil; la confiance se transfère à la connexion.
- **L'utilisateur le prouve** (MFA). L'humain devant le clavier a démontré qu'il est l'utilisateur légitime.

Si ni l'appareil ni l'utilisateur ne le prouve, la connexion est refusée. Il n'y a pas de quatrième chemin. Il n'y a pas d'exception « faire confiance parce que c'est mercredi ».

La force de la politique est dans l'effet *combiné* : sur des appareils gérés, les utilisateurs ont une expérience de connexion sans friction (pas de prompt MFA à chaque session); sur des appareils non gérés, le chemin MFA les attrape. Le client obtient le plancher de sécurité de toujours-de-confiance-ou-MFA sans la friction de toujours-MFA.

## Quand utiliser ce modèle plutôt qu'« Exiger MFA pour tous les utilisateurs »

Le modèle de la leçon 2 (Exiger MFA pour tous les utilisateurs) et le modèle de cette leçon sont les deux principaux choix stratégiques pour la politique d'AC de base d'un tenant. Ce sont des alternatives, pas des compléments. Le choix dépend de la posture Intune du client et de sa tolérance à la friction.

**Utilisez Exiger MFA pour tous les utilisateurs (leçon 2) quand :**

- Le client n'a pas encore Intune (Business Standard ou en dessous — bien que ces clients ne devraient pas être là en premier lieu selon la carte 1 leçon 5).
- Le client a Intune mais la couverture d'appareils est inégale — certains utilisateurs sur portables gérés, d'autres en BYO.
- Vous êtes au milieu d'un déploiement Intune et la conformité est encore peu fiable.
- La direction du client veut la posture « MFA à chaque connexion » la plus simple possible pour des raisons de conformité.

**Utilisez le modèle de cette leçon (Conforme OU hybride OU MFA) quand :**

- Intune est déployé et la conformité est fiable.
- La majorité des utilisateurs sont sur des appareils gérés.
- Vous voulez une meilleure UX pour ces utilisateurs sans compromettre la sécurité des utilisateurs sur appareils non gérés.
- Le client est à l'aise avec le fait que le signal de confiance d'appareil porte du poids (plutôt que d'exiger le MFA à chaque connexion).

En pratique, le deuxième modèle convient à la plupart des tenants Business Premium bien gérés une fois qu'Intune est en place. Le premier modèle est le défaut sûr pendant la fenêtre de déploiement d'Intune ou pour les tenants sans histoire Intune.

## Ce qui se passe si les deux sont activés simultanément

C'est la question qui revient souvent — et la réponse affecte comment un opérateur pense à la migration entre stratégies.

Les politiques d'accès conditionnel *s'empilent par ET logique à travers les politiques*. Une connexion doit satisfaire chaque politique applicable. À l'intérieur d'une politique unique, les octrois sont combinés par les règles de cette politique (OU pour « n'importe lequel de », ET pour « tous de »).

Donc si Exiger MFA pour tous les utilisateurs (leçon 2) ET Conforme OU hybride OU MFA (cette leçon) sont tous deux activés :

- La politique de la leçon 2 dit : *doit compléter MFA*.
- La politique de cette leçon dit : *doit avoir un appareil conforme, OU un appareil hybride-joined, OU compléter MFA*.
- Combinées : *doit satisfaire les deux politiques*.

L'exigence MFA de la politique de la leçon 2 est inconditionnelle. Les chemins OU de la politique de la leçon 5 incluent MFA. Donc la seule façon de satisfaire *les deux* est de compléter MFA. Les chemins appareil-conforme et hybride-joined de la leçon 5 deviennent non pertinents — même sur un appareil parfaitement conforme, l'utilisateur doit quand même faire MFA parce que la leçon 2 l'exige.

**Effet net des deux activées : identique à activer la leçon 2 seule.** Les parties « OU » du modèle de cette leçon sont supprimées par l'exigence MFA inconditionnelle de la leçon 2.

Ce n'est *pas* une configuration utile. Ce n'est pas « défense en profondeur » — c'est de la redondance avec la rigueur de la politique la plus stricte. Le chemin appareil-conforme que le modèle de la leçon 5 a été conçu pour permettre est inatteignable.

Les bonnes configurations :

- **Activez seulement la leçon 2** si vous voulez la sémantique stricte-toujours-MFA.
- **Activez seulement la leçon 5** si vous voulez la sémantique intelligente-OU-basée-sur-la-confiance.
- **N'activez pas les deux** en vous attendant à ce que les chemins OU s'appliquent.

Le chemin de migration entre les stratégies :

1. Commencez avec la politique de la leçon 2 activée (toujours-MFA). La plupart des tenants atterrissent ici d'abord parce qu'Intune n'est pas encore prêt.
2. Déployez la conformité Intune. Préparez le côté appareil.
3. Quand la conformité est fiable, déployez la politique de la leçon 5 en mode rapport uniquement.
4. Vérifiez que les connexions depuis des appareils conformes correspondent à la politique et seraient permises sans MFA.
5. Basculez la leçon 5 à Activé.
6. *Désactivez la leçon 2* une fois que la leçon 5 s'applique. (Ou gardez la leçon 2 en rapport uniquement comme référence de documentation; c'est correct, juste ne pas en avoir les deux qui s'appliquent.)
7. L'expérience utilisateur change : les utilisateurs sur appareils gérés ne voient plus de prompt MFA à chaque session.

Le point de décision est entre les étapes 5 et 6. Si le client est nerveux à propos du changement, vous pouvez garder les deux politiques qui s'appliquent pendant une brève période de chevauchement — les utilisateurs continueront à voir des prompts MFA même sur appareils conformes — puis désactiver la leçon 2. Le pré-déploiement (leçon 1) devrait avoir déjà vérifié que la conformité est fiable; le chevauchement n'est qu'une mesure de confiance.

## À surveiller pendant la migration

**Fiabilité des rapports de conformité.** Toute la stratégie dépend du fait que les appareils rapportent leur état avec précision. Si un appareil est vraiment conforme mais qu'Intune le rapporte comme non conforme (problèmes de réseau, retard de synchronisation, état périmé), l'utilisateur obtient un prompt MFA là où il ne devrait pas. L'inverse est pire : si un appareil est non conforme mais qu'Intune le rapporte comme conforme, la connexion saute le MFA quand elle ne devrait pas.

Exécutez des vérifications périodiques de réconciliation d'appareils. Si un appareil apparaît conforme dans Intune mais qu'il échoue à une vérification de conformité au niveau OS, l'écart compte.

**Évaluation paresseuse de la conformité.** Intune ne réévalue pas continuellement chaque appareil. Il y a une cadence de check-in. Un appareil qui devient non conforme (l'utilisateur désactive BitLocker, prend du retard sur les correctifs) peut encore rapporter conforme pendant quelques heures après le changement. L'AC lit l'état actuel au moment de la connexion, donc il peut y avoir une courte fenêtre où le chemin de confiance d'appareil de cette politique est « conforme » quand il ne devrait pas l'être.

Ne vous inquiétez pas du retard au niveau minute — c'est le retard au niveau heure qui compte. Configurez les intervalles de check-in de conformité d'appareil appropriés dans Intune.

**Dérive d'appareils hybride-joined.** Si le client a un environnement AD hybride, les appareils peuvent tomber hors du statut hybride-joined sans que personne le remarque (problèmes de synchronisation Azure AD Connect, retard de réplication, contrôleurs de domaine désaffectés). Les appareils qui ne sont plus hybride-joined perdent silencieusement le chemin de confiance hybride-joined. Vous ne remarquerez pas avant que l'utilisateur soit sur un réseau personnel et que la connexion échoue.

Surveillez régulièrement la santé de votre synchronisation AD Hybride; Panoptica365 ne fait pas directement remonter ce signal mais la santé de synchronisation Entra sous-jacente est visible dans les centres d'administration Microsoft.

## Déploiement

Migrer de la politique de la leçon 2 à celle-ci est le chemin de migration typique. Le travail est assez substantiel pour que **l'étape manuelle de rapport uniquement dans le portail Entra soit recommandée pour cette migration peu importe la taille du tenant**. La raison : ce n'est pas une politique unique nouvelle; c'est un changement de stratégie. Les erreurs sont plus bruyantes.

La vérification pré-déploiement (selon la leçon 1) confirme que la conformité Intune est fiable sur une fraction substantielle de la base d'utilisateurs, et que les appareils hybride-joined sont synchronisation-saine le cas échéant.

Puis :

1. **Jour 0** — déployez ce modèle via Panoptica365 (crée la politique à l'état Activé). Basculez immédiatement la politique en rapport uniquement dans le portail Entra. Gardez le modèle de la leçon 2 qui s'applique pendant cette fenêtre.
2. **Jours 1–7** — tirez le journal de connexion filtré sur le résultat rapport uniquement de cette politique. Pour chaque connexion :
   - Le chemin appareil-conforme ou hybride-joined a-t-il réussi? (L'utilisateur est sur un appareil géré.) Bon — le patron OU fonctionne comme conçu.
   - Seul le chemin MFA a-t-il réussi? (L'utilisateur a complété MFA, aucun autre chemin n'était disponible.) Cet utilisateur est soit sur un appareil personnel, soit sur un appareil géré où la conformité rapporte mal. Enquêtez.
   - La connexion a-t-elle échoué aux trois chemins? (Bloquée.) C'est un utilisateur qui n'a pas pu s'authentifier même avec MFA — probablement un problème de configuration. Enquêtez.
3. **Jours 7–14** — corrigez tout problème de rapport de conformité fait remonter pendant le rapport uniquement.
4. **Jour 14** — basculez ce modèle de retour à Activé dans le portail Entra.
5. **Jour 14 (même jour)** — désactivez le modèle de la leçon 2 dans Panoptica365 (ou basculez-le en rapport uniquement comme référence de documentation, mais ne le gardez pas qui s'applique à côté de celui-ci).
6. **Jour 14 et après** — surveillez le comportement des utilisateurs. Les utilisateurs sur appareils gérés remarqueront l'expérience plus fluide; les utilisateurs sur appareils personnels ne remarqueront aucun changement (ils obtenaient MFA avant et ils obtiennent MFA maintenant).

Fenêtre totale : deux semaines. Le coût de friction est justifié — ce changement de stratégie récompense la vérification soigneuse.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**C'est la cible de mise à niveau pour les tenants avec Intune fiable.** Déplacez les clients ici dès que leur posture Intune est bonne. Meilleure UX pour les utilisateurs sur appareils gérés, même plancher de sécurité pour les utilisateurs sur appareils non gérés, moins de friction au total.

**Ne faites pas tourner la leçon 2 et cette leçon en parallèle.** Les chemins OU sont supprimés. Vous faites effectivement tourner la leçon 2 avec du bruit supplémentaire dans le journal d'audit. Choisissez une stratégie par tenant.

**Le choix de stratégie suit le déploiement Intune.** Un nouveau client commence typiquement sur la leçon 2 (toujours-MFA) parce qu'Intune n'est pas encore déployé. À mesure que la couverture Intune grandit, le signal de confiance d'appareil devient fiable, et le client est prêt à passer au modèle de cette leçon. La transition est elle-même une étape importante dans la maturité de sécurité du client.

## Ce qui suit

- **Leçon 6 : Durcir l'accès admin.** Quatre modèles spécifiques aux admins dans une leçon. La combinaison de l'application MFA, MFA-pour-portails, et contrôles de session.
- **Leçon 7 : Désactiver le flux de code d'appareil.** La défense Storm-2372.

Pour l'instant : si un client a Intune qui fonctionne, c'est le modèle sur lequel il devrait être. La migration depuis la leçon 2 est un exercice de deux semaines qui se paie tout de suite en UX utilisateur et avec le temps en heures d'opérateur économisées (moins de plaintes « le prompt MFA est si énervant » des utilisateurs seniors).

---

*Sources des données dans cette leçon — Microsoft Learn sur les contrôles d'octroi d'accès conditionnel et la sémantique OU-vs-ET ([Microsoft Learn — Conditional Access: Grant](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-grant)); conformité d'appareil Intune et flux de signal vers l'AC ([Microsoft Learn — Device compliance for Conditional Access](https://learn.microsoft.com/en-us/mem/intune/protect/conditional-access)); vue d'ensemble Hybrid Azure AD join ([Microsoft Learn — Hybrid Azure AD join](https://learn.microsoft.com/en-us/entra/identity/devices/concept-hybrid-join)).*
