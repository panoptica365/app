---
title: "Importer vos propres modèles Intune — quand la bibliothèque incluse ne suffit pas"
subtitle: "Comment importer des modèles Intune personnalisés dans Panoptica365 et les déployer sur les tenants clients aux côtés de la bibliothèque incluse."
icon: "upload"
last_updated: 2026-05-29
---

# Importer vos propres modèles Intune — quand la bibliothèque incluse ne suffit pas

La bibliothèque Intune de Panoptica365 livre 14 modèles concentrés sur le durcissement des terminaux Windows, avec des signaux de conformité pour iOS, Android et macOS. C'est délibéré et ça correspond à la réalité PME : la plupart des appareils gérés sont Windows, le mobile est surtout BYOD, macOS est une minorité. Pour le client PME typique, la bibliothèque incluse couvre la surface de configuration critique pour la sécurité.

Mais « PME typique » n'est pas chaque PME. Certains clients ont :

- Une grosse flotte Android Enterprise (compagnies de logistique, entreprises de service sur le terrain) qui a besoin de profils de configuration au-delà du signal de conformité.
- Un environnement majoritairement macOS (agences créatives, ateliers de dev de logiciels) qui a besoin de profils de configuration pour FileVault, gatekeeper, mises à jour de logiciels, déploiement d'apps.
- Des exigences spécifiques à l'industrie qui ont besoin de profils de configuration sur mesure — modes kiosque d'appareils de santé, verrouillage d'étage de fabrication, durcissement de point de vente au détail.
- Des modèles de durcissement matures internes au MSP que le chef TI senior a accordés au fil des années et veut déployés à travers toute la base de clients.
- Des baselines réglementaires (CIS, NIST, spécifiques HIPAA) qui doivent être déployés comme modèles Intune aux côtés de la bibliothèque Panoptica365.

Pour tous ces cas, la réponse est la même : **importer vos propres modèles Intune** dans la bibliothèque de Panoptica365, les déployer à travers les tenants clients de la même façon que les modèles inclus se déploient.

Cette leçon parcourt ce flux — le parallèle de la leçon 8 de la carte 3, adapté pour les particularités spécifiques d'Intune.

## Quand importer un modèle Intune sur mesure

Les mêmes cinq scénarios qui s'appliquaient aux modèles d'AC s'appliquent ici :

**1. Couverture de plateforme que la bibliothèque incluse n'adresse pas.** Profils de configuration Android Enterprise, politiques de configuration d'app iOS, profils de configuration macOS pour FileVault et gatekeeper. Tous existent comme modèles Intune exportables dans n'importe quel tenant où ils ont été construits; ils peuvent être levés dans Panoptica365.

**2. Une configuration de durcissement sur mesure construite chez un client qui devrait être disponible aux autres.** La brillante configuration Windows d'un ingénieur senior pour un secteur d'industrie spécifique (imagerie médicale, gestion de documents légaux, firmes comptables) se fait exporter une fois, généraliser, importer comme modèle, déployer à travers des clients similaires.

**3. Baselines de cadre de conformité.** Mappages CIS Microsoft 365 Foundations Benchmark, contrôles NIST 800-171, durcissement spécifique HIPAA. Ceux-ci existent comme profils de configuration détaillés qui peuvent être déployés via Intune. Construisez-les une fois pour un client qui en a besoin; importez comme modèle; déployez à d'autres clients dans le même panier réglementaire.

**4. Réponse à un incident spécifique ou à un quasi-incident.** Après qu'un client ait vécu un incident de vol d'identifiants, vous construisez un ensemble plus strict de profils de configuration. Vous voudriez ce durcissement disponible pour d'autres clients dans le même profil de risque. L'import, c'est le mécanisme.

**5. Nouvelles menaces qui exigent de nouvelles configurations.** Microsoft annonce une nouvelle technique d'attaque; votre équipe de sécurité construit une configuration Intune qui l'adresse; vous avez besoin de la déployer à travers trente tenants. Construire une fois, importer une fois, déployer trente fois.

Le patron est identique à l'AC : un modèle existe quelque part, vous voulez qu'il existe ailleurs, Panoptica365 rend le transfert traitable.

