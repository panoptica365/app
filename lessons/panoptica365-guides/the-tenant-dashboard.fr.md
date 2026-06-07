---
title: "Le tableau de bord du locataire"
subtitle: "Six onglets, deux zones : les cartes de métriques, les panneaux de détail, et où vit chaque flux de travail."
icon: "gauge"
last_updated: 2026-06-07
---

# Le tableau de bord du locataire

Cliquez sur un locataire dans la Console principale et vous atterrissez sur son tableau de bord. C'est la page la plus riche de Panoptica365 — tout ce qui est connu d'un locataire, organisé en six onglets :

1. **Vue d'ensemble** — l'instantané de configuration et d'activité (ce guide).
2. **Alertes** — les alertes de ce locataire, même flux de travail que la page Alertes globale.
3. **Stratégies AC** — les modèles d'accès conditionnel affectés à ce locataire (guide dédié).
4. **Stratégies Intune** — les modèles Intune déployés sur ce locataire (guide dédié).
5. **Applications** — l'inventaire des applications d'entreprise et le flux d'approbation (guide dédié).
6. **Journal des changements** — l'historique de chaque changement apporté à ce locataire, autant ceux faits par Panoptica365 (déploiements, applications de paramètres) que ceux consignés manuellement par les opérateurs. Les alertes de dérive renvoient aux entrées d'ici quand un changement les explique.

## L'onglet Vue d'ensemble : les cartes de métriques

La zone du haut est une grille de cartes à consulter d'un coup d'œil. Ce qui apparaît dépend de ce que le locataire possède, mais attendez-vous à :

- **Score de sécurité** — avec la moyenne comparative des locataires de taille similaire.
- **Identité** : Utilisateurs totaux, Licenciés, **Admins globaux** (vert à 2 ou moins, rouge au-delà de 5 — le nombre compte), pourcentage **AMF inscrite** (vert à 90 % et plus), Utilisateurs à risque, Inactifs (90 j).
- **Contrôle d'accès** : Stratégies AC (réparties activées/désactivées), Défauts de sécurité actifs ou non.
- **Appareils** : pourcentage d'Appareils conformes avec flèche de tendance, Appareils inactifs (90 j), état de synchronisation Entra Connect.
- **Collaboration** : Sites SP, **Liens anonymes** (gravité élevée s'il y en a), comptes OneDrive, Équipes (réparties publiques/privées).
- **Courriel** : Boîtes aux lettres, activité Courriel (7 j), **Règles de boîte de réception** — avec un indicateur de transfert externe, l'un des signaux de compromission les plus courants.
- **Apps et DNS** : Apps enregistrées, Apps d'entreprise, Domaines avec l'état de validation MX/SPF/DMARC/Autodiscover.

Traitez les cartes comme une surface de triage : tout ce qui est rouge ou jaune est une question qui mérite une réponse.

## L'onglet Vue d'ensemble : les panneaux de détail

Sous les cartes, des panneaux repliables portent le détail derrière chaque carte : la répartition des licences, la liste réelle des administrateurs globaux, les utilisateurs sans AMF, le détail de chaque stratégie AC, le tableau complet des appareils Intune, les principales boîtes aux lettres par stockage, les liens de partage anonymes par site, toutes les règles de boîte de réception regroupées par utilisateur, les listes d'utilisateurs et d'appareils inactifs, les applications enregistrées et tierces, et les enregistrements DNS par domaine.

Vous utiliserez ces panneaux constamment pendant les évaluations et les conversations avec les clients — « vous avez quatre administrateurs globaux et deux d'entre eux sont des comptes sans licence dont personne n'est responsable » sort directement d'ici.

## Fraîcheur des données

Tout ce qui figure sur la Vue d'ensemble reflète la **dernière interrogation** (l'intervalle que vous fixez par locataire, 1 à 60 minutes, plus des cycles plus lents pour les données lourdes). Si vous venez d'intégrer le locataire, donnez quelques minutes à la première interrogation; si une carte semble périmée, vérifiez **Dernière interrogation** sur la page Locataires.

## Et ensuite

Un premier passage sensé sur un locataire fraîchement intégré : survolez la Vue d'ensemble à la recherche de tout ce qui est alarmant, puis travaillez **Applications** (approuvez ce en quoi vous avez confiance), puis **Stratégies AC** et **Stratégies Intune** (déployez vos références), puis **Sécurité** (la surface des paramètres à l'échelle du locataire, depuis la barre latérale). Les quatre prochains guides parcourent chacun de ces volets.
