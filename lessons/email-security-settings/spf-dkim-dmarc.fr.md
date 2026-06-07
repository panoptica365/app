---
title: "SPF, DKIM, DMARC — le trio d'authentification courriel que presque tout le monde se trompe"
subtitle: "Comment SPF, DKIM et DMARC arrêtent la falsification de domaine — et pourquoi p=none équivaut à n'avoir aucune politique."
icon: "shield-check"
last_updated: 2026-05-29
---

# SPF, DKIM, DMARC — le trio d'authentification courriel que presque tout le monde se trompe

Un MSP reçoit un appel paniqué d'un client un jeudi après-midi. « Notre plus gros client vient d'appeler. Il a reçu un courriel ce matin qui avait l'air de venir de notre directeur financier — instructions de virement, paiement urgent de fournisseur, le grand jeu. Il a presque payé. Les en-têtes du courriel disent qu'il vient de notre domaine. Comment l'attaquant est-il entré dans notre système? »

La réponse est la pire sorte de réponse : l'attaquant n'est entré dans rien. Il est dehors, envoyant un courriel falsifié depuis sa propre infrastructure, en mettant le domaine du client dans l'en-tête `From`. Le courriel du client va bien. Le directeur financier du client va bien. Le CRM du client et Active Directory et le compte bancaire vont bien.

Le partenaire du client *voit aussi* un courriel falsifié et vire presque de l'argent à l'attaquant. Le client encaisse le coup de réputation. Le partenaire encaisse le coup financier. Le MSP encaisse la conversation gênante.

C'est l'attaque que SPF, DKIM et DMARC existent pour arrêter. Le client a SPF. Il a peut-être DKIM. Il n'a probablement pas DMARC. Même s'il a les trois, DMARC est presque certainement à `p=none`, ce qui est observer-seulement — ça ne fait rien pour bloquer l'usurpation. Le serveur de courriel récepteur (le fournisseur de courriel du partenaire) voit l'authentification échouée, n'a aucune politique du domaine du client pour lui dire quoi faire, et prend une décision. Souvent la mauvaise.

Cette leçon vise à combler cet écart honnêtement. Le parcours de « pas de DMARC » ou `p=none` à `p=reject` est le travail de durcissement courriel le plus conséquent qu'un MSP fasse — et le plus communément sauté.

## Les trois mécanismes, distincts et complémentaires

SPF, DKIM et DMARC sont *trois choses séparées* qui travaillent ensemble. Les opérateurs les confondent constamment. Savoir qui est qui, c'est la fondation.

**SPF (Sender Policy Framework).** Un enregistrement DNS TXT sur votre domaine qui liste les adresses IP et services autorisés à envoyer du courrier « depuis » votre domaine. Publié comme `v=spf1 include:spf.protection.outlook.com -all` pour un tenant M365-seulement. Le serveur récepteur, quand un courriel arrive en prétendant être de votre domaine, vérifie l'IP expéditrice contre votre enregistrement SPF publié. Si l'IP n'est pas autorisée, SPF échoue.

**DKIM (DomainKeys Identified Mail).** Une signature cryptographique ajoutée au courriel sortant par le serveur expéditeur, utilisant une clé privée. La clé publique correspondante est publiée dans DNS comme enregistrement TXT à un sous-domaine de sélecteur (p. ex., `selector1._domainkey.customer.com`). Le serveur récepteur récupère la clé publique, vérifie la signature contre le corps du message. Si la signature est valide, le courriel prouve qu'il a été envoyé par un système autorisé *et* n'a pas été altéré en transit.

**DMARC (Domain-based Message Authentication, Reporting, and Conformance).** Un enregistrement DNS TXT à `_dmarc.customer.com` qui dit aux serveurs récepteurs quoi faire quand SPF ou DKIM échouent. Trois politiques : `p=none` (ne rien faire — envoyez-moi juste un rapport), `p=quarantine` (traiter comme suspect — dossier indésirables), `p=reject` (refuser le message carrément — rebondir). Plus une destination de rapport — une adresse courriel qui reçoit des rapports d'agrégation quotidiens de chaque serveur qui tente d'envoyer sous votre domaine.

Trois choses en couches :
- SPF demande « l'IP expéditrice est-elle autorisée à envoyer pour ce domaine? »
- DKIM demande « le message est-il signé cryptographiquement par le domaine autorisé? »
- DMARC demande « si SPF ou DKIM échouent, que devrait faire le récepteur, et où devrais-je rapporter? »

Un domaine avec seulement SPF est à moitié protégé. Un domaine avec seulement DKIM est à moitié protégé. Un domaine avec les deux mais sans DMARC est *observablement authentifié* mais le récepteur doit encore décider quoi faire des messages échoués — et beaucoup les laissent passer.

