---
title: "Les cinq surfaces que M365 sécurise"
subtitle: "Identité, terminaux, courriel, collaboration et applications infonuagiques — les cinq arrêts de la tournée de tout attaquant dans M365."
icon: "layers"
last_updated: 2026-05-29
---

# Les cinq surfaces que M365 sécurise

En 2024, un petit cabinet de comptables s'est fait compromettre. L'attaquant a commencé par hameçonner les identifiants d'un associé junior. Ça lui a donné accès à la boîte de courriels. Dans la boîte, il a trouvé un fil de discussion mentionnant « la lettre de mission est dans le SharePoint client ». Il a navigué vers SharePoint, trouvé 18 mois de déclarations fiscales pour 30 clients, les a téléchargées via OneDrive sync, et s'est déconnecté en silence.

Identité → courriel → collaboration → applications infonuagiques. Un identifiant. Quatre surfaces. Le MSP du cabinet avait mis en place de la surveillance pour une seule d'entre elles.

Quand on dit que M365 « est » cinq surfaces, c'est ça qu'on veut dire. Ce ne sont pas des conteneurs indépendants. Ce sont des arrêts dans la tournée d'un attaquant. Un contrôle sur n'importe laquelle d'entre elles ne compte que s'il est assez solide pour arrêter la tournée là où elle commence.

Cette leçon, c'est la carte.

## Ce que « surface » veut dire ici

Une surface, c'est une catégorie de cible d'attaque — une chose que l'attaquant veut, et un endroit où M365 la range ou la fait transiter. M365 en a environ cinq.

On n'est pas les seuls à organiser la pile comme ça. Microsoft elle-même découpe le portail Defender XDR en « Identités », « Terminaux », « Courriel et collaboration », « Applications infonuagiques ». Le CIS Microsoft 365 Benchmark divise les contrôles selon des lignes semblables. Inforcer, Octiga, Overe, et la plupart des fournisseurs dans cet espace regroupent leurs produits en compartiments similaires. Ce n'est pas arbitraire; c'est comme ça que le modèle de menaces se découpe naturellement.

Les voici.

## 1. Identité

**Ce que c'est :** Entra ID — comptes, groupes, appareils, applications, principaux de service, l'annuaire lui-même.

**Ce que les attaquants veulent :** Des identifiants, des jetons, des sessions, la capacité *d'être* quelqu'un. L'identité est la porte d'entrée vers toutes les autres surfaces. Compromettez une identité et vous n'avez pas besoin de briser le serveur de courriels ou le site SharePoint; vous vous connectez simplement en tant que quelqu'un qui a accès.

**Ce qui la protège dans M365 :**

- **Entra ID** lui-même — l'annuaire, MFA, méthodes d'authentification, protection par mot de passe.
- **Accès conditionnel** — applique *quelles* connexions sont autorisées selon le contexte (conformité de l'appareil, emplacement, application, score de risque).
- **Entra ID Protection** (seulement dans les SKU P2) — notation basée sur le risque des utilisateurs et des connexions.
- **Microsoft Defender for Identity** — surveille Active Directory local si vous en avez encore un, plus l'activité de synchronisation hybride.

**Où Panoptica365 la surveille :** C'est la surface la plus chargée pour nous. Surveillance des connexions, vérification de l'application du MFA, dérive des méthodes d'authentification, posture de l'accès conditionnel, alertes pour IP étrangère et déplacement impossible, plus les alertes d'identité de Defender XDR qui arrivent par le Unified Audit Log (UAL) — le flux d'événements à l'échelle du tenant Microsoft, qui enregistre chaque action administrative et la plupart des activités utilisateur.

## 2. Terminaux

**Ce que c'est :** Les appareils physiques — portables Windows, Mac, iPhones, Androids — depuis lesquels les utilisateurs se connectent. Chaque appareil est un morceau du périmètre, au sens que la leçon 1 a expliqué : il n'y a plus de périmètre, seulement des fobs et les gens qui les tiennent.

**Ce que les attaquants veulent :** Un point d'appui initial. Un appareil qu'ils contrôlent est un endroit pour exécuter du maliciel, récolter des jetons en cache, capturer des frappes au clavier, et persister après que l'utilisateur a réinitialisé son mot de passe. Les terminaux sont aussi là où *vivent* beaucoup de sessions M365 — Outlook, OneDrive sync, le client Teams pour ordinateur contiennent tous des jetons sur le disque local.

**Ce qui les protège dans M365 :**

- **Intune** — gestion des appareils. Inscrit l'appareil, le configure, applique des politiques, vérifie la conformité (chiffrement activé, version d'OS à jour, antivirus actif, pas de jailbreak).
- **Defender for Endpoint** — EDR. Surveillance comportementale sur l'appareil lui-même; c'est ce qui attrape les rançongiciels, les processus suspects, le comportement de type ransomware.
- **Defender Antivirus** — l'antivirus qui vient avec Windows. De plus en plus enrichi par le nuage et sous-estimé.
- **Règles de réduction de la surface d'attaque (ASR)** — contrôles préventifs qui bloquent les patrons de comportement connus comme mauvais (macros Office qui lancent des processus, scripts dans des dossiers temp, ce genre d'affaire).