## Comment l'import fonctionne — particularités Intune

Le flux de haut niveau est direct et délibérément moins magique que son cousin AC. Mettez les attentes honnêtement : il n'y a pas de généralisation automatique des références spécifiques au tenant qui se passe en arrière-plan. Ce que vous exportez est à peu près ce que vous importez.

**Étape 1 : Pointer Panoptica365 vers un tenant source.** Un opérateur MSP choisit n'importe quel tenant auquel la plateforme a accès et tire la configuration Intune via Microsoft Graph. Le tirage produit une représentation JSON structurée des politiques de configuration, politiques de conformité, profils de configuration et modèles Endpoint Security du tenant source — la même forme que les modèles inclus `Panoptica365 - ...`, qui ont eux-mêmes été construits en exportant depuis un tenant source, en nettoyant les références spécifiques au tenant, et en empaquetant le résultat.

**Étape 2 : Choisir quoi importer comme modèle.** De la liste des politiques tirées, l'opérateur choisit celles spécifiques à enregistrer comme modèles Panoptica365. La plupart des exports correspondent un à un — une politique à la source devient un modèle dans Panoptica365. Le choix de *ce qui vaut la peine de transformer en modèle réutilisable* est un jugement; toutes les politiques spécifiques au client ne devraient pas être transformées en modèles.

**Étape 3 : Être conscient de ce qui ne se généralise pas automatiquement.** C'est là qu'Intune est plus douloureux que l'AC. Le flux d'import AC fait la généralisation des emplacements nommés (travail du 23 avril, `project_named_location_generalization`); le flux d'import Intune **ne fait pas** la généralisation équivalente aujourd'hui. Les références qui ne porteront pas proprement à travers les tenants incluent :

- **Références de groupes** — les assignations et exclusions ciblent les groupes de sécurité Entra par GUID. Un groupe avec le même nom dans le tenant B a un GUID différent du tenant A. Un modèle importé qui référence un GUID de groupe du tenant source ne se déploiera pas proprement ailleurs.
- **Références de certificats** — les profils qui référencent des certificats par numéro de série ou empreinte ne portent pas à travers les tenants.
- **Références de filtres** — les filtres d'assignation par plateforme/modèle/fabricant d'appareil sont spécifiques au tenant par GUID.
- **Références de modèles de notification** — pour les politiques de conformité qui déclenchent des notifications utilisateur.

La responsabilité de l'opérateur aujourd'hui, c'est de nettoyer manuellement ces références du modèle importé, ou d'accepter que le modèle aura besoin d'ajustement à chaque tenant de destination avant de pouvoir se déployer.

**Étape 4 : Nommer et décrire le modèle.** Utilisez la convention `nom-MSP - <nom descriptif>`. Les modèles sur mesure devraient être distinguables des modèles inclus `Panoptica365 - ...` dans la liste de politiques déployées du client.

**Étape 5 : Sauvegarder à la bibliothèque.** À partir de ce point, le modèle se comporte comme les modèles inclus pour le déploiement, la détection de dérive et le redéploiement.

## À quoi ressemble la forme d'export

L'export Microsoft Graph qu'Intune produit — et la forme à partir de laquelle les modèles inclus `Panoptica365 - ...` ont été construits — est du JSON structuré. Chaque politique exportée a :

- Un champ `policyType` — `deviceCompliancePolicies`, `configurationPolicies`, `deviceConfigurations`, ou `intents` — identifiant à quelle famille de politique Intune elle appartient.
- Un `name` et une `category` identifiant le but du modèle.
- Soit un objet `policy` (les données de configuration), soit un tableau `settings` (les configurations par paramètre), selon la famille de politique.

Les modèles inclus ont tous été généralisés — ils ne portent pas de GUID de groupes du tenant source, de références de certificats, ou d'autres objets spécifiques au tenant. Ils se déploient proprement à n'importe quel tenant client. Le même travail de généralisation — actuellement manuel — s'applique à tout modèle sur mesure que vous importez.

## Ce qui peut être exporté portablement et ce qui ne peut pas

Vaut la peine d'être explicite sur les limites de portabilité d'Intune :

