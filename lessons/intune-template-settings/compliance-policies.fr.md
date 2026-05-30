---
title: "Politiques de conformité — définir « conforme » à travers quatre plateformes"
subtitle: "Les quatre politiques de conformité Panoptica365 — Windows, iOS, Android, macOS — et le seuil minimal qu'elles appliquent."
icon: "monitor-check"
last_updated: 2026-05-29
---

# Politiques de conformité — définir « conforme » à travers quatre plateformes

Une politique de conformité, c'est le document qui répond à une seule question : *qu'est-ce que ça veut dire pour un appareil d'être considéré « conforme » dans le tenant de ce client?*

La réponse alimente directement l'accès conditionnel. Quand une politique d'AC dit « exiger un appareil conforme » (le patron tueur d'AiTM de la leçon 4 de la carte 3), le signal de conformité d'appareil qu'elle lit vient de la politique de conformité que vous avez écrite. Pas du profil de configuration Intune qui *applique* les paramètres sur l'appareil — la politique de conformité qui *évalue* si l'appareil rencontre la barre.

Cette distinction compte et porte souvent à confusion. Le modèle BitLocker Settings de Panoptica365 *fait que BitLocker arrive* sur les appareils Windows. La politique de conformité Windows de Panoptica365 *vérifie si BitLocker est activé* et rapporte conforme ou non conforme en conséquence. Même résultat (BitLocker activé), deux politiques différentes faisant des travaux différents. Vous avez besoin des deux.

Cette leçon parcourt les quatre politiques de conformité de la bibliothèque Panoptica365 : Windows, iOS/iPadOS, Android et macOS. Chacune est petite (sous 2 Ko de JSON), avec des opinions, et intentionnellement souple — elles définissent la barre minimum, pas la cible aspirationnelle.

## Les quatre politiques

### Panoptica365 - Windows Compliance

La politique de conformité Windows est la plus conséquente parce que Windows est la plateforme dominante d'appareils gérés dans les environnements PME MSP. Ce qu'elle vérifie vraiment :

- **Defender activé** (`defenderEnabled: true`) — Microsoft Defender Antivirus doit fonctionner.
- **Protection en temps réel activée** (`rtpEnabled: true`) — la PTR doit être allumée, pas juste installée.
- **Antivirus requis** (`antivirusRequired: true`) — un antivirus doit être présent.
- **Antilogiciel espion requis** (`antiSpywareRequired: true`) — moteur antilogiciel espion présent.
- **Pare-feu actif requis** (`activeFirewallRequired: true`) — Windows Defender Firewall doit être actif.
- **Vérification de signature périmée** (`signatureOutOfDate: true`) — signale les appareils avec des signatures AV périmées.
- **Protection contre les menaces sur l'appareil activée** (`deviceThreatProtectionEnabled: true`) au niveau `low` — Defender for Endpoint doit rapporter aucune menace à haute confiance.

Ce qu'elle *ne vérifie délibérément pas :*

- **BitLocker** n'est *pas* requis. (Remarquez le `bitLockerEnabled: false`.) C'est un vrai choix. L'application de BitLocker se fait via le modèle BitLocker Settings (leçon 4); la politique de conformité ne le demande pas.
- **Mot de passe** n'est *pas* requis. (`passwordRequired: false`.) L'application du mot de passe Windows vient du Security Baseline (leçon 3) ou de la stratégie de groupe ailleurs.
- **TPM** n'est *pas* requis. (`tpmRequired: false`.) La plupart du matériel Windows moderne a un TPM, mais l'exiger ferait échouer la conformité pour des appareils de flotte plus vieux.
- **Démarrage sécurisé** n'est *pas* requis. Même raison.
- **Version minimum de l'OS** n'est *pas* fixée. La politique de conformité ne demande pas Windows 11 ni aucune version spécifique.

Pourquoi la souplesse? Parce que la politique de conformité, c'est la *barre minimum pour la barrière d'appareil-conforme de l'AC*. Si vous la mettez trop haute, des appareils par ailleurs correctement configurés échouent à la conformité et perdent l'accès à M365 — même quand il n'y a rien d'anormal de leur point de vue sécurité. La politique de conformité Windows de Panoptica365 pèche du côté « si Defender roule, cet appareil est assez conforme pour accéder à M365 ». Le durcissement au-delà de cette barre se passe dans les modèles de configuration (BitLocker, Security Baseline, règles ASR) — séparément de l'évaluation de conformité.

C'est un choix *défendable*. Un autre MSP pourrait exiger BitLocker comme critère de conformité. Le compromis : des critères de conformité plus stricts attrapent plus de brèches de sécurité mais produisent aussi plus de faux positifs de non-conformité quand l'état de l'appareil est brièvement incohérent (BitLocker temporairement désactivé pour une opération de récupération, signatures brièvement périmées pendant une fenêtre de mise à jour, etc.). La barre souple priorise la stabilité du signal d'appareil-conforme de l'AC sur le durcissement agressif.

### Panoptica365 - iOS/iPadOS Compliance

La conformité mobile est légère par conception. Les appareils iOS dans le contexte PME sont massivement BYOD — téléphones personnels utilisés pour lire le courriel corporatif. L'inscription MDM complète sur un téléphone personnel, c'est quelque chose que les utilisateurs repoussent et que beaucoup de MSP n'essaient pas d'imposer.

Ce que la politique iOS vérifie :

- **Code d'accès requis** (`passcodeRequired: true`) — l'appareil doit avoir un code d'accès.
- **Longueur minimum du code d'accès : 4 caractères.**
- **Maximum 5 minutes d'inactivité avant verrouillage** (`passcodeMinutesOfInactivityBeforeLock: 5`).
- **Compte de blocage des 24 codes d'accès précédents** — ne peut pas réutiliser les 24 derniers codes.
- **Détection de jailbreak** (`securityBlockJailbrokenDevices: true`) — bloque les appareils signalés comme jailbreakés.

Ce qu'elle ne vérifie pas :

- **Version minimum de l'OS** n'est pas fixée. iOS reçoit les mises à jour de sécurité agressivement; les utilisateurs sont généralement sur des versions courantes; demander un minimum spécifique attraperait un petit nombre d'appareils sur d'anciennes versions iOS qui ne peuvent probablement pas se mettre à jour de toute façon.
- **Protection contre les menaces d'appareil** n'est pas requise (Defender for Endpoint sur iOS existe mais n'est pas standard pour le BYOD PME).
- **Profil de courriel géré** n'est pas requis. Les utilisateurs accèdent au courriel via leur app Outlook/Apple Mail grand public, pas via une configuration gérée.

L'encadrement honnête : cette politique assure les bases (code d'accès + écran de verrouillage + non jailbreaké) et accepte que le reste du durcissement d'appareil mobile soit hors de la portée PME-MSP. Si un client veut un MDM mobile plus strict, il veut une autre relation MSP.

### Panoptica365 - Android Compliance

La politique Android est configurée pour le mode **Android Open Source Project (AOSP) Device Owner** — le modèle Android Enterprise. Ce qu'elle vérifie :

- **Chiffrement de stockage requis** (`storageRequireEncryption: true`) — le chiffrement de l'appareil doit être activé.
- **Mot de passe requis** (`passwordRequired: true`).
- **15 minutes d'inactivité avant verrouillage** (`passwordMinutesOfInactivityBeforeLock: 15`).
- **Détection de jailbreak / root** (`securityBlockJailbrokenDevices: true`).

Notamment absent : version minimum de l'OS, niveau minimum de patch de sécurité Android, vérification des applications. Même raisonnement qu'iOS — ça ferait échouer la conformité sur des appareils que les clients ne peuvent pas facilement mettre à niveau.

Le mode AOSP Device Owner est spécifiquement pour les appareils Android *appartenant à l'entreprise et entièrement gérés*. Pour les appareils Android *appartenant aux personnes* utilisant un profil de travail, la structure de la politique de conformité est légèrement différente et n'est pas représentée dans la bibliothèque Panoptica365. Si un client a une flotte Android-BYOD significative, ce modèle ne couvre pas ce scénario directement — et la portée mobile de Panoptica365, c'est « signal de conformité pour ce qui est inscrit, rien de plus ».

### Panoptica365 - macOS Compliance

macOS reçoit moins d'attention dans la plupart des contextes PME-MSP parce que la flotte est petite. La politique de conformité reflète ça :

- **Mot de passe requis** (`passwordRequired: true`).
- **Longueur minimum du mot de passe : 6 caractères.**
- **Chiffrement de stockage requis** (`storageRequireEncryption: true`) — FileVault doit être activé.
- **Pare-feu activé** (`firewallEnabled: true`) — pare-feu macOS activé.
- **Pare-feu bloque tout l'entrant** (`firewallBlockAllIncoming: true`) — blocage entrant strict.

Notamment *pas* requis : System Integrity Protection (SIP). La plupart des installations macOS modernes ont SIP activé par défaut, mais il peut être désactivé par des utilisateurs sophistiqués. La politique de conformité ne le demande pas.

Aussi notable : `gatekeeperAllowedAppSource: "anywhere"` — la politique de conformité n'impose pas de restrictions Gatekeeper sur les sources d'applications. C'est permissif; une politique plus stricte mettrait ça à `macAppStore` ou `macAppStoreAndIdentifiedDevelopers`. Le défaut Panoptica365 accepte ce que le client a configuré au niveau de l'OS.

Pour la plupart des tenants PME avec un ou deux utilisateurs Mac, cette barre de conformité est appropriée. Pour les clients avec des flottes Mac substantielles (agences créatives, ateliers de dev), l'opérateur devrait considérer durcir ce modèle via le flux de personnalisation à la leçon 10.

## Le signal de conformité vs la configuration

Un patron qui mérite d'être nommé explicitement : la bibliothèque Panoptica365 traite la conformité et la configuration comme des préoccupations séparées. Chaque politique de conformité est jumelée avec un ou plusieurs modèles de configuration qui *font* que l'appareil rencontre cette barre.

Pour Windows :
- La politique de conformité dit « Defender doit être activé » → configuration livrée par le modèle Defender Settings (leçon 5).
- La politique de conformité dit « le pare-feu doit être actif » → configuration livrée par le modèle Firewall Settings (leçon 6).
- (BitLocker n'est pas dans la barre de conformité mais EST dans la configuration → modèle BitLocker Settings, leçon 4.)

Pour macOS, il *y a* un modèle de configuration jumelé — **Panoptica365 - Defender Settings macOS** (couvert à la leçon 5). Il active Defender pour macOS, active la protection en temps réel, et active la soumission automatique d'échantillons. Donc la paire macOS existe, mais elle est structurellement plus légère que la paire Windows — et la raison, c'est Microsoft, pas Panoptica365. La politique de conformité macOS dans Intune expose exactement ces critères : System Integrity Protection, version de l'OS, règles de mot de passe, FileVault, pare-feu + mode furtif, et Gatekeeper. C'est toute la liste. Pas de ligne Defender, pas de ligne protection-en-temps-réel, pas de niveau Protection contre les menaces sur l'appareil (qui sur Windows est le signal de santé Defender-for-Endpoint). Vous pouvez *configurer* Defender sur macOS via le modèle de configuration; vous ne pouvez pas *vérifier* son état via la politique de conformité du tout. La politique de conformité macOS de Panoptica365 vérifie donc les choses que Microsoft expose, et le modèle Defender Settings macOS gère le côté configuration sans vérification de conformité correspondante. Si vous vous êtes demandé pourquoi l'histoire macOS semble à moitié finie, c'est pour ça.

Pour iOS et Android : il n'y a pas de modèle de configuration jumelé dans la bibliothèque Panoptica365 — seulement la politique de conformité. La configuration, c'est la responsabilité de l'utilisateur (il met son propre code d'accès, il garde le chiffrement activé).

Cette séparation reflète le vrai modèle d'affaires : gestion configuration-plus-conformité complète sur Windows (parce que le MSP possède effectivement ces appareils via le client); une paire de configuration plus légère sur macOS limitée par ce que l'API de conformité Microsoft supporte; signal-de-conformité-seulement sur iOS et Android (parce que le MSP ne possède pas ces appareils et ne peut pas pousser de configuration).

Le point à retenir honnête : un client qui veut que ses iPhones, iPads ou appareils Android soient *gérés* (pas juste *vérifiés pour conformité*) a besoin d'une autre conversation. La bibliothèque incluse de Panoptica365 ne couvre pas ce scénario par conception. Les opérateurs qui en ont besoin — ou qui ont besoin d'une configuration macOS plus profonde que Defender — peuvent construire leurs propres modèles de configuration et les importer via le flux à la leçon 10.

## Déploiement

Les politiques de conformité se déploient à l'état Activé, comme tous les modèles Panoptica365. Pour ces politiques spécifiques, l'approche déployer-chaud est presque toujours sûre — la barre est intentionnellement basse et les vérifications sont conservatrices :

- Un nouvel appareil Windows avec Defender qui roule passe immédiatement.
- Un nouvel iPhone avec un code d'accès et non jailbreaké passe immédiatement.
- Un nouveau Mac avec FileVault activé passe immédiatement.

Le déploiement au groupe pilote du pré-déploiement de la leçon 1 reste recommandé, mais la fenêtre de vérification est courte — 24 à 48 heures suffit habituellement. Cherchez :

- Les appareils marqués **Pas encore évalué** qui auraient dû être évalués maintenant (indique un bris de la boucle de conformité — voir la leçon 9).
- Les appareils marqués **Non conforme** pour une raison qui vous surprend. Surprise fréquente : une fenêtre de timing de signature Defender où un appareil apparaît brièvement non conforme à cause de la péremption.
- Les appareils qui *n'apparaissent pas* dans l'évaluation de conformité du tout. Veut habituellement dire qu'ils ne sont pas inscrits Intune et que la politique n'a pas de cible.

Après l'application (ce qui pour les politiques de conformité est « déployées et en cours d'évaluation »), surveillez :

