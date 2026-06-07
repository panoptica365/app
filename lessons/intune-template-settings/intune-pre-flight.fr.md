---
title: "Avant de toucher à un modèle Intune — la liste de vérification pré-déploiement"
subtitle: "Ce qu'il faut vérifier avant de déployer un modèle Intune : couverture de plateforme, familles de types et risque de perte d'assignation."
icon: "clipboard-check"
last_updated: 2026-05-29
---

# Avant de toucher à un modèle Intune — la liste de vérification pré-déploiement

Un technicien MSP qu'on connaît a déjà testé un nouveau profil de configuration Intune en le déployant sur un seul appareil de test, en confirmant qu'il fonctionnait, puis en le déployant en lot sur ses 47 tenants clients gérés au cours de l'heure suivante. À la fin du lendemain, huit tenants clients avaient signalé des problèmes liés aux assignations — le déploiement en lot avait déclenché le comportement de suppression-et-recréation d'Intune, ce qui avait silencieusement abandonné les groupes d'exclusion par tenant que ces clients avaient configurés. Les appareils qui devaient être exclus de la politique étaient maintenant dans la portée. Les appareils qui avaient été soigneusement exemptés d'une vérification de conformité spécifique échouaient maintenant à cette vérification.

Le technicien avait fait tout ce qu'il fallait selon les standards du déploiement de modèles AC. Mais Intune n'est pas l'AC. La discipline pré-déploiement pour les modèles Intune est différente.

Cette leçon, c'est le pré-déploiement que vous exécutez avant de déployer n'importe quel modèle Intune de la carte 4. Elle est distincte du pré-déploiement AC de la carte 3 parce que les modes d'échec d'Intune sont différents — et parce qu'Intune traîne un bagage historique que l'AC n'a pas.

## Pourquoi Intune mérite son propre pré-déploiement

Trois différences structurelles entre Intune et l'AC qui comptent pour le déploiement :

**Intune est spécifique à la plateforme.** Une politique d'AC s'applique à « toutes les applications infonuagiques » ou à « Exchange Online » — des cibles universelles abstraites. Un profil Intune s'applique à Windows 10/11, ou à iOS, ou à Android Enterprise, ou à macOS. Le même modèle ne peut pas couvrir plusieurs plateformes. Déployer sans confirmer que le client a vraiment des appareils sur cette plateforme produit une politique sans cibles — silencieuse, inoffensive, mais aussi ne faisant rien.

**Intune a trois familles différentes de types de modèles en usage actif.** Microsoft a livré trois générations d'infrastructure de politique Intune et n'a jamais complètement retiré les anciennes. Dans la bibliothèque Panoptica365, vous verrez les trois :

- **Catalogue de paramètres** (`configurationPolicies`) — l'interface moderne et granulaire des paramètres. La plupart des modèles Windows de Panoptica365 utilisent ça : règles ASR, Block Microsoft Consumer Accounts, Block mshta.exe, Defender Settings (Windows + macOS), Firewall Settings, Security Baseline. C'est ce que la nouvelle documentation Microsoft utilise.
- **Intents / Modèles Endpoint Security** (`intents`) — l'ancien style de modèle Endpoint Security. Le modèle Account Protection Settings de Panoptica365 utilise celui-ci. Microsoft ne l'a pas marqué comme obsolète; il existe toujours en parallèle du catalogue de paramètres. Le portail Intune l'affiche différemment des politiques du catalogue de paramètres.
- **Device Configurations** (`deviceConfigurations`) — le plus vieux style. Les modèles BitLocker Settings et Windows Health Monitoring utilisent ça. L'interface pour ceux-ci dans le portail Intune se trouve dans une section séparée des deux autres.

Quand un opérateur ouvre le portail Intune pour chercher un modèle Panoptica365 déployé, le modèle peut se trouver dans n'importe laquelle de trois sections différentes de l'interface. Le modèle vit dans la section qui correspond à son type sous-jacent. Il n'y a pas d'unification truquée par Panoptica365 — Microsoft a choisi la structure, et les modèles la suivent.

**Les déploiements Intune n'ont pas de vrai mode « rapport uniquement ».** L'AC a Report-only comme un état de première classe. Intune ne l'a pas. Les équivalents les plus proches sont :

