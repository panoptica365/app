---
title: "Fatigue MFA — l'histoire d'Uber"
subtitle: "Comment les attaquants inondent les utilisateurs de notifications push jusqu'à ce qu'ils en approuvent une — et pourquoi le MFA par push est ingénierable."
icon: "bell-ring"
last_updated: 2026-05-29
---

# Fatigue MFA — l'histoire d'Uber

Le 15 septembre 2022, un contractuel de 18 ans chez Uber a tapé « Approuver » sur une notification push Microsoft Authenticator à la maison, tard en soirée, après que son téléphone ait vibré pendant environ une heure. Il n'était pas en train de se connecter à quoi que ce soit. L'attaquant à l'autre bout du prompt lui a ensuite envoyé un message WhatsApp prétendant être de Uber IT, lui disant que les notifications push allaient s'arrêter s'il en approuvait juste une.

Il a approuvé.

Le matin venu, l'attaquant — identifié plus tard comme faisant partie du groupe Lapsus$ — était passé de cette unique approbation de push à un accès en lecture sur le Slack interne d'Uber, la console AWS, l'admin Google Workspace, la plateforme de bug bounty HackerOne, et le code source de la compagnie. L'intrusion est devenue publique quand l'attaquant a commencé à poster des captures d'écran dans les canaux Slack d'ingénierie d'Uber pour annoncer qu'il était là.

Ça, c'est la fatigue MFA. L'incident Uber est l'étude de cas canonique, et le patron d'attaque est bien vivant en 2026.

Cette leçon, c'est pourquoi le MFA basé sur push est socialement ingénierable, ce que font (et ne font pas) le number matching et le contexte additionnel, et comment pousser les clients vers des méthodes d'authentification qui ne peuvent pas être fatiguées.

## Ce qui se passe vraiment

La fatigue MFA (aussi appelée « bombardement MFA » ou « push bombing ») demande que l'attaquant ait déjà le mot de passe de l'utilisateur. Souvent ça vient d'un dump d'identifiants (leçon 1). Le prompt MFA est la seule chose entre l'attaquant et le compte.

La mécanique de l'attaque est embarrassante de simplicité :

1. L'attaquant a un nom d'utilisateur + mot de passe. Les entre dans `login.microsoftonline.com`.
2. Entra ID demande le MFA — envoie une notification push au téléphone de l'utilisateur via Microsoft Authenticator.
3. L'utilisateur voit le prompt, sait qu'il n'a pas essayé de se connecter, le rejette.
4. L'attaquant entre le mot de passe à nouveau. Un autre push.
5. L'attaquant répète. Cinq pushs. Dix. Vingt. L'utilisateur dort à 2 h du matin, ou est en réunion, ou est juste épuisé.
6. Éventuellement, l'utilisateur soit clique « Approuver » par erreur au lieu de « Refuser », soit abandonne et approuve pour faire taire les vibrations, soit l'attaquant ajoute une couche d'ingénierie sociale (« Salut, c'est IT, le système buggue, approuve juste pour qu'on puisse finir le test »).
7. L'attaquant est dedans.

Toute l'attaque n'a *aucune sophistication technique*. Elle fonctionne parce que les humains se fatiguent et s'énervent, et parce que le binaire rejeter-ou-approuver ne communique aucun contexte.

## Pourquoi ça marche spécifiquement contre les notifications push

Trois saveurs de MFA existent dans M365, et l'attaque de fatigue marche sur exactement une d'elles.

**MFA par SMS / appel téléphonique.** Pas vulnérable à la fatigue de la même façon — l'attaquant peut composer le numéro de l'utilisateur une fois par tentative, mais des appels répétés rapides déclenchent la détection d'abus au niveau de l'opérateur et ne sont pas gratuits. Le SMS a *d'autres* problèmes (échange de SIM, interception) qui en font la méthode MFA la plus faible en général, mais la fatigue n'en fait pas partie.

