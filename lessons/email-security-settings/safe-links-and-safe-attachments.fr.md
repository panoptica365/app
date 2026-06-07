---
title: "Safe Links et Safe Attachments — ce que votre client a payé et n'utilise pas"
subtitle: "Activer l'encapsulation de liens et le bac à sable de pièces jointes de Defender for Office 365 — et comprendre ce qu'ils détectent ou non."
icon: "link"
last_updated: 2026-05-29
---

# Safe Links et Safe Attachments — ce que votre client a payé et n'utilise pas

Une firme comptable reçoit un courriel de facture d'un fournisseur avec lequel elle travaille vraiment. Le domaine du fournisseur s'authentifie correctement. Le nom d'affichage correspond. Le fichier joint est un PDF qui s'ouvre et ressemble à une facture normale. Le PDF contient un bouton : « Voir le portail de paiement. » L'utilisatrice clique sur le bouton. Le bouton est un hyperlien. L'hyperlien va vers un récolteur d'identifiants qui ressemble pixel pour pixel à la page de connexion de Microsoft, hébergé sur un domaine fraîchement enregistré avec un certificat Let's Encrypt tout neuf. L'utilisatrice tape son mot de passe M365. L'attaquant le capture, plus le cookie de session via Evilginx2. Vingt minutes plus tard, l'attaquant lit le courriel de l'utilisatrice et ajoute une règle de boîte de réception pour cacher ses traces.

Le client a Microsoft 365 Business Premium. Il paie pour Defender for Office 365 Plan 1 depuis deux ans. Safe Links aurait encapsulé l'hyperlien du PDF au moment de la livraison. Safe Attachments aurait fait détoner le PDF dans un bac à sable avant qu'il atteigne l'utilisatrice. Ni l'un ni l'autre n'étaient configurés. Les fonctionnalités que le client payait sont restées dormantes pendant que la chaîne d'attaque s'est déroulée de bout en bout.

Cette leçon vise à activer ces fonctionnalités, à comprendre ce qu'elles attrapent, et à être honnête sur ce qu'elles n'attrapent pas.

## Safe Links — comment l'encapsulation fonctionne vraiment

Quand Safe Links est activé, chaque URL dans un courriel entrant est *réécrite* au moment de la livraison. L'original `https://realdomain.com/path` devient quelque chose comme `https://nam04.safelinks.protection.outlook.com/?url=https%3A%2F%2Frealdomain.com%2Fpath&...`. L'utilisateur voit l'URL originale au survol (la plupart des clients affichent le texte encapsulé mais résolvent vers l'original au survol); il voit la destination originale s'il clique et que Microsoft réussit la vérification.

Au moment du clic, trois choses se passent :

1. **Le renseignement sur les menaces de Microsoft vérifie l'URL de destination** contre la base de données de réputation de Defender. Les URL connues-malveillantes sont bloquées au moment du clic, même si l'URL était propre à la livraison.
2. **Pour les URL inconnues, Microsoft peut les faire détoner en temps réel** — en fetchant la destination depuis un bac à sable, en évaluant le comportement de la page, et en décidant d'autoriser ou bloquer.
3. **L'utilisateur est laissé passer, bloqué avec une page d'avertissement, ou montré une page intermédiaire « soyez prudent »** selon le verdict.