- *Mode Audit* pour les règles ASR (un choix par règle entre Audit, Block ou Warn — couvert à la leçon 7).
- *Politique de conformité en assignation rapport-uniquement* (vous pouvez déployer une politique de conformité à un petit groupe pilote d'abord, évaluer, puis étendre l'assignation).
- *Profil de configuration déployé à un petit groupe pilote* (même patron — déployer à quelques appareils, vérifier, étendre).

Aucun de ces mécanismes n'est exactement comme Report-only de l'AC. L'opérateur doit utiliser le déploiement à un groupe pilote comme essai à blanc, pas un commutateur au niveau de la politique.

## Les cinq étapes du pré-déploiement

### 1. Inventorier les appareils par plateforme et par état de gestion

Avant de déployer n'importe quel modèle Intune, sortez l'inventaire des appareils. Vous devez savoir :

- **Combien d'appareils sur chaque plateforme?** La bibliothèque Panoptica365 est lourde en Windows (10 des 14 modèles sont Windows uniquement) et ça correspond à la réalité PME — la plupart des appareils gérés sont des postes de travail Windows. Si un client n'a aucun appareil Windows, la moitié des modèles de la carte 4 ne sont pas pertinents. S'il a tout Windows sauf un Mac perdu, les modèles macOS visent un seul appareil.
- **Combien d'appareils dans chaque état de gestion?** Les appareils peuvent être gérés par Intune (entièrement inscrits MDM), enregistrés Entra (plus léger — connus d'Entra mais pas gérés), ou non inscrits (BYOD sans présence MDM). Les modèles s'appliquent aux appareils inscrits MDM; les appareils non inscrits ignorent le déploiement entièrement.
- **Quel est le mélange BYOD?** La plupart des tenants PME avec qui vous travaillerez sont fortement BYOD sur le mobile — les utilisateurs utilisent leurs iPhones et appareils Android personnels. Ces appareils ne sont typiquement pas inscrits du tout dans MDM. Les modèles de conformité mobile de Panoptica365 supposent une inscription MDM; sans elle, ils ne s'appliquent pas. Mettre les attentes du client sur « on ne gère pas les appareils mobiles personnels via ce modèle » est important.

Vous tirerez cette donnée du portail Intune directement aujourd'hui — Panoptica365 fait remonter la liste d'appareils et la répartition par OS au tableau de bord client, mais le travail d'inventaire plus profond (état de gestion par appareil, BYOD vs corporatif, âge d'inscription) se passe dans la console Microsoft.

### 2. Confirmer que la boucle de conformité est branchée

La leçon 3 de la carte 1 a couvert la boucle de conformité : Intune évalue l'état de l'appareil → écrit l'état de conformité dans le dossier de l'appareil Entra → l'accès conditionnel lit cet état à la connexion. Si la boucle est brisée n'importe où, le signal de conformité est inutile même quand le modèle Intune se déploie correctement.

Bris fréquents :

- **Appareil pas encore synchronisé.** Les appareils nouvellement inscrits peuvent prendre de 1 à 8 heures pour compléter leur premier cycle d'évaluation de conformité. Pendant cette fenêtre, ils apparaissent comme « Pas encore évalué » dans l'état de conformité. L'AC traite « Pas encore évalué » différemment selon la configuration de la politique — parfois comme non conforme, parfois comme non concluant.
- **Cadence d'évaluation de conformité trop lente.** L'intervalle d'enregistrement Intune par défaut est aux 8 heures pour Windows. Un appareil qui devient non conforme à midi peut encore apparaître conforme dans le dossier Entra à 16 h parce que l'enregistrement n'a pas encore eu lieu.
- **Enregistrement de l'appareil Entra brisé.** Si l'appareil est inscrit dans Intune mais que son objet appareil Entra est dans un mauvais état (orphelin, dupliqué, synchronisation brisée depuis AD sur place en environnement hybride), le signal de conformité ne peut pas réécrire dans Entra. Fréquent dans les tenants qui ont grandi par acquisitions ou qui ont eu des problèmes avec AD Connect.

Avant de déployer un modèle de conformité, vérifiez que la boucle fonctionne sur un appareil de test connu-bon. Si la boucle est brisée, réparez la boucle avant de déployer — sinon les modèles produisent de faux états « conforme » ou « non conforme ».

### 3. Choisir la bonne portée d'assignation

Les modèles Intune supportent plusieurs modèles d'assignation :

