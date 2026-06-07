---
title: "Secure Score face client — le livrable, la tendance, le récit de renouvellement"
subtitle: "Comment transformer la Secure Score en livrable face client qui ancre les conversations de renouvellement et rend visible le travail de sécurité du MSP."
icon: "presentation"
last_updated: 2026-05-29
---

# Secure Score face client — le livrable, la tendance, le récit de renouvellement

Une rencontre de renouvellement. Le gestionnaire de compte du MSP ouvre son portable, navigue vers le tableau de bord client de Panoptica365 pour le client qu'il rencontre, et montre la tuile Secure Score : **84,1 %** aujourd'hui, en hausse depuis **47 %** quand la relation a commencé il y a quatorze mois. La comparaison « Similar size avg » en dessous lit 46 %. La directrice financière du client regarde l'écran quelques secondes.

« Donc on est passés sous la moyenne à presque le double de la moyenne. »

« Oui. On a traversé la base de référence recommandée par Microsoft. La plupart des clients de votre taille n'ont pas fait ce travail; vous, oui. »

« Et c'est ce pour quoi on paie. »

« Ça et le travail non noté, oui. La note, c'est la partie qui est facile à voir. »

Le renouvellement se ferme en moins d'une heure. Le client signe pour deux ans de plus et demande si le MSP peut prendre en charge sa compagnie sœur.

C'est la conversation à plus forte valeur du curriculum, et Microsoft Secure Score, c'est l'artefact qui la rend possible. Pas parce que le chiffre est toute l'histoire — les leçons 1 et 4 ont rendu ça clair — mais parce que les clients réagissent à l'amélioration mesurable, et une tendance de 47 % à 84 % est mesurable. Le chiffre fait ce qu'aucune auto-description de MSP ne fait jamais : il externalise le travail, rédigé par un tiers, en quelque chose que la directrice financière du client peut mettre sur une diapo pour le conseil.

Cette leçon parle de comment utiliser Secure Score dans les conversations avec les clients — quoi montrer, quand le montrer, comment le cadrer, et où dans Panoptica365 les surfaces vivent vraiment.

## La tendance, pas l'instantané

Les opérateurs nouveaux à la conversation Secure Score mènent souvent avec le pourcentage actuel : « vous êtes à 84 % ». C'est le mauvais cadre. Le pourcentage actuel en lui-même ne répond à aucune question que le client se pose vraiment. *Est-ce que c'est bon? Comparé à quoi? Est-ce que c'est normal? Ça fait quoi?*

Le bon cadre, c'est la tendance dans le temps. « Votre Secure Score est passée de 47 % à l'accueil à 84 % aujourd'hui, une amélioration de 37 points de pourcentage en quatorze mois. La moyenne sectorielle pour les organisations de taille similaire est autour de 46 %. Vous êtes maintenant dans le quartile supérieur des tenants M365 en posture de configuration. »

La tendance raconte une histoire. L'instantané, c'est une statistique. Les clients — surtout les intervenants d'affaires qui n'opèrent pas le tenant au quotidien — réagissent aux histoires.

Ça s'applique même quand la note actuelle est basse :

- **Un client à 41 % sans tendance encore**, c'est la conversation d'accueil. « C'est notre point de départ. Voici le plan pour le faire bouger. On s'attend à être à 70 % au prochain trimestre et à 80 % et plus en neuf mois. »
- **Un client à 65 % en tendance haussière**, c'est la conversation à mi-relation. « Voici ce qu'on a fait; voici ce qui s'en vient; voici la trajectoire attendue. »
- **Un client à 88 % en tendance plate**, c'est la conversation d'état stable. « On est au plafond de configuration pour ce qui a du sens à votre palier. Le travail maintenant, c'est de l'entretien — réponse à la dérive, gestion des exceptions, sensibilisation à l'hygiène courriel des fournisseurs, les items non notés qu'on a couverts le trimestre passé. »
- **Un client à 88 % en tendance *baissière***, c'est la conversation diagnostique. « Quelque chose a dérivé. Regardons ce qui a bougé. » (Souvent la cause de détection de vulnérabilité MDVM de la leçon 2.)

Chaque conversation a un cadre basé sur la tendance. Le chiffre actuel, c'est un point de donnée dans ce cadre; jamais toute la conversation.

## La base de référence à l'accueil — capturée automatiquement

