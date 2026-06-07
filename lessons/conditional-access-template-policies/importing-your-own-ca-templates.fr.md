---
title: "Importer vos propres modèles d'AC — le super-pouvoir Panoptica365"
subtitle: "Exportez une politique d'AC d'un tenant Entra, ajoutez-la à Panoptica365 et déployez-la sur toute votre flotte."
icon: "upload"
last_updated: 2026-05-29
---

# Importer vos propres modèles d'AC — le super-pouvoir Panoptica365

La plupart des outils d'aide aux modèles d'AC traitent les modèles comme un cadeau du fournisseur. Le fournisseur livre une bibliothèque; vous déployez ce qui est dans la bibliothèque; si vous voulez quelque chose de différent, vous attendez que le fournisseur l'ajoute. Le client au Mexique ne peut pas utiliser un modèle verrouillé sur le Canada. L'ingénieur senior qui a construit une politique d'AC brillante au tenant d'un client ne peut pas la partager facilement avec le reste du MSP. La bibliothèque de modèles est un catalogue fermé.

Panoptica365 est construit différemment. Toute politique d'accès conditionnel qui existe dans tout tenant Entra — le tenant de votre propre MSP, le tenant d'un client spécifique, le tenant d'un partenaire — peut être exportée et importée dans Panoptica365 comme modèle personnalisé. De là, elle se déploie à chaque tenant client de votre flotte de la même manière que les modèles livrés.

C'est la fonctionnalité de plateforme qui transforme la bibliothèque de modèles d'AC de « ce que Panoptica365 a pensé » à « ce que votre MSP et vos ingénieurs seniors savent de vos clients ». C'est aussi le mécanisme qui rend possible la personnalisation géographique de la leçon 4 — le MSP mexicain n'attend pas que Panoptica365 livre un modèle Mexique; ils en construisent un et l'importent.

Cette leçon est le flux de travail pour ça — quand l'utiliser, comment ça fonctionne, ce qu'il faut surveiller.

## Quand importer un modèle personnalisé

Cinq scénarios où l'importation a du sens :

**1. Personnalisation géographique.** Le modèle « Permettre l'accès seulement depuis le Canada » de la leçon 4 doit devenir « Permettre l'accès seulement depuis le Mexique » pour un MSP basé au Mexique, « Permettre l'accès seulement depuis la France / UE » pour un MSP français, etc. Le patron de condition OU reste le même; l'emplacement nommé change. L'importation est le mécanisme de personnalisation.

**2. Une politique personnalisée que vous avez construite quelque part et voulez réutiliser partout.** Un ingénieur senior du MSP a construit une politique d'AC astucieuse pour un client — disons, une politique qui exige un MFA résistant à l'hameçonnage spécifiquement pour les utilisateurs du département Finance, avec des exclusions soigneusement ajustées pour l'appareil mobile du commis aux comptes payables. Plutôt que de reconstruire cette politique à la main pour chaque tenant client, exportez depuis l'original, importez comme modèle, déployez à travers la flotte.

**3. Une exigence réglementaire qui demande une politique non par défaut.** Un client dans une industrie réglementée (santé, finance, sous-traitance gouvernementale) peut avoir besoin de politiques d'AC que la bibliothèque standard n'inclut pas — une politique de fréquence de session spécifique pour accéder aux IIP, par exemple, ou une politique qui applique une force d'authentification particulière à des apps spécifiques. Construisez-la une fois pour le client réglementé, importez-la comme modèle, déployez à travers d'autres clients similaires.

**4. Une réponse à une compromission spécifique ou un quasi-incident.** Après qu'un client ait eu un incident AiTM, vous avez serré sa politique d'AC pour exiger un appareil conforme + MFA résistant à l'hameçonnage pour les apps sensibles. Vous aimeriez la même posture durcie pour d'autres clients de la même industrie. L'importation est le mécanisme pour ce flux de travail « répandre une bonne politique ».

