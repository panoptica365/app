---
title: "Avant de toucher à un modèle — la liste de vérification pré-déploiement d'AC"
subtitle: "Cinq étapes avant toute politique d'AC : break-glass, inventaire des comptes, rapport uniquement et communication."
icon: "clipboard-check"
last_updated: 2026-05-29
---

# Avant de toucher à un modèle — la liste de vérification pré-déploiement d'AC

Un consultant à Calgary a un jour activé une politique d'accès conditionnel « Exiger MFA pour tous les utilisateurs » à 16 h un vendredi. À 16 h 15, les comptes de service du client — ceux qui font la sauvegarde de nuit, l'entretien SQL, le traitement de factures non assisté — étaient tous en échec d'authentification. Aucun d'entre eux n'avait de MFA. Le consultant ne savait pas qu'ils existaient. Le directeur IT du client l'a appris quand le rapport de sauvegarde du lundi matin est arrivé avec zéro travail réussi sur la fin de semaine.

L'accès conditionnel ne pardonne pas la hâte.

Cette leçon ne traite d'aucun modèle spécifique de la bibliothèque Panoptica365. C'est la liste de vérification pré-déploiement qui s'exécute avant que vous touchiez à *n'importe lequel* d'entre eux. Chaque modèle dans la carte 3 — Exiger MFA, Bloquer l'authentification héritée, la politique géo, l'ensemble de durcissement admin — présume que vous avez fait les cinq choses ci-dessous. Sautez le pré-déploiement et vous livrez un incident un vendredi après-midi.

## Les quatre parties d'une politique d'AC (rappel)

La carte 1 leçon 3 a déjà couvert la boucle de conformité et la structure d'une politique d'AC. La version très courte :

- **Qui** — quels utilisateurs ou groupes la politique s'applique (inclure / exclure).
- **Quoi** — quelles applications ou actions (Exchange, SharePoint, « toutes les applications infonuagiques », gestion Azure).
- **Conditions** — contexte : état de l'appareil, emplacement, risque de connexion, risque utilisateur, application cliente, plateforme.
- **Contrôles** — quoi faire quand la politique correspond : bloquer, exiger MFA, exiger un appareil conforme, exiger Hybrid join, appliquer des contrôles de session.

Chaque modèle d'AC Panoptica365 remplit ces quatre champs avec des valeurs par défaut sensées. Le pré-déploiement consiste à adapter les valeurs par défaut à la réalité d'un client spécifique avant que vous basculiez la politique dans son état actif.

## Cinq étapes pré-déploiement, dans l'ordre

### 1. Identifier le compte break-glass

Chaque tenant M365 devrait avoir au moins un (idéalement deux) compte break-glass — des comptes qui existent dans le seul but de regagner l'accès administratif si chaque autre compte admin est compromis, expiré, verrouillé ou autrement inutilisable.

Les comptes break-glass sont **exclus de chaque politique d'accès conditionnel que vous activez.** Leur MFA n'est pas appliqué via l'AC (ils devraient quand même avoir un MFA résistant à l'hameçonnage inscrit — typiquement une clé FIDO2 stockée physiquement dans une enveloppe scellée dans deux endroits séparés). Ils ne sont pas bloqués par les restrictions géographiques. Ils ne sont pas soumis aux exigences d'appareil conforme.

La raison est structurelle : si chaque politique d'AC s'applique à chaque compte et qu'une politique d'AC se trompe, *personne* ne peut se connecter pour la corriger. Le compte break-glass est le canot de sauvetage.

Avant de toucher à n'importe quel modèle d'AC :

- Confirmez que le client a au moins un compte break-glass.
- Confirmez qu'il a un MFA résistant à l'hameçonnage inscrit (passkey, clé FIDO2 ou similaire).
- Confirmez qu'il est dans la liste d'exclusion de chaque politique d'AC que vous êtes sur le point de déployer.
- Confirmez que les identifiants sont stockés quelque part où l'équipe légitime de réponse d'urgence peut y accéder — et quelque part où le rançongiciel ne peut pas.

Si l'un des quatre manque, *arrêtez le déploiement*. Réglez l'histoire du break-glass d'abord.

### 2. Inventorier les comptes de service et les charges de travail non assistées