## Alignement — le concept que la plupart des opérateurs manquent

SPF et DKIM « passent » ou « échouent » tous les deux, mais DMARC ajoute une vérification supplémentaire cruciale : **l'alignement**.

**L'alignement SPF** veut dire que le domaine dans la vérification SPF correspond au domaine dans l'en-tête `From:` visible que l'utilisateur voit. Les attaquants peuvent s'authentifier depuis leur propre domaine (`evil-attacker.com`) et mettre votre domaine dans le `From:` visible. SPF passe — pour le domaine de l'attaquant. Le `From:` visible dit le vôtre. L'alignement SPF attrape ce désaccord.

**L'alignement DKIM** veut dire que le domaine qui signe le message via DKIM correspond au domaine `From:` visible. Même logique — un attaquant peut signer DKIM avec son propre domaine tout en falsifiant le `From:` visible. L'alignement DKIM attrape le désaccord.

DMARC exige *qu'au moins SPF ou DKIM passe avec alignement*. Les deux qui passent mais non alignés est encore un échec DMARC. Le récepteur applique alors votre politique DMARC (`p=quarantine` ou `p=reject`).

C'est la partie que les opérateurs manquent. Un domaine peut avoir un enregistrement SPF valide ET un DKIM valide ET être encore usurpable parce que rien n'applique l'alignement. DMARC l'applique.

## Le parcours — de p=none à p=quarantine à p=reject

Presque chaque parcours DMARC de client PME ressemble à ça :

**Étape 0 — Aucun DMARC du tout.** La plupart des domaines. Le récepteur obtient des SPF/DKIM échoués et décide tout seul (habituellement il laisse passer le courriel parce que rejeter semble impoli). Le client est entièrement usurpable.

**Étape 1 — DMARC publié à p=none.** Le client a *l'observabilité* — les rapports d'agrégation quotidiens vous disent qui envoie sous votre domaine, depuis où, avec quel statut d'authentification. Mais la politique dit encore « ne rien faire », donc l'usurpation fonctionne encore. C'est là où 80 % des domaines avec DMARC vivent, souvent pendant des années.

**Étape 2 — DMARC à p=quarantine.** Le courrier avec authentification échouée va dans le dossier indésirables du destinataire. La plupart des courriels usurpés de l'attaquant n'atteignent pas la boîte de réception. Certains utilisateurs les trouvent quand même dans les indésirables et agissent dessus; c'est un plus petit rayon d'impact mais pas zéro.

**Étape 3 — DMARC à p=reject.** Le courrier avec authentification échouée est refusé carrément par le serveur récepteur. Le destinataire ne le voit jamais; l'expéditeur (réel ou attaquant) obtient un rebond. Le domaine du client n'est plus usurpable du point de vue du récepteur.

Le parcours de l'étape 0 à l'étape 3 prend des semaines à des mois pour la plupart des clients. Pas parce que c'est techniquement difficile — les changements DNS sont petits. Parce qu'entre `p=none` et `p=reject`, vous devez trouver chaque expéditeur légitime qui s'authentifie mal et le réparer, ou accepter qu'il sera mis en quarantaine / rejeté.

C'est la partie qui fait peur aux MSP et les fait rester à `p=none` indéfiniment. Ne soyez pas ce MSP. Le client est à un courriel d'ingénierie sociale d'un incident de fraude par virement que DMARC aurait arrêté.

## Diagnostic — utiliser DomainGuardian

Avant de toucher à quoi que ce soit, auditez l'état actuel. [DomainGuardian](https://domainguardian.nebiatek.com/) vous donne la vue codée par couleur pour SPF / DKIM / DMARC / MX / enregistrements connexes, conçue pour les techs L1 qui ne veulent pas mémoriser la syntaxe de recherche DNS.

Pour chaque domaine accepté sur le tenant du client, vérifiez :

- **SPF.** Existe-t-il? Finit-il par `-all` (hard fail) ou `~all` (soft fail) ou `+all` (catastrophique — autoriser tout)? Inclut-il `spf.protection.outlook.com` (requis pour M365)? Inclut-il les autres expéditeurs que le client utilise réellement (plateformes marketing, fournisseurs de paye, outils comptables)? Le compte de recherches est-il sous 10 (la limite stricte de SPF — dépassez-la et l'enregistrement se brise)?

- **DKIM.** DKIM est-il activé pour ce domaine dans le centre d'administration M365? Les enregistrements CNAME correspondants (`selector1._domainkey.customer.com` et `selector2._domainkey.customer.com`) sont-ils publiés dans DNS pointant vers les cibles Microsoft? Se résolvent-ils réellement correctement?

- **DMARC.** Y a-t-il un enregistrement TXT à `_dmarc.customer.com`? Quelle est la politique (`p=none`, `p=quarantine`, `p=reject`)? Y a-t-il une destination de rapport d'agrégation (`rua=mailto:...`)? `aspf` et `adkim` sont-ils configurés (modes d'alignement — `r` pour relaxed, `s` pour strict)?