**5. Une nouvelle menace qui demande une nouvelle politique.** Microsoft annonce une nouvelle technique d'attaque, votre équipe de sécurité conçoit une politique d'AC qui l'adresse, vous la construisez une fois et avez besoin de la déployer à travers trente tenants. L'importation est plus rapide que de la recréer trente fois.

Le patron dans les cinq : une politique existe quelque part, vous voulez qu'elle existe ailleurs, la plateforme rend le transfert trivial.

## Comment fonctionne l'importation

Le flux de travail à haut niveau :

1. **Exporter depuis un tenant source.** Dans le module AC de Panoptica365, sélectionnez le tenant source et choisissez d'exporter les politiques d'accès conditionnel. Panoptica365 lit les politiques depuis Entra ID via l'API Graph et produit une représentation JSON structurée.

2. **Choisir quelles politiques importer.** L'exportation contient typiquement chaque politique d'AC sur le tenant source. Vous sélectionnez les politiques spécifiques que vous voulez amener comme modèles — typiquement une ou deux, pas toutes.

3. **Généraliser les GUID spécifiques au tenant.** C'est l'étape techniquement intéressante. Les politiques d'accès conditionnel référencent les utilisateurs, groupes et emplacements nommés par GUID — et ces GUID sont uniques au tenant source. Une politique « Bloquer hors du Canada » dans le tenant A référence le GUID d'emplacement nommé `abc-123` pour « Canada »; le tenant B a un GUID différent pour le même emplacement nommé. Si vous importiez la politique telle quelle, elle référencerait un GUID inexistant dans le tenant B et l'importation échouerait ou produirait une politique brisée.

   Panoptica365 gère ça en substituant des jetons placeholder au moment de l'importation. Les GUID spécifiques au tenant dans l'exportation source sont remplacés par des placeholders comme `{NAMED_LOCATION_CANADA}`. Quand le modèle est plus tard déployé au tenant B, Panoptica365 résout le placeholder contre les GUID d'emplacement nommé réels du tenant B. Si le tenant B a un emplacement nommé correspondant au placeholder, le déploiement procède; sinon, l'opérateur est invité à en créer un ou à remapper vers un emplacement existant.

4. **Nommer et décrire le modèle.** Donnez-lui un nom et une description d'une ligne style Panoptica365. La convention de nommage utilisée par les modèles livrés est `Panoptica365 - <nom descriptif>` — les modèles personnalisés devraient suivre un patron similaire (`AcmeMSP - <nom descriptif>` ou `<nom du MSP> - <nom descriptif>`) pour qu'ils soient distinguables des livrés dans la liste de politiques sur les tenants clients.

5. **Enregistrer comme modèle dans la bibliothèque Panoptica365.** À partir de ce point, le modèle se comporte comme n'importe lequel des modèles livrés — il est disponible pour le déploiement à n'importe quel tenant client, supporte le déploiement Rapport-uniquement-puis-Activé, et apparaît dans le détecteur de dérive.

## La généralisation d'emplacements nommés, spécifiquement

L'exemple du MSP mexicain de la leçon 4 est le cas canonique. Marchez à travers ce qui se passe mécaniquement :

