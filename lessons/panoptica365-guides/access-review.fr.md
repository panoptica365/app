---
title: "Revue des accès — qui est administrateur, qui est dormant, et votre voie de secours"
subtitle: "Examinez chaque détenteur de rôle privilégié, désactivez ou supprimez les comptes inactifs, et configurez des comptes d'urgence qui contournent l'accès conditionnel et alertent dès qu'on les utilise."
icon: "key-round"
last_updated: 2026-06-13
---

# Revue des accès — qui est administrateur, qui est dormant, et votre voie de secours

L'onglet **Revue des accès** du tableau de bord du locataire répond à trois questions que vous devriez pouvoir trancher pour n'importe quel client : *qui détient des rôles d'administration, quels comptes sont du poids mort, et que se passe-t-il si une stratégie d'accès conditionnel verrouille tout le monde dehors.* Il se trouve entre **Sécurité** et **Applications**, et se compose de deux tableaux et d'un flux pour les comptes d'urgence.

Tout ce qui écrit dans le locataire ici est déclenché par l'opérateur, confirmé et audité — Panoptica365 ne désactive ni ne supprime jamais un compte de lui-même.

## Tableau 1 — Comptes détenant des rôles d'administration

C'est une liste **en lecture seule** de chaque compte détenant un rôle privilégié surveillé, regroupée par palier (les rôles de sommet comme administrateur général d'abord, puis élevé, puis moyen). Pour chaque compte, vous voyez son nom (lié à sa fiche utilisateur dans Entra), son UPN, les rôles qu'il détient, s'il est activé, si la **MFA** est enregistrée, et sa dernière activité.

Deux choses à lire attentivement :

- **MFA enregistré** affiche *Oui*, *Non*, ou un tiret. Un tiret signifie *nous n'avons pas pu lire d'enregistrement pour ce compte* — ce n'est **pas** la même chose que « pas de MFA ». N'agissez pas sur un tiret ; agissez sur un *Non* clair.
- Le **palier de sommet** mérite votre attention. Un administrateur général sans MFA, ou trois administrateurs généraux de plus que ceux que vous vous souvenez d'avoir créés, c'est la situation que ce tableau existe pour révéler.

Il n'y a aucun bouton d'action sur ce tableau — c'est une posture que vous lisez, puis sur laquelle vous agissez ailleurs (dans Entra, ou via le tableau 2 pour les comptes non privilégiés).

## Tableau 2 — Tous les comptes d'utilisateurs

Chaque compte du locataire, avec des filtres : **Tous**, **Membres**, **Invités**, **Inactifs**. Les colonnes sont compte + UPN, type, activé, dernière activité, et actions.

L'**inactivité** est calculée à partir des rapports d'usage de Microsoft 365, et non des journaux de connexion de l'annuaire — ce qui veut dire qu'elle **fonctionne sur Business Standard**, où les journaux de connexion ne sont pas accessibles faute de licence. La colonne de dernière activité affiche la date la plus récente où le compte a fait quoi que ce soit dans Exchange, SharePoint, OneDrive ou Teams ; si c'est plus ancien que le seuil (90 jours par défaut), la date passe au rouge et la ligne est marquée **Inactif**. Un invité qui a été convié mais n'a jamais accepté est étiqueté **Jamais accepté** — le candidat à la suppression le plus net qui soit.

Si le locataire a activé *Afficher les noms masqués d'utilisateurs, de groupes et de sites*, le rapport d'usage revient anonymisé et nous ne pouvons pas associer l'activité aux comptes. Plutôt que de vous montrer du charabia, une note apparaît au-dessus du tableau avec un lien pour désactiver le réglage.

## Désactiver et supprimer des comptes

**Désactiver**, **Activer** et **Supprimer** sont des actions de l'opérateur sur le tableau 2. Chacune ouvre une boîte de confirmation qui nomme le compte, indique ce qui va se passer, et rappelle que l'action est consignée dans le journal d'audit. La suppression vous indique aussi que le compte est **récupérable dans Entra pendant 30 jours** avant que le retrait ne devienne définitif.

Les garde-fous sont appliqués côté serveur, et pas seulement masqués dans l'interface :

- **La suppression est refusée pour tout compte détenant un rôle d'administration.** Retirez d'abord ses rôles dans Entra — cet outil ne vous laissera pas effacer un admin par accident.
- **La désactivation du dernier administrateur général activé est bloquée.** C'est le seul clic qui verrouille un locataire hors de lui-même.
- Un **compte d'urgence** exige une confirmation supplémentaire avant de pouvoir être désactivé ou supprimé.

Chaque désactivation, activation et suppression est écrite dans le journal d'audit MSP **et** dans le journal des changements du locataire, avec l'opérateur, l'UPN cible, l'action et le résultat — de sorte qu'une action négligente ou hostile soit toujours attribuable après coup.

## Comptes d'urgence — un accès de secours bien fait

Un compte d'urgence (« break-glass ») est l'identifiant que vous sortez quand quelque chose a mal tourné : une stratégie d'accès conditionnel mal configurée a verrouillé dehors tous les administrateurs normaux, ou votre fournisseur de MFA est en panne. Son rôle unique est de **contourner les stratégies d'accès conditionnel** pour qu'un humain puisse toujours revenir et réparer les choses.