**Où Panoptica365 les surveille :** Dérive des déploiements Intune, posture de conformité des appareils, couverture du déploiement EDR. On n'analyse pas la télémétrie brute des terminaux — c'est le travail de Defender, et le répliquer serait une erreur.

## 3. Courriel

**Ce que c'est :** Exchange Online. Boîtes aux lettres, flux de courriels, calendrier, contacts. Le canal au volume le plus élevé dans n'importe quelle entreprise.

**Ce que les attaquants veulent :** Deux choses. D'abord, *comme cible* — fraude financière (manipulation de factures, redirection de virements, compromission de courriel d'entreprise, BEC). Ensuite, *comme véhicule* — courriels d'hameçonnage envoyés vers d'autres utilisateurs, y compris ceux d'autres entreprises avec lesquelles la victime fait affaire. Les boîtes compromises sont la façon dont se produit l'hameçonnage *d'expéditeur de confiance*, et c'est le type qui fonctionne vraiment.

**Ce qui le protège dans M365 :**

- **Exchange Online Protection (EOP)** — le filtre de base sur le flux de courriels. Anti-pourriel, anti-maliciel, règles de flux.
- **Defender for Office 365** Plans 1 et 2 — politiques anti-hameçonnage, Safe Links (réécriture d'URL et vérification au moment du clic), Safe Attachments (chambre de détonation), protection contre l'usurpation d'identité. Le Plan 1 est maintenant inclus dans Business Premium et E3 depuis 2026; le Plan 2 ajoute Threat Explorer, Attack Simulation Training et Automated Investigation and Response.
- **Audit des boîtes aux lettres** — suit qui a fait quoi à l'intérieur d'une boîte (changements de règles, suppressions, configuration de transfert).
- **Surveillance des règles de boîte et du transfert au niveau boîte** — pour repérer la règle silencieuse de transfert vers Gmail que les attaquants adorent.

**Où Panoptica365 le surveille :** préréglage anti-hameçonnage, posture d'audit des boîtes aux lettres, détection des règles de boîte et du transfert au niveau boîte, configuration de Safe Links et Safe Attachments. C'est la catégorie la plus profonde dans notre catalogue de surveillance.

## 4. Collaboration

**Ce que c'est :** SharePoint Online, OneDrive, Teams. Les endroits où les fichiers vivent vraiment et où le travail d'équipe se fait.

**Ce que les attaquants veulent :** Les fichiers. Déclarations fiscales. Lettres de mission. Dossiers RH. Code source. Documents de fusions et acquisitions. Une fois à l'intérieur, c'est là que les données *intéressantes* se trouvent. Ils veulent aussi du mouvement latéral — un site SharePoint trop permissif avec le partage externe activé permet à un attaquant de s'inviter depuis une adresse Gmail. La plupart de l'exfiltration de données dans les attaques M365 se termine ici.

**Ce qui la protège dans M365 :**

- **Contrôles de partage SharePoint et OneDrive** — qui peut partager quoi à l'externe, politiques de liens anonymes, expiration de liens, expiration des invités.
- **Étiquettes de confidentialité** — classification automatique et manuelle des documents (Confidentiel, Très confidentiel, etc.) avec chiffrement et contrôles d'accès attachés.
- **Prévention des pertes de données (DLP)** — politiques qui détectent les données sensibles (NAS, numéros de carte de crédit, motifs personnalisés) et bloquent le partage.
- **Politiques Teams** — qui peut créer des équipes, quelles applications sont permises, accès des invités.
- **Accès conditionnel pour SharePoint et OneDrive** — applique les mêmes règles de conformité d'appareil et d'emplacement de confiance à l'accès aux fichiers.

**Où Panoptica365 la surveille :** Posture de partage SharePoint, inventaire des permissions de site, audit du partage externe (le module d'audit SharePoint). La couverture des étiquettes de confidentialité et la visibilité DLP sont partielles aujourd'hui.

## 5. Applications infonuagiques

**Ce que c'est :** Toutes les applications SaaS auxquelles vos utilisateurs se connectent avec leur identité M365 et qui *ne sont pas* M365. Salesforce, GitHub, Dropbox, l'outil d'IA qu'ils ont essayé un mardi. Plus toutes les applications enregistrées via OAuth et les principaux de service à l'intérieur d'Entra ID lui-même.

**Ce que les attaquants veulent :** Deux choses. D'abord, un accès persistant via le consentement OAuth — une application qu'ils ont trompé l'utilisateur à approuver reste même après une réinitialisation de mot de passe. Ensuite, l'exfiltration latérale de données — si votre utilisateur a accès à Salesforce et qu'un attaquant compromet l'identité M365, il a probablement Salesforce aussi. Le SaaS fédéré est un multiplicateur de force pour la compromission.

**Ce qui les protège dans M365 :**

- **Inscriptions d'applications et applications d'entreprise Entra ID** — ce qui est autorisé à demander des permissions, quels consentements doivent être approuvés par un admin.
- **Politiques de consentement OAuth** — restreindre les utilisateurs d'approuver des applications avec des portées à privilèges élevés.
- **Defender for Cloud Apps (MDA)** — surveillance à l'échelle SaaS sur les applications enregistrées; analyse du comportement utilisateur; découverte du SaaS fantôme.
- **Accès conditionnel pour les applications infonuagiques** — les mêmes règles peuvent s'appliquer aux applications SaaS non-Microsoft fédérées par Entra.

**Où Panoptica365 les surveille :** Plus léger aujourd'hui que les quatre autres surfaces. L'inventaire des consentements OAuth est partiel. Les alertes de Defender for Cloud Apps arrivent par l'ingestion Defender XDR.

## Les cinq surfaces ne sont pas cinq produits

L'erreur que font les opérateurs juniors une fois qu'ils voient cette liste, c'est de traiter chaque surface comme « la responsabilité d'un produit ». L'identité est Entra. Les terminaux sont Intune. Le courriel est Defender for Office 365. Et ainsi de suite.

Ce modèle est faux, et il est faux d'une façon qui compte.

Regardez les listes de protection plus haut et notez le chevauchement :

- **L'accès conditionnel** apparaît sous Identité, Collaboration et Applications infonuagiques. C'est une couche d'application *transversale* qui opère partout où une connexion se produit.
- **La conformité Intune** est un produit *terminal*, mais sa sortie (un état de conformité par appareil) est consommée par l'accès conditionnel à *chaque* connexion à *chaque* surface.
- **Defender XDR** n'apparaît sur la liste d'aucune surface individuelle parce qu'il siège *au-dessus* de toutes les cinq — corrélant les signaux entre elles et cherchant des incidents qui en couvrent plusieurs.

Le bon modèle mental est *couches*, pas silos :

1. **Identité** est la couche dont toutes les autres surfaces dépendent (signal : *qui*).
2. **Terminaux** est la couche qui produit le signal de confiance (signal : *depuis quoi*).
3. **Courriel** et **Collaboration** sont les deux principales couches de *données* (où les choses qui ont de la valeur vivent vraiment).
4. **Applications infonuagiques** est la couche qui prolonge ces couches de données vers le SaaS non-Microsoft.

Et **l'accès conditionnel** est le *moteur de politique* qui opère sur toutes. **Defender XDR** est le *moteur de détection et de réponse* qui les surveille toutes.

Si vous ne retenez qu'une seule forme de cette leçon : les surfaces sont des *cibles de données et d'accès*, les produits sont des *mécanismes d'application et de détection*. Ce sont des dimensions orthogonales. Un opérateur junior qui pense « Courriel = Defender for Office 365 » ratera la moitié de la sécurité courriel qui vit dans l'accès conditionnel, Entra ID Protection et DLP. (Qui est la moitié intéressante.)

## Ce que ça veut dire pour l'opérateur

Trois implications concrètes.

**On ne choisit pas une surface à défendre; on choisit une chaîne.** Hameçonnage → courriel → identité → applications infonuagiques est une chaîne. Portable compromis → maliciel sur le terminal → vol de jeton → identité → SharePoint en est une autre. Concevoir sa surveillance autour de chaînes, pas de surfaces, c'est comme ça qu'on attrape les attaques qui se déplacent.

**L'accès conditionnel est le contrôle le plus levier de toute la pile.** C'est la seule chose qui opère sur plusieurs surfaces au moment de la politique. Mal configurer une politique d'accès conditionnel peut briser l'accès *ou* laisser un trou sur trois surfaces simultanément. La bonne nouvelle : bien configurer l'accès conditionnel est aussi la chose la plus levier que vous puissiez faire. On a toute une carte là-dessus (carte 3).

**La détection seule est incomplète sans corrélation.** Surveiller les événements de courriel seuls est la moitié d'un travail. Surveiller les événements de connexion seuls est la moitié d'un travail. L'attaque qui vous intéresse — la chaîne — en touche plusieurs. Defender XDR (leçon 4) et la corrélation d'alertes de Panoptica365 sont tous les deux des tentatives de résoudre le même problème de corrélation depuis des angles différents.

## Ce qui suit

Le reste de cette carte :

- **Leçon 3 : Defender, Intune, accès conditionnel — comment ils s'imbriquent vraiment.** Le diagramme de la boucle de conformité et où chaque outil est configuré. C'est là que « l'accès conditionnel est le moteur de politique » devient concret.
- **Leçon 4 : Defender XDR — ce que c'est, ce que ce n'est pas.** L'histoire de la corrélation transversale.
- **Leçon 5 : Les licences Microsoft 365 — qu'est-ce qui débloque quoi.** Parce que plusieurs des contrôles ci-dessus n'existent qu'à certains paliers de SKU, et un client Business Standard en manque la moitié.
- **Leçon 6 : Où Panoptica365 s'installe dans le tableau.** Ce qu'on surveille, ce qu'on ne touche pas, pourquoi on ne corrige pas automatiquement.

Ensuite, la carte 2 (*Menaces identitaires et patrons d'attaque*) marche à travers de vraies chaînes d'attaque sur ces surfaces. À ce moment-là, les chaînes devraient avoir l'air familières — vous lirez « identifiant → boîte → SharePoint » et compterez instinctivement les traversées de surfaces.

Pour l'instant : les surfaces sont des arrêts dans la tournée de l'attaquant. Les produits sont l'application et la détection. Si vous saisissez le modèle correctement, le reste du programme devient forme, pas mémorisation.

---

*Sources des données dans cette leçon — l'organisation du portail Microsoft 365 Defender autour des identités, terminaux, courriel et collaboration, applications infonuagiques comme domaines principaux de sécurité ([Microsoft Learn — Vue d'ensemble Defender XDR](https://learn.microsoft.com/en-us/defender-xdr/microsoft-365-defender)); Microsoft 365 Defender Threat Intelligence sur les chaînes d'attaque transversales ([Microsoft Security Blog](https://www.microsoft.com/en-us/security/blog/), 2025); CIS Microsoft 365 Foundations Benchmark pour la taxonomie de contrôles basée sur les surfaces ([CIS](https://www.cisecurity.org/benchmark/microsoft_365)).*
