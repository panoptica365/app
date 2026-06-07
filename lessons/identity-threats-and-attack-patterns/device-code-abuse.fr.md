---
title: "Abus du code d'appareil — l'imprimante qui n'en était pas une"
subtitle: "Des acteurs étatiques (Storm-2372) arment le flux légitime de code d'appareil pour voler des jetons sans jamais toucher à un mot de passe."
icon: "smartphone"
last_updated: 2026-05-29
---

# Abus du code d'appareil — l'imprimante qui n'en était pas une

Quelque part dans le bureau de votre client, une imprimante se connecte à Microsoft 365 pour faire du scan-to-email. Cette imprimante ne peut pas avoir de clavier. Elle ne peut pas taper de mot de passe. Elle ne peut pas tapoter un téléphone pour le MFA. Microsoft a résolu ça il y a des années avec le *flux de code d'appareil* : l'appareil affiche un code alphanumérique court sur son écran, l'utilisateur va à `microsoft.com/devicelogin` sur son téléphone ou son portable, entre le code, se connecte normalement, et Microsoft remet à l'appareil un jeton. L'imprimante peut maintenant envoyer du courriel. Personne n'a eu à retaper un mot de passe dans un appareil sans clavier.

C'est une fonctionnalité légitime et intelligente. C'est aussi le vecteur d'attaque derrière Storm-2372 — un acteur de menace aligné avec la Russie qui mène des campagnes d'hameçonnage par code d'appareil contre des cibles dans les gouvernements, les ONG, les services IT, la défense, les télécoms, la santé, l'enseignement supérieur et l'énergie à travers l'Europe, l'Amérique du Nord, l'Afrique et le Moyen-Orient depuis août 2024. En février 2025, Microsoft a observé Storm-2372 évoluer l'attaque pour acquérir des Primary Refresh Tokens (PRT) en enregistrant des appareils contrôlés par l'attaquant à l'intérieur du tenant de la victime.

Cette leçon, c'est comment une fonctionnalité d'authentification amie des imprimantes devient un outil d'attaque, et la politique d'accès conditionnel unique qui le coupe pour les clients qui n'ont pas d'imprimantes.

## Le flux légitime de code d'appareil

Pour comprendre l'attaque, marchez d'abord à travers la version légitime.

Une imprimante (ou télé intelligente, appareil IoT, session PowerShell sur un serveur, automatisation scriptée, etc.) veut s'authentifier comme un utilisateur. Elle ne peut pas présenter une UI de connexion elle-même.

**Étape 1 : L'appareil demande un code.** L'appareil appelle le point de terminaison `/devicecode` de Microsoft et reçoit en retour deux choses : un court *code utilisateur* (huit caractères alphanumériques environ, comme `B7XK-9MNP`) et un plus long *code d'appareil* (une longue chaîne opaque que l'appareil garde à l'interne). L'appareil reçoit aussi une URL — `microsoft.com/devicelogin`.

**Étape 2 : L'appareil affiche le code utilisateur.** L'écran de l'imprimante montre : « Allez à `microsoft.com/devicelogin` et entrez le code `B7XK-9MNP` pour vous connecter. »

**Étape 3 : L'utilisateur va à cette URL sur son téléphone ou son portable.** S'authentifie normalement à Microsoft. Quand on lui demande, entre le code utilisateur. Microsoft associe maintenant ce code avec l'identité de l'utilisateur connecté.

**Étape 4 : L'appareil interroge le point de terminaison de jeton de Microsoft.** Une fois que l'utilisateur a entré le code, Microsoft remet à l'appareil un jeton. L'appareil peut maintenant se connecter comme l'utilisateur.

Ça fonctionne. C'est légitime. Microsoft a documenté le flux abondamment. La faille, c'est que *les étapes 2 à 4 ne demandent pas réellement que l'appareil soit dans la même pièce que l'utilisateur*. L'« appareil » peut être le portable de l'attaquant à Bucarest. Le « code utilisateur » peut être envoyé par WhatsApp. L'utilisateur n'a aucun moyen de savoir vers quel appareil le code va authentifier.

## L'attaque

Maintenant la version d'attaque, qui est structurellement identique :

**Étape 1 : Le portable de l'attaquant demande un code d'appareil.** Il appelle le point de terminaison `/devicecode` de Microsoft avec un ID client — typiquement un des ID d'application Microsoft de première partie bien connus (Outlook, Teams, Microsoft Graph PowerShell, Microsoft Authentication Broker). Microsoft retourne le code utilisateur et le code d'appareil.

**Étape 2 : L'attaquant envoie le code utilisateur à la victime.** Via WhatsApp, Teams, Signal, ou courriel. Storm-2372 se fait typiquement passer pour une « personne en vue pertinente pour la cible » — un journaliste qui organise une entrevue, un investisseur qui planifie un appel, un chercheur qui invite à la collaboration. Le prétexte culmine en : « J'ai mis en place une réunion Teams pour nous. SVP allez à `microsoft.com/devicelogin` et entrez le code `B7XK-9MNP` pour rejoindre. »

