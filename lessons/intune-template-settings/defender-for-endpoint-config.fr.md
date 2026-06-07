---
title: "Configuration Defender for Endpoint — Windows + macOS"
subtitle: "28 paramètres Windows et 3 macOS qui renforcent les défauts d'usine de Defender Antivirus contre le vol d'identifiants, l'AiTM et la mise en scène de rançongiciel."
icon: "shield"
last_updated: 2026-05-29
---

# Configuration Defender for Endpoint — Windows + macOS

Un terminal Windows avec Microsoft Defender Antivirus qui roule en mode défaut d'usine est raisonnablement protégé contre les maliciels par drive-by. Il est beaucoup moins protégé contre les genres d'attaques que la carte 2 a passé sept leçons à décrire — vol d'identifiants, AiTM, suivi BEC, mise en scène de rançongiciel — parce que les paramètres par défaut laissent plusieurs des capacités de détection les plus fortes de Defender sous-ajustées.

Les modèles Defender Settings de Panoptica365 existent pour resserrer cette configuration par défaut. Le modèle Windows configure 28 comportements spécifiques de Defender Antivirus; le modèle macOS en configure trois. Les deux sont nécessaires si le client a des appareils sur la plateforme correspondante.

Cette leçon parcourt ce que chaque modèle configure, les choix qui comptent, et les réalités opérationnelles de faire rouler Defender à l'échelle de production.

## Defender Settings Windows — ce qu'il configure

Le modèle Defender Settings Windows de Panoptica365 utilise le type de modèle catalogue de paramètres (`configurationPolicies`) avec les plateformes mises à `windows10` et les technologies `mdm,microsoftSense`. Le `templateDisplayName` est « Microsoft Defender Antivirus » et la famille du modèle est `endpointSecurityAntivirus`. Autrement dit : c'est fondamentalement une configuration *antivirus* Defender, déployée via la zone de politique Endpoint Security d'Intune (la même surface où vivent les configurations MDE / Defender XDR). Le marqueur technologique `microsoftSense` signale que le modèle s'intègre au pipeline Defender for Endpoint; ça ne veut pas dire que le modèle configure les paramètres de la couche EDR. Chacun des 28 paramètres ajuste le comportement de Defender Antivirus.

