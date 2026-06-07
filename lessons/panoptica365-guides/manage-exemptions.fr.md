---
title: "Gérez les exemptions"
subtitle: "Des exceptions documentées et limitées dans le temps : comment elles naissent de l'AC, d'Intune et des alertes, et comment les garder honnêtes."
icon: "shield-off"
last_updated: 2026-06-07
---

# Gérez les exemptions

Chaque parc a ses exceptions légitimes : le compte de service qui ne peut pas encore faire d'AMF, le déploiement qui diffère intentionnellement chez un client, l'utilisateur dont le schéma de connexion étrange-mais-réel fait trébucher un évaluateur. Les exemptions sont la façon dont Panoptica365 consigne ces exceptions **explicitement** — avec une portée, une raison, un responsable et une expiration — au lieu de les laisser vivre sous forme d'alertes résolues par réflexe.

## D'où viennent les exemptions

Vous ne créez pas d'exemptions sur la page Exemptions. Elles sont créées en contexte, au moment où vous acceptez une exception :

- **Acceptation de dérive AC** — accepter une dérive de stratégie AC *avec expiration* transfère les principaux exclus (utilisateurs ou groupes) en exemptions. Portée : par principal.
- **Acceptation de dérive Intune** — même flux; la portée est **à l'échelle de la stratégie** pour ce déploiement.
- **Exemptions d'alerte** — depuis le panneau de détail d'une alerte, pour exempter un schéma récurrent : un utilisateur, optionnellement restreint par pays et/ou plage d'IP. Portée : le schéma.

L'expiration par défaut est de **180 jours**. Accepter exige le rôle Opérateur ou plus, et une raison est toujours obligatoire.

## Ce qu'une exemption fait réellement

Tant qu'elle est active, les évaluations d'alertes correspondantes sont supprimées — et surtout, elles le sont *de façon imputable*. Les alertes résolues par une règle d'exemption sont estampillées comme telles, n'atteignent jamais votre PSA et sont exclues du résumé quotidien. Pour les exemptions AC, la colonne du **compteur de suppressions** montre combien d'alertes chaque exemption a absorbées — dépliez la ligne pour voir exactement quels événements ont été supprimés, quand et pour qui.

Ce compteur est votre rétroaction de réglage : une exemption qui a supprimé 47 alertes ce mois-ci porte un vrai poids; une qui en a supprimé zéro n'est peut-être plus nécessaire.

## La page Exemptions

**Exemptions** (barre latérale → Système) est le registre. Filtrez par locataire, par source (AC / Intune / Règles d'alerte), et incluez au besoin les entrées révoquées et expirées. Chaque ligne montre le badge de source, le locataire, le modèle, la portée (principal, à l'échelle de la stratégie, ou schéma d'utilisateur), la **raison**, qui l'a acceptée, quand, et l'expiration avec un compte à rebours en jours — rouge gras sous 7 jours, orange sous 30.

**Révoquer** (Opérateur et plus) met fin immédiatement à une exemption. La confirmation énonce la conséquence : au prochain cycle de dérive, le principal ou le déploiement sera de nouveau signalé, ou les futures alertes correspondantes se déclencheront normalement.

## Garder le registre honnête

- **Les raisons sont pour la personne suivante.** « Selon billet #4321 — exception voyage du chef des finances, validée avec le client » vaut mieux que « ok selon client ». Vous relirez ces raisons un an plus tard lors d'un audit.
- **Laissez les expirations expirer.** Le défaut de 180 jours est un déclencheur de réexamen, pas une nuisance. Quand une exemption tombe et que l'alerte se redéclenche, c'est le système qui demande *« est-ce encore vrai? »* — répondez-y, ne réacceptez pas en pilote automatique.
- **Préférez les portées étroites.** Un utilisateur avec contrainte de pays vaut mieux qu'une portée à l'échelle de la stratégie; une portée à l'échelle de la stratégie vaut mieux que désactiver une stratégie. Utilisez l'outil le plus étroit qui arrête le bruit.
- **Faites le ménage chaque trimestre.** Filtrez sur les actives, passez en revue tout ce qui n'a aucune suppression récente ou dont le responsable est parti — révoquez ce qui est périmé.

Les exemptions sont la différence entre *« on ignore cette alerte »* (indéfendable) et *« on a accepté ce risque, on l'a documenté, et il expire en mars »* (professionnel). Utilisez-les généreusement et gardez-les propres.
