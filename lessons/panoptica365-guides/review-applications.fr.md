---
title: "Examinez les applications — approuvez ce en quoi vous avez confiance, triez le reste"
subtitle: "Le flux de travail de l'onglet Applications : Actualiser, cocher Approuvée, Enregistrer — et laisser Sonnet trier tout ce que vous n'avez pas approuvé."
icon: "app-window"
last_updated: 2026-06-07
---

# Examinez les applications — approuvez ce en quoi vous avez confiance, triez le reste

Chaque locataire accumule des applications d'entreprise et des inscriptions d'applications — certaines installées délibérément, d'autres consenties par des utilisateurs il y a des années, d'autres malveillantes. L'onglet **Applications** du tableau de bord du locataire transforme cette pile en inventaire révisé doté d'une base de référence protégée.

Les applications de première partie de Microsoft sont exclues automatiquement — vous n'examinez que ce qui est tiers ou personnalisé.

## Le flux de travail

1. Ouvrez le tableau de bord du locataire → onglet **Applications**.
2. Cliquez sur **Actualiser** si l'inventaire n'a pas été récupéré récemment. Vous verrez *« Actualisation depuis Microsoft Graph… »* pendant la récupération de la liste en direct.
3. Parcourez la liste. Pour chaque application que vous reconnaissez et en qui vous avez confiance — celles que vous avez installées, celles que le client confirme utiliser — cochez sa case **Approuvée**. Dépliez une ligne pour voir ses permissions déléguées et d'application, ses identifiants et ses URI de redirection si vous voulez y regarder de plus près. Une coche *Éditeur vérifié* et une étiquette *tout le locataire* sur les portées vous aident à juger.
4. En cas de doute, **demandez au client**. « Utilisez-vous quelque chose qui s'appelle Acme Sync? » est un appel de trente secondes qui vaut mieux que deviner.
5. Cliquez sur **Enregistrer**. Deux choses se produisent :
   - Les applications cochées sont **marquées approuvées** et reçoivent une **base de référence protégée** : leur ensemble de permissions actuel est capturé.
   - Chaque application que vous n'avez *pas* cochée est envoyée à **Sonnet pour triage**. La ligne de progression ressemble à *« Enregistrement… 12 application(s) approuvée(s); envoi de 9 à Sonnet pour triage. »*

## Lire les résultats du triage

Chaque application non approuvée revient avec une pastille d'évaluation colorée :

- **Vert — rien d'alarmant.** Éditeur, ancienneté, type de consentement et portées semblent ordinaires.
- **Jaune — à examiner.** Quelque chose est assez inhabituel pour mériter vos yeux.
- **Rouge — à investiguer.** Examinez cette application maintenant, avec le client au besoin.

Tenez compte de l'avertissement affiché dans l'interface : c'est *un triage, pas une garantie*. La pastille reflète ce que Sonnet a pu déduire de l'éditeur, de l'ancienneté, du type de consentement et des portées. Seul le marquage d'une application comme **Approuvée** enregistre une base de référence protégée. Utilisez les pastilles rouges et jaunes comme liste de travail : investiguez, puis approuvez l'application ou retirez-la du locataire (le lien **Supprimer ↗** vous amène au bon endroit dans Entra).

## Ce que la base de référence vous apporte

Une fois une application approuvée, Panoptica365 la surveille. Si elle **gagne plus tard des permissions au-delà de sa base approuvée**, la ligne affiche *« Permissions modifiées depuis l'approbation »* et une alerte se déclenche. Les *retraits* de permissions ne déclenchent rien — seule la croissance au-delà de ce que vous avez approuvé. La comparaison s'exécute à chaque Actualiser et dans une boucle automatique quotidienne.

C'est la défense contre un schéma d'attaque classique : une application légitime, de confiance depuis longtemps, dont les identifiants sont volés et qui se voit soudainement greffer `Mail.Read` pour tout le locataire. Vous avez approuvé ce qu'elle était — Panoptica365 vous avertit quand elle devient autre chose.

## Quand refaire l'exercice

- Après l'intégration : faites le passage complet une fois, avec la confirmation du client là où c'est nécessaire.
- Quand une alerte de nouvelle application ou de consentement se déclenche : examinez l'application, puis approuvez-la ou éliminez-la. Approuver une application résout automatiquement son alerte de consentement ouverte.
- Périodiquement (une fois par trimestre suffit amplement) : cliquez sur Actualiser et vérifiez s'il y a de nouvelles pastilles jaunes ou rouges.
