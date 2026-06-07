---
title: "Configurez les notifications"
subtitle: "SMTP, destinataires, le résumé de 6 h et les périodes de sourdine — comment les alertes atteignent des humains, de façon fiable."
icon: "mail"
last_updated: 2026-06-07
---

# Configurez les notifications

Une alerte que personne ne reçoit n'a pas eu lieu. Ce guide branche le côté livraison — tout se passe dans **Paramètres** (rôle Administrateur requis), et ça vaut la peine de le faire soigneusement, une fois.

## SMTP — la fondation

**Paramètres → Paramètres SMTP.** Hôte, port, nom d'utilisateur, mot de passe et l'adresse d'expéditeur. Enregistrez, puis utilisez **Envoyer un courriel de test** — faites-le vraiment; le test attrape la coquille d'authentification ou le port bloqué *maintenant* plutôt que pendant votre premier vrai incident. Toutes les fonctions courriel de la plateforme (notifications d'alertes, résumé quotidien, courriels liés aux rapports) reposent sur cette configuration.

## Destinataires et acheminement

**Paramètres → Paramètres de notification** contient trois champs :

- **Adresses courriel des destinataires** — la liste, séparée par des virgules, des destinataires *personnels* : vos opérateurs. Les alertes dont la stratégie achemine vers **Courriel** (ou **Les deux**) arrivent ici.
- **Adresse courriel PSA** — où vont les alertes acheminées vers **PSA** quand elles voyagent par courriel : la boîte de conversion courriel-vers-billet de votre PSA. Une fois l'intégration PSA native branchée (prochain guide), les alertes acheminées au PSA deviennent de vrais billets par API et cette adresse devient le repli — gardez-la configurée dans tous les cas.
- **Texte d'attribution** — la première ligne des courriels destinés au PSA, qui prend en charge l'espace réservé `${PSA_NAME}` pour que votre PSA puisse acheminer automatiquement les billets au bon tableau d'entreprise.

Quelles alertes vont où se décide par stratégie d'alerte (acheminement : Aucun / Courriel / PSA / Les deux — voir *Ajustez les stratégies d'alerte*). Le modèle mental : **Paramètres dit où pointent les canaux; Stratégies d'alerte dit ce qui circule dans chaque canal.**

Chaque destinataire reçoit ses courriels dans **sa propre langue** — les destinataires qui ont un profil utilisateur Panoptica365 reçoivent les courriels d'alerte dans la langue définie dans leurs préférences.

## Le résumé quotidien

Chaque matin à 6 h, Panoptica365 envoie par courriel un résumé rédigé par Claude de la dernière journée à travers le parc. **Paramètres → Résumé quotidien** fixe la gravité minimale pour y figurer : de *Info — tout inclure (par défaut)* jusqu'à *Sévère seulement*. Les alertes résolues par des règles d'exemption sont exclues automatiquement — le pied de page indique ce qui a été filtré. Si votre résumé se lit comme du bruit, montez le seuil avant d'arrêter de le lire; un résumé que vous parcourez chaque jour, peu importe le seuil, vaut mieux qu'un résumé complet que vous ignorez.

## Les périodes de sourdine

Vous partez en vacances? Tout utilisateur peut mettre en sourdine les alertes **vers son propre courriel** : cliquez sur votre contrôle de sourdine, réglez De / À (jusqu'à 60 jours), et au besoin une raison. La sourdine expire d'elle-même; vous pouvez l'annuler avant terme.

Deux détails honnêtes :

- La sourdine n'affecte que *votre* livraison. Si votre adresse ne figure dans aucune liste de destinataires, l'interface vous indique que la sourdine n'a aucun effet.
- **Le filet de sécurité :** si tous les destinataires configurés sont en sourdine en même temps, Panoptica365 outrepasse les sourdines et livre quand même à un Administrateur, avec un bandeau *Livraison de secours* sur le courriel. Il n'existe aucune configuration où une alerte sévère n'atteint silencieusement personne. Les administrateurs peuvent consulter toutes les sourdines actives dans Paramètres.

## La liste de vérification

1. SMTP configuré et **courriel de test reçu**.
2. Courriels des opérateurs dans la liste des destinataires; adresse courriel PSA définie.
3. Seuil du Résumé quotidien choisi.
4. Acheminement des stratégies d'alerte révisé (*Ajustez les stratégies d'alerte*).
5. Un vrai test : déclenchez quelque chose d'inoffensif, confirmez que ça arrive où vous l'attendez.

Quinze minutes, une fois — et le modèle par alertes fonctionne vraiment, parce que la livraison est digne de confiance.