Documentez les constats par domaine. L'audit est la fondation pour le parcours.

## Configuration — les étapes pratiques

**SPF, pour un tenant M365-seulement :**

```
v=spf1 include:spf.protection.outlook.com -all
```

Ajoutez d'autres includes pour les expéditeurs tiers que le client utilise (Mailchimp `include:servers.mcsv.net`, SendGrid `include:sendgrid.net`, ADP `include:spf.adp.com`, etc. — chaque plateforme documente son include). Gardez le total d'includes sous 10 pour rester dans la limite de recherches. Finissez avec `-all` (hard fail) pour le durcissement de production — `~all` est une marche, pas une destination.

**DKIM, dans M365 :**

Ouvrez le portail Microsoft 365 Defender → Email & collaboration → Policies & rules → Threat policies → Email authentication settings → DKIM. Sélectionnez chaque domaine accepté. Microsoft affiche les deux valeurs CNAME que vous devez publier dans DNS. Publiez-les. Attendez la propagation DNS (habituellement sous une heure). Basculez la signature DKIM à *enabled* dans le portail pour le domaine.

Ça doit être fait **par domaine accepté**. Le domaine `onmicrosoft.com` du client a DKIM automatique; ses domaines personnalisés n'en ont pas tant que vous ne configurez pas chacun.

**DMARC, en commençant à p=none :**

```
v=DMARC1; p=none; rua=mailto:dmarc-reports@customer.com; aspf=r; adkim=r;
```

Publié comme enregistrement TXT à `_dmarc.customer.com`. La destination `rua` devrait être une boîte aux lettres que vous (ou un service de rapport DMARC) surveillez activement — les rapports arrivent quotidiennement et c'est la mine d'or pour la prochaine étape.

