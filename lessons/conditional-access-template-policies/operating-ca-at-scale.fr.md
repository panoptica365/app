---
title: "Opérer l'AC à l'échelle — dérive, exclusions, cycle de vie"
subtitle: "Comment les politiques d'AC se dégradent avec le temps, et comment la détection de dérive les maintient fiables."
icon: "gauge"
last_updated: 2026-05-29
---

# Opérer l'AC à l'échelle — dérive, exclusions, cycle de vie

En avril 2026, un MSP à Calgary a découvert qu'un de ses clients de longue date — une petite firme de comptabilité avec trente utilisateurs — opérait avec une politique « Exiger MFA pour tous les utilisateurs » qui avait tranquillement accumulé 19 entrées d'exclusion sur quatre ans. Trois des utilisateurs exclus avaient quitté l'entreprise. Deux étaient exclus pour un compte de service qui avait été retiré en 2023. Huit étaient des exceptions ponctuelles ajoutées pendant la pandémie et jamais retirées.

La politique était *activée*. Le rapport de conformité montrait *MFA appliqué pour tous les utilisateurs*. La piste d'audit disait *la politique est en place depuis 2022*. Aucune de ces choses ne disait toute la vérité. La politique était techniquement activée, mais un tiers de la base d'utilisateurs avait tranquillement accumulé des exemptions dont personne ne se souvenait.

C'est la réalité opérationnelle de faire tourner l'accès conditionnel sur des années plutôt que des semaines. Les huit leçons précédentes de la carte 3 ont expliqué ce que chaque modèle fait et comment le déployer. Cette leçon parle de ce qui se passe après — comment un ensemble de politiques d'AC évolue, se dégrade, et reste digne de confiance à travers des années d'opération sur tenants clients.

Trois sujets : dérive, exclusions et cycle de vie. Chacun mérite sa propre attention. Chacun est quelque chose avec lequel Panoptica365 aide mais ne peut pas résoudre tout seul — l'opérateur doit être dans la boucle.

## Dérive — quand une politique déployée cesse de correspondre à son modèle

Une politique d'AC que vous avez déployée mardi dernier peut ne pas être la même politique aujourd'hui. Microsoft peut changer le schéma sous-jacent. Un utilisateur admin délégué peut la modifier. Un technicien utilisant GDAP à votre MSP peut l'ajuster. L'autre admin du client (souvent inconnu de votre MSP) peut l'éditer. La politique dérive.

La dérive prend plusieurs formes :

**Dérive de schéma** — Microsoft change le schéma sous-jacent de la politique d'AC, ajoute de nouveaux champs, en déprécie d'anciens. La politique que vous avez déployée il y a deux ans peut avoir des champs qui n'existent plus dans l'API actuelle, ou peut manquer des champs qui sont maintenant attendus. La dérive de schéma est le type lent; elle s'accumule sur les années.

**Dérive d'état** — l'état de la politique a changé (Activé → Rapport uniquement, ou vice versa, ou Désactivé). Ça peut arriver accidentellement pendant un dépannage, intentionnellement pendant une fenêtre de maintenance, ou malveillamment si un attaquant a un accès admin. La dérive d'état est binaire et facile à détecter.

**Dérive de portée** — les inclusions ou exclusions d'utilisateurs/groupes ont changé. Nouveaux utilisateurs ajoutés, utilisateurs partis retirés, nouveaux groupes inclus ou anciens exclus. C'est le type de dérive qui accumule les exclusions. La dérive de portée est la plus conséquente parce que c'est la plus facile à mal lire — « la politique est encore activée, quel est le problème? »

**Dérive de contrôle** — les contrôles d'octroi ou de session ont changé. « Exiger MFA » pourrait avoir été changé à « Exiger MFA OU Appareil conforme », ou la politique pourrait avoir été affaiblie en ajoutant un dépassement de fréquence de session. La dérive de contrôle est la plus difficile à détecter à l'œil parce que la politique a encore l'air correcte dans le portail.

**Dérive de condition** — les conditions de la politique ont changé. La liste d'emplacements de confiance, la liste de plateformes, la liste d'apps clientes. Moins courante mais possible.

