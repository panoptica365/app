---
title: "Defender XDR — ce que c'est, ce que ce n'est pas"
subtitle: "La couche de corrélation inter-produit de Microsoft expliquée : pourquoi les MSP ne devraient pas ouvrir le portail chaque jour, et ce que fait Attack Disruption."
icon: "shield-alert"
last_updated: 2026-05-29
---

# Defender XDR — ce que c'est, ce que ce n'est pas

La plupart des jours, vous ne devriez pas avoir besoin d'ouvrir le portail Defender XDR.

Cette phrase va sonner faux si on vient juste de vous dire (correctement) que Defender XDR est le cœur de la détection de sécurité Microsoft 365. Alors laissez-moi vous expliquer pourquoi il est à la fois cœur et fleur murale en même temps.

Defender XDR est la couche de corrélation inter-produit de Microsoft — la chose qui prend les signaux de sécurité bruts de Defender for Endpoint, Defender for Office 365, Defender for Cloud Apps, Defender for Identity et Entra ID Protection, et qui essaie de les transformer en quelque chose sur quoi un humain peut agir. C'est l'endroit où la sécurité M365 passe de « beaucoup d'alertes » à « des histoires sur ce qui s'est passé ».

La réalité honnête de comment les MSP l'utilisent : la plupart ne regardent jamais le portail quotidiennement, et ce n'est pas nécessairement faux. C'est un portail que Microsoft a conçu pour qu'un analyste SOC y vive, huit heures par jour. La plupart des MSP n'en ont pas. Alors XDR doit être configuré pour faire le travail *de manière autonome* et ne faire remonter que ce qui a vraiment besoin d'yeux. Réussir cette configuration, c'est tout le savoir-faire.

## Ce que XDR veut vraiment dire

Les acronymes dans cet espace se sont accumulés rapidement et le marketing n'a pas aidé. Trois termes que vous entendrez :

**EDR — Endpoint Detection and Response.** Surveille un terminal unique (un portable Windows, un Mac, un serveur Linux) pour du comportement malicieux. Defender for Endpoint est l'EDR. Il voit les arbres de processus, les hachages de fichiers, les connexions réseau, les modifications de registre, les chaînes de scripts suspectes. C'est profond, étroit, et ça vit sur l'appareil.

**XDR — eXtended Detection and Response.** Surveille *plusieurs* surfaces et *corrèle* entre elles. Defender XDR est le XDR. Même idée que l'EDR, portée plus large. Quand une utilisatrice clique sur un lien d'hameçonnage dans Outlook (Defender for Office 365), qu'un processus est lancé sur son portable (Defender for Endpoint), et qu'une connexion se produit depuis un autre pays (Entra ID Protection), XDR est la couche qui relie ces trois en *un* incident.

**SIEM — Security Information and Event Management.** Pas une catégorie Microsoft spécifiquement; c'est le nom plus large de l'industrie pour les plateformes de collecte et d'analyse de journaux. Le SIEM de Microsoft, c'est Microsoft Sentinel. SIEM est plus large que XDR — il peut ingérer *n'importe quoi* : journaux de pare-feu, journaux d'applications personnalisées, outils de sécurité tiers. Mais SIEM est aussi plus *brut* — il vous donne les journaux et s'attend à ce que vous écriviez les détections.

La forme des trois :

```
   SIEM    : Journaux bruts de n'importe où. Vous écrivez les
              détections.
              ↓ (filtré, corrélé)
   XDR     : Incidents inter-produit de Microsoft. Microsoft a
              écrit les détections; vous les ajustez et les triez.
              ↓ (focalisé sur une surface)
   EDR     : Télémétrie profonde d'une surface. Surtout en pilote
              automatique.
```

Defender XDR est la couche du milieu. Inforcer, Octiga, Overe, Panoptica365 — on vit tous en aval.

## Alertes vs détections vs incidents

XDR a son propre vocabulaire, et ça vaut la peine de l'apprendre parce que les mots veulent dire des choses précises.

**Signal.** Une observation brute. « Le processus X a été lancé sur l'appareil Y au moment T. » Il y en a des millions par jour dans un tenant typique. Personne ne regarde les signaux directement.

**Détection.** Un patron que Microsoft (ou votre propre règle personnalisée) a décidé d'estimer intéressant. « Powershell.exe lancé avec une ligne de commande encodée depuis un document Word » est une détection. Les détections vivent dans les tables que vous pouvez interroger avec KQL dans Advanced Hunting.

**Alerte.** Une détection qui a franchi un seuil qui mérite d'être montré dans l'UI. Les alertes viennent avec une gravité (informationnel / faible / moyen / élevé) et sont routées par catégorie (accès initial, mouvement latéral, exfiltration, etc.).

**Incident.** Un *regroupement* d'alertes que le moteur de corrélation de XDR pense liées à une seule attaque. Un incident pourrait grouper six alertes à travers courriel, identité et terminal en une seule histoire : « L'utilisatrice Karen a cliqué sur un lien d'hameçonnage → le cookie de session de Karen a été volé → le cookie a été rejoué depuis l'Europe de l'Est → une règle de transfert dans la boîte de réception a été créée. »