- **Ratio de conformité global.** La tuile appareils de Panoptica365 vous donne le titre (p. ex. « 32/57 conformes »). Sain, c'est 95 %+ de conformes pour l'ensemble évalué. Sous 90 %, ça veut dire que quelque chose de structurel ne va pas — modèle mal configuré, problème d'infrastructure, ou un paquet d'appareils qui ne devraient pas être inscrits.
- **Vérification de santé par plateforme.** Utilisez la répartition Devices by OS pour confirmer que le mélange de plateformes est ce que vous attendez. Si vous voyez des comptes bouger de façon inattendue (un paquet d'appareils Windows disparaît, un OS inconnu apparaît), ça vaut la peine d'enquêter.
- **Raisons fréquentes de non-conformité.** Plongez dans les appareils non conformes dans le portail Intune et lisez la raison spécifique d'échec — Microsoft fait remonter quelle vérification a échoué par appareil. Si « Defender désactivé » apparaît à travers plusieurs appareils, vous avez un vrai problème (Defender ne devrait pas être éteint sur des machines Windows gérées). Quelques-uns isolés, c'est du bruit; une grappe avec la même raison, c'est un signal. Panoptica365 n'agrège pas ces raisons pour vous, donc le repérage de patrons est un travail manuel dans le portail Intune.
- **Appareils qui basculent à répétition entre conforme et non conforme.** C'est le « flottement de conformité » — habituellement un problème de timing de synchronisation ou un paramètre qui est appliqué de façon inégale par un modèle de configuration. L'attraper, c'est manuel : remarquer dans le portail Intune qu'un appareil a rebondi d'état plusieurs fois en une semaine, puis enquêter par appareil. La leçon 9 parcourt les modes d'échec.

## Ce que Panoptica365 voit

L'état de conformité par appareil entre dans Panoptica365 depuis Microsoft Graph. Le tableau de bord client fait remonter trois choses à ce sujet, gardées délibérément haut niveau :

- **La liste des appareils gérés Intune** — chaque appareil inscrit avec son OS, son état de conformité actuel (conforme / non conforme / non évalué), l'utilisateur assigné et le dernier horodatage de synchronisation. Le compartiment « non évalué » inclut des choses comme les serveurs Windows qui ne sont pas du tout gérés par Intune — ils apparaissent parce qu'ils sont enregistrés Entra mais ils n'obtiennent jamais de verdict de conformité.
- **Une tuile « Appareils conformes »** — le titre, c'est le pourcentage de conformité en gros caractères (p. ex. « 94 % » ou « 60 % »), codé par couleur selon la posture (vert quand sain, rouge quand faible). Le sous-titre lit « X de Y conformes, Z non évalués » — trois chiffres qui vous racontent toute l'histoire : combien d'appareils Panoptica365 a évalués avec succès, combien de ceux-là ont passé, et combien d'appareils inscrits n'ont jamais obtenu de verdict (typiquement des serveurs qu'Intune ne gère pas, des appareils fraîchement inscrits encore dans leur première fenêtre de synchronisation, ou des appareils avec un client Intune brisé). Quand le pourcentage change entre les sondages, une flèche de tendance montre la direction — rouge vers le bas sur une baisse, vert vers le haut sur une amélioration.
- **Appareils par OS** — une répartition par comptes (Windows N, iOS N, Android N, Windows Server N, etc.).

