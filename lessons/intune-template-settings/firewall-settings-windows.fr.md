---
title: "Firewall Settings — défense réseau Windows"
subtitle: "51 paramètres sur les profils Domaine, Privé et Public — s'assurer que Windows Defender Firewall est actif, journalise et est bien serré dans chaque contexte réseau."
icon: "flame"
last_updated: 2026-05-29
---

# Firewall Settings — défense réseau Windows

Si Defender for Endpoint, c'est la couche qui surveille les fichiers et les processus, le Windows Defender Firewall, c'est la couche qui surveille les connexions réseau. Les deux se complètent : Defender attrape les maliciels déjà sur l'appareil; le pare-feu empêche les maliciels d'atteindre l'appareil en premier lieu — ou empêche les logiciels compromis sur l'appareil d'atteindre leur infrastructure de commandement et contrôle.

Le modèle Firewall Settings Windows de Panoptica365 est la plus grosse configuration non-Security-Baseline de la bibliothèque à 34 Ko et 51 paramètres distincts. Il configure Windows Defender Firewall à travers les trois profils réseau (Domaine, Privé, Public) plus des paramètres globaux, s'assurant que le pare-feu est activé, qu'il journalise, et qu'il utilise des défauts sensés.

Cette leçon parcourt ce qui se fait configurer, le modèle à trois profils qui rend Windows Defender Firewall confus, et les réalités opérationnelles de faire rouler des pare-feu hôtes en production.

## Le modèle à trois profils — ce qui fait que ce modèle a l'air gros

Windows Defender Firewall a la conception inhabituelle de maintenir trois profils de pare-feu séparés, chacun appliqué selon le réseau auquel l'appareil est connecté :

- **Profil Domaine** — appliqué quand l'appareil est sur un réseau qui contient un contrôleur de domaine auquel il est joint. Typiquement le réseau du bureau corporatif.
- **Profil Privé** — appliqué quand l'appareil est sur un réseau que l'utilisateur a marqué Privé (réseau maison, petit bureau de confiance).
- **Profil Public** — appliqué quand l'appareil est sur un réseau marqué Public (café, aéroport, hôtel). Le profil par défaut pour n'importe quel réseau non reconnu.

Chaque profil a à peu près le même ensemble de paramètres configurables : activer/désactiver, action entrante par défaut, action sortante par défaut, mode furtif, comportement de journalisation, emplacement du fichier journal, taille du journal, permettre la fusion de politique locale. Donc les 51 paramètres du modèle, c'est surtout *17 paramètres × 3 profils* avec une poignée de paramètres globaux par-dessus.

La raison pour laquelle les trois profils ont besoin de configuration explicite, c'est que le profil Public en particulier doit être plus serré que le profil Domaine. Un appareil sur le réseau corporatif a des voisins de confiance et une infrastructure de confiance; un appareil sur un réseau de café partage le LAN avec des étrangers. L'action par défaut pour le trafic entrant devrait différer en conséquence.

## Ce que le modèle configure, par profil

Pour **chacun des trois profils**, le modèle fixe :

