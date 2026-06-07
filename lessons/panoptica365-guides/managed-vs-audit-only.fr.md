---
title: "Locataires gérés ou audit seulement"
subtitle: "La seule décision à prendre avant de consentir : surveillance complète pour toujours, ou instantané en lecture seule qui expire."
icon: "scale"
last_updated: 2026-06-07
---

# Locataires gérés ou audit seulement

Quand vous ajoutez un locataire, le tout premier choix — avant même d'accorder le consentement — est son mode. Tranchez correctement dès le départ, parce que la conversion ne fonctionne que dans un sens.

## Géré

**Géré** est le mode normal pour un client payant. Il vous donne l'ensemble complet des fonctionnalités Panoptica365 :

- Interrogation planifiée à l'intervalle de votre choix.
- Alertes, détection de dérive et analyse IA.
- La capacité de **pousser** des stratégies AC, des stratégies Intune et des paramètres de sécurité vers le locataire.
- L'inclusion dans les vues de parc (Carte thermique, Activité quotidienne) et le résumé quotidien.

Un locataire géré persiste indéfiniment — jusqu'à ce qu'un Administrateur le supprime.

## Audit seulement

**Audit seulement** est conçu pour les évaluations de vulnérabilité et la découverte de prospects. Voyez-le comme une photographie à durée limitée d'un locataire que vous ne gérez pas (encore) :

- **Collecte d'instantanés en lecture seule pour exportation.** Panoptica365 lit la configuration du locataire pour que vous puissiez l'examiner et générer des rapports.
- **Aucune alerte, aucune détection de dérive, aucune écriture** vers le locataire client. Rien n'est poussé, rien ne se déclenche à 2 h du matin.
- **Expiration automatique.** Le locataire est programmé pour expirer **14 jours après sa création**, et la suppression définitive survient **7 jours après**. Le tableau des Locataires affiche un badge de compte à rebours (p. ex. *AUDIT · 9j restants*), et la fenêtre de modification montre la date d'expiration exacte.

Cette expiration est volontaire : vous ne devriez pas conserver indéfiniment les données de configuration d'un prospect sans mandat.

## Convertir d'un mode à l'autre

- **Audit seulement → Géré : permis.** Le scénario typique — vous avez mené une évaluation, le prospect a signé, vous le gérez maintenant. Un Administrateur ouvre la fenêtre de modification du locataire et bascule **Mode** à Géré. L'expiration est retirée et la surveillance complète commence.
- **Géré → Audit seulement : interdit.** C'est une porte à sens unique. Un locataire géré possède un historique d'alertes, des modèles déployés, des références et un historique des changements qui n'ont aucun sens dans un contenant en lecture seule à durée limitée.

## Conseils pratiques

- Un prospect demande une évaluation de sécurité? **Audit seulement.** Menez-la, générez un rapport Évaluation rapide ou Documentation de configuration, et laissez les données expirer (ou convertissez s'il signe).
- Nouveau client sous contrat? **Géré**, dès le premier jour.
- Pas certain? **Audit seulement** — vous pourrez toujours convertir vers le haut. L'inverse exige de supprimer le locataire et de le réintégrer.

Une dernière note : supprimer un locataire (peu importe le mode) retire définitivement **toutes** ses données — alertes, instantanés, paramètres de sécurité, affectations AC, audits et historique des changements. La fenêtre de confirmation est sérieuse.