Les valeurs spécifiques dans ce modèle ne sont pas arbitraires — la plupart suivent la [série MDE de Jeffrey Appel](https://jeffreyappel.nl/tag/mde-series/), une référence pratique de durcissement largement citée dans la communauté de sécurité M365. Appel est un MVP en sécurité Microsoft qui parcourt les paramètres Defender individuels avec le raisonnement derrière chacun. C'est pour ça que la posture du modèle atterrit à l'extrémité agressive de ce que Microsoft considère raisonnable plutôt qu'au milieu — il suit un baseline curé par un expert plutôt que des valeurs improvisées. Les opérateurs qui veulent comprendre pourquoi un paramètre est comme il est, ou qui ont besoin de défendre un choix à un client, peuvent trouver le billet correspondant dans la série.

Les paramètres se regroupent en quatre grappes fonctionnelles :

### 1. Protection infonuagique et cycle de vie des signatures

Les paramètres les plus conséquents. La capacité de détection moderne de Defender dépend fortement de la protection livrée dans le nuage — la correspondance de patrons, l'analyse de comportement et l'intelligence sur les menaces se passent dans le nuage de Microsoft, pas sur l'appareil.

- **`allowcloudprotection`** — protection infonuagique activée.
- **`cloudblocklevel`** = **High Plus** (valeur 4). L'échelle de Microsoft va Default → Moderate → High → High Plus → Zero Tolerance. Le modèle saute le milieu et atterrit sur le paramètre deuxième-plus-agressif. Plus de blocages, plus de faux positifs, plus de confiance que les fichiers suspects sont arrêtés.
- **`cloudextendedtimeout`** = **50 secondes**. Defender attendra jusqu'à 50 secondes pour un verdict infonuagique sur un fichier suspect avant de tomber en arrière sur une décision locale-seulement. Le défaut Microsoft est 0 (ne pas attendre du tout). 50, c'est à l'extrémité haute de ce que Microsoft considère raisonnable — le modèle valorise une analyse plus profonde sur un verdict plus rapide.
- **`submitsamplesconsent`** = **Envoyer tous les échantillons automatiquement** (valeur 3). Quatre options existent : « Toujours demander » (0), « Envoyer les échantillons sûrs » (1, le baseline typique), « Ne jamais envoyer » (2), et « Envoyer tous les échantillons » (3). Le modèle choisit l'option la plus agressive. Ça veut dire que *n'importe quel* fichier suspect — incluant du contenu potentiellement sensible — peut être téléversé à Microsoft pour analyse. Vaut la peine de savoir pour les clients avec des exigences strictes de résidence de données ou de vie privée; certains voudront redescendre ça à 1.
- **`signatureupdateinterval`** = **1 heure**. Le défaut Microsoft est une fois par jour. Mettre ça à 1 heure veut dire que Defender tire les mises à jour de signatures 24× plus fréquemment. C'est agressif — ferme la fenêtre entre la disponibilité d'une nouvelle signature et l'appareil qui l'a à peu près le temps d'un seul cycle de synchronisation. A quelques implications de bande passante sur les réseaux lents mais la plupart des flottes ne le remarqueront pas.
- **`checkforsignaturesbeforerunningscan`** — exécute une mise à jour de signatures avant n'importe quelle analyse planifiée, s'assurant que l'analyse utilise les définitions les plus récentes.
- **`signatureoutofdate`** — pas dans ce modèle directement, mais la politique de conformité Windows (leçon 2) vérifie les signatures périmées, complétant la boucle.

### 2. Surveillance de comportement et couverture de protection

Paramètres qui s'assurent que Defender surveille vraiment les choses qui ont besoin d'être surveillées :

- **`allowbehaviormonitoring`** — détection basée sur le comportement activée (attrape les comportements malveillants même quand le fichier n'est pas reconnu).
- **`allowrealtimemonitoring`** — analyse en temps réel de l'activité des fichiers.
- **`realtimescandirection`** = **0** (surveiller tous les fichiers, à la fois entrants et sortants). Les autres options (1 = entrants seulement, 2 = sortants seulement) créeraient des angles morts; le modèle garde intentionnellement la couverture bidirectionnelle.
- **`allowioavprotection`** — protection IOAV (Internet/Outlook Attachment) activée. Analyse le contenu téléchargé par les chemins Internet Explorer / Edge / pièces jointes Outlook.
- **`allowarchivescanning`** — analyse à l'intérieur des .zip, .tar, .rar, etc.
- **`allowemailscanning`** — analyse les pièces jointes courriel au niveau du client de courriel local.
- **`allowscriptscanning`** — analyse l'exécution des scripts (PowerShell, JScript, VBScript).
- **`allowscanningnetworkfiles`** — analyse les fichiers accédés sur les partages réseau.
- **`allowfullscanonmappednetworkdrives`** = **DÉSACTIVÉ**. Les analyses complètes planifiées excluent explicitement les lecteurs réseau mappés. C'est un choix délibéré — l'analyse complète des lecteurs mappés peut prendre une éternité, peut marteler le serveur de fichiers, et tend à produire des détections fantômes sur les fichiers partagés. L'analyse en temps réel des fichiers réseau (via `allowscanningnetworkfiles` plus haut) s'applique encore; c'est seulement le grand balayage planifié qui les saute.
- **`allowfullscanremovabledrivescanning`** — les analyses planifiées incluent les lecteurs amovibles (clés USB, SSD externes).
- **`enablenetworkprotection`** — Network Protection (la fonctionnalité Defender qui bloque les connexions à des URL connues comme malveillantes, complémentant SmartScreen).
- **`puaprotection`** = activé en mode **block**. L'autre option (audit, valeur 2) journaliserait sans bloquer. Le modèle choisit block — attrape les graywares (bundleware, logiciels publicitaires, pirates de navigateur) et prévient l'installation plutôt que de juste la journaliser.

Le paramètre `enablenetworkprotection` vaut la peine d'être signalé spécifiquement — c'est la fonctionnalité Defender qui attrape les sites d'hameçonnage AiTM quand les données de réputation d'URL de SmartScreen les signalent. Le parcours d'AiTM à la leçon 3 de la carte 2 a mentionné ça comme une des mitigations secondaires. Le modèle l'active.

### 3. Planification des analyses et performance

Paramètres qui contrôlent *quand* et *à quel point agressivement* Defender consomme les ressources de l'appareil :

- **`schedulequickscantime`** = **600** (minutes depuis minuit) = **10 h 00**. Pas hors heures — délibérément en mi-matinée. Le raisonnement : les portables PME sont souvent éteints la nuit. Planifier une analyse à 2 h du matin veut dire que la plupart des appareils la manquent et doivent attendre la prochaine plage. 10 h frappe une fenêtre où la plupart des appareils sont allumés, connectés et sur des réseaux rapides. L'utilisateur remarque un petit pic CPU pendant l'analyse, mais l'alternative, ce sont des analyses qui ne roulent jamais.
- **`avgcpuloadfactor`** = **20** (pourcent). Defender utilisera jusqu'à 20 % de CPU pendant les analyses — conservateur, priorise la performance perçue par l'utilisateur sur la vitesse d'analyse. Le défaut Microsoft est 50 %. Le paramètre plus bas veut dire que les analyses prennent plus de temps mais ne font pas sentir l'appareil lent.
- **`enablelowcpupriority`** — les analyses Defender roulent à basse priorité de processus quand possible.
- **`scanparameter`** = **1** (analyse rapide, pas analyse complète). Les analyses complètes peuvent prendre des heures; les analyses rapides couvrent les chemins d'infection à haute probabilité en minutes.
- **`disablecatchupquickscan`** = **0** (les analyses rapides de rattrapage **sont** permises). Un appareil qui était éteint quand son analyse rapide planifiée était due la roulera à la prochaine occasion. Ne désactivez pas le rattrapage.
- **`disablecatchupfullscan`** = **0** (les analyses complètes de rattrapage **sont** permises). Même logique, pour les analyses complètes.
- **`randomizescheduletasktimes`** — randomise les heures de début d'analyse à travers la flotte pour éviter que tous les appareils analysent simultanément et fassent monter la charge d'infrastructure.

### 4. Durcissement du terminal et durcissement interne à Defender

Une poignée de paramètres qui protègent Defender lui-même contre les altérations :

- **`disablelocaladminmerge`** = **1** (la fusion admin local **désactivée**). Les administrateurs locaux ne peuvent pas surpasser la politique gérée centralement. Sans ça, un admin local pourrait désactiver la protection en temps réel sur l'appareil.
- **`allowdatagramprocessingonwinserver`** = **1** (activé). Traitement de datagrammes sur les installations Windows Server (un cas de bord de niche où Defender se comporte légèrement différemment sur les SKU serveur vs les SKU poste de travail).
- **`allowuseruiaccess`** = **1** (accès UI utilisateur **activé**). Les utilisateurs non admin peuvent voir l'interface Defender — voir les résultats d'analyse récents, voir ce qui a été bloqué, voir l'historique des menaces. C'est un choix *d'utilisabilité*, pas un choix de durcissement (verrouiller l'UI loin des utilisateurs serait plus restrictif). Le modèle valorise la transparence pour l'utilisateur final sur le fait de cacher Defender.

Le paramètre `disablelocaladminmerge` est le critique-sécurité de ce groupe. Sans lui, un utilisateur avec des droits admin local sur son appareil peut désactiver Defender entièrement — ce qui briserait silencieusement le signal de conformité (puisque la politique de conformité Windows exige Defender activé). Mettre ça à désactiver-la-fusion s'assure que la politique centrale gagne.

## Defender Settings macOS — ce qu'il configure

Le modèle macOS est dramatiquement plus simple que celui Windows — trois paramètres versus trente. Ça reflète la réalité que Defender for Endpoint sur macOS a une surface beaucoup plus petite que sur Windows, et la plupart de la configuration macOS de Defender se passe à l'étape d'installation/intégration plutôt que via la politique Intune.

Les trois paramètres :

- **`com.apple.managedclient.preferences_enabled`** — Defender activé sur macOS.
- **`com.apple.managedclient.preferences_enablerealtimeprotection`** — protection en temps réel activée.
- **`com.apple.managedclient.preferences_automaticsamplesubmission`** — soumission automatique d'échantillons à Microsoft pour analyse.

C'est tout. Le client Defender for Endpoint sur macOS est largement autoconfigurant une fois installé; ce modèle est surtout là pour s'assurer que les trois essentiels sont allumés.

Ce qui *n'est pas* dans le modèle macOS :

- Pas de paramètre de niveau de blocage infonuagique (Defender macOS utilise la protection infonuagique Microsoft par défaut et n'expose pas de bouton de niveau de blocage granulaire via MDM).
- Pas de planification d'analyse — le comportement d'analyse de Defender macOS est à l'accès, pas planifié.
- Pas de contrôles de type d'analyse spécifiques — le Defender macOS n'expose pas l'analyse d'archives, l'analyse de courriels, l'analyse de fichiers réseau comme boutons séparés.
- Pas de paramètres de protection contre les altérations explicitement — le sandboxing macOS gère beaucoup de ça au niveau de l'OS.

Si la posture macOS d'un client demande plus que ce que ces trois paramètres peuvent exprimer, la configuration se superpose à l'installation Defender for Endpoint (p. ex., via la configuration du paquet d'intégration) ou via des profils de configuration macOS séparés en dehors de la portée de ce modèle.

## L'appariement avec la politique de conformité

Les configurations Defender ne comptent que si la politique de conformité vérifie pour elles. La politique de conformité Windows de Panoptica365 (leçon 2) vérifie :

- `defenderEnabled: true` — Defender doit être activé. Le modèle Defender Settings l'assure.
- `rtpEnabled: true` — protection en temps réel activée. Le `allowrealtimemonitoring` du modèle Defender Settings le livre.
- `antivirusRequired: true` et `antiSpywareRequired: true` — moteurs antivirus et antilogiciel espion requis. Defender fournit les deux.
- `signatureOutOfDate: true` — signale les appareils avec des signatures périmées. L'intervalle de mise à jour de signature plus rapide du modèle Defender Settings réduit la fenêtre pour ça.
- `deviceThreatProtectionEnabled: true` au niveau « low » — Defender for Endpoint rapporte aucune menace à haute confiance. Le modèle Defender Settings ne configure pas ça directement (c'est un état, pas un paramètre), mais les configurations aident à réduire les chances que les appareils soient signalés.

Donc les deux modèles fonctionnent ensemble : le modèle de configuration rend l'appareil digne de conformité; la politique de conformité vérifie que l'appareil rencontre la barre.

La paire macOS est plus légère — la politique de conformité macOS de Panoptica365 n'inclut pas `deviceThreatProtectionEnabled` parce que Defender for Endpoint sur macOS n'est pas toujours installé dans les scénarios PME. Le modèle Defender Settings macOS, quand déployé, configure ce que Defender est là pour configurer, mais la présence de Defender n'est pas elle-même une exigence de conformité.

## Ce qui peut briser

Les configurations Defender sont surtout sûres mais valent la peine de connaître :

**Faux positifs de protection infonuagique.** Des niveaux de blocage infonuagique agressifs (plus hauts que le défaut) attrapent plus de menaces mais signalent aussi plus de fichiers légitimes comme suspects. Sources fréquentes de faux positifs : apps d'affaires sur mesure, anciennes versions d'outils communs, logiciels de niche. La solution, ce sont des *exclusions* — exclure des chemins ou fichiers spécifiques de l'analyse via le paramètre d'exclusions Defender (pas directement dans le modèle Panoptica365; configuré par client au besoin).

**Plaintes de performance sur les vieux appareils.** Analyse en temps réel + surveillance de comportement + analyse d'archives, c'est plus lourd que les défauts d'usine. Les appareils avec 4 Go de RAM et des disques durs mécaniques peuvent se sentir plus lents avec le modèle actif. Les paramètres `avgcpuloadfactor` et `enablelowcpupriority` aident, mais le problème sous-jacent, c'est du vieux matériel. La solution honnête, c'est la mise à niveau matérielle; le contournement, ce sont des exclusions.

**Network Protection qui bloque des URL légitimes.** Quand `enablenetworkprotection` est activé, occasionnellement une URL d'affaires légitime se fait attraper (faux positif dans l'intelligence sur les menaces de Microsoft). L'utilisateur voit un écran « ce site est bloqué ». La solution, c'est une liste d'autorisation personnalisée dans la liste d'autorisations d'URL de Defender, configurée via un ajustement séparé de Defender Settings par client.

**Analyse PowerShell + scripts légitimes.** `allowscriptscanning` attrape le PowerShell malveillant, mais attrape aussi certains scripts légitimes lourds (automatisation admin, gros scripts opérationnels TI). La performance peut se dégrader pour les utilisateurs qui exécutent ceux-ci. Les exclusions sont par client au besoin.

## Déploiement

Déploiement au groupe pilote du pré-déploiement de la leçon 1 :

1. **Jour 0** — déployer le modèle Windows à un groupe pilote de 3 à 5 appareils. Déployer le modèle macOS si le client a des Mac.
2. **Jours 1 à 7** — vérifier le déploiement dans le portail Intune (comptes de succès). Faire un échantillonnage sur les appareils pilotes — ouvrir l'interface Defender, confirmer que Cloud Protection montre activé, que les définitions de signatures sont à jour, que la protection en temps réel est activée.
3. **Jours 7 à 14** — observer le comportement des appareils pilotes. Surveillez les blocages faux positifs, les plaintes de performance, les échecs de mise à jour de signatures.
4. **Jour 14** — déploiement plus large si le pilote est propre.

Le modèle Defender est parmi les modèles les plus sûrs à déployer parce que Microsoft a des décennies d'expérience à ajuster Defender pour la compatibilité. La plupart des clients ne voient aucun changement de comportement visible pour l'utilisateur; le travail se passe dans les processus en arrière-plan de Defender.

## Quoi surveiller après l'application

**Defender activé / désactivé par appareil.** Devrait être 100 % activé sur la flotte Windows après déploiement. Les appareils qui montrent Defender désactivé sont des appareils où le modèle a échoué à s'appliquer ou où une altération admin locale l'a désactivé — enquêtez.

**Fraîcheur des signatures.** Les appareils qui rapportent des signatures périmées (plus de 24 heures) indiquent habituellement des problèmes de connectivité, un mécanisme de mise à jour de signatures brisé, ou — rarement — Defender lui-même a été désactivé par un autre produit. Surveillez ça dans l'état de conformité Intune pour l'appareil (signature-périmée est une des vérifications que la politique de conformité Windows de Panoptica365 effectue); un appareil qui bascule hors de conforme se reportera dans la tuile de compte de conformité global, mais l'âge de signature par appareil n'est pas une vue dédiée dans Panoptica365.

**Détections de menaces Defender.** Une pointe de détections corrèle souvent avec une vague d'hameçonnage qui frappe le client, ou avec un seul utilisateur qui clique à travers les blocages de Network Protection à répétition (suggérant qu'il est ciblé). Enquêtez sur le patron de source.

**Faux positifs rapportés par les utilisateurs.** Tracez chacun. Certains ont besoin d'exclusions; certains sont de vraies menaces que l'utilisateur a mal identifiées comme légitimes.

**Dérive sur le modèle.** Les paramètres Defender sont une cible de dérive fréquente. Un autre admin du client peut avoir ajusté le niveau de blocage infonuagique vers le bas, ou activé des fonctionnalités que le modèle n'active pas. Le détecteur de dérive de Panoptica365 signale ça.

## Ce que Panoptica365 voit

Deux choses réelles, et une longue liste de choses qu'il ne voit pas.

**Ce que Panoptica365 fait remonter :**

- **Les détections Defender XDR comme alertes.** Quand l'ingestion Defender XDR du client est configurée (leçon 4 de la carte 1), les incidents et alertes à haute gravité entrent dans le moteur d'alertes de Panoptica365, où ils sont remontés via le même tableau de bord et le pipeline de courriels que les autres alertes de sécurité. C'est le flux de détection par client — mais il vit dans la surface alertes, pas dans une vue par appareil.
- **Dérive sur le modèle Defender Settings.** Si le tenant d'un client dérive du modèle déployé — quelqu'un a ajusté le niveau de blocage infonuagique, activé des fonctionnalités que le modèle n'active pas, désactivé la protection contre les altérations — le détecteur de dérive se déclenche. Revenir, réappliquer, ou accepter, comme le reste du flux de dérive.

**Ce que Panoptica365 ne fait *pas* remonter** (au cas où le programme vous aurait fait l'attendre) :

- L'état Defender activé par appareil
- L'âge des signatures par appareil
- L'état de protection en temps réel par appareil
- N'importe quelle posture Defender par appareil

La visibilité par appareil de l'état Defender vit dans le portail Microsoft 365 Defender et la section appareil Intune. C'est la surface diagnostique aujourd'hui. Le rôle de Panoptica365, c'est les alertes (quand quelque chose de mauvais se passe) et la dérive (quand la configuration s'affaiblit) — pas le rapport de posture par appareil.

Le rôle de Defender XDR dans cette paire de modèles, c'est de faire remonter les *événements de détection* que la configuration permet à Defender de trouver. La leçon 4 de la carte 1 a couvert XDR; ici, le modèle Defender Settings est ce qui fait que les signaux XDR arrivent vraiment — sans configuration Defender appropriée, le flux de signal XDR est mince.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**La configuration Defender compte autant que la présence Defender.** Une installation Defender par défaut d'usine est significativement plus faible qu'une bien configurée. Le modèle Panoptica365, c'est la différence. Déployez-le sur chaque flotte Windows.

**La protection infonuagique est la grappe la plus conséquente.** Des 28 paramètres Windows, ceux de protection infonuagique (niveau de blocage High Plus, consentement envoyer-tous-les-échantillons, expiration infonuagique de 50 secondes, intervalle de signatures d'une heure) font bouger l'aiguille le plus. Ils sont aussi les plus agressifs du modèle — si vous personnalisez pour un client réglementé ou un avec des préoccupations de résidence de données, le paramètre de soumission d'échantillons (actuellement « Envoyer tous les échantillons ») est le premier à considérer redescendre à « Envoyer les échantillons sûrs ».

**La protection contre les altérations compte opérationnellement.** `disablelocaladminmerge` empêche un utilisateur avec admin local de désactiver Defender. Sans ça, le signal de conformité est fragile — un utilisateur peut briser sa propre conformité en désactivant Defender, et la politique centrale ne peut pas le surpasser.

## Ce qui suit

- **Leçon 6 : Firewall Settings (Windows).** Configuration du pare-feu hôte — l'autre moitié de la défense réseau du terminal Windows.
- **Leçon 7 : Règles ASR + Block mshta.exe.** Règles de réduction de surface d'attaque — les fonctionnalités préemptives de blocage de comportement de Defender.

Pour l'instant : Defender Settings est la configuration qui fait que Defender défend vraiment. Déployez sur chaque flotte Windows; déployez le pendant macOS où applicable; appariez les deux avec la politique de conformité correspondante.

---

*Sources des données dans cette leçon — la plupart des valeurs Defender Settings Windows de Panoptica365 suivent la série MDE de Jeffrey Appel ([jeffreyappel.nl/tag/mde-series](https://jeffreyappel.nl/tag/mde-series/)), la référence pratique de durcissement M365 sur laquelle le modèle est construit. Microsoft Learn sur la configuration de Defender Antivirus via Intune ([Microsoft Learn — Configure Defender Antivirus](https://learn.microsoft.com/en-us/defender-endpoint/microsoft-defender-antivirus-windows)); protection livrée dans le nuage et niveaux de blocage infonuagique ([Microsoft Learn — Cloud-delivered protection](https://learn.microsoft.com/en-us/defender-endpoint/cloud-protection-microsoft-defender-antivirus)); Network Protection ([Microsoft Learn — Network protection](https://learn.microsoft.com/en-us/defender-endpoint/network-protection)); Defender for Endpoint sur macOS ([Microsoft Learn — Defender for Endpoint on macOS](https://learn.microsoft.com/en-us/defender-endpoint/microsoft-defender-endpoint-mac)).*
