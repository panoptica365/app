---
title: "Déployez des stratégies Intune"
subtitle: "Le même modèle « modèle et dérive » que l'AC, appliqué à la configuration des appareils : affecter, déployer, surveiller."
icon: "monitor-smartphone"
last_updated: 2026-06-15
---

# Déployez des stratégies Intune

Si vous avez lu le guide des stratégies AC, celui-ci vous semblera familier — c'est voulu. Les déploiements Intune utilisent le même modèle « modèle et dérive » : une bibliothèque que vous maintenez (barre latérale → **Stratégies Intune**), des déploiements par locataire, et une détection de dérive continue sur ce qui est actif.

Les modèles eux-mêmes — quels paramètres choisir, à quoi ressemble une référence Windows saine — sont couverts dans la carte **Paramètres des modèles Intune** d'Apprendre. Ce guide, c'est la mécanique.

## Déployer des stratégies sur un locataire

1. Ouvrez le tableau de bord du locataire → onglet **Stratégies Intune**. Locataire neuf : *« Aucun modèle de stratégie Intune assigné à ce locataire pour le moment. Cliquez sur « Ajouter des stratégies » pour commencer. »*
2. Cliquez sur **Ajouter des stratégies**. Le sélecteur liste votre bibliothèque de modèles Intune — catalogues de paramètres, configurations d'appareil, stratégies de conformité, modèles d'administration, références de sécurité.
3. Sélectionnez les stratégies à déployer et choisissez la **cible d'affectation** : **Tous les utilisateurs**, **Tous les appareils** ou **Aucune** (déployer sans affectation, et brancher l'affectation dans la console plus tard).
4. Déployez. Chaque stratégie devient une carte montrant son nom, son type, son état, sa cible d'affectation et un badge de dérive.

## Détection de dérive

Le cycle de dérive compare chaque stratégie déployée à son modèle, exactement comme l'AC :

- **ok** — la stratégie active correspond.
- **en dérive** — un paramètre a été changé côté locataire.
- **acceptée** — dérive examinée et acceptée par un opérateur.

Actions par carte : **Vérifier la dérive** (comparer maintenant), **Déployer** (réappliquer) et **Accepter** (ouvrir la fenêtre d'acceptation).

## Accepter une dérive Intune

La fenêtre d'acceptation offre les deux mêmes chemins que l'AC :

- **Accepter avec expiration** *(recommandé)* — acceptée jusqu'à la date de votre choix (180 jours par défaut), motif obligatoire. L'acceptation apparaît dans la page **Exemptions**. Notez que les exemptions Intune sont **à l'échelle de la stratégie** — elles acceptent la dérive actuelle du déploiement dans son ensemble, pas une exception par utilisateur.
- **Accepter une fois, pour toujours** — indéfinie; ne se redéclenche que si la dérive change de forme.

Quand une exemption expire ou est révoquée, le prochain cycle de dérive Intune signale de nouveau le déploiement comme en dérive, ce qui exige un nouvel examen. Rien ne reste accepté en silence.

## Une mise en garde importante

Évitez de modifier les stratégies déployées par Panoptica365 directement dans la console Intune pour des ajustements par locataire (groupes d'exclusion supplémentaires, changements ponctuels de paramètres). Le travail de la plateforme est de ramener les stratégies actives vers le modèle — les personnalisations faites côté console déclenchent des alertes de dérive perpétuelles ou se font écraser au prochain redéploiement. Si un locataire a réellement besoin d'une variation, rendez-la explicite : un modèle distinct, ou une dérive acceptée, documentée et limitée dans le temps.

## Adopter les paramètres existants sur place (issus du locataire)

Tout comme pour l'AC, vous pouvez adopter les configurations Intune **existantes** d'un locataire au lieu de pousser d'abord vos modèles. Sous l'onglet **Stratégies Intune**, cliquez sur **Importer les paramètres existants**. Panoptica lit les configurations en vigueur dans le locataire — pour les mêmes types que votre bibliothèque prend en charge (catalogues de paramètres, configurations d'appareils, stratégies de conformité, modèles d'administration, bases de référence de sécurité) — et crée une carte **Issu du locataire** (bordure rouge et badge) pour chacune qu'il ne gère pas déjà. Tout ce que vous avez déployé à partir d'un modèle est reconnu par son identifiant d'objet et ignoré, vous n'obtenez donc jamais de doublons; recliquer est sans risque.

Chaque carte est enregistrée telle que trouvée — la configuration **et ses attributions** — et surveillée pour tout changement. L'alerte d'une carte issue du locataire indique *« modifié par rapport à l'état initial »*. La dérive Intune est détectée par la surveillance **quotidienne** : contrairement aux nouvelles stratégies AC, les changements Intune ne figurent pas dans le flux du journal d'audit, il n'y a donc pas de voie à latence de quelques minutes — la réconciliation quotidienne est le filet de sécurité.

Ouvrez les **Actions** d'une carte pour trois choix :

1. **Arrêter la surveillance** — retire la carte; ne touche jamais au locataire.
2. **Désactiver dans le locataire** — Intune n'a pas d'interrupteur global « arrêt », donc Panoptica **enregistre d'abord l'ensemble complet des attributions**, puis retire toutes les attributions afin que la configuration ne s'applique à personne. **Restaurer** rejoue exactement les attributions. C'est cet instantané préalable qui rend la désactivation réversible — sans lui, retirer les attributions serait une porte à sens unique.
3. **Supprimer du locataire** — retire définitivement la configuration; la suppression vous demande de saisir votre propre nom.

Ces trois actions sont consignées dans le journal d'audit MSP et dans le journal des modifications du locataire. Et comme pour l'AC, Panoptica surveille chaque locataire pour détecter une configuration Intune créée **en dehors de Panoptica** et la présente comme une carte issue du locataire accompagnée d'une alerte.

## Le rythme

Intégrer le locataire → déployer votre référence Intune standard → l'oublier. À partir de là, les alertes de dérive arrivent quand quelqu'un modifie une stratégie déployée dans le locataire du client, et la carte **Appareils conformes** de l'onglet Vue d'ensemble vous dit si les appareils atteignent réellement la barre que vous avez fixée.