C'est la valeur ajoutée par rapport à une liste de blocage statique. Un lien d'hameçonnage qui était propre à 9 h 00 (quand le courriel a été livré) et est devenu malveillant à 15 h 00 (quand le renseignement sur les menaces l'a repéré) se fait attraper au clic de 16 h 00. Le même domaine bloqué pour un tenant client est bloqué sur chaque tenant protégé par Defender, en quelques secondes.

**Paramètres qui méritent d'être connus :**

- **« Suivre les clics utilisateur »** — télémétrie sur qui a cliqué quoi. Activé. Les données apparaissent dans les rapports de menaces MDO.
- **« Ne pas réécrire les URL suivantes »** — liste d'exclusion pour les URL légitimes qui brisent quand encapsulées. Utilisez avec parcimonie; c'est l'équivalent Safe Links de la liste d'expéditeurs de confiance (et la même discipline s'applique — ne contournez pas sans raison).
- **« Laisser les utilisateurs cliquer jusqu'à l'URL originale »** — quand Safe Links bloque quelque chose, ce paramètre contrôle si les utilisateurs peuvent passer outre. Pour le durcissement, ça devrait être **désactivé**. Laisser les utilisateurs cliquer jusqu'au bout veut dire qu'ils le feront, et l'encapsulation devient décorative.
- **« Afficher la marque de l'organisation »** — cosmétique; vous laisse mettre le logo du client sur la page d'avertissement. Vaut la peine pour la conversation que ça démarre quand un utilisateur le voit.

## Safe Attachments — le bac à sable de détonation

Quand Safe Attachments est activé, les courriels entrants avec pièces jointes sont retenus dans un bac à sable Microsoft. La pièce jointe est ouverte, son comportement observé (création de processus, appels réseau, écritures de registre, exécution de macros, tout), et un verdict produit. Les temps de scan communs sont sous une minute; les fichiers complexes peuvent prendre plus longtemps.

Le verdict pilote l'une de quatre actions, choisie par politique :

- **Block** — les pièces jointes malveillantes arrêtent la livraison entièrement; le courriel arrive sans la pièce jointe, ou n'arrive pas du tout (configurable).
- **Replace** — la pièce jointe est enlevée, le corps du courriel arrive quand même, avec une notification expliquant ce qui s'est passé.
- **Dynamic Delivery** — le courriel arrive immédiatement avec un placeholder, la vraie pièce jointe est ajoutée une fois que le bac à sable est terminé. L'utilisateur peut lire le corps du courriel pendant que le scan tourne. Meilleur équilibre entre sécurité et expérience utilisateur pour la PME.
- **Monitor** — audit seulement; la pièce jointe est livrée inchangée, mais les verdicts malveillants sont journalisés. Utile pour tester; pas une posture de production.

Pour la plupart des tenants PME, **Dynamic Delivery** est la bonne action. Les utilisateurs obtiennent le corps du courriel immédiatement (pas de tickets « où est mon courriel? »), la pièce jointe apparaît une minute plus tard, et les pièces jointes malveillantes n'arrivent jamais du tout.

**Safe Documents** est une fonctionnalité connexe dans Microsoft 365 Apps for enterprise (licence niveau E5) qui ouvre les documents provenant de sources externes en Protected View et les analyse via Microsoft Defender for Endpoint avant de laisser les utilisateurs éditer. Bon à savoir; pas dans Business Premium.

## SafeLinks-for-Office — liens à l'intérieur des documents et Teams

Safe Links était à l'origine courriel-seulement. Mais les attaquants ont compris qu'on pouvait livrer un courriel propre avec un document Word propre, et mettre le lien malveillant *à l'intérieur* du document Word. Le lien n'était jamais encapsulé parce que Safe Links ne touchait pas au document. L'utilisateur ouvre Word, clique sur le lien, se fait hameçonner. Contournement de Safe Links.

Microsoft a réglé ça. **SafeLinks-for-Office** étend l'évaluation d'URL à :

- Word, Excel, PowerPoint, OneNote (bureau et web)
- Discussions, canaux et publications Microsoft Teams
- Visio (bureau et web)

Quand un utilisateur clique sur un lien à l'intérieur de l'un de ceux-là, l'URL est vérifiée contre le renseignement sur les menaces de Microsoft de la même façon qu'un lien livré par courriel le serait. Ça ferme le chemin d'évasion le plus commun.

**Paramètre :** « Protect Office 365 apps » — devrait être **activé** dans la politique Safe Links. Ça fait partie du préréglage Standard; avec les politiques personnalisées, il faut se souvenir de l'activer.

## Ce qu'ils attrapent, ce qu'ils manquent — soyez honnête

Safe Links et Safe Attachments sont des défenses en couches, pas des balles d'argent. L'anecdote d'ouverture est réelle parce que les deux fonctionnalités ont de vraies limites.

**Safe Links attrape :**

- Les URL vers des destinations connues-malveillantes
- Les URL vers des destinations qui deviennent malveillantes entre la livraison et le clic
- Les URL vers des domaines tout neufs avec des caractéristiques que l'apprentissage machine de Microsoft reconnaît (âge d'enregistrement, réputation d'hébergement, empreinte de contenu)
- Les URL qui évadent l'analyse statique pré-clic mais échouent à la détonation dynamique

**Safe Links manque :**

- Les domaines d'hameçonnage tout neufs avec TLS valide, sans couverture de renseignement sur les menaces encore, et une UI de connexion Microsoft-parfaite. Le récolteur d'identifiants de l'anecdote d'ouverture est exactement ce cas. Safe Links vérifie; le renseignement sur les menaces n'a pas encore catégorisé le domaine; la page se rend correctement dans le bac à sable; l'URL passe. L'utilisateur atterrit sur l'hameçonnage.
- Les sites d'affaires légitimes mais compromis. Un site WordPress légitime se fait pirater, l'attaquant héberge le récolteur d'identifiants sur le domaine légitime pendant six heures, Safe Links voit un domaine avec bonne réputation et laisse passer l'URL.
- Les URL livrées hors bande (SMS, WhatsApp, l'utilisateur qui tape une URL qu'il se souvient d'un appel téléphonique). Safe Links ne protège que ce qui coule à travers les surfaces courriel ou document de M365.

**Safe Attachments attrape :**

- Les maliciels avec des patrons de comportement reconnaissables dans un bac à sable
- Les documents avec des macros malveillantes qui s'exécutent à l'ouverture
- Les fichiers avec des hashes connus-malveillants
- Les fichiers qui correspondent aux signatures de détection d'apprentissage machine de Microsoft pour des maliciels nouveaux

**Safe Attachments manque :**

- Les archives protégées par mot de passe. Microsoft ne peut pas ouvrir les fichiers `.zip` avec mots de passe; le bac à sable ne peut pas faire détoner ce qu'il ne peut pas déballer. Les attaquants le savent et l'utilisent constamment. Le mot de passe est obligeamment fourni dans le corps du courriel : « Mot de passe : 12345. »
- Les fichiers qui détectent l'environnement du bac à sable et se comportent benignement à l'intérieur. Certains maliciels vérifient des indicateurs de virtualisation, du mouvement de souris, ou des processus Office spécifiques avant de s'activer.
- Les charges utiles « living-off-the-land ». La pièce jointe elle-même n'est pas malveillante; elle déclenche un flux de travail qui utilise des binaires Windows légitimes (mshta.exe, certutil.exe, PowerShell) pour faire du mal. Le bac à sable ne voit rien de mal avec le document.
- Les charges utiles basées sur le cloud. Le document ne contient pas de maliciel; il contient un lien vers une charge utile hébergée dans le cloud qui se charge au moment de l'exécution. Safe Attachments voit un document propre; Safe Links peut ou non attraper le lien cloud selon la réputation.

**Ce qu'il faut retenir :** ces fonctionnalités sont *nécessaires mais pas suffisantes*. Elles attrapent le gros de l'hameçonnage et des maliciels de masse. Elles n'attrapent pas un attaquant déterminé construisant un flux AiTM personnalisé contre votre client. C'est pour ça que le reste du curriculum existe — Conditional Access, MFA résistant à l'hameçonnage, protection anti-hameçonnage contre l'usurpation d'identité, formation des utilisateurs. Défense en couches. Safe Links et Safe Attachments sont deux des couches.

## Configuration — la partie pratique

Par défaut, aucune des deux fonctionnalités n'a de politique assignée à personne. Vous devez créer les politiques et les assigner à des groupes d'utilisateurs.

**Pour la plupart des clients PME, la bonne configuration de départ :**

- Appliquer la **politique de sécurité prédéfinie Standard** à tous les utilisateurs. Ça crée des politiques Safe Links et Safe Attachments avec les défauts sélectionnés par Microsoft, les assigne à tous les utilisateurs du tenant, et active SafeLinks-for-Office. Fait en trois clics.
- Si le client a un profil de risque plus élevé (finance, juridique, santé, marchés publics), appliquer **Strict** à la place.

**Pour les clients qui ont besoin d'une configuration personnalisée :**

- Créez une politique Safe Links personnalisée avec les paramètres ci-dessus (suivi des clics activé, pas de passe-droit utilisateur, protection des apps Office activée, pas d'exclusions de réécriture sauf si nécessaire).
- Créez une politique Safe Attachments personnalisée avec **Dynamic Delivery** comme action.
- Assignez les deux à tous les utilisateurs (ou à la bonne portée; la leçon 10 couvre la portée préréglage-et-superposition).

L'approche prédéfinie est la bonne pour la plupart. L'approche personnalisée est pour les clients avec des exclusions spécifiques à gérer ou des actions spécifiques à régler.

## Ce qui peut briser

**Le ticket « Safe Links bloque notre portail fournisseur ».** L'URL du portail d'un fournisseur légitime se fait encapsuler, l'URL encapsulée ne se rend pas correctement parce que le site du fournisseur utilise des jetons de session qui ne survivent pas à l'encapsulation, l'utilisateur ne peut pas entrer. La correction est d'ajouter le domaine du fournisseur à la liste « ne pas réécrire » — *pas* d'éteindre Safe Links pour l'utilisateur. (Même discipline que les expéditeurs de confiance dans la leçon 2.)

**Plaintes de délai de livraison des pièces jointes.** Sans Dynamic Delivery, les utilisateurs attendent jusqu'à une minute pour que la pièce jointe soit analysée avant que le courriel arrive. Frustrant pour les dirigeants qui s'attendent à avoir une pièce jointe *là*. Dynamic Delivery règle ça — le corps du courriel arrive immédiatement, la pièce jointe se remplit. Si Dynamic Delivery n'est pas activé, attendez-vous à des tickets dans la première semaine.

**Documents légitimes lourds en macros qui se font signaler.** Une macro Excel légitime qui fait quelque chose d'inhabituel (un flux d'automatisation complexe, un outil de rapport avec macros) peut déclencher Safe Attachments. La correction est soit une autorisation au niveau de la pièce jointe (rare; hash de fichier spécifique) soit une autorisation au niveau de l'expéditeur (plus commun; partenaire de confiance). La même discipline que les expéditeurs de confiance d'anti-hameçonnage s'applique — vérifiez s'il y a une raison pour laquelle le fichier est signalé avant d'ajouter l'exception.

## Déploiement

Pour Safe Links spécifiquement, déployez via le **préréglage Standard ou Strict** pour toute la base d'utilisateurs dès le jour 0. L'action de blocage ne se déclenche que sur des URL réellement malveillantes, donc les dommages collatéraux sont rares. La cassure la plus commune est le cas « portail fournisseur » ci-dessus, qui remonte sous forme de tickets dans la première semaine et se résout avec des exclusions ciblées.

Pour Safe Attachments, même chose — déploiement par préréglage, action Dynamic Delivery pour que les utilisateurs ne remarquent pas le délai de scan, exclusions pour les flux de travail connus lourds en macros légitimes ajoutées au fur et à mesure qu'elles remontent.

Le patron de déploiement en mode Audit (leçon 1 de la carte 4) ne s'applique pas vraiment ici — ces fonctionnalités sont à trop faible impact pour justifier une fenêtre d'audit de 30 jours. Le déploiement direct est la norme.

## Ce que Panoptica365 voit

Deux choses pertinentes pour cette leçon :

- **Dérive sur l'activation de la politique de sécurité prédéfinie.** Si le tenant d'un client a Safe Links et Safe Attachments déployés via le préréglage Standard ou Strict (le chemin recommandé), Panoptica365 surveille si le préréglage reste activé. Quelqu'un qui désactive le préréglage — par erreur ou en réponse à une plainte de client — déclenche une alerte de dérive. L'opérateur peut revenir, réappliquer, ou accepter.
- **Les événements de détection Defender for Office 365 coulent à travers Defender XDR.** Quand Safe Links bloque une URL au moment du clic ou que Safe Attachments met en quarantaine un fichier malveillant, l'événement de détection sous-jacent fait partie de la télémétrie MDO de Microsoft. Quand l'ingestion Defender XDR est configurée pour le client (carte 1 leçon 4), les incidents MDO de gravité élevée coulent dans le moteur d'alertes de Panoptica365.

Ce que Panoptica365 ne fait pas remonter aujourd'hui : les taux de clic par utilisateur à travers Safe Links, les résultats de scan par pièce jointe, les vues de traqueur de menaces du portail Defender. Ce sont des surfaces du portail Microsoft Defender; plongez-y pour le diagnostic profond.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**Ce sont les fonctionnalités que les clients ont payées et n'utilisent pas.** La plupart des clients PME avec Business Premium ont Safe Links et Safe Attachments sous licence. La plupart les ont non configurés. Le mouvement à plus fort levier pour un MSP qui prend en charge un nouveau client est d'activer le préréglage Standard — trois clics, valeur immédiate, aucune configuration par utilisateur.

**Soyez honnête sur les limites.** Safe Links et Safe Attachments attrapent l'hameçonnage et les maliciels de masse qui frappent les tenants PME quotidiennement. Ils n'attrapent pas une opération AiTM personnalisée déterminée, une archive protégée par mot de passe, ou une charge utile qui évade le bac à sable. Dites-le aux clients. L'histoire de défense en couches (Safe Links + protection contre l'usurpation d'identité + Conditional Access + MFA résistant à l'hameçonnage + formation des utilisateurs) est le bon pitch — pas « on a activé Safe Links et maintenant vous êtes pare-balle ».

**Dynamic Delivery est la bonne action Safe Attachments.** Bloquer la livraison de la pièce jointe pendant que le bac à sable analyse, c'est la différence entre les utilisateurs qui tolèrent Safe Attachments et les utilisateurs qui le détestent. Mettez l'action à Dynamic Delivery; le corps du courriel arrive instantanément; la pièce jointe se remplit; personne ne remarque le travail de sécurité.

## Ce qui suit

- **Leçon 4 : SPF, DKIM, DMARC.** Le trio d'authentification qui ferme l'écart côté usurpation. L'autre moitié de ce que l'anti-hameçonnage et Safe Links n'attrapent pas.
- **Leçon 5 : Transfert automatique et règles de boîte de réception.** La paire d'indicateurs post-compromission — ce qui arrive après qu'un attaquant est déjà à l'intérieur, et comment les repérer.

Pour l'instant : ouvrez le portail Defender du client. Regardez la surface des politiques de sécurité prédéfinies. Si le préréglage Standard ou Strict n'est pas activé, vous avez trouvé le changement à plus fort impact que vous puissiez faire cette semaine. Trois clics. Les fonctionnalités que le client paie déjà commencent enfin à faire leur travail.

---

*Sources des données dans cette leçon — Microsoft Learn sur Safe Links — vue d'ensemble ([Microsoft Learn — Safe Links in Defender for Office 365](https://learn.microsoft.com/en-us/defender-office-365/safe-links-about)); configuration des politiques Safe Links ([Microsoft Learn — Set up Safe Links policies](https://learn.microsoft.com/en-us/defender-office-365/safe-links-policies-configure)); vue d'ensemble Safe Attachments et paramètres de politique ([Microsoft Learn — Safe Attachments](https://learn.microsoft.com/en-us/defender-office-365/safe-attachments-about)); action Dynamic Delivery expliquée ([Microsoft Learn — Dynamic Delivery in Safe Attachments](https://learn.microsoft.com/en-us/defender-office-365/safe-attachments-policies-configure)); couverture SafeLinks-for-Office et Teams ([Microsoft Learn — Safe Links for Microsoft Teams](https://learn.microsoft.com/en-us/defender-office-365/safe-links-about#safe-links-settings-for-email-messages)); bundle des politiques de sécurité prédéfinies ([Microsoft Learn — Preset security policies](https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies)).*
