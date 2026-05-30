---
title: "Règles ASR + Block mshta.exe — réduction de surface d'attaque"
subtitle: "19 règles ASR en mode Blocage et une règle pare-feu mshta.exe — bloquer les chaînes comportementales des maliciels avant que les signatures puissent les détecter."
icon: "bug"
last_updated: 2026-05-29
---

# Règles ASR + Block mshta.exe — réduction de surface d'attaque

Un patron fréquent dans la livraison de maliciels : un utilisateur ouvre un document Word attaché à un courriel d'hameçonnage. Le document contient une macro. La macro lance un processus PowerShell. Le processus PowerShell télécharge un exécutable depuis un serveur distant. L'exécutable s'exécute, établit la persistance, et l'attaquant a un point d'appui sur l'appareil.

Chaque étape de cette chaîne est *de la fonctionnalité Windows légitime*. Word peut avoir des macros. Les macros peuvent appeler PowerShell. PowerShell peut télécharger des fichiers. Les fichiers peuvent s'exécuter. Chaque étape, prise isolément, c'est quelque chose qu'un développeur ou un utilisateur avancé pourrait légitimement faire. Mais la *combinaison* — Word → macro → PowerShell → téléchargement → exécution — c'est un patron de comportement qui n'a presque jamais de raison d'affaires légitime et qui indique presque toujours une livraison de maliciel.

Les règles de réduction de surface d'attaque (ASR), c'est le mécanisme de Microsoft pour attraper exactement ces patrons comportementaux. Plutôt que d'identifier des fichiers malveillants spécifiques, les règles ASR bloquent les *combinaisons* d'actions légitimes-mais-inhabituelles que le code malveillant utilise pour s'enchaîner vers une compromission réussie.

Cette leçon couvre le modèle ASR Rules Standard de Panoptica365 (l'ensemble de règles ASR complet) et le modèle Block mshta.exe outbound connections lié (une règle de pare-feu focalisée qui complète l'ensemble de règles ASR). Ensemble ils forment la couche de défense préemptive basée sur le comportement sur les terminaux Windows.

## Le modèle ASR Rules Standard

Le modèle configure **19 règles ASR — toutes en mode Block** — plus l'accès contrôlé aux dossiers (dans un mode différent; voir plus bas). Il utilise le type de modèle catalogue de paramètres avec `endpointSecurityAttackSurfaceReduction` comme famille. La posture du modèle, en une ligne : à peu près tout bloquer.

Les 19 règles, regroupées par ce qu'elles attrapent :

### Livraison de maliciel basée sur Office (la chaîne d'attaque la plus fréquente)

- **Bloquer toutes les applications Office de créer des processus enfants.** Word, Excel, PowerPoint, etc. ne devraient pas lancer de processus. Quand ils le font, c'est presque toujours une macro qui lance quelque chose de malveillant.
- **Bloquer les applications Office de créer du contenu exécutable.** Les apps Office qui écrivent des fichiers .exe / .dll sur le disque, c'est hautement suspect.
- **Bloquer les applications Office d'injecter du code dans d'autres processus.** L'injection de code depuis Office dans d'autres processus est une technique classique de maliciel.
- **Bloquer l'application de communication Office de créer des processus enfants.** Outlook spécifiquement — Outlook qui lance des processus, c'est encore plus rare que les autres apps Office.
- **Bloquer les appels d'API Win32 depuis les macros Office.** Les macros qui appellent l'API Win32 directement font quelque chose qu'une macro d'affaires normale ne ferait pas.
- **Bloquer JavaScript ou VBScript de lancer du contenu exécutable téléchargé.** Les scripts téléchargés qui lancent des exécutables téléchargés, c'est le cœur de la livraison de maliciel « drive-by ».
- **Bloquer l'exécution de scripts potentiellement obfusqués.** Le PowerShell ou VBScript fortement obfusqué est un fort signal de maliciel — les scripts légitimes n'ont aucune raison de s'obfusquer.

### Livraison basée sur le lecteur de documents

- **Bloquer Adobe Reader de créer des processus enfants.** Adobe Reader est un vecteur d'attaque parallèle à Office — les PDF malveillants intègrent parfois des scripts ou invoquent des lanceurs qui démarrent des processus enfants. Même logique défensive que les règles Office : un lecteur PDF n'a pas affaire à lancer d'autres processus.

