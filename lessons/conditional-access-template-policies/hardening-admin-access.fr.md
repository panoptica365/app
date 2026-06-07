---
title: "Durcir l'accès admin — MFA plus fort, sessions plus courtes"
subtitle: "Quatre modèles d'AC : MFA résistant au hameçonnage, sessions limitées et protection des portails admin."
icon: "user-lock"
last_updated: 2026-05-29
---

# Durcir l'accès admin — MFA plus fort, sessions plus courtes

En 2024, l'équipe Defender de Microsoft a analysé des événements de compromission à travers des milliers de tenants clients et a trouvé un patron qui n'avait pas changé depuis 2020 : les compromissions les plus dommageables impliquaient invariablement un compte avec des privilèges administratifs. La brèche qui commence avec un stagiaire en marketing hameçonné est mauvaise. La brèche qui commence avec un Global Admin hameçonné est catastrophique.

Les protections qui fonctionnent pour « les utilisateurs en général » ne fonctionnent pas toujours pour les admins spécifiquement. Un Global Admin qui complète le push Authenticator chaque matin a techniquement fait MFA, mais c'est aussi exactement l'utilisateur contre qui un kit d'hameçonnage AiTM est le plus disposé à investir des efforts. Un utilisateur privilégié connecté avec des sessions de navigateur persistantes peut garder cette session active pendant des jours, donnant à un attaquant qui compromet sa machine des jours d'accès. La surface d'attaque admin mérite sa propre attention.

Cette leçon couvre quatre modèles d'AC Panoptica365 qui, ensemble, durcissent la surface d'attaque admin sous quatre angles différents. Chaque modèle tient debout seul, mais en pratique ils sont déployés ensemble pour le même ensemble de comptes admin.

- **Panoptica365 - Require MFA for admins** — MFA toujours exigé, pour les comptes admin, sur chaque app.
- **Panoptica365 - Require MFA challenge Admin Portals** — MFA exigé pour accéder aux portails admin, pour tous les utilisateurs (pas seulement les admins).
- **Panoptica365 - Require MFA for Azure management** — MFA exigé pour accéder aux points de terminaison de gestion Azure, pour tous les utilisateurs.
- **Panoptica365 - Disable persistent browser sessions for Admins** — Les sessions de navigateur d'admin ne survivent pas à la fermeture du navigateur.

Les trois premières ajoutent une barre MFA plus forte à l'activité liée aux admins. La quatrième raccourcit la durée de vie de la session admin. Ensemble, elles appliquent un durcissement à quatre branches aux identités les plus conséquentes du tenant.

## Les quatre modèles, en détail

### Exiger MFA pour les admins

