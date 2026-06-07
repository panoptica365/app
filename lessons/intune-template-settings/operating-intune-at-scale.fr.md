---
title: "Opérer Intune à l'échelle — dérive, exclusions, cycle de vie, le problème de perte d'assignation"
subtitle: "Le patron opérationnel le plus coûteux dans Intune : comment supprimer-et-recréer abandonne silencieusement les exclusions par tenant, et comment l'éviter."
icon: "settings-2"
last_updated: 2026-05-29
---

# Opérer Intune à l'échelle — dérive, exclusions, cycle de vie, le problème de perte d'assignation

Un MSP en croissance a découvert à la fin de 2025 que 12 de ses clients avaient silencieusement perdu leurs groupes d'exclusion par tenant sur le modèle Intune Account Protection. Les exclusions avaient été soigneusement configurées — appareils kiosque exclus pour qu'ils ne reçoivent pas d'invites Windows Hello qu'ils ne pouvaient pas satisfaire, comptes de service spécifiques exclus des politiques qui auraient brisé leurs flux. Puis quelqu'un a mis à jour le modèle Account Protection dans Panoptica365 — modernisé quelques paramètres, ajouté une nouvelle exigence — et poussé la mise à jour. La mise à jour a redéployé le modèle à travers tous les clients. Le comportement sous-jacent du modèle de style Intents, c'est supprimer-et-recréer. Les anciennes configurations d'exclusion par tenant ont été silencieusement abandonnées.

Personne n'a remarqué pendant six semaines. À ce moment-là, plusieurs clients avaient rapporté des verrouillages d'utilisateurs inexpliqués sur des appareils qui n'auraient pas dû être dans la portée.

C'est le patron opérationnel le plus coûteux dans Intune. La solution n'est pas difficile; la conscience l'est. Cette leçon est le finale de la carte 4 — comment opérer Intune à l'échelle, ce que la dérive veut dire ici, comment les exclusions se décomposent, et le problème de perte d'assignation qui a été nommé dans chaque leçon mais mérite un traitement explicite.

## Le problème de perte d'assignation, au complet

La leçon 1 de la carte 4 a introduit ça; ça mérite un traitement complet.

Les modèles Intune viennent dans trois familles de types de modèles : catalogue de paramètres (`configurationPolicies`), Endpoint Security Intents (`intents`), et plus anciens Device Configurations (`deviceConfigurations`). Quand Panoptica365 déploie une mise à jour de modèle à travers les tenants clients, le comportement sous-jacent diffère par type :

- **Politiques de catalogue de paramètres** — mise à jour sur place via Graph API PATCH. L'ID de la politique reste le même; les assignations sont préservées. Sûr.
- **Device Configurations** — habituellement mise à jour sur place. Surtout sûr.
- **Modèles Intents / Endpoint Security** — *supprimer-et-recréer*. L'ancienne politique est retirée et une nouvelle est créée. Toutes les exclusions d'assignation par tenant configurées contre l'ancien ID de politique ne sont pas transférées — elles sont silencieusement perdues.

Des 14 modèles dans la bibliothèque Panoptica365, ce comportement supprimer-et-recréer affecte **Account Protection Settings** spécifiquement (le seul modèle de style Intents dans la bibliothèque). Il affecte aussi tout modèle de style Intents importé que le MSP ajoute (leçon 10).

Microsoft a travaillé sur la transition des modèles Endpoint Security vers un vrai modèle PATCH plutôt que supprimer-recréer, mais en mi-2026 le comportement persiste. Jusqu'à ce que Microsoft règle l'API sous-jacente, la responsabilité de l'opérateur est de contourner ça manuellement.

La discipline opérationnelle :

**Avant de mettre à jour n'importe quel modèle de style Intents à travers la flotte :**
1. Capturer les assignations courantes par tenant pour le modèle en ouvrant le portail Intune de chaque client affecté et en enregistrant les groupes d'assignation + d'exclusion manuellement. Il n'y a pas de vue de déploiement à l'échelle de la flotte dans Panoptica365 aujourd'hui, donc c'est du travail de clic-clic par client.
2. Noter spécifiquement les exclusions non par défaut. L'assignation standard « Tous les appareils » se redéploiera correctement; les exclusions par client sur mesure, c'est ce qui se perd.