- **Tous les appareils.** S'applique à chaque appareil inscrit dans Intune.
- **Tous les utilisateurs.** S'applique aux appareils détenus par n'importe quel utilisateur du tenant.
- **Groupe spécifique (inclusion).** S'applique seulement aux appareils/utilisateurs du groupe nommé.
- **Groupe spécifique (exclusion).** S'applique à tout le monde sauf aux appareils/utilisateurs du groupe nommé.

La plupart des modèles Panoptica365 livrent avec « Tous les appareils » ou « Tous les utilisateurs » comme assignation par défaut. C'est le bon choix pour le durcissement fondamental. L'exception, c'est quand le client a des catégories d'appareils spécifiques qui doivent être exclues — appareils kiosque, postes de laboratoire, terminaux de point de vente — qui vivent habituellement dans leur propre groupe Entra et se font exclure des modèles standards.

Erreur fréquente : un opérateur inclut le compte admin break-glass du client dans la portée « Tous les utilisateurs » sans en avoir l'intention. L'appareil de l'admin break-glass reçoit la même configuration Intune que tout le monde, ce qui peut inclure des restrictions que le flux break-glass dépend de pouvoir contourner. La discipline break-glass de la leçon 1 de la carte 3 s'applique ici aussi : excluez le compte break-glass de tout modèle Intune affectant l'état de gestion de l'appareil.

### 4. Planifier le déploiement au groupe pilote

Puisqu'Intune n'a pas le mode Report-only de l'AC, l'essai à blanc de l'opérateur, c'est un déploiement à un groupe pilote. La cadence standard :