Le détecteur de dérive AC de Panoptica365 couvre les cinq catégories. Le détecteur lit périodiquement l'état actuel de chaque politique déployée via l'API Graph et le compare à la ligne de base du modèle (ou à l'état précédent connu-bon pour les politiques personnalisées). Les différences se déclenchent comme alertes de dérive.

Le flux de travail de l'opérateur pour une alerte de dérive :

1. **Accuser réception de l'alerte.** Quel type de dérive? État, portée, contrôle, condition, schéma?
2. **Identifier la cause.** Regardez le journal d'audit : qui a fait le changement, quand, depuis quel rôle. Panoptica365 enregistre la chaîne d'attribution complète.
3. **Décider : rollback ou accepter.** Si le changement était légitime (le client a demandé une exclusion spécifique, une maintenance connue), acceptez et mettez à jour le modèle/la ligne de base pour correspondre. Si le changement était non autorisé ou non intentionnel, faites un rollback.
4. **Documenter.** Que vous ayez fait un rollback ou accepté, le changement est maintenant visible dans votre dossier opérationnel. Le prochain opérateur qui regarde cette politique peut voir ce qui s'est passé.

La partie la plus difficile, c'est l'étape 3 — décider ce qui est légitime vs ce qui ne l'est pas. Dans un MSP en santé, chaque changement d'AC devrait avoir un billet correspondant. Si une alerte de dérive se déclenche et qu'il n'y a pas de billet l'expliquant, vous avez soit une lacune de documentation, soit un changement non autorisé. Les deux valent la peine d'être enquêtés.

## Exclusions — la dette silencieuse

L'histoire de la firme de comptabilité ci-dessus est le patron standard. Les exclusions sont ajoutées une à la fois, chacune avec une raison défendable au moment, aucune avec une date de coucher de soleil. Avec les années, elles s'accumulent. Éventuellement, un tiers de la base d'utilisateurs est exclu d'une politique que vous croyiez les protéger.

Le mécanisme qui corrige ça :

**Chaque exclusion a une date de coucher de soleil.** Le système d'exemption de Panoptica365 supporte ça directement. Quand un opérateur ajoute un utilisateur à la liste d'exclusions d'une politique d'AC (ou accepte un événement de dérive qui a ajouté une exclusion), le système exige une justification et une date d'expiration. Par défaut, l'expiration est de 180 jours après l'ajout. L'opérateur peut raccourcir ou allonger, mais ne peut pas la laisser ouverte.

**Chaque exclusion est révisée avant expiration.** Avant la date de coucher de soleil, Panoptica365 alerte l'opérateur responsable. Il révise : l'exclusion est-elle encore nécessaire? Devrait-elle être renouvelée (avec une justification fraîche)? Ou devrait-elle expirer et l'utilisateur être ramené dans la portée de la politique? La révision active prévient le patron d'accumulation silencieuse.

**Les exclusions basées sur les groupes sont auditables.** Plusieurs politiques excluent un groupe entier (« Comptes break-glass », « Comptes de service »). L'adhésion à ces groupes peut changer sans que la politique d'AC elle-même change — et le nouveau membre est maintenant silencieusement exclu. Les audits périodiques de l'*adhésion* aux groupes d'exclusion font partie de la discipline d'opération.

Le principe honnête : une politique d'AC avec une liste d'exclusions vide est l'objectif. Chaque entrée sur la liste d'exclusions est une faille de sécurité connue. La liste devrait être auditable, justifiée et révisée sur une cadence régulière.

Le patron *à ne pas* tomber :

- « On va ajouter l'exclusion pour l'instant et la revisiter plus tard. » (Plus tard ne vient jamais.)
- « Excluons juste le département IT pour la commodité. » (Vous venez de désactiver la politique pour tous ceux avec un accès admin — exactement la mauvaise forme.)
- « C'est là depuis des années, ça doit être intentionnel. » (Ou c'est là depuis des années parce que personne ne l'a retiré.)

Le flux de révision d'exemptions de Panoptica365 existe spécifiquement pour empêcher ces patrons. Utilisez-le. La friction de « vous devez ajouter une justification et un coucher de soleil » est le design — ça rend les mauvais patrons plus difficiles à commettre que les bons.

## Cycle de vie — comment une politique d'AC évolue sur les années

Une politique d'AC n'est pas un déploiement unique. C'est une configuration qui vit aux côtés de l'entreprise du client aussi longtemps que la relation dure. Sur les années, le client change :

- **Il embauche et congédie.** La population d'utilisateurs change. Les groupes gagnent et perdent des membres. Les rôles changent.
- **Il acquiert d'autres entreprises.** Un nouveau tenant est fusionné (ou non). De nouveaux utilisateurs arrivent en masse avec différents équipements et différentes postures d'AC existantes.
- **Il ouvre de nouveaux bureaux.** Nouvelles entrées d'emplacement de confiance. Nouvelles plages d'IP. Nouveaux patrons de voyage.
- **Il adopte de nouvelles apps.** Nouvelles apps dans la liste d'applications infonuagiques. Nouvelles intégrations OAuth. Nouveaux comptes de service.
- **Il met à niveau ses licences.** Business Standard → Business Premium → E5. Chaque mise à niveau débloque de nouvelles fonctionnalités d'AC (AC d'appareil conforme à Premium, AC basé sur le risque à E5). L'ensemble de politiques d'AC devrait évoluer pour utiliser les nouvelles capacités.
- **Il subit un incident.** Post-incident, la posture d'AC se durcit typiquement.
- **Il fait face à une nouvelle exigence réglementaire.** Une nouvelle obligation de conformité exige une nouvelle politique d'AC.
- **Il réduit ses effectifs.** La population d'utilisateurs rétrécit. Certains utilisateurs partent. La politique d'AC a besoin de nettoyage.