Le voyage d'un événement, donc : signal → détection → alerte → incident.

Un XDR bien configuré montre à l'opérateur des *incidents* et lui permet de descendre *vers* les alertes et de là vers les détections. Un mal configuré montre à l'opérateur un lance-à-incendie d'alertes sans corrélation, et l'opérateur se noie.

## Pourquoi la plupart des MSP n'ouvrent pas le portail quotidiennement

Defender XDR est conçu pour un analyste SOC dans un centre de surveillance 24/7. La plupart des MSP n'en sont pas un. Alors la posture réaliste est :

**Attack Disruption gère les pires événements automatiquement.** La capacité Attack Disruption de Microsoft répond automatiquement aux incidents à haute confiance — désactive l'utilisateur, révoque ses jetons, contient l'appareil. Ça se passe sans qu'un opérateur clique sur quoi que ce soit. Au moment où un opérateur regarde le portail le matin, les pires incidents de la nuit sont déjà contenus.

**Automated Investigation and Response (AIR) de Defender for Endpoint nettoie les événements terminaux.** Les processus suspects sont tués et remédiés; les fichiers malicieux sont mis en quarantaine; l'appareil est investigué et re-noté. L'opérateur voit un incident fermé avec une histoire attachée.

**Les alertes en temps réel routent vers la boîte de courriels ou le PSA de l'opérateur.** Le contenu de haute gravité sort de Defender XDR via webhook ou notifications Graph et atterrit dans le flux de travail normal de l'opérateur — Outlook, Teams, la file d'attente PSA, ou Panoptica365.

Ce que ça veut dire en pratique : vous devriez ouvrir le portail Defender XDR *délibérément* — d'habitude une fois par semaine, parfois en réponse à une alerte spécifique — pas tous les jours par habitude. Les deux rituels opérationnels qui comptent :

**Revue hebdomadaire.** Scannez les incidents ouverts et récemment fermés à travers tous vos tenants. Y a-t-il des incidents qui se sont fermés tout seuls mais que vous devriez comprendre? Y en a-t-il qui sont restés ouverts plus de 48 heures? Des entrées non classées dans la file d'attente de notation d'incidents qui ont besoin d'une disposition?

**Plongée ciblée.** Quand Panoptica365 (ou une alerte courriel, ou une plainte client) vous pointe vers un utilisateur ou un appareil spécifique, ouvrez le portail Defender XDR *pour cet utilisateur* et regardez ses alertes et incidents. Le portail est excellent pour la criminalistique un-utilisateur-à-la-fois. Il est mauvais comme outil de surveillance en continu pour un MSP qui gère trente tenants.

## Ce qu'est Attack Disruption, et pourquoi c'est une exception

Attack Disruption mérite son propre paragraphe parce que c'est le seul endroit dans toute cette pile où Defender *fait activement quelque chose* pendant une attaque, plutôt que de simplement la rapporter passivement.

Ça fonctionne comme ça. Defender XDR corrèle les signaux à travers les produits et assigne un score de confiance à chaque incident. Quand cette confiance franchit un seuil élevé *et* que le type d'incident est un que Attack Disruption supporte — actuellement hameçonnage AiTM, business email compromise (BEC), human-operated ransomware (HumOR), password spray — le système prend des actions prédéfinies : désactiver le compte utilisateur dans Entra ID, révoquer ses jetons de session, contenir l'appareil, parfois contenir la connexion réseau de l'appareil. L'opérateur n'approuve pas ces actions. Elles se produisent, c'est tout.

L'opérateur apprend en recevant une notification (« un compte potentiellement compromis a été désactivé automatiquement par attack disruption ») et en voyant l'écusson fermé-avec-mitigation sur l'incident.

C'est la version moderne de « réponse en temps réel » — Microsoft est prêt à prendre des actions seulement quand la corrélation est assez forte pour que le risque de faux positif soit faible. Pour tout le reste, Defender XDR reste un système détecte-et-alerte, et l'humain est dans la boucle.

Quand Attack Disruption se déclenche dans le tenant d'un client, deux choses comptent :

**Vérifier que l'action était correcte.** Un compte correctement désactivé, c'est super. Un compte incorrectement désactivé, c'est un appel de soutien du mardi matin. Vous allez devoir ré-activer l'utilisateur, réinitialiser ses identifiants, et comprendre ce que Defender a vu — et décider si vous êtes d'accord avec ça.

**Reculer le long de la chronologie de l'attaque.** Attack Disruption arrête la propagation, mais l'attaquant était *à l'intérieur* avant que le système agisse. Le travail de criminalistique *après* un événement de disruption est exactement le même que la criminalistique après n'importe quelle compromission. Ne laissez pas « Defender s'en est occupé » arrêter l'enquête.

## Surprises courantes

Quelques choses qui prennent les nouveaux opérateurs par surprise.