**Étape 3 : La victime, s'attendant à un flux d'invitation Teams légitime, va à l'URL et entre le code.** Elle est maintenant sur la *vraie* page devicelogin de Microsoft. Elle s'authentifie normalement — mot de passe, MFA, tout le flux régulier. Il n'y a pas de fausse page de connexion. Il n'y a pas de proxy. La page est authentiquement celle de Microsoft. Le code utilisateur, par contre, est celui de l'attaquant.

**Étape 4 : Microsoft autorise le portable de l'attaquant comme cet utilisateur.** L'attaquant a maintenant un jeton d'accès — émis légitimement, par Microsoft, après que la victime ait correctement complété le MFA. Du point de vue de Microsoft, c'est une connexion entièrement valide.

**Étape 5 : L'attaquant lit le courriel, exfiltre les données, etc.**

L'expérience de l'utilisateur, c'est : il pensait rejoindre une réunion Teams. La réunion ne s'est pas produite. Il a fermé l'onglet. Il s'est fait avoir.

## Pourquoi ça défait le MFA

Le MFA se passe entre *la victime et Microsoft* à l'étape 3. La victime le complète correctement. Le prompt MFA demande « Approuver la connexion depuis l'appareil qui a démarré ce flux? » — mais l'appareil qui a démarré ce flux est le portable de *l'attaquant*. La victime ne peut pas dire à partir du prompt que l'appareil n'est pas le sien, parce que le flux de code d'appareil ne fait pas remonter d'information significative sur l'appareil demandeur dans l'expérience MFA de l'utilisateur.