Chacun de ceux-ci est un événement pertinent à l'AC. Le MSP qui fait tourner l'AC bien vérifie l'ensemble de politiques d'AC :

- **Trimestriellement** — révisez chaque politique. Les conditions sont-elles encore correctes? Les exclusions sont-elles encore nécessaires? Le client utilise-t-il les licences qu'il a?
- **À chaque jalon de la relation client** — accueil, renouvellement, acquisition majeure, réduction d'effectifs.
- **Après tout incident** — les revues post-incident font remonter les écarts d'AC qui doivent être fermés.
- **Quand Microsoft livre de nouvelles fonctionnalités d'AC** — périodiquement Microsoft ajoute de nouvelles capacités (Token Protection est devenu GA en 2024; la condition de flux d'authentification a suivi en 2025). Les nouvelles capacités devraient déclencher une révision « ceci pourrait-il renforcer l'ensemble de politiques d'AC ».

C'est la méta-charge de travail de faire tourner l'AC à l'échelle. Les modèles livrés sont le point de départ. La détection de dérive et la révision des exclusions gardent les politiques déployées dignes de confiance. La révision de cycle de vie garde l'ensemble de politiques *pertinent* — fort contre le paysage actuel des menaces, pas le paysage de menaces de 2023.

## Ce que Panoptica365 fait et ne fait pas

Pour être clair sur le rôle de la plateforme :

**Panoptica365 fait :**

- Détection de dérive sur chaque politique d'AC déployée. Alertes sur dérive d'état, de portée, de contrôle, de condition et de schéma.
- Le flux de travail de révision d'exemption / exclusion. Justifications, couchers de soleil, rappels, piste d'audit.
- Journalisation d'audit pour chaque mutation de politique d'AC (déploiement, modification, désactivation, exclusion). Qui, quand, depuis quel rôle, avec quelle raison.
- Le widget Activité quotidienne qui montre le volume de blocages d'AC en quasi-temps-réel à travers la flotte MSP.
- Vue inter-tenant : voir l'état des politiques d'AC à travers chaque client en un coup d'œil.

**Panoptica365 ne fait pas :**