**Portable proprement :**
- Politiques de catalogue de paramètres (politiques de configuration) — le format moderne, presque tous les paramètres sont portables.
- Politiques de conformité — la structure de la politique est portable; certains paramètres référencent des valeurs spécifiques au tenant qui ont besoin de substitution.
- Modèles Endpoint Security (règles ASR, pare-feu, Defender, Account Protection) — surtout portables; les groupes d'assignation ont besoin de substitution.

**Surtout portables avec des espaces réservés :**
- Profils de configuration (Device Configurations) — type de modèle plus ancien; certaines propriétés s'attachent à des réseaux Wi-Fi spécifiques au tenant, des serveurs VPN, des autorités de certification.
- Politiques de configuration d'app — référencent des apps qui existent comme apps gérées dans le tenant; la référence d'app est portable mais le client doit avoir l'app disponible.

**Difficile ou impossible à porter portablement :**
- **Politiques de protection d'app (APP/MAM).** Référencent des apps spécifiques; leur comportement dépend de la configuration d'identité spécifique au tenant. Demandent souvent une re-création par tenant plutôt que la création de modèle.
- **Modèles qui déploient des certificats** — les certificats sont par nature par tenant. La structure du modèle porte; le certificat lui-même non.
- **Modèles qui référencent des filtres sur mesure** — les filtres d'assignation doivent être créés au tenant de destination avant que le modèle puisse se déployer.
- **Configurations de déploiement d'app** — assigner une app spécifique à un groupe spécifique est surtout par tenant.
- **N'importe quoi qui dépend de l'état d'accès conditionnel** — certaines configurations Intune interagissent avec les politiques d'AC (p. ex., notifications de politique de conformité routées via AC); ces références ont besoin de re-création.

Le flux d'import Panoptica365 ne signale pas les éléments non portables pour vous aujourd'hui — ils passent dans le JSON importé et l'opérateur doit les repérer et les nettoyer manuellement avant de se fier au modèle pour le déploiement entre clients. Les modèles inclus `Panoptica365 - ...` ont subi exactement ce nettoyage manuel quand ils ont été construits; vos imports sur mesure ont besoin de la même discipline.

## Quand *ne pas* importer

Deux cas spécifiques où importer est le mauvais mouvement pour Intune :

**Le modèle est verrouillé à la plateforme.** Un profil de configuration qui cible `windows10` seulement n'aide pas un client sans appareils Windows. L'importer ajoute à la bibliothèque mais ne fournit aucune valeur à ce client. Si vous importez pour la réutilisation entre clients, ciblez sur les plateformes que vos clients ont vraiment.

**Le modèle dépend d'une infrastructure spécifique au tenant qui ne se généralise pas.** Une configuration qui référence un domaine Active Directory sur place spécifique, une autorité de certification spécifique qui émet des certificats d'appareils gérés, une infrastructure Wi-Fi sur place spécifique — ceux-ci ne se généralisent pas. Même après nettoyage manuel, le tenant de destination a besoin de l'infrastructure équivalente pour que le modèle soit utile. Si le tenant source a un AD CS corporatif et la destination est infonuagique-seulement, le modèle ne convient pas.

Pour ces cas, construisez des politiques Intune par tenant directement plutôt que de transformer en modèles.

## La bibliothèque incluse est le plancher, pas le plafond

Le même point qu'à la leçon 8 de la carte 3 : les modèles que Panoptica365 livre sont un point de départ, pas la limite. Le MSP qui prend Intune au sérieux construit ses propres modèles par-dessus la bibliothèque incluse :

- Modèles pour des industries spécifiques (imagerie médicale, légal, comptabilité).
- Modèles pour des cadres de conformité spécifiques (CIS, NIST, HIPAA, SOC 2).
- Modèles pour le durcissement post-incident (déployés après une compromission de client).
- Modèles que l'ingénieur senior a construits pour sa posture de durcissement préférée.

Ces modèles vivent dans l'instance Panoptica365 du MSP, pas dans la distribution du produit Panoptica365. Ils deviennent partie de l'avantage compétitif du MSP — la PI qui distingue un MSP d'un autre.

## Maintenir les modèles importés

Comme les modèles d'AC (leçon 8 de la carte 3), les modèles Intune ont besoin de maintenance :