**MFA par notification push (le défaut Authenticator).** Vulnérable. Pousser une notification est gratuit pour Microsoft, donc un attaquant peut en lancer des douzaines par minute. L'utilisateur voit `Approuver / Refuser` avec peut-être un nom d'utilisateur et un nom d'application. On lui demande de prendre une décision oui/non basée sur près-de-zéro contexte.

**Number matching + contexte additionnel.** Notifications push, mais l'utilisateur doit taper un nombre à deux chiffres montré sur l'écran de connexion dans l'application Authenticator, et le prompt montre maintenant le nom de l'application demandant l'accès plus la localisation géographique de la tentative de connexion. *C'est maintenant le défaut Microsoft* pour Authenticator et ça l'est depuis 2023.

**MFA résistant à l'hameçonnage (clés FIDO2, passkeys, Windows Hello for Business, basé sur certificat).** Pas vulnérable à la fatigue du tout. L'utilisateur doit physiquement toucher la clé, présenter son visage, ou insérer une carte à puce. Il n'y a pas de « taper pour approuver » — l'opération cryptographique demande une présence. On va passer la leçon 3 de cette carte à montrer pourquoi le MFA résistant à l'hameçonnage compte aussi pour l'AiTM.

## Le number matching résout-il vraiment ça?

Le number matching rend l'attaque plus difficile, pas impossible. Trois choses changent :

**L'utilisateur doit activement lire un nombre de l'écran de connexion et le taper dans son application Authenticator.** Cliquer « Approuver » par erreur ne marche plus — il n'y a plus de bouton Approuver à mal cliquer. L'utilisateur doit faire quelque chose *d'intentionnel*. Ça tue le mode d'échec « j'étais tourné dans mon lit et j'ai tapé Oui ».

