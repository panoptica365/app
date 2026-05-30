---
title: "La boucle de conformité en production — dérive, signaux et quoi surveiller"
subtitle: "Comment le signal de conformité Intune→Entra→AC se comporte réellement en production : délais, modes d'échec et ce que Panoptica365 expose."
icon: "repeat"
last_updated: 2026-05-29
---

# La boucle de conformité en production — dérive, signaux et quoi surveiller

La leçon 3 de la carte 1 a décrit la boucle de conformité comme un diagramme en cinq étapes : Intune met la politique sur l'appareil → l'appareil rapporte l'état → Intune écrit la conformité dans Entra → l'AC lit la conformité → l'AC décide. Propre et abstrait.

En production, la boucle est plus brouillonne. Les appareils tombent hors ligne et la boucle se met en pause. Les politiques se mettent à jour et les appareils prennent des heures pour se réévaluer. L'évaluation de conformité dépend de signaux qui dépendent eux-mêmes d'autres signaux (Defender doit rapporter en santé *et* les signatures doivent être courantes *et* le pare-feu doit être actif...). Quand quelque chose brise, la question est rarement « est-ce que la boucle de conformité est brisée? » — c'est « *laquelle* des douze choses qui peuvent mal tourner a mal tourné? »

Cette leçon parcourt comment la boucle de conformité se comporte vraiment en production : d'où viennent les signaux, à quelle fréquence ils se mettent à jour, à quoi ressemblent les modes d'échec, et comment Panoptica365 fait surface les patrons qui comptent.

## Le flux de signal, avec timing

L'état de conformité visible sur une politique d'AC au moment de la connexion a voyagé à travers plusieurs systèmes avec leurs propres cadences de mise à jour :

1. **L'appareil évalue son propre état** contre la politique de conformité assignée. Sur Windows, ça se passe typiquement au démarrage de l'appareil, à l'ouverture de session de l'utilisateur, à la synchronisation Intune (aux 8 heures par défaut), et sur demande si l'utilisateur ou l'admin déclenche une synchronisation. Les plateformes mobiles ont des cadences similaires mais séparées.
2. **L'appareil rapporte son état de conformité à Intune.** C'est l'appel réseau de l'appareil → Intune. Demande que l'appareil soit en ligne; se met en file si hors ligne.
3. **Intune écrit l'attribut de conformité dans le dossier d'appareil Entra ID.** C'est une étape de synchronisation Intune → Entra. Typiquement quasi-temps-réel quand les deux services sont en santé mais peut accuser un retard pendant les périodes de haute charge.
4. **L'AC lit le dossier d'appareil Entra à la connexion.** C'est le moment d'évaluation. L'AC regarde l'état de conformité courant de l'appareil dans Entra.

Le décalage cumulatif entre « l'état de l'appareil change » et « l'AC reflète le nouvel état à la connexion » peut être de n'importe où entre secondes et environ 8 heures, selon où dans le cycle le changement arrive. Pour la plupart des scénarios opérationnels, le décalage est dans la plage minutes-à-heures.

Ça compte parce que les utilisateurs rapportent parfois « j'ai réglé le problème mais je suis encore bloqué » — et la réponse est habituellement « le signal ne s'est pas encore propagé; réessayez dans 30 minutes ». Connaître le timing vous aide à mettre les attentes des utilisateurs correctement.

## Les modes d'échec

La boucle brise de façons identifiables. Chacune a une remédiation différente.

### « Pas encore évalué »

Un appareil affiche l'état de conformité « Pas encore évalué » dans le dossier d'appareil Entra. Il y a quatre raisons distinctes pour lesquelles ça peut arriver, et elles demandent des réponses différentes :

