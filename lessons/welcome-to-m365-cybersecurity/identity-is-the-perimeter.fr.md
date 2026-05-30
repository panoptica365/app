---
title: "Pourquoi l'identité est devenue le périmètre"
subtitle: "Comment les attaquants contournent le pare-feu en empruntant des identités — et pourquoi chaque connexion est maintenant votre frontière de sécurité."
icon: "scan-face"
last_updated: 2026-05-29
---

# Pourquoi l'identité est devenue le périmètre

Il est 2 h 14 du matin. Le téléphone de votre utilisatrice vibre — Microsoft Authenticator demande d'approuver une connexion. Elle est à moitié endormie. Elle tape « Oui » pour faire taire les vibrations.

Huit heures plus tard, votre service de support remarque quelque chose d'étrange : tous les courriels de factures sont silencieusement transférés vers une adresse Gmail que personne ne reconnaît. Ça dure depuis trois jours.

Cette attaque a commencé sans aucun maliciel. Sans aucune exploitation de vulnérabilité. Sans aucune brèche dans le pare-feu. L'attaquant avait son mot de passe (acheté, probablement, dans un vidage de fuite d'un service SaaS sans aucun rapport) et il a simplement continué à faire vibrer son téléphone jusqu'à ce qu'elle abandonne. C'est ça, l'attaque au complet. Le « mur » autour de son entreprise n'est jamais entré en jeu — parce que l'attaquant n'a jamais eu besoin de l'escalader.

Bienvenue dans la sécurité en 2026.

## Le mur n'est plus là où sont les données

Il y a vingt ans, la sécurité ressemblait à un édifice. Vos données vivaient sur un serveur dans un placard au bout du couloir. Pour y accéder, un attaquant devait physiquement entrer dans l'édifice, se brancher sur le réseau, vaincre le pare-feu, contourner l'antivirus et exfiltrer les données — tout ça sans déclencher d'alarme. On appelait ça « la défense en profondeur », et on la dessinait en cercles concentriques. Les données étaient au centre. Le pare-feu était l'anneau extérieur. La vie était simple. La vie était aussi un mensonge, mais bon.

Aujourd'hui, vos données vivent dans M365. Vos utilisateurs y accèdent depuis un Wi-Fi d'hôtel à Lisbonne, un téléphone à un match de soccer, un iPad sur un comptoir de cuisine et, occasionnellement — *occasionnellement* — un portable géré sur le réseau du bureau. Le pare-feu autour du bureau, aujourd'hui, ne protège à peu près rien. Il n'y a plus d'« intérieur ». Il n'y a que des identifiants, des sessions et des jetons.

Ce n'est pas un slogan. C'est un organigramme. Microsoft, Google, Amazon, Cloudflare, votre banque et Revenu Québec fonctionnent tous sur le même modèle maintenant. Ce qui décide si une requête est autorisée n'est pas *d'où vient la requête*. C'est *qui la fait*, *sur quel appareil*, *pour faire quoi*, et *est-ce que quelque chose a l'air bizarre en ce moment*.

Cet ensemble de questions — qui, quoi, où, quand, bizarre? — c'est ce qu'on veut dire quand on dit que « l'identité est le périmètre ».

## Le condo, pas le château

Oubliez les châteaux médiévaux. Chaque article de sécurité de l'histoire s'est servi de la métaphore du château. La métaphore du château est épuisée. La métaphore du château a besoin de prendre sa retraite sur une plage quelque part.

Pensez plutôt à un condo.

Dans un condo, la porte d'entrée est pour tout le monde. Le concierge ne vous demande pas si vous « habitez ici », parce que des dizaines d'inconnus entrent chaque jour — livreurs Amazon, technicien d'ascenseur, beaux-parents en visite, équipe de ménage. Ce qui compte, c'est votre **fob**.

Le fob déverrouille votre étage, votre unité, le gym, le stationnement. Il ne déverrouille *pas* les autres étages, les autres unités, le bureau du gestionnaire ou le toit. Si vous le perdez, la réception le désactive dans son système, et il cesse de fonctionner partout en même temps. Si votre fob tente soudainement d'entrer au gym à 3 h du matin après avoir été utilisé dans le stationnement 90 secondes plus tôt d'une façon qui est physiquement impossible — voilà qui est intéressant. Le système peut le remarquer. Le système peut décider de dire non.