**Le contexte additionnel montre le nom de l'application et la localisation géographique.** « Connexion depuis Microsoft Outlook à Bucarest, Roumanie » devrait sonner l'alarme même pour un utilisateur fatigué à Montréal. (Si ça le fait vraiment dépend de l'attention de l'utilisateur à 2 h 14 du matin, mais au moins l'information est là.)

**L'attaquant doit maintenant une couche d'ingénierie sociale.** Sans number matching, l'attaque est purement mécanique — push, répéter, attendre. Avec number matching, l'attaquant doit *parler* à l'utilisateur pour le faire taper le nombre. Ça veut généralement dire un message WhatsApp, un message Teams, ou un appel téléphonique prétendant être de IT.

Donc le number matching convertit la fatigue MFA d'une attaque d'agacement pure en une qui demande de l'ingénierie sociale. C'est une vraie amélioration. C'est aussi pourquoi chaque campagne en 2025 et 2026 qui frappe un tenant avec number matching arrive empaquetée avec un prétexte d'ingénierie sociale — exactement ce qui est arrivé à Uber.

Ce que le number matching ne fait *pas* : rendre l'utilisateur immunisé à un pitch d'ingénierie sociale convaincant. Si l'attaquant peut simuler un appel d'aide IT assez bien pour que l'utilisateur tape activement le code à deux chiffres, l'attaque marche encore. Le number matching élève la barre; il n'élimine pas la classe.

## À quoi ça ressemble dans la télémétrie M365

Quand la fatigue MFA est en cours, Microsoft voit :

- **Une rafale de tentatives de connexion échouées sur un compte**, toutes avec le bon mot de passe (parce que l'attaquant a le mot de passe) mais sans complétion MFA. Ça apparaît dans le journal de connexion Entra avec le résultat « Défi MFA requis, non complété ».
- **Une connexion réussie immédiatement après la rafale**, quand l'utilisateur finit par approuver.
- **Souvent, de l'activité de suivi depuis un nouvel appareil** — l'attaquant se connecte maintenant depuis sa propre machine en utilisant la session approuvée par MFA.

Entra ID Protection (P2 seulement, E5) peut noter ce patron comme suspect et déclencher des contrôles d'AC basés sur le risque. À Business Premium (P1), le patron de rafale-de-MFA-échoués ne génère pas automatiquement une alerte Microsoft à haute confiance, mais la connexion *réussie* depuis un nouveau pays ou un nouvel appareil devrait quand même déclencher les détecteurs d'IP étrangère et de déplacement impossible de Panoptica365.

Defender XDR peut aussi plier ces signaux en un incident si l'utilisateur va faire quelque chose de bruyant après — enregistrer un nouvel appareil MFA, créer une règle de boîte, s'envoyer un courriel à une adresse Gmail. C'est le patron BEC de la leçon 6.

## Ce que Panoptica365 voit

Trois signaux de la fatigue MFA :

**La rafale de tentatives de connexion échouées en quasi-temps-réel** via le widget Activité quotidienne sur le tableau de bord du tenant. Le graphique en anneau se rafraîchit à peu près toutes les 15 minutes et montre la répartition des résultats de connexion — authentifications réussies, authentifications échouées, et blocages d'accès conditionnel. Pendant une attaque de fatigue MFA, la tranche authentifications-échouées de l'anneau gonfle visiblement. Surveillez les pointes soudaines concentrées sur *un utilisateur ou un petit groupe* — c'est le patron de fatigue MFA. Distribué-sur-plusieurs-utilisateurs, c'est le credential stuffing (leçon 1); concentré-sur-un-utilisateur, c'est la fatigue MFA ou une attaque ciblée d'identifiants.

**La connexion réussie elle-même.** Quand l'utilisateur finit par approuver et que l'attaquant entre — typiquement depuis une IP étrangère ou en proximité de déplacement impossible avec l'utilisateur légitime — l'alerte se déclenche dans votre file.

**L'activité de suivi.** Création de règles de boîte, transfert de boîte, accords de permission de boîte, parfois nouvelles attributions de rôle d'admin — ces actions post-compromission sont typiquement plus bruyantes que l'événement de connexion lui-même. La leçon 6 sur le BEC les couvre en détail.

Distinguer la fatigue MFA du credential stuffing et de l'AiTM compte pour le rapport d'incident du client. Dans la fatigue MFA, le journal de connexion Entra va montrer une rafale de défis MFA qui n'ont pas été complétés, suivis d'un qui l'a été — et l'anneau Activité quotidienne de Panoptica365 aura déjà montré la pointe d'authentifications-échouées en quasi-temps-réel. Dans le credential stuffing, le mot de passe a fonctionné sans que le MFA soit requis (parce que l'utilisateur n'avait pas de MFA inscrit). Dans l'AiTM (leçon 3), le MFA *a été* complété par l'utilisateur, juste sur un faux site. La remédiation est similaire dans les trois; les leçons apprises sont différentes.

## Défendre contre la fatigue MFA

Défenses, classées par impact :

**Migrer les utilisateurs vers un MFA résistant à l'hameçonnage.** Passkeys, clés de sécurité FIDO2, Windows Hello for Business. Aucun de ceux-là ne peut être fatigué — ils demandent une interaction physique que l'attaquant ne peut pas répliquer. La migration est graduelle (les utilisateurs doivent inscrire des passkeys), mais chaque utilisateur qui passe est entièrement retiré de la surface d'attaque. C'est aussi la bonne réponse pour le problème AiTM de la leçon 3, donc le travail se cumule.

**S'assurer que le number matching est activé** pour tout tenant qui utilise encore le push Authenticator. C'est le défaut Microsoft depuis 2023, mais les tenants plus vieux ou les tenants avec politiques personnalisées peuvent l'avoir désactivé. Vérifier via la politique de méthodes d'authentification Entra ID. Le moteur de paramètres de sécurité de Panoptica365 surveille ça.

**Former les utilisateurs des clients à *ne jamais* approuver un prompt qu'ils n'ont pas initié.** Ça sonne évident. Ça ne l'est pas. La version la plus efficace de cette formation, c'est une feuille d'une page qui inclut la ligne « Microsoft ne vous appellera jamais pour vous demander d'approuver un prompt de connexion. » Mettez ça dans l'accueil des nouveaux utilisateurs. Rafraîchissez trimestriellement.

**Configurer des alertes pour les événements inhabituels d'enregistrement MFA.** Quand un attaquant fatigue avec succès un utilisateur, la prochaine chose qu'il fait souvent, c'est *enregistrer son propre appareil MFA* — pour ne pas avoir à fatiguer l'utilisateur de nouveau plus tard. Le journal d'audit Entra capture ça comme un événement « Méthode d'authentification enregistrée ». C'est un des signaux à plus haute valeur pour attraper une compromission *pendant que l'attaquant n'a encore qu'un point d'appui*.

**Sur les clients réglementés, exiger un MFA résistant à l'hameçonnage via des politiques de force d'authentification d'accès conditionnel.** « Exiger un MFA résistant à l'hameçonnage pour l'accès aux systèmes financiers » est une politique d'AC disponible dans Entra ID P1 (Business Premium et au-dessus). C'est comme ça qu'on protège les utilisateurs à haute valeur sans forcer tout le tenant à passer aux passkeys du jour au lendemain.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**Une connexion réussie qui suit une rafale de tentatives MFA échouées est une compromission.** Traitez-la comme telle. Désactivez les sessions actuelles de l'utilisateur, forcez une réinitialisation de mot de passe, exigez un nouvel enregistrement MFA, auditez l'activité récente de la boîte aux lettres. N'attendez pas que le patron BEC se développe avant de répondre.

**L'application Authenticator, c'est bon. Les notifications push via l'application Authenticator sont plus faibles que les passkeys.** C'est une distinction réelle et signifiante, et vous devriez être à l'aise de la faire dans les conversations avec les clients. Le client qui insiste qu'il « a déjà du MFA, tout le monde utilise l'app » surestime la protection. Le number matching aide; les méthodes résistantes à l'hameçonnage résolvent.

**Les comptes de service n'ont presque jamais besoin de mitigation de fatigue MFA, parce que les comptes de service n'ont presque jamais de MFA du tout.** C'est son propre problème (couvert dans la leçon 1, en passant). Les comptes de service compromis via credential stuffing ne se font pas fatiguer; ils se font juste utiliser. Mais la leçon liée est la même : partout où il y a un compte sans authentification résistante à l'hameçonnage, la fatigue MFA (ou pire) est sur la table.

## Ce qui suit

- **Leçon 3 : Hameçonnage AiTM.** Le contournement technique du MFA. Là où la fatigue trompe l'utilisateur en lui faisant approuver un vrai prompt, l'AiTM trompe l'utilisateur en lui faisant approuver un prompt sur un *faux site qui fait office de proxy de la vraie connexion Microsoft*. L'attaquant capture le cookie de session au lieu de combattre le MFA du tout.
- **Leçon 6 : BEC.** Le dénouement de toute compromission réussie des leçons 1, 2 et 3 — ce que l'attaquant fait vraiment une fois qu'il est dedans.

Pour l'instant : la fatigue MFA est le contournement par ingénierie sociale du MFA. Elle fonctionne parce que les notifications push sont conçues pour être tapées rapidement. Le number matching la rend plus difficile mais pas impossible. La vraie réponse, ce sont les méthodes résistantes à l'hameçonnage, et le travail pour migrer les clients vers elles commence le jour où vous prenez cette leçon au sérieux.

---

*Sources des données dans cette leçon — aperçu de l'incident Uber de septembre 2022 ([Uber Newsroom — Security update](https://www.uber.com/newsroom/security-update/)); attribution Lapsus$ et analyse du modus operandi ([Microsoft Security Blog — DEV-0537 / Lapsus$](https://www.microsoft.com/en-us/security/blog/2022/03/22/dev-0537-criminal-actor-targeting-organizations-for-data-exfiltration-and-destruction/)); déploiement par défaut du number matching Microsoft Authenticator ([Microsoft Learn — Number matching for Microsoft Authenticator](https://learn.microsoft.com/en-us/entra/identity/authentication/how-to-mfa-number-match)); politiques de force d'authentification Entra ID ([Microsoft Learn — Conditional Access authentication strengths](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-strengths)).*