- **L'appareil est tout nouveau dans Intune** — vient juste d'être inscrit, la première évaluation n'est pas complétée. Va se résoudre tout seul dans le premier cycle de synchronisation de 8 heures.
- **L'appareil n'a pas synchronisé avec Intune depuis longtemps** — probablement hors ligne. Va se résoudre quand l'appareil revient en ligne et se resynchronise.
- **Le client Intune de l'appareil est brisé et ne synchronise pas.** Va *ne pas* se résoudre tout seul — a besoin d'intervention de l'opérateur (forcer la synchronisation, réparer le client, ou réinscrire).
- **L'appareil n'est pas vraiment géré par Intune du tout.** L'exemple classique : un serveur Windows qui est intégré dans Microsoft Defender for Endpoint mais jamais inscrit dans Intune. Le serveur apparaît dans la liste des appareils gérés Intune parce qu'Entra le connaît, mais il n'a pas de politique de conformité Intune assignée et n'obtiendra jamais de verdict de conformité peu importe combien de temps vous attendez. Pareil pour les appareils enregistrés Entra mais non inscrits MDM, les appareils dans un état de confiance hybride où l'inscription MDM a échoué, et les appareils gérés par un MDM différent (rare en PME, mais possible). Ceux-ci apparaissent comme « non évalué » pour toujours — ce n'est pas un état transitoire, c'est un état structurel.

Les politiques d'AC traitent typiquement « Pas encore évalué » comme **non conforme**. C'est le défaut sécurisé — un appareil dont on ne connaît pas l'état ne devrait pas se voir accorder l'accès appareil-conforme. Les implications diffèrent par raison :

- Pour les deux premières raisons (transitoires), les utilisateurs peuvent être bloqués temporairement et l'accès se rétablit une fois l'évaluation complétée. Planifiez pour ça — l'intégration d'un nouvel appareil ne devrait pas arriver un vendredi après-midi si l'utilisateur a besoin de se connecter pendant la fin de semaine.
- Pour la troisième raison (client brisé), les utilisateurs restent bloqués jusqu'à ce que le problème sous-jacent soit réglé. Enquêtez par appareil.
- Pour la quatrième raison (non géré par Intune), l'appareil va *en permanence* échouer toute politique d'AC qui exige un appareil conforme. Ça ne compte habituellement pas pour les serveurs (ils ne se connectent pas à M365 de façon interactive), mais ça surprend occasionnellement un opérateur qui a mis une portée d'AC « exiger appareil conforme » qui inclut accidentellement des comptes de service qui roulent sur ces serveurs. Si vous voyez un compte de service bloqué par AC qui marchait hier, vérifiez si l'appareil sur lequel il roule est géré par Intune — sinon, la politique d'AC et l'état d'inscription de l'appareil sont fondamentalement incompatibles.

### « Non conforme » persistant

Un appareil affiche non conforme pendant des heures ou des jours et ne récupère pas. Causes :

- Un paramètre requis n'est vraiment pas en place. Defender est désactivé, BitLocker est désactivé, le pare-feu est désactivé. La vérification de conformité attrape correctement la brèche.
- Un paramètre requis est en place mais l'évaluation Intune le rapporte mal. Fréquent avec : signatures Defender brièvement périmées pendant une mise à jour, BitLocker temporairement désactivé pour une opération de récupération, pare-feu brièvement désactivé pendant un redémarrage de service.
- Le rapport de l'appareil est désynchronisé. L'appareil est vraiment bien mais son état auto-rapporté ne s'est pas rafraîchi.

Pour une non-conformité persistante qui dure plus de 24 heures, le flux, c'est :