### Livraison basée sur le courriel

- **Bloquer le contenu exécutable depuis le client de courriel et le courriel web.** Les pièces jointes courriel qui sont des exécutables (ou qui téléchargent des exécutables) ne devraient pas s'exécuter directement depuis le client de courriel.

### Vol d'identifiants

- **Bloquer le vol d'identifiants depuis le sous-système Windows Local Security Authority (LSASS).** Ça attrape les attaques de style Mimikatz où le maliciel essaie de vider les identifiants depuis la mémoire LSASS. Hautement diagnostique — un processus qui accède à LSASS pour l'extraction d'identifiants indique presque toujours une compromission. Cette règle dans le modèle Panoptica365 livre avec une exclusion par règle : `wazuh-agent.exe`. Wazuh est un agent SIEM/XDR open source qui lit légitimement LSASS pour la surveillance des identifiants; sans l'exclusion, l'agent lui-même serait bloqué par la règle même dont il dépend pour observer. Exemple concret de comment une exclusion par règle fonctionne en pratique : la règle se déclenche encore pour tout le reste, mais Wazuh obtient un laissez-passer permanent.

### Persistance, mouvement latéral et évasion de défense

- **Bloquer la persistance via l'abonnement aux événements WMI.** L'abonnement aux événements WMI est une technique de persistance furtive que les maliciels utilisent pour survivre aux redémarrages; les apps légitimes ne l'utilisent presque jamais.
- **Bloquer la création de processus depuis PsExec et les commandes WMI.** L'exécution à distance basée sur PsExec et WMI sont des outils fréquents de mouvement latéral.
- **Bloquer le redémarrage de la machine en mode sans échec.** Certains rançongiciels redémarrent en mode sans échec pour désactiver les produits de sécurité avant de chiffrer.
- **Bloquer l'utilisation d'outils système copiés ou usurpés.** Les maliciels copient parfois des binaires système légitimes (comme cmd.exe) vers d'autres emplacements et les exécutent de là, évitant certaines règles de détection.

### USB et médias amovibles

- **Bloquer les processus non fiables et non signés qui s'exécutent depuis USB.** Le maliciel livré par USB est un vecteur de longue date; cette règle attrape les exécutables non signés qui se lancent depuis des lecteurs amovibles.

### Spécifique au serveur

- **Bloquer la création de webshell pour les serveurs.** Spécifiquement pour les installations Windows Server — attrape les téléversements de fichiers malveillants qui déposent des webshells (PHP, ASPX) sur IIS ou d'autres serveurs web.

### Défense des pilotes et de l'exploitation

- **Bloquer l'abus de pilotes signés vulnérables exploités.** Attrape les maliciels qui utilisent des pilotes noyau signés connus-vulnérables comme vecteur d'escalade de privilèges. Microsoft maintient la liste des pilotes vulnérables.
- **Bloquer l'exécution de fichiers exécutables sauf s'ils rencontrent un critère de prévalence, d'âge, ou de liste de confiance.** Une règle « fichiers sans pedigree » — les exécutables qui sont trop nouveaux, trop rares, ou pas sur une liste connue-sûre se font bloquer. Attrape les nouvelles variantes de maliciels; peut faire de faux positifs sur des logiciels de niche légitimes.

### Spécifique au rançongiciel

- **Utiliser la protection avancée contre les rançongiciels.** Une règle comportementale qui attrape les patrons de chiffrement caractéristiques des rançongiciels.

## Accès contrôlé aux dossiers — l'exception délibérée

Adjacent aux 19 règles ASR, le modèle active aussi **l'accès contrôlé aux dossiers (CFA)** — mais en **mode Audit**, pas Block. C'est le seul endroit où le modèle s'écarte explicitement de la posture « tout bloquer », et c'est intentionnel.

CFA restreint quelles applications peuvent écrire dans des dossiers protégés (Documents, Images, Bureau, etc.). En mode Block, les apps qui ne sont pas sur la liste d'autorisation se font empêcher de modifier les fichiers dans ces emplacements. En mode Audit, ces mêmes écritures sont *journalisées* mais non bloquées — Defender enregistre qui a essayé d'écrire quoi dans un dossier protégé, mais l'écriture procède.