Panoptica365 procède comme Microsoft le recommande — avec un **groupe** dédié, et non des modifications compte par compte. Ouvrez **Comptes d'urgence** depuis l'onglet Revue des accès. La première fois, vous serez guidé.

### Avant de commencer

Créez d'abord le compte d'urgence dans Entra :

- **Administrateur général**, **sans licence**, infonuagique uniquement, sur le domaine **.onmicrosoft.com**.
- Donnez-lui un **nom générique** — jamais « break glass », « urgence » ou « admin ». Un nom évident est un repère pour un attaquant qui prend pied ; choisissez quelque chose d'anodin (un opérateur utilise *facturation*). Nommez aussi le groupe de façon générique, et n'y gardez que vos comptes d'urgence.
- Microsoft recommande de conserver **au moins deux** comptes d'urgence.

### Indiquez le groupe à Panoptica365

Choisissez votre groupe de sécurité dédié dans le sélecteur — nous affichons le nom mais nous nous appuyons sur l'identifiant immuable du groupe, de sorte qu'un changement de nom ultérieur ne casse rien. Il y a ici un garde-fou strict : si vous choisissez un groupe comptant plus que quelques membres, Panoptica365 vous arrête, car exclure ce groupe de l'accès conditionnel exempterait *tous ses membres* — pointer par erreur sur « Tout le personnel » exempterait toute votre entreprise. Il vérifie aussi qu'il s'agit d'un groupe de sécurité attribué, et non dynamique (on ne peut pas ajouter de membres à un groupe dynamique).

À la confirmation, Panoptica365 **exclut le groupe de chaque stratégie d'accès conditionnel** et vous montre le résultat stratégie par stratégie — exclu, déjà exclu, ou échec. Si une écriture échoue, il vous le dit, plutôt que de prétendre au succès — parce que « exclu de 5 stratégies sur 7 » signifie encore que le compte peut être verrouillé dehors par les deux autres. Dès lors, désigner un compte revient simplement à **l'ajouter au groupe**, et l'état de couverture affiche *« Exclu de N stratégies sur N. »*

Si le locataire est encore sous les **paramètres de sécurité par défaut** (sans accès conditionnel), l'exclusion est impossible — ces paramètres imposent la MFA à tout le monde, sans exclusion. Panoptica365 le dit clairement et suggère de passer à l'accès conditionnel. Vous pouvez tout de même désigner et surveiller le compte ; l'alerte de connexion ci-dessous fonctionne dans tous les cas.

### L'alerte de connexion

Dès qu'un compte d'urgence **se connecte**, Panoptica365 déclenche une alerte **SÉVÈRE** — courriel et billet PSA si vous en avez un de branché. Une vraie connexion d'urgence signifie presque toujours que quelque chose s'est cassé ou que quelqu'un est là où il ne devrait pas, donc elle se veut bruyante. La détection s'appuie sur le journal d'audit unifié : elle **fonctionne sans licence Premium**, et s'appuie sur l'identité stable du compte — elle se déclenche donc même si vous avez changé le domaine du compte.

Une seule connexion produit une seule alerte (et non une par enregistrement d'audit) ; les connexions répétées le même jour incrémentent son compteur de récurrence jusqu'à ce que vous la résolviez.

### La couverture reste garantie

De nouvelles stratégies d'accès conditionnel sont créées au fil du temps, et une exclusion peut être retirée. Panoptica365 vérifie continuellement que votre groupe d'urgence reste exclu de **chaque** stratégie et déclenche une alerte si une brèche s'ouvre — une nouvelle stratégie sans l'exclusion, ou une exclusion qui a été retirée. Et parce que l'exclusion est quelque chose que *vous* avez appliqué, Panoptica365 la considère comme attendue : il ne signalera pas votre propre exclusion d'urgence comme une dérive d'accès conditionnel.

### La seule chose qui a changé pour les comptes d'urgence

Microsoft impose désormais la **MFA aux connexions des portails d'administration au niveau de la plateforme — indépendamment de l'accès conditionnel.** Exclure le compte de toutes les stratégies d'AC ne supprime plus l'invite de MFA, et l'ancien modèle « pas de MFA, juste un mot de passe en coffre » a disparu. Enregistrez une méthode **résistante à l'hameçonnage** sur le compte — une **clé de sécurité FIDO2** — et conservez-la dans le coffre avec le mot de passe. C'est en fait *mieux* pour un compte d'urgence : une clé matérielle ne dépend pas de l'application d'authentification ni d'un signal téléphonique, elle fonctionne donc encore quand c'est justement le chemin de MFA normal qui est en panne.

## Quand utiliser ceci

- **À l'intégration :** examinez la liste des administrateurs, signalez tout admin sans MFA, et configurez deux comptes d'urgence avec un groupe dédié.
- **Périodiquement :** balayez le tableau 2 à la recherche de comptes inactifs et d'invités jamais acceptés ; désactivez ou supprimez avec l'accord du client.
- **Chaque fois qu'une alerte d'urgence se déclenche :** confirmez qu'il s'agissait d'une utilisation planifiée. Sinon, vous venez de prendre quelque chose sur le fait.
- **Après avoir créé de nouvelles stratégies d'AC :** vérifiez l'état de couverture des comptes d'urgence (ou attendez l'alerte de brèche) et réappliquez au besoin.