1. Vérifier le portail Intune pour la raison spécifique d'échec. L'état de conformité montre *pourquoi* l'appareil est non conforme — quelle vérification spécifique a échoué.
2. Vérifier sur l'appareil lui-même. Utilisez `Get-MpComputerStatus` (PowerShell) pour l'état Defender, `manage-bde -status` pour BitLocker, l'UI Defender Firewall pour l'état du pare-feu.
3. Si l'appareil est vraiment non conforme, régler le problème sous-jacent. Réactiver Defender, compléter le chiffrement BitLocker, rallumer le pare-feu.
4. Si l'appareil est bien mais qu'Intune le rapporte mal, forcer une synchronisation (Paramètres → Comptes → Accéder au travail ou à l'école → Synchroniser, ou exécuter `dsregcmd /sync` dans PowerShell). Attendre 30 minutes pour que le nouvel état se propage.
5. Si la synchronisation ne le résout pas, le client Intune sur l'appareil peut avoir besoin d'être réparé ou réinscrit.

### Flottement de conformité

Un appareil bascule entre conforme et non conforme rapidement — aux quelques heures, à tous les jours, selon son propre horaire. C'est du « flottement » et c'est un des patrons les plus agaçants à diagnostiquer. Causes fréquentes :

- **Timing des signatures Defender.** Les signatures Defender expirent à une cadence régulière. Si la mise à jour arrive légèrement après l'évaluation de conformité, l'appareil bascule non conforme brièvement jusqu'à ce que la prochaine mise à jour de signature arrive.
- **Conflit de profil de configuration.** Deux profils de configuration Intune configurent le même paramètre différemment. L'appareil alterne entre les deux états selon lequel a été appliqué le plus récemment.
- **Désactivation initiée par l'utilisateur.** Un utilisateur avec des droits admin local désactive Defender (ou un autre service requis), la vérification de conformité l'attrape, l'appareil est non conforme. L'utilisateur rallume Defender (ou il redémarre automatiquement sur un horaire). L'appareil retourne à conforme. Répète.
- **Condition de course de timing de synchronisation.** L'évaluation de conformité tourne sur un horaire légèrement différent de l'application du profil de configuration. Un appareil qui est juste au bord d'un seuil peut basculer d'avant en arrière selon quelle vérification est arrivée le plus récemment.

Le flottement se règle habituellement en identifiant la cause sous-jacente. Le détecter aujourd'hui, c'est manuel — surveillez l'historique de conformité par appareil dans le portail Intune pour les appareils qui ont rebondi d'état plusieurs fois dans une courte fenêtre, et enquêtez sur ceux-là spécifiquement.

### Conforme mais brisé

Un appareil affiche conforme mais l'utilisateur ne peut pas se connecter à M365. La politique d'AC applique appareil conforme, l'appareil est conforme, et pourtant la connexion échoue. C'est rare mais ça arrive. Causes :

- **Objet d'appareil Entra périmé.** Le dossier d'appareil dans Entra est dupliqué ou orphelin d'inscriptions antérieures. L'AC lit un dossier d'appareil différent de celui auquel Intune rapporte.
- **Décalage d'état de confiance.** La jonction Azure AD hybride est brisée; l'appareil pense qu'il est joint hybride mais Entra a une vue différente.
- **Décalage de condition de politique d'AC.** La politique d'AC lit un signal de conformité spécifique qui est distinct de l'état de conformité général.

Pour ces cas, l'appareil a habituellement besoin d'être nettoyé — désinscrire et réinscrire Entra, réparer l'état de confiance, ou retirer le dossier d'appareil orphelin manuellement.

### Boucle de conformité brisée silencieusement

Le pire mode d'échec : la boucle semble fonctionner mais ne le fait pas. Un appareil est non conforme sur l'OS mais Intune le rapporte comme conforme. L'AC accorde l'accès. Personne ne remarque parce que rien ne fait surface comme problème.

Les causes sont habituellement structurelles — client Intune altéré, maliciel qui affecte l'agent de rapport, état profondément brisé d'une inscription ratée. Ces cas sont rares mais valent la peine de connaître : ne supposez pas que l'état de conformité est vrai juste parce qu'il est rapporté comme vrai. Des vérifications ponctuelles périodiques sur des appareils aléatoires, comparant l'état rapporté à l'état réel, sont une pratique d'audit utile.

## Le rôle de Windows Health Monitoring

La bibliothèque Panoptica365 inclut un petit modèle (595 octets) appelé **Windows Health Monitoring**. Il fait une seule chose :

- Active `allowDeviceHealthMonitoring`.
- Étend la surveillance à `bootPerformance,windowsUpdates`.

Ce modèle configure Windows pour collecter la télémétrie de santé sur la performance de démarrage et l'activité Windows Update. Les données alimentent la vue de santé d'appareil Intune et Endpoint Analytics si le client a ça activé.

Ce n'est pas un contrôle de sécurité. C'est un contrôle *d'observabilité*. Il dit à l'opérateur comment la flotte Windows du client se comporte au fil du temps — démarrages lents, plantages fréquents, échecs répétés de mise à jour. Les données sont utiles pour le dépannage proactif (« cet appareil va échouer bientôt »), pas pour l'évaluation de conformité.

Pour les buts de la boucle de conformité de Panoptica365, Windows Health Monitoring est essentiellement invisible — les données ne coulent pas dans l'état de conformité. Mais ça vaut la peine de savoir que le modèle existe et ce qu'il fait, parce que les opérateurs qui regardent le portail Intune le verront déployé aux côtés des modèles de sécurité.

## Comment Panoptica365 fait surface la boucle de conformité

Le tableau de bord client de Panoptica365 prend une tranche délibérément mince de la boucle de conformité. Trois surfaces, toutes haut niveau :

**La liste des appareils gérés Intune.** Chaque appareil inscrit Intune, avec OS, état de conformité courant (conforme / non conforme / non évalué), utilisateur assigné et dernier horodatage de synchronisation. Le compartiment « non évalué » couvre aussi les appareils qu'Intune ne gère pas du tout (comme les serveurs Windows) — ils apparaissent dans la liste parce qu'Entra les connaît, mais ils n'obtiennent jamais de verdict de conformité. La table que vous parcourez quand quelque chose vous semble bizarre.

**La tuile « Appareils conformes ».** Pourcentage comme titre (p. ex. « 94 % » ou « 60 % »), codé par couleur selon la posture — vert quand en santé, rouge quand faible. Le sous-titre lit « X de Y conformes, Z non évalués », vous donnant trois chiffres en une ligne : combien d'appareils Panoptica365 a évalués, combien de ceux-là ont passé, et combien d'appareils inscrits n'ont jamais obtenu de verdict du tout. Le dénominateur du pourcentage est l'ensemble évalué; les appareils non évalués sont fait remonter séparément plutôt que de tirer le ratio vers le bas. Une flèche de tendance apparaît quand le pourcentage bouge entre les sondages — rouge vers le bas sur une baisse, vert vers le haut sur une amélioration. Le point : vous n'avez pas à vous souvenir du chiffre d'hier pour savoir dans quelle direction le client bouge.

**Appareils par OS.** Une répartition par compte par système d'exploitation (Windows, Windows Server, iOS, Android, etc.). Utile pour vérifier la santé du mélange de plateformes et pour remarquer quand un compte bouge de façon inattendue (un nouveau Mac apparaît, un paquet d'appareils Windows tombe).

