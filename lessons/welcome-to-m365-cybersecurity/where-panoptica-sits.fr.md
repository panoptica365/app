---
title: "Où Panoptica365 s'installe dans le tableau"
subtitle: "Panoptica365 ne remplace pas Defender — c'est la couche de surveillance et de triage à l'échelle de la flotte que les MSP n'avaient pas au-dessus des portails mono-tenant de Microsoft."
icon: "map-pin"
last_updated: 2026-05-29
---

# Où Panoptica365 s'installe dans le tableau

*« On a déjà Defender. Pourquoi on paie pour Panoptica365? »*

Vous allez recevoir cette question. De la part des clients. De la part de nouveaux opérateurs dans votre propre MSP. Peut-être de vous-même, après une session de 90 minutes dans Defender XDR qui n'a produit aucun élément actionnable. C'est une question légitime, et la réponse est plus intéressante que « on surveille plus de choses ».

Panoptica365 n'est pas un remplacement pour Defender XDR, l'accès conditionnel, Intune, ou n'importe quel autre produit Microsoft. C'est une couche qui s'installe *au-dessus* d'eux, conçue pour un seul travail : rendre la tâche quotidienne de l'opérateur, sur une flotte de tenants clients, gérable.

Cette leçon, c'est ce que ça veut dire en pratique — ce que Panoptica365 surveille, ce qu'il *ne fait pas* délibérément, pourquoi, et où le produit s'insère dans le rythme quotidien du travail d'un opérateur.

## Les quatre travaux d'un opérateur M365

Prenez un pas en arrière des produits pour un moment. Un opérateur MSP qui travaille sur M365 a quatre travaux, à peu près dans cet ordre de fréquence :

1. **Remarquer quand quelque chose a changé** dans un tenant client qui n'aurait pas dû changer.
2. **Trier les alertes** d'à travers plusieurs tenants et décider lesquelles ont besoin d'action aujourd'hui.
3. **Appliquer des contrôles** quand un client a besoin d'une nouvelle politique, d'un nouveau modèle, d'une nouvelle base de conformité.
4. **Criminalistique** quand quelque chose a mal tourné et qu'on a besoin de comprendre ce qui s'est passé.

Microsoft a construit de l'outillage de classe mondiale pour le **travail 4** — Defender XDR est excellent pour la criminalistique, surtout pour un utilisateur, un appareil, un incident à la fois.

Microsoft a construit de l'outillage raisonnable pour le **travail 3** — le portail Intune, l'éditeur de politiques d'accès conditionnel, le centre d'administration Exchange. Ils fonctionnent, à la manière dont les logiciels des années 1990 fonctionnaient. Vous pouvez gérer un client comme ça; vous passerez juste beaucoup de temps à cliquer.

Là où Microsoft n'a pas construit grand-chose, c'est sur les **travaux 1 et 2** — *remarquer et trier à l'échelle de la flotte*. Les portails sont mono-tenant. Les tableaux de bord présument que vous vivez à l'intérieur du portail d'un seul client à la fois. Les fonctions multi-tenant pour MSP de Defender XDR sont un ajout récent et ne sont pas encore ce que vous construiriez si vous partiez de « un MSP gère 30 clients et a besoin d'un écran pour les regarder ».

Panoptica365 est le produit qu'on a construit parce que *les travaux 1 et 2 n'étaient pas gérables à l'échelle MSP avec ce que Microsoft livre*.

## Ce que Panoptica365 surveille vraiment

Concrètement, à travers chaque tenant connecté :

**Identité et accès conditionnel.** Application du MFA par utilisateur, patrons de connexion (IP étrangère, déplacement impossible), dérive des politiques d'AC (un modèle que vous avez déployé hier a l'air différent aujourd'hui), changements d'affectation d'AC, changements d'emplacement nommé, changements d'enregistrement des méthodes d'authentification.

**Modèles Intune et conformité.** Dérive des modèles, dérive des politiques de conformité, patrons d'inscription d'appareils, trous de couverture EDR.