La raison pour le mode Audit : trop d'applications légitimes écrivent dans les dossiers protégés sur un appareil Windows normal. Les outils de sauvegarde qui écrivent dans les documents de l'utilisateur, les clients de synchronisation (Dropbox, Google Drive, OneDrive), les apps créatives qui écrivent les fichiers de projet dans Documents, les outils de productivité qui sauvegardent automatiquement — la liste est longue. Faire rouler CFA en mode Block dès le départ génère une avalanche de billets de service d'aide (« mon OneDrive a arrêté de synchroniser », « ma sauvegarde échoue », « Photoshop ne sauvegarde pas »). Le mode Audit garde la visibilité (vous pouvez voir ce qui est tenté) sans briser les flux.

Les opérateurs qui veulent une protection contre les rançongiciels plus forte peuvent basculer CFA en mode Block par client après avoir construit une liste d'autorisation des apps légitimes pour cet environnement. Le modèle livre en Audit pour que le déploiement par défaut ne cause pas de bris de flux; la mise à niveau au mode Block est une étape de durcissement par client, pas un défaut à l'échelle de la flotte.

## Modes des règles ASR — la distinction cruciale

Chaque règle ASR peut être mise dans un de quatre modes :

- **Audit** — la règle évalue et journalise les matchs, mais ne bloque pas. Utilisé pour les tests et la découverte.
- **Block** — la règle évalue et bloque le comportement qui matche. Le mode production.
- **Warn** — la règle avertit l'utilisateur quand le comportement qui matche se produit; l'utilisateur peut surpasser et procéder. Disponible pour certaines règles; intermédiaire entre Audit et Block.
- **Non configuré / Off** — la règle n'est pas active.

Le modèle ASR Rules Standard de Panoptica365 met **les 19 règles ASR à Block** dès le départ. L'accès contrôlé aux dossiers est le seul en Audit (voir la section précédente). Les auteurs du modèle ont choisi des règles spécifiquement parce qu'elles ont des taux de faux positifs bas en 2026 — Microsoft les a accordées pendant des années, et l'ensemble choisi évite les règles historiquement plus problématiques. L'intention de conception du modèle est un déploiement direct-vers-Block.

**La réalité opérationnelle** : même avec des règles soigneusement sélectionnées, déployer les règles ASR à Block sur une flotte qui n'en a jamais eu attrapera occasionnellement de l'activité d'affaires légitime-mais-inhabituelle que les auteurs du modèle n'ont pas pu prédire. Logiciels spécifiques à l'industrie, outils de niche, apps internes sur mesure avec des patrons de macro Office bizarres — ceux-ci peuvent encore déclencher des règles et se faire bloquer, brisant les flux des utilisateurs.

Deux approches acceptables, selon le client :

**Direct-vers-Block (le défaut du modèle).** Déployer comme le modèle livre — toutes les règles en Block. Convient aux clients dont vous connaissez bien l'inventaire d'apps, qui exécutent des logiciels d'affaires grand public, qui n'ont pas d'apps sur mesure héritées avec des patrons Office bizarres ou LOLBin. La plupart des tenants PME entrent dans ce profil. Soyez prêt à ajouter des exclusions par règle à mesure que les bris légitimes surgissent.