Les comptes de service sont la cause la plus courante d'incidents d'accès conditionnel un vendredi après-midi. Ils s'authentifient typiquement par mot de passe (sans MFA), souvent depuis une IP fixe qui peut ou non être dans vos emplacements de confiance, souvent en utilisant des protocoles hérités, et ils se brisent bruyamment quand une politique qui n'a pas été conçue pour eux se déclenche sur eux.

Avant d'activer une politique, tirez la liste des comptes de service dans le tenant. Vérifiez :

- Quelles applications les utilisent (agents SQL Server, principaux de service de scan-vers-courriel, authentification d'apps métier, etc.).
- De quelles adresses IP ils se connectent.
- S'ils utilisent l'authentification moderne ou héritée.
- Quelles permissions ils détiennent.

Puis, pour chaque compte de service, décidez :

- **Migrer vers une identité gérée** si l'application le supporte. Les applications modernes devraient utiliser des principaux de service avec authentification par certificat, pas des comptes utilisateurs avec mots de passe. Là où le client peut se permettre la migration, c'est la bonne réponse.
- **Exclure des politiques d'AC spécifiques** qui le briseraient autrement — typiquement Exiger MFA, Bloquer l'auth héritée, restrictions géo. Documentez l'exclusion et la raison.
- **Planifier un coucher de soleil** pour le compte de service s'il est lié à une app héritée qui devrait être retirée.

Le système d'exemption de Panoptica365 supporte ça directement : chaque exclusion de politique d'AC peut porter une justification et une date d'expiration. Quand l'exclusion expire, l'opérateur reçoit une alerte pour la réviser. C'est comme ça qu'on évite le patron « accumulation d'exceptions » de la leçon 6 de la carte 2 — les exclusions ne disparaissent jamais en silence.

### 3. Décidez si vous avez besoin d'un filet de sécurité en mode rapport uniquement

Les modèles Panoptica365 se déploient à l'état Activé par défaut. Quand vous cliquez Déployer sur un modèle, la politique est créée dans le tenant du client et commence à s'appliquer immédiatement.

Pour la plupart des tenants de petite entreprise, c'est le bon comportement. Les étapes de pré-déploiement ci-dessus (exclusion break-glass, inventaire des comptes de service, communication aux utilisateurs) couvrent les préoccupations typiques. Microsoft pousse depuis des années les applications à abandonner les principaux de service avec nom d'utilisateur/mot de passe — les apps modernes sont censées utiliser des inscriptions d'applications / applications d'entreprise avec authentification par certificat ou secret client — donc le mode d'échec « une app héritée se fait verrouiller » est plus rare qu'avant. La plupart des tenants que vous rencontrerez n'ont rien qui se brise à la minute où une politique MFA ou géo s'applique.

Si vous accueillez un client avec une infrastructure héritée significative — des apps métier anciennes qui utilisent encore des principaux de service avec authentification par nom d'utilisateur/mot de passe, des identifiants SMTP codés en dur dans des scripts, des automatisations personnalisées utilisant des flux d'auth hérités, des environnements matures avec des années d'intégrations accumulées — l'approche déploiement-à-chaud comporte un vrai risque. La politique peut commencer à bloquer des connexions légitimes immédiatement, et les comptes de service affectés vont échouer assez bruyamment pour perturber l'entreprise du client.

Pour ces tenants, le flux de travail recommandé est :

1. Déployez le modèle via Panoptica365 (crée la politique à l'état Activé).
2. Ouvrez immédiatement le portail Entra et basculez l'état de la politique à **Rapport uniquement**.
3. Exécutez une fenêtre de rapport uniquement de 3 à 7 jours.
4. Tirez le journal de connexion filtré sur le résultat de rapport uniquement de cette politique. Pour chaque correspondance, classez : cas d'usage légitime qui a besoin d'une exclusion, ou cible légitime qui a besoin de migration.
5. Corrigez les exclusions dans Panoptica365 (pour que la piste d'audit capture la raison), modernisez les intégrations héritées là où c'est possible.
6. Basculez la politique de retour à Activé dans le portail Entra.

Le mode rapport uniquement signifie que l'accès conditionnel évalue la politique à chaque connexion pertinente, journalise ce qui *se serait* passé si la politique avait été appliquée, mais n'applique rien en réalité. La connexion procède comme si la politique n'existait pas. Vous obtenez la télémétrie sans la casse.

**Quand sauter le rapport uniquement :** tenants de petite entreprise sans infrastructure héritée significative, posture Intune propre, et un inventaire pré-déploiement bien cadré. La plupart des déploiements Panoptica365 entrent dans ce profil.

**Quand utiliser le rapport uniquement :** environnements grands ou complexes avec des intégrations héritées substantielles; durcissement post-incident où le client ne peut tolérer aucun faux positif; premier déploiement d'un modèle personnalisé importé (la leçon 8 couvre ce cas spécifiquement). Quelques modèles spécifiques dans cette carte — Bloquer l'authentification héritée (leçon 3), la migration de stratégie en leçon 5, et tout modèle importé en leçon 8 — recommandent le rapport uniquement peu importe la taille du tenant, parce que leurs modes de bris sont plus difficiles à prédire à partir de l'inventaire pré-déploiement seul. Chaque leçon le signale.

Si vous n'êtes pas sûr, penchez vers le rapport uniquement. Le coût de friction est de 3 à 7 jours d'une étape de révision supplémentaire. Le coût d'un déploiement dans la mauvaise direction dans un environnement complexe est une panne client un jour ouvrable.

### 4. Communiquer aux utilisateurs affectés avant l'application

L'accès conditionnel change l'expérience utilisateur. Une politique qui exige MFA là où il n'y en avait pas surprendra l'utilisateur. Une politique qui exige un appareil conforme bloque l'accès depuis un portable personnel. Une politique géo peut attraper un vendeur en voyage d'affaires un mardi.

Avant l'application (pendant la fenêtre de rapport uniquement quand elle s'applique) :

- Envoyez un avis à l'échelle du tenant expliquant ce qui change, ce que l'utilisateur verra, et quoi faire s'il est bloqué.
- Briefez le service d'aide sur les alertes à attendre et à quoi ressemble la bonne résolution.
- Identifiez tout utilisateur à fort impact (dirigeants, voyageurs commerciaux, contractuels) et contactez-les individuellement.
- Documentez le changement dans le journal de changements du client (Panoptica365 enregistre ça automatiquement quand vous déployez depuis la bibliothèque de modèles).

L'objectif est qu'au moment où l'application commence, chaque utilisateur sait à quoi s'attendre. Aucun utilisateur surpris = aucun billet de panique.

### 5. Sachez à quoi ressemble le succès, et comment le surveiller

Pour chaque politique d'AC que vous déployez, vous devriez pouvoir répondre à l'avance :

- **Quelles connexions cette politique devrait-elle faire correspondre?** (Par exemple : « toutes les connexions sans MFA depuis l'extérieur de la plage IP de confiance ».)
- **Quelles connexions ne devrait-elle *pas* faire correspondre?** (Par exemple : « le vendeur en voyage connu avec approbation préalable; comptes de service sur leur IP statique ».)
- **Quel est le volume quotidien attendu de correspondances?** (Approximativement zéro pour un tenant en santé; des correspondances non nulles signifient soit de vraies menaces, soit une mauvaise configuration.)
- **Quels signaux indiquent que la politique est mal configurée?** (Pointe soudaine d'utilisateurs légitimes bloqués; une intégration qui fonctionnait s'arrête.)

Le détecteur de dérive AC de Panoptica365 couvre la pièce de surveillance à long terme — il vous dit quand une politique que vous avez déployée hier a l'air différente aujourd'hui. Mais l'opérateur doit quand même définir ce que « l'air correct » veut dire au moment du déploiement. Sans cette base, la détection de dérive n'est que du bruit.

## La préparation des emplacements nommés

Plusieurs modèles Panoptica365 s'appuient sur des emplacements nommés — le modèle « Permettre seulement l'accès depuis le Canada » et toute politique géographique personnalisée importée d'un autre tenant. Avant d'activer n'importe lequel de ceux-là :

- Confirmez que l'emplacement nommé dans le tenant correspond à la géographie réelle du client. Le modèle Panoptica365 par défaut livre avec le Canada; le tenant d'un client mexicain a besoin que le Mexique soit défini comme l'emplacement de confiance à la place. La leçon 8 couvre le flux de travail de personnalisation.
- Confirmez que les plages IP dans l'emplacement nommé sont à jour. Les IP de bureau changent. Les bureaux de succursales déménagent. Ne vous fiez pas à un emplacement nommé qui n'a pas été vérifié depuis 6 mois.
- Confirmez que les « IP de confiance » n'incluent aucune plage IP qui n'est pas réellement de confiance. Une erreur courante est d'inclure la plage VPN d'un fournisseur ou le bureau d'une société mère, ni l'un ni l'autre dont le MSP ne peut se porter garant.

## La préparation des forces d'authentification

Quelques-unes des politiques dans la carte 3 (spécifiquement les modèles de durcissement admin dans la leçon 6) utilisent des forces d'authentification — une fonctionnalité d'accès conditionnel qui vous permet de spécifier *quelle* méthode MFA doit être utilisée, pas juste *que* MFA doit être utilisé. « MFA résistant à l'hameçonnage » est la force d'authentification standard à barre haute; elle accepte les clés FIDO2, les passkeys et Windows Hello Entreprise et rejette SMS, voix et push Authenticator.

Avant d'activer une politique basée sur la force d'authentification :

- Confirmez que les utilisateurs affectés ont déjà inscrit la méthode plus forte. Si vous exigez MFA résistant à l'hameçonnage pour les admins le mardi et que les admins utilisent encore push Authenticator, ils sont verrouillés le mardi.
- Utilisez la fenêtre de rapport uniquement pour vérifier l'inscription. Si la politique aurait bloqué un admin pendant le rapport uniquement parce qu'il n'a pas inscrit, corrigez l'inscription d'abord.
- Pour les admins spécifiquement, planifiez le déploiement par phases. Commencez avec l'équipe d'opérations IT (ils peuvent se corriger eux-mêmes s'ils se font verrouiller). Puis étendez aux autres rôles d'admin.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**L'accès conditionnel est la couche où les erreurs sont les plus visibles aux utilisateurs.** Une règle anti-hameçonnage mal configurée laisse silencieusement tomber un courriel; une politique d'AC mal configurée verrouille un département. Traitez chaque déploiement comme un événement de gestion de changement. L'inventaire pré-déploiement est l'essai à blanc typique pour la petite entreprise; le basculement manuel à rapport uniquement dans le portail Entra est l'essai à blanc pour les environnements complexes.

**Le compte break-glass est non négociable.** Chaque conversation avec un client sur l'accès conditionnel commence par « vérifions l'histoire du break-glass ». S'ils n'en ont pas, le premier travail d'AC que vous faites pour eux, c'est d'en créer un. Tout le reste attend.

**Documentez les exclusions avec expiration.** Le système d'exemption de Panoptica365 a été construit spécifiquement pour rendre ça facile. Utilisez-le. Le coût d'une exclusion que vous avez oubliée est une année de fausses alertes positives, une faille de sécurité que quelqu'un d'autre ne connaît pas, et une constatation de conformité quand l'auditeur arrive.

## Ce qui suit

Le reste de la carte 3 parcourt chaque modèle d'AC Panoptica365 à son tour. Au moment où vous finissez :

- **Leçon 2 : Exiger MFA pour tous les utilisateurs** — la fondation.
- **Leçon 3 : Bloquer l'authentification héritée** — fermer le contournement par auth de base.
- **Leçon 4 : Emplacement de confiance OU appareil conforme** — la politique géo intelligente.
- **Leçon 5 : Appareil conforme OU hybride OU MFA** — la politique OU de signaux de confiance, et comment elle se rapporte à la politique de la leçon 2 quand les deux sont activées.
- **Leçon 6 : Durcir l'accès admin** — quatre modèles admin dans une leçon.
- **Leçon 7 : Désactiver le flux de code d'appareil** — la défense Storm-2372.
- **Leçon 8 : Importer vos propres modèles d'AC** — le flux de travail de personnalisation de Panoptica365.
- **Leçon 9 : Opérer l'AC à l'échelle** — dérive, exclusions, cycle de vie.

Chacune de ces leçons présume que vous avez fait les cinq étapes pré-déploiement ci-dessus. Les leçons elles-mêmes ne répètent pas la liste. Elles vont directement à *ce que chaque modèle fait et comment le déployer*. Le pré-déploiement est la fondation; les modèles sont la mise en œuvre.

Pour l'instant : lisez les modèles, mais n'en activez aucun sur un tenant client tant que vous n'avez pas fait le pré-déploiement pour ce tenant spécifique. L'accès conditionnel est la seule surface M365 où « faire confiance aux valeurs par défaut » peut mettre un client hors ligne. Le pré-déploiement, c'est l'inoculation.
