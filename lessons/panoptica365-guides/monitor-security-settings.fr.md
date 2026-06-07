---
title: "Surveillez les paramètres de sécurité"
subtitle: "La surface de dérive à l'échelle du locataire : des paramètres à travers M365, Entra, Exchange, Teams et SharePoint — lus, comparés et gardés."
icon: "sliders-horizontal"
last_updated: 2026-06-07
---

# Surveillez les paramètres de sécurité

Les stratégies AC et Intune sont des objets que vous déployez. Mais la posture de sécurité d'un locataire vit aussi dans des dizaines de commutateurs éparpillés : paramètres de transport Exchange, accès externe Teams, partage SharePoint, valeurs par défaut Entra, stratégies anti-hameçonnage. La page **Sécurité** (barre latérale → Stratégies → **Sécurité**) est l'endroit où Panoptica365 lit ces commutateurs sur chaque locataire et vous avertit quand l'un d'eux bascule.

## Ce que vous voyez

Choisissez un locataire et vous obtenez les paramètres surveillés, regroupés par catégorie, avec des pastilles de filtre :

- **Catégorie** : Toutes / Exchange / Identité / SharePoint / Teams / Conformité.
- **Priorité** : Toutes / Critique / Élevée / Moyenne / Faible.

Chaque ligne de paramètre montre son nom, la valeur active actuelle (interprétée en langage clair, pas la sortie brute de l'API), la licence requise s'il y a lieu, et un état :

- **Surveillé — OK** — la valeur active correspond à l'état souhaité que vous avez configuré.
- **Dérive détectée** — la valeur active ne correspond plus. Cela déclenche aussi une alerte de dérive de sécurité par le pipeline d'alertes habituel.
- **Non appliqué** — vous n'avez pas encore défini d'état souhaité pour ce paramètre sur ce locataire.
- **Erreur d'interrogation** — le lecteur n'a pas pu récupérer la valeur (souvent une question de licence ou d'autorisation).

Cliquez sur un paramètre pour la vue détaillée : ce que fait le paramètre, pourquoi il compte, l'impact utilisateur d'un changement, les notes pour l'opérateur, et les valeurs attendues vs réelles en cas de dérive.

## Appliquer et faire correspondre

Deux verbes couvrent le flux de travail :

- **Appliquer** — pousse la valeur souhaitée configurée vers le locataire. Les applications s'exécutent **de façon asynchrone** : la tâche est mise en file, un processus l'exécute, et la ligne se met à jour à la fin (avec une vérification de rafraîchissement peu après pour confirmer que la valeur a tenu). Vous pouvez continuer à travailler pendant l'exécution.
- **Faire correspondre** — adopte la valeur active actuelle du locataire comme état souhaité. Utilisez ceci quand la configuration existante du locataire est correcte et que vous voulez simplement la *garder* à partir de maintenant.

Cette distinction compte pendant l'intégration : pour un locataire bien configuré, vous ferez surtout Faire correspondre (capturer la réalité comme référence), et pour un locataire négligé, surtout Appliquer (imposer votre standard). Dans les deux cas, l'état final est le même — chaque paramètre a une valeur souhaitée, et toute déviation future produit une alerte de dérive.

## Paramètres en audit seulement

Quelques paramètres sont délibérément **en audit seulement** — Panoptica365 les lit mais ne les écrira pas, généralement parce que l'écriture est restreinte par licence ou trop délicate pour être automatisée (la configuration DLP est l'exemple canonique). Pour ceux-là, vous **capturez une base de référence** de la configuration actuelle; dès lors, tout changement déclenche une alerte : *« Référence capturée. Panoptica365 alertera sur tout changement de configuration DLP à l'avenir. »* La remédiation, au besoin, se fait à la main dans la console Microsoft.

## Valeurs recommandées

Les vues détaillées décrivent la posture recommandée, mais « le plus sécuritaire » n'est pas « universellement correct » — certains paramètres varient légitimement selon le modèle d'affaires du client (le partage externe pour une entreprise qui collabore avec ses clients dans SharePoint, par exemple). Le texte de recommandation précise *pour qui* une valeur est recommandée. Lisez-le avant d'appliquer quoi que ce soit en lot.

## Où cela réapparaît ailleurs

La **Carte thermique** (voir *Vues de parc*) est construite exactement à partir de ces données — chaque locataire × chaque contrôle surveillé, sous forme de points colorés. Un contrôle rouge ou non configuré chez la majorité du parc devient une campagne de remédiation; la carte thermique vous remettra cette liste.