Le MFA de Microsoft valide la présence de l'utilisateur et les bons identifiants. Il ne valide pas l'intention (« cet utilisateur voulait-il vraiment connecter cette machine d'attaquant? »). Le flux de code d'appareil utilise le MFA comme conçu et produit quand même une compromission, parce que *le consentement à la connexion* et *l'authentification de la connexion* se passent sur des machines différentes.

C'est structurellement le même problème que l'AiTM (leçon 3) : l'authentification est techniquement correcte mais elle finit par bénéficier à la mauvaise partie. La différence, c'est que l'AiTM intercepte le cookie de session de l'utilisateur; l'hameçonnage par code d'appareil fait *émettre légitimement* par Microsoft un jeton lié à l'attaquant. Il n'y a pas de vol. Il n'y a pas de maliciel. Il n'y a pas de proxy. Tout est officiel.

## L'évolution récente de Storm-2372

En août 2024, Microsoft a commencé à suivre les campagnes de code d'appareil de Storm-2372. Les campagnes initiales étaient directes — hameçonner un jeton Outlook ou Microsoft Graph PowerShell, lire le courriel.

Le 14 février 2025, Microsoft a observé l'acteur passer à une variante beaucoup plus dangereuse : utiliser l'ID client spécifique du **Microsoft Authentication Broker**. Quand le flux de code d'appareil est exécuté contre l'Authentication Broker, le jeton de rafraîchissement résultant peut être échangé contre un nouveau jeton au *service d'enregistrement d'appareils*, ce qui permet à l'attaquant d'enregistrer sa propre machine comme un appareil dans le tenant Entra ID de la victime.

Un appareil enregistré dans Entra ID peut demander un Primary Refresh Token (PRT) — l'identifiant que M365 émet aux appareils Windows gérés pour garder un utilisateur connecté. Avec un PRT, l'attaquant a le même genre d'accès qu'a un portable d'entreprise pleinement inscrit. Il peut se connecter à n'importe quoi dans M365 sans prompts MFA supplémentaires, parce que le PRT est ce qui *remplace* le MFA pour les connexions d'appareils gérés.

En d'autres mots, l'attaquant a transformé un seul hameçonnage par code d'appareil en un *appareil enrôlé* dans le tenant du client. Passer de « j'ai un jeton pour quelques heures » à « j'ai une identité d'appareil géré qui va continuer à produire des jetons » est un changement de palier en persistance — similaire à ce que l'hameçonnage par consentement OAuth (leçon 4) donne à l'attaquant, mais atteint par un mécanisme complètement différent.

## À quoi ça ressemble dans la télémétrie M365

Le flux de code d'appareil est journalisé. Le journal de connexion dans Entra ID enregistre :

- **Protocole d'authentification : Device Code.** C'est le donneur. Très peu de vraies charges de travail clients utilisent le flux de code d'appareil comme méthode de connexion primaire.
- **ID client.** Vous dit quelle application était autorisée. L'ID Microsoft Authentication Broker (`29d9ed98-a469-4536-ade2-f981bc1d605e`) qui apparaît ici est un signal fort — c'est l'évolution Storm-2372.
- **IP source.** Souvent un proxy résidentiel ou une géographie connue-hostile.
- **Agent utilisateur.** Souvent Python par défaut ou style curl — automatisation, pas un vrai client.

Si vous grep le journal de connexion Entra pour `authenticationProtocol == "deviceCode"`, vous devriez voir presque zéro résultat dans un tenant en santé sauf s'il y a des cas d'usage IoT/automatisation documentés. Chaque résultat vaut la peine d'être enquêté.

L'activité de suivi — enregistrement soudain d'un nouvel appareil dans le tenant, nouvelles méthodes d'authentification enregistrées, changements de permission de boîte aux lettres — est plus bruyante et plus facile à détecter que la connexion par code d'appareil elle-même.

## Ce que Defender fait à ce sujet

Safe Links de Microsoft Defender for Office 365 peut attraper la *livraison* du message d'hameçonnage si c'est par courriel, mais le prétexte de Storm-2372 est typiquement un message de chat dans Teams, WhatsApp ou Signal, que Defender for Office 365 ne voit pas.

Defender XDR peut corréler la connexion par code d'appareil avec les anomalies en aval — enregistrement de nouvel appareil, requêtes Graph suspectes, exfiltration de boîte aux lettres — et attribuer une confiance Attack Disruption si le patron correspond. L'équipe Microsoft Threat Intelligence a publié des requêtes de détection que les clients avec Defender XDR peuvent déployer dans l'advanced hunting pour chercher les indicateurs spécifiques de Storm-2372.

Le contrôle défensif le plus propre, par contre, c'est la configuration : empêcher le flux de code d'appareil d'être utilisable pour la plupart des utilisateurs au départ.

## La politique d'accès conditionnel qui coupe ça

Dans l'accès conditionnel, il y a une condition appelée **Flux d'authentification** (preview jusqu'en 2024, généralement disponible en 2025). À l'intérieur de cette condition, un des interrupteurs est **Flux de code d'appareil**. Vous pouvez écrire une politique d'AC qui dit :

> Bloquer tous les utilisateurs de compléter le flux d'authentification par code d'appareil, avec les exceptions suivantes : [comptes spécifiques qui en ont légitimement besoin, comme le compte de service de l'imprimante ou le compte de helpdesk qui exécute l'automatisation PowerShell contre plusieurs tenants].

C'est ça, la politique. Mettez-la sur le tenant du client, excluez les comptes de service qui ont légitimement besoin du code d'appareil (la plupart des tenants n'en ont aucun), et tout le manuel de Storm-2372 s'arrête de fonctionner pour ce tenant.

C'est une des politiques d'AC uniques au plus haut levier disponibles dans Entra ID P1 (Business Premium et au-dessus). Microsoft a commencé à recommander publiquement cette politique après la divulgation de Storm-2372 en février 2025, et à partir du milieu 2026, elle devrait être considérée comme la base pour tout tenant qui n'a pas un cas d'usage de code d'appareil documenté.

Le nettoyage de suivi, si vous découvrez que la politique n'était pas en place et qu'une attaque s'est produite : révoquer les jetons de l'utilisateur (couvert dans la section de réponse de la leçon 3), désenregistrer tout appareil contrôlé par l'attaquant de la liste d'appareils du tenant, auditer et nettoyer les méthodes d'authentification, et réinitialiser le mot de passe de l'utilisateur.

## Ce que Panoptica365 voit

Le pipeline d'ingestion UAL de Panoptica365 inclut les signaux liés au code d'appareil comme partie du catalogue de détection plus large :

**Connexions suspectes par code d'appareil.** Quand une connexion se complète avec `authenticationProtocol == "deviceCode"` et que la source n'est pas un compte IoT documenté, l'alerte peut se déclencher — selon la configuration du tenant.

**Nouvel appareil enregistré.** Quand un appareil non vu apparaît dans la liste d'appareils du tenant (la signature d'attaque post-Storm-2372), l'événement d'enregistrement est dans le journal d'audit Entra et Panoptica365 le fait remonter.

**Nouvelle méthode d'authentification enregistrée.** Comme avec la plupart des attaques d'identité, l'attaquant post-compromission ajoute souvent sa propre méthode MFA. Cette alerte couvre la chaîne d'attaque par code d'appareil ainsi que les chaînes AiTM et credential stuffing.

**L'ingestion Defender XDR** ramasse les incidents corrélés quand Microsoft a noté l'activité comme suspecte.

L'approche de triage : quand une alerte d'IP étrangère ou de nouvel-appareil-enregistré se déclenche, vérifiez si le protocole d'authentification de la connexion était Device Code. Si oui, traitez ça comme une attaque de style Storm-2372 jusqu'à preuve du contraire.

## Défendre le client

En couches, par ordre d'impact :

**Bloquer le flux de code d'appareil via l'accès conditionnel pour les utilisateurs qui n'en ont pas besoin.** Politique unique, effet immédiat. La grande majorité des tenants clients ont zéro cas d'usage légitime de code d'appareil. Les rares qui en ont (l'imprimante, le compte d'automatisation PowerShell) peuvent être exclus individuellement. Ne laissez pas ça exposé.

**Pour les tenants qui ont besoin du code d'appareil (rare), exigez qu'il vienne d'emplacements de confiance ou d'appareils conformes.** La condition d'accès conditionnel se combine avec les autres — vous pouvez exiger « flux de code d'appareil seulement depuis la plage IP du bureau » ou « seulement sur des appareils conformes à Intune ». Configuration plus lourde mais possible.

**Éduquer les utilisateurs sur les prétextes basés sur le chat.** La chaîne d'attaque Storm-2372 dépend du fait que l'utilisateur fasse assez confiance à un message WhatsApp/Signal/Teams pour suivre les instructions. Formez les utilisateurs (surtout les dirigeants et les gens dans des rôles comme les subventions, le journalisme, la recherche, ou toute fonction face à l'externe) que **quiconque leur demande d'aller à `microsoft.com/devicelogin` et d'entrer un code via un message de chat est presque certainement un attaquant**. Il n'y a aucune raison légitime qu'une partie externe envoie un code d'appareil par chat.

**Surveiller le protocole `deviceCode` dans le journal de connexion.** Ça devrait être une baseline proche de zéro dans la plupart des tenants. Tout ce qui est non-zéro vaut la peine d'examiner.

**Détecter les indicateurs post-compromission.** Événements de nouvel enregistrement d'appareil, nouvelles méthodes d'authentification, activité de boîte aux lettres suspecte — ce sont les signaux de suivi qui se déclenchent plus bruyamment que la connexion initiale par code d'appareil.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**Ajoutez « bloquer le flux de code d'appareil » à la liste de vérification d'accueil des clients.** C'est une des politiques d'accès conditionnel pas chères et à fort impact qui devrait être sur chaque tenant Business Premium par défaut. La bibliothèque de modèles d'AC de Panoptica365 est le bon endroit pour livrer ça; si ce n'est pas déjà dans votre bibliothèque, ajoutez-le avant le prochain accueil de client.

**L'évolution de Storm-2372 de « voler un jeton » à « enregistrer un appareil » est le patron à surveiller.** Quand les attaquants trouvent de nouvelles façons de convertir un accès à court terme en accès persistant, la menace se cumule. La même logique s'applique à l'hameçonnage par consentement (leçon 4) et au truc post-AiTM « enregistrer une nouvelle méthode MFA » (leçon 3). Les variantes de persistance sont là où les compromissions simples deviennent des incidents prolongés.

**L'hameçonnage par code d'appareil est mieux attrapé en amont.** Une fois le jeton émis, vous chassez la trace de l'attaquant. La politique d'AC qui empêche le flux d'être utilisable, c'est *la* défense; tout après ça, c'est ramasser les pots cassés.

## Ce qui suit

- **Leçon 6 : Compromission de courriel d'entreprise.** Où la plupart de ces attaques se terminent — pas dans la compromission dramatique elle-même, mais dans la manipulation tranquille de longue durée des courriels financiers qui suit. Le BEC est ce qui rend toutes les cinq attaques précédentes profitables pour les attaquants.

Pour l'instant : le flux de code d'appareil est une fonctionnalité légitime qui est abusée à grande échelle par un acteur sophistiqué. La défense, c'est de la configuration, pas de la détection. Mettez la politique d'accès conditionnel. Formez vos utilisateurs à ne jamais entrer un code d'appareil depuis un message de chat. Surveillez le journal de connexion pour le protocole que vous ne vous attendez pas à voir.

---

*Sources des données dans cette leçon — Microsoft Security Blog sur la campagne d'hameçonnage par code d'appareil de Storm-2372 ([Microsoft Security Blog — Storm-2372 conducts device code phishing campaign, février 2025](https://www.microsoft.com/en-us/security/blog/2025/02/13/storm-2372-conducts-device-code-phishing-campaign/)); référence technique du flux de code d'appareil ([Microsoft Learn — OAuth 2.0 device code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code)); condition « flux d'authentification » d'accès conditionnel ([Microsoft Learn — Conditional Access: Authentication flows](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-cloud-apps#authentication-flows)); évolution de Storm-2372 vers le vol d'Authentication Broker / PRT ([Microsoft Threat Intelligence — Storm-2372 update, février 2025](https://www.microsoft.com/en-us/security/blog/2025/02/13/storm-2372-conducts-device-code-phishing-campaign/)).*