**Posture de sécurité Exchange Online.** Préréglage anti-hameçonnage, posture d'audit des boîtes aux lettres, changements de règles de boîte, transfert au niveau boîte, configuration de Safe Links et Safe Attachments, changements de règles de flux de courriel.

**Partage SharePoint et OneDrive.** Posture de partage externe, liens anonymes, patrons d'accès des invités, inventaire des permissions de site.

**Ingestion Unified Audit Log + Defender XDR.** 25 évaluateurs de détection à travers le flux UAL et les incidents Defender XDR — patrons de credential stuffing, chaînes de connexion suspectes, consentements OAuth, accords de permission de boîte aux lettres, anomalies de code d'appareil, indicateurs de BEC, comportement de mise en scène de rançongiciel.

**Secure Score.** Instantané quotidien, tendance, comparaison contre des bases de référence de l'industrie.

**Moteur de paramètres de sécurité.** 17 paramètres de sécurité Microsoft spécifiques surveillés pour la dérive contre une base de référence que vous définissez — contenu des listes anti-hameçonnage, configurations des méthodes d'authentification, état des politiques DLP, et d'autres.

C'est le catalogue d'aujourd'hui. Il bouge. La plupart de la carte 2 (*Menaces identitaires*) se cartographie directement sur des évaluateurs spécifiques de cette liste. Quand on dit qu'une carte « couvre » un patron d'attaque, ce qu'on veut dire, c'est : cette attaque déclenche un ou plusieurs de ces évaluateurs, l'alerte arrive dans Panoptica365, et vous agissez dessus de là.

## Ce que Panoptica365 ne fait pas délibérément

Cette partie est plus importante que le catalogue ci-dessus, parce que c'est ce qui rend Panoptica365 différent d'Inforcer, Octiga, 365Sentri et des autres produits de type forceur de politique dans cet espace.

**On ne remédie pas automatiquement.** Panoptica365 ne va pas pousser des changements dans le tenant M365 d'un client de sa propre initiative. Quand quelque chose dérive, on vous dit ce qui a dérivé et on recommande une correction. On n'exécute pas la correction.

Pourquoi : le mode d'échec de la remédiation automatique, c'est de livrer une base de référence mal configurée à 2 h du matin à travers 30 tenants. Récupérer de ça, c'est beaucoup pire que le travail supplémentaire marginal d'un opérateur qui clique « appliquer ». La garantie « on ne brisera jamais vos clients » fonctionne seulement si on garde les mains hors du volant.

**On ne lance pas d'actions destructrices à l'intérieur du portail Microsoft à votre place.** Il n'y a pas de bouton « désactiver l'utilisateur » dans Panoptica365, pas de bouton « réinitialiser le mot de passe », pas de bouton « révoquer la session ». Ces actions existent dans les portails Microsoft; on vous redirige directement à l'endroit où l'action vit, et c'est vous qui prenez la décision.

Pourquoi : même logique. Envelopper les actions destructrices de Microsoft dans une UI tierce, c'est un incident client qui attend de se produire. Lecture-seule par conception.

**On n'est pas un SIEM.** Panoptica365 n'ingère pas de journaux de pare-feu, de journaux d'applications tierces, ou de télémétrie non-Microsoft. Si un client a besoin de ça, la réponse est Microsoft Sentinel (leçon 4) ou un SIEM dédié, pas Panoptica365.

**On ne remplace pas Defender XDR.** Quand une chaîne d'attaque se déroule et que vous avez besoin de plonger dans la chronologie de session d'un utilisateur, c'est un travail de Defender XDR. Panoptica365 fait remonter l'existence de la chaîne; Defender XDR vous montre l'intérieur. Les deux outils sont conçus pour être utilisés ensemble, pas en compétition.

**On n'est pas une offre de services gérés.** Panoptica365 est un produit. Il n'y a pas d'équipe SOC Panoptica365 qui gère les alertes à votre place. (Augmentt vend ça séparément; Acronis vend Octiga comme ça. Pas nous.) Le travail de l'opérateur reste le travail de l'opérateur.

