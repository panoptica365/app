---
title: "BitLocker Settings — posture de chiffrement de disque"
subtitle: "Appliquer le chiffrement complet du disque sur les appareils Windows via Intune — ce que le modèle configure, la gestion des clés de récupération et les dépendances TPM."
icon: "hard-drive"
last_updated: 2026-05-29
---

# BitLocker Settings — posture de chiffrement de disque

Si un portable géré est volé d'une voiture stationnée à 2 h du matin et que le voleur est un opportuniste générique, le voleur obtient un portable qu'il peut effacer et revendre pour quelques centaines de dollars. Si le disque du portable est chiffré, les données du client partent avec le portable. Si ce n'est pas le cas, les données du client sont maintenant quelque part sur Internet d'ici une semaine, selon à qui le voleur l'a revendu et ce qu'ils ont fait avec le disque original.

BitLocker, c'est la différence entre ces deux résultats sur les appareils Windows. Le modèle BitLocker Settings de Panoptica365, c'est la configuration qui l'applique.

Cette leçon couvre ce que le modèle BitLocker Settings configure vraiment, pourquoi certains choix ont été faits comme ils l'ont été, et comment gérer les réalités opérationnelles — clés de récupération, dépendances TPM, la distinction mise-à-niveau-vs-installation-propre.

## Ce que le modèle configure

Le modèle BitLocker Settings de Panoptica365 utilise le type de modèle plus ancien **Device Configurations** (`windows10EndpointProtectionConfiguration`). C'est la même famille de modèles que Microsoft utilise pour les paramètres hérités de protection de terminal. Il se déploie via MDM aux appareils Windows 10/11.

Les configurations BitLocker de base :

**BitLocker activé et appliqué.**
- `bitLockerEncryptDevice: true` — les appareils doivent être chiffrés.
- `bitLockerAllowStandardUserEncryption: true` — les utilisateurs standards (non admin) sont autorisés à initier le chiffrement.
- `bitLockerDisableWarningForOtherDiskEncryption: true` — supprime les avertissements quand un chiffrement de disque tiers est aussi présent.

