---
title: "Déployez des stratégies d'accès conditionnel"
subtitle: "Affectez des modèles de votre bibliothèque, déployez-les sur le locataire, et laissez la détection de dérive les garder par la suite."
icon: "key-round"
last_updated: 2026-06-15
---

# Déployez des stratégies d'accès conditionnel

L'accès conditionnel est l'endroit où Panoptica365 cesse d'être une caméra pour devenir un garde-fou. Vous maintenez une **bibliothèque de modèles** de stratégies AC (barre latérale → **Stratégies AC**), vous affectez des modèles aux locataires, vous les déployez, et Panoptica365 surveille ensuite les stratégies actives pour détecter toute dérive — pour toujours.

**Avant votre premier vrai déploiement, lisez la leçon sur la *liste de vérification pré-déploiement* dans la carte Accès conditionnel d'Apprendre.** Les comptes bris de glace et l'inventaire des comptes de service ne sont pas optionnels. Une stratégie AC déployée à la hâte peut verrouiller un client entier dehors.

## Affecter des modèles à un locataire

1. Ouvrez le tableau de bord du locataire → onglet **Stratégies AC**. Sur un locataire neuf, vous verrez *« Aucun modèle de stratégie CA assigné à ce locataire pour le moment. »*
2. Cliquez sur **Affecter un modèle**. Un sélecteur liste votre bibliothèque de modèles (moins tout ce qui est déjà affecté).
3. Cochez les modèles voulus — ou **Tout sélectionner** — et confirmez.

Chaque affectation devient une carte sur l'onglet montrant le nom du modèle, un badge d'état de dérive, les contrôles **Octroi**, les cibles **Utilisateurs** et **Applications**, une liste déroulante d'acheminement des **Alertes** (courriel, PSA, les deux ou aucun — par affectation), et **Dernière vérification**.

## Déployer

Un modèle affecté n'est pas encore actif. Sur la carte d'affectation :

- **Déployer** — crée la stratégie active dans le locataire à partir du modèle. Les espaces réservés propres au locataire (comme les emplacements nommés) sont résolus au moment du déploiement.
- **Vérifier la dérive** — compare la stratégie active au modèle immédiatement, sur demande (le cycle de dérive planifié le fait aussi en continu).

Déployez d'abord en **mode rapport seul** quand le modèle est conçu ainsi, observez l'impact sur les connexions, puis basculez à Activé — cette discipline est couverte dans les leçons AC.

## La dérive : les badges

Chaque carte d'affectation porte un badge d'état :

- **ok** — la stratégie active correspond au modèle.
- **en dérive** — quelque chose a changé dans le locataire; la stratégie ne correspond plus.
- **acceptée** — une dérive existe, mais un opérateur l'a examinée et acceptée.
- **manquante** — la stratégie n'existe pas dans le locataire (supprimée, ou jamais déployée).
- **non vérifiée** — pas encore comparée.

Quand une dérive est détectée, vous recevez aussi une **alerte** par l'acheminement que vous avez choisi, avec l'analyse IA jointe. Le journal de dérive sur la carte montre la chronologie : quel champ a changé, attendu vs réel, événements de désactivation ou de suppression, et remédiations.

## Répondre à une dérive

Vous avez trois options honnêtes :

1. **Pousser le modèle** (aussi affiché comme **Corriger**) — écrase la stratégie active avec le modèle. **Avertissement, et le bouton est sérieux :** ceci efface les `excludeUsers` / `excludeGroups` propres au locataire qui ont été ajoutés directement dans le locataire. Si ces exclusions sont légitimes, elles doivent vivre dans le modèle ou comme exemptions, pas comme modifications faites côté console Microsoft.
2. **Accepter la dérive.** Cliquer sur une stratégie en dérive ouvre **Accepter la dérive de la stratégie CA**, qui montre attendu vs réel par champ, avec deux chemins :
   - **Accepter avec expiration** *(recommandé)* — la dérive est acceptée jusqu'à la date de votre choix (180 jours par défaut), un **motif est obligatoire**, et les principaux exclus sont transférés dans la table des **Exemptions** pour que les évaluateurs d'alertes les ignorent jusqu'à l'expiration. Limité dans le temps, documenté, vérifiable.
   - **Accepter une fois, pour toujours** — accepté indéfiniment; ne se redéclenche que si la signature de la dérive change. À utiliser avec parcimonie.