C'est ça, le modèle. Le « mur » a cessé d'être un mur il y a longtemps. Le fob, c'est tout.

En termes M365 :

- **Entra ID** est la réception. Il tient la liste maîtresse de qui possède un fob et de ce que chaque fob a le droit de faire.
- **Le MFA**, c'est le fait que le fob ait un NIP que vous devez entrer — la preuve que la personne qui tient le fob est bien celle à qui il a été émis, et pas quelqu'un qui l'a trouvé sur un comptoir de bar.
- **L'accès conditionnel** est l'ordinateur de l'édifice qui dit « ce fob essaie d'entrer à la piscine du toit depuis un pays où il n'est jamais allé, à 3 h du matin, sur un appareil non géré — non ».
- **Defender XDR** est le garde de sécurité qui regarde les images des caméras pour repérer des *patrons* — trois fobs différents qui frappent à la même porte en cinq minutes, quelqu'un qui essaie chaque porte du 14e étage, ce genre d'affaire.
- **Intune** est la politique qui dit quels fobs fonctionnent sur quels appareils, et à quoi ces appareils doivent ressembler (verrouillés, chiffrés, à jour) avant qu'on les laisse passer.

Quand un vendeur à un salon professionnel vous dit « on sécurise votre périmètre », ce qu'il veut vraiment dire — s'il parle d'une pile moderne — c'est *on prend des décisions à chaque passage de fob*. C'est tout. Quiconque vous vend encore « le mur » vous vend quelque chose qui protège un édifice vide.

## L'attaquant de 2026 ne brise rien; il emprunte

Le changement de mentalité ici est important parce que les attaques ont changé avec lui.

En 2010, l'attaquant essayait de pénétrer votre serveur. En 2026, l'attaquant essaie *d'être* votre utilisateur. C'est une attaque plus douce — pas d'outil d'exploitation, pas de signature de maliciel, parfois pas de charge utile du tout — mais c'est aussi beaucoup plus difficile à voir, parce que du point de vue du système, ça ressemble simplement à une connexion.

Quelques formes spécifiques que ça prend en 2026 :

