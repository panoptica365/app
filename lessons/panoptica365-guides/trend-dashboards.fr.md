---
title: "Tableaux de tendances — la sécurité dans le temps"
subtitle: "Les deux surfaces longitudinales : l'onglet Tendances d'un locataire et la page Tendances du parc, graphique par graphique."
icon: "trending-up"
last_updated: 2026-06-18
---

# Tableaux de tendances — la sécurité dans le temps

La Console principale et la Vue d'ensemble d'un locataire répondent à *« comment ça va en ce moment? »*. Les tableaux de tendances répondent à la question plus difficile : *« est-ce qu'on s'améliore ou qu'on se dégrade, et comment le prouver? »* Il y en a deux — un **onglet Tendances sur chaque tableau de bord de locataire**, et une **page Tendances à l'échelle du parc** dans la barre latérale. Les deux lisent l'historique que Panoptica365 accumule au fil de ses interrogations quotidiennes; ils ne coûtent donc rien à ouvrir et n'ajoutent aucune charge chez Microsoft. Les deux portent un **sélecteur de période** — 7 j / 30 j / 90 j / 1 an — en haut à droite.

Un locataire fraîchement intégré n'aura pas encore grand-chose à tracer. Là où l'historique se construit encore, le graphique le dit (*« La tendance commence le… »*) au lieu de tracer une ligne plate trompeuse. Donnez-lui quelques semaines.

## L'onglet Tendances d'un locataire