C'est la surface. La raison d'échec par appareil, la file de triage > 24 heures, le patron de flottement — ceux-là ne vivent pas dans le tableau de bord Panoptica365. Ils vivent dans le portail Intune, un appareil à la fois. La plateforme pointe vers *que* quelque chose ne va pas (un appareil est tombé hors conformité, le compte conforme a baissé); Microsoft vous dit *pourquoi*.

C'est cohérent avec la façon dont Panoptica365 est positionné en général — lecture seule, axé sur les alertes, plonger dans les consoles Microsoft pour le diagnostic profond. La leçon sur la boucle de conformité (leçon 9) parcourt à quoi ressemble la surveillance opérationnelle en pratique avec cette division.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**La conformité est une barre, pas une configuration.** Ces quatre politiques *évaluent* les appareils; elles ne *configurent* pas les appareils. Les modèles de configuration des leçons 3 à 8 font la configuration. Les deux sont nécessaires.

**Les barres de conformité souples sont une fonctionnalité, pas un bogue.** Une politique de conformité stricte qui attrape chaque incohérence d'état d'appareil produit un signal AC bruyant. Les défauts Panoptica365 penchent vers la stabilité. Les clients qui ont besoin d'une conformité plus stricte (industries réglementées, durcissement post-incident) peuvent personnaliser — mais les défauts sont appropriés pour la plupart des tenants PME.

