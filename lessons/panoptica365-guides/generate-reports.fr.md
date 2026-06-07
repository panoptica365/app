---
title: "Générez des rapports"
subtitle: "Quatre types de rapports et quand utiliser chacun : la posture pour la revue trimestrielle, la documentation pour le cartable, l'évaluation rapide pour le prospect."
icon: "file-text"
last_updated: 2026-06-07
---

# Générez des rapports

La surveillance gagne sa vie en silence; les rapports sont l'endroit où le client *voit* le travail. **Rapports** (barre latérale) génère des livrables PDF à votre image à partir des données que Panoptica365 détient déjà — fini les captures d'écran collées.

## Les quatre types

**Rapport de posture de sécurité (PDF).** Le livrable client vedette : Secure Score et tendances, couverture de l'accès conditionnel, activité d'alertes sur la période choisie, graphiques, et une analyse de la posture du locataire rédigée par l'IA. Prend une **période** — 7, 30 ou 90 derniers jours. C'est votre document de revue trimestrielle.

**Documentation de configuration (PDF).** Un instantané ponctuel de la configuration du locataire, organisé comme le tableau de bord : identité, stratégies d'accès, appareils, courriel, collaboration. Pas de période — il documente *maintenant*. C'est le document de cartable : dossiers d'intégration, preuves d'audit et d'assurance, transferts de fin de mandat. Quand un instantané précédent existe, il est chargé pour comparaison.

**Évaluation rapide (PDF).** Conçue pour le scénario audit seulement / prospect : une évaluation concise, axée sur les constats, de l'état actuel d'un locataire. Avant la génération, une **boîte de contexte** facultative vous permet de dire à l'IA quel genre d'organisation c'est — *« p. ex. cabinet comptable de 40 personnes »* — ce qui affine considérablement les recommandations. Remplissez-la; deux phrases de contexte améliorent nettement le résultat. Se marie naturellement avec les locataires en audit seulement et leur fenêtre de 14 jours.

**Instantané du locataire (ZIP).** L'exportation des données brutes — pour l'archivage, vos propres outils, ou pour remettre les données elles-mêmes.

## Générer

1. Choisissez le **locataire**.
2. Choisissez le **type de rapport**.
3. Choisissez la **période** (Posture de sécurité seulement — les autres sont ponctuels et le sélecteur se désactive de lui-même).
4. Cliquez sur **Générer le rapport**.

Une fenêtre de progression parcourt les étapes — collecte des données, récupération des stratégies AC, rendu des graphiques, analyse IA, assemblage — typiquement une minute ou deux selon le type. Les rapports terminés atterrissent dans la liste **Rapports récents** en dessous, avec un bouton de téléchargement. L'historique est par session : téléchargez ce que vous générez; la régénération ne coûte rien de toute façon.

## Image de marque et langue

Les rapports portent votre image de marque — nom d'entreprise et logo sur la couverture et les pieds de page — configurée une fois par un Administrateur dans **Paramètres → Image de marque des rapports** (PNG transparent, max 2 Mo). Faites-le avant que le premier rapport destiné à un client ne sorte.

Les rapports sont générés dans la **langue du locataire** (le champ Langue du locataire), dans les trois langues offertes — réglez une fois le locataire d'un client francophone à *fr*, et chaque livrable sort en français.

## Choisir, en pratique

- Prospect, avant-vente : **Évaluation rapide** (avec le contexte rempli).
- Nouveau client, fin d'intégration : **Documentation de configuration** — la photo « avant ».
- Revue trimestrielle : **Posture de sécurité**, 90 jours.
- Questionnaire d'assurance ou audit : **Documentation de configuration**, générée le jour même.
- Fin de mandat : **Documentation de configuration** + **Instantané du locataire**, puis archivage.

Le gain silencieux : un livrable de configuration documentée par client par trimestre, c'était des heures de captures d'écran manuelles. Ici, c'est une liste déroulante et une minute de barre de progression — alors faites-le vraiment chaque trimestre.
