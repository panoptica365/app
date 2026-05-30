---
title: "Credential stuffing et password spray — les attaques les plus bêtes qui marchent encore"
subtitle: "Comment les données de brèches recyclées et les attaques un-mot-de-passe-plusieurs-comptes compromettent encore M365."
icon: "key-round"
last_updated: 2026-05-29
---

# Credential stuffing et password spray — les attaques les plus bêtes qui marchent encore

Quelque part sur un canal Telegram en ce moment, un attaquant paie 4 $ pour un fichier CSV qui contient 28 millions de paires courriel-mot de passe récupérées dans une brèche Dropbox de 2012. Il ne se soucie pas que le fichier ait quatorze ans. Il ne se soucie même pas que 95 % des mots de passe aient été changés. Il va donner les 28 millions de paires à un script qui essaie chacune contre `login.microsoftonline.com`, et quelque part là-dedans, quelques centaines vont encore fonctionner — parce que quelque part, quelques centaines de personnes ont utilisé leur mot de passe Dropbox comme mot de passe M365, ne l'ont jamais changé, et n'ont jamais activé le MFA.

C'est ça, le credential stuffing. C'est l'attaque la plus ennuyeuse du catalogue, et en 2026, c'est encore le point d'entrée d'une part significative des compromissions M365.

Cette leçon, c'est pourquoi les attaques bêtes continuent de marcher, à quoi ça ressemble dans la télémétrie Microsoft, et où le MFA gagne son pain.

## Les deux saveurs

Il y a deux attaques dans cette leçon, et on les confond souvent parce qu'elles se ressemblent du côté Microsoft.

**Le credential stuffing** utilise de *vrais* identifiants récoltés dans des brèches. L'attaquant a de vraies paires `courriel → mot de passe` de quelque part (LinkedIn 2012, Adobe 2013, Yahoo 2014, MyFitnessPal 2018, LastPass 2022, choisissez une année). Environ une sur cent va encore fonctionner quelque part sans rapport, parce que les humains réutilisent leurs mots de passe. L'attaquant fait passer la liste contre M365, Gmail, les banques, et tout autre service qui prend une adresse courriel comme nom d'utilisateur.

**Le password spray** retourne ça. Au lieu de *plusieurs* mots de passe contre *un* compte (ce qui déclenche le verrouillage), l'attaquant essaie *un* mot de passe contre *plusieurs* comptes. « Printemps2024! » contre 50 000 adresses courriel, en un seul passage lent, cadencé assez bas pour éviter les limites de débit par compte. Environ 0,5 % de ces comptes utilisent « Printemps2024! » parce que les mots de passe saisonniers prévisibles sont une habitude qu'on ne tue pas.

Les deux attaques partagent la même caractéristique : **l'attaquant utilise un mot de passe qui fonctionne vraiment sur le compte.** Du point de vue de Microsoft, c'est une *tentative de connexion légitime avec les bons identifiants*. Le signal que quelque chose ne va pas doit venir *d'ailleurs que de l'échec du mot de passe* — ce qui est tout le défi de la détection de cette classe d'attaque.

## Comment Microsoft le voit

Microsoft en voit beaucoup. Des centaines de millions de tentatives par jour, à travers tout le parc Entra ID. Les mitigations superposées par Microsoft au niveau plateforme font que la plupart de ces attaques échouent avant même de générer une alerte dans votre tenant. Trois couches de défense sont là par défaut :

**Smart Lockout.** Entra ID suit les tentatives de connexion échouées par compte et par IP. Si trop échouent trop rapidement, le compte est brièvement verrouillé ou l'IP est limitée en débit. L'attaquant ralentit (vaincre le volume) ou se déploie sur plusieurs IP (vaincre la limite par IP de Smart Lockout, mais son botnet devient maintenant une opération plus chère).

