---
title: "Compromission de courriel d'entreprise — ce que les attaquants font vraiment une fois dedans"
subtitle: "Le BEC convertit l'accès à une boîte aux lettres en fraude par virement — 2,77 G$ de pertes en 2024; toutes les autres attaques existent pour l'activer."
icon: "mail-warning"
last_updated: 2026-05-29
---

# Compromission de courriel d'entreprise — ce que les attaquants font vraiment une fois dedans

La commis aux comptes payables d'une firme de construction reçoit un courriel du fournisseur régulier de la firme au Québec : « Bonjour Susan, veuillez noter que nos coordonnées bancaires ont changé. Nouvelle information ACH ci-jointe. Veuillez mettre à jour de votre côté pour la prochaine facture. » Le courriel vient de la vraie adresse courriel du fournisseur. La grammaire est bonne. Il y a un courriel de suivi deux jours plus tard demandant l'état de la prochaine facture. Susan met à jour les coordonnées bancaires et traite le paiement de 187 000 $.

Le fournisseur n'a jamais envoyé ce courriel. Sa boîte aux lettres avait été compromise six semaines plus tôt par une campagne d'hameçonnage AiTM. L'attaquant lisait le courriel du fournisseur depuis plus d'un mois, attendant le prochain cycle de facturation de la firme de construction. L'attaquant a envoyé le message de changement bancaire depuis l'intérieur même de la boîte d'envoi du fournisseur, l'a supprimé des éléments envoyés immédiatement, et a routé tous les courriels de réponse de la firme de construction vers un dossier de boîte de réception caché, de sorte que le fournisseur n'a jamais vu la conversation se dérouler en son nom.

C'est ça, la compromission de courriel d'entreprise (BEC), et selon le Internet Crime Complaint Center du FBI, elle a coûté aux entreprises américaines **2,77 milliards $ en 2024 seulement**, à travers 21 442 incidents rapportés. Pertes totales BEC 2022–2024 : presque **8,5 milliards $**. Le vrai chiffre est plus élevé — la plupart des incidents BEC ne sont pas rapportés parce que les victimes sont gênées et les assureurs ne paient pas sans preuve.

Chaque autre attaque de cette carte — credential stuffing, fatigue MFA, AiTM, consentement OAuth, abus du code d'appareil — existe principalement *pour permettre le BEC*. Le BEC est le jour de paie. Sans BEC à la fin, rien du reste ne vaut le temps de l'attaquant.

Cette leçon, c'est à quoi ressemble vraiment le BEC à l'intérieur d'une boîte aux lettres compromise, comment les attaquants restent silencieux pendant des semaines, quels signaux spécifiques surveiller, et pourquoi « règle de boîte aux lettres bizarre » compte plus que « connexion bizarre » une fois que la compromission s'est produite.

## La forme économique du BEC

Le BEC fonctionne parce qu'il convertit la compromission d'identité en virements bancaires. La chaîne d'attaque ressemble à :

1. **Compromission initiale** d'une identité M365 d'un utilisateur, via n'importe laquelle des méthodes des leçons 1–5.
2. **Reconnaissance** à l'intérieur de la boîte aux lettres : qui cet utilisateur paie, qui le paie, quel est le cycle de facturation, qui a l'autorité sur les virements bancaires, où sont stockées les coordonnées bancaires.
3. **Manipulation tranquille** : créer des règles de boîte de réception cachées, mettre en place le transfert, parfois enregistrer un domaine homoglyphe qui ressemble au vrai domaine d'un fournisseur (`d̲i̲enamex.com` vs `dienamex.com` — `i` différents).
4. **Frapper** : typiquement au moment où une vraie facture est en route, l'attaquant injecte un faux changement de coordonnées bancaires. Les parties légitimes ne voient jamais le courriel l'une de l'autre parce que les règles le suppriment.
5. **Encaisser** : l'argent va vers un compte bancaire contrôlé par l'attaquant, souvent en chaîne à travers des mules financières.
6. **Nettoyage** : les règles sont retirées, le courriel est supprimé, l'attaquant garde souvent l'accès pour des campagnes de suivi.

Le cycle entier de la compromission à l'encaissement peut être de jours, semaines, ou mois. Les temps de séjour les plus longs — six mois ou plus — sont habituellement des compromissions d'adjoint exécutif où l'attaquant surveille patiemment les communications du C-suite en attendant le bon moment.