Le MSP exporte le modèle « Permettre l'accès seulement depuis le Canada » depuis l'un de leurs tenants clients canadiens (ou depuis la vue des modèles livrés de Panoptica365, selon le chemin d'exportation). La politique référence le GUID d'emplacement nommé `xyz-canada-789` et le code de pays `CA`.

Dans le flux d'importation de Panoptica365, la référence d'emplacement nommé est convertie en placeholder. Le modèle contient maintenant quelque chose comme :

```
condition.locations.include = ["{TRUSTED_LOCATION}"]
```

Le MSP nomme ce modèle personnalisé « AcmeMSP - Permettre l'accès seulement depuis le Mexique » et l'enregistre.

Pour chaque tenant client mexicain, le MSP crée d'abord un emplacement nommé appelé « Mexique » avec le code de pays Mexique. Puis ils déploient le modèle AcmeMSP. Au moment du déploiement, Panoptica365 résout `{TRUSTED_LOCATION}` contre les emplacements nommés du client et utilise le GUID pour l'entrée « Mexique ». La politique est créée dans le tenant du client avec la bonne référence d'emplacement.

Si un tenant client n'a pas encore d'emplacement nommé « Mexique », le déploiement invite l'opérateur à en créer un (ou à mapper le placeholder vers un autre emplacement nommé existant). Le système n'échoue pas silencieusement ou ne crée pas une politique brisée.

C'est la fonctionnalité de plateforme qui fait fonctionner la leçon 4 à travers les géographies. Le même mécanisme s'applique à toute autre référence spécifique au tenant dans un modèle importé — groupes d'utilisateurs, emplacements d'accès conditionnel, noms de force d'authentification, etc.

## Ce qui est exporté et ce qui ne l'est pas

Ça vaut la peine d'être explicite : tous les aspects d'une politique d'AC ne sont pas portables.

**Choses qui s'exportent proprement :**
- Nom et état de la politique (Activé, Rapport uniquement, Désactivé).
- Inclusions/exclusions d'utilisateurs et de groupes (par référence; le mécanisme de placeholder gère la traduction GUID).
- Cibles d'app (par ID d'app; les ID d'app de première partie Microsoft sont universels à travers les tenants).
- Conditions : emplacements (via placeholders), apps clientes, plateformes, niveaux de risque de connexion, niveaux de risque utilisateur.
- Contrôles d'octroi et contrôles de session.
- Références de force d'authentification (par nom, qui est cohérent à travers les tenants).

**Choses qui ne s'exportent pas portablement :**
- *Exclusions spécifiques à un utilisateur* par ID d'utilisateur individuel (l'utilisateur n'existe pas dans le tenant de destination). L'exportation capture le *groupe* contenant l'utilisateur, mais les exclusions utilisateur-par-GUID individuelles sont typiquement enlevées ou marquées comme non transférables.
- *Attributs de sécurité personnalisés* qui n'existent que sur le tenant source.
- *Historique de résultats rapport uniquement* — c'est un artefact d'exécuter la politique sur le tenant source, pas une partie du modèle.

Le flux d'importation Panoptica365 fait remonter tout élément non portable pendant l'étape d'importation. L'opérateur décide s'il faut l'enlever, le généraliser, ou accepter la limitation.

## Quand *ne pas* importer

Quelques mises en garde honnêtes — l'importation n'est pas toujours le bon mouvement :

**La politique est brisée ou mal ajustée à la source.** Si la politique originale a accumulé des résidus (exclusions oubliées, cibles dépassées, méthodes d'authentification dépréciées), l'importer répand les résidus à chaque tenant client. Le bon mouvement est de nettoyer la politique source d'abord, *puis* d'exporter et importer.

**La politique est trop spécifique au client.** Certaines politiques d'AC sont profondément spécifiques à l'environnement d'un client — leurs groupes d'utilisateurs spécifiques, leurs apps spécifiques, leur état de conformité spécifique. Essayer de généraliser une telle politique en modèle peut produire quelque chose qui ne fonctionne pas tout à fait pour le nouveau client et demande des bricolages par déploiement. Si la personnalisation par déploiement est substantielle, le modèle ajoute moins de valeur que simplement déployer ad hoc.

**La politique dépend de fonctionnalités E5 seulement et le tenant de destination est Business Premium.** L'AC basé sur le risque, les forces d'authentification avec exigences résistantes à l'hameçonnage, et les politiques conscientes de PIM présument souvent un tenant E5. Importer celles-ci dans un tenant client Business Premium produit une politique qui ne s'applique pas comme prévu (parce que le signal sous-jacent n'est pas disponible).

**La politique est dans la liste d'exclusions du tenant source pour une raison évidente.** Si la politique à la source est actuellement désactivée ou a une exclusion large parce que quelque chose n'a pas fonctionné, c'est une information sur si la politique est assez mature pour se répandre. Importer une politique que le client source a désactivée parce qu'elle brisait des choses ne fait que répandre le bris.

Le principe honnête : importez des politiques qui ont été validées, sont propres, sont portables, et que l'opérateur comprend bien. Les modèles importés héritent de la réputation de votre MSP. Les mauvais modèles coûtent plus que les bonnes politiques ne sauvent.

## Maintenir les modèles personnalisés

Un modèle personnalisé a besoin de maintenance continue — Microsoft change des choses, l'environnement du client change, la politique peut avoir besoin d'évoluer. Le MSP qui a importé le modèle possède maintenant son cycle de vie :

- **Changements de schéma Microsoft Graph.** Microsoft renomme parfois des propriétés d'AC ou change le schéma JSON. Les modèles importés peuvent avoir besoin de mise à jour pour suivre les changements de schéma. Le détecteur de dérive AC de Panoptica365 couvre les modèles livrés; les modèles personnalisés ont besoin que le MSP vérifie périodiquement.

- **Divergence spécifique au client.** Quand l'environnement d'un client change (il ajoute Intune, il fusionne une filiale, il s'étend à une nouvelle région), le modèle qui fonctionnait parfaitement il y a six mois peut avoir besoin d'ajustement. Le patron est le même que pour les modèles livrés — la détection de dérive fait remonter les différences, l'opérateur les adresse.

- **Divergence modèle-vs-politique-déployée.** Avec le temps, les déploiements individuels chez les clients peuvent dévier du modèle (un admin fait un ajustement par tenant). Le détecteur de dérive Panoptica365 le signale; le MSP décide s'il faut (a) mettre à jour le modèle pour correspondre à la divergence, ou (b) ramener la politique du client pour correspondre au modèle, ou (c) accepter la divergence comme personnalisation spécifique au client.

Le coût de maintenance est réel. Importer 15 modèles personnalisés signifie s'engager à maintenir 15 modèles. La plupart des MSP bénéficient d'un petit nombre de modèles personnalisés soigneusement organisés plutôt que d'une grande collection non maintenue.

## La proposition de valeur MSP

La ligne unique qui capture pourquoi ça compte : *la meilleure politique d'AC de chaque client peut devenir la politique d'AC de base de chaque client*. La politique brillante de l'ingénieur senior ne reste pas verrouillée dans le tenant d'un client; le durcissement réglementaire ne se fait pas reconstruire trente fois; la réponse post-incident n'a pas à être inventée deux fois.

Le mécanique de la plateforme — exporter, généraliser, importer, déployer — est la différence entre « le catalogue Panoptica365 » et « le catalogue de votre MSP, construit par-dessus les fondations Panoptica365 ». Pour un MSP qui prend l'AC au sérieux, c'est une des fonctionnalités produit à plus haut levier. C'est pourquoi les sept modèles livrés dans la carte 3 ne sont pas le plafond — ce sont le plancher, et le MSP construit par-dessus.

## Déploiement pour un modèle personnalisé

Identique à n'importe quel modèle livré, avec deux différences. D'abord, une étape d'inspection pré-importation explicite. Ensuite, **l'étape manuelle de rapport uniquement dans le portail Entra est fortement recommandée pour le premier déploiement de n'importe quel modèle personnalisé, peu importe la taille du tenant** — les modèles importés ne sont pas pré-validés, et l'opérateur n'a pas vu cette politique spécifique appliquée avant.

0. **Inspection pré-importation.** Avant d'importer, auditez la politique source. Est-elle propre? Est-elle bien ajustée? Est-elle la version de cette politique que le client utilise présentement (et avec laquelle il est satisfait), ou est-elle un brouillon plus ancien? Toutes les références sont-elles portables, ou y a-t-il des exclusions utilisateur-par-GUID codées en dur qui ne se transféreront pas? Corrigez tout problème dans la source avant d'importer.
1. **Importer.** Tirez la politique du tenant source. Résolvez les placeholders. Enregistrez comme modèle.
2. **Pré-déploiement sur chaque tenant de destination.** Identique aux modèles livrés (leçon 1). Confirmez que les emplacements nommés existent, le break-glass est exclu, etc.
3. **Jour 0** — déployez via Panoptica365 (crée la politique à l'état Activé). Ouvrez immédiatement le portail Entra et basculez la politique en rapport uniquement.
4. **Jours 1–N** — révision rapport uniquement. N est plus long pour des politiques plus complexes; budgétez 7 à 14 jours pour un modèle personnalisé substantiel.
5. **Jour N+1** — basculez la politique de retour à Activé dans le portail Entra.

La plus longue fenêtre rapport uniquement pour les modèles personnalisés reflète l'incertitude supplémentaire. Un modèle livré a été validé contre plusieurs tenants; un modèle importé n'a été validé que contre le tenant source. La fenêtre de vérification attrape les différences entre les environnements source et destination.

Une fois qu'un modèle personnalisé a été déployé à plusieurs tenants clients et vérifié comme fonctionnant proprement, les déploiements subséquents peuvent suivre le flux de modèle livré (déployer directement, sauter le basculement manuel à rapport uniquement) — la validation s'est accumulée.

## À surveiller après l'application

Même surveillance que pour les modèles livrés, plus une spécifique :

**Dérive de modèle à travers la flotte MSP.** Quand plusieurs clients ont le même modèle personnalisé déployé, la divergence individuelle crée une question de dérive à l'échelle de la flotte — le modèle devrait-il être mis à jour pour correspondre à la forme de déploiement la plus courante, ou les clients aberrants devraient-ils être réalignés au modèle? Panoptica365 fait remonter les deux types de dérive.

L'état permanent en santé est une *divergence proche de zéro* entre le modèle et les politiques déployées. Une divergence substantielle indique soit (a) que le modèle a besoin de mise à jour, soit (b) que les déploiements sont modifiés par client de façons que le modèle ne capture pas.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**Les modèles livrés sont le plancher, pas le plafond.** Traitez les sept modèles Panoptica365 comme le point de départ pour n'importe quel client. Construisez les propres modèles du MSP par-dessus ce plancher pour tout besoin régional, réglementaire ou spécifique au client.

**Validez avant de répandre.** Un mauvais modèle importé multiplié à travers trente tenants clients est trente politiques brisées. L'étape d'inspection pré-importation est l'étape la plus importante dans le flux de travail.

**Les modèles personnalisés sont un investissement, pas une victoire gratuite.** Chacun que vous importez demande une maintenance continue. Mieux vaut avoir cinq modèles personnalisés bien maintenus que cinquante périmés.

## Ce qui suit

- **Leçon 9 : Opérer l'AC à l'échelle.** Le closer méta. Comment un ensemble de politiques d'AC évolue avec les années, comment fonctionne la détection de dérive, comment retirer les exclusions proprement, comment le journal d'audit de Panoptica365 rend l'opération à long terme tractable.

Pour l'instant : le flux de travail d'importation de modèles est ce qui transforme le module AC de Panoptica365 d'une bibliothèque de fournisseur en bibliothèque de votre MSP. C'est la différence entre déployer ce qu'on a livré et déployer ce que vos ingénieurs seniors savent de vos clients. Utilisez-le.

---

*Sources des données dans cette leçon — référence d'API Microsoft Graph pour l'exportation/importation de politiques d'accès conditionnel ([Microsoft Learn — Conditional Access policy resource type](https://learn.microsoft.com/en-us/graph/api/resources/conditionalaccesspolicy)); emplacements nommés d'accès conditionnel comme objets référencés ([Microsoft Learn — Conditional Access: Locations](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-assignment-network)); ID d'objets Microsoft Graph à travers les tenants ([Microsoft Learn — Object IDs and properties](https://learn.microsoft.com/en-us/graph/best-practices-concept)).*