**Lire les rapports** est la partie difficile du parcours. Les rapports sont des fichiers XML (un par serveur expéditeur, par jour). Pour les clients PME, vous voulez un service qui transforme le XML en tableaux de bord lisibles montrant qui envoie sous votre domaine, quel statut d'authentification ils ont, et quels expéditeurs vous devez réparer. Celui qu'on recommande est [mailsec.ca](https://mailsec.ca/). D'autres options existent (le suivi DMARC de Postmark, Valimail, dmarcian, Mailhardener); choisissez-en un par MSP et utilisez-le systématiquement sur tous les clients pour que le flux de travail devienne familier.

**Avancer à p=quarantine :**

Une fois que vous avez passé quelques semaines à `p=none` et identifié (et réparé) tous les expéditeurs légitimes, changez la politique :

```
v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@customer.com; aspf=r; adkim=r; pct=25;
```

Le `pct=25` déploie la quarantaine à 25 % du courrier avec authentification échouée. Surveillez les rapports pendant deux semaines. Si rien de légitime ne brise, montez à `pct=50`, puis `pct=100`. C'est le filet de sécurité pour les surprises.

**Avancer à p=reject :**

Une fois que `p=quarantine; pct=100` a roulé proprement pendant quelques semaines, basculez à `p=reject`. Le domaine du client n'est plus usurpable du point de vue du récepteur.

## Ce qui peut briser

**Expéditeurs légitimes sans autorisation SPF/DKIM appropriée.** Plateformes marketing, fournisseurs de paye, systèmes CRM, outils de sondages — tout service qui envoie sous le domaine du client qui n'a pas les bons includes SPF ou la signature DKIM. Une fois que DMARC se resserre à `p=quarantine` ou `p=reject`, ces expéditeurs se font mettre en quarantaine ou rebondir. La correction est spécifique au service — ajouter des includes SPF, configurer DKIM pour l'expéditeur tiers, ou migrer l'expéditeur vers un sous-domaine avec sa propre politique DMARC.

**Campagnes marketing où le client ne l'a pas dit à TI.** Un cycle commun : le marketing essaie une nouvelle plateforme de courriel, envoie une campagne, la moitié des destinataires ne la reçoit jamais parce que DMARC a bloqué le courriel non authentifié. Le marketing se plaint à TI. TI réalise que le marketing utilise la plateforme depuis des mois. La correction est d'authentifier correctement, pas d'affaiblir DMARC.

**Courrier transféré.** Le courrier transféré à travers un intermédiaire (une liste de diffusion, un transitaire personnel) échoue souvent DMARC parce que l'IP du serveur de transfert ne correspond pas à SPF et le corps du message est modifié, brisant DKIM. Les listes de diffusion modernes gèrent ça via ARC (Authenticated Received Chain) mais une infrastructure plus ancienne fait encore trébucher DMARC.

**Limite de recherches SPF dépassée.** Les enregistrements SPF qui imbriquent trop d'includes (limite stricte de 10 recherches) deviennent invalides. M365 seul utilise un include; ajoutez Mailchimp, ADP, et Salesforce et vous pouvez frapper la limite vite. Les outils d'aplatissement SPF (services payants) effondrent les includes en listes IP brutes pour rester sous la limite.

## Ce que Panoptica365 voit

SPF, DKIM et DMARC sont des enregistrements DNS sur le domaine du client — hors du modèle de lecture focalisé-sur-tenant-M365 de Panoptica365. Panoptica365 n'audite pas actuellement les enregistrements DNS nativement; le flux de travail de l'opérateur, c'est d'utiliser DomainGuardian (ou un outil similaire) pour l'audit périodique.

Ce que Panoptica365 *fait* remonter de pertinent :

- **L'état d'activation DKIM dans le tenant M365.** Basculer DKIM « activé » par domaine est un paramètre M365 — la détection de dérive de Panoptica365 peut signaler si la signature DKIM est désactivée pour un domaine qui était précédemment activé.
- **Le pipeline d'alertes Defender XDR.** Quand MDO détecte une tentative d'usurpation qui a échoué à l'alignement DMARC, l'alerte résultante coule vers le moteur d'alertes de Panoptica365.

Pour les rapports DMARC eux-mêmes — les rapports d'agrégation XML quotidiens — les opérateurs s'appuient sur une plateforme tierce de suivi DMARC; [mailsec.ca](https://mailsec.ca/) est celle qu'on recommande, avec Postmark, Valimail, dmarcian, ou Mailhardener comme alternatives utilisables. Panoptica365 n'ingère pas ces rapports aujourd'hui.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**`p=none` ne fait rien.** Un client avec DMARC à `p=none` est observablement authentifié mais opérationnellement non protégé. Les récepteurs laissent encore passer le courriel usurpé. Le parcours vers `p=quarantine` puis `p=reject` est le travail qui fait que DMARC défend réellement le client.

**L'alignement est le concept qui attrape les opérateurs.** SPF et DKIM peuvent tous deux « passer » alors que l'en-tête `From:` visible est falsifié. L'exigence d'alignement de DMARC est ce qui fait que le trio attrape vraiment l'usurpation que l'anecdote d'ouverture décrit.

**DomainGuardian pour le diagnostic, mailsec.ca pour les rapports.** Le travail d'audit-du-DNS est convivial pour L1 avec le bon outil visuel. Le travail de lecture-des-rapports-DMARC a besoin d'une vraie plateforme de rapport pour l'échelle PME — les fichiers XML ne se mettent pas à l'échelle d'un carnet de 30 clients. mailsec.ca est celle qu'on recommande; Postmark, Valimail, dmarcian, ou Mailhardener sont des alternatives utilisables. Choisissez-en une par MSP et utilisez-la pour chaque client.

## Ce qui suit

- **Leçon 5 : Transfert automatique et règles de boîte de réception.** La paire d'indicateurs post-compromission — ce qui arrive après que l'authentification et Safe Links et DMARC ont tous été contournés d'une façon ou d'une autre.
- **Leçon 6 : Audit de boîte aux lettres.** La posture d'audit qui vous donne la visibilité sur ce qui s'est passé dans une boîte aux lettres après coup.

Pour l'instant : ouvrez DomainGuardian, collez le domaine principal du client, prenez une capture d'écran du résultat, et parcourez les constats SPF / DKIM / DMARC avec le client. S'il est à `p=none` ou n'a aucun DMARC du tout, le parcours commence là. Deux à trois mois de travail discipliné amènent un client de l'étape 0 à l'étape 3. Sautez ça et le client reste à un courriel d'ingénierie sociale de l'appel dans l'anecdote d'ouverture.

---

*Sources des données dans cette leçon — vérificateur d'authentification courriel DomainGuardian ([domainguardian.nebiatek.com](https://domainguardian.nebiatek.com/)); plateforme de rapport DMARC mailsec.ca ([mailsec.ca](https://mailsec.ca/)); Microsoft Learn sur SPF dans Microsoft 365 ([Microsoft Learn — Set up SPF](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-spf-configure)); configuration de la signature DKIM dans M365 ([Microsoft Learn — Use DKIM to validate outbound email](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dkim-configure)); vue d'ensemble DMARC et référence de politique ([Microsoft Learn — Use DMARC to validate email](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dmarc-configure)); RFC 7489 (spécification DMARC — modes d'alignement et sémantique de politique) ([RFC 7489](https://datatracker.ietf.org/doc/html/rfc7489)); vue d'ensemble ARC (Authenticated Received Chain) pour le courrier transféré ([Microsoft Learn — ARC](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-arc-configure)).*
