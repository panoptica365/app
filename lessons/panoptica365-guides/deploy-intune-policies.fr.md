---
title: "Déployez des stratégies Intune"
subtitle: "Le même modèle « modèle et dérive » que l'AC, appliqué à la configuration des appareils : affecter, déployer, surveiller."
icon: "monitor-smartphone"
last_updated: 2026-06-07
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

## Le rythme

Intégrer le locataire → déployer votre référence Intune standard → l'oublier. À partir de là, les alertes de dérive arrivent quand quelqu'un modifie une stratégie déployée dans le locataire du client, et la carte **Appareils conformes** de l'onglet Vue d'ensemble vous dit si les appareils atteignent réellement la barre que vous avez fixée.
