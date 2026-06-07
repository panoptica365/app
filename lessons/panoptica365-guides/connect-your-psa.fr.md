---
title: "Connectez votre PSA"
subtitle: "Intégration Autotask native : identifiants, valeurs par défaut des billets, correspondance locataire-entreprise et résolution bidirectionnelle."
icon: "ticket"
last_updated: 2026-06-07
---

# Connectez votre PSA

Si votre boîte tourne sur un PSA, les alertes devraient être des billets — créés dans la bonne entreprise, à la bonne priorité, et fermés depuis l'un ou l'autre côté. Panoptica365 s'intègre nativement à **Autotask** (Paramètres → Intégration PSA, rôle Administrateur).

## 1. Identifiants

Saisissez votre **nom d'utilisateur API** Autotask, votre **identifiant de suivi** et votre **secret API**, puis cliquez sur **Tester la connexion**. En cas de succès, l'intégration découvre et enregistre votre zone Autotask : *« Connecté — zone … »*. Le secret est en écriture seule après l'enregistrement — le champ affiche *« Enregistré — laisser vide pour conserver l'actuel »*.

## 2. Valeurs par défaut des billets

Définissez à quoi ressemble un billet Panoptica365 dans votre univers :

- **File d'attente**, **Source**, **Statut d'un nouveau billet** et **Visibilité des notes** pour les billets créés.
- **Statut lors de la fermeture depuis Panoptica365** — le statut appliqué quand Panoptica365 ferme un billet.
- **Statuts considérés comme « fermés »** — l'ensemble des statuts Autotask qui comptent comme « terminé ». Quand votre équipe déplace un billet dans l'un de ceux-ci, l'alerte liée se résout automatiquement. Le statut de fermeture doit lui-même faire partie de cet ensemble — le formulaire l'exige.
- **Priorité selon la gravité** — une ligne par gravité d'alerte (sévère, élevée, moyenne, faible, info) vers vos priorités Autotask.
- **Décalage de l'échéance (heures)** — le nombre d'heures avant l'échéance du billet (24 par défaut).
- **Langue des billets** — en/fr/es pour le corps des billets.
- **Entreprise par défaut (alertes au niveau MSP)** — où atterrissent les alertes à l'échelle du parc (sans locataire).

## 3. Correspondance locataire → entreprise

Le tableau de correspondance associe chaque locataire Panoptica365 à une entreprise Autotask. Utilisez **Proposer des correspondances** pour l'appariement automatique par nom (il considère à la fois le nom d'affichage et le champ Nom PSA du locataire), corrigez ce qu'il a manqué avec le sélecteur d'entreprises avec recherche, et cliquez sur **Enregistrer la correspondance** — toutes les lignes en un seul lot. Le pied de page compte les locataires non associés : ceux-là retombent sur la livraison par **courriel** (votre Adresse courriel PSA) au lieu de billets par API, alors terminez la correspondance.

## Le comportement au quotidien

- **Un billet par problème.** Les alertes se dédupliquent par paire (locataire, stratégie d'alerte) : si le même problème se redéclenche pendant que son billet est ouvert, la nouvelle occurrence est **ajoutée en note** au billet existant, pas levée en doublon. Votre tableau reste lisible pendant un incident bruyant.
- **Résolution bidirectionnelle.** Fermez (ou complétez) le billet dans Autotask → l'alerte se résout dans Panoptica365 à la prochaine synchronisation. Résolvez l'alerte dans Panoptica365 → une fenêtre demande *« Fermer le billet Autotask associé? »* — en opération groupée, elle ne demande qu'une fois pour tout le lot.
- **Les alertes résolues par exemption ne deviennent jamais des billets.** Le bruit supprimé reste entièrement hors du tableau.
- **L'acheminement s'applique toujours.** Seules les alertes dont la stratégie achemine vers **PSA** ou **Les deux** créent des billets (voir *Ajustez les stratégies d'alerte*).

## État

La page de paramètres affiche l'**État** de l'intégration : dernière synchronisation, billets liés ouverts, erreurs de synchronisation et état de l'authentification. Si l'authentification Autotask commence à échouer, vous verrez *« Échec de l'authentification Autotask depuis … »*, une alerte système se déclenche, et les alertes destinées aux billets retombent automatiquement sur l'adresse courriel PSA jusqu'au rétablissement — la livraison se dégrade, elle ne disparaît jamais. C'est aussi pourquoi l'Adresse courriel PSA devrait rester configurée même une fois l'intégration native en service.

Vous utilisez un autre PSA? Prenez la voie courriel : la plupart des PSA convertissent les courriels en billets, et le Texte d'attribution avec `${PSA_NAME}` (voir *Configurez les notifications*) permet à votre PSA d'acheminer automatiquement ces courriels à la bonne entreprise.