**La conformité mobile et macOS sont autant des déclarations de portée que des contrôles de sécurité.** Elles disent au client « voici ce qu'on vérifie; voici ce qu'on ne vérifie pas ». Les opérateurs qui veulent une gestion mobile/macOS plus profonde doivent construire leurs propres modèles (leçon 10) ou accepter que ces plateformes sont gérées légèrement.

## Ce qui suit

- **Leçon 3 : Le Security Baseline.** L'ensemble de durcissement Windows curé — votre plus gros modèle unique.
- **Leçon 4 : BitLocker Settings.** Configuration du chiffrement de disque que la politique de conformité Windows *n'exige pas* mais que la posture de durcissement Panoptica365 déploie.

Pour l'instant : déployez les quatre politiques de conformité comme une unité. Elles sont la fondation pour le chemin appareil-conforme de l'AC. Sans elles, les modèles des cartes 3.4 et 3.5 n'ont rien à lire.

---

*Sources des données dans cette leçon — Microsoft Learn sur la structure des politiques de conformité ([Microsoft Learn — Device compliance policies](https://learn.microsoft.com/en-us/mem/intune/protect/device-compliance-get-started)); référence de politique de conformité Windows ([Microsoft Learn — Windows 10/11 compliance settings](https://learn.microsoft.com/en-us/mem/intune/protect/compliance-policy-create-windows)); paramètres de conformité iOS ([Microsoft Learn — iOS/iPadOS compliance settings](https://learn.microsoft.com/en-us/mem/intune/protect/compliance-policy-create-ios)); conformité Android Enterprise ([Microsoft Learn — Android Enterprise compliance settings](https://learn.microsoft.com/en-us/mem/intune/protect/compliance-policy-create-android-for-work)); conformité macOS ([Microsoft Learn — macOS compliance settings](https://learn.microsoft.com/en-us/mem/intune/protect/compliance-policy-create-mac-os)).*
