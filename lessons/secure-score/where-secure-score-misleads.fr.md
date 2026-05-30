---
title: "Où Secure Score induit en erreur — l'histoire du 92 % qui s'est fait BEC et le piège du jeu de score"
subtitle: "Un 92 % n'a pas empêché un BEC de 94 000 $. Les angles morts, le piège du jeu de score, et le travail de sécurité qui n'apparaît dans aucun chiffre."
icon: "triangle-alert"
last_updated: 2026-05-29
---

# Où Secure Score induit en erreur — l'histoire du 92 % qui s'est fait BEC et le piège du jeu de score

Une compagnie de logistique de 60 personnes est à 92 % de Microsoft Secure Score. Le MSP qui gère le tenant est fier du chiffre. L'équipe de direction du client a vu la note dans sa revue trimestrielle et est satisfaite. Le chiffre de l'année précédente était de 79 %; le travail pour le faire monter est apparu dans la proposition de renouvellement et le renouvellement s'est fermé proprement. Par n'importe quelle mesure conventionnelle de comment un MSP démontre sa valeur, ce tenant est dans le quartile supérieur.

Un mardi matin de novembre, la contrôleuse vire 94 000 $ à ce qu'elle croit être le nouveau partenaire logistique du client. Les instructions de virement sont arrivées dans un courriel qui ressemblait exactement au style de communication habituel du partenaire. Le courriel a passé l'authentification SPF et DKIM — il venait vraiment du domaine du partenaire. Le courriel du partenaire avait été compromis par un attaquant équipé d'AiTM deux jours plus tôt. L'attaquant avait lu la conversation en cours sur l'entente logistique et s'était inséré avec un message de redirection de virement au moment parfait.

La Secure Score ne bouge pas. La configuration du tenant du MSP est toujours à 92 %. Les recommandations Microsoft sont toujours implémentées. Aucune n'a empêché cette attaque.

L'avocate du client veut comprendre. Le souscripteur d'assurance veut comprendre. Le consultant senior du MSP doit expliquer l'écart entre « 92 % de Secure Score » et « s'est fait BEC pour 94 000 $ ». Cette leçon parle de cet écart.

## Ce que la note mesure vs ce qu'elle ne mesure pas

La note mesure **si le tenant du client a des configurations que Microsoft recommande.** Chaque configuration a été choisie par Microsoft parce que c'est une défense de base utile. Les implémenter toutes fait passer le tenant de « paramètres d'usine » à « base de référence recommandée par Microsoft ». C'est de la vraie valeur sécurité.

La note ne mesure *pas* :

- Si les configurations sont bien réglées pour le profil de risque réel du client
- Si le client a été attaqué
- Si l'opérateur répond vite quand quelque chose dérive
- Si les fournisseurs et partenaires du client ont une sécurité courriel de base
- Si les utilisateurs du client ont été formés à reconnaître un hameçonnage sophistiqué
- Si la capacité de réponse aux incidents hors plateforme existe
- Si l'application DMARC du client est en place
- Si le registre d'exceptions du client a été revu récemment
- Si MailTips rejoint vraiment les utilisateurs (certains utilisateurs les désactivent au niveau de la boîte aux lettres)
- Si l'opérateur audite les règles de transport trimestriellement
- Si l'opérateur attrape les patrons de connexion anormaux à l'intérieur de la fenêtre de réponse

La compagnie de logistique à 92 % avait un tenant parfaitement configuré selon l'ensemble de recommandations de Microsoft. L'attaque est entrée par un vecteur que l'ensemble de recommandations n'adresse pas — le courriel compromis d'un partenaire, utilisé pour insérer un message de redirection dans une conversation en cours. La note n'avait rien à dire sur l'hygiène courriel du partenaire, le processus de vérification de virement du client, ou le temps de réponse de l'opérateur quand l'attaque a atterri. La note n'était pas *fausse*; elle n'était juste pas *complète*.

## Le piège du jeu de score — quand la note ment parce que l'opérateur l'a aidée

Il y a des façons honnêtes pour une Secure Score de monter (implémenter les recommandations) et des façons malhonnêtes. Les opérateurs glissent parfois — sous pression, à court de temps, ou parce que le client surveille le chiffre — dans les façons malhonnêtes. C'est le piège du jeu de score, et le reconnaître dans votre propre travail fait partie de la discipline professionnelle.

Les trois patrons de jeu les plus fréquents :

