---
title: "Comment la note est calculée — points, crédit partiel, et pourquoi elle bouge toute seule"
subtitle: "La mécanique sous le pourcentage : points, crédit partiel, conditionnement par licence, et pourquoi la note bouge sans que vous changiez quoi que ce soit."
icon: "calculator"
last_updated: 2026-05-29
---

# Comment la note est calculée — points, crédit partiel, et pourquoi elle bouge toute seule

Une opératrice ouvre Panoptica365 un lundi matin. Le vendredi précédent, elle avait Client X à exactement 88,79 %. Ce matin, le même client affiche 86,94 %. Rien n'a changé chez le client pendant la fin de semaine — pas de nouvelles boîtes aux lettres, pas de modification de politique, aucune activité admin du tout selon le Tenant Change Log. La Secure Score du client a chuté de presque deux points sans que personne touche à rien.

Elle a déjà vu ça. C'est l'énigme Secure Score la plus fréquente que les opérateurs rencontrent, et la réponse est presque toujours quelque chose du côté Microsoft. Ils ont ajouté une nouvelle recommandation, ils ont changé comment une existante est notée, ils en ont retiré une et le calcul a bougé, une fonctionnalité conditionnée à une licence est devenue disponible et le maximum atteignable a bougé — ou, le plus souvent pour les clients qui roulent Defender for Endpoint, une nouvelle vulnérabilité a été détectée dans un logiciel installé sur un appareil géré, faisant chuter la note jusqu'à ce que les correctifs soient appliqués.

La Secure Score n'est pas une mesure statique du tenant. C'est une *cible mobile* — l'ensemble de recommandations de Microsoft évolue continuellement, l'état de licence du tenant change occasionnellement, et le calcul sous le pourcentage bouge en conséquence. Les opérateurs qui comprennent la mécanique peuvent lire le mouvement correctement; ceux qui ne la comprennent pas finissent à courir après de la dérive fantôme qui n'en est pas vraiment.

Cette leçon fait le tour du calcul sous le pourcentage, la mécanique du crédit partiel, le conditionnement par licence qui affecte le max, et les cinq raisons les plus fréquentes pour lesquelles la note bouge du jour au lendemain.

## Le calcul de base

Le pourcentage est sans complication :

```
Secure Score % = (points obtenus à travers toutes les recommandations applicables) ÷ (max possible) × 100
```

Prenez un exemple hypothétique : un tenant dont la tuile Secure Score affiche `88,79 %` avec `988,2 / 1113,0` en dessous. Le numérateur (988,2), ce sont les points que le tenant a vraiment obtenus. Le dénominateur (1113,0), c'est le max possible — la somme des valeurs en points pour chaque recommandation qui s'applique à ce tenant compte tenu de sa licence. Le pourcentage est 988,2 ÷ 1113,0 × 100 = 88,79 %.

Deux choses à remarquer sur ce dénominateur :