**Credential stuffing.** L'attaquant achète une liste de paires courriel/mot de passe d'une fuite (LinkedIn, Adobe, MyFitnessPal, prenez votre préférée — elles sont toutes sur le marché pour le prix d'un café), et essaie ces paires contre M365. Environ une sur cent fonctionne, parce que les gens réutilisent leurs mots de passe. C'est toute la raison d'exister du MFA. Microsoft a déclaré que l'activation du MFA bloque plus de 99,9 % de ces attaques automatisées de compromission de compte (Weinert, 2019, et le chiffre n'a fait que se confirmer depuis).

**Fatigue MFA.** Quand le MFA est activé, l'attaquant achète le mot de passe quand même et bombarde simplement l'utilisateur de notifications Authenticator au milieu de la nuit jusqu'à ce qu'il tape « Oui ». C'est exactement comme ça qu'Uber s'est fait avoir en 2022. Ça marche encore aujourd'hui. Le « number matching » et le contexte additionnel dans l'application Authenticator aident. Ils ne règlent pas le problème.

**Hameçonnage AiTM (adversary-in-the-middle, ou « adversaire au milieu »).** C'est la grosse en 2026. L'attaquant envoie un courriel d'hameçonnage avec un lien vers une fausse page de connexion qui *fait office de relais* pour la vraie page de connexion Microsoft en temps réel. L'utilisateur tape son mot de passe. La fausse page l'envoie à la vraie Microsoft. Microsoft renvoie la demande MFA. La fausse page la montre à l'utilisateur. L'utilisateur l'approuve. Microsoft renvoie un **cookie de session**. La fausse page capture ce cookie. L'attaquant possède maintenant une session parfaitement valide, entièrement authentifiée par MFA — il n'a plus besoin du mot de passe ni du MFA, il a le *jeton*. Pour M365, il *est* l'utilisateur. Microsoft a rapporté une **augmentation de 146 % des attaques AiTM en 2024** (Microsoft Defender Threat Intelligence, 2025). Les kits d'hameçonnage qui font ça — Evilginx, Muraena, Modlishka — sont libres de code source et gratuits.

**Hameçonnage par consentement OAuth.** Au lieu de voler un mot de passe, l'attaquant demande à l'utilisateur de consentir à une application malveillante qui réclame des permissions du genre « lire tous vos courriels » ou « envoyer des courriels en votre nom ». L'utilisateur clique « Accepter » sans lire la boîte de dialogue (parce qu'il ne lit jamais la boîte de dialogue), et maintenant il y a une application tierce avec un accès persistant à sa boîte de courriels, sans mot de passe nécessaire, sans MFA nécessaire. Réinitialiser le mot de passe de l'utilisateur ne déloge pas l'application. Désactiver le compte ne le fait pas toujours non plus.

**Hameçonnage par code d'appareil.** Le flux de code d'appareil de Microsoft existe pour des choses comme les imprimantes et les téléviseurs qui n'ont pas de clavier. Les attaquants en abusent : ils génèrent un code d'appareil, envoient à l'utilisateur un message « entrez ce code pour vous vérifier », et l'utilisateur — voulant être serviable — entre le code. L'attaquant a maintenant la session complète de l'utilisateur sur sa propre machine.

Chacune de ces attaques commence et se termine par une identité. Aucune ne touche au pare-feu.

On consacrera toute la prochaine carte (*Menaces identitaires et patrons d'attaque*) à creuser comment chacune de ces attaques fonctionne en détail et ce qui les attrape. Pour l'instant, le seul point à retenir, c'est : quand on dit que l'identité est le périmètre, on ne le dit pas pour faire chic. On veut dire que l'attaquant n'entre plus par effraction. L'attaquant se fait laisser entrer. Votre travail, c'est de le remarquer.

## Ce que ça veut dire au quotidien

La plupart des opérateurs avec qui on a travaillé essaient d'apprendre cette pile de la mauvaise façon : ils commencent par configurer quelque chose. Ils ouvrent le portail Defender. Ils voient dix-sept onglets. Ils en choisissent un. Ils le configurent. Ils se sentent productifs.

C'est, presque toujours, le mauvais endroit pour commencer.

Le bon endroit pour commencer, c'est : *quelle requête a l'air suspecte, et qu'est-ce que notre environnement fait à ce sujet?* Si vous pouvez répondre à ça pour un utilisateur, sur un appareil, vous comprenez la pile. Si vous ne pouvez pas — même le tenant Defender le plus agressivement configuré au monde ne vous sauvera pas, parce que rien à l'intérieur ne fera le travail que vous pensez qu'il fait.

Quelques implications concrètes de « l'identité est le périmètre » pour vous, l'opérateur :

**Ce que vous protégez, ce n'est pas le portable. C'est la session.** Une fois qu'un utilisateur est connecté à M365, ce qu'il possède, c'est une session — un fragment d'état cryptographique qui dit « cette personne a le droit de lire les courriels jusqu'à 16 h ». Les attaquants modernes n'essaient pas de briser le MFA; ils essaient de voler la session. La protéger — avec des choses comme l'exigence d'appareil conforme en accès conditionnel, la Token Protection et l'évaluation d'accès continu (CAE) — c'est tout le travail. On creusera tout ça dans les leçons suivantes.

**Le MFA seul ne suffit pas.** C'était une opinion controversée. C'est maintenant un consensus. Le push Microsoft Authenticator que vous dites à tout le monde d'utiliser est bon — il arrête l'immense majorité des attaques bêtes de credential stuffing — mais il ne fait *rien* contre un site d'hameçonnage AiTM qui relaie la demande à l'utilisateur en temps réel. La vraie protection, c'est le *MFA résistant à l'hameçonnage* : les passkeys, les clés FIDO2, Windows Hello Entreprise. On couvrira vers quoi pousser les clients dans la leçon sur l'accès conditionnel.

**Le signal « bizarre » compte autant que les identifiants.** Votre travail n'est pas seulement « est-ce que le mot de passe est bon? ». C'est « est-ce que quelque chose dans cette connexion a l'air inhabituel? ». Pays différent de celui où l'utilisateur s'est trouvé pendant 30 jours? État de conformité changé? Adresse IP d'où 600 autres comptes compromis se sont connectés hier? Microsoft a tout ça. L'accès conditionnel peut agir là-dessus. Defender XDR le signale. Rien de tout ça n'a quoi que ce soit à voir avec le pare-feu.

**Les comptes de service sont d'habitude la chose la moins bien protégée dans votre environnement.** Les vrais utilisateurs ont du MFA, de l'accès conditionnel, Defender for Endpoint sur leur portable. Les comptes de service ont souvent une authentification par mot de passe sans MFA, des permissions larges, et aucune surveillance — parce que quelqu'un, quelque part, « ne voulait pas casser l'intégration ». Les attaquants le savent. Nous aussi.

**Votre travail, c'est moitié configuration, moitié observation.** La moitié configuration, c'est celle sur laquelle la plupart de la documentation se concentre : choisir les bonnes politiques d'accès conditionnel, mettre les bonnes règles de conformité Intune, activer la Token Protection. La moitié observation, c'est ce qui sauve vraiment les clients : regarder une alerte et se demander « attendez, pourquoi *cet* utilisateur s'est-il connecté depuis *ce* pays à *cette* heure? ». Panoptica365 existe pour rendre la moitié observation gérable. La moitié configuration reste votre responsabilité.

## Ce qu'il faut retenir

Si vous ne devez retenir qu'une chose : la question « est-ce permis? » n'a plus de réponse oui/non. Elle a une réponse qui dépend de *qui*, *quoi*, *où*, *quand* et *à quel point ça a l'air bizarre*. Le travail de M365 est de répondre à cette question pour chaque requête. Votre travail, comme opérateur, est de vous assurer qu'il est configuré pour bien y répondre — et de remarquer quand ses réponses cessent d'avoir l'air correctes.

Le reste de cette carte trace la carte du territoire :

- **Les cinq surfaces que M365 sécurise** — identité, terminaux, courriel, collaboration, applications infonuagiques. Ce qu'est chacune, à quelles menaces chacune fait face.
- **Defender, Intune, accès conditionnel — comment ils s'imbriquent vraiment** — la boucle de conformité et où chacun vit.
- **Defender XDR — ce que c'est, ce que ce n'est pas** — XDR vs EDR vs SIEM, et pourquoi la plupart des MSP n'ouvrent jamais le portail Defender.
- **Les licences Microsoft 365 — qu'est-ce qui débloque quoi** — parce que la moitié des contrôles dont on va parler sont conditionnés à des SKU précis.
- **Où Panoptica365 s'installe dans le tableau** — ce qu'on surveille, ce qu'on ne touche pas, et pourquoi on ne corrige pas automatiquement.

Après ça, la carte 2 (*Menaces identitaires et patrons d'attaque*) creuse en profondeur les attaques qu'on a esquissées plus haut. Ensuite, on rentre dans les vrais contrôles.

Pour l'instant : arrêtez de penser à des murs. Commencez à penser à des fobs.

---

*Sources des données dans cette leçon — Microsoft Identity Security Group sur le blocage par MFA de 99,9 % des compromissions de compte automatisées ([Weinert, août 2019](https://techcommunity.microsoft.com/blog/microsoft-entra-blog/your-pa%24%24word-doesn%E2%80%99t-matter/731984)); Microsoft Defender Threat Intelligence rapportant une hausse de 146 % des attaques AiTM en 2024 ([Microsoft Security Blog](https://www.microsoft.com/en-us/security/blog/), 2025); paysage des kits Evilginx / Muraena / Modlishka et référence de détection : [Jeffrey Appel — AiTM/MFA phishing attacks in combination with new Microsoft protections, 2026 edition](https://jeffreyappel.nl/).*