C'est la surface. Panoptica365 **ne** fait **pas** remonter, dans le tableau de bord, les choses que vous pourriez attendre d'un « tableau de bord de conformité » au sens plus lourd :

- Une répartition « top raisons de non-conformité » à travers la flotte
- Une file de triage « non conforme depuis plus de 24 heures »
- Une liste d'appareils en flottement
- Des appels par appareil à la raison d'échec

Ces enquêtes se passent dans le portail Intune lui-même, un appareil à la fois. La division est intentionnelle : Panoptica365 vous dit *que* la conformité bouge — le compte a baissé, un appareil est tombé à inconnu, la posture globale du tenant s'affaiblit. La console Intune de Microsoft vous dit *pourquoi* — quelle vérification spécifique a échoué, quel paramètre manque, quelle a été la dernière erreur de l'appareil.

L'implication pour les opérateurs : utilisez la vue de conformité de Panoptica365 comme un fil d'alarme (balayage quotidien, chercher les changements) et Intune comme la console diagnostique (plongez une fois que quelque chose semble mal). Sauter un côté ou l'autre brise le flux — Panoptica365 seul vous donne le signal sans le diagnostic; Intune seul vous fait vous connecter à 30 portails un par un pour remarquer le signal en premier lieu.

## Ce que les opérateurs font vraiment avec ça

