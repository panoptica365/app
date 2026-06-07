---
title: "Vues de parc — Carte thermique, Activité quotidienne et SharePoint"
subtitle: "Les surfaces multilocataires : la posture en grille, la météo d'authentification du jour, et les audits de partage."
icon: "layout-grid"
last_updated: 2026-06-07
---

# Vues de parc — Carte thermique, Activité quotidienne et SharePoint

Les pages par locataire répondent à « comment va ce client? ». Trois pages répondent à la question du MSP : « comment va le *parc*, et où investir mes efforts ensuite? »

## Carte thermique

La **Carte thermique** (barre latérale), c'est chaque locataire géré × chaque contrôle de sécurité surveillé, sous forme de grille de points d'état.

En haut, le **score du parc** — le pourcentage des contrôles *applicables* qui sont conformes à travers les locataires gérés — avec trois cartes de statistiques : locataires gérés, locataires aux données périmées, et exemptions actives. « Applicables » compte : les contrôles qu'un locataire ne peut pas avoir (restreints par licence, non pertinents) sont classés *Non disponible*, pas en échec.

Les deux bandeaux en dessous sont là où se trouve le levier :

- **Variations — plus grands changements sur 7 jours.** Quels locataires ont le plus régressé (ou progressé) cette semaine. Un locataire qui perd cinq points, c'est une conversation à avoir *maintenant*.
- **Faiblesses générales — candidats à une campagne.** Les contrôles rouges ou non configurés chez le plus de locataires. C'est votre liste de campagnes de remédiation : un contrôle, corrigé partout, en une seule passe. Cliquez sur une ligne pour le panneau de campagne — locataires touchés, détails du contrôle, et liens directs vers la page Sécurité de chaque locataire.

La grille elle-même démarre repliée en catégories; cliquez sur un en-tête de catégorie pour la déplier en colonnes par contrôle. Légende des points : **Sain** (vert), **En dérive** (rouge), **Non configuré** (jaune), **Non disponible sur ce locataire** (gris), **Aucune donnée** (périmé). Cliquez sur n'importe quel point pour aller directement à ce locataire et ce contrôle sur la page Sécurité.

## Activité quotidienne

**Activité quotidienne** (barre latérale), c'est la météo d'authentification du jour : deux graphiques en beigne, **Échecs de connexion — Aujourd'hui** et **Blocages AC — Aujourd'hui**, segmentés par locataire.

La partie utile, c'est le calcul d'écart : la ligne de légende de chaque locataire montre le compte du jour contre sa propre moyenne mobile sur 7 jours — « moy. 12/jour » avec un pourcentage d'écart. Quarante échecs, c'est un mardi ordinaire pour un locataire de 200 postes et une pulvérisation de mots de passe pour un locataire de 12 postes; la référence fait la différence. Cliquez sur une ligne de légende pour le détail des événements : une évaluation IA du schéma, puis le tableau des événements (heure, utilisateur, application, IP, emplacement, erreur, niveau de risque), et cliquez sur n'importe quel événement pour le détail complet de la connexion.

Cette page est une surface de *contexte*, pas un système d'alarme — les vrais schémas d'attaque (pulvérisation, force brute, voyage impossible) déclenchent des alertes par eux-mêmes. Utilisez Activité quotidienne quand une ligne du résumé ou une alerte vous donne envie de voir l'allure du trafic du jour.

## SharePoint

**SharePoint** (barre latérale) agrège les événements d'audit de partage et d'accès à travers les locataires : création de liens anonymes, événements de partage externe, changements d'administrateurs de sites, détections de maliciels dans SharePoint/OneDrive, et changements de stratégies de partage. Elle complète les cartes de la Vue d'ensemble par locataire (Sites SP, Liens anonymes) avec la vue au niveau des événements — qui a créé ce lien anonyme, sur quel site, quand.

## Comment elles s'insèrent dans votre semaine

Les alertes mènent votre journée; les vues de parc mènent votre semaine. Un rythme raisonnable : la Carte thermique une fois par semaine pour choisir une campagne (éliminer une faiblesse générale à l'échelle du parc), Variations pour attraper le locataire qui régresse, Activité quotidienne et SharePoint sur demande quand quelque chose pique votre curiosité. Tout cela reste en lecture seule — ces pages vous disent où agir; l'action se passe dans Sécurité, AC, Intune et la conversation avec le client.