## Comment Panoptica365 s'inscrit dans la journée de l'opérateur

Le rythme quotidien réaliste pour un opérateur MSP qui utilise Panoptica365 :

**Matin.** Ouvrez Panoptica365. Le tableau de bord principal vous montre, à travers tous les tenants clients, quelles alertes se sont déclenchées pendant la nuit, quelle dérive a été détectée, à quoi ressemblent les incidents Defender XDR. Le courriel de briefing matinal résume ça en 30 secondes de lecture; le tableau de bord, c'est pour les éléments qui ont besoin d'attention.

**Triage.** Cliquez dans une alerte spécifique. Le panneau coulissant d'alerte vous donne le détail structuré (qui, quoi, quand), l'analyse IA (explication générée par Haiku adaptée au palier de licence du client), l'explicateur lié (l'icône de chapeau de finissant — le cousin en-contexte de ce programme), et la prochaine action recommandée. Du panneau coulissant, vous décidez : acquitter, exempter, ou ouvrir le portail Microsoft pertinent pour enquêter et agir.

**Appliquer.** Quand un client a besoin d'une nouvelle politique — un modèle d'AC, une politique de conformité Intune, un paramètre EXO — vous le déployez depuis la bibliothèque de modèles de Panoptica365. Panoptica365 *écrit* ici, mais seulement pour des actions que l'opérateur a explicitement choisies et seulement avec piste d'audit complète.

**Criminalistique.** Quand un incident demande une vraie enquête, vous quittez Panoptica365 et allez dans Defender XDR. Le travail de Panoptica365 à ce moment-là, c'est d'avoir rendu évident le fait que l'enquête était nécessaire.

**Documentation.** Panoptica365 garde un Journal de Changements de Tenant par client (chaque action d'opérateur), un Journal d'Audit MSP à travers tous les opérateurs (qui a fait quoi, quand, depuis quel rôle), et un registre d'Exemptions (quand une alerte a été délibérément supprimée pour une raison). La plupart du travail pour « montrez-moi ce qui a changé dans les 30 derniers jours », « qu'est-ce que l'équipe d'audit avait besoin de voir » ou « quelle est la preuve qu'on a fait notre travail » vit dans ces trois vues.

## La posture « préventif par conception »

Panoptica365 a une posture philosophique que les autres produits dans cette catégorie ne partagent pas en majorité : on croit que l'opérateur devrait être dans la boucle de chaque changement au tenant d'un client.

Ça se manifeste comme une constellation de choix de conception :

- **Lecture-seule par défaut.** On peut tout surveiller; on modifie seulement ce que l'opérateur demande explicitement.
- **Les exemptions sont de première classe.** Quand un contrôle ne s'applique pas à un client (raisons réglementaires, raisons de modèle d'affaires, raisons techniques), l'opérateur enregistre une exemption avec une justification et une date d'expiration. Les opérateurs futurs voient la justification.
- **Mutations journalisées en audit.** Chaque changement que Panoptica365 fait à un tenant client est journalisé avec l'identité de l'opérateur, son rôle, et sa raison. Si vous n'avez pas fait le changement, vous pouvez le prouver. Si vous l'avez fait, vous pouvez montrer votre travail.
- **Pas de corrections silencieuses.** Quand Microsoft fait quelque chose qui re-crée la dérive (un changement par défaut côté Microsoft, par exemple), l'opérateur reçoit une alerte. On ne « re-base » pas silencieusement — ce serait effacer la visibilité sur ce que Microsoft a fait, et cette visibilité, c'est tout l'enjeu.

La compétition n'est pas d'accord avec cette posture, et c'est un désaccord légitime. Les boutiques d'auto-remédiation croient que le risque marginal d'un mauvais changement est compensé par le travail économisé sur les corrections de routine. Elles pourraient avoir raison pour certains clients; elles ont définitivement tort pour d'autres. Panoptica365 est le bon outil pour les MSP dont la clientèle ne tolère pas « on a brisé quelque chose à 2 h du matin » comme mode d'échec acceptable.