Le flux opérateur quotidien autour de la boucle de conformité :

**Vérification matinale (hebdomadaire minimum, quotidienne idéale) :** ouvrir le tableau de bord client. Regarder la tuile appareils (compte conforme, compte évalué, total). Si le ratio conforme a baissé versus ce dont vous vous souvenez d'hier, ou si l'écart « inconnu » s'est élargi, balayer la liste des appareils gérés Intune pour les aberrations — appareils qui ont basculé à inconnu, appareils avec horodatages de dernière synchronisation périmés, appareils que vous ne reconnaissez pas.

**Triage par incident :** quand un utilisateur rapporte qu'il ne peut pas se connecter à M365 parce que son appareil est non conforme, le manuel, c'est le triage des modes d'échec plus tôt dans cette leçon. Ouvrir l'appareil dans le portail Intune, lire la raison spécifique d'échec, vérifier sur l'appareil, forcer la synchronisation au besoin, régler le problème sous-jacent.

**Revue mensuelle :** pour chaque client, ouvrir le portail Intune et regarder les raisons de conformité par appareil à travers les appareils non conformes. Repérage de patron manuel : si « Defender désactivé » apparaît sur des appareils à travers plusieurs clients, il peut y avoir un script de déploiement ou un outil RMM qui désactive Defender par inadvertance. Si « BitLocker non activé » apparaît, il peut y avoir du matériel (appareils sans TPM) qui n'attrape pas le modèle BitLocker. C'est vraiment du travail manuel aujourd'hui — Panoptica365 n'agrège pas les raisons pour vous à travers la flotte, donc le repérage de patron dépend de l'opérateur qui fait les plongées.

**Audit trimestriel :** vérification ponctuelle de quelques appareils conformes aléatoires par client. Comparer l'état rapporté à l'état réel. Confirmer que la boucle fonctionne pour ces appareils. Habituellement bien; occasionnellement fait surface le mode d'échec « silencieusement brisé » que rien d'autre n'attrape.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**La boucle de conformité a un timing. Communiquez-le aux utilisateurs.** Quand un utilisateur règle son appareil et est encore bloqué, l'explication la plus probable, c'est le délai de propagation, pas un problème plus profond. Lui dire d'attendre 30 minutes et de réessayer règle la plupart des cas.

**La non-conformité persistante est une file de triage, pas une correction unique.** Les appareils apparaissent en non-conformité pour beaucoup de raisons; certaines ont besoin d'attention immédiate (brèche de sécurité), certaines ont besoin de patience (délai de synchronisation), certaines ont besoin de remédiation (client Intune brisé). Traitez la liste comme une responsabilité opérationnelle récurrente.

**Vérification ponctuelle du cas silencieusement-brisé trimestriellement.** L'échec de boucle de conformité le plus insidieux est celui qui ne fait jamais surface comme problème. Des audits d'appareils aléatoires attrapent ça là où rien d'autre ne le fait.

## Ce qui suit

- **Leçon 10 : Importer vos propres modèles Intune.** Quand la bibliothèque incluse ne couvre pas ce dont vous avez besoin.
- **Leçon 11 : Opérer Intune à l'échelle.** Dérive, exclusions, cycle de vie.

Pour l'instant : la boucle de conformité est la fondation qui rend tout dans la carte 4 *valable*. Sans la surveiller en production, les modèles se déploient mais leur effet est invisible. Traitez le tableau de bord de conformité comme une surface opérationnelle quotidienne.

---

*Sources des données dans cette leçon — Microsoft Learn sur la cadence d'évaluation de politique de conformité ([Microsoft Learn — Compliance policies](https://learn.microsoft.com/en-us/mem/intune/protect/device-compliance-get-started)); référence de timing de synchronisation Intune ([Microsoft Learn — Common ways to use Intune](https://learn.microsoft.com/en-us/mem/intune/remote-actions/device-sync)); surveillance de santé d'appareil ([Microsoft Learn — Endpoint Analytics](https://learn.microsoft.com/en-us/mem/analytics/overview)).*