## Ce qu'un attaquant fait dans la première heure après la compromission

Connaître le manuel de l'attaquant aide l'opérateur à trier plus vite quand une compromission est fraîche. Voici l'activité typique de la première heure, dans l'ordre :

**Heure 0, minute 0–5 : Vérifier que l'accès fonctionne.** Se connecter à la boîte aux lettres via le web. Ouvrir Outlook. Lire quelques courriels récents. Confirmer que ce n'est pas un pot de miel ou un piège.

**Minutes 5–15 : Reconnaître la boîte aux lettres.** Chercher dans la boîte des termes comme `virement`, `facture`, `paiement`, `ACH`, `acheminement`, `banque`. Parcourir les contacts. Regarder le calendrier de l'utilisateur pour comprendre avec qui il rencontre. Lire les fils récents avec les fournisseurs et les clients.

**Minutes 15–30 : Mettre en place la persistance.** Trois patrons, souvent en combinaison :
- *Règle de boîte de réception* : transférer tout courriel correspondant à « facture OR paiement OR virement » vers un dossier caché (par exemple, un dossier nommé « Flux RSS » que personne n'ouvre). Le déplacer hors de la boîte de réception immédiatement.
- *Transfert vers adresse externe* : copie de chaque courriel automatiquement transférée vers une adresse Gmail ou Proton contrôlée par l'attaquant.
- *Transfert au niveau de la boîte aux lettres* (utilisant `Set-Mailbox -ForwardingSmtpAddress`) : transfère même quand aucune règle de boîte n'existe. Plus difficile à remarquer pour l'utilisateur parce que ce n'est pas dans l'UI des règles.

**Minutes 30–45 : Enregistrer sa propre méthode MFA.** Pour ne pas avoir à répéter la compromission initiale. Souvent un numéro de téléphone sous son contrôle, parfois un authentificateur logiciel qu'il possède. C'est un des signaux les plus fiables qu'un attaquant est dedans.

**Minutes 45–60 : Se taire.** Arrêter l'activité active. Attendre le trafic naturel de la boîte aux lettres. La configuration est en place; la frappe se passera plus tard.

À la fin de l'heure 1, l'attaquant a *de la persistance, de la reconnaissance, et le contrôle du canal*. L'utilisateur n'a rien remarqué.

## Ce qu'un attaquant fait sur les deux à six semaines suivantes

Si l'attaquant est patient (et ceux à haute valeur le sont toujours), il attend la bonne opportunité. Pendant cette fenêtre, il :

- Lit le courriel à mesure qu'il arrive via les règles de transfert.
- Suit les cycles de factures — quand ce client paie-t-il, quel est le montant typique, qui l'approuve, quelle est la formulation des changements de coordonnées bancaires légitimes habituels.
- Identifie la cible la plus précieuse. Parfois l'utilisateur compromis *n'est pas* la cible — c'est un point d'entrée vers une plus grande relation. La boîte d'un employé junior peut être précieuse parce qu'elle révèle l'horaire du CFO.
- Teste les limites. Envoie de petits courriels expérimentaux (parfois des brouillons sauvegardés puis supprimés) pour jauger si quelqu'un remarque une activité inhabituelle de boîte d'envoi.
- Met en place des domaines homoglyphes pour la frappe éventuelle. Achète parfois des certificats pour que le domaine ait l'air crédible.

Quand la frappe vient, c'est souvent *un courriel*. Le prétexte est bien construit, le moment est exact, la formulation correspond au style normal de l'utilisateur légitime (que l'attaquant étudie depuis des semaines). L'utilisateur légitime ne voit souvent jamais le courriel de frappe parce que ses propres règles le routent ailleurs.

## Ce qui se fait attraper et ce qui ne se fait pas attraper

**Ce que la pile Microsoft attrape bien :**

- Transfert automatique au niveau de la boîte aux lettres vers des adresses externes (Exchange Online Protection le bloque par défaut dans plusieurs configurations à partir de 2024).
- Liens SharePoint partagés anonymement depuis des comptes compromis vers des domaines externes.
- Enregistrement soudain de nouvelles méthodes MFA (signal du journal d'audit Entra, attrapable).
- Attack Disruption de Defender XDR pour les incidents BEC à haute confiance (quand corrélés avec des anomalies de connexion).

**Ce qui est plus difficile à attraper :**

- *Règles de boîte de réception cachées* qui routent le courriel vers des dossiers obscurs à l'intérieur de la boîte sans transférer à l'externe. Du point de vue d'Exchange, c'est l'utilisateur qui organise sa propre boîte. La règle existe dans l'état de la boîte mais ne déclenche pas d'alertes de règle-de-transfert.
- *Courriels de domaine homoglyphe envoyés aux contacts de l'utilisateur depuis une boîte d'attaquant externe*. Ils ne proviennent pas du compte de l'utilisateur compromis, donc l'audit de boîte aux lettres de l'utilisateur ne les voit pas. Le client du fournisseur voit un courriel « du fournisseur » et agit dessus.
- *Les vraies instructions de virement frauduleux*. Au moment où le courriel est envoyé, ce n'est qu'un courriel. La fraude est commise dans le compte bancaire, pas dans la boîte aux lettres.

C'est pourquoi la détection doit être en couches à travers plusieurs signaux — patron de connexion + activité de règle de boîte + patron de courriel sortant + détection d'anomalie post-paiement.

## Signaux spécifiques à surveiller

Une liste non exhaustive des patrons qui, en combinaison, indiquent presque toujours du BEC :

**Règle de boîte de réception créée avec une action « transférer vers » ou « déplacer vers le dossier » où le dossier est obscur** (Flux RSS, sous-dossiers Archive, Notes). Surtout si les conditions de la règle incluent des mots-clés financiers. Le patron de règle est la signature BEC unique la plus fiable.

**Transfert au niveau de la boîte aux lettres configuré** via `Set-Mailbox -ForwardingSmtpAddress`. Ça demande PowerShell ou un accès au portail d'admin — la plupart des utilisateurs légitimes ne mettent pas ça eux-mêmes. Panoptica365 surveille ça spécifiquement.

**Une nouvelle méthode MFA enregistrée peu de temps après une connexion d'IP étrangère ou de déplacement impossible.** Signal fort de persistance d'attaquant.

**Une rafale de courriels sortants depuis le compte compromis vers des contacts financiers** (clients, fournisseurs, banques) à des heures inhabituelles ou avec une formulation inhabituelle. L'analyse de comportement d'utilisateur de Defender for Cloud Apps attrape une partie de ça; le reste demande de l'observation directe.

**Attributions suspectes de permissions de boîte aux lettres** — particulièrement `FullAccess` ou `SendAs` accordés à un compte inconnu. Les attaquants se donnent parfois accès aux boîtes d'*autres* utilisateurs via les privilèges admin de l'utilisateur compromis, si l'utilisateur compromis est un admin.

**Recherches dans la boîte aux lettres pour des termes financiers** apparaissant dans le journal de requêtes de recherche. Defender for Cloud Apps peut faire remonter ça; le journal d'audit unifié capture les événements `MailItemsAccessed` et `Search`.

**Courriels de changement de coordonnées bancaires envoyés vers ou depuis l'utilisateur qui ne correspondent pas à la formulation ou au formatage des demandes de changement légitimes historiques.** Celui-ci est le plus difficile à automatiser; attrape souvent par revue manuelle par une personne attentive aux finances.

## Ce que Panoptica365 voit

C'est la catégorie de détection la plus profonde dans le catalogue de Panoptica365. Plusieurs évaluateurs centrés sur EXO dans Panoptica365 existent spécifiquement à cause du BEC :

- **Changements de règles de boîte de réception**, y compris la création de règles avec des actions suspectes (déplacer vers un dossier obscur, transférer à l'externe, supprimer à la réception).
- **Transfert au niveau de la boîte aux lettres configuré** — Panoptica365 surveille la propriété `ForwardingSmtpAddress` sur chaque boîte aux lettres et émet une alerte lorsqu'une cible de transfert externe apparaît.
- **Attributions de permissions de boîte aux lettres** — quand quelqu'un obtient FullAccess ou SendAs sur une boîte qu'il ne devrait pas avoir.
- **État du préréglage anti-hameçonnage** — s'assurer que les protections anti-hameçonnage de Defender for Office 365 sont toujours activées (les attaquants les abaissent parfois s'ils ont obtenu l'accès admin).
- **Nouvelle méthode MFA enregistrée** — le signal de persistance post-compromission.
- **Connexion réussie depuis IP étrangère** — la connexion en amont qui précède souvent le BEC.
- **Incidents BEC de Defender XDR** ingérés depuis la couche de corrélation Microsoft.

Quand plusieurs de ceux-ci se déclenchent sur le même utilisateur dans la même semaine, traitez ça comme une compromission confirmée et exécutez le manuel de réponse ci-dessous.

## Manuel de réponse pour BEC confirmé

Quand vous avez établi que le BEC se produit (ou s'est produit), le nettoyage est impliqué. Les étapes de haut niveau :

**1. Isoler l'utilisateur.** Révoquer toutes les sessions, forcer une réinitialisation du mot de passe, désactiver toutes les nouvelles méthodes MFA ajoutées pendant la fenêtre de compromission. Si l'utilisateur a des privilèges d'admin et que vous pensez qu'ils ont été utilisés, auditer et réinitialiser les attributions d'admin.

**2. Trouver et retirer les règles.** Règles de boîte de réception (`Get-InboxRule`), transfert au niveau de la boîte aux lettres (`Get-Mailbox -ForwardingSmtpAddress`, `Set-Mailbox -ForwardingSmtpAddress $null`). Obtenir l'historique des règles du journal d'audit unifié si nécessaire — parfois les attaquants créent puis suppriment des règles pour couvrir leurs traces.

**3. Identifier qui a reçu des courriels frauduleux envoyés à eux.** Tirer les éléments envoyés de la boîte aux lettres des 4–8 dernières semaines. Le journal d'audit montrera les courriels qui ont été envoyés puis supprimés. Cherchez les courriels vers des contacts financiers qui ressemblent à des demandes de changement bancaire ou des confirmations de paiement de facture.

**4. Notifier les destinataires des courriels frauduleux.** C'est la partie que personne n'aime. Toute personne qui a reçu un courriel de l'utilisateur compromis pendant la période de séjour doit le savoir — à la fois parce qu'elle peut avoir agi dessus (besoin d'arrêter un paiement, inverser un virement) et parce que son propre compte peut être le prochain.

**5. Coordonner avec la banque du client si un virement a déjà été fait.** La plupart des banques peuvent récupérer les virements bancaires s'ils sont rapportés rapidement (typiquement dans 72 heures). L'IC3 du FBI a aussi un processus de récupération de virement pour les transferts transfrontaliers. La vitesse compte.

**6. Auditer les autres utilisateurs dans le même tenant.** Les attaquants pivotent souvent de la victime initiale vers d'autres utilisateurs (surtout les admins). Vérifier les patrons de connexion et les règles de boîte pour tout le monde dans le tenant.

**7. Documenter pour l'assurance cyber.** La plupart des réclamations BEC demandent des preuves du vecteur de compromission, de la chronologie, des contrôles qui étaient en place, et des actions de réponse. Le journal d'audit de Panoptica365 et le journal de changements du tenant sont utiles ici. Gardez des dossiers propres.

**8. Informer le client sur ce qui a changé et ce qui doit être corrigé structurellement.** C'est la partie qui convertit un incident en posture de sécurité améliorée. Souvent le problème sous-jacent est « pas de MFA sur l'utilisateur compromis » ou « licence Business Standard donc pas d'accès conditionnel » — ce sont de vraies conversations dont l'incident BEC est maintenant votre preuve.

## Se défendre contre le BEC structurellement

Les défenses pour le BEC sont les défenses cumulatives des leçons 1–5, plus quelques-unes spécifiques au BEC :

**Bloquer le transfert automatique externe** au niveau de la règle de transport Exchange. La plupart des tenants n'ont pas besoin que les utilisateurs transfèrent automatiquement à l'externe; les tenants qui en ont besoin peuvent whitelister des cas d'affaires spécifiques. La posture par-défaut-désactivée élimine une des techniques de persistance favorites de l'attaquant.

**Alerter sur la création de règle de boîte** qui inclut des actions de transfert ou de dossier caché. Panoptica365 fait remonter ça.

**Exiger l'approbation d'admin pour les nouvelles configurations de transfert au niveau de la boîte aux lettres.** Les clients avec des rôles financiers sensibles devraient envisager de l'empêcher complètement.

**Former l'équipe financière spécifiquement.** Les changements de coordonnées bancaires devraient toujours être vérifiés hors-bande — un appel téléphonique à un numéro de dossier, pas à un numéro du courriel. C'est une des rares formations de sécurité qui a sauvé de l'argent mesurable dans de vrais incidents.

**Appliquer l'accès conditionnel pour exiger un MFA résistant à l'hameçonnage pour les utilisateurs financiers à haut risque.** Le même contrôle qui défait l'AiTM défait aussi la plupart des méthodes d'accès initial en amont qui mènent au BEC.

**Déployer les politiques anti-hameçonnage de Defender for Office 365 avec la protection contre l'usurpation d'identité.** Aide à attraper les courriels de domaine homoglyphe avant qu'ils ne soient livrés.

**Surveiller la rétention du journal d'audit de la boîte aux lettres.** Le défaut est 90 jours; pour les clients sensibles, étendre à un an. Quand le BEC est découvert six mois après le fait, vous aurez besoin du journal d'audit plus ancien pour reconstituer ce qui s'est passé.

## Ce que ça veut dire pour l'opérateur

Quatre points à retenir.

**Le BEC est ce qui rend toutes les attaques précédentes profitables.** Chaque contrôle défensif des leçons 1–5 est, en effet, une atténuation du BEC. Quand vous recommandez un MFA résistant à l'hameçonnage ou un AC d'appareil conforme à un client, le pitch en ascenseur est : « c'est ce qui arrête l'attaque silencieuse de fraude par facture qui a coûté aux entreprises américaines 8,5 milliards $ dans les trois dernières années. »

**Les règles de boîte de réception sont le donneur de BEC.** Quand une alerte de connexion d'IP étrangère atterrit, la prochaine vérification immédiate est les règles de boîte de réception de l'utilisateur. Nouvelle règle avec des actions « transférer vers » ou « déplacer vers Flux RSS » sur des mots-clés financiers? C'est une opération BEC active. Ouvrez le billet en sévérité-élevée et commencez le manuel.

**Le « temps de séjour de quatre-vingt-dix jours » est réel.** Quand vous découvrez du BEC, regardez en arrière au moins trois mois dans le journal d'audit. L'attaquant a souvent été silencieux pendant des semaines. Tout ce que vous voyez dans les 30 derniers jours est la pointe; l'étendue complète va habituellement plus loin en arrière.

**Le BEC est un problème de formation financière autant qu'un problème de technologie de sécurité.** Les contrôles techniques coupent la surface d'attaque; le contrôle culturel (« ne jamais accepter un changement bancaire par courriel; toujours vérifier hors-bande ») coupe l'impact. Assurez-vous que vos engagements clients incluent la conversation avec l'équipe finance, pas juste la conversation avec l'équipe IT.

## Ce qui suit

- **Leçon 7 : Quand le MSP est la cible.** L'attaque en direction inverse. Vos clients dépendent de vous; tout attaquant qui veut leurs données aussi. La compromission de la chaîne d'approvisionnement d'un MSP est une réalité de 2026 vers laquelle toute la carte mène : chaque attaque de cette leçon, multipliée par 30 ou 100 si l'attaquant atteint le MSP en premier.

Pour l'instant : le BEC est l'encaissement, la raison pour laquelle tout le reste existe, et la plus grande catégorie de perte de cybercriminalité dans les livres du FBI depuis les trois dernières années consécutives. La compromission elle-même est *le* problème commercial contre lequel vous protégez les clients. Traitez chaque alerte dans cette carte avec le dénouement BEC en tête.

---

*Sources des données dans cette leçon — données de perte BEC de l'IC3 du FBI 2024 ([FBI IC3 2024 Annual Report](https://www.ic3.gov/AnnualReport/Reports/2024_IC3Report.pdf)); chiffre agrégé des pertes BEC sur trois ans ([Nacha — IC3 finds $8.5B BEC losses](https://www.nacha.org/news/fbis-ic3-finds-almost-85-billion-lost-business-email-compromise-last-three-years)); Microsoft sur le blocage du transfert externe au niveau boîte aux lettres ([Microsoft Learn — Block external email auto-forwarding](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-policies-external-email-forwarding)); Attack Disruption lié au BEC de Defender XDR ([Microsoft Learn — Automatic attack disruption](https://learn.microsoft.com/en-us/defender-xdr/automatic-attack-disruption)); politiques anti-usurpation de Defender for Office 365 ([Microsoft Learn — Anti-phishing policies](https://learn.microsoft.com/en-us/defender-office-365/anti-phishing-policies-about)).*
