---
title: "Utilisateurs, rôles et accès"
subtitle: "Trois niveaux contrôlés par des groupes Entra : qui peut faire quoi, comment le configurer, et comment c'est appliqué."
icon: "users"
last_updated: 2026-06-07
---

# Utilisateurs, rôles et accès

Panoptica365 ne tient pas sa propre base de mots de passe. Les opérateurs se connectent avec leurs comptes Microsoft, et ce qu'ils ont le droit de faire est décidé par l'**appartenance aux groupes Entra ID** dans votre locataire MSP. Trois groupes, trois niveaux.

## Les trois rôles

**Administrateur** — contrôle complet. Gère les locataires (ajout, modification, suppression), tous les Paramètres, la modification des stratégies d'alerte et le journal d'audit. Le seul rôle qui peut intégrer ou supprimer un locataire.

**Opérateur** — le niveau de travail. Déploie les modèles AC et Intune, applique les paramètres de sécurité, accepte les dérives et crée des exemptions, résout et gère les alertes, relance les analyses IA. Ne peut pas toucher aux Paramètres ni au cycle de vie des locataires.

**Observateur** — lecture seule. Voit les tableaux de bord, les alertes, les rapports, la carte thermique, Apprendre — tout est visible, rien n'est modifiable. Idéal pour les techniciens en formation, les auditeurs ou un écran tourné vers le client.

La connexion elle-même est contrôlée par les mêmes groupes : un compte qui n'est dans aucun des trois groupes ne peut pas se connecter du tout.

## La mise en place

1. Dans l'Entra ID de **votre locataire MSP**, créez trois groupes de sécurité (p. ex. *Panoptica Admins*, *Panoptica Operators*, *Panoptica Viewers*) et ajoutez-y vos gens.
2. Dans **Paramètres → Contrôle d'accès**, collez l'ID d'objet de chaque groupe dans le champ correspondant : **Administrateurs**, **Opérateurs**, **Observateurs**.
3. Cliquez sur le bouton de vérification à côté de chacun — il résout le nom d'affichage du groupe via Graph, ce qui confirme que vous avez collé le bon GUID.
4. Enregistrez. À partir de là, les changements d'appartenance dans Entra prennent effet à la connexion suivante — gérer qui peut faire quoi dans Panoptica365 revient à gérer l'appartenance aux groupes, ce que votre boîte sait déjà faire.

Si un utilisateur se retrouve dans plusieurs groupes, il obtient le niveau le plus élevé auquel il est admissible.

## Comment l'application des règles fonctionne

Deux couches, et il vaut la peine de connaître les deux :

- **L'interface s'adapte.** Votre badge de rôle s'affiche dans la barre latérale; la section Système (Paramètres, Journal d'audit) est masquée pour les non-administrateurs; les boutons réservés aux administrateurs (Ajouter un locataire, Supprimer le client, modification de stratégies) disparaissent ou se désactivent; certains champs s'affichent visibles mais en lecture seule pour les niveaux inférieurs.
- **Le serveur applique.** Chaque point d'API qui modifie quelque chose vérifie le rôle côté serveur. Le bouton masqué n'est pas la frontière de sécurité — le 403 l'est. Et chaque tentative refusée est consignée dans le journal d'audit MSP.

Donc si quelqu'un de votre équipe signale un bouton manquant, vérifiez son appartenance de groupe avant de déclarer un bogue.

## Imputabilité

Chaque action d'opérateur qui compte — déploiements de modèles, changements de paramètres, acceptations de dérive, résolutions d'alertes, cycle de vie des locataires, et ces fameux 403 — est consignée dans le **Journal d'audit** avec l'acteur, l'horodatage et le résultat (voir *Administration du système*). Le modèle de rôles décide qui *peut* agir; le journal d'audit consigne qui *a agi*.

## Conseils pratiques

- **Soyez avare du rôle Administrateur.** L'essentiel du travail quotidien — déployer, accepter, résoudre — est de niveau Opérateur, à dessein. Deux administrateurs suffisent à la plupart des boîtes.
- **Utilisez Observateur délibérément.** C'est une façon sûre de donner de la visibilité aux juniors, aux auditeurs ou à un écran de NOC sans remettre de gâchette à personne.
- **Révisez l'appartenance quand les gens changent de poste** — c'est un groupe Entra comme un autre, et il mérite la même discipline arrivée-mutation-départ que vous appliquez aux locataires de vos clients.