- **C'est le max *applicable*, pas le max absolu.** Les recommandations pour lesquelles le tenant n'est pas licencié ne contribuent pas au dénominateur. Un tenant Business Premium ne se fait pas gonfler son dénominateur par des recommandations E5 comme Sensitivity Labels ou Insider Risk Management — elles ne s'appliquent simplement pas. C'est juste et important : ça veut dire que votre client n'est pas pénalisé de ne pas avoir un palier de licence qu'il ne paie pas.
- **Il change quand Microsoft change son ensemble de recommandations.** Si Microsoft ajoute une nouvelle recommandation qui vaut 10 points, votre dénominateur monte de 10, votre numérateur reste pareil (vous n'avez pas encore implémenté la nouvelle recommandation), et votre pourcentage descend légèrement. C'est le mécanisme derrière la plupart des mystères « la note a baissé sans qu'on change rien ».

## Le crédit partiel — ce que ça veut vraiment dire

Plusieurs recommandations Secure Score donnent un **crédit partiel** selon à quel point le tenant a implémenté la recommandation. Le pourcentage que vous voyez sur une recommandation dans le portail — disons « 8,5 / 10 points obtenus » — reflète typiquement l'implémentation partielle.

Le patron de crédit partiel le plus fréquent, c'est la **couverture par utilisateur**. La recommandation « Exiger MFA pour tous les utilisateurs » ne bascule pas juste sur on ou off; elle se met à l'échelle avec la fraction des utilisateurs qui ont vraiment MFA appliqué. Si vous avez 40 utilisateurs et que 36 sont appliqués, vous obtenez 36/40 du max de la recommandation en points. Les quatre utilisateurs qui restent (le dirigeant qui a insisté pour une exception, le compte de service, les deux contractuels que vous avez oubliés) vous coûtent des points partiels.

D'autres patrons de crédit partiel :

- **Couverture par politique.** « S'assurer que toutes les politiques anti-hameçonnage utilisent mailbox intelligence » donne plein crédit seulement si *toutes* les politiques anti-hameçonnage du tenant ont la fonctionnalité activée — crédit partiel pour celles qui l'ont.
- **Basé sur seuil.** Certaines recommandations mesurent des valeurs qui doivent atteindre un seuil. « S'assurer que votre politique de risque de connexion est activée » peut donner un crédit partiel selon la portion de la base d'utilisateurs couverte par la politique.
- **Basé sur temps.** Une poignée de recommandations vérifient que les journaux d'audit sont conservés au moins N jours — crédit partiel si vous conservez moins que la durée recommandée.

Ça compte pour deux flux de travail opérateur :

**Lire une recommandation correctement.** Quand vous voyez une recommandation qui affiche 80 % de son max, ça ne veut pas dire « on a essayé mais on a un peu raté ». C'est probablement « on a couvert 80 % des cibles et quatre utilisateurs / politiques / configurations précis ne sont pas couverts ». Creuser dans la recommandation dans le portail révèle typiquement exactement quel sous-ensemble manque.

**Faire bouger la note efficacement.** Quand vous planifiez la prochaine passe de travail sécurité pour un client, les recommandations en crédit partiel sont souvent les fruits qui pendent le plus bas. Une recommandation à 8,5/10 peut juste avoir besoin que vous appliquiez MFA sur un compte de service supplémentaire pour réclamer les 1,5 points qui restent. C'est un changement de cinq minutes pour un mouvement mesurable de la note. Les repérer fait partie du travail de la leçon 3.

## Les recommandations conditionnées par licence et le flux « Risk Accepted »

Microsoft Secure Score inclut des recommandations qui exigent des licences précises pour être implémentées. Exemples :

- **Déploiement de Defender for Identity** (exige Defender for Identity en autonome ou E5 avec le bundle).
- **Customer Lockbox** (E5).
- **Politiques d'étiquetage automatique et de classification de données** (Information Protection P2 / E5 Compliance).
- **Politiques de risque de connexion** (Entra ID P2).
- **Politiques de risque utilisateur** (Entra ID P2).
- **Insider Risk Management** (E5).
- **Attack Simulation Training** (E5).

Voici la partie qui prend les opérateurs par surprise : **ces recommandations apparaissent quand même dans la liste de recommandations du tenant et contribuent quand même au dénominateur max même quand le tenant n'a pas la licence requise**. Ouvrez la Secure Score d'un tenant Business Premium dans le portail Defender et vous verrez Defender for Identity, Customer Lockbox, Auto-labeling, et d'autres items conditionnés à E5 assis dans la liste avec `0 / X points` à côté. Ils tirent le pourcentage vers le bas malgré qu'ils soient impossibles à implémenter en Business Premium.

Microsoft donne aux opérateurs trois statuts alternatifs pour gérer les recommandations qu'ils ne peuvent pas ou ne veulent pas implémenter :

- **Resolved through third party** (« résolu par un tiers »). À utiliser quand un outil non-Microsoft gère la même fonction de sécurité. Microsoft donne plein crédit pour la recommandation comme si vous l'aviez implémentée. Cas d'usage honnêtes : un MDR tiers qui couvre la fonction Defender for Identity; un produit DLP tiers qui couvre la recommandation d'étiquetage de Microsoft. Cas d'usage malhonnêtes — et les opérateurs le font — c'est de marquer des choses « tiers » sans qu'aucun tiers ne fournisse vraiment la fonction. La note monte, la sécurité non.

- **Risk accepted** (« risque accepté »). À utiliser quand vous avez revu la recommandation et décidé de ne pas l'implémenter (souvent parce que la licence n'est pas là, ou parce que le profil de risque du client ne justifie pas le coût opérationnel). La recommandation reste dans le max à zéro point, mais elle est documentée comme une décision délibérée plutôt qu'un item non traité. Cadrage honnête dans les conversations avec les clients : « on a revu ça, voici pourquoi on a accepté le risque ».

- **Planned** (« planifié »). À utiliser quand vous vous êtes engagés à implémenter selon un échéancier mais que vous ne l'avez pas encore fait. Aucun point accordé, mais la recommandation est marquée comme travail en file.

Pour la plupart des tenants Business Premium, **la plupart des recommandations conditionnées par licence sont marquées Risk accepted** — le client n'a pas la licence, le MSP a documenté la décision, et la recommandation ne se lit plus comme « négligée ». Le pourcentage de Secure Score ne monte pas en faisant du Risk accepted; c'est la documentation qui monte.

