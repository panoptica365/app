---
title: "Ajoutez votre premier locataire"
subtitle: "Le flux de consentement administrateur du début à la fin : quel compte utiliser, ce qui est accordé, et ce qui se passe ensuite."
icon: "building-2"
last_updated: 2026-06-07
---

# Ajoutez votre premier locataire

Tout dans Panoptica365 commence par l'intégration d'un locataire. Le flux prend environ deux minutes de clics, plus quelques minutes de collecte de données en arrière-plan.

## Avant de commencer

Il vous faut deux choses :

- Le rôle **Administrateur** dans Panoptica365 (le bouton **Ajouter un locataire** est réservé aux administrateurs).
- Des identifiants capables d'accorder le consentement administrateur **sur le locataire du client** — soit un **compte Administrateur général dans ce locataire**, soit un compte doté d'une **relation GDAP** avec des droits suffisants pour consentir en son nom. Le point clé : quand Microsoft vous demande de vous connecter, utilisez les identifiants qui ont accès au locataire *cible* — pas votre propre locataire MSP, sauf si c'est lui que vous intégrez.

## Étape par étape

1. Allez dans **Locataires** dans la barre latérale.
2. Cliquez sur **Ajouter un locataire** (en haut à droite).
3. La fenêtre **Ajouter un locataire** s'ouvre et vous demande de choisir un mode : **Géré** ou **Audit seulement**. En bref : Géré offre l'ensemble complet des fonctionnalités — interrogation planifiée, alertes, détection de dérive, capacité de pousser des paramètres AC / Intune / sécurité — et persiste indéfiniment. Audit seulement est un instantané en lecture seule pour les évaluations et les prospects, supprimé automatiquement après 14 jours plus une période de grâce de 7 jours. Choisissez **avant** de consentir : un locataire en audit seulement peut être converti en géré plus tard, mais un locataire géré ne peut jamais être converti en audit seulement. Le prochain guide couvre cette décision en détail.
4. Cliquez sur **Continuer vers le consentement administrateur**. Vous êtes redirigé vers la page de consentement administrateur de Microsoft.
5. Connectez-vous avec le compte Administrateur général ou le compte GDAP du locataire cible et acceptez les autorisations demandées. Cela accorde au principal de service de Panoptica365 un accès en lecture à la configuration du locataire (ainsi que les autorisations d'écriture utilisées par le déploiement de modèles).
6. Vous revenez sur la page Locataires avec une notification : *« Consentement administrateur accordé avec succès. »*

En coulisses, Panoptica365 attribue aussi les rôles **Administrateur Exchange** et **Administrateur de conformité** à son principal de service dans le nouveau locataire — ils sont nécessaires aux lecteurs Exchange et conformité. C'est automatique et au mieux des possibilités; si l'opération ne se termine pas, voyez le Dépannage ci-dessous.

## Ce qui se passe ensuite

Le locataire apparaît immédiatement dans la liste avec un nom généré (vous corrigerez ça dans un instant) et une colonne **Dernière interrogation** vide. La première collecte de données démarre en arrière-plan. **Accordez-lui quelques minutes** — il n'y a pas de barre de progression; quand la première interrogation se termine, Dernière interrogation se remplit et le tableau de bord du locataire commence à montrer de vraies données.

Pendant que vous attendez, cliquez sur l'action de modification (crayon) du locataire et définissez :

- **Nom d'affichage** — le nom du client que vous voulez voir partout.
- **Nom PSA** — le nom de l'entreprise tel qu'il apparaît dans votre PSA, utilisé pour l'attribution des billets (vous pouvez sauter cette étape jusqu'à la configuration de l'intégration PSA).
- **Langue** — la langue utilisée pour l'analyse IA et les rapports de ce locataire.
- **Interrogation (min)** — la fréquence d'interrogation du locataire (1 à 60 minutes).

Cliquez ensuite sur **Enregistrer**, rendez-vous à la **Console principale**, et cliquez sur votre nouveau locataire pour ouvrir son tableau de bord.

## Dépannage

**Le consentement échoue avec AADSTS650051.** C'est assez fréquent lors d'une *première* tentative de consentement pour que Panoptica365 le gère pour vous : une fenêtre intitulée *« Le consentement ne s'est pas terminé — réessayez »* apparaît. C'est presque toujours un accroc temporaire du côté de Microsoft — cliquez sur **Réessayer** et la deuxième tentative aboutit généralement. Si l'échec persiste, dépliez *« Afficher les étapes de nettoyage »* dans cette fenêtre pour obtenir un script de nettoyage à copier-coller.

**Attribution de rôles incomplète.** Si vous voyez une notification indiquant que le principal de service est peut-être encore en cours de propagation, attendez une minute, puis ouvrez la fenêtre de modification du locataire et cliquez sur **Réattribuer les rôles Exchange**.

**Mauvais compte.** Si vous avez consenti par accident avec les identifiants du mauvais locataire, vous avez intégré le mauvais locataire. Supprimez-le (fenêtre de modification → **Supprimer le client**) et recommencez avec les bons identifiants.
