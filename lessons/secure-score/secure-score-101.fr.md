---
title: "Secure Score 101 — ce que le chiffre mesure réellement, et ce qu'il ne mesure pas"
subtitle: "Ce que Microsoft Secure Score mesure vraiment, ce qu'il ne mesure pas, et comment l'utiliser honnêtement avec les clients."
icon: "gauge"
last_updated: 2026-05-29
---

# Secure Score 101 — ce que le chiffre mesure réellement, et ce qu'il ne mesure pas

Un MSP accueille un nouveau client en mars. L'ancien fournisseur TI du client avait passé les deux dernières années à lui assurer que son environnement Microsoft 365 était « entièrement sécurisé » — c'était même un argument central de la proposition de renouvellement qui avait maintenu ce fournisseur en place pendant ces deux années. Le client y croyait. Le nouveau MSP, qui reprend le compte, ouvre Panoptica365, ajoute le tenant, laisse la collecte se compléter. La Secure Score revient à **41 %**.

Le nouveau MSP montre le chiffre au client. Le client est, brièvement, très fâché — contre l'ancien fournisseur, contre lui-même de ne pas avoir posé la question avant, contre la situation au complet. Une fois la réaction immédiate passée, il pose la question que chaque client pose : « ça veut dire quoi exactement, ce chiffre-là? »

Cette leçon parle de pouvoir répondre à cette question honnêtement. Microsoft Secure Score est la métrique de sécurité la plus citée dans l'écosystème M365 et une des plus mal comprises. Les opérateurs qui savent la lire correctement — qui savent ce que mesure le pourcentage, ce qu'il ne mesure pas, où il colle à la réalité et où il induit en erreur — peuvent s'en servir comme d'un des outils face client les plus puissants du coffre à outils MSP. Les opérateurs qui la traitent comme une boîte noire la sous-estiment (en ignorant un signal utile) ou la surestiment (en vendant un pourcentage au lieu de vendre du vrai travail de sécurité).

La carte 6, c'est six leçons pour lire la Secure Score honnêtement, mapper notre curriculum sur elle, savoir où elle ment, et s'en servir comme livrable face client qui justifie la ligne de service.

## Ce qu'est vraiment Microsoft Secure Score

Microsoft Secure Score est une métrique de posture de sécurité à l'échelle du tenant que Microsoft calcule quotidiennement pour chaque tenant M365. Elle exprime, en pourcentage, combien des configurations de sécurité recommandées par Microsoft le tenant a implémentées par rapport au total possible.

Les bases :

- **Le chiffre est un pourcentage**, calculé comme `(points obtenus) / (max de points disponibles) × 100`. Un client avec 988,2 points sur un maximum possible de 1113,0 a une Secure Score d'environ 88,79 %.
- **Microsoft calcule la note quotidiennement** d'après la configuration du tenant. Vous n'avez pas à vous inscrire; chaque tenant M365 a une Secure Score.
- **La note couvre un ensemble défini de recommandations.** Chaque recommandation a une valeur maximum en points que Microsoft assigne d'après son évaluation de l'impact sécurité de la recommandation. Implémenter une recommandation rapporte les points (ou une fraction, pour les crédits partiels).
- **Les recommandations sont organisées en catégories** — typiquement Identité, Appareils, Applications, Données. La ventilation vous laisse voir quelles zones du tenant sont solides et lesquelles sont faibles.
- **Microsoft publie des comparaisons sectorielles** — la « note moyenne pour les organisations de taille similaire ». Un tenant à 88,79 % pourrait être comparé à une moyenne pour organisations de taille similaire de 46,74 %, ce qui est exactement le genre de comparaison qui transforme le chiffre en visuel de conversation de renouvellement.

La note vit dans le **portail Microsoft 365 Defender** (`security.microsoft.com` → Secure Score). C'est la surface canonique et effectivement la seule chez Microsoft pour la Microsoft Secure Score principale. Pour les opérateurs MSP, le portail est par tenant — chaque client demande d'ouvrir son tenant individuellement. L'agrégation multi-tenant, ce n'est pas quelque chose que Microsoft offre nativement; c'est là que la vue de Panoptica365 (couverte à la leçon 5) devient une surface opérateur qui a vraiment de la valeur.

## À quoi ressemblent les recommandations

Une recommandation dans Secure Score a quelques composantes mobiles :

- **Un titre** qui décrit quoi faire (ex. « Exiger MFA pour les rôles administratifs », « S'assurer que l'audit des boîtes aux lettres est activé pour tous les utilisateurs », « Activer BitLocker pour les disques OS »).
- **Une catégorie** (Identité, Appareils, Applications, Données).
- **Une valeur maximum en points** — combien de points la recommandation contribue si elle est entièrement implémentée.
- **Les points actuellement obtenus** — zéro si non implémentée, le maximum si entièrement implémentée, ou quelque part entre les deux pour un crédit partiel (couvert à la leçon 2).
- **Une exigence de licence** — certaines recommandations ne s'appliquent que si le tenant a une licence spécifique (ex. Entra P2, Defender for Endpoint, fonctionnalités E5). Les recommandations pour lesquelles le tenant n'est pas licencié ne comptent pas dans le max.
- **Une action** — le lien ou les instructions pour vraiment implémenter la recommandation, souvent un lien profond dans le portail Microsoft pertinent.