Quand vous accueillez un nouveau client dans Panoptica365, le premier sondage Secure Score arrive automatiquement dès que le tenant est connecté. Cette première lecture entre dans la base de données. Chaque sondage subséquent est stocké à côté, jour après jour, aussi longtemps que la relation dure. Au premier renouvellement du client douze mois plus tard, le système a déjà environ 365 lectures quotidiennes derrière la note à l'écran. La base de référence, ce n'est pas quelque chose dont l'opérateur doit se rappeler de capturer — c'est la première ligne de la table d'historique.

Ça compte pour deux flux de travail opérateur :

**La conversation de renouvellement a des données derrière elle automatiquement.** Six mois dedans, quand le client demande « est-ce qu'on est vraiment plus en sécurité maintenant? », vous avez une réponse vérifiable parce que la donnée est dans la base : « Votre Secure Score était à 39 % le jour où on vous a accueilli; elle est à 71 % aujourd'hui ». Vous assemblez la trajectoire à partir des notes de jalon et de votre dossier de travail accompli; les chiffres sous-jacents sont interrogeables dans l'historique stocké de Panoptica365 quand vous avez besoin de les vérifier.

**Les attentes du client s'ancrent avec le temps.** Les clients oublient parfois à quel point leur tenant n'était pas configuré à l'accueil. Au mois 12, ils en sont venus à s'attendre à MFA, Safe Links, audit de boîtes aux lettres, et politiques CA comme base. Le mouvement de 39 % à 71 % leur rappelle que ça n'a pas toujours été comme ça — *vous l'avez fait pour eux*.

Pour l'opérateur, la capture continue veut dire que le *registre* est toujours là même si la visualisation présentée ne l'est pas — la base de données détient l'historique; ce que le tableau de bord présente, c'est la tuile actuelle. Les opérateurs assemblent la tendance à partir de leur documentation et de leurs notes pour l'instant.

## Où Panoptica365 montre la note

La surface Secure Score de Panoptica365 est une des vues les plus développées de la plateforme. Trois endroits à connaître :

**Le tableau de bord principal de la console — la vue multi-tenant.** Quand vous vous connectez à Panoptica365, le tableau de bord principal inclut un **panneau Tenants** qui liste chaque tenant client avec sa Secure Score actuelle dans une colonne codée par couleur (vert pour les notes élevées, rouge pour les basses). Le panneau a une boîte de filtre pour que vous puissiez chercher par nom de tenant à travers un gros carnet. La colonne Status montre l'état du sondage; la colonne Last Polled montre quand la note a été rafraîchie pour la dernière fois depuis Microsoft. Sous le panneau Tenants se trouve un **Secure Score & Alert Overview** qui montre trois graphiques en anneau côte à côte : la Secure Score **Moyenne** à travers tous vos tenants gérés, le tenant **Plus élevé** (avec le nom du tenant affiché), et le tenant **Plus bas** (avec le nom). Cette vue d'ensemble à trois anneaux, c'est la véritable vue d'agrégation multi-tenant qui n'existe nulle part dans les portails Microsoft — c'est un véritable différentiateur de Panoptica365.

**La tuile Secure Score par tenant.** Quand vous cliquez dans le tableau de bord d'un client précis, la tuile Secure Score est parmi les premières choses que vous voyez. La tuile montre le pourcentage principal en gros caractères (ex. **88,79 %**), les points / max bruts en dessous (`988,2 / 1113,0`), et la comparaison **Similar size avg** que Microsoft publie (ex. `Similar size avg: 46,74 %`). La tuile est codée par couleur — vert pour les notes en santé, transition vers ambre et rouge à mesure que la note baisse.

**L'historique de la note stocké — pas encore présenté comme graphique.** Panoptica365 sonde la Secure Score continuellement et stocke chaque lecture dans la base de données. Les données historiques sont là dès le jour un de la relation client. Ce que le tableau de bord *n'inclut pas* actuellement, c'est une visualisation de tendance présentée — il n'y a pas de graphique dans l'interface de Panoptica365 qu'un opérateur peut ouvrir pour voir « la note de ce client sur les douze derniers mois ». Pour l'instant, l'histoire de tendance s'assemble manuellement : à partir des notes opérateur prises aux jalons significatifs (déploiements, revues trimestrielles), des captures d'écran sauvegardées aux moments clés, et de la mémoire opérateur du travail accompli.