3. **Mettre à jour le modèle** — si le changement est en fait le bon pour tous les locataires, corrigez à la source dans la bibliothèque Stratégies AC.

## Adopter les paramètres existants sur place (issus du locataire)

Il arrive que vous intégriez un locataire qui possède **déjà** ses propres stratégies d'accès conditionnel — des stratégies que vous n'avez pas poussées depuis votre bibliothèque. Vous n'êtes pas obligé d'imposer vos modèles dès le premier jour. **Importer les paramètres existants** vous permet d'adopter ce qui est déjà là et de le surveiller d'abord — une étape délibérée « surveiller ce qui est ici, ne rien imposer pour l'instant ».

Sous l'onglet **Stratégies AC**, cliquez sur **Importer les paramètres existants**. Panoptica lit les stratégies AC en vigueur dans le locataire et crée une carte pour chacune qu'il ne gère pas déjà, marquée **Issu du locataire** (bordure gauche rouge et badge) afin de les distinguer de vos modèles déployés. Il enregistre l'état actuel de chaque stratégie comme état initial et surveille les changements à partir de là.

Quelques points à savoir :

- **Aucun doublon.** Les stratégies que vous avez déjà déployées à partir d'un modèle sont reconnues par leur identifiant d'objet et ignorées — même si vous les avez renommées dans le locataire. Le bouton reste disponible, et recliquer est sans risque : seuls les paramètres réellement nouveaux sont adoptés.
- **Les stratégies gérées par Microsoft** sont aussi adoptées, signalées comme telles. Là où Microsoft refuse une modification, l'action se dégrade proprement (« géré par Microsoft, ne peut pas être modifié ici ») au lieu d'échouer. Les **paramètres de sécurité par défaut** ne sont *pas* une stratégie — ils sont affichés comme un simple indicateur activé/désactivé, jamais comme une carte.
- **Dérive par rapport à l'état initial.** L'alerte d'une carte issue du locataire indique *« modifié par rapport à l'état initial »* — et non « s'écarte de votre standard », car il n'y a pas encore de modèle derrière. La surveillance quotidienne détecte les changements; une toute nouvelle stratégie AC créée directement dans la console est détectée en quelques minutes.

### Ce que vous pouvez faire avec une carte issue du locataire

Ouvrez les **Actions** d'une carte pour trois choix distincts :

1. **Arrêter la surveillance** — retire la carte et cesse de la surveiller. **Cela ne modifie jamais le locataire** — c'est une action propre à Panoptica.
2. **Désactiver dans le locataire** — désactive la stratégie de façon réversible (la met à *désactivée*). La carte demeure, marquée Inactive, et **Restaurer** la remet exactement en place. Par défaut, une carte désactivée n'alerte que si quelqu'un la réactive en dehors de Panoptica.
3. **Supprimer du locataire** — retire définitivement la stratégie du locataire. La confirmation est proportionnée au risque : la suppression vous demande de saisir votre propre nom.

Chacune de ces actions est consignée dans le journal d'audit et dans le journal des modifications du locataire, avec votre nom et le nom de la stratégie.

### Surveiller ce qui apparaît plus tard

Au-delà de l'adoption, Panoptica surveille **chaque** locataire — avec ou sans modèles — pour détecter une stratégie AC qui apparaît **en dehors de Panoptica** (créée directement dans la console Entra). Lorsqu'elle surgit, elle devient une carte issue du locataire et déclenche une alerte *« configuration créée en dehors de Panoptica »*, afin qu'un changement effectué hors de votre processus ne passe pas inaperçu. À mesure que vous déployez ensuite vos propres standards, vous pouvez désactiver ou supprimer les stratégies natives encombrantes — ou simplement continuer à les surveiller.

## Note d'exploitation

La dérive sur une stratégie AC est l'une des alertes les plus précieuses que la plateforme produit. Un technicien de centre d'assistance qui exclut « temporairement » un utilisateur de l'AMF, c'est exactement comme ça que les brèches commencent — et exactement ce que ceci attrape. Ne vous entraînez pas à accepter les dérives par réflexe; chaque acceptation devrait avoir un motif que vous seriez à l'aise de relire dans le journal d'audit un an plus tard.