- **`enablefirewall`** — pare-feu activé sur ce profil.
- **`defaultinboundaction`** — bloquer le trafic entrant par défaut (le baseline sécurisé; les règles d'autorisation spécifiques se superposent).
- **`defaultoutboundaction`** — permettre le trafic sortant par défaut (la posture typique pour les appareils clients; les règles de blocage sortant se superposent).
- **`disablestealthmode`** — mode furtif activé (non, le paramètre est nommé de façon confuse — `disablestealthmode: false` veut dire que le mode furtif EST actif). Le mode furtif veut dire que l'appareil ne répond pas aux sondes réseau (analyses de ports, écho ICMP, etc.), ce qui le rend moins découvrable aux attaquants sur le même segment réseau.
- **`disablestealthmodeipsecsecuredpacketexemption`** — les paquets sécurisés IPSec sont exemptés du mode furtif (donc les connexions IPSec fonctionnent encore même avec le mode furtif activé).
- **`disableunicastresponsestomulticastbroadcast`** — désactive les réponses unicast au multicast/broadcast — ferme un petit vecteur de divulgation d'information.
- **`disableinboundnotifications`** — ne pas montrer les notifications entrant-bloqué aux utilisateurs. C'est le choix souple; la version stricte notifierait les utilisateurs quand quelque chose essaie de les atteindre.
- **`enablelogdroppedpackets`** — journaliser les paquets rejetés par le pare-feu. Important pour la réponse aux incidents.
- **`enablelogsuccessconnections`** — journaliser les connexions réussies. Lourd sur le disque mais utile pour la criminalistique.
- **`enablelogignoredrules`** — journaliser les règles qui étaient configurées mais ignorées (p. ex., règles désactivées qui auraient matché). Diagnostique.
- **`logfilepath`** — où va le fichier journal (typiquement `%systemroot%\system32\logfiles\firewall\pfirewall.log` ou similaire).
- **`logmaxfilesize`** — taille maximum du journal de pare-feu avant qu'il pivote.
- **`allowlocalpolicymerge`** — si les règles de pare-feu configurées localement peuvent fusionner avec la politique centrale. Typiquement `false` (la politique gérée centralement gagne; les utilisateurs ne peuvent pas ajouter leurs propres règles).
- **`allowlocalipsecpolicymerge`** — pareil, pour la politique IPSec.
- **`authappsallowuserprefmerge`** — si les applications autorisées peuvent fusionner avec les préférences utilisateur. Typiquement `false`.
- **`globalportsallowuserprefmerge`** — si les règles de port globales peuvent fusionner avec les préférences utilisateur.

À travers les trois profils, ça fait environ 51 paramètres, avec des variations mineures entre Domaine (plus permissif — le réseau corporatif est de confiance), Privé (moyen), et Public (le plus strict — le réseau de café est hostile).

## Paramètres globaux du pare-feu

En plus des paramètres par profil, le modèle configure quelques paramètres globaux qui affectent les trois profils :

- **`crlcheck`** — comportement de vérification des listes de révocation de certificats pour l'évaluation des règles de pare-feu. S'assure que les certificats révoqués ne sont pas acceptés pour l'authentification.
- **`disablestatefulftp`** — filtrage FTP avec état. Durcissement moderne — le support FTP avec état introduit une complexité d'analyse qui a été exploitée historiquement.
- **`presharedkeyencoding`** — encodage des clés prépartagées IPSec (typiquement UTF-8).

Ces paramètres globaux sont des choix de durcissement délibérés qui ferment des vecteurs d'attaque historiques dans le composant de pare-feu Windows lui-même.

## Les choix opinés à connaître

Une poignée de paramètres dans ce modèle qui affectent l'expérience utilisateur ou ont des implications de sécurité spécifiques :

**Mode furtif activé.** L'appareil ne répond pas aux sondes réseau. Veut dire que la découverte de réseau standard (ping, analyses de ports) ne verra pas l'appareil. Aide dans les réseaux hostiles; surtout invisible aux utilisateurs; occasionnellement confond les ingénieurs réseau qui essaient de dépanner depuis une autre machine (« pourquoi ce PC ne répond pas au ping? »). Documentez-le si l'équipe TI d'un client se fie au ping pour la surveillance.

**Notifications entrantes désactivées.** Les utilisateurs ne voient pas les pop-ups « Windows Defender Firewall a bloqué certaines fonctionnalités de cette application ». C'est plus convivial — les pop-ups sont agaçants et la plupart des utilisateurs cliquent à travers sans comprendre. Le compromis : un utilisateur qui installe une application légitime qui a besoin d'une exception entrante ne sera pas invité à en ajouter une; l'opérateur devra ajouter l'exception centralement. Pour les scénarios PME, c'est habituellement le bon compromis (exceptions gérées par l'opérateur > exceptions gérées par l'utilisateur).

**Fusion de politique locale désactivée.** Les utilisateurs (même ceux avec admin local) ne peuvent pas ajouter leurs propres règles de pare-feu qui entrent en conflit avec la politique centrale. C'est le choix sécurisé mais ça surprend occasionnellement les utilisateurs avancés qui avaient l'habitude de pouvoir laisser passer leurs propres apps. La mitigation est la même qu'au-dessus — ajouter les exceptions légitimes centralement à mesure qu'elles surgissent.

**La journalisation est verbeuse.** `enablelogdroppedpackets`, `enablelogsuccessconnections` et `enablelogignoredrules` sont tous activés. Ça génère une activité substantielle de journal de pare-feu sur l'appareil. Le fichier journal pivote à la taille max configurée, donc il ne remplit pas le disque indéfiniment, mais les appareils qui font beaucoup d'activité réseau légitime verront des écritures significatives au journal. L'avantage, c'est la réponse aux incidents — quand quelque chose tourne mal, le journal de pare-feu est un des artéfacts criminalistiques les plus utiles disponibles.

## Ce qui peut briser

Le déploiement du pare-feu peut briser des choses d'une façon que le déploiement Defender brise rarement, parce que le pare-feu se trouve sur le chemin réseau de chaque connexion :

**Services entrants légitimes.** N'importe quoi sur l'appareil qui écoute pour des connexions entrantes (un serveur web de développement sur localhost, un pilote d'imprimante partagée en réseau, un outil de gestion à distance, une vieille app d'affaires qui utilise des connexions pair-à-pair) a besoin d'une règle d'autorisation explicite. Sans une, la connexion est bloquée. Le `defaultinboundaction: block` du modèle Panoptica365 rend ça strict par conception — mais ça veut dire que les cas d'usage entrants ont besoin d'exceptions.

**Partage de fichiers et d'imprimantes.** Le partage de fichiers SMB Windows se fie à des règles entrantes spécifiques. Les défauts du modèle gèrent ça correctement pour les configurations standards, mais les clients avec des configurations SMB non standards (serveurs Samba plus anciens spécifiques, ports non standards) peuvent avoir besoin d'ajustements.

**Apps réseau personnalisées.** Les apps spécifiques à l'industrie (imagerie médicale, CAO avec serveurs de licences partagés, systèmes de contrôle de fabrication) ont souvent des comportements réseau non standards. Les défauts stricts du modèle peuvent les briser. La solution, ce sont des exceptions de pare-feu par app ajoutées à la politique déployée par client.

**Découverte de réseau dans les environnements non-domaine.** Un utilisateur qui essaie de trouver une imprimante réseau sur un réseau de profil Privé peut avoir du mal parce que le mode furtif et le blocage entrant par défaut rendent la découverte plus difficile. Habituellement correct avec des procédures d'installation d'imprimante appropriées; peut surgir comme plainte dans les environnements clients moins matures.

## Déploiement

Déploiement au groupe pilote du pré-déploiement de la leçon 1, avec une attention spéciale aux flux d'affaires dépendants du réseau :

1. **Jour 0** — déployer à 3 à 5 appareils pilotes. *Crucial* : choisir des appareils qui exercent les flux réseau du client (partages de fichiers, imprimantes, apps d'affaires avec composants réseau).
2. **Jours 1 à 7** — vérifier le succès du déploiement dans le portail Intune. Tester chaque flux dépendant du réseau sur les appareils pilotes : impression, accès partage de fichiers, apps d'affaires, VPN, bureau à distance. *Tout* ce qui est lié au réseau devrait être testé.
3. **Jours 7 à 14** — observer les appareils pilotes. La première semaine, c'est quand le bris évident surgit; la deuxième semaine, c'est quand les flux une-fois-par-semaine et une-fois-par-mois exposent des enjeux plus subtils.
4. **Jour 14** — déploiement plus large si le pilote est propre.

Pour les changements de pare-feu spécifiquement, la fenêtre de déploiement de 14 jours est le minimum. Un client avec des flux par lots mensuels ou des rapports trimestriels peut avoir besoin d'une fenêtre de 30 jours avant que vous puissiez dire avec confiance « rien n'a brisé ».

## Quoi surveiller après l'application

**Pare-feu activé par appareil par profil.** Devrait être 100 % activé à travers les trois profils après déploiement. Les appareils qui montrent le pare-feu désactivé sur n'importe quel profil sont des appareils où le modèle a échoué à s'appliquer (peu fréquent) ou où un admin local l'a désactivé (plus fréquent — enquêtez).

**Journaux de paquets rejetés.** La journalisation verbeuse veut dire que le journal de pare-feu est plein d'entrées de paquets rejetés. La plupart sont du bruit (analyse de fond Internet qui frappe l'appareil). Vrais signaux à surveiller : rafales de paquets rejetés depuis une IP interne spécifique (pourrait indiquer un appareil interne compromis qui sonde), rejets répétés de la même source externe (pourrait indiquer une analyse ciblée), rejets de protocoles d'apparence légitime (pourrait indiquer une app mal configurée).

**Bris de flux rapportés par les utilisateurs.** Tracez chaque plainte « X a arrêté de fonctionner après le déploiement du pare-feu ». Certaines sont de vrais bris qui demandent des exceptions par app; certaines sont des coïncidences; certaines sont des erreurs d'utilisateur. Documentez chacune.

**Dérive sur le modèle.** Comme les autres modèles, le modèle Firewall Settings peut dériver si un autre admin du client le modifie. La dérive peut être dangereuse ici — élargir l'action entrante par défaut ou désactiver le mode furtif réduirait matériellement la sécurité.

## Le modèle Block mshta.exe est adjacent au pare-feu

La bibliothèque Panoptica365 inclut un modèle séparé — Block mshta.exe outbound connections — qui vit dans la même famille de modèles `endpointSecurityFirewall` que le modèle Firewall Settings principal. Il est couvert à la leçon 7 (aux côtés des règles ASR) parce que conceptuellement c'est une règle de réduction de surface d'attaque plutôt qu'une configuration de pare-feu générale. Vaut la peine de savoir : quand un opérateur ouvre le portail Intune pour chercher des configurations liées au pare-feu, il verra à la fois le modèle Firewall Settings principal et le modèle Block mshta.exe dans la même liste. Ils servent des buts différents.

## Ce que Panoptica365 voit

Deux choses réelles, et ce qui n'est pas là.

**Ce que Panoptica365 fait remonter :**

- **Dérive sur le modèle Firewall Settings.** Même modèle que le reste : si le modèle déployé chez un client diverge de la référence Panoptica365 — quelqu'un ouvre la console Intune et désactive le mode furtif, ouvre un blocage entrant, baisse la journalisation — le détecteur de dérive se déclenche et l'opérateur peut revenir, réappliquer, ou accepter.
- **Détections Defender XDR** (quand l'ingestion Defender XDR est configurée selon la leçon 4 de la carte 1) — les incidents qui incorporent des connexions bloquées par le pare-feu dans leur contexte entrent dans le moteur d'alertes. Ce n'est pas des « événements de pare-feu »; c'est des incidents Microsoft à plus haut niveau qui peuvent référer à de l'activité de pare-feu.

**Ce que Panoptica365 ne fait *pas* remonter :** l'état du pare-feu par appareil, le statut par profil (Domaine/Privé/Public) par appareil, les événements bruts du journal de pare-feu. Rien de tout ça ne vit dans le tableau de bord. Le signal de conformité Intune inclut `activeFirewallRequired: true`, donc un appareil avec le pare-feu désactivé se reportera dans le compte global conforme/non-conforme — mais vous ne pouvez pas regarder « quels appareils spécifiques ont quel profil désactivé » depuis Panoptica365. C'est une plongée dans le portail Intune et la console Defender.

Le fichier journal de pare-feu lui-même est un artéfact Windows local que les intervenants en incidents tirent quand ils enquêtent sur un appareil spécifique. Pas ingéré par Panoptica365 — pour la télémétrie de défense réseau à l'échelle de la flotte, la surface visible, c'est le pipeline d'alertes Defender XDR.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**Le déploiement du pare-feu est le modèle de la carte 4 le plus susceptible de briser quelque chose.** N'importe quoi qui écoute sur le réseau ou qui vit dans un comportement réseau non standard peut être affecté. Planifiez une fenêtre de déploiement de 14 à 30 jours avec des tests de flux approfondis.

**Le modèle à trois profils est réel et vaut la peine d'être compris.** Quand un utilisateur se plaint que « le pare-feu bloque [chose] », la première question, c'est *quel profil est actif quand ça arrive?* Le même appareil se comporte différemment sur le Wi-Fi du bureau vs le Wi-Fi du café parce que le profil actif change.

**Les défauts mode furtif et blocage entrant sont les choix stricts.** Documentez-les avec le client. La rigueur, c'est le but — l'alternative, c'est le défaut laissez-faire qui a donné aux attaquants une découverte réseau facile pendant deux décennies.

## Ce qui suit

- **Leçon 7 : Règles ASR + Block mshta.exe.** Réduction de surface d'attaque — les fonctionnalités préemptives de blocage de comportement qui attrapent les menaces avant qu'elles soient livrées au disque.
- **Leçon 8 : Account Protection + Block MSA.** Windows Hello for Business, Credential Guard, blocage des ajouts MSA personnels.

Pour l'instant : le modèle Firewall est le compagnon de couche réseau du modèle Defender de couche fichier. Ensemble ils constituent la couche de défense active sur les terminaux Windows. Déployez avec des tests de flux approfondis; tolérez le déploiement de 14 à 30 jours; résistez à la tentation d'affaiblir les défauts stricts.

---

*Sources des données dans cette leçon — Microsoft Learn sur la configuration de Windows Defender Firewall via Intune ([Microsoft Learn — Configure Windows Defender Firewall via Intune](https://learn.microsoft.com/en-us/mem/intune/protect/endpoint-security-firewall-policy)); modèle de profil Windows Defender Firewall ([Microsoft Learn — Windows Defender Firewall with Advanced Security](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/windows-firewall-with-advanced-security)); référence de journalisation du pare-feu ([Microsoft Learn — Firewall logging](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/configure-firewall-logging)).*