Quand les opérateurs regardent la Secure Score d'un tenant dans le portail, ce qu'ils voient, c'est essentiellement une liste classée de recommandations, triable par catégorie ou par valeur en points, avec le statut d'implémentation visible par recommandation. Le travail de faire bouger la note, c'est le travail de descendre cette liste, d'implémenter d'abord les items à forte valeur, et d'accepter que certains items ne s'appliquent pas à chaque client.

## L'Identity Secure Score — la cousine Entra qui mérite d'être connue

Il y a une deuxième métrique appelée **Identity Secure Score** qui vit dans Entra ID et qui se fait régulièrement confondre avec Microsoft Secure Score. Les opérateurs devraient connaître la distinction.

- **Microsoft Secure Score** — à l'échelle du tenant, couvre Identité / Appareils / Applications / Données. C'est de ça que parle cette leçon. Vit dans le portail Defender.
- **Identity Secure Score** — spécifique à Entra, couvre seulement les recommandations liées à l'identité. Vit dans le centre d'administration Entra. A une méthodologie de notation séparée, focalisée exclusivement sur la posture de sécurité d'Entra ID.

Les deux notes se chevauchent (les deux incluent des recommandations d'identité) mais elles sont calculées différemment et apparaissent dans des portails différents. Microsoft Secure Score est la métrique la plus complète et celle à utiliser dans les conversations face client. L'Identity Secure Score est occasionnellement utile pour creuser le portrait spécifique à l'identité, mais ce n'est pas le chiffre principal.

Quand un client demande « c'est quoi notre note de sécurité? », il veut presque toujours dire Microsoft Secure Score. Si vous vous retrouvez à regarder un chiffre différent de celui auquel vous vous attendiez, vérifiez dans quel portail vous êtes — Entra et Defender affichent tous les deux « Secure Score » sans toujours rendre évident lequel.

## Ce que la note ne vous dit PAS

Voilà le cadrage qui compte plus que la définition. La note est **utile mais limitée**. Les opérateurs qui comprennent les limites s'en servent bien; ceux qui ne les comprennent pas la survendent aux clients (créant des attentes que la note ne peut pas satisfaire) ou la rejettent (ratant ce qu'elle signale utilement).

Ce que le pourcentage ne mesure *pas* :

- **Si le tenant a été attaqué ou compromis.** Une note de 95 % sur un tenant qui se fait silencieusement exfiltrer en ce moment par un attaquant équipé d'AiTM reste 95 % jusqu'à ce que les détections Microsoft se déclenchent. La note est un instantané de configuration, pas un état de menace.
- **Si les paramètres configurés sont *bien réglés* pour le client.** Secure Score donne des points pour « politique anti-hameçonnage activée » — elle ne sait pas si la liste d'utilisateurs protégés contient les bonnes personnes, si la liste d'expéditeurs de confiance est tenue à jour, si les seuils de la politique correspondent au profil de risque réel du client. Deux clients avec des Secure Score identiques peuvent avoir une protection anti-hameçonnage réelle dramatiquement différente selon le réglage spécifique au client en dessous.
- **La discipline opérationnelle.** La détection de dérive, le triage d'alertes, la gestion des exceptions, la revue annuelle — rien de ce travail continu n'est reflété dans la note. Un client dont le MSP a tout configuré correctement il y a deux ans puis a ignoré le compte a la même note qu'un client dont le MSP répond aux alertes de dérive en quelques heures.
- **Les recommandations qui ne sont pas dans la liste de Microsoft.** La publication DMARC (le travail côté DNS de la carte 5 leçon 4) n'est pas notée — Microsoft ne peut pas vérifier de façon fiable les enregistrements DNS externes, donc tout le parcours `p=none → p=quarantine → p=reject` n'apparaît pas. La publication SPF n'est pareillement pas notée. L'hygiène des règles de flux de courrier, les registres d'exceptions spécifiques au client, la formation à la sensibilisation à la sécurité, la réponse aux incidents hors plateforme — rien de tout ça n'est mesuré.
- **Le paysage de menaces réel du client.** Un petit cabinet comptable et un grand cabinet juridique peuvent avoir des Secure Score identiques tout en faisant face à des profils de menace complètement différents. La note est une base générique contre l'idée que Microsoft se fait de « ce que chaque tenant M365 devrait faire », pas une évaluation de risque adaptée.
- **Si ce qui est *configuré* correspond à ce qui est *appliqué*.** Secure Score lit la configuration. Elle ne vérifie pas indépendamment que la configuration fait vraiment ce qu'elle est censée faire à l'exécution.