## Comment les MSP intelligents facturent Panoptica365

Un conseil de modèle d'affaires qui devrait vous parvenir plutôt tôt que tard : Panoptica365 est un outil pour rendre votre MSP meilleur à protéger les clients — pas un produit à vendre directement à ces clients.

Quand votre MSP adopte Panoptica365, le coup intelligent, c'est d'intégrer le coût dans vos frais mensuels existants par utilisateur ou par appareil. Ne le mettez pas en ligne distincte sur la facture du client. À environ 1 $ par utilisateur par mois, c'est un petit coût absorbable à l'intérieur d'un service que vous facturez déjà. Le mettre en ligne distincte crée deux conversations que vous ne voulez pas : le client demande « qu'est-ce que Panoptica365? » — et là vous devez expliquer un outil qui était censé être invisible — et il pourrait essayer de le négocier vers la sortie — *« on n'a pas besoin d'un outil de surveillance de sécurité, non? »* Ces deux conversations rendent votre MSP plus faible, pas plus fort.

Le pitch au client reste simple : « on surveille votre sécurité M365 en continu, on trie les alertes quotidiennement, on rapporte sur la posture mensuellement, on déploie et révise les modèles de politiques ». Panoptica365 est le *comment*. Le client paie pour le *quoi*. Il n'a pas besoin de voir la marque pour en bénéficier.

C'est aussi pourquoi notre propre marketing penche côté MSP, pas côté client final. On n'essaie pas d'être un nom reconnu pour le directeur financier de votre client. On essaie d'être l'outil que l'opérateur ouvre tranquillement chaque matin pour rendre la journée gérable.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir pour le travail quotidien.

**Panoptica365 vous dit que quelque chose a besoin d'attention; les outils Microsoft vous disent quoi faire à ce sujet.** Le relais est intentionnel. Quand vous cliquez « ouvrir dans Defender » depuis une alerte, vous n'abandonnez pas Panoptica365; vous l'utilisez comme prévu.

**Lecture-seule est la fonctionnalité, pas la limitation.** Quand le RSSI d'un client demande « qu'est-ce que Panoptica365 fait à notre tenant? », la réponse est : rien que l'opérateur n'ait approuvé. C'est une position vendable dans les industries réglementées et les clients de milieu de marché averses au risque.

**Documenter la moitié « remarquer », c'est la moitié du travail.** Chaque alerte acquittée, chaque exemption accordée, chaque modèle déployé est enregistré. Si vous avez besoin de démontrer la diligence raisonnable — à un auditeur, à un assureur, à un client dans une conversation de renouvellement — le journal d'audit et le journal de changements sont là où vivent les preuves. Utilisez-les. Référez-y-vous dans les rapports clients.

## Ce qui suit

Vous avez fini la carte d'accueil. La carte du territoire est tracée.

Ensuite, c'est **la carte 2 : Menaces identitaires et patrons d'attaque**, où on marche à travers les six attaques spécifiques que Panoptica365 a été construit pour faire remonter — credential stuffing, fatigue MFA, hameçonnage AiTM, hameçonnage par consentement OAuth, abus de code d'appareil, et les patrons BEC qui suivent la compromission. À la fin de la carte 2, chaque alerte dans votre file devrait se mapper à un de ces six (ou, occasionnellement, plusieurs à la fois).

Après ça, les cartes de contrôles : Accès conditionnel (carte 3), Intune (carte 4), Renforcement du courriel (carte 5), et Secure Score (carte 6).

Pour l'instant : Panoptica365 est la couche qui rend « gérer 30 tenants » gérable sans enlever le travail de Microsoft à Microsoft. Les menaces de la carte 2 vont arriver dans votre file. Votre travail, comme opérateur, c'est de remarquer. Le nôtre, comme outil, c'est de rendre le fait de remarquer facile.
