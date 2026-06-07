---
title: "Ajustez les stratégies d'alerte"
subtitle: "Gravité, acheminement, activation et limites de notifications — faites correspondre le flux d'alertes à la façon dont votre boîte travaille vraiment."
icon: "list-checks"
last_updated: 2026-06-07
---

# Ajustez les stratégies d'alerte

Dès l'installation, Panoptica365 livre des dizaines de stratégies d'alerte avec des valeurs par défaut sensées. **Stratégies d'alerte** (barre latérale) est l'endroit où vous les adaptez à votre boîte — et la différence entre un flux d'alertes auquel votre équipe fait confiance et un flux qu'elle ignore, c'est vingt minutes sur cette page.

## La disposition

Les stratégies sont regroupées en catégories repliables :

- **Connexions à risque** — voyages impossibles, emplacements inhabituels, détections de risque.
- **Gestion des menaces** — incidents Defender, maliciels, signaux d'hameçonnage.
- **Autorisations** — changements de rôles, octrois de consentement, croissance des permissions d'applications.
- **Modifications de configuration** — dérives et changements de paramètres, y compris les éléments du Centre de messages.
- **Partage externe** — liens anonymes, événements d'accès externe.
- **Gouvernance de l'information** — événements DLP et apparentés à la conformité.

Une barre de recherche filtre les noms et les descriptions; les sections qui correspondent se déplient automatiquement. Chaque ligne de stratégie porte l'**icône de mortier** — le même explicateur en cinq sections que sur une alerte réelle, pour que vous puissiez comprendre une stratégie avant de décider quoi en faire.

## Ce que vous pouvez changer par stratégie

- **Gravité** — info / faible / moyenne / élevée / sévère. La gravité pilote le tri, le seuil du résumé quotidien et la correspondance de priorité des billets PSA. Si votre équipe traite un type d'alerte comme « on lâche tout », cotez-le ainsi.
- **Acheminement** — Aucun / Courriel / PSA / Les deux. *Courriel* va à vos destinataires de notifications (courriel personnel); *PSA* va à votre PSA (billet, ou repli courriel PSA); *Les deux* fait les deux. Acheminez le travail actionnable pour le client vers le PSA et les éléments de vigie opérateur vers le courriel.
- **Bascule Activée / Désactivée** — les stratégies désactivées n'évaluent rien du tout. Désactiver une stratégie est honnête quand le signal ne vous intéresse réellement pas; résoudre ses alertes à perpétuité en la laissant active ne l'est pas.
- **Limite de notifications** (fenêtre de modification, Administrateur) — un plafond quotidien de notifications pour cette stratégie, votre frein contre une alerte emballée qui inonde les boîtes de courriel ou le tableau PSA.

Les changements faits ici sont globaux — ils s'appliquent à tous les locataires. Les exceptions par locataire relèvent des **exemptions** (prochain guide), pas des bascules de stratégies.

## Une méthode de réglage qui fonctionne

1. **Roulez les valeurs par défaut pendant deux semaines.** Ne préréglez pas contre du bruit imaginé.
2. **Regardez ce que vous avez réellement résolu en faux positif.** Chaque faux positif récurrent est soit un candidat à l'exemption (un utilisateur, un schéma, un locataire), soit un mauvais appariement gravité/acheminement (le signal est réel mais ne mérite pas un billet).
3. **Promouvez ce qui vous a brûlé.** Si quelque chose a tourné en incident et que son alerte était cotée faible, montez-la.
4. **Surveillez le seuil du résumé.** Le résumé quotidien a son propre réglage de gravité minimale (Paramètres → Résumé quotidien). La gravité ici et le seuil là-bas décident ensemble du contenu de votre courriel de 6 h.

Toutes les modifications sur cette page sont consignées dans le journal d'audit MSP — changements de gravité, bascules, changements d'acheminement. Le réglage est un travail dont on rend compte, et c'est très bien ainsi.