**Politique du lecteur système (le lecteur de l'OS — typiquement C:) :**
- Méthode de chiffrement : **XTS-AES 256 bits**. C'est le chiffrement moderne recommandé pour Windows 10 1511 et les versions ultérieures. Plus fort que les anciennes variantes AES-CBC.
- Authentification au démarrage requise (protégée par TPM par défaut).
- Utilisation d'un NIP de démarrage TPM autorisée.
- Bloquer l'authentification au démarrage sans TPM (pas de mode NIP-seulement — TPM est requis).
- Options de récupération configurées : la clé de récupération BitLocker peut être stockée dans Microsoft Entra ID; agent de récupération de données autorisé; utilisation de mot de passe de récupération autorisée.

**Lecteurs fixes (lecteurs de données qui ne sont pas le lecteur OS — typiquement D:, E:, etc.) :**
- Méthode de chiffrement : **XTS-AES 256 bits** (comme le lecteur système).
- Chiffrement non requis pour l'accès en écriture (`requireEncryptionForWriteAccess: false`) — les appareils peuvent encore écrire sur des lecteurs fixes non chiffrés. C'est le choix souple; la version stricte refuserait l'accès en écriture.
- Options de récupération similaires au lecteur système.

**Lecteurs amovibles (clés USB, disques durs externes) :**
- Méthode de chiffrement : **AES-CBC 128 bits**. Remarquez la différence avec les lecteurs système/fixes — les lecteurs amovibles utilisent le chiffrement AES-CBC plus ancien parce que XTS-AES est incompatible avec les versions plus anciennes de Windows sur lesquelles le client ou ses partenaires pourraient encore lire le lecteur. AES-CBC 128, c'est encore assez moderne; le choix échange un peu de force de chiffrement contre de la compatibilité.
- Chiffrement non requis pour l'accès en écriture — même patron souple que les lecteurs fixes.
- Accès en écriture inter-organisations non bloqué.

**Au-delà de BitLocker — le modèle configure aussi quelques paramètres de durcissement de terminal :**

Le type de modèle Device Configurations regroupe BitLocker avec d'autres paramètres de protection de terminal dans le même JSON. Le modèle Panoptica365 ne configure explicitement que BitLocker; tout le reste est mis à `notConfigured` ou `userDefined`, ce qui veut dire « ce modèle ne prend pas position ». Quelques paramètres non-BitLocker *sont* explicitement définis :

- `lanManagerAuthenticationLevel: lmAndNltm` — accepte à la fois l'authentification LM et NTLM (relativement permissif — plus strict serait `ntlmV2Only`).
- `localSecurityOptionsMinimumSessionSecurityForNtlmSspBasedClients: none` — pas de sécurité de session NTLM minimum (très permissif).
- `localSecurityOptionsMinimumSessionSecurityForNtlmSspBasedServers: none` — pareil.
- `localSecurityOptionsSmartCardRemovalBehavior: noAction` — rien ne se passe quand une carte à puce est retirée.
- `xboxServicesAccessoryManagementServiceStartupMode: manual` (et trois autres services Xbox mis à manuel) — ces services liés à Xbox ne démarrent pas automatiquement au boot, retirant un peu de surface d'attaque sur les appareils qui ne sont pas des PC de jeu.

Les choix de services Xbox sont *intéressants*. La plupart des appareils de flotte Windows gérés ne sont pas des PC de jeu, mais les services Xbox sont présents dans les installations Windows standards et démarrent automatiquement par défaut. Les mettre à manuel retire des services en arrière-plan que rien dans un environnement corporatif n'utilise. Durcissement à faible levier, mais gratuit.

Les choix LM Manager / sécurité de session NTLM sont *permissifs* et valent la peine de connaître — ils n'appliquent pas le durcissement NTLM moderne. Si un client a besoin de NTLM strict (industries réglementées, exigences de baseline durci), ces paramètres devraient être durcis via le Security Baseline (leçon 3) ou via personnalisation.

## Dépendance TPM

Le modèle BitLocker de Panoptica365 exige que l'authentification au démarrage utilise le TPM (Trusted Platform Module). Spécifiquement :

- `startupAuthenticationRequired: true` (doit avoir une auth au démarrage)
- `startupAuthenticationBlockWithoutTpmChip: true` (TPM requis — pas de repli NIP-seulement)

Presque tous les appareils Windows fabriqués dans la dernière décennie ont une puce TPM 2.0. Windows 11 *exige* TPM 2.0 pour l'installation, donc n'importe quel appareil Windows 11 en a un par définition. Les appareils Windows 10 peuvent ou non en avoir, selon l'âge et la configuration.

Pour les appareils sans TPM (ou avec TPM désactivé dans le BIOS — parfois le cas sur du matériel pas cher où les défauts du BIOS l'ont désactivé) :

- Le chiffrement BitLocker avec ce modèle *échouera à démarrer* — la politique demande TPM, l'appareil n'en a pas ou il est désactivé, et le chiffrement ne peut pas s'initier.
- La solution est soit d'activer TPM dans le BIOS (souvent possible sur les appareils où il a été désactivé par défaut), soit de remplacer l'appareil.

En pratique, ça compte rarement pour les tenants PME parce que le matériel équipé TPM est standard depuis le début des années 2010. Mais occasionnellement un vieil appareil fait surface dans l'inventaire — habituellement une tour de bureau que quelqu'un a achetée pas chère il y a des années — et cet appareil échoue au déploiement BitLocker. Gérez au cas par cas.

## Gestion des clés de récupération — la partie qui compte le plus

BitLocker n'est utile que si vous pouvez récupérer les données chiffrées quand quelque chose tourne mal. Scénarios de récupération :

- L'utilisateur oublie son NIP (si l'authentification par NIP est configurée).
- Des changements matériels déclenchent l'invite de récupération BitLocker (remplacement de carte mère, parfois une mise à niveau de RAM, occasionnellement une mise à jour BIOS).
- La configuration de démarrage de l'appareil devient incohérente (mise à jour de fonctionnalité Windows, parfois une tentative de dual-boot Linux).
- L'appareil est réinitialisé et la clé de récupération est la seule façon de déverrouiller les données de l'installation précédente.

Le modèle BitLocker de Panoptica365 stocke les clés de récupération dans **Microsoft Entra ID** (l'emplacement infonuagique moderne). Quand un appareil Windows se joint à Entra et que BitLocker s'initialise, la clé de récupération est téléversée à Entra automatiquement. Les opérateurs peuvent la récupérer depuis le portail d'administration Entra sous les propriétés de l'appareil.

Trois réalités opérationnelles à comprendre :

**Les clés de récupération *doivent* atterrir dans Entra, pas juste sur l'appareil.** Les appareils gérés avant Intune qui ont initialisé BitLocker avant l'inscription peuvent avoir des clés de récupération stockées localement sur l'appareil ou dans un emplacement de récupération AD hybride. Le modèle Panoptica365 ne remplit pas rétroactivement ces clés. Après le déploiement, exécutez un audit de clés de récupération par client — confirmer que chaque appareil chiffré a sa clé téléversée à Entra. Les appareils sans clés de récupération dans Entra sont des appareils qui seront impossibles à récupérer si l'utilisateur reçoit une invite de récupération.

**Les clés de récupération sont par installation d'OS, pas par appareil.** Si un appareil est effacé et réinstallé, la nouvelle installation génère une nouvelle clé de récupération. L'ancienne clé est encore dans Entra mais elle est inutile pour la nouvelle installation. Le nettoyage des clés de récupération périmées est une tâche de maintenance séparée; pour l'instant, traitez l'existence de plusieurs clés par numéro de série d'appareil comme un indice que l'appareil a été réinstallé.

**La clé de récupération est une préoccupation de classification de données client.** Une clé de récupération entre de mauvaises mains déverrouille un appareil chiffré. Les admins clients avec des permissions de lecture Entra peuvent voir les clés de récupération de n'importe quel appareil. C'est parfois un enjeu de vie privée (appareils gérés par les RH chiffrés avec personnalisation par NIP personnel, appareils dans des industries réglementées avec des exigences de chaîne de garde). Documentez qui a accès aux clés de récupération par tenant client. Auditez l'accès via le journal d'audit Entra.

## Ce qui peut briser

Le déploiement BitLocker est surtout sûr mais pas entièrement. Surveillez :

**Chiffrement initial lent sur les vieux appareils.** Quand BitLocker s'initialise sur un appareil qui a été en usage pendant des années, la première passe de chiffrement peut prendre 4 à 8 heures et dégrader significativement la performance pendant ce temps. Planifiez le chiffrement initial hors des heures où c'est possible.

**Conflits avec un chiffrement tiers.** Un client qui a déjà Symantec Endpoint Encryption, McAfee Drive Encryption, ou un autre produit de chiffrement de disque complet installé produira des conflits. Le `bitLockerDisableWarningForOtherDiskEncryption: true` du modèle Panoptica365 supprime *l'avertissement*, mais le conflit peut encore se manifester comme un échec de chiffrement ou des problèmes de démarrage. Avant de déployer, confirmer qu'aucun autre FDE n'est en jeu.

**Les mises à jour BIOS / firmware peuvent déclencher des invites de récupération.** Quand une mise à jour Windows ou un utilitaire de fournisseur met à jour le BIOS ou le firmware TPM, BitLocker peut détecter le changement et demander la clé de récupération au prochain démarrage. L'utilisateur voit un écran bleu effrayant demandant une clé numérique à 48 chiffres. Si la clé de récupération est dans Entra, le service d'aide peut la récupérer et guider l'utilisateur. Si la clé de récupération manque dans Entra, l'utilisateur est verrouillé dehors. C'est pour ça que l'audit des clés de récupération Entra (plus haut) compte tellement.

**BitLocker sur les lecteurs amovibles est agaçant pour le partage inter-organisations.** Un utilisateur chiffre une clé USB avec BitLocker, l'apporte à une organisation partenaire, et la machine du partenaire ne peut pas la lire (BitLocker-To-Go exige le mot de passe à chaque accès). Pour les clients PME, le chiffrement de lecteur amovible se fait parfois repousser par les utilisateurs — ils veulent que leurs clés USB fonctionnent partout. Le modèle *n'exige pas* le chiffrement pour l'accès en écriture aux lecteurs amovibles (`requireEncryptionForWriteAccess: false`), donc c'est une application souple; les utilisateurs peuvent encore utiliser des clés USB non chiffrées. L'intention du modèle, c'est « si vous chiffrez, utilisez ce chiffrement » — pas « vous devez chiffrer ».

## Déploiement

Déploiement standard au groupe pilote de la leçon 1 :

1. **Jour 0** — déployer à 3 à 5 appareils Windows pilotes. Choisissez des appareils *qui ne sont pas* en usage de production active la nuit (la première passe de chiffrement est lente).
2. **Jours 1 à 2** — vérifier que les appareils pilotes ont complété le chiffrement (le portail Intune montre la conformité BitLocker). Confirmer que les clés de récupération apparaissent dans Entra pour chaque appareil pilote.
3. **Jour 3 à 7** — observer les appareils pilotes en usage normal. Quelque chose de bizarre? Des invites de récupération déclenchées? Plaintes de performance?
4. **Jour 7** — déploiement plus large si le pilote est propre. Planifier le déploiement à la flotte du client pour atterrir un vendredi après-midi pour que la passe de chiffrement se complète durant la fin de semaine.

Cas spécial : une flotte cliente qui n'a jamais eu BitLocker appliqué avant verra un impact notable sur la performance pendant les premières 48 heures alors que tous les appareils chiffrent en parallèle. Communiquez ça au client à l'avance. Après la passe de chiffrement initiale, le coût permanent de BitLocker est essentiellement nul.

## Quoi surveiller après l'application

**Conformité BitLocker par appareil.** Devrait être près de 100 % sur les appareils Windows après la fenêtre de chiffrement initiale. Les appareils qui montrent la non-conformité ont besoin d'enquête par appareil — habituellement TPM désactivé, matériel trop vieux, ou paramètres BIOS empêchant le chiffrement.

**Clés de récupération dans Entra.** Chaque appareil chiffré BitLocker devrait avoir une clé de récupération dans Entra. Exécutez un audit trimestriel : liste d'appareils avec BitLocker activé vs liste de clés de récupération Entra. Les écarts sont des appareils qui seront irrécupérables.

**Invites de récupération déclenchées.** Une pointe d'invites de récupération (l'utilisateur appelle le service d'aide pour la clé à 48 chiffres) corrèle habituellement avec une vague de mises à jour Windows, mises à jour BIOS, ou changements matériels. Tracez la source.

**Dérive de méthode de chiffrement.** Si un appareil montre BitLocker activé mais avec un chiffrement plus ancien (p. ex., AES-CBC 128 sur un lecteur système qui devrait être XTS-AES 256), l'appareil a probablement été chiffré *avant* que le modèle applique le standard actuel. La solution, c'est de déchiffrer et rechiffrer avec la bonne méthode, ce qui est agaçant et lent. Attrapez ça au déploiement, pas plus tard.

## Ce que Panoptica365 voit

La réponse honnête : pas grand-chose, spécifiquement à propos de BitLocker. Panoptica365 ne fait pas remonter actuellement l'état BitLocker par appareil, la méthode de chiffrement par appareil, ni l'inventaire des clés de récupération nulle part dans le tableau de bord — aucune de ces choses ne vit dans le produit aujourd'hui, et le par-appareil quoi que ce soit ne fait pas partie du modèle de lecture de la plateforme du tout.

Ce que Panoptica365 *fait* remonter qui est pertinent pour BitLocker :

- **Détection de dérive sur le modèle BitLocker Settings.** Si le modèle déployé chez un tenant client diverge de la référence Panoptica365 — quelqu'un ouvre la console Intune et change un paramètre — le détecteur de dérive lance une alerte. L'opérateur peut revenir au modèle, réappliquer, ou accepter la dérive, même flux que la dérive AC.
- **Le compte global de conformité d'appareil.** BitLocker n'est pas une vérification de conformité dure dans la politique de conformité Windows de Panoptica365 (voir la leçon 2 — `bitLockerEnabled: false`), donc un appareil BitLocker-désactivé ne tombera pas hors du compte conforme par lui-même. Mais si la politique de conformité accordée par le MSP du client *exige* BitLocker, ces échecs apparaissent dans le ratio conformes/non conformes.

Pour la visibilité BitLocker par appareil — quel appareil est chiffré avec quel chiffrement, où vit la clé de récupération — les opérateurs plongent dans le portail Intune ou la section appareil Entra. C'est le flux aujourd'hui.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**BitLocker est fondamental — mais l'histoire de récupération, c'est ce qui compte le plus.** Le chiffrement protège contre le vol. La gestion de clés de récupération protège contre le verrouillage dehors de vos propres clients. Un déploiement BitLocker sans histoire d'audit de clés de récupération est à une mise à jour BIOS d'une crise de service d'aide.

**La dépendance TPM est réelle mais habituellement invisible.** La plupart du matériel Windows moderne a TPM 2.0. Les échecs de déploiement BitLocker sont presque toujours matériel-trop-vieux ou TPM-désactivé-dans-BIOS. Documentez les exceptions par appareil; ne les ignorez pas.

**La politique de lecteur amovible est permissive intentionnellement.** Le modèle spécifie le chiffrement pour les lecteurs amovibles mais n'exige pas le chiffrement. Les utilisateurs gardent leurs clés USB fonctionnelles. Si un client a besoin de plus strict (exigences de classification de données, santé, finance), personnalisez ce modèle via la leçon 10.

## Ce qui suit

- **Leçon 5 : Defender for Endpoint (Win + Mac).** La configuration antivirus / EDR — ce qui fait que Defender protège ce que BitLocker maintenant garde chiffré.
- **Leçon 6 : Firewall Settings (Windows).** Configuration du pare-feu hôte.

Pour l'instant : BitLocker en premier parce que rien d'autre ne compte si le portable d'un client sort par la porte non chiffré. Déployez-le, auditez les clés de récupération, et passez à autre chose.

---

*Sources des données dans cette leçon — Microsoft Learn sur la gestion de BitLocker via Intune ([Microsoft Learn — Manage BitLocker with Intune](https://learn.microsoft.com/en-us/mem/intune/protect/encrypt-devices)); référence des méthodes de chiffrement BitLocker ([Microsoft Learn — BitLocker encryption methods](https://learn.microsoft.com/en-us/windows/security/operating-system-security/data-protection/bitlocker/bitlocker-overview)); stockage de clé de récupération dans Entra ID ([Microsoft Learn — BitLocker recovery in Entra ID](https://learn.microsoft.com/en-us/entra/identity/devices/device-management-azure-portal#view-bitlocker-keys)); exigences TPM ([Microsoft Learn — TPM and BitLocker](https://learn.microsoft.com/en-us/windows/security/hardware-security/tpm/tpm-fundamentals)).*