Ouvrez un locataire, puis cliquez sur **Tendances** (le deuxième onglet, à côté de Vue d'ensemble). Il se divise en deux moitiés — *ce que le client voit* et *ce que le fournisseur voit* — avec une bande de statistiques de couverture en haut.

**Bande de couverture** — une réassurance d'une ligne : combien des contrôles recommandés par Microsoft sont configurés et sains pour ce locataire. C'est la posture en chiffre, pas en graphique, parce qu'un locataire bien tenu reste à 100 % et qu'une ligne plate ne vous apprend rien.

Ce que le client voit :

- **Cote de sécurité Microsoft** (le graphique vedette) — la mesure de sécurité canonique de Microsoft pour ce locataire au fil du temps, avec une ligne pointillée montrant la moyenne des **entreprises de taille comparable** (la référence de Microsoft). La cote bouge à mesure que Microsoft relève la barre; garder la ligne pleine au-dessus de la pointillée, c'est le travail. La pastille indique de combien de points vous devancez les locataires comparables, ou de combien vous êtes en retard.
- **Cote de sécurité par catégorie** — la même cote ventilée selon les catégories de Microsoft (Identité, Données, Appareils, Applications, Infrastructure) en aires empilées. Elle montre *d'où* viennent les points et *où subsistent les lacunes* — la bande la plus mince est votre prochaine campagne.
- **Recommandations de sécurité appliquées** — combien des actions recommandées par Microsoft sont réellement en place, au fil du temps. C'est le travail qui ne finit jamais : Microsoft ajoute constamment des recommandations, donc une ligne plate ici signifie que vous suivez le rythme, et une ligne ascendante que vous gagnez du terrain.
- **Problèmes détectés et résolus** — les dérives et menaces que Panoptica a détectées et que votre équipe a réglées, par mois et par gravité. C'est le récit de la valeur : la preuve que le service fait quelque chose.
- **Problèmes ouverts dans le temps** — combien d'éléments étaient en attente d'action chaque jour. Tendre vers zéro est l'objectif; une ligne qui monte signifie que l'arriéré grossit plus vite que l'équipe ne le résorbe.

Ce que le fournisseur voit :

- **Délai de résolution** — médiane d'heures entre le déclenchement d'une alerte et sa résolution. Votre réactivité, en preuve — utile pour les conversations sur les ententes de service.
- **Volume d'alertes par semaine** — nouvelles alertes par semaine, par gravité. Ce locataire devient-il plus bruyant ou plus calme?
- **Politiques les plus déclenchées** — quelles politiques génèrent le volume sur les 90 derniers jours, en barres classées. Les barres les plus longues sont vos candidates au réglage : une politique qui se déclenche sans cesse est soit un vrai problème, soit une politique à ajuster.

## La page Tendances du parc

Cliquez sur **Tendances** dans la barre latérale gauche (juste après Carte thermique). C'est la même idée, élargie à tout le parc d'un coup. Elle couvre vos **locataires gérés seulement** — les locataires en audit ne font pas partie du récit de posture du parc — et s'organise en *Cote de sécurité et posture* et *Opérations d'alertes*, encore une fois avec une bande de couverture en haut.

**Bande de couverture du parc** — combien de locataires gérés sont à 100 % des contrôles recommandés, et la couverture moyenne du parc. L'étoile polaire de tout le parc.

Cote de sécurité et posture :

- **Cote de sécurité Microsoft du parc** (la vedette) — la cote de sécurité moyenne des locataires gérés au fil du temps. Trois éléments se superposent à la ligne moyenne : une **plage max–min** ombrée montrant votre meilleur et votre pire locataire chaque jour (des chiffres réels, non lissés — vérifiables à la main), une **référence de taille comparable** en pointillé, et — uniquement si vous avez intégré des locataires durant la période — une ligne verte des **« locataires existants »** qui garde la même cohorte constante. L'infobulle indique sur combien de locataires la moyenne a été calculée ce jour-là.
- **Croissance du parc — locataires gérés** — combien de locataires gérés existaient chaque jour, avec un repère les jours d'intégration. Ce graphique explique celui du dessus : quand vous ajoutez un locataire qui part de bas, la moyenne du parc baisse — c'est le parc qui change, pas vos clients existants qui se dégradent. La ligne verte de la vedette et ce graphique, ensemble, permettent de distinguer ces deux récits.
- **Recommandations en suspens** — total des actions recommandées par Microsoft encore ouvertes dans tout le parc. Suivez-vous collectivement le rythme?
- **Cote de sécurité par catégorie** — la cote moyenne du parc par catégorie Microsoft au fil du temps. Là où *tout le parc* est le plus faible se trouve l'endroit au meilleur levier pour mener une campagne chez tous les clients d'un coup.

Opérations d'alertes :

- **Problèmes détectés et résolus** — total résolu pour le parc, par mois et par gravité. Combien l'équipe a-t-elle réglé chez tout le monde?
- **Problèmes ouverts dans le temps** — total des éléments en attente d'action chaque jour pour le parc. L'équipe suit-elle le rythme à l'échelle du parc?
- **Délai de résolution** — médiane d'heures par semaine pour le parc, avec une **ligne p90** au-dessus. La médiane, c'est le cas typique; le p90 attrape la queue de distribution — quelques locataires lents à résoudre que la médiane cache. Une preuve d'entente de service pour tout le parc.
- **Volume d'alertes par semaine** — nouvelles alertes du parc par semaine, par gravité. Est-ce plus bruyant dans l'ensemble?
- **Répartition des alertes par catégorie dans le temps** — nouvelles alertes du parc regroupées par catégorie de politique (connexions à risque, gestion des menaces, partage externe, modifications de configuration, autorisations, gouvernance de l'information) par semaine. Elle vous dit *quel type de travail* le parc génère, ce qui doit guider la dotation et la formation.
- **Politiques les plus déclenchées — 90 derniers jours** — les politiques les plus bruyantes partout, classées. Ce sont vos cibles de réglage à l'échelle du parc — ajustez une politique et vous la faites taire chez tous les clients.

## Bien les lire

- **La cote de sécurité bouge parce que Microsoft relève la barre.** Une baisse ne signifie pas toujours qu'une chose s'est dégradée chez vous — Microsoft a peut-être ajouté une recommandation. La ligne de référence est le contexte qui vous garde honnête là-dessus.
- **Sur la vedette du parc, surveillez la plage, pas seulement la moyenne.** Une moyenne saine qui cache un minimum très bas signifie qu'un client tire vers le bas — la plage le révèle; la moyenne l'enterre.
- **Utilisez la bonne période pour la question.** 7 j / 30 j pour une rétrospective d'incident ou une semaine bruyante; 90 j / 1 an pour une revue d'affaires ou une diapositive de conseil. Le récit change selon la lentille.
- **Les politiques les plus déclenchées sont une invitation, pas un verdict.** La barre la plus longue est soit un vrai problème récurrent chez ce client, soit une politique trop sensible. Les deux méritent une action — l'une avec le locataire, l'autre avec la politique.

*Les tableaux de bord vous disent l'état. Les tendances vous disent la trajectoire — et c'est la trajectoire qui est en jeu lors d'un renouvellement client, d'une revue d'entente de service ou d'une revue d'affaires trimestrielle.*