Description : *Tous les admins doivent utiliser MFA.* Octroi : Exiger MFA. Utilisateurs : Utilisateurs/groupes spécifiques (le groupe d'admins). Applications : Toutes les applications infonuagiques.

C'est l'équivalent-admin du modèle Exiger MFA pour tous les utilisateurs de la leçon 2. Le modèle de la leçon 2 couvre tout le monde; celui-ci s'assure que même si la leçon 2 n'est pas activée d'une manière ou d'une autre, les comptes admin ont encore le MFA appliqué. C'est la politique ceinture-et-bretelles pour les comptes à plus haute valeur.

La portée « Utilisateurs/groupes spécifiques » pointe typiquement vers un groupe de sécurité nommé quelque chose comme « Tenant Admins » ou « Identités privilégiées » — peu importe ce que le client utilise pour identifier les comptes admin dans son annuaire. Le groupe devrait inclure tous ceux qui ont des rôles d'admin au niveau de l'annuaire (Global Admin, User Admin, Helpdesk Admin, Exchange Admin, SharePoint Admin, etc.).

Quand ce modèle est déployé aux côtés du « Exiger MFA pour tous les utilisateurs » de la leçon 2, la politique admin est principalement redondante pour les connexions normales (la leçon 2 couvre déjà les comptes admin parce que les admins sont des utilisateurs). Mais la politique admin fournit une vérification de défense en profondeur critique : si la leçon 2 est jamais désactivée, affaiblie, ou a une liste d'exclusions qui grandit pour inclure des comptes admin par erreur, ce modèle les attrape encore.

### Exiger défi MFA Portails Admin

Description : *Exiger défi MFA pour les admins accédant aux portails admin.* Octroi : Exiger MFA. Utilisateurs : Tous les utilisateurs. Applications : 1 app (Microsoft Admin Portals).

Ce modèle attaque le problème sous un angle différent : au lieu de restreindre *qui* doit MFA (le groupe d'utilisateurs admin), il restreint *quoi* doit MFA (les portails admin). Le service « Microsoft Admin Portals » dans Entra ID représente le groupement de portails face aux admins — centre d'administration Entra, centre d'administration Intune, centre d'administration Microsoft 365, centre d'administration Exchange, etc.

Pourquoi ça compte : une connexion à une application infonuagique régulière et une connexion au portail admin sont *des connexions différentes* du point de vue de Microsoft. Un utilisateur pourrait avoir déjà complété MFA il y a une heure quand il a ouvert Outlook, et ensuite cliquer dans le centre d'administration Entra sans être à nouveau défié. Le MFA précédemment complété satisfait la politique de la leçon 2 / leçon 5 parce qu'il est déjà MFA'd dans la session.

Ce modèle force un prompt MFA *frais* spécifiquement lors de l'accès aux portails admin — même si l'utilisateur est déjà connecté avec MFA ailleurs. L'intention est de s'assurer que l'utilisateur démontre sa présence actuelle spécifiquement au moment où il est sur le point d'effectuer une action de niveau admin. Un attaquant qui a volé un cookie de session il y a une heure n'a pas le MFA actuel; la politique l'attrape quand il essaie d'élever.

La portée « Utilisateurs : Tous les utilisateurs » est délibérée. Les utilisateurs normaux ne devraient pas accéder aux portails admin du tout, mais si un invité mal configuré ou un utilisateur GDAP délégué clique dedans, ils doivent MFA. Les admins qui ont déjà MFA'd récemment verront un prompt MFA supplémentaire; le coût de friction est petit, le bénéfice de sécurité est grand.

### Exiger MFA pour la gestion Azure

Description : *La gestion Azure exige MFA.* Octroi : Exiger MFA. Utilisateurs : Tous les utilisateurs. Applications : 1 app (Microsoft Azure Management).

Même logique structurelle que le modèle portails admin, mais spécifiquement pour les points de terminaison de gestion Azure — portail Azure, Azure CLI, Azure PowerShell, API REST ARM, le tout. La gestion Azure est une surface particulièrement sensible parce que les ressources là-bas ont souvent une confiance implicite envers d'autres parties de l'infrastructure du client (identités gérées, attributions de rôle).

La raison d'un modèle séparé (vs le couvrir via la politique des portails admin) : la gestion Azure est suivie comme une application distincte dans Entra. Le centre d'administration M365 de Microsoft et la surface de gestion Azure de Microsoft sont des apps séparées, même si elles ont toutes deux l'air de « trucs admin ». Si vous voulez les deux couvertes, vous avez besoin des deux modèles.

Si un client n'utilise pas Azure du tout (aucun abonnement Azure, juste M365), ce modèle est techniquement inutile. Il est aussi inoffensif à activer — il ne se déclenche simplement pour aucune connexion. Déployez-le quand même pour la compatibilité future; le jour où le client ajoute un abonnement Azure, la politique est déjà en place.

### Désactiver les sessions de navigateur persistantes pour les Admins

Description : *Les admins devront s'authentifier après avoir fermé leur navigateur.* Octroi : Aucun. Utilisateurs : Utilisateurs/groupes spécifiques (le groupe d'admins). Applications : Toutes les applications infonuagiques. Session : Session de navigateur persistante = Jamais persistante.

C'est un contrôle de session, pas un contrôle d'authentification. Les trois politiques ci-dessus gouvernent *si* le MFA arrive. Cette politique gouverne *combien de temps* une connexion reste valide.

Par défaut, quand un utilisateur se connecte et clique « Oui, gardez-moi connecté » ou quand le navigateur garde un cookie de session, la session peut persister à travers les redémarrages du navigateur. Fermez le navigateur à 17 h, ouvrez-le à 9 h le lendemain, vous êtes encore connecté — aucune ré-authentification nécessaire.

Pour les admins, c'est trop long. Un attaquant qui compromet le portable d'un admin après les heures a une fenêtre d'opportunité qui dure jusqu'à la prochaine fois que la session de l'admin expire naturellement — ce qui pourrait être des jours. Désactiver les sessions de navigateur persistantes pour les admins signifie que chaque fermeture de navigateur termine la session; l'admin se reconnecte à neuf quand il rouvre son navigateur.

Le coût de friction est réel (les admins se connectent plus souvent). Le bénéfice de sécurité est aussi réel : la fenêtre pendant laquelle un appareil volé ou une session détournée peut être utilisée se rétrécit dramatiquement. Pour les comptes au niveau admin, le compromis favorise la sécurité.

Cette politique est la chose la plus proche de « fréquence de connexion = chaque session » que Microsoft offre. Le mécanisme est légèrement différent (il désactive la persistance de session plutôt que de plafonner la durée de session) mais le résultat effectif est similaire.

## Pourquoi quatre modèles, pas une grosse politique « durcir les admins »

Question raisonnable : pourquoi ne pas combiner les quatre en un seul modèle?

Trois raisons :

**Différences de portée.** La leçon 6.1 (Exiger MFA pour les admins) se cadre par *groupe d'utilisateurs* — elle s'applique aux admins peu importe quelle app ils utilisent. Les leçons 6.2 (Portails Admin) et 6.3 (gestion Azure) se cadrent par *application* — elles s'appliquent à quiconque accède à ces portails. La leçon 6.4 (Désactiver navigateur persistant) se cadre par groupe d'utilisateurs et applique un *contrôle de session* plutôt qu'un contrôle d'octroi. Ces différents modèles de cadrage ne se combinent pas proprement dans une seule politique d'AC.

**Application indépendante.** Chaque modèle fournit une défense à une couche différente. MFA-admin couvre l'identité. MFA-portail couvre la présence fraîche. MFA-Azure couvre une app spécifique à haut risque. Session-navigateur couvre la persistance de session. Si l'un est mal configuré ou a une exclusion qui grandit avec le temps, les autres fournissent encore une couverture. Les séparer garde les modes d'échec indépendants.

**Clarté opérationnelle.** Chaque modèle a son propre nom, sa propre description, sa propre piste d'audit. Quand le détecteur de dérive Panoptica365 signale un changement, l'opérateur sait exactement quelle protection a bougé. Un modèle monolithique « durcir les admins » obscurcirait quelle protection spécifique a changé.

## Ce que « admin » signifie pour ces modèles

Le groupe d'utilisateurs admin est une définition spécifique au client. Pour la plupart des tenants, il devrait inclure :

- **Administrateur Global** — contrôle complet de l'annuaire. Tous ceux dans ce rôle.
- **Administrateur de rôle privilégié** — peut gérer les attributions de rôle. Cible à haute valeur.
- **Administrateur d'accès conditionnel** — peut changer les politiques d'AC. Particulièrement dangereux s'il est compromis parce qu'il peut désactiver d'autres politiques.
- **Administrateur de sécurité, Lecteur de sécurité** — gère les alertes et configurations de sécurité.
- **Administrateur Exchange, Administrateur SharePoint, Administrateur Teams** — contrôlent des services spécifiques.
- **Administrateur d'utilisateurs, Administrateur de Helpdesk** — peuvent réinitialiser les mots de passe et gérer l'inscription MFA.
- **Administrateur d'authentification** — peut gérer les méthodes MFA.

La liste spécifique du client dépend de sa structure. Un petit tenant peut n'avoir que deux admins. Un plus grand peut avoir une douzaine de rôles distincts. La bonne adhésion de groupe est « quiconque, s'il était compromis, pourrait causer des dommages significatifs ». Ça correspond habituellement à quiconque avec un rôle d'admin au niveau de l'annuaire plus quiconque avec des permissions de gérer des ressources privilégiées (abonnements Azure, sites SharePoint avec données sensibles, etc.).

**Privileged Identity Management (PIM)** — disponible seulement à E5 — change cette conversation. Avec PIM, les utilisateurs n'ont pas de rôles admin permanents; ils activent des rôles temporairement au besoin. Le groupe d'utilisateurs admin dans un tenant avec PIM activé peut être vide la majeure partie de la journée, peuplé seulement quand un utilisateur active un rôle.

Pour les tenants avec PIM, les modèles de durcissement admin devraient quand même cibler le *bassin* d'utilisateurs *éligibles* à activer des rôles admin, pas seulement les admins actuellement actifs. La protection doit être en place avant que l'utilisateur active, pas après.

## Forces d'authentification — quand passer de MFA à résistant à l'hameçonnage

Les modèles ci-dessus utilisent tous « Exiger MFA » sans spécifier quelle méthode MFA. Par défaut, ça accepte n'importe quelle méthode MFA que l'utilisateur a inscrite — push Authenticator, SMS, voix, jeton matériel, etc.

Pour les admins, la bonne barre est *MFA résistant à l'hameçonnage* — clés FIDO2, passkeys, ou Windows Hello Entreprise. Les notifications push sont vulnérables à la fatigue (carte 2 leçon 2). Le SMS est vulnérable au SIM swap. La voix est vulnérable à l'ingénierie sociale. Seules les méthodes résistantes à l'hameçonnage sont immunisées au patron d'attaque AiTM de la carte 2 leçon 3.

Dans Entra ID, c'est configuré via les **forces d'authentification** — les politiques d'accès conditionnel peuvent spécifier quelle force d'authentification est exigée. Microsoft livre plusieurs forces d'authentification :

- *Authentification multifacteur* (n'importe quelle méthode MFA)
- *MFA sans mot de passe* (n'importe quelle méthode sans mot de passe, y compris Windows Hello et Authenticator sans mot de passe)
- *MFA résistant à l'hameçonnage* (FIDO2, passkeys, basé sur certificat, Windows Hello Entreprise seulement)

Les modèles MFA-admin Panoptica365 livrés utilisent l'octroi « Exiger MFA » par défaut, qui accepte n'importe quelle méthode MFA. Pour les clients qui veulent passer à résistant à l'hameçonnage pour les admins, la personnalisation est :

1. Ouvrir la politique Exiger MFA pour les admins déployée dans le portail Entra.
2. Sous Contrôles d'octroi, changer « Exiger l'authentification multifacteur » à « Exiger la force d'authentification : MFA résistant à l'hameçonnage ».
3. Vérifier (en rapport uniquement ou en vérifiant les inscriptions de méthodes d'authentification admin) que les admins affectés ont des clés FIDO2 ou des passkeys inscrites.
4. Appliquer le changement.

La même mise à niveau peut être appliquée aux modèles Portails Admin et gestion Azure si le client veut exiger MFA résistant à l'hameçonnage spécifiquement pour ces connexions à haute valeur.

Quand pousser cette mise à niveau :

- Clients qui ont déjà été compromis une fois (le durcissement post-incident).
- Clients avec données réglementées (finance, santé, fournisseurs gouvernementaux).
- Clients avec suffisamment de couverture Intune pour émettre des appareils gérés avec Windows Hello Entreprise.
- Clients prêts à fournir des clés FIDO2 pour le personnel admin (typiquement un investissement matériel de 40 à 60 $ par admin).

Pour les tenants sans ces moteurs, le défaut « Exiger MFA » est le bon point de départ. La mise à niveau résistante à l'hameçonnage est un chemin crédible en avant quand la posture de sécurité du client mûrit.

## Déploiement

Les quatre modèles admin se déploient ensemble. Ils se déploient tous à l'état Activé.

Pré-déploiement : confirmez que le groupe d'utilisateurs admin est bien défini, que le compte break-glass est exclu des quatre modèles, que les admins savent ce qui s'en vient. Plus important encore, **vérifiez que chaque admin a un MFA résistant à l'hameçonnage inscrit** (ou au moins push Authenticator). Si un admin n'a pas de MFA inscrit, il est verrouillé au moment où la politique s'applique.

Pour les tenants de petite entreprise avec un groupe d'admins petit, bien connu, et avec inscription MFA vérifiée, déployez et surveillez de près. Pour les tenants plus grands avec plusieurs admins, inscription MFA mixte, ou politiques d'AC existantes complexes, l'étape manuelle de rapport uniquement dans le portail Entra est recommandée. Déployez via Panoptica365 (crée à l'état Activé), puis dans le portail Entra basculez les quatre politiques en rapport uniquement. Exécutez une fenêtre de 3 à 7 jours.

Pendant la fenêtre de vérification (que ce soit rapport uniquement ou surveillance en direct après le déploiement), vérifiez les correspondances de chaque modèle :

- Exiger MFA pour les admins : devrait correspondre à chaque connexion d'admin.
- Portails Admin : devrait correspondre à chaque accès aux portails admin (admin ou non-admin).
- Gestion Azure : devrait correspondre aux accès au portail Azure / CLI.
- Session de navigateur persistante : devrait correspondre à chaque session de navigateur admin.

Pour chaque modèle : les correspondances sont-elles ce à quoi vous vous attendez? Des utilisateurs non-admin inattendus qui frappent les politiques des portails? Des admins sans activité récente sur les portails admin? Enquêtez sur les anomalies.

Après l'application, surveillez pendant deux semaines :

- Les connexions admin devraient compléter MFA plus fréquemment (les politiques portails-admin et gestion-Azure se déclencheront même quand l'admin est déjà MFA'd dans sa session générale).
- Les admins qui rouvrent leurs navigateurs devraient voir des prompts de connexion frais (politique session-navigateur-persistante).
- Aucun admin ne devrait être verrouillé — vérifiez après le déploiement que chaque admin s'est connecté avec succès.

## À surveiller après l'application

**Défis MFA admin échoués.** Les rafales de MFA échoués sur des comptes admin sont les alertes à plus haute priorité dans votre file. Encore plus que pour les utilisateurs réguliers, c'est le patron qui précède une compromission sérieuse. Traitez avec urgence maximale.

**Connexions admin depuis des emplacements inattendus.** Les alertes d'IP étrangère ou de déplacement impossible sur des comptes admin ne sont pas des événements « voyage en famille » — elles sont soit un travail admin planifié, soit une tentative de compromission. Vérifiez avant de résoudre.

**Dérive sur n'importe lequel des quatre modèles.** Tout changement aux politiques admin — changement de portée, changement de contrôle, désactivation — devrait être audit-journalisé et révisé. Le détecteur de dérive AC de Panoptica365 couvre ça. La dérive de politique admin est la catégorie de dérive de plus haute gravité.

**Nouvelles méthodes ajoutées à l'authentification admin.** Quand un admin ajoute une nouvelle méthode MFA, le patron d'attaquant post-compromission (carte 2 leçon 3 — enregistrer-une-nouvelle-méthode-MFA après AiTM) s'applique doublement pour les admins. Traitez les nouveaux enregistrements de méthodes d'authentification admin comme des événements demandant confirmation.

## Ce que Panoptica365 voit

Le widget Activité quotidienne montre le volume de défis MFA admin; le décompte de blocages d'AC s'élève avec les modèles admin qui s'appliquent. Spécifiquement :

- Prompts MFA admin (défis) — devraient être stables à quelques par admin par jour.
- Blocages d'AC sur les modèles admin — devraient être rares; chacun est un admin ou non-admin qui essaie d'accéder à une surface admin sans MFA. Enquêtez sur chaque blocage.
- Alertes de dérive sur n'importe lequel des quatre modèles — se déclenchent dans le cadre du pipeline de détection de dérive AC.

Le moteur d'alertes Panoptica365 traite les alertes de compte admin à une gravité plus élevée que les alertes d'utilisateur régulier par défaut. Une alerte MFA-désactivé admin (un de ces modèles désactivé) est un événement à haute gravité; une connexion admin d'IP étrangère est à haute gravité; un enregistrement de nouvelle méthode d'auth admin est à haute gravité.

## Ce que ça veut dire pour l'opérateur

Quatre points à retenir pour le travail quotidien.

**Déployez ces quatre modèles comme un ensemble.** Ils protègent différents angles du même problème. En déployer juste un ou deux laisse des trous dans la surface d'attaque admin.

**Définissez le groupe admin avec soin.** Quiconque avec des rôles admin au niveau de l'annuaire, plus quiconque avec un accès privilégié à des ressources de haute valeur. Les tenants avec PIM activé devraient cibler le bassin d'*admins éligibles*, pas seulement les admins actuellement actifs.

**Le coût de friction est réel mais en vaut la peine.** Les admins verront plus de prompts MFA, des connexions plus fréquentes. C'est le compromis voulu. L'alternative — politiques de connexion admin plus lâches pour la commodité — est exactement la brèche que les attaquants exploitent.

**Planifiez la mise à niveau au MFA résistant à l'hameçonnage.** Les politiques admin-MFA par défaut « Exiger MFA » devraient être mises à niveau à « Exiger MFA résistant à l'hameçonnage » quand les admins ont des clés FIDO2 ou des passkeys inscrites. C'est la mise à niveau de sécurité unique à plus haut levier pour la posture admin de n'importe quel client.

## Ce qui suit

- **Leçon 7 : Désactiver le flux de code d'appareil.** La défense Storm-2372, comme modèle d'AC dédié.
- **Leçon 8 : Importer vos propres modèles d'AC.** Comment personnaliser les modèles de durcissement admin (ou n'importe quoi d'autre) pour les préférences propres d'un MSP.

Pour l'instant : ces quatre modèles sont la fondation de la sécurité admin dans M365. Un client qui a les quatre déployés a une protection matériellement meilleure contre la classe de compromission la plus conséquente. Un client qui n'a que « Exiger MFA pour tous les utilisateurs » activé est encore exposé à la couche admin parce que les chemins spécifiques aux admins (accès portail, gestion Azure, persistance de session) ne sont pas couverts. Déployez les quatre modèles ensemble.

---

*Sources des données dans cette leçon — Microsoft Learn sur l'accès conditionnel pour la protection des admins ([Microsoft Learn — Conditional Access policies and admins](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/best-practices)); Microsoft Admin Portals comme cible d'AC ([Microsoft Learn — Microsoft Admin Portals app](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-cloud-apps#microsoft-admin-portals)); vue d'ensemble des forces d'authentification ([Microsoft Learn — Conditional Access authentication strengths](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-strengths)); référence de contrôle de session pour les sessions de navigateur persistantes ([Microsoft Learn — Conditional Access: Session controls](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-session)).*