**Le portail se renomme tout seul.** Microsoft 365 Defender, Microsoft Defender XDR, Microsoft Sentinel + Defender, et maintenant « Microsoft Security » réfèrent tous à des choses se chevauchant mais distinctes à différents moments dans le temps. Si un article Microsoft Learn de 2023 réfère à un nom de portail différent de ce que vous voyez en 2026, vous n'êtes pas perdu — vous lisez juste de la documentation périmée.

**Defender XDR n'est pas Sentinel, mais Microsoft est en train de les convaincre de fusionner.** Sentinel est le SIEM de Microsoft. Defender XDR est le XDR de Microsoft. Ils partagent des données, ils partagent des surfaces UI (le portail unifié Microsoft Defender peut montrer les deux), mais ils sont facturés séparément et configurés séparément. Beaucoup de MSP utilisent seulement Defender XDR (couvert par les licences M365) et ne déploient jamais Sentinel (séparément licencié, facturé à la consommation). C'est un choix défendable pour un MSP focalisé sur les PME. Les plus grandes entreprises ont typiquement besoin des deux.

**E5 change le comportement de Defender de manière significative.** Beaucoup des capacités plus profondes de Defender XDR — Attack Disruption est l'exemple le plus bruyant, mais Threat Explorer, la rétention de l'advanced hunting, les Custom Detection Rules à l'échelle, tous qualifient — fonctionnent pleinement seulement au palier E5. Les clients Business Premium obtiennent un sous-ensemble significatif mais réduit. La leçon 5 couvre ce qui est derrière quel paywall.

**Le « Centre d'actions » est l'endroit où vivent les remédiations automatiques.** Quand Attack Disruption désactive un utilisateur, quand AIR met un fichier en quarantaine, quand une Custom Detection Rule auto-résout une alerte — tout ça va dans le Centre d'actions. Si vous ne vérifiez que Incidents et Alertes, vous allez manquer ce que Defender a déjà *fait* en votre nom. Survolez le Centre d'actions hebdomadairement.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**Defender XDR est configuré, pas surveillé.** Passez du temps à activer Attack Disruption, mettre AIR en automatique complet sur Endpoint, rendre la notation d'alertes cohérente entre les tenants. Bien configurer le routage des alertes entrantes (courriel, PSA, Panoptica365). Puis *résistez à l'envie* de garder le portail ouvert. Ce n'est pas un tableau de bord; c'est une surface de criminalistique.

**Faire confiance mais vérifier Attack Disruption.** Quand ça se déclenche, c'est généralement correct. Le coût d'une mauvaise action, c'est un ré-activer. Le coût de *ne pas* agir sur une vraie compromission AiTM, c'est un incident à l'échelle du tenant. Le compromis favorise l'action, mais ça doit être couplé avec une pratique « chaque événement de disruption obtient un œil humain en moins de 24 heures ». Les incidents de disruption fermés en silence que personne ne lit, c'est comme ça que des choses se font manquer.

**N'essayez pas d'être Sentinel avec Defender XDR.** Si un client a besoin de corrélation personnalisée à travers des sources de données non-Microsoft — journaux de pare-feu, journaux SaaS tiers, télémétrie d'applications locales — Defender XDR seul n'est pas le bon outil. Sentinel l'est. Pousser Defender XDR à faire ce que Sentinel fait va produire de la fatigue d'alertes et des trous silencieux.

## Ce qui suit

- **Leçon 5 : Les licences Microsoft 365.** Le plus gros facteur limitant sur ce que Defender XDR peut réellement faire, c'est le palier de licence. La leçon 5 marche à travers ce que chaque SKU débloque.
- **Leçon 6 : Où Panoptica365 s'installe dans le tableau.** Indice : on est *complémentaire* à Defender XDR, pas un remplacement. Defender XDR est le système criminalistique; Panoptica365 est le système d'exploitation quotidien.

Ensuite, on passe à la carte 2 (*Menaces identitaires et patrons d'attaque*), qui va vous faire ouvrir Defender XDR pour un utilisateur spécifique à la fois — en faisant exactement le genre de plongée qu'il fait bien.

Pour l'instant : Defender XDR est la couche de corrélation qui devrait surtout fonctionner toute seule. Votre travail, c'est de la configurer correctement, de vérifier dessus hebdomadairement, et de faire confiance à l'automatisation pour gérer le reste.

---

*Sources des données dans cette leçon — Microsoft Learn sur l'architecture et le modèle d'incidents de Defender XDR ([Microsoft Learn — Qu'est-ce que Microsoft Defender XDR?](https://learn.microsoft.com/en-us/defender-xdr/microsoft-365-defender)); portée et types d'attaques supportés par la capacité Attack Disruption ([Microsoft Learn — Automatic attack disruption](https://learn.microsoft.com/en-us/defender-xdr/automatic-attack-disruption)); contexte de positionnement EDR/XDR/SIEM ([Microsoft Learn — Defender for Endpoint plans](https://learn.microsoft.com/en-us/defender-endpoint/microsoft-defender-endpoint)); référence du Centre d'actions ([Microsoft Learn — Action center](https://learn.microsoft.com/en-us/defender-xdr/m365d-action-center)).*