Le flux Risk Accepted fait partie de l'hygiène opérateur. Périodiquement (la leçon 6 couvre la cadence), revoyez la liste Risk Accepted et confirmez que le raisonnement tient toujours. Si un client met plus tard à niveau vers E5, plusieurs items Risk Accepted deviennent implémentables et l'opérateur devrait revisiter les décisions. Si le profil de risque d'un client change, pareil.

**Pourquoi ça compte pour la comparaison entre tenants.** Deux tenants Business Premium peuvent avoir des configurations identiques mais des Secure Score différentes selon combien de recommandations l'opérateur a marquées Risk accepted ou Resolved through third party. Un tenant où l'opérateur a fait le travail d'hygiène Risk-Accepted affichera un pourcentage plus bas mais plus honnête qu'un tenant où des items non licenciés et non touchés sont assis à zéro sans aucune décision enregistrée. Servez-vous du pourcentage comme point de départ de la conversation sur *ce que l'opérateur a fait avec chaque recommandation* — pas comme chiffre de comparaison directe.

## La ventilation par catégorie

Sous le pourcentage principal, Microsoft décompose la note en catégories — typiquement Identité, Appareils, Applications, et Données. Chaque catégorie a son sous-total : points obtenus vs max possible à l'intérieur de cette catégorie.

La vue par catégorie est utile à des fins diagnostiques. Un client avec une note globale de 88 % pourrait avoir :

- Identité à 95 % (MFA, auth héritée, protection admin tous en bon état)
- Appareils à 92 % (modèles Intune bien déployés)
- Applications à 78 % (configurations côté courriel partiellement manquantes)
- Données à 65 % (DLP, sensitivity labels non touchés — fréquent pour les tenants Business Premium qui n'ont pas la licence)

Lire les catégories vous dit *où* la note vit et *où* sont les trous. Un opérateur qui fait une revue avant renouvellement peut se servir de la ventilation par catégorie pour focaliser le travail du prochain trimestre — « Identité est solide, c'est dans Applications que se trouve le gain du prochain trimestre » — plutôt que de traiter le pourcentage principal comme seul signal.

## Pourquoi la note bouge toute seule — les six raisons les plus fréquentes

Retour à l'anecdote d'ouverture. La chute du lundi matin de 88,79 % à 86,94 % sans aucun changement côté tenant. Six explications plausibles :

**1. Une nouvelle vulnérabilité a été détectée dans un logiciel installé.** Pour les clients qui roulent Defender for Endpoint, Microsoft Defender Vulnerability Management (MDVM) alimente Secure Score. Quand une nouvelle CVE est annoncée touchant un logiciel qui roule sur un terminal géré — une mise à jour Windows, une version de Chrome, une release d'Acrobat Reader, le client SQL sur le serveur de fichiers — la note descend jusqu'à ce que le correctif soit déployé. C'est la cause *la plus fréquente* de chutes de note du jour au lendemain sur les tenants déployés avec MDE, parce que le monde produit des nouvelles CVE constamment et les correctifs traînent derrière la détection de quelques jours. La bonne nouvelle : quand le RMM roule son cycle de correctifs et que le logiciel vulnérable se met à jour, les points reviennent.

**2. Microsoft a ajouté une nouvelle recommandation.** Microsoft introduit de nouvelles recommandations à mesure que le paysage de sécurité évolue — un nouveau patron de menace, une nouvelle fonctionnalité Defender, une nouvelle exigence de conformité. La nouvelle recommandation contribue au max (dénominateur monte); le tenant ne l'a pas encore implémentée (numérateur inchangé); le pourcentage descend. L'historique de changements de Secure Score dans le portail Microsoft 365 Defender montre ce qui a été ajouté.

**3. Microsoft a retiré ou re-pondéré une recommandation existante.** Moins fréquent mais réel. Une recommandation que Microsoft considère obsolète est retirée; le max rétrécit; le pourcentage bouge. Une recommandation est re-pondérée (la valeur en points change); même effet.

**4. La licence du tenant a changé.** Si le client a ajouté ou retiré des licences pendant la fin de semaine (une nouvelle embauche activée, un départ désactivé, un échange de SKU de licence), l'ensemble de recommandations applicables a bougé, et le max a bougé en conséquence.

**5. La configuration du tenant a changé du côté Microsoft.** Certaines recommandations vérifient une configuration que Microsoft gère ou pour laquelle Microsoft met à jour les défauts. Quand Microsoft resserre ou relâche un défaut, les recommandations qui notent contre ce défaut peuvent bouger.

**6. La configuration du tenant a changé du côté de l'opérateur.** Soit délibérée (dérive que vous devriez enquêter via le Tenant Change Log et les alertes de dérive de Panoptica365) soit accidentelle (quelqu'un a désactivé quelque chose qu'il n'aurait pas dû). C'est le cas où la note vous dit quelque chose sur *votre* client précisément.