La liste pourrait continuer. Le point n'est pas d'être cynique sur la métrique — elle est vraiment utile. Le point, c'est d'être honnête envers vous-même et envers les clients sur ce que le pourcentage signale et ce qu'il ne signale pas.

## Pourquoi la note vaut quand même la peine

Malgré les limites, Microsoft Secure Score gagne sa place dans le coffre à outils MSP pour trois raisons précises :

**C'est un chiffre quantifiable.** Les clients réagissent aux chiffres. « Votre posture de sécurité s'est améliorée » est vague; « votre Secure Score est passée de 62 % à 84 % en neuf mois » est concret et présentable dans une rencontre de renouvellement.

**Elle est rédigée par un tiers.** C'est Microsoft qui définit les recommandations et assigne les poids. Le MSP ne corrige pas ses propres devoirs — il est évalué contre une base que Microsoft maintient. Cette crédibilité de tiers compte quand les clients se demandent si le MSP n'invente pas juste des métriques qui le font bien paraître.

**Elle est directionnellement honnête au plancher.** Un tenant à 41 % a des recommandations sérieuses non touchées. Un tenant à 88 % a fait l'essentiel de ce que Microsoft recommande. La précision de la note se dégrade dans le haut (la différence entre 88 % et 95 % peut être des recommandations conditionnées à une licence ou des items qui ne s'appliquent pas), mais dans le bas, elle est fiable comme signal « ce client est sous-géré ».

Le nouveau MSP de l'anecdote d'ouverture se sert du 41 % pour ancrer la conversation avec le client. Pas « votre ancien fournisseur vous a menti » (trop confrontationnel, en plus l'ancien fournisseur croyait peut-être sincèrement que son travail était adéquat), mais « voici la mesure de base; voici ce qu'il y a derrière; voici le plan pour la faire monter ». Neuf mois plus tard, la note est à 82 %. Le client renouvelle. La Secure Score, c'est la métrique qui a rendu le travail visible.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**Secure Score est un instantané de configuration, pas une garantie de sécurité.** Une note élevée ne veut pas dire en sécurité; une note basse ne veut pas dire compromis. Traitez-la comme un indicateur de posture utile, pas comme un verdict. Quand les clients demandent « est-ce qu'on est en sécurité? », la note fait partie de la réponse, jamais toute la réponse.

**L'Identity Secure Score est une métrique séparée dans un portail différent.** Ne confondez pas les deux dans les conversations avec les clients. Microsoft Secure Score, c'est le chiffre principal; l'Identity Secure Score, c'est le drill-down pour le travail spécifique à l'identité.

**L'usage le plus puissant de la note, c'est la tendance dans le temps.** Un seul pourcentage de Secure Score est un chiffre. Une Secure Score qui est passée de 41 % à 82 % en neuf mois, c'est une histoire — et les histoires, c'est ce que les clients retiennent au renouvellement. Le travail des cartes 3, 4 et 5 fait directement bouger ce chiffre; le reste de la carte 6 parle de la lire correctement et de bien s'en servir.

## Ce qui suit

- **Leçon 2 : Comment la note est calculée.** La mécanique sous le pourcentage — points, poids, crédit partiel, conditionnement par licence, et pourquoi la note bouge toute seule sans que vous changiez quoi que ce soit.
- **Leçon 3 : Mapper le curriculum sur la note.** Comment le travail des cartes 3, 4 et 5 se traduit en recommandations Secure Score précises, et la demi-douzaine à fort impact qui fait le plus bouger la note.

Pour l'instant : ouvrez le tableau de bord principal de Panoptica365. Regardez la colonne Secure Score à travers vos tenants clients. Remarquez la fourchette — certains sont dans les 80, d'autres plus bas, le plus bas est celui qui a besoin de la conversation le plus vite. Cliquez dans le plus bas. La note a une histoire. Le reste de la carte 6 parle de la lire et de la raconter.

---

*Sources des données dans cette leçon — Microsoft Learn sur l'aperçu de Microsoft Secure Score ([Microsoft Learn — Microsoft Secure Score](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score)); méthodologie de calcul de Secure Score ([Microsoft Learn — How Secure Score is calculated](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-improvement-actions)); aperçu de l'Identity Secure Score ([Microsoft Learn — Identity Secure Score in Entra ID](https://learn.microsoft.com/en-us/entra/fundamentals/identity-secure-score)); référence des comparaisons sectorielles pour la moyenne des organisations de taille similaire ([Microsoft Learn — Secure Score comparisons](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-history-metrics-trends)); catégories de recommandations et notation conditionnée par licence ([Microsoft Learn — Secure Score data](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-required-permissions)).*