**La liste de mots de passe interdits de Microsoft.** Entra ID a une liste intégrée de mauvais mots de passe communs (« Password1 », « Welcome2024 », « Printemps2024! », quelques milliers d'autres). Si un utilisateur essaie d'en mettre un, le changement est rejeté. Les listes personnalisées de mots de passe interdits permettent au MSP d'ajouter des chaînes spécifiques à l'entreprise (« CustomerCo2024 », le nom de l'entreprise, etc.). Les listes personnalisées requièrent Entra ID P1 (Business Premium ou au-dessus).

**Notation comportementale des risques** (P2 seulement). Entra ID Protection — disponible seulement à E5 — note chaque connexion pour le risque. Une connexion depuis un nouveau pays, sur une IP anonymisante, avec un mot de passe qui vient d'un dump fuité connu, va être marquée comme risque élevé et peut être bloquée ou élevée à exiger le MFA via l'accès conditionnel.

La réalité honnête est ceci : à Business Premium ou en dessous, votre défense contre le credential stuffing, c'est **MFA, Smart Lockout, et la liste de mots de passe interdits.** C'est tout. À E5 vous obtenez aussi l'AC basé sur le risque. L'écart compte parce que le credential stuffing est exactement la classe d'attaque que l'AC basé sur le risque attrape le mieux.

## Comment Panoptica365 le voit

Panoptica365 n'essaie pas de détecter les tentatives de credential stuffing au niveau de la *tentative* — Microsoft a des centaines de moteurs de détection pour ça, et Defender XDR fait de la corrélation inter-tenant qu'on serait bêtes de répliquer. Ce que Panoptica365 fait remonter, c'est *l'issue* : une connexion réussie qui semble hors patron, une connexion d'IP étrangère à un compte qui ne s'est jamais connecté que depuis un seul pays, un patron de déplacement impossible entre deux connexions séparées par des minutes et un continent.

Ces signaux au niveau de l'issue sont les alertes que vous verrez le plus souvent dans la carte 6 (où commence le comportement BEC post-compromission). L'événement de credential stuffing lui-même est en amont — ce qu'on fait remonter, c'est *la conséquence*.

À savoir aussi : la vérification d'application du MFA de Panoptica365 est la défense la plus directe contre toute cette classe d'attaque. Chaque alerte lisible par l'opérateur qui dit « cet utilisateur a le MFA désactivé », c'est, en pratique, « cet utilisateur est exposé au credential stuffing ». Traitez les alertes MFA-désactivé comme prioritaires. La cite de 99,9 % de la carte 1, leçon 1 (la déclaration de Microsoft que le MFA bloque la grande majorité des compromissions de compte automatisées) concerne *spécifiquement cette classe d'attaque*.

## À quoi ressemble une attaque sur la ligne du temps

Une campagne de credential stuffing typique, du côté de l'attaquant, ressemble à ça :

1. **Obtenir la liste.** Acheter un dump sur un forum, ou en tirer un de l'API `haveibeenpwned` gratuitement. Les dumps modernes sont dénormalisés — déjà au format `courriel:mot de passe`, triés par domaine.
2. **Filtrer par domaine.** Sortir chaque adresse `@compagnieduclient.com` du dump. L'attaquant a maintenant un sous-ensemble de la taille de la cible.
3. **Tester lentement, en distribué.** Faire passer les tentatives par une infrastructure de proxys résidentiels (5–10 tentatives par IP par heure, milliers d'IP). C'est *spécifiquement* conçu pour vaincre les limites par IP de Smart Lockout sans déclencher les limites par compte.
4. **Récolter les succès.** Tout compte qui se connecte sans MFA est capturé. Tout compte qui demande le MFA est journalisé pour plus tard (la prochaine phase sera soit la fatigue MFA, soit l'AiTM — couvertes dans les leçons 2 et 3 de cette carte).
5. **Persister.** Les comptes réussis sont ajoutés à une liste séparée. Certains attaquants les utilisent immédiatement pour le BEC (leçon 6); d'autres les revendent sur les mêmes forums où ils ont acheté le dump original.

Le cycle complet, de bout en bout, peut tourner en un seul fin de semaine. L'économie est favorable à l'attaquant parce que les intrants ne coûtent presque rien.

## À quoi ressemble une attaque du côté de l'opérateur

Vous pouvez en fait voir une campagne de credential stuffing *pendant qu'elle se produit* si vous regardez le bon widget. Vous allez voir :

- **Une pointe d'échecs de connexion dans le widget Activité quotidienne de Panoptica365** sur le tableau de bord du tenant. Le graphique en anneau se rafraîchit à peu près toutes les 15 minutes et inclut les tentatives d'authentification échouées et les blocages d'accès conditionnel. La signature du credential stuffing sur l'anneau, c'est *des échecs distribués sur plusieurs utilisateurs* — distinct de la fatigue MFA (leçon 2), où les échecs se concentrent sur un ou quelques utilisateurs. Les données par événement à plus haute fidélité sont dans le journal de connexion Entra filtré sur les tentatives échouées.
- **Un utilisateur qui se plaint d'avoir été verrouillé** sans raison évidente. Smart Lockout s'est déclenché. L'IP de l'attaquant a fait désactiver temporairement son compte, et l'utilisateur légitime en est maintenant affecté.
- **Une alerte MFA-désactivé ou IP étrangère dans Panoptica365** pour une connexion réussie. C'est la *queue réussie* de l'attaque — celle qui a atterri parmi quelques milliers de tentatives.

Celle qui est intéressante pour le triage, c'est la troisième. Quand une alerte de connexion réussie d'IP étrangère se déclenche sur un utilisateur qui avait le MFA désactivé, votre présomption par défaut devrait être que le compte est *actuellement compromis*. La bonne réponse : réactiver le MFA, forcer une réinitialisation du mot de passe, révoquer toutes les sessions, scanner sa boîte aux lettres pour toute règle de transfert ou tout changement de règle récent (anticipant la chaîne « hameçonnage → courriel → identité » de la carte 1 leçon 2), et notifier le client. N'attendez pas « plus de preuves » — les succès de credential stuffing sont des compromissions confirmées, pas des « peut-être ».

## Défendre le client

Le gâteau défensif en couches contre le credential stuffing, classé par impact par unité d'effort :

**Appliquer le MFA universellement, avec l'accès conditionnel.** C'est la défense au plus fort impact et celle qui dispose de la grande majorité de ces attaques. Microsoft a cité que l'activation du MFA bloque plus de 99,9 % des tentatives de compromission de compte automatisées. Le 0,1 % qui passe, c'est surtout AiTM, fatigue MFA, et hameçonnage par consentement — les trois prochaines leçons. Sans MFA, le 99,9 % revient.

**Ajouter une liste personnalisée de mots de passe interdits.** Au-delà de la liste par défaut de Microsoft, ajoutez le nom de l'entreprise, la ville, les noms de produits communs, l'année. « CustomerCo2024 » n'est pas un mot de passe fort et les gens l'utilisent quand même. La liste personnalisée Entra ID P1 est un des gains les plus faciles sur un tenant.

**Mettre Smart Lockout à un seuil sensé.** Les valeurs par défaut de Microsoft sont raisonnables mais peuvent être resserrées sur les tenants de grande valeur. Le réglage est dans les paramètres de protection de mot de passe Entra ID.

**Sur les tenants E5, activer des politiques d'accès conditionnel basées sur le risque.** « Bloquer la connexion quand le risque utilisateur est élevé » et « exiger un changement de mot de passe quand le risque utilisateur est moyen » sont les deux politiques de départ. Elles utilisent la notation comportementale de Microsoft (la fonctionnalité P2) pour attraper les connexions qui *paraissent* légitimes mais sont notées suspectes. Les tenants Business Premium ne peuvent pas faire ça — voir la carte 1, leçon 5 pour la conversation sur les licences.

**Pousser les clients vers l'authentification sans mot de passe / résistante à l'hameçonnage.** Passkeys, Windows Hello for Business, clés FIDO2. Celles-ci n'ont pas de mot de passe à voler, point. La leçon 3 de cette carte (AiTM) expliquera pourquoi les méthodes résistantes à l'hameçonnage comptent pour *beaucoup plus* que juste le credential stuffing.

## Ce que ça veut dire pour l'opérateur

Deux points pratiques.

**Le credential stuffing est une attaque « avez-vous fait les bases? ».** Quand ça réussit contre un tenant, ça révèle presque toujours un de trois échecs : le MFA n'était pas appliqué pour l'utilisateur; l'utilisateur avait un mot de passe interdit que la liste personnalisée n'a pas bloqué; ou l'AC du tenant est configuré assez lâchement pour que l'attaquant ait trouvé un chemin autour du MFA. La revue post-incident de toute compromission de credential stuffing réussie devrait poser les trois questions.

**L'alerte MFA-désactivé est l'alerte la plus précieuse dans votre file pour cette classe d'attaque.** Panoptica365 la fait remonter. Elle paraît anodine à côté des alertes plus bruyantes sur les connexions d'IP étrangère ou les règles de boîte suspectes, mais l'utilisateur sans MFA est la porte ouverte par laquelle les autres entrent. Traitez ça comme prioritaire. Résolvez (soit en activant le MFA, soit en enregistrant une exemption avec justification pour un compte de service qui ne peut pas légitimement avoir le MFA).

## Ce qui suit

- **Leçon 2 : Fatigue MFA — l'histoire d'Uber.** Quand l'attaquant a le mot de passe *et* que le compte a le MFA activé, la prochaine attaque, c'est d'ingénier socialement le prompt MFA lui-même. Bombarder l'utilisateur de notifications push à 2 h du matin jusqu'à ce qu'il tape « Oui ».
- **Leçon 3 : Hameçonnage AiTM — le roi de 2026.** Le contournement technique du MFA, où l'attaquant n'a besoin ni du mot de passe (en fait oui, mais l'utilisateur le tape pour lui) ni de l'approbation MFA (il l'obtient d'un proxy en temps réel).

Pour l'instant : le credential stuffing est le plancher. C'est l'attaque ennuyeuse et scalable que l'attaquant essaie en premier parce qu'elle est pas chère. Les défenses sont bien connues et licenciables. La raison pour laquelle ça marche encore en 2026, ce n'est pas que l'attaque est intelligente — c'est que le MFA n'est pas encore universel. C'est l'écart que les deux prochaines leçons exploitent.

---

*Sources des données dans cette leçon — Microsoft Identity Security Group sur le blocage par MFA de 99,9 % des compromissions de comptes automatisées ([Weinert, août 2019](https://techcommunity.microsoft.com/blog/microsoft-entra-blog/your-pa%24%24word-doesn%E2%80%99t-matter/731984)); référence Entra ID Smart Lockout ([Microsoft Learn — Smart Lockout](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-password-smart-lockout)); Entra ID Password Protection (mots de passe interdits) ([Microsoft Learn — Eliminate bad passwords](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-password-ban-bad)); contexte sur les jeux de données de brèches ([Have I Been Pwned](https://haveibeenpwned.com/)).*