**1. « Resolved through third party » sans tiers.** La leçon 2 a présenté l'option : quand un outil non-Microsoft couvre vraiment la même fonction de sécurité, vous pouvez marquer une recommandation comme résolue et obtenir les points. Certains opérateurs appliquent ça à des recommandations qu'ils ne veulent simplement pas implémenter, en réclamant une couverture « tiers » qui n'existe pas ou qui ne couvre pas vraiment la fonction. La note monte. La sécurité non. Le risque d'audit est le même.

**2. Marquer une implémentation « complète » alors qu'elle ne l'est pas.** Certaines recommandations Secure Score vérifient une configuration de tenant que Microsoft peut valider automatiquement (binaire : le paramètre est-il on ou off?). D'autres exigent une auto-attestation de l'opérateur — « oui, on a complété ça ». Quand un opérateur marque quelque chose complet sans vraiment l'avoir complété, la note reflète l'attestation, pas la réalité. Dans certains contextes de conformité, c'est carrément de la fraude.

**3. Mettre des recommandations en Risk-Accepted pour effacer le bruit visuel.** Les recommandations assises à zéro point tirent le pourcentage vers le bas. Les Risk-Accepted ne fait pas bouger les points mais change la présentation visuelle dans le portail. Un opérateur qui met en Risk-Accepted tout ce qu'il ne peut pas ou ne veut pas implémenter est honnête. Un opérateur qui met en Risk-Accepted des items qui *devraient* être implémentés — parce que ça fait paraître le tableau de bord plus propre — joue le score. La ligne entre l'hygiène (Risk-Accepted ce qui n'est vraiment pas applicable) et le jeu (Risk-Accepted ce qui est inconvenant), c'est le jugement professionnel de l'opérateur.

Le test honnête pour n'importe laquelle de ces : seriez-vous à l'aise de montrer la recommandation et l'action prise au client dans une rencontre de renouvellement? « On a marqué Customer Lockbox comme Risk Accepted parce que le tenant n'a pas la licence E5 et on a documenté les alternatives qu'on utilise à la place » — défendable. « On a marqué Defender for Identity comme Resolved through third party parce que… euh… ben, le chiffre de la note est mieux comme ça » — pas défendable.

## Des recommandations qui sont notées mais opérationnellement douloureuses

Un piège séparé : certaines recommandations Secure Score sont configurées pour donner des points pour des paramètres qui, quand ils sont implémentés aveuglément, font mal aux opérations du client. Les implémenter correctement exige le réglage spécifique au client que la note ne mesure pas.

Exemples :

**« Activer Controlled Folder Access en mode Block. »** La carte 4 leçon 7 a couvert ça directement. Microsoft donne plus de points Secure Score pour CFA mis à Block qu'à Audit — Block empêche vraiment les écritures dans les dossiers protégés par des apps non listées dans la liste d'autorisation, tandis qu'Audit les journalise seulement. Mais le mode Block sans liste d'autorisation d'apps spécifique au client génère une avalanche de tickets de soutien le jour un : outils de sauvegarde qui écrivent dans les documents utilisateur, clients de synchronisation (Dropbox, Google Drive, variantes OneDrive), apps créatives qui écrivent dans Documents, outils de productivité qui sauvegardent automatiquement. Le modèle ASR de Panoptica365 livre CFA en mode Audit précisément parce que Block dès le départ est opérationnellement intenable. Basculer CFA en Block uniquement pour les points Secure Score, sans la revue de journaux d'audit et la construction de la liste d'autorisation, casse des flux légitimes. Le bon patron opérateur, c'est celui de la leçon 7 : livrer en Audit, surveiller deux à quatre semaines, construire la liste d'autorisation à partir des tentatives d'écriture en mode audit, puis basculer en Block. La note bouge à la fin, pas au début.

**« Bloquer l'authentification héritée. »** La carte 3 leçon 3 a déjà couvert ça — et c'est le bon appel. Mais si vous l'implémentez sans d'abord identifier les imprimantes héritées, les applications métier héritées, et les flux de travail incompatibles avec MFA que le client a, vous brisez des choses. La note bouge; le service de soutien déborde. Le bon patron opérateur, c'est l'audit pré-vol suivi du déploiement, pas le déploiement tout seul.

**« Désigner plus d'un administrateur global. »** Microsoft récompense le fait d'avoir plusieurs administrateurs globaux (résilience contre la perte d'accès de l'un d'eux). Certains clients n'en ont qu'un — souvent délibérément, souvent pour de bonnes raisons (surface d'attaque plus petite, audit plus simple). Implémenter la recommandation en ajoutant plus d'administrateurs globaux sans réfléchir ajoute de la surface d'attaque pour la note. La discipline de durcissement admin de la carte 3 leçon 6 est la bonne réponse ici.

Ces recommandations ne sont pas de mauvaises recommandations. Ce sont des recommandations qui exigent du jugement opérateur sur *comment* implémenter, pas juste *si* implémenter. La note ne récompense pas le jugement; elle récompense l'état de configuration.

## Les recommandations que la note ne suit pas du tout

C'est le cœur de la leçon. Une fraction significative du travail sécurité qu'un MSP compétent fait est invisible à Microsoft Secure Score. Pas parce que Microsoft ne pense pas que ça compte — mais parce que la note ne peut mesurer que ce que Microsoft peut vérifier programmatiquement dans le tenant.

**Publication et application de DMARC et SPF.** Tout le parcours SPF / DKIM / DMARC de `p=none` à `p=reject` compte énormément pour la protection contre l'usurpation par courriel entrant. **L'activation DKIM** (la bascule côté tenant dans le centre d'administration M365) est notée — Microsoft peut la vérifier. **La publication SPF et DMARC ne le sont pas** — ce sont des enregistrements DNS externes que Microsoft ne peut pas vérifier de façon fiable à l'échelle de chaque tenant M365 dans le monde, donc la note ne les inclut pas. Les clients qui ont fait tout le travail d'authentification courriel ont l'air pareils dans Secure Score que les clients qui ont seulement activé DKIM. Le travail compte; la note ne le mesure pas.

**Discipline opérationnelle.** Temps de triage de dérive. Temps de réponse aux alertes. Maintenance du registre d'exceptions. Complétion des revues annuelles. La discipline de *vraiment faire le travail entre les instantanés* — c'est toute la thèse opérationnelle des cartes 4 et 5, et rien de tout ça n'apparaît dans la note. Un tenant dont le MSP répond aux alertes de dérive en une heure a la même note qu'un tenant dont le MSP répond en une semaine, à configuration courante identique.

**Réglage spécifique au client.** Listes d'utilisateurs protégés anti-hameçonnage. Listes d'expéditeurs de confiance portées à des partenaires d'affaires précis. Exceptions de transfert automatique Remote Domain par client. Audit des règles de flux de courrier. Tout le contenu de la carte 5. L'activation de la politique de sécurité prédéfinie est notée; le réglage spécifique au client en dessous ne l'est pas.

**Capacité de réponse aux incidents.** Le MSP a-t-il un runbook écrit de réponse aux BEC? L'a-t-il testé? Y a-t-il un chemin de contact hors heures de bureau pour le client? L'équipe d'opérateurs peut-elle exécuter un reset d'identifiants / révocation de session / audit des règles de boîte de réception en 30 minutes quand une alerte se déclenche? Rien de tout ça n'est noté. Rien de tout ça ne fait partie de l'ensemble de recommandations de Microsoft.

**Hygiène courriel des fournisseurs et partenaires.** L'attaque à 92 % de l'ouverture est venue par un fournisseur compromis. Si les fournisseurs du client ont une authentification courriel correcte, s'ils ont été compromis récemment, si le processus de vérification de virement du client traite les messages venant des fournisseurs avec un scepticisme approprié — tout ça non noté.

**Sensibilisation à la sécurité des utilisateurs.** Taux de complétion des simulations d'hameçonnage. Ratios formés/non formés. Taux de signalement par utilisateur. Rien de tout ça n'est directement dans Microsoft Secure Score (Attack Simulation Training est E5 seulement, et même ça note la configuration de l'outil de simulation, pas les résultats de la formation des utilisateurs du client).

La liste pourrait continuer. Le patron : **tout ce qui exige du jugement humain, du travail opérationnel continu, ou de la visibilité sur des choses que Microsoft ne peut pas vérifier programmatiquement sur l'environnement du client est non noté.** La Secure Score mesure l'instantané de configuration. Le travail non noté, c'est ce qui garde le client en sécurité dans les moments entre les instantanés.

## Pourquoi courir après 100 % est le mauvais objectif

Une Secure Score de 100 % est atteignable en principe mais rarement correcte en pratique. Raisons :

- **Certaines recommandations ne conviennent pas à certains clients.** Un petit cabinet comptable n'a pas besoin d'Insider Risk Management. Forcer la recommandation au statut « complète » avec une fausse attribution tiers, c'est jouer le score.
- **Les recommandations conditionnées par licence exigent des mises à niveau de licence.** Un client Business Premium ne peut pas honnêtement implémenter des fonctionnalités E5. Les mettre en Risk-Accepted et accepter un pourcentage plus bas est plus honnête que de jouer le contournement.
- **Certaines recommandations entrent en conflit avec les réalités opérationnelles du client.** Politique de pourriel sortant mise à son action restreindre-et-bloquer la plus stricte sans régler pour les expéditeurs légitimes à haut volume du client (vendeurs en journée de campagne, communications qui envoient la lettre annuelle aux employés). Plusieurs administrateurs globaux sur une entreprise à un seul propriétaire. Blocage d'auth héritée sur un tenant avec des applications métier héritées critiques qui n'ont pas encore été modernisées.
- **Les points marginaux au-dessus de ~88 % demandent des rendements décroissants.** Chaque recommandation qui reste contribue moins; le coût opérationnel pour l'implémenter est souvent disproportionné par rapport au gain de sécurité.

Le bon objectif Secure Score, pour les clients Business Premium qui roulent l'écosystème complet, c'est **80 % ou plus avec des décisions Risk Accepted honnêtes documentées pour tout ce qui est en dessous**. La fin des 80 est atteignable pour les clients où l'opérateur a fait tout le travail d'implémentation. 90 % et plus exige que des facteurs spécifiques au client s'alignent (aucune recommandation E5 applicable, aucune contrainte opérationnelle) et vient rarement de chasse incrémentale au score.

La leçon 6 couvre le cadrage de cible en détail opérationnel. Pour cette leçon-ci, le principe : une cible de 100 % distord le travail. Une cible de 80 % avec discipline le focalise.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**Secure Score mesure la configuration, pas la sécurité.** L'histoire du 92 % qui s'est fait BEC, c'est le cas d'avertissement que chaque opérateur a besoin d'avoir en tête. Une note élevée, c'est un accomplissement de configuration; ce n'est pas une garantie de sécurité. Utilisez-la comme un signal parmi plusieurs, pas comme la conclusion principale.

**Reconnaissez les patrons de jeu de score dans votre propre travail.** « Resolved through third party » sans tiers. Auto-attestation sans suivi. Risk-Accepted pour effacer le bruit visuel plutôt que pour documenter une non-applicabilité véritable. Faciles à glisser dedans sous pression. Le test honnête : défendriez-vous l'action au client dans une rencontre de renouvellement? Si non, ne la prenez pas.

**Le travail non noté, c'est ce qui garde le client en sécurité.** Publication DMARC, triage de dérive, maintenance du registre d'exceptions, réglage spécifique au client, capacité de réponse aux incidents, sensibilisation à l'hygiène courriel des fournisseurs — rien de ça ne note, tout ça compte. La valeur professionnelle de l'opérateur est largement dans le travail non noté. Communiquez ça aux clients explicitement; ne les laissez pas confondre la note avec l'histoire complète.

## Ce qui suit

- **Leçon 5 : Secure Score face client.** Comment se servir du pourcentage honnêtement dans les conversations avec les clients — le récit de renouvellement, la tendance dans le temps, l'histoire de la base de référence à l'accueil.
- **Leçon 6 : Opérer Secure Score à l'échelle + fermer le curriculum.** La cadence de revue trimestrielle, le cadrage de la cible 80 % et plus, et l'argument de fermeture du curriculum.

Pour l'instant : prenez le client avec la plus haute Secure Score de votre carnet. Regardez sa liste de recommandations. Pour chaque recommandation marquée « Resolved through third party », pouvez-vous nommer l'outil tiers et confirmer qu'il couvre vraiment la fonction? Pour chaque « Risk Accepted », pouvez-vous défendre la raison d'acceptation? Les patrons de jeu sont habituellement silencieux — les trouver dans votre propre travail, c'est la discipline. Trouvez-les avant qu'un client ou un auditeur ne les trouve.

---

*Sources des données dans cette leçon — Microsoft Learn sur les limites de Secure Score et ce que mesure la métrique ([Microsoft Learn — Microsoft Secure Score overview](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score)); options de statut de recommandation incluant tiers et Risk Accepted ([Microsoft Learn — Track recommendation completion](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-improvement-actions)); contexte des patrons d'attaque BEC et AiTM ([CISA — Business Email Compromise](https://www.cisa.gov/topics/cyber-threats-and-advisories/business-email-compromise-bec)); modes Controlled Folder Access (Audit vs Block) et considérations opérationnelles ([Microsoft Learn — Controlled Folder Access](https://learn.microsoft.com/en-us/defender-endpoint/controlled-folders)); guidance de bonnes pratiques pour les administrateurs globaux ([Microsoft Learn — Protect admin accounts](https://learn.microsoft.com/en-us/microsoft-365/admin/security-and-compliance/protect-global-admin)).*