Quand la note bouge et que vous ne pouvez pas l'expliquer à partir des cas 4 et 6 (les causes côté tenant que vous contrôlez), la réponse est presque toujours 1, 2, 3 ou 5 — côté Microsoft. L'historique de changements de Secure Score dans le portail Defender, c'est là où vous confirmez.

## Vérifier avec le portail Microsoft Defender

Quand la note bouge de façon inattendue, le flux diagnostique, c'est :

1. **Ouvrez le portail Microsoft 365 Defender** pour le client (`security.microsoft.com` → Secure Score).
2. **Regardez l'onglet History.** Microsoft montre les changements de note récents avec les deltas sous-jacents au niveau de la recommandation.
3. **Pour chaque recommandation dont le statut a changé :** cliquez dedans. Lisez la description, l'historique d'action, le détail par cible (si c'est une recommandation par utilisateur / par politique avec crédit partiel).
4. **Faites le recoupement avec le Tenant Change Log de Panoptica365** pour confirmer si le changement vient du côté opérateur ou du côté Microsoft.

C'est du travail par tenant. Il n'y a pas de vue « qu'est-ce qui a changé à travers les 30 clients cette semaine » à l'échelle de la flotte dans le portail Microsoft; chaque client est enquêté individuellement quand sa note bouge assez pour mériter un coup d'œil.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**Le mouvement de la note est habituellement du côté Microsoft, pas du côté client.** Une Secure Score qui descend sans aucun changement côté tenant, c'est le plus souvent une nouvelle vulnérabilité qui apparaît sur un terminal géré (le cycle de correctifs rattrape; les points reviennent), ou Microsoft qui ajoute / re-pondère une recommandation. Vérifiez l'onglet History dans le portail Defender avant de supposer que la sécurité du client a vraiment régressé.

**Le crédit partiel est l'ami de l'opérateur.** Les recommandations à 80-95 % de leur max sont habituellement à un ou deux changements ciblés du plein crédit. Les travailler, c'est le chemin le plus efficace vers un mouvement de note. Les recommandations à 0 % sont typiquement les gros items architecturaux qui demandent plus de travail.

**Les recommandations conditionnées par licence restent dans le max — les gérer via Risk Accepted fait partie de l'hygiène opérateur.** La Secure Score d'un client Business Premium inclut des recommandations E5 (Defender for Identity, Customer Lockbox, Auto-labeling, etc.) assises à zéro point. Le travail de l'opérateur, c'est de décider quoi faire avec chacune : implémenter (si possible), Resolved through third party (si un outil couvre la fonction), Risk accepted (avec une raison documentée), ou Planned (si planifié). Les items conditionnés par licence et non touchés tirent la note vers le bas sans contribuer à la valeur sécurité — des décisions Risk Accepted explicites font lire le pourcentage plus honnêtement et créent la piste d'audit que les clients veulent au renouvellement.

## Ce qui suit

- **Leçon 3 : Mapper le curriculum sur la note.** Quelles recommandations du catalogue Microsoft correspondent au travail que vous avez déjà fait dans les cartes 3, 4 et 5 — et la demi-douzaine à fort impact qui fait bouger l'essentiel de la note pour un client PME.
- **Leçon 4 : Où Secure Score induit en erreur.** Les angles morts, le piège du jeu de score, et le travail qui n'apparaît dans aucun chiffre.

Pour l'instant : prenez le client dont la note vous intrigue le plus. Ouvrez le portail Defender pour ce tenant. Lisez l'onglet History. La plupart du temps, ce qui avait l'air d'une dérive, c'est en fait Microsoft qui change les poteaux de but — et lire la note sous cet angle change la façon dont vous agissez dessus.

---

*Sources des données dans cette leçon — Microsoft Learn sur comment Microsoft Secure Score est calculée ([Microsoft Learn — How Secure Score is calculated](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-improvement-actions)); mécanique du crédit partiel et de la notation des recommandations ([Microsoft Learn — Track your Microsoft Secure Score history](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-history-metrics-trends)); données et catégories Secure Score ([Microsoft Learn — Microsoft Secure Score overview](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score)); recommandations conditionnées par licence et permissions requises ([Microsoft Learn — Required licenses and permissions](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-required-permissions)); référence de l'API Secure Score pour l'accès programmatique ([Microsoft Learn — Secure Score API in Graph](https://learn.microsoft.com/en-us/graph/api/resources/securescore)).*