1. **Jour 0** — déployer le modèle assigné à un groupe pilote (typiquement de 1 à 3 appareils de test connus-bons, ou les appareils de l'équipe TI elle-même).
2. **Jours 1 à 3** — vérifier que le modèle s'est déployé avec succès aux appareils pilotes. Vérifier dans le portail Intune les comptes de succès de déploiement. Faire un échantillonnage sur un appareil pilote pour confirmer que les paramètres attendus sont réellement appliqués (parfois les paramètres se déploient avec succès selon le portail mais ne s'appliquent pas sur l'appareil — synchronisation, politiques en conflit).
3. **Jours 3 à 7** — vérifier l'expérience client sur les appareils pilotes. Est-ce que quelque chose a brisé? Les utilisateurs se plaignent-ils? Des applications d'affaires sont-elles affectées?
4. **Jour 7** — étendre l'assignation du groupe pilote à la portée complète.

Cette fenêtre est plus longue pour les modèles qui changent l'expérience utilisateur (Security Baseline, règles ASR, BitLocker) et plus courte pour les modèles purement de surveillance (politiques de conformité, Windows Health Monitoring).

### 5. Documenter ce que vous attendez et comment vous allez vérifier

Avant le déploiement, écrivez quelque part (dans le billet, dans le journal de changement, quelque part) :

- Ce que ce modèle fait au niveau du client.
- À quels appareils il s'applique.
- Ce que vous vous attendez à voir dans le portail Intune 24 heures après le déploiement.
- À quoi ressemble le succès sur un appareil pilote (valeurs de registre spécifiques, comportement UI spécifique, état de conformité spécifique).
- Quoi faire si ça brise.

Panoptica365 enregistre l'événement de déploiement automatiquement dans le journal de changement du tenant. Le travail de l'opérateur, c'est de faire en sorte que le *résultat attendu* fasse partie du dossier, pas juste l'événement de déploiement lui-même. Les opérateurs futurs qui lisent la piste de vérification doivent savoir ce qui aurait dû se passer, pas juste ce qui a été déployé.

## Le piège de la perte d'assignation — nommé explicitement

C'est le mode d'échec que l'histoire d'ouverture décrivait. Il mérite d'être nommé explicitement parce qu'il est spécifique à Intune et que les opérateurs se font avoir par lui à répétition.

Quand vous mettez à jour un modèle Intune existant (changer un paramètre, modifier une configuration), le mécanisme de déploiement dans certains types de modèles Intune est *supprimer-et-recréer* plutôt qu'une mise à jour sur place. Spécifiquement :

- **Politiques du catalogue de paramètres (la plupart des modèles) :** mise à jour sur place. Sûr. L'ID de la politique reste le même; les assignations sont préservées.
- **Device Configurations (BitLocker, Health Monitoring) :** aussi typiquement mise à jour sur place.
- **Modèles Intents / Endpoint Security (Account Protection) :** *supprimer-et-recréer.* L'ancienne politique est retirée et une nouvelle est créée. Toutes les exclusions d'assignation par tenant configurées contre l'ancien ID de politique ne sont pas transférées à la nouvelle — elles sont silencieusement perdues.

La discipline de l'opérateur pour contourner ça :

- **Avant de mettre à jour un modèle de style Intents, capturer les assignations courantes par tenant** en ouvrant le portail Intune de chaque client et en notant les groupes d'assignation + d'exclusion sur la politique pertinente.
- **Après la mise à jour, vérifier que les assignations sont toujours correctes sur chaque tenant** — encore une fois, par client dans le portail Intune.
- **Si certaines manquent, les restaurer manuellement.**

C'est agaçant et vraiment fastidieux à travers plusieurs tenants. C'est une contrainte imposée par Microsoft à la couche API — jusqu'à ce que Microsoft remplace le comportement supprimer-recréer par une mise à jour sur place fiable pour les modèles de style Intents (sur quoi ils travaillent lentement), l'étape manuelle de rejeu d'assignation est le seul chemin sûr.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**Intune est plus sujet aux erreurs au déploiement que l'AC.** La spécificité à la plateforme, les trois familles de types de modèles, le piège de la perte d'assignation, l'absence de mode Report-only — tout ça augmente la surface d'échec. Traitez les déploiements Intune avec plus de discipline pré-déploiement que les déploiements AC, pas moins.

**Le déploiement au groupe pilote est l'essai à blanc de l'opérateur.** Utilisez-le. Le sauter, c'est le même genre d'erreur que sauter le mode Report-only de l'AC — sauf que les conséquences atterrissent sur les appareils des utilisateurs plutôt que sur le chemin de connexion infonuagique. Plus facile de se remettre d'un mauvais déploiement AC que d'un mauvais déploiement Intune qui a poussé une mauvaise configuration sur 500 terminaux.

**Documentez le résultat attendu, pas juste l'action.** La piste de vérification de Panoptica365 capture l'événement de déploiement automatiquement. L'opérateur capture le résultat attendu et les étapes de vérification. Les opérateurs futurs ont besoin des deux pour opérer la posture Intune du client en sécurité.

## Ce qui suit

Le reste de la carte 4 parcourt chaque modèle Intune Panoptica365 :

- **Leçon 2 : Politiques de conformité** — Windows, iOS, Android, macOS combinés.
- **Leçon 3 : Le Security Baseline** — l'ensemble de durcissement Windows curé de 60 Ko.
- **Leçon 4 : BitLocker Settings** — posture de chiffrement de disque.
- **Leçon 5 : Defender for Endpoint (Win + Mac)** — configuration antivirus / EDR.
- **Leçon 6 : Firewall Settings (Windows)** — pare-feu hôte.
- **Leçon 7 : Règles ASR + Block mshta.exe** — réduction de surface d'attaque.
- **Leçon 8 : Account Protection + Block MSA** — Windows Hello, Credential Guard, blocage MSA.
- **Leçon 9 : La boucle de conformité en production** — détection de dérive et flux de signal.
- **Leçon 10 : Importer vos propres modèles Intune** — flux de personnalisation.
- **Leçon 11 : Opérer Intune à l'échelle** — dérive, exclusions, cycle de vie.

Chaque leçon présume que vous avez fait le pré-déploiement plus haut. Les leçons elles-mêmes ne répètent pas la liste de vérification. Elles vont droit à *ce que chaque modèle fait et comment le déployer*.

Pour l'instant : le pré-déploiement, c'est l'inoculation. Les déploiements Intune sans lui, c'est comme ça que les appareils des clients finissent mal configurés à 16 h un vendredi.

---

*Sources des données dans cette leçon — Microsoft Learn sur la cadence d'évaluation de conformité Intune ([Microsoft Learn — Compliance policies](https://learn.microsoft.com/en-us/mem/intune/protect/device-compliance-get-started)); Microsoft Learn sur les trois types de politiques Intune ([Microsoft Learn — Settings Catalog vs Templates](https://learn.microsoft.com/en-us/mem/intune/configuration/settings-catalog)); référence de comportement d'assignation Intune ([Microsoft Learn — Assign user and device profiles](https://learn.microsoft.com/en-us/mem/intune/configuration/device-profile-assign)).*