- Décider si un événement de dérive est légitime ou non autorisé. L'opérateur décide.
- Décider si une exclusion devrait être renouvelée ou expirer. L'opérateur décide.
- Générer de nouvelles politiques d'AC en réponse à de nouvelles menaces. L'opérateur le fait (en utilisant le flux d'importation de la carte 8 si nécessaire).
- Remplacer l'admin AC existant du client. Si le client a son propre admin qui modifie aussi les politiques, Panoptica365 fait remonter les changements — mais ne les empêche pas.

La ligne est : Panoptica365 rend l'état de l'AC à travers les clients *visible*. Le travail de l'opérateur est d'interpréter ce qu'il voit et d'agir dessus.

## La révision annuelle d'AC — une cadence recommandée

Pour chaque client, une fois par année (souvent synchronisée avec la conversation de renouvellement annuel), exécutez une révision explicite d'AC :

1. **Listez toutes les politiques d'AC déployées.** Ce qui est activé, ce qui est rapport uniquement, ce qui est désactivé.
2. **Pour chaque politique, révisez la liste d'exclusions.** Chaque entrée : encore nécessaire? Date de coucher de soleil encore appropriée?
3. **Pour chaque politique, vérifiez l'historique de dérive de la dernière année.** Y a-t-il eu des événements de dérive que vous n'avez pas complètement résolus? Des patrons suggérant un historique de changements non autorisés?
4. **Comparez à la bibliothèque de modèles Panoptica365 actuelle.** Y a-t-il des modèles qui devraient être déployés mais ne le sont pas (politiques nouvellement livrées, imports récemment ajoutés)?
5. **Comparez à l'état actuel du client.** Quelque chose a-t-il changé (nouvelles licences, nouvelles apps, nouvelles régulations) qui suggère de nouvelles politiques?
6. **Documentez la révision.** Le directeur IT du client devrait savoir que cette révision a eu lieu, ce qui a été trouvé, et ce qui a été changé.

Ce cycle annuel est ce qui empêche l'AC de devenir un déploiement unique qui se dégrade sur les années. C'est aussi ce dont le client a besoin pour démontrer à un auditeur, un assureur ou un régulateur : « nous révisons nos contrôles d'accès annuellement, et voici le dossier ».

## Ce que ça veut dire pour l'opérateur

Trois points à retenir pour le travail quotidien et annuel.

**Les alertes de dérive ne sont pas du bruit de fond.** Chacune est soit un changement autorisé (accuser réception et accepter), soit un changement non autorisé (enquêter et faire un rollback). Les deux exigent l'attention de l'opérateur. L'intégrité de l'ensemble de politiques d'AC dépend du fait que chaque événement de dérive est résolu proprement.

**Les listes d'exclusions devraient être l'ensemble le plus petit possible.** Chaque entrée est une faille de sécurité connue. Le flux de travail d'exemption avec couchers de soleil est votre outil pour garder la liste réduite. Résistez à l'impulsion d'ajouter des exclusions « permanentes »; rien n'est permanent.

**La révision annuelle d'AC fait partie de la relation client.** Ce n'est pas optionnel ou « agréable à avoir ». C'est la discipline d'opération qui garde la posture AC du client digne de confiance. Facturez pour ça. Documentez-la. Rendez-la visible au client.

## Fermeture de la carte 3

Vous avez maintenant vu les neuf modèles d'accès conditionnel que Panoptica365 livre, plus la mécanique de la plateforme (import, dérive, exclusions, cycle de vie) qui transforme la bibliothèque de modèles en système d'exploitation.

L'arc de la carte :

1. Liste de vérification pré-déploiement — avant tout modèle, faites ces cinq choses.
2. Exiger MFA pour tous les utilisateurs — la fondation.
3. Bloquer l'authentification héritée — fermer le contournement par auth de base.
4. Emplacement de confiance OU appareil conforme — la politique géo intelligente.
5. Conforme OU hybride OU MFA — la politique OU de signaux de confiance, et le choix de stratégie avec #2.
6. Durcir l'accès admin — quatre modèles admin comme ensemble cohérent.
7. Désactiver le flux de code d'appareil — la défense Storm-2372.
8. Importer vos propres modèles — le super-pouvoir de personnalisation de Panoptica365.
9. Opérer l'AC à l'échelle — dérive, exclusions, cycle de vie (cette leçon).

La carte 4 (paramètres de modèles Intune) commence ensuite. La carte 4 couvre le côté appareil de la paire signal-de-confiance — les politiques et configurations qui font que le signal « appareil conforme » dans 3.4 et 3.5 signifie réellement quelque chose. Sans conformité fiable, les politiques d'AC à condition OU se dégradent en politiques à condition unique. La carte 4 est où la conformité devient réelle.

Pour l'instant : lisez les politiques, déployez-les avec la discipline pré-déploiement, surveillez-les avec la détection de dérive, et vivez avec elles à travers les années en utilisant les couchers de soleil d'exclusions et les révisions annuelles. L'AC à l'échelle n'est pas glamoureux, mais la posture de sécurité du client vit ou meurt là-dessus.

---

*Sources des données dans cette leçon — Microsoft Learn sur la gestion des politiques d'accès conditionnel et la journalisation d'audit ([Microsoft Learn — Audit logs in Entra ID](https://learn.microsoft.com/en-us/entra/identity/monitoring-health/concept-audit-logs)); versionnage et piste d'audit des politiques d'AC ([Microsoft Learn — Conditional Access change history](https://learn.microsoft.com/en-us/entra/identity/conditional-access/howto-conditional-access-policies-audit)); API Microsoft Graph pour l'état des politiques d'AC ([Microsoft Learn — Conditional Access policy resource](https://learn.microsoft.com/en-us/graph/api/resources/conditionalaccesspolicy)).*
