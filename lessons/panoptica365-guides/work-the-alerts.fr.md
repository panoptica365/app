---
title: "Travaillez les alertes"
subtitle: "Votre véritable quotidien : le triage, le panneau de détail, l'analyse IA, la chronologie de l'identité, et résoudre avec discipline."
icon: "bell-ring"
last_updated: 2026-06-07
---

# Travaillez les alertes

Tout le reste de Panoptica365 existe pour alimenter cette page. Les alertes sont la façon dont la plateforme vous parle : dérives, connexions à risque, événements du journal d'audit, incidents Defender, modifications de configuration — le tout normalisé dans une seule file avec l'analyse IA jointe.

## La file

**Alertes** (barre latérale) montre toutes les alertes du parc; l'onglet **Alertes** d'un tableau de bord de locataire montre la même chose limitée à un locataire. La barre de filtres couvre le locataire, la gravité, l'état, la catégorie, et l'affichage ou non des alertes résolues.

- **Gravités** : info, faible, moyenne, élevée, sévère.
- **États** : **Nouvelle** → **En investigation** → **Résolue** ou **Faux positif**.

Chaque ligne montre le badge de gravité, le locataire (ou *Ensemble du parc* pour les alertes au niveau du parc comme les éléments du Centre de messages), le message, la catégorie, l'heure, un compteur de récurrence et la pastille d'état.

## Le triage, y compris en lot

Sélectionnez des alertes avec les cases à cocher et utilisez la barre d'actions groupées : **Marquer en investigation**, **Marquer comme résolue**, **Marquer comme faux positif** ou **Fusionner**. Fusionner regroupe 2 alertes liées ou plus d'un même locataire en une alerte parente — utile quand un incident bruyant a produit une douzaine de petites sœurs. Un titre sensé vous est proposé et vous pouvez écrire le vôtre.

Quand vous résolvez des alertes liées à des billets PSA, une seule fenêtre pose la question une fois : *fermer aussi les billets liés, ou les laisser ouverts?* — et applique votre choix à tout le lot.

## Le panneau de détail : là où se fait l'investigation

Cliquez sur une ligne et le panneau de détail s'ouvre :

- **Détails** — les faits structurés de l'événement.
- **Analyse IA** — la lecture de Claude : ce qui s'est probablement passé, à quel point c'est grave, et quoi vérifier. C'est votre point de départ, pas votre conclusion.
- **Données brutes** — la charge utile de l'événement sous-jacent quand vous avez besoin de la vérité terrain.
- **Chronologie** — les récurrences de cette alerte dans le temps.
- **Changement opérateur lié** — si un changement consigné dans le Journal des changements du locataire explique cette alerte (à l'intérieur de la fenêtre d'attribution), il est lié ici. « Dérive détectée » plus « Jacques a déployé un modèle mis à jour 40 minutes plus tôt », c'est un dossier classé.
- **Notes** — vos notes d'investigation, conservées avec l'alerte.

À côté du nom de la stratégie, vous trouverez l'**icône de mortier (chapeau de diplômé)** — l'explicateur d'alertes. Il ouvre *À propos de cette alerte* : ce qu'est ce type d'alerte, pourquoi il compte, les vecteurs d'attaque derrière, quoi faire, et un scénario d'exemple. Dans votre langue, écrit pour le technicien de niveau 1 à qui vous déléguez.

## La chronologie de l'identité

Pour toute alerte rattachée à un utilisateur, ouvrez la **chronologie de l'identité** depuis le panneau de détail. Elle assemble, pour cet utilisateur, une chronologie unique à partir de quatre sources — connexions, événements du journal d'audit unifié, incidents Defender et alertes associées — sur une fenêtre de 24 heures ou de 7 jours, puis demande à Claude de la corréler : *compromission possible, force brute, pulvérisation de mots de passe, tentatives échouées seulement* ou *non concluant*, avec le raisonnement.

Elle est délibérément prudente — elle ne racontera pas une compromission que les événements ne soutiennent pas. Des liens directs vous amènent à l'utilisateur dans Entra et à l'incident dans Defender; **Réanalyser** (rôle Opérateur et plus) relance la corrélation quand les choses ont changé.

## La discipline de résolution

Deux habitudes font la différence entre un système bien réglé et un système bruyant :

1. **Faux positif est un signal, pas un haussement d'épaules.** Si un type d'alerte produit sans cesse des faux positifs pour un schéma connu et légitime, arrêtez de les résoudre un par un — créez une exemption ou ajustez la stratégie (les deux prochains guides).
2. **Résolvez avec le billet.** Si vous utilisez un PSA, laissez la synchronisation bidirectionnelle faire son travail : fermer le billet Autotask résout l'alerte, et vice versa. Un seul dossier de travail, pas deux demi-dossiers.