Ce que Panoptica365 *ne présente pas* dans le tableau de bord : un drill-down recommandation par recommandation (c'est dans le portail Microsoft Defender, la leçon 1 a couvert ça), un bouton d'action par recommandation pour appliquer le correctif (Microsoft possède la surface d'action), un rapport PDF généré pour les clients (ceux-là sont exportés manuellement ou construits à partir des données de la tuile), et le graphique de tendance décrit plus haut.

## La conversation de renouvellement — utiliser les surfaces

Un patron qui fonctionne bien pour une revue annuelle ou un renouvellement de contrat :

1. **Ouvrez le tableau de bord principal de Panoptica365** avec le tenant du client filtré ou défilé en vue. Montrez brièvement le panneau Tenants — le client voit sa note dans le contexte de vos autres clients (sans les nommer), ce qui signale « on a un carnet de clients similaires et on s'évalue contre eux ».

2. **Cliquez dans le tenant du client.** La tuile Secure Score est juste là. Lisez les trois chiffres à voix haute : le pourcentage, les points / max, la comparaison similar-size-avg. « Vous êtes à 88,79 %; la moyenne pour des compagnies de taille similaire est de 46,74 %; vous êtes à peu près le double de la moyenne. »

3. **Parcourez la tendance.** À partir de votre documentation client — les notes de jalon, les captures d'écran prises aux moments de déploiement, votre dossier de ce qui a été fait quand — narrez la trajectoire. « Votre base de référence à l'accueil était de 47 %. On a atteint 62 % après avoir déployé les modèles CA en mars. On a atteint 74 % après le déploiement Intune en mai. On est à 84 % aujourd'hui. » Chaque mouvement se relie à du travail précis que le client a payé et que vous avez livré.

4. **Reconnaissez le travail non noté.** « Et voici ce que le chiffre ne montre pas — l'application DMARC est maintenant à p=reject, vos règles de flux de courrier ont été auditées et nettoyées, votre registre d'exceptions a 14 décisions documentées revues au dernier trimestre. Microsoft ne note rien de tout ça, mais c'est là que vit l'essentiel de la vraie valeur sécurité. »

5. **Fixez la cible du prochain trimestre.** « Notre objectif pour les 12 prochains mois, c'est de garder la note dans la fin des 80 pendant qu'on travaille la discipline non notée. On est au plafond de ce qui a du sens pour Business Premium sans franchir vers des fonctionnalités E5 qui ne sont pas rentables à votre taille. »

La conversation dure 15-20 minutes. Elle est ancrée sur des chiffres visibles et liée à du travail précis. À la fin, le client comprend ce qu'il paie d'une façon qu'il ne comprenait pas avant de s'asseoir.

## Comment parler d'une note basse

Les notes basses arrivent — clients nouvellement accueillis, clients qui sont arrivés sous une mauvaise gestion précédente, clients qui n'avaient pas de MSP du tout. La conversation doit naviguer entre « c'est mauvais et il faut agir » (urgence) et « ce n'est pas votre faute et on ne vous blâme pas » (préservation de la relation).

Une structure qui fonctionne :

- **Menez avec la trajectoire, pas l'accusation.** « Votre point de départ, c'est une Secure Score de 41 %. La plupart des clients qu'on accueille partent quelque part entre 35 et 55 %; vous êtes au milieu de cette fourchette. On a un chemin clair pour faire bouger ce chiffre. » Pas : « Votre ancien fournisseur a manqué beaucoup. »
- **Identifiez la demi-douzaine** (leçon 3) comme plan d'amélioration visible. Parcourez quels items vont être implémentés et l'impact attendu sur la note de chacun.
- **Fixez des attentes d'échéancier réalistes.** Passer de 41 % à 80 % et plus, c'est typiquement un voyage de six à neuf mois pour l'équipe d'opérateurs. Ne promettez pas plus vite; plus vite veut habituellement dire couper les coins sur le réglage spécifique au client.
- **Montrez le travail non noté qui roule en parallèle.** « Pendant qu'on fait bouger la note, on fait aussi le travail d'application DMARC, l'audit des règles de flux de courrier, la documentation des exceptions. Ça n'apparaît pas dans le chiffre mais c'est une partie significative de l'amélioration de sécurité. »

Un client à 41 % qui voit une lecture de 47 % trois semaines plus tard, une lecture de 58 % à trois mois, et une lecture de 78 % à neuf mois reste un client. Un client à 41 % à qui on a dit « on va vous amener à 100 % le mois prochain » et qui finit à 62 % se sent menti.

## Comment parler d'une note élevée

Le problème inverse : les clients qui voient un chiffre de 92 % concluent parfois qu'ils ont fini. Ils ont gagné. Ils sont « en sécurité ». Le travail du MSP à ce moment-là, c'est de doucement ré-ancrer.

Un cadrage qui fonctionne :

- **Reconnaissez la note honnêtement.** « Votre Secure Score est dans le décile supérieur des tenants M365. La base de référence recommandée par Microsoft est implémentée de bout en bout pour votre palier. »
- **Rappelez-leur les limites.** Référez au cadrage de la leçon 4. « La note mesure la configuration. Elle ne mesure pas si vos fournisseurs ont une bonne hygiène courriel, si vos utilisateurs reconnaîtraient une attaque d'hameçonnage sophistiquée, si notre réponse aux incidents attraperait une compromission à l'intérieur de la fenêtre qui compte. L'essentiel du vrai travail sécurité entre maintenant et l'an prochain est dans ces zones-là — pas dans le chiffre. »
- **Utilisez le renouvellement pour rediriger vers la discipline.** « On ne va pas se concentrer à faire bouger la note de 92 % à 95 % — ça voudrait dire soit jouer la métrique soit implémenter des recommandations qui ne conviennent pas à votre entreprise. On va se concentrer sur le travail non noté : réponse à la dérive, sensibilisation aux fournisseurs, formation des utilisateurs, revue du registre d'exceptions. C'est ça qui empêche le 92 % d'être un faux réconfort. »

La conversation empêche le client de se désengager parce qu'il pense que le travail sécurité est fini. Il n'est jamais fini; la note ne vous le dit juste pas.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**La tendance, c'est la conversation client; l'instantané, c'est juste le point de donnée.** Menez avec la trajectoire. Le mouvement de 47 % à 84 %, c'est l'histoire; le 84 % aujourd'hui, c'est la ligne sur le graphique. Les clients retiennent les histoires.

**La base de référence du jour un est capturée automatiquement — assurez-vous que votre documentation client y fait référence.** Panoptica365 enregistre le premier sondage Secure Score à l'instant où un tenant se connecte, et chaque sondage subséquent. La donnée est dans la base; ce que le tableau de bord présente aujourd'hui, c'est la tuile actuelle. Les opérateurs assemblent la tendance à partir de leurs propres dossiers — notes de jalon, captures d'écran sauvegardées aux déploiements, documentation prise à chaque étape majeure. Le jour un, c'est le chiffre le plus cité que vous référencerez à propos d'un client; la discipline, c'est de garder le registre de jalons à côté de la capture automatique.

**Utilisez la vue multi-tenant de Panoptica365 comme véritable différentiateur.** Le panneau Tenants + la vue d'ensemble à trois anneaux montre au client (quand approprié) que vous opérez un véritable carnet de clients similaires. Le portail Microsoft ne peut pas faire ça. La directrice financière du client qui voit « moyenne à travers nos clients gérés est de 85,8 % » et « vous êtes à 88,79 % » reçoit deux messages en même temps : vous avez des pairs, et vous êtes en avance sur eux.

## Ce qui suit

- **Leçon 6 : Opérer Secure Score à l'échelle + fermer le curriculum.** La cadence de revue trimestrielle, le cadrage de la cible 80 % et plus, quoi faire quand les notes tendent dans des directions inquiétantes à travers le carnet, et l'argument de fermeture pour ce à quoi ressemble une bonne sécurité MSP.

Pour l'instant : prenez le client dont la revue annuelle s'en vient. Ouvrez le tableau de bord principal de Panoptica365. Prenez une capture d'écran de sa tuile de note et du contexte multi-tenant. Rassemblez la tendance à partir de son historique. Entrez dans la rencontre de renouvellement avec une histoire, pas une statistique. L'histoire du 47 % à 84 %, c'est l'histoire que vous voulez raconter — et que le client veut entendre.

---

*Sources des données dans cette leçon — Microsoft Learn sur l'historique et le suivi de tendance de Secure Score ([Microsoft Learn — Track Secure Score history](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-history-metrics-trends)); comparaisons sectorielles Secure Score et moyenne des organisations de taille similaire ([Microsoft Learn — Secure Score comparisons](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-improvement-actions)); aperçu de Secure Score et structure de données de la tuile ([Microsoft Learn — Microsoft Secure Score](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score)); API Secure Score pour l'accès programmatique aux données que Panoptica365 présente ([Microsoft Learn — Secure Score API in Graph](https://learn.microsoft.com/en-us/graph/api/resources/securescore)).*
