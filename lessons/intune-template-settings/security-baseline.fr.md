---
title: "Le Security Baseline — votre ensemble curé de durcissement Windows"
subtitle: "98 paramètres de durcissement Windows soigneusement sélectionnés dans un seul profil — la posture opiniâtre d'un MSP expérimenté, pas la baseline officielle Microsoft."
icon: "shield-check"
last_updated: 2026-05-29
---

# Le Security Baseline — votre ensemble curé de durcissement Windows

Le modèle Security Baseline de Panoptica365, c'est le plus gros artéfact unique dans la bibliothèque Intune — environ 98 paramètres individuels emballés dans un seul profil de configuration. Ce n'est pas le Windows Security Baseline officiel de Microsoft. Cette distinction compte et on y reviendra. Ce que c'est plutôt, c'est un ensemble curé de paramètres de durcissement Windows ramassés au fil des années depuis les pages Microsoft Learn, les blogs de MVP, les analyses de chercheurs en sécurité et les leçons de durcissement apprises dans le vrai monde à travers des déploiements clients. Pensez-y comme « la posture de durcissement Windows qu'un MSP expérimenté recommanderait si vous lui demandiez de choisir les paramètres qui comptent et de sauter ceux qui ne comptent pas ».

Cette leçon parcourt ce qui est dedans, comment y penser quand vous le déployez, et comment en parler avec les clients qui demandent « est-ce que c'est le Microsoft Security Baseline? »

## Ce que c'est, simplement

Le modèle :

