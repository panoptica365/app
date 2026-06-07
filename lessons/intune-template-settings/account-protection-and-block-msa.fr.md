---
title: "Account Protection + Block Microsoft Consumer Accounts — durcissement des identifiants sur le terminal"
subtitle: "Windows Hello for Business, Credential Guard et blocage des comptes Microsoft personnels — rendre les identifiants plus difficiles à voler si l'appareil est compromis."
icon: "user-lock"
last_updated: 2026-05-29
---

# Account Protection + Block Microsoft Consumer Accounts — durcissement des identifiants sur le terminal

La plupart des menaces d'identité de la carte 2 se terminent au moment où l'attaquant a les identifiants. L'hameçonnage AiTM capture le cookie de session; le credential stuffing réussit avec un mot de passe réutilisé; l'hameçonnage par consentement OAuth amène l'utilisateur à accorder l'accès. La défense dans chaque cas a été *ne laissez pas l'attaquant obtenir l'identifiant* (MFA résistant à l'hameçonnage), *ne laissez pas l'identifiant se faire voler* (passkeys, auth basée sur les certificats), ou *ne laissez pas un identifiant volé être utile* (Token Protection, accès conditionnel).

Il y a une défense complémentaire qui vit sur le terminal lui-même : rendre les identifiants *plus difficiles à voler en premier lieu* si l'appareil est compromis. C'est ce que les deux modèles de cette leçon font.

Le modèle Account Protection Settings configure Windows Hello for Business (authentification biométrique de style passkey ou par NIP attachée au TPM de l'appareil) et Credential Guard (une couche d'isolation basée sur la virtualisation qui protège les identifiants en mémoire de l'extraction par les maliciels).

Le modèle Block Microsoft Consumer Accounts empêche les utilisateurs d'ajouter des comptes Microsoft personnels (le genre Outlook.com / Hotmail / Live.com grand public) aux appareils Windows corporatifs, ce qui ferme une porte dérobée où un utilisateur pourrait accidentellement — ou délibérément — connecter son appareil à une identité infonuagique personnelle en parallèle de la corporative.

Cette leçon couvre les deux.

## Account Protection Settings — ce qu'il configure

Le modèle utilise l'ancien type de modèle **Intents** (`policyType: intents`) avec l'ID de modèle Microsoft endpoint-security `0f2b5d70-d4e9-4156-8c16-1397eb6c54a5`. Cet ID de modèle correspond à la famille de politique Account Protection d'endpoint-security de Microsoft.

Les paramètres (environ 15 d'entre eux) se regroupent en trois zones :

### Windows Hello for Business — politique de NIP

Windows Hello for Business (WHfB), c'est le mécanisme d'authentification sans mot de passe de Microsoft sur Windows. Plutôt que de taper un mot de passe pour se connecter, l'utilisateur s'authentifie via NIP (soutenu par le TPM), biométrie (visage ou empreinte, soutenue par le matériel Windows Hello), ou une clé de sécurité. L'identifiant est stocké cryptographiquement sur le TPM de l'appareil, donc il ne peut pas être extrait par des maliciels qui lisent la mémoire.

Les paramètres de politique de NIP :

- **Longueur minimum du NIP : 6** (le choix du modèle — le minimum par défaut de Microsoft est 4; plus long est plus fort mais plus friction).
- **Longueur maximum du NIP : 127** (effectivement illimité).
- **Compte de blocage des NIP précédents : 24** — ne peut pas réutiliser les 24 derniers NIP.
- **Expiration du NIP en jours : 0** — pas d'expiration de NIP. C'est le paramètre moderne recommandé; la rotation forcée de NIP crée de pires résultats (les utilisateurs choisissent des NIP plus faibles dont ils peuvent se souvenir).
- **Caractères majuscules / minuscules / spéciaux du NIP : notConfigured** — pas d'exigences de caractères au-delà de la longueur minimum. Les NIP sont locaux à l'appareil et soutenus par TPM; la complexité compte moins que la longueur.
- **Récupération du NIP activée : true** — les utilisateurs peuvent récupérer un NIP perdu via la méthode de récupération configurée.

### Comportement de déverrouillage Windows Hello

- **Déverrouillage avec biométrie : true** — déverrouillage par visage ou empreinte permis aux côtés du NIP.
- **Anti-usurpation amélioré : true** — le déverrouillage biométrique utilise la détection anti-usurpation (empêche de tromper la reconnaissance faciale avec une photo).
- **Utiliser une clé de sécurité pour la connexion : false** — les clés de sécurité FIDO2 pour la connexion ne sont pas le défaut. C'est configuré comme ça parce que tous les clients n'ont pas émis de clés FIDO2; les tenants qui l'ont fait peuvent surpasser ça par tenant.
- **Utiliser les certificats pour l'auth sur place : false** — auth sur place basée sur les certificats pas le défaut pour ce modèle.
- **Windows Hello for Business requis : false** — WHfB est *disponible* mais pas *requis*. Les utilisateurs peuvent encore se connecter avec un mot de passe s'ils préfèrent. La combinaison de l'infrastructure WHfB présente et de l'utilisateur qui la choisit, c'est le chemin d'adoption typique.
- **Appareil de sécurité requis : false** — TPM pas requis pour WHfB. (En pratique, presque chaque appareil Windows a un TPM; ce paramètre est permissif.)

### Credential Guard

- **Device Guard / Credential Guard : enableWithoutUEFILock** — Credential Guard est activé, mais le verrou UEFI qui empêcherait de désactiver Credential Guard depuis l'extérieur de l'OS n'est pas appliqué.

Credential Guard est la fonctionnalité de sécurité qui compte le plus dans ce modèle. Il utilise la virtualisation Windows (isolation Hyper-V) pour isoler le processus LSASS — la partie de Windows qui stocke les identifiants hachés en mémoire. Avec Credential Guard actif, les maliciels qui roulent sur l'appareil (même avec des privilèges élevés) ne peuvent pas extraire les identifiants depuis la mémoire LSASS — les identifiants sont dans un contenant matériellement isolé que le reste de l'OS ne peut pas atteindre.

C'est la défense contre des outils comme Mimikatz, qui vident la mémoire LSASS pour extraire les hachages NTLM et les tickets Kerberos qui peuvent être rejoués pour attaquer d'autres systèmes. La règle ASR « Bloquer le vol d'identifiants depuis LSASS » (leçon 7) attrape Mimikatz au niveau du comportement; Credential Guard empêche l'attaque sous-jacente de réussir même si la détection comportementale était contournée.

Le choix « activer sans verrou UEFI » échange une petite quantité de sécurité contre une grande quantité de flexibilité opérationnelle. Le verrou UEFI rendrait Credential Guard impossible à désactiver sans reflasher physiquement le firmware de l'appareil. C'est le paramètre de sécurité maximum mais il est fragile — si un problème se développe (compatibilité de pilote, besoin de dépannage), l'opérateur ne peut pas l'annuler via Intune. La variante sans verrou UEFI donne aux MSP la capacité de désactiver Credential Guard via politique quand nécessaire, au coût de permettre le même chemin de désactivation à un attaquant sophistiqué qui a déjà compromis l'appareil.

## Block Microsoft Consumer Accounts — ce qu'il configure

Le modèle utilise le type de modèle moderne catalogue de paramètres. Son travail est étroit et délibéré : empêcher les utilisateurs d'ajouter des comptes Microsoft personnels (Outlook.com / Hotmail / Live.com / Xbox / OneDrive personnel) à un appareil Windows corporatif, tout en laissant l'authentification de compte travail/école via le Web Account Manager (WAM) — le mécanisme que les apps Microsoft 365 utilisent pour se connecter — complètement intacte.

La distinction compte parce que la politique « bloquer les comptes Microsoft » dans Windows est un seul CSP qui peut être configuré de plusieurs façons, et la mauvaise valeur bloque trop. WAM utilise des flux d'authentification de style compte Microsoft pour les comptes travail/école en dessous, donc un paramètre lourd qui bloque tout l'auth de saveur MSA brisera aussi les connexions Outlook, Teams et autres apps Office. Le modèle est accordé pour ne bloquer que l'ajout MSA personnel, laissant le chemin d'authentification travail/école ouvert.

La configuration réelle du modèle :

- **Autoriser les comptes Microsoft :** configuré pour bloquer l'ajout MSA personnel tout en permettant l'authentification de compte travail/école via WAM.
- Quelques paramètres Account Manager liés accordés de façon cohérente avec cette intention.

L'intention : un appareil corporatif géré devrait se connecter à des identités corporatives seulement. Les utilisateurs ne devraient pas ajouter leur compte Outlook.com personnel, leur OneDrive personnel, leur MSA lié au jeu à l'appareil. Les raisons :

- **Risque de fuite de données.** Un MSA personnel configuré sur un appareil corporatif peut synchroniser des dossiers OneDrive personnels qui contiennent des documents corporatifs. Les données corporatives sont maintenant dans le nuage personnel, en dehors du contrôle du MSP.
- **Confusion d'identité.** Les utilisateurs avec des MSA à la fois corporatifs et personnels sur le même appareil s'authentifient fréquemment à la mauvaise identité, causant des billets de support et occasionnellement exposant les données corporatives au stockage infonuagique personnel.
- **Exposition à l'hameçonnage.** Un courriel d'hameçonnage ciblant le MSA personnel de l'utilisateur, ouvert sur l'appareil corporatif, peut résulter en une compromission qui affecte l'appareil corporatif même si l'identité ciblée est personnelle.
- **Conformité.** Plusieurs cadres réglementaires (incluant certaines interprétations du RGPD et CCPA) traitent le mélange de données corporatives et personnelles sur le même appareil comme un enjeu de conformité.

L'encadrement honnête : bloquer l'ajout MSA personnel est une amélioration de sécurité significative avec un impact utilisateur minimal. Les utilisateurs qui veulent légitimement leurs comptes personnels disponibles font ça sur leurs appareils personnels. Les appareils corporatifs sont corporatifs.

## Ce qui peut briser

Ces modèles sont généralement plus sûrs que les modèles ASR Rules et Firewall, mais ils ont des pièges spécifiques :

**L'adoption de Windows Hello for Business demande de l'infrastructure.** Déployer le modèle Account Protection sans l'infrastructure WHfB (la configuration de confiance Kerberos infonuagique, la configuration d'autorité de certification pour les scénarios hybrides sur place, le flux d'inscription d'appareil) veut dire que les utilisateurs ne peuvent pas vraiment utiliser WHfB. Ils se connecteront avec des mots de passe comme ils l'ont toujours fait, et les paramètres WHfB resteront inutilisés. C'est bénin mais veut dire que l'avantage de sécurité ne se réalise pas. L'adoption WHfB est habituellement un projet séparé du déploiement de ce modèle.

**Incompatibilité Credential Guard.** Un petit nombre d'apps légitimes ne fonctionnent pas avec Credential Guard actif. Coupables fréquents : vieux clients VPN, certains produits anti-maliciel qui s'accrochent à LSASS, certains outils d'authentification basés sur les certificats. La solution habituelle, c'est de mettre à jour le logiciel affecté; le contournement, c'est de désactiver Credential Guard pour l'utilisateur/appareil spécifique via une exclusion.

**Modèle Block MSA qui brise des MSA précédemment configurés.** Les utilisateurs qui avaient des MSA personnels configurés avant que le modèle soit déployé peuvent voir leurs comptes personnels retirés ou devenir incapables de se rafraîchir. Communiquez ça au client à l'avance — les utilisateurs avec des patrons légitimes de compte personnel sur appareil corporatif devront ajuster leurs flux.

**Friction de réinitialisation de NIP WHfB.** Les utilisateurs qui oublient leur NIP ont besoin d'un chemin de réinitialisation. Si le client n'a pas configuré l'infrastructure de récupération de NIP (le stockage de clé de récupération, l'UI de réinitialisation face à l'utilisateur), les utilisateurs se font verrouiller dehors. Vérifiez que le chemin de récupération fonctionne avant de déployer.

## Déploiement

Déploiement au groupe pilote pour les deux modèles :

1. **Jour 0** — déployer Account Protection et Block MSA à 3 à 5 appareils pilotes. Caractéristique critique de l'appareil pilote : au moins un appareil avec MSA personnel déjà configuré (pour tester le comportement Block MSA sur l'état existant) et au moins un appareil où l'utilisateur est susceptible d'essayer WHfB (pour vérifier que l'infrastructure fonctionne).
2. **Jours 1 à 7** — vérifier le succès du déploiement dans Intune. Faire un échantillonnage sur les appareils pilotes. Confirmer que Credential Guard apparaît actif dans `msinfo32.exe` (cherchez « Credential Guard » dans le résumé système — devrait montrer « Configuré » et « En cours d'exécution »). Confirmer l'effet de Block MSA — essayer d'ajouter un MSA personnel sur un appareil pilote; devrait échouer avec une erreur appropriée.
3. **Jours 7 à 14** — observer l'usage de l'appareil pilote. Surveiller les problèmes VPN (compatibilité Credential Guard), les problèmes d'authentification avec des logiciels de niche, les plaintes d'utilisateurs sur Block MSA.
4. **Jour 14** — déploiement plus large si le pilote est propre.

Pour le modèle Block MSA spécifiquement, communiquez aux utilisateurs du client *avant* le déploiement. Les utilisateurs avec des MSA personnels sur leurs appareils corporatifs doivent savoir ce qui est sur le point de changer.

## Quoi surveiller après l'application

**Credential Guard actif par appareil.** Devrait être 100 % actif sur les appareils Windows 10/11 après le déploiement. Les appareils qui montrent « Configuré mais pas en cours d'exécution » indiquent des problèmes de compatibilité matérielle (rare; habituellement du matériel de virtualisation plus vieux) ou un conflit avec un autre produit.

**Taux d'inscription WHfB.** Trace combien d'utilisateurs ont vraiment adopté WHfB. Le modèle rend WHfB *disponible*; l'adoption par les utilisateurs est volontaire. Une basse adoption est normale dans les premières semaines; devrait grimper sur des mois à mesure que les utilisateurs découvrent la commodité.

**Échecs d'authentification après le déploiement.** Surveiller une pointe de billets de service d'aide liés à l'authentification. Pourrait être l'incompatibilité VPN (Credential Guard), la confusion Block MSA (les utilisateurs qui essaient de se connecter avec MSA personnel), ou des problèmes de réinitialisation de NIP.

**Événements d'accès mémoire LSASS** (depuis l'ingestion Defender XDR, quand configurée selon la leçon 4 de la carte 1). Avec Credential Guard actif, le volume d'événements de tentatives d'accès à la mémoire LSASS qui se font bloquer devrait être près de zéro en fonctionnement normal. N'importe quel volume non-zéro est intéressant — soit Credential Guard fait son travail contre du maliciel actif, soit un processus légitime fait quelque chose qui déclenche la protection.

**Dérive sur l'un ou l'autre modèle.** Les deux modèles peuvent dériver — un admin qui désactive Credential Guard pour un appareil spécifique qui avait des problèmes de compatibilité, un admin qui assouplit Block MSA à la demande d'un client, etc.

## Ce que Panoptica365 voit

Honnêtement : pas grand-chose spécifiquement à propos d'Account Protection. Le tableau de bord n'a pas d'état Credential Guard par appareil, de statut d'inscription WHfB par utilisateur, ou de matrice de déploiement Block MSA. Aucune de ces choses n'existe dans le produit aujourd'hui, et le par-appareil quoi que ce soit est en dehors du modèle de lecture de Panoptica365.

Ce que Panoptica365 *fait* remonter qui est pertinent :

- **Dérive sur l'un ou l'autre modèle.** Account Protection et Block Microsoft Consumer Accounts sont tous deux surveillés par le détecteur de dérive. Si un admin désactive Credential Guard pour un appareil problématique, ou assouplit Block MSA à la demande d'un client, la dérive se déclenche et l'opérateur peut revenir, réappliquer, ou accepter.
- **Détections Defender XDR.** Quand l'ingestion Defender XDR est configurée (leçon 4 de la carte 1), les incidents liés aux attaques d'identifiants — tentatives d'accès LSASS, patrons d'extraction d'identifiants suspects — entrent dans le moteur d'alertes. Si Credential Guard fait son travail, ces incidents devraient être rares; une pointe est intéressante.

Pour le statut de Credential Guard par appareil, l'inscription WHfB par utilisateur, ou la vérification Block MSA par appareil, les opérateurs plongent dans la section appareil Intune, les dossiers d'appareil Entra, ou le portail Defender for Endpoint. Cette division — Panoptica365 pour les alertes et la dérive, les consoles Microsoft pour la posture par appareil — c'est la forme cohérente de la plateforme à travers toute la carte 4.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**Credential Guard est le paramètre à plus haut levier dans ce modèle.** Des 15 paramètres Account Protection, l'activation de Credential Guard est celui qui compte le plus. Il défend contre toute une classe d'attaques d'extraction d'identifiants. Déployer sans lui laisse une brèche majeure; déployer avec lui ferme la brèche avec peu de coût opérationnel.

**Block MSA est un modèle silencieux et à haute valeur.** Les MSA personnels sur les appareils corporatifs sont une source chronique d'incidents de fuite de données et de confusion d'identité. Les bloquer adresse le problème à la couche de configuration. Le modèle est précisément accordé pour bloquer l'ajout MSA personnel tout en laissant le chemin d'authentification WAM travail/école dont les apps M365 dépendent complètement intact — une cible plus étroite que ce que le CSP « Autoriser les comptes Microsoft » par défaut suggérerait, et la raison pour laquelle ce modèle vaut la peine d'être traité comme une configuration curée plutôt qu'un changement de politique d'une ligne.

**L'adoption WHfB est un mouvement à plus long terme.** Ce modèle rend WHfB *possible*. Faire en sorte que les utilisateurs l'utilisent vraiment (vs continuer à taper des mots de passe), c'est un exercice de gestion du changement séparé. Ne vous attendez pas à 100 % d'adoption WHfB dans le mois suivant le déploiement; attendez-vous à une adoption graduelle sur six à douze mois.

## Ce qui suit

- **Leçon 9 : La boucle de conformité en production.** Comment tous ces modèles Intune font surface comme signaux — ce que Panoptica365 surveille, ce que la dérive veut dire ici.
- **Leçon 10 : Importer vos propres modèles Intune.** Le flux de personnalisation.

Pour l'instant : Account Protection + Block MSA ensemble ferment la brèche côté identifiants sur les terminaux Windows. Déployez les deux; vérifiez que Credential Guard s'active; communiquez le changement Block MSA aux utilisateurs; tracez l'adoption WHfB sur des mois.

---

*Sources des données dans cette leçon — Microsoft Learn sur Windows Hello for Business ([Microsoft Learn — Windows Hello for Business](https://learn.microsoft.com/en-us/windows/security/identity-protection/hello-for-business/)); référence de Credential Guard ([Microsoft Learn — Credential Guard](https://learn.microsoft.com/en-us/windows/security/identity-protection/credential-guard/)); politique Account Protection dans endpoint security ([Microsoft Learn — Account Protection policies](https://learn.microsoft.com/en-us/mem/intune/protect/endpoint-security-account-protection-policy)); le CSP de politique Allow Microsoft Accounts ([Microsoft Learn — Accounts CSP](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-accounts)); Web Account Manager et M365 ([Microsoft Learn — WAM and M365](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-acquire-token-wam)).*