**Après la mise à jour :**
3. Vérifier les assignations sur chaque tenant client affecté.
4. Pour n'importe quel client où les exclusions manquent, les restaurer manuellement.

C'est agaçant, et il n'y a pas de raccourci automatisé aujourd'hui — mettre à jour en lot les modèles de style Intents à travers une flotte sans l'étape manuelle capture-et-rejeu, c'est un canon-à-pied. Jusqu'à ce que Microsoft remplace le comportement supprimer-recréer, le flux manuel est le seul chemin sûr.

Pour l'opérateur typique, le point pratique à retenir : **avant de pousser n'importe quelle mise à jour au modèle Account Protection** (ou n'importe quel modèle de style Intents importé), inventoriez les exclusions des clients affectés. Ne mettez pas à jour en lot les modèles de style Intents sans l'étape de rejeu.

## Détection de dérive sur les modèles Intune

Comme l'AC, les modèles Intune dérivent au fil du temps. Les catégories de dérive sont similaires mais les modes d'échec diffèrent :

**Dérive d'état** — l'état de déploiement d'un modèle a changé de façon inattendue. Moins fréquent dans Intune que dans l'AC (Intune n'a pas d'équivalent Report-only qui peut basculer de la même façon) mais possible : un autre admin du client peut avoir supprimé une politique entièrement, ou avoir mis sa portée d'assignation si étroitement qu'elle ne s'applique plus à personne.

**Dérive de portée** — la portée d'assignation a changé. Nouveaux groupes d'inclusion ajoutés, groupes d'exclusion ajoutés, groupes retirés. C'est la catégorie de dérive la plus conséquente pour Intune parce que changer la portée peut changer dramatiquement quels appareils la politique affecte. Un autre admin du client qui ajoute un large groupe d'exclusion peut effectivement désactiver la politique sans la désactiver formellement.

**Dérive de paramètre** — des paramètres individuels à l'intérieur d'un modèle ont changé. Un paramètre spécifique a été accordé par client (un chemin d'exclusion Defender ajouté, une règle de pare-feu ajustée, un minimum de NIP Windows Hello assoupli). Ce sont les personnalisations légitimes par client qui *devraient* dériver — mais l'opérateur a besoin de savoir.

**Dérive de valeur de configuration** — la valeur d'une politique de catalogue de paramètres pour un paramètre spécifique a été changée centralement (l'admin d'un client a cliqué à travers et modifié une valeur spécifique). Le plus difficile à détecter manuellement parce que la politique semble encore « correcte » à un haut niveau; seule la comparaison paramètre par paramètre l'attrape.

Le détecteur de dérive de Panoptica365 couvre les quatre catégories pour les 14 modèles inclus. Pour les modèles sur mesure importés (leçon 10), la responsabilité de l'opérateur inclut de vérifier que la détection de dérive fonctionne — Panoptica365 fait remonter la dérive pour les modèles dont il a une référence; si un modèle sur mesure a été importé dans Panoptica365 correctement, la référence est capturée et la détection de dérive fonctionne automatiquement.

Le flux opérateur pour les alertes de dérive :

1. **Accuser réception de l'alerte** et identifier le type (état / portée / paramètre / valeur).
2. **Identifier la cause via le journal d'audit.** Qui a fait le changement, quand, depuis quel rôle.
3. **Décider : accepter ou revenir.**
   - Personnalisation par client légitime? Accepter et mettre à jour la référence (ou accepter que le client a sa propre variante).
   - Changement non autorisé ou modification accidentelle? Revenir à la référence du modèle.
4. **Documenter la décision** dans le journal de changement du client (Panoptica365 fait ça automatiquement).

## Exclusions — le problème persistant de décomposition

Tout comme l'AC, les exclusions Intune s'accumulent silencieusement. Le mécanisme qui prévient ça :

**Chaque exclusion a une date d'extinction.** Quand un opérateur ajoute un appareil ou un groupe à la liste d'exclusion d'un modèle Intune, Panoptica365 invite à une justification et une date d'expiration. L'expiration par défaut est 180 jours; l'opérateur peut ajuster.

**Chaque exclusion est revue avant l'expiration.** Panoptica365 alerte l'opérateur responsable avant la date d'extinction. Revue : encore nécessaire? Renouveler avec une justification fraîche? Ou la laisser expirer et ramener l'appareil dans la portée?

**Les exclusions basées sur les groupes sont auditées périodiquement.** Exclure « Appareils Kiosque » (un groupe Entra) veut dire que n'importe qui ajouté à ce groupe plus tard hérite de l'exclusion. L'appartenance au groupe peut changer sans que le modèle change. Des audits périodiques de l'appartenance au groupe font partie de la discipline.

Les patrons à éviter :

- « Exclusion permanente » sans expiration. Rien n'est permanent; les modèles changent, les appareils changent, les règlements changent. Les exclusions permanentes deviennent des brèches de sécurité invisibles.
- « Exclure le département TI pour la commodité. » Si vous excluez les admins d'une politique de durcissement parce qu'ils la trouvent agaçante, vous avez inversé le modèle de sécurité — les admins sont les cibles à plus haute valeur et ont besoin de *plus* de durcissement, pas moins.
- « Exclure un appareil pour un incident spécifique, jamais ré-inclure. » Un appareil exclu pour une raison technique temporaire reste souvent exclu pour toujours parce que personne ne se souvient de la raison.

Le flux d'exemption de Panoptica365 rend l'ajout d'exclusions légèrement plus difficile que de les ignorer. Cette friction est intentionnelle — elle rend les mauvais patrons plus difficiles à commettre que les bons.

## Cycle de vie — comment les modèles Intune évoluent

Le déploiement Intune d'un client évolue comme son entreprise évolue. Événements qui devraient déclencher une revue des modèles Intune :

- **Nouvelle plateforme d'appareils introduite.** Le client acquiert une flotte Mac pour une équipe créative. Les modèles macOS ont besoin d'attention.
- **Mise à jour de fonctionnalité Windows majeure.** Windows 11 25H2 change les défauts de certains paramètres; les modèles peuvent avoir besoin d'ajustement pour appliquer les comportements précédents.
- **Nouveau cadre de conformité.** Le client signe un contrat qui exige la conformité CIS Microsoft 365 Foundations; a besoin de modèles alignés CIS importés.
- **Bureaux qui déménagent ou l'entreprise qui s'agrandit.** Nouvelles plages IP de confiance, nouveaux endpoints VPN, nouvelles apps d'affaires qui ont besoin d'être sur la liste d'autorisation.
- **Réponse à incident.** Post-compromission, la posture Intune du client se durcit typiquement.
- **Le client se réduit ou fusionne.** La population d'appareils change; les anciens modèles peuvent avoir besoin de nettoyage.
- **Microsoft retire ou remplace une fonctionnalité.** Microsoft a tranquillement retiré des types de politiques Intune plus anciens en faveur du catalogue de paramètres. Les modèles peuvent avoir besoin de migration.

Pour chaque client, une **revue annuelle d'Intune** est la bonne cadence :

1. Lister tous les modèles Intune déployés par client.
2. Pour chaque modèle : encore approprié? Encore nécessaire? Paramètres encore corrects?
3. Réviser les listes d'exclusions. Chaque entrée : encore nécessaire? Date d'extinction encore appropriée?
4. Réviser l'historique de dérive. Y a-t-il eu des changements dans la dernière année qui n'ont pas été pleinement résolus?
5. Comparer avec la bibliothèque incluse Panoptica365 courante. Modèles que le client devrait déployer mais ne déploie pas? Nouveaux modèles ajoutés depuis la dernière revue?
6. Documenter la revue.

C'est la même cadence de revue annuelle que la leçon 9 de la carte 3 recommandait pour l'AC. Mêmes principes s'appliquent : c'est une discipline opérationnelle, pas optionnelle, facturable au client comme partie du service de sécurité.

## Dépendances de licence

Certaines fonctionnalités Intune exigent Intune Plan 2 (E3 ou E5) plutôt qu'Intune Plan 1 (Business Premium). Pour la bibliothèque incluse Panoptica365, les modèles fonctionnent à Intune Plan 1 — ils ont été curés pour entrer dans la portée Business Premium. Mais certaines fonctionnalités avancées que le MSP pourrait importer ne fonctionnent pas :

- **Endpoint Privilege Management (EPM)** — contrôle d'élévation admin local. Exige Intune Plan 2 / E5.
- **Remote Help** — support à distance intégré Intune. Exige Intune Plan 2 / E5.
- **Endpoint Analytics avancé** — télémétrie plus profonde. Exige Intune Plan 2 / E5.
- **Intégration Mobile Threat Defense** — partenaires MTD tiers. Exige Intune Plan 1 minimum mais la configuration varie.

Quand vous importez des modèles sur mesure qui dépendent de ces fonctionnalités, vérifiez que le tenant de destination a la licence. Déployer une fonctionnalité Plan 2 à un tenant Plan 1 produit un échec silencieux — la politique existe mais ne peut pas s'activer.

## Ce que Panoptica365 fait remonter

Il n'y a pas de vue unique « opérer à l'échelle » dans Panoptica365 aujourd'hui qui agrège la flotte à travers les clients — soyez honnête avec votre équipe à ce sujet et ne promettez pas ça à vos clients. Le modèle de lecture de la plateforme est par tenant, et le flux à-l'échelle de l'opérateur aujourd'hui est un mélange de trois choses :

- **Alertes de dérive par modèle par client.** La détection de dérive tourne à travers les modèles déployés; quand le tenant d'un client diverge de la référence incluse (ou importée), une alerte se déclenche. C'est le principal signal « quelque chose a changé quelque part à travers ma flotte » que Panoptica365 fournit aujourd'hui.
- **La section Exemptions.** Quand un opérateur a approuvé des exemptions à travers les tenants clients, la vue Exemptions les liste avec l'option de révoquer. Ce n'est pas une file « en attente de revue » — c'est un dossier de ce qui a été accordé. La discipline de l'opérateur d'ouvrir ça périodiquement et de demander « est-ce que tout ça est encore défendable? », c'est ce qui transforme ça en flux d'extinction.
- **Tableaux de bord par tenant, un à la fois.** Tuile de compte de conformité, liste d'appareils, Appareils par OS — la même surface que la leçon 9 a décrite. Pour faire une revue « à l'échelle » aujourd'hui, l'opérateur clique à travers les tenants un par un.

Ce qui *n'existe pas* aujourd'hui, au cas où le reste de cette leçon vous aurait fait l'attendre :

- Une agrégation « conformité de flotte » entre clients
- Une vue matrice « état de déploiement de modèle par client par modèle »
- Une chronologie « activité de déploiement récente à travers tous les clients »
- Une liste « appareils dans des états de conformité problématiques »
- Une file de revue d'exclusions avec dates d'extinction

Les flèches de tendance de la tuile de conformité donnent à l'opérateur un signal directionnel par sondage — utile pour attraper la dérive de posture rapidement sans se souvenir du chiffre d'hier. Pour l'instant, c'est le niveau de visibilité entre clients que Panoptica365 fournit; une agrégation plus profonde demande le clic-clic par tenant décrit plus haut.

## La revue annuelle Intune — cadence recommandée

Pour chaque client, une fois par an (communément synchronisée avec la revue annuelle de sécurité et la conversation de renouvellement) :

1. **Lister tous les modèles Intune déployés.** Ce qui est activé, ce qui est déployé en mode audit, ce qui a été déployé mais n'est pas activement en usage.
2. **Pour chaque modèle, vérifier qu'il est encore approprié.** Conditions correspondent à la réalité courante du client? Exclusions encore défendables?
3. **Réviser l'historique de dérive.** Qu'est-ce qui a changé dans la dernière année? Chaque changement a-t-il été correctement résolu (accepté avec référence mise à jour, ou annulé)?
4. **Comparer avec la bibliothèque Panoptica365 courante.** Modèles inclus qui devraient être déployés mais ne le sont pas (nouvellement ajoutés, récemment mis à jour)?
5. **Comparer avec l'état courant du client.** L'environnement du client a-t-il changé (nouvelles plateformes, nouvelles licences, nouvelles obligations réglementaires) de façons qui suggèrent de nouveaux modèles?
6. **Documenter la revue.** Le directeur TI du client devrait avoir un dossier de la revue annuelle et ses conclusions.

C'est de la discipline opérationnelle. C'est le travail qui empêche la posture Intune du client de se décomposer au fil des années. C'est facturable comme partie du service de sécurité du MSP — et c'est ce qui différencie un MSP soigné de celui qui déploie et oublie.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**Le problème de perte d'assignation est le piège opérationnel le plus conséquent dans Intune.** Account Protection Settings (et n'importe quel modèle de style Intents importé) demande la discipline inventaire-mise-à-jour-rejeu. La sauter, c'est comme ça que les exclusions client s'évaporent sans que personne ne remarque.

**Les listes d'exclusions sont une dette silencieuse.** Elles s'accumulent, elles se décomposent, elles deviennent des brèches de sécurité invisibles. Le flux d'exemption avec des dates d'extinction est l'outil pour combattre ça; utilisez-le.

**La revue annuelle n'est pas négociable.** Les modèles Intune qui étaient appropriés il y a trois ans peuvent ne pas être appropriés aujourd'hui. Sans une cadence de revue structurée, la posture Intune du client se décompose. Facturez la revue; documentez-la; rendez-la visible au client.

## Fermeture de la carte 4

Vous avez maintenant vu les 14 modèles Intune Panoptica365 et les mécaniques opérationnelles qui les transforment en pratique de durcissement de terminal fonctionnelle.

L'arc de la carte 4 :

1. Pré-déploiement pour les modèles Intune — la discipline avant n'importe quel déploiement.
2. Politiques de conformité — définir « conforme » à travers quatre plateformes.
3. Le Security Baseline — votre ensemble curé de durcissement Windows.
4. BitLocker Settings — posture de chiffrement de disque.
5. Configuration Defender for Endpoint — Windows + macOS.
6. Firewall Settings — défense réseau Windows.
7. Règles ASR + Block mshta.exe — réduction de surface d'attaque.
8. Account Protection + Block MSA — durcissement des identifiants sur le terminal.
9. La boucle de conformité en production — dérive, signaux, surveillance.
10. Importer vos propres modèles Intune — le flux de personnalisation.
11. Opérer Intune à l'échelle — dérive, exclusions, cycle de vie, le problème de perte d'assignation (cette leçon).

La carte 5 (durcissement Exchange / courriel) commence ensuite. Cette carte déplace le focus du terminal à la surface courriel — les paramètres EXO qui protègent le canal que les attaquants utilisent le plus.

Pour l'instant : les modèles de la carte 4 vous ont donné la fondation de durcissement côté Windows. La boucle de conformité signale dans l'AC. La posture de terminal du client passe du défaut d'usine à vraiment durci avec la bibliothèque incluse déployée. Le MSP qui réussit ça ferme la plus grande avenue d'attaque unique contre les flottes Windows PME.

---

*Sources des données dans cette leçon — Microsoft Learn sur les types de politiques Intune et le comportement de mise à jour ([Microsoft Learn — Intune policy types](https://learn.microsoft.com/en-us/mem/intune/configuration/device-profiles)); modèles Endpoint Security et leur modèle de mise à jour ([Microsoft Learn — Endpoint security policy](https://learn.microsoft.com/en-us/mem/intune/protect/endpoint-security-policy)); exigences de licence Intune par fonctionnalité ([Microsoft Learn — Intune licensing](https://learn.microsoft.com/en-us/mem/intune/fundamentals/licenses)); API Microsoft Graph pour l'assignation de politique ([Microsoft Learn — Assignment resource type](https://learn.microsoft.com/en-us/graph/api/resources/intune-shared-deviceconfigurationassignment)).*