- S'applique aux appareils **Windows 10 / Windows 11** uniquement (`platforms: windows10`).
- Utilise le type de modèle **catalogue de paramètres** (`configurationPolicies`), ce qui veut dire qu'il vit dans la section catalogue de paramètres du portail Intune, pas dans la section des modèles hérités.
- Configure **environ 98 paramètres distincts**, organisés à travers à peu près 20 catégories de paramètres.
- Touche des politiques à la fois **portée-appareil** et **portée-utilisateur** — c'est-à-dire qu'il configure certaines choses au niveau de la machine et certaines au niveau par utilisateur (p. ex., les restrictions AutoPlay s'appliquent par utilisateur; les options de sécurité s'appliquent à l'appareil).

Les paramètres couvrent : politiques de sécurité locale, comportement de compte, verrouillage d'appareil, AutoPlay, comportement Wi-Fi, PowerShell, services Remote Desktop, gestion à distance, défense contre les menaces web (intégration SmartScreen), restrictions Chrome Remote Desktop, paramètres MS Security Guide, options d'alimentation, paramètres GPO migrés vers AdmX, et configurations Microsoft Edge.

Ce que ce modèle *ne configure pas* :

- BitLocker (modèle séparé — leçon 4).
- Paramètres Microsoft Defender Antivirus (modèle séparé — leçon 5).
- Windows Defender Firewall (modèle séparé — leçon 6).
- Règles ASR (modèle séparé — leçon 7).
- Windows Hello / Credential Guard (modèle séparé — leçon 8).
- Windows Update for Business (pas dans la bibliothèque — géré par l'outil RMM du MSP).

Le Security Baseline complète ces autres modèles plutôt que de chevaucher avec eux. Quand un paramètre pourrait plausiblement vivre soit dans le Security Baseline soit dans un modèle dédié (p. ex., certaines options adjacentes à Defender), la bibliothèque Panoptica365 le met dans le modèle dédié — gardant le Security Baseline comme l'ensemble de durcissement « tout le reste ».

## Ce n'est pas le Windows Security Baseline officiel de Microsoft

Ça doit être encadré explicitement parce que le nom du modèle invite à la confusion. Microsoft livre ses propres **Windows Security Baselines** — des paquets de paramètres formels, documentés, avec des opinions, que Microsoft met à jour avec chaque version majeure de Windows. Ils sont publiés dans le portail Intune sous Endpoint Security → Security baselines. Quand vous créez un de ceux-là, Microsoft applique son propre ensemble curé de paramètres.

Le **modèle Security Baseline de Panoptica365** n'est *pas* un de ceux-là. C'est un artéfact séparé, curé par le MSP, qui :

- A été assemblé à la main basé sur des conseils de MVP, des articles MS Learn, des billets de blog sécurité et l'expérience du vrai monde.
- Se met à jour selon le calendrier du MSP, pas celui de Microsoft.
- Peut ou non s'aligner avec le baseline officiel Microsoft pour n'importe quel paramètre donné.
- Vit comme un modèle de catalogue de paramètres, pas comme un baseline livré par Microsoft.

Quand le RSSI d'un client demande « est-ce aligné avec le Windows Security Baseline de Microsoft? », la réponse honnête, c'est : *pas directement. C'est un baseline curé par le MSP éclairé par les conseils de Microsoft mais maintenu séparément. L'intention est la même — durcir Windows — mais les paramètres spécifiques sont choisis pour l'opérabilité PME plutôt que pour la conformité d'entreprise.*

Les baselines Microsoft visent les grandes entreprises avec des équipes de sécurité dédiées. Ils sont parfois trop restrictifs pour les scénarios PME — ils supposent une infrastructure d'authentification spécifique, une cadence de correctifs spécifique, une maturité de gestion de terminal spécifique. Le Security Baseline de Panoptica365 est calibré pour le contexte PME : assez agressif pour vraiment améliorer la posture, assez souple pour ne pas briser les flux PME communs.

Si un client a spécifiquement besoin du Windows Security Baseline officiel de Microsoft pour des raisons de conformité (p. ex., un contrat qui le nomme explicitement), il devrait déployer celui-là *aux côtés* de ce modèle. Les deux peuvent coexister — le baseline Microsoft a préséance là où les paramètres entrent en conflit, et beaucoup de paramètres n'entreront pas en conflit du tout.

## Ce qui est vraiment dedans — les grandes catégories

Les 98 paramètres se regroupent dans environ 20 catégories. Les plus grosses :

**Politiques locales / Options de sécurité (11 paramètres).** Durcissement de la politique de sécurité locale Windows — les choses que vous configureriez dans `secpol.msc` sur une machine jointe à un domaine, ici livré via MDM. Exemples : sécurité de session NTLM minimum, comportement de retrait de carte à puce, restriction d'énumération anonyme des SID système, protection LSA.

**Configuration Microsoft Edge (18 paramètres — 10 appareil + 8 utilisateur).** Durcissement du navigateur Edge : isolation de site, comportement du gestionnaire de mots de passe, restrictions de saisie automatique, intégration SmartScreen, protection de téléchargement, comportement des onglets en sommeil, restrictions de création de profil.

**Verrouillage d'appareil (6 paramètres).** Politique d'écran de verrouillage : temps avant verrouillage, comportement de l'écran de verrouillage, désactivation du mot de passe par image, verrouillage forcé à l'inactivité.

**Chrome Remote Desktop / Chrome Remote Access (8 paramètres — 4 appareil + 4 utilisateur).** Restreint spécifiquement Chrome Remote Desktop de Google et les fonctionnalités d'accès à distance Chrome liées. C'est un mouvement de durcissement délibéré — Chrome Remote Desktop est un vecteur d'accès à distance d'apparence légitime que les attaquants abusent, et la plupart des environnements PME n'ont pas de raison d'affaires que les utilisateurs l'exécutent. Vaut la peine de savoir que c'est ici; les TI de certains clients l'utilisent légitimement et auront besoin d'une exception.

**MS Security Guide (4 paramètres).** Les anciennes recommandations GPO « Security Guide » de Microsoft — celles de l'époque SCM (Security Compliance Manager), encore pertinentes. Des choses comme le durcissement SMB, la préparation AppLocker, l'authentification en mode noyau.

**AdmX (10 paramètres — 6 utilisateur + 4 appareil).** Paramètres migrés depuis les modèles ADMX traditionnels de stratégie de groupe, livrés via le support ADMX d'Intune. Surtout l'application des économiseurs d'écran, le comportement de l'écran de verrouillage et d'autres durcissements dérivés de GPO.

**AutoPlay (4 paramètres).** Désactive AutoPlay/AutoRun pour tous les médias. Ferme un vecteur classique de livraison de maliciel — clé USB avec charge utile d'autorun.

**Web Threat Defense (3 paramètres).** Contrôles adjacents à SmartScreen — vérifier les fichiers téléchargés contre l'intelligence sur les menaces, bloquer les sites d'hameçonnage dangereux, contrôler les prompts SmartScreen.

**MSS Legacy (2 paramètres).** Ancien durcissement « Microsoft Solutions for Security » — restriction de routage IP, contrôles de libération de nom NetBIOS. Pertinent pour les anciennes pratiques de durcissement Windows.

**Alimentation (2 paramètres).** Durcissement de la gestion de l'alimentation — typiquement bloquer la veille sur alimentation CA pour les postes de travail, bloquer le wake-on-LAN sauf si explicitement nécessaire.

**Services Remote Desktop / Gestion à distance (4 paramètres).** Durcissement RDP — restreindre les connexions à distance, activer NLA (Network Level Authentication) si pas déjà appliqué, désactiver certains comportements RPC hérités.

**Wi-Fi (2 paramètres).** Bloquer la connexion automatique aux réseaux ouverts, restreindre le partage de profil Wi-Fi.

**Windows PowerShell (2 paramètres).** Journalisation de blocs de script PowerShell et journalisation de modules — active la journalisation détaillée utilisée pour la réponse aux incidents. Ne restreint pas PowerShell lui-même; le rend juste vérifiable.

**Connectivité (2 paramètres).** Restrictions de partage de connexion Internet, restrictions de pont réseau.

Il y a plus de paramètres individuels au-delà de ces catégories, mais ce qui précède couvre la majeure partie du volume.

## Les choix opinés à connaître

Trois paramètres dans ce baseline qui valent la peine d'être connus parce qu'ils affectent les flux clients réels :

**Chrome Remote Desktop est bloqué.** Ça surprend certaines équipes TI. Chrome Remote Desktop est légitimement utile pour certains scénarios d'accès à distance et est largement utilisé par de petites compagnies qui ne paient pas pour un vrai outil RMM. Le bloquer via ce baseline veut dire que ces flux cessent de fonctionner. Si le client a un vrai cas d'usage Chrome Remote Desktop, il a besoin d'une exception. (L'alternative — laisser Chrome Remote Desktop sans restriction — ouvre un vecteur d'attaque qui contourne la télémétrie RMM du MSP.)

**La connexion automatique Wi-Fi aux réseaux ouverts est bloquée.** Durcissement standard. Certains utilisateurs seront agacés par ça dans les cafés. Documentez-le dans la communication d'accueil pour que ce ne soit pas une surprise.

**La journalisation de blocs de script PowerShell est activée.** C'est de la journalisation, pas de la restriction — mais ça veut dire que *chaque commande PowerShell exécutée sur l'appareil se fait journaliser dans le journal d'événements Windows*. C'est une implication de vie privée pour les utilisateurs avancés qui préféreraient peut-être que leur historique PowerShell ne soit pas enregistré. C'est le bon choix pour la sécurité; ça vaut la peine de le savoir pour pouvoir répondre à la question si on vous la pose.

Les 90+ autres paramètres sont surtout invisibles aux utilisateurs en fonctionnement normal. Ils durcissent des choses avec lesquelles l'utilisateur ne devrait pas interagir directement (politique système, comportement réseau, défauts internes du navigateur).

## Déploiement

Le Security Baseline est le déploiement à plus haut impact par modèle de la bibliothèque parce qu'il touche tellement de comportements Windows séparés. Faites le déploiement au groupe pilote de la leçon 1 avec plus de soin que pour les modèles plus petits.

1. **Jour 0** — déployer à un groupe pilote de 3 à 5 appareils de test connus-bons (appareils de l'équipe TI, un utilisateur avancé volontaire, peut-être un appareil de la population générale).
2. **Jours 1 à 7** — vérifier que le déploiement a réussi (le portail Intune montre les comptes de succès), et *utiliser* les appareils pilotes pour le travail normal. Cherchez :
   - N'importe quoi qui a brisé. Des apps d'affaires spécifiques qui ne fonctionnent plus, des comportements Edge qui ont changé de façon visible pour l'utilisateur, des outils d'accès à distance qui ont arrêté de fonctionner (Chrome Remote Desktop est la prise classique).
   - Des scripts PowerShell qui font légitimement des choses inhabituelles — la journalisation en mode bloc ne devrait pas les briser, mais si un script légitime fait quelque chose que le baseline bloque, vous verrez des erreurs.
   - Plaintes d'utilisateurs avancés. Les utilisateurs avancés remarquent les déploiements de baseline en premier.
3. **Jours 7 à 14** — étendre à un pilote plus large si le premier tour était propre. Un département complet ou un sous-ensemble des utilisateurs du client.
4. **Jour 14 à 21** — déploiement complet si le pilote plus large est propre.

La fenêtre de déploiement totale est de 2 à 3 semaines, plus longue que la plupart des modèles parce que la surface est si large. Essayer de presser ce modèle, c'est comme ça qu'un MSP finit avec un appel de support « le Security Baseline a brisé le [truc] de tout le monde » un vendredi soir.

## Quoi surveiller après l'application

**Taux de succès de déploiement.** Le portail Intune montre le succès/échec par appareil pour le Security Baseline. Sain, c'est 98 %+ de succès. Les appareils qui montrent des échecs ont besoin d'une enquête — habituellement un conflit avec une autre politique, une version Windows non standard, ou un appareil qui a été hors ligne trop longtemps.

**Paramètres rapportés comme non appliqués.** Même sur les appareils qui montrent un succès global, des paramètres individuels peuvent échouer à s'appliquer (incompatibilité avec un logiciel installé, clés de registre verrouillées, etc.). Faire un échantillonnage sur les appareils pilotes pour confirmer que des paramètres spécifiques sont réellement en effet.

**Plaintes d'utilisateurs dans les 30 premiers jours.** C'est quand les cas Chrome Remote Desktop et connexion-auto-Wi-Fi font surface. Documentez chacun. Décidez par cas : exception via exclusion, ou changement de flux pour le client.

**Dérive sur le modèle lui-même.** Le détecteur de dérive de Panoptica365 s'applique ici. Si le modèle déployé diverge du Security Baseline inclus, c'est une dérive à enquêter. Une cause fréquente : un autre admin du client a ajusté un paramètre spécifique qui brisait pour eux, et la divergence ne s'est pas propagée à votre référence.

## Quand personnaliser

Le Security Baseline est le modèle le plus susceptible d'avoir besoin de personnalisation par client. Raisons fréquentes :

- Le cadre réglementaire du client exige des paramètres spécifiques que le baseline n'inclut pas ou met différemment.
- L'application d'affaires du client exige un comportement bloqué par le baseline (un déploiement Chrome Remote Desktop personnalisé, un patron PowerShell spécifique).
- Le client est sur une variante Windows (Server, LTSC) où certains paramètres baseline ne s'appliquent pas.
- La maturité TI du client a grandi — ils veulent des paramètres plus stricts que ce que le baseline accordé PME fournit.

Le bon flux de personnalisation est à la leçon 10 : exporter le baseline depuis un tenant où vous avez fait la personnalisation, généraliser les références, importer comme nouveau modèle, déployer à travers les clients applicables. Ne modifiez pas le modèle inclus directement — ça éloigne votre référence du baseline Panoptica365 livré et rend les futures mises à jour brouillonnes.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**Le Security Baseline est le plus gros déploiement unique de la carte 4. Traitez-le en conséquence.** Fenêtre de déploiement de deux à trois semaines, discipline de groupe pilote, surveillance pendant 30 jours. Ne le déployez pas en lot à tous les clients en une session.

**Soyez explicite avec les clients que c'est curé par le MSP, pas officiel Microsoft.** Quand la question monte (et elle montera), la bonne réponse, c'est « c'est notre baseline de durcissement éclairé par les conseils Microsoft, pas le baseline officiel Microsoft. Ils peuvent coexister si vous avez besoin des deux. » Documentez ça dans le matériel d'accueil du client.

**Connaissez les trois choix opinés qui affectent les utilisateurs.** Chrome Remote Desktop bloqué, connexion auto Wi-Fi bloquée, journalisation PowerShell activée. Ceux-là feront surface comme questions; ayez les réponses prêtes. Les 90+ autres paramètres produisent rarement des effets visibles pour l'utilisateur.

## Ce qui suit

- **Leçon 4 : BitLocker Settings.** Chiffrement de disque — le modèle de configuration qui livre ce que la politique de conformité Windows n'exige pas mais que la posture de durcissement demande.
- **Leçon 5 : Defender for Endpoint (Win + Mac).** La configuration antivirus / EDR livrée séparément du Security Baseline.

Pour l'instant : le Security Baseline est la fondation du durcissement côté Windows dans la bibliothèque Panoptica365. Déployez-le soigneusement; surveillez-le pour le premier mois; personnalisez par client quand leur réalité diverge des défauts PME.

---

*Sources des données dans cette leçon — Microsoft Learn sur les Windows Security Baselines (les officiels) ([Microsoft Learn — Windows security baselines](https://learn.microsoft.com/en-us/windows/security/operating-system-security/device-management/windows-security-configuration-framework/windows-security-baselines)); référence du catalogue de paramètres ([Microsoft Learn — Settings catalog](https://learn.microsoft.com/en-us/mem/intune/configuration/settings-catalog)); configuration Microsoft Edge via Intune ([Microsoft Learn — Configure Edge via Intune](https://learn.microsoft.com/en-us/deployedge/configure-edge-with-intune)); livraison de politiques basées sur ADMX ([Microsoft Learn — ADMX-backed policies](https://learn.microsoft.com/en-us/mem/intune/configuration/administrative-templates-windows)).*