- **Changements de schéma Microsoft Graph.** Microsoft renomme des propriétés, marque des paramètres comme obsolètes, en ajoute des nouveaux. Les modèles importés peuvent avoir besoin de mise à jour.
- **Changements dans l'environnement client.** La configuration de tenant d'un client évolue; les modèles qui fonctionnaient parfaitement il y a six mois peuvent avoir besoin d'ajustement.
- **Divergence modèle-vs-politique-déployée.** Les ajustements par tenant par les admins individuels font dériver le déploiement de la référence du modèle.

Le détecteur de dérive de Panoptica365 couvre les modèles inclus; les modèles sur mesure ont besoin que le MSP vérifie périodiquement. Le coût de maintenance est réel — importer 20 modèles sur mesure veut dire s'engager à maintenir 20 modèles.

## Déploiement pour un modèle Intune sur mesure

Déploiement au groupe pilote, comme les modèles inclus, avec une réserve supplémentaire : les modèles importés sont souvent **moins testés** que ceux inclus. Ils sont venus de l'expérience d'un seul tenant; ils peuvent ne pas avoir été validés à travers la variation d'environnements que les clients représentent.

1. **Inspection pré-import.** Auditer le modèle source. Est-il propre? Bien accordé? À jour? Des références codées en dur qui ne transféreront pas? Régler les enjeux à la source.
2. **Importer.** Généraliser les références, sauvegarder comme modèle.
3. **Premier déploiement à un seul tenant**, avec déploiement au groupe pilote à l'intérieur de ce tenant. Traiter le premier client comme le pilote plus large pour ce modèle.
4. **Jours 1 à 14** — vérifier que le modèle se comporte comme attendu. Signaux de conformité corrects, configurations qui s'appliquent, pas d'impact utilisateur inattendu.
5. **Jour 14+** — si le premier déploiement client est propre, étendre à plus de tenants clients. Chaque déploiement client subséquent est plus rapide (le modèle est validé).

Une fois qu'un modèle sur mesure a été déployé à travers 3 à 5 tenants clients avec succès, traitez-le comme validé en production et continuez à l'utiliser avec une discipline de déploiement normale.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**La bibliothèque incluse est le plancher.** Traitez les 14 modèles Panoptica365 comme le point de départ pour n'importe quel client. Construisez par-dessus avec des imports pour tout ce que le client a besoin que le plancher ne couvre pas.

**Les imports Intune ont plus de types d'espaces réservés que les imports AC.** Références de groupes, références de certificats, références de filtres, modèles de notification. Le travail de généralisation est plus impliqué. Allouez plus de temps pour le premier import de n'importe quel type de modèle donné.

**Validez avant de mettre à l'échelle.** Un mauvais modèle importé déployé à travers trente tenants clients, ce sont trente déploiements brisés. Pilote premier-client, valider, puis étendre.

## Ce qui suit

- **Leçon 11 : Opérer Intune à l'échelle.** Le finale. Dérive, exclusions, cycle de vie, le problème de perte d'assignation.

Pour l'instant : le flux d'import est ce qui transforme le module Intune de Panoptica365 de « ce qu'on a livré » à « ce que votre MSP connaît ». Utilisez-le pour les brèches de couverture de plateforme, les modèles de cadre de conformité, le durcissement spécifique à l'industrie, les configurations curées par l'ingénieur senior.

---

*Sources des données dans cette leçon — API Microsoft Graph pour les politiques de configuration Intune ([Microsoft Learn — Intune Graph API reference](https://learn.microsoft.com/en-us/graph/api/resources/intune-graph-overview)); export et import de politique de catalogue de paramètres ([Microsoft Learn — Settings catalog](https://learn.microsoft.com/en-us/mem/intune/configuration/settings-catalog)); type de ressource de politique de conformité ([Microsoft Learn — deviceCompliancePolicy](https://learn.microsoft.com/en-us/graph/api/resources/intune-shared-devicecompliancepolicy)); références de modèles de politique Endpoint Security ([Microsoft Learn — Endpoint security policies](https://learn.microsoft.com/en-us/mem/intune/protect/endpoint-security-policy)).*