**Pré-déploiement en mode Audit (l'option prudente).** Pour les clients avec un inventaire de logiciels inconnu ou inhabituel — fournisseurs de contrôle industriel, apps d'affaires sur mesure, logiciels spécifiques à la santé, n'importe quoi en dehors du monde SaaS grand public — basculer chaque règle en Audit avant le déploiement, surveiller pendant 14 à 30 jours, bâtir la liste d'exclusions, puis basculer en Block :

1. Modifier le modèle par client pour mettre chaque règle en Audit avant le déploiement.
2. Faire rouler en mode Audit pendant 14 à 30 jours. Tirer les journaux d'audit aux quelques jours.
3. Pour chaque règle qui s'est déclenchée contre de l'activité légitime, ajouter une exclusion par règle pour le processus ou fichier affecté (l'exclusion Wazuh de la règle LSASS plus haut est le modèle).
4. Une fois la période d'audit propre, rebasculer les règles à Block.

Le choix entre direct-vers-Block et pré-déploiement Audit est par client. Le modèle livre en direct-vers-Block parce que c'est la bonne réponse pour la majorité des tenants PME; les opérateurs qui savent que l'environnement d'un client est inhabituel devraient tendre vers le pré-déploiement Audit à la place.

## Le modèle Block mshta.exe — le complément focalisé

Adjacent au modèle ASR Rules, il y a un modèle séparé et focalisé : **Panoptica365 - Block mshta.exe outbound connections.**

La description du modèle est inhabituellement détaillée : *« Bloquer les connexions sortantes depuis mshta.exe a un impact utilisateur minimal mais réduit significativement la surface d'attaque en empêchant un LOLBin fréquemment abusé d'atteindre des charges utiles externes et des serveurs C2. »*

L'acronyme LOLBin signifie **Living Off the Land Binary** — un binaire Windows légitime que les attaquants abusent pour faire des choses malveillantes. mshta.exe en est l'exemple classique : c'est un utilitaire Windows intégré pour exécuter des fichiers HTML Application (.hta), et il fait partie de Windows depuis des décennies. Presque aucun flux d'affaires légitime n'utilise mshta.exe en 2026; presque chaque famille de maliciels qui roule sur Windows inclut mshta.exe comme un de ses vecteurs d'exécution parce qu'il est déjà sur chaque appareil Windows, signé par Microsoft, et peut être invoqué depuis plusieurs contextes (macros Office, tâches planifiées, ligne de commande, scripts).

Le modèle bloque les **connexions réseau sortantes** spécifiquement depuis mshta.exe. C'est-à-dire : mshta.exe peut encore rouler si un cas d'usage légitime l'invoque, mais il ne peut pas atteindre l'infrastructure C2 externe ou télécharger des charges utiles depuis Internet. Le cas d'usage malveillant devient sévèrement dégradé.

Le modèle utilise la même famille `endpointSecurityFirewall` que le modèle Firewall Settings principal (leçon 6). C'est techniquement une règle de pare-feu plutôt qu'une règle ASR, mais conceptuellement c'est un contrôle de réduction de surface d'attaque — il retire un chemin spécifique sur lequel les attaquants se fient.

C'est le bon patron pour la défense LOLBin : identifier les binaires Windows légitimes-mais-rarement-utilisés que les attaquants aiment, et restreindre chirurgicalement le comportement spécifique qui les rend utiles pour l'attaque. La bibliothèque Panoptica365 livre actuellement ce modèle pour mshta.exe spécifiquement; des modèles similaires pourraient être construits pour d'autres LOLBin (cscript.exe, wscript.exe, certutil.exe, regsvr32.exe, msbuild.exe, installutil.exe, rundll32.exe — il y a une longue liste). Pour l'instant, mshta.exe est celui qui est inclus.

## Ce qui peut briser

Les règles ASR et le blocage mshta.exe peuvent produire des faux positifs. Les catégories les plus fréquentes :

**Apps internes sur mesure qui font des choses qu'elles ne devraient pas.** Une application d'affaires sur mesure qui inclut des macros Office faisant des choses bizarres, ou qui utilise mshta.exe pour quelque raison héritée, ou qui appelle des APIs Win32 depuis Excel pour la performance, va se faire bloquer. La solution, ce sont des exclusions par app dans la configuration de règle ASR.

**Fournisseurs de logiciels de niche avec des pratiques de codage pauvres.** Certains logiciels commerciaux (surtout plus vieux, de niche ou spécifiques à l'industrie) violent les règles ASR dans le cadre de leur fonctionnement normal. L'installateur du fournisseur lance PowerShell, l'app principale du fournisseur injecte du code dans d'autres processus, etc. Les solutions sont des exclusions spécifiques au fournisseur.

**Outils de gestion à distance basés sur PsExec / WMI.** Certains outils de gestion à distance légitimes utilisent PsExec ou l'exécution à distance basée sur WMI, ce qui se fait attraper par la règle ASR correspondante. Si l'équipe TI d'un client utilise ces outils, ils ont besoin d'exclusions.

**Scripts PowerShell sur mesure qui téléchargent et exécutent.** Une automatisation interne légitime qui télécharge une charge utile et l'exécute (p. ex., un installateur lancé par un script d'ouverture de session) va déclencher la règle JavaScript/VBScript-exécutable-téléchargé. Exclusions ou réécriture de l'automatisation.

**Accès contrôlé aux dossiers anti-rançongiciel.** Avec le défaut du modèle de CFA en mode Audit, rien ne brise — les écritures sont journalisées mais permises. La liste « ce qui briserait si CFA était en mode Block » est longue quand même : logiciels de sauvegarde qui écrivent dans les documents utilisateur, clients de synchronisation (Dropbox, Google Drive, OneDrive — OneDrive est habituellement sur la liste d'autorisation par défaut de Microsoft), outils créatifs qui écrivent dans Documents, apps de productivité qui sauvegardent automatiquement. C'est exactement pour ça que le modèle livre délibérément CFA en Audit : bloquer ces choses dès le départ générerait un flot de billets de service d'aide. Les opérateurs qui basculent CFA en Block pour un client spécifique plus tard devraient bâtir la liste d'autorisation depuis les journaux du mode Audit d'abord.

## Déploiement

Pour les tenants PME grand public (inventaire d'apps familier, environnement standard fort en SaaS), le défaut direct-vers-Block du modèle est la bonne posture de déploiement :

1. **Jour 0** — déployer le modèle tel qu'il livre (les 19 règles ASR en Block, CFA en Audit). Groupe pilote d'abord selon le pré-déploiement de la leçon 1.
2. **Jours 1 à 14** — surveiller les billets de service d'aide et les événements de blocage Defender. Les faux positifs qui ont besoin d'exclusions vont surgir comme des bris de flux rapportés par les utilisateurs (« X a arrêté de fonctionner après la mise à jour »). Triez chacun : faux positif (ajouter exclusion), vrai positif (enquêter comme incident de sécurité), cas limite (décider par cas).
3. **Jour 14+** — étendre l'assignation du groupe pilote à la portée complète une fois que les appareils pilotes sont propres. Continuer à surveiller pour les 30 premiers jours et ajouter des exclusions à mesure que de nouvelles surgissent.

Pour les clients avec un inventaire de logiciels inhabituel (contrôle industriel, spécifique à la santé, apps d'affaires sur mesure avec patrons hérités), utilisez le pré-déploiement Audit de la section précédente à la place — basculer chaque règle en Audit, faire rouler pendant 14 à 30 jours, bâtir les exclusions, puis basculer en Block.

**L'accès contrôlé aux dossiers** livre en Audit par conception. Les opérateurs qui veulent l'activer en mode Block (protection contre les rançongiciels plus forte) devraient le faire par client après avoir construit une liste d'autorisation d'apps légitimes qui écrivent dans des dossiers protégés. C'est une mise à niveau de durcissement, pas une partie du déploiement standard.

**Le modèle Block mshta.exe** peut se déployer directement sans fenêtre d'audit — la surface d'échec est si étroite que presque aucun flux légitime n'utilise mshta.exe en 2026.

## Quoi surveiller après l'application

**Matchs de règles ASR par règle par appareil.** Une fois en mode Block, les matchs devraient être rares. Les pointes indiquent soit de l'activité de maliciel (vrais positifs), soit de l'activité légitime-mais-non-documentée qui a besoin d'une exclusion.

**Bris de flux rapportés par les utilisateurs.** Tracez chaque plainte « X a arrêté de fonctionner ». Triage par cause ASR probable; documentez chaque exclusion ajoutée.

**Événements d'audit d'accès contrôlé aux dossiers.** Même en mode Audit, CFA journalise chaque tentative d'écriture dans un dossier protégé par une app non sur la liste d'autorisation. C'est du renseignement utile — ça vous montre exactement quelles apps auraient été bloquées si CFA était en mode Block. Si vous décidez un jour de basculer CFA en Block pour un client, le journal d'audit est votre source préconstruite de liste d'autorisation. Cherchez : outils de sauvegarde, clients de synchronisation (Dropbox, Google Drive, OneDrive), apps créatives, outils de productivité qui sauvegardent automatiquement dans Documents.

**Événements de blocage sortant mshta.exe dans le journal du pare-feu.** Devrait être de très bas volume en fonctionnement normal. Les pointes sont intéressantes — soit une vraie tentative de maliciel bloquée avec succès, soit un cas d'usage légitime-mais-rare qui a besoin d'une exclusion.

**Dérive sur l'un ou l'autre modèle.** Les deux modèles sont des cibles fréquentes pour « un admin a désactivé ça à cause [plainte d'utilisateur] ». La détection de dérive signale ceux-ci.

## La conversation avec le client

Quand vous proposez les règles ASR à un client, le pitch honnête :

- Ces règles attrapent les patrons comportementaux spécifiques que les maliciels utilisent pour s'enchaîner vers une compromission réussie — Office-macro-vers-PowerShell-vers-téléchargement-vers-exécution, vol d'identifiants LSASS, charges utiles livrées par USB, patrons de chiffrement de rançongiciels.
- Les défauts du modèle bloquent agressivement; on s'attend à ce que ça convienne proprement à la plupart des environnements, avec des exclusions par app occasionnelles pour les flux légitimes-mais-inhabituels.
- Si votre environnement a des apps d'affaires inhabituelles — n'importe quoi sur mesure, spécifique à l'industrie, ou avec des patrons de macro Office bizarres — on fera rouler un pré-déploiement en mode Audit de 14 à 30 jours avant de basculer en Block, pour qu'on trouve les flux légitimes qui briseraient avant qu'ils brisent vraiment.
- L'accès contrôlé aux dossiers est activé en mode Audit (journalisation seulement). Une protection contre les rançongiciels plus forte (CFA en Block) est une mise à niveau de durcissement séparée qu'on peut appliquer une fois qu'on a inventorié les apps qui écrivent légitimement dans les dossiers protégés sur votre flotte.

Pour les tenants dans des industries spécifiques — santé, finance, contrats gouvernementaux — les règles ASR sont souvent une attente réglementaire. Pour les tenants sans ces moteurs, les règles ASR sont encore fortement recommandées; la proposition de valeur est plus claire si vous pouvez nommer des attaques spécifiques que le client a été préoccupé par.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**Le modèle livre agressif — 19 règles ASR en Block, CFA en Audit — et est destiné à se déployer tel quel sur les tenants PME grand public.** Tendez vers le patron de pré-déploiement Audit quand vous ne connaissez pas l'inventaire d'apps du client, quand le client fait rouler des logiciels d'affaires inhabituels, ou quand des déploiements précédents ont signalé des bris faux positifs. Ne tendez pas vers ça comme défaut — l'intention de conception du modèle, c'est direct-vers-Block.

**Le modèle Block mshta.exe est le modèle pour la défense LOLBin.** Chirurgical, focalisé, rayon d'explosion étroit. À mesure que Microsoft ajoute plus de couverture LOLBin à ses défenses intégrées, ce genre de règle supplémentaire focalisée pourrait devenir moins nécessaire — mais pour l'instant, mshta.exe spécifiquement est un favori connu des attaquants et le blocage est bien ciblé.

**Maintenez les listes d'exclusions par client.** Chaque exclusion ASR est par client (parce que chaque client a différentes apps d'affaires et différents logiciels de niche). Le système d'exemption de Panoptica365 peut les suivre; elles ont besoin de maintenance continue à mesure que l'inventaire d'apps du client change.

## Ce qui suit

- **Leçon 8 : Account Protection + Block MSA.** Windows Hello for Business, Credential Guard, blocage des ajouts de comptes Microsoft personnels sur les appareils gérés.
- **Leçon 9 : La boucle de conformité en production.** Comment tous ces modèles font surface comme signaux.

Pour l'instant : règles ASR + Block mshta.exe forment la couche de défense préemptive basée sur le comportement. Déployez comme le modèle livre pour les tenants grand public (direct-vers-Block, CFA en Audit); utilisez le pré-déploiement en mode Audit quand l'environnement du client est inhabituel. La discipline de savoir *quelle posture convient à quel client*, c'est ce qui fait que ce modèle ajoute de la valeur plutôt que de la friction.

---

*Sources des données dans cette leçon — Microsoft Learn sur les règles ASR ([Microsoft Learn — Attack surface reduction rules reference](https://learn.microsoft.com/en-us/defender-endpoint/attack-surface-reduction-rules-reference)); conseils de déploiement des règles ASR ([Microsoft Learn — ASR rules deployment](https://learn.microsoft.com/en-us/defender-endpoint/attack-surface-reduction-rules-deployment)); accès contrôlé aux dossiers ([Microsoft Learn — Controlled Folder Access](https://learn.microsoft.com/en-us/defender-endpoint/controlled-folders)); référence LOLBin ([LOLBAS project](https://lolbas-project.github.io/)); contexte du vecteur d'attaque mshta.exe ([MITRE ATT&CK — Mshta](https://attack.mitre.org/techniques/T1218/005/)).*
