---
title: "Les licences Microsoft 365 — qu'est-ce qui débloque quoi"
subtitle: "De Business Basic à E5 — quel palier de licence débloque l'accès conditionnel, Intune, Defender for Endpoint et la protection d'identité basée sur le risque."
icon: "key"
last_updated: 2026-05-29
---

# Les licences Microsoft 365 — qu'est-ce qui débloque quoi

La stratégie de licences de Microsoft peut être résumée en une phrase : *amener plus de clients vers Business Premium ou E5*.

Une fois que vous voyez la stratégie, tout le catalogue de licences commence à avoir du sens. Pourquoi est-ce que Business Standard reste manifestement sous-équipé sur la sécurité? Parce que Microsoft veut que les clients Standard montent à Premium. Pourquoi est-ce qu'E3 reçoit de nouvelles fonctions à chaque hausse de prix? Parce que Microsoft veut faire d'E3 l'étape évidente entre Premium et E5. Pourquoi est-ce qu'E5 garde les capacités Defender les plus intéressantes verrouillées derrière lui? Parce que c'est là où vit la marge.

Je vous dis ça d'entrée parce que les décisions de licence sont la conversation la plus levier qu'un MSP a avec un client. Bon palier et la plupart des contrôles de ce programme fonctionnent juste. Mauvais palier — laisser un client sur Business Standard, par exemple — et environ la moitié de ce que vous avez appris dans les cartes 2 à 6 devient inaccessible, peu importe à quel point vous essayez fort.

Cette leçon, c'est la carte des licences, une lecture honnête de chaque palier, et comment utiliser le palier dans les conversations avec les clients.

## La grille de prix actuelle (en vigueur le 1er juillet 2026)

Microsoft vient juste d'augmenter les prix sur la plupart des paliers. Engagement annuel, par utilisateur, par mois, en USD :

| Palier | Prix (post-juillet 2026) | Prix précédent |
|---|---|---|
| Business Basic | ~6 $ | ~6 $ (stable) |
| Business Standard | 14 $ | 12,50 $ |
| **Business Premium** | **22 $** | **22 $ (stable)** |
| Microsoft 365 E3 | 39 $ | 36 $ |
| Microsoft 365 E5 | 60 $ | 57 $ |

Notez ce que Microsoft a fait. **Business Premium n'a pas monté.** Business Standard a monté de 12 %. E3 et E5 ont monté de 8 % et 5 % respectivement. Le gel du prix de Premium n'est pas de la générosité; c'est un signal. Ils veulent que les clients Standard trouvent Premium encore plus attrayant, et ils viennent juste d'ajouter une liste significative de capacités à Premium et E3 en même temps. Le prix *est* le marketing.

## Ce que chaque palier débloque vraiment (sécurité seulement)

La matrice complète des fonctionnalités est tentaculaire. Ci-dessous, la tranche sécurité-seulement — les parties qui comptent pour le programme que vous lisez.

### Business Basic — ~6 $/utilisateur/mois

Courriel et les applications Office Web. **Exchange Online Protection (EOP)** pour anti-pourriel et anti-maliciel de base sur le flux de courriel. Pas d'accès conditionnel. Pas d'application de MFA au niveau de la licence (vous pouvez quand même activer les valeurs par défaut de sécurité, mais c'est grossier). Pas d'Intune. Pas de Defender au-delà d'EOP.

En termes de sécurité, Business Basic, c'est « M365 est techniquement présent ». Si un client est sur ce palier et que vous êtes responsable de sa sécurité, vous *le protégez avec les outils qu'il possède*, c'est-à-dire presque aucun.

### Business Standard — 14 $/utilisateur/mois (post-juillet 2026)

Ajoute les applications Office de bureau et quelques fonctions d'affaires (Bookings, Forms, MileIQ). Côté sécurité, **identique à Basic.** Pas d'Intune. Pas de Defender for Business. Pas d'Entra ID P1. Pas d'accès conditionnel.

C'est le palier piège. Les clients pensent qu'ils sont « sur Office 365 » et présument que ça inclut la sécurité. Ce n'est pas le cas. Les clients Standard ne peuvent pas utiliser l'accès conditionnel, ne peuvent pas gérer d'appareils via Intune, ne peuvent pas appliquer d'anti-hameçonnage significatif au-delà de la base EOP. Si un client est à Standard et qu'un attaquant l'hameçonne, vos options de réponse se limitent à « réinitialiser son mot de passe » — qu'on a déjà établi (leçon 1, carte 2) n'être pas suffisant en 2026.

### Business Premium — 22 $/utilisateur/mois

Le premier palier avec de vrais outils de sécurité, et le palier le plus important de toute cette leçon.

- **Intune Plan 1** — gestion d'appareils complète, politiques de conformité, déploiement d'applications.
- **Defender for Business** — EDR focalisé PME avec gestion de politiques simplifiée. Moins capable que Defender for Endpoint Plan 2, mais couvre le modèle de menaces pour la plupart des PME.
- **Entra ID P1** — *accès conditionnel*, plus la réinitialisation libre-service de mot de passe, les groupes dynamiques, l'attribution de licences basée sur les groupes.
- **Defender for Office 365 Plan 1** — politiques anti-hameçonnage, Safe Links, Safe Attachments, protection contre l'usurpation d'identité. (Ajouté à Premium et E3 fin 2025.)
- **Information Protection P1** — étiquettes de confidentialité (classification manuelle).
- **Microsoft Purview compliance** — rétention de base et eDiscovery (limité).

Business Premium est la **base de sécurité PME**. C'est le palier le plus bas où les contrôles de ce programme sont la plupart du temps utilisables. Si un client a moins de 300 utilisateurs et qu'il est sur n'importe quoi en dessous de Premium, votre première conversation avec lui devrait porter sur le passage au palier supérieur. Premium est aussi un palier à prix fixe — Microsoft le laisse à 22 $ spécifiquement pour rendre cette conversation plus facile.

Les deux écarts notables de Premium que les opérateurs ressentent :

**Pas d'Entra ID P2.** P2, c'est là que vit Identity Protection (notation basée sur le risque des utilisateurs et des connexions). L'accès conditionnel basé sur le risque — « bloquer la connexion quand le risque utilisateur est élevé » — n'est pas disponible dans Premium. Vous pouvez exiger MFA à travers tous les plans, mais vous ne pouvez pas escalader dynamiquement basé sur la télémétrie de risque propre à Microsoft.

**Pas de Defender XDR complet.** Defender for Business vous donne EDR pour les terminaux, mais ce n'est pas pareil que Defender for Endpoint Plan 2, et plusieurs capacités plus profondes de corrélation inter-produit de Defender XDR (Threat Explorer, Custom Detection Rules à l'échelle, advanced hunting avec longue rétention) sont des fonctionnalités Plan 2 / E5.

Pour 80 % des clients PME, ces écarts ne comptent pas au quotidien. Pour les 20 % autres — industries réglementées, clients avec des données sensibles, clients qui ont déjà été victimes d'une brèche — ils comptent beaucoup.

### Microsoft 365 E3 — 39 $/utilisateur/mois (post-juillet 2026)

Conçu pour les organisations plus grandes ou celles qui veulent la pile Microsoft complète sans le saut Defender for Endpoint Plan 2 / Entra ID P2 vers E5. E3 a été amélioré régulièrement — fin 2025 a ajouté Defender for Office 365 Plan 1 et Intune Plan 2, plus Remote Help et Intune Advanced Analytics.

Comparé à Business Premium, E3 ajoute :

- **Intune Plan 2** — Remote Help, fonctions avancées de gestion d'appareils.
- **Microsoft Defender Antivirus** inclus (c'est l'AV Windows livré — *pas* Defender for Endpoint).
- **Fonctionnalités Office 365 E3** — limites de boîte aux lettres plus hautes, archivage, conformité plus avancée.
- **Aucun plafond d'utilisateurs** — Business Premium est plafonné à 300 utilisateurs.

Ce qu'E3 *ne vous donne pas* que vous pourriez penser :

- **Defender for Endpoint Plan 2** (EDR avec actions de réponse avancées) — E5 seulement.
- **Entra ID P2** (Identity Protection) — E5 seulement.
- **Defender for Identity**, **Defender for Cloud Apps** — E5 seulement.
- **Defender XDR complet** — partiel dans E3; complet seulement à E5.

E3 est, de manière un peu gênante, *moins sécurisé que Business Premium* sur l'axe EDR. Business Premium livre Defender for Business; E3 livre seulement le Defender Antivirus Windows livré. Le bon client E3 paire sa licence avec Defender for Endpoint Plan 1 ou 2 en module additionnel, ou monte à E5.

C'est pourquoi « E3 vs Business Premium » est une vraie conversation avec le client, et pas une conversation avec une réponse en une ligne. Beaucoup de PME finissent mieux protégées sur Premium que sur E3 parce que Premium livre un vrai EDR par défaut.

### Microsoft 365 E5 — 60 $/utilisateur/mois (post-juillet 2026)

La pile complète.

- **Defender for Endpoint Plan 2** — l'EDR complet avec advanced hunting, automatic investigation, six mois de rétention de télémétrie, intégration XDR complète.
- **Defender for Identity** — surveillance d'AD local.
- **Defender for Cloud Apps** — surveillance à l'échelle SaaS et découverte de shadow IT.
- **Defender for Office 365 Plan 2** — ajoute Threat Explorer, Attack Simulation Training, Automated Investigation and Response.
- **Entra ID P2** — Identity Protection (notation du risque), Privileged Identity Management (PIM), revues d'accès.
- **Insider Risk Management** — le module de Purview pour la fuite de données par des initiés.
- **Cloud PKI** — autorité de certification hébergée par Microsoft.
- **Microsoft Security Copilot agents** (déploiement en 2026) — assistance de flux de travail de sécurité pilotée par IA à travers Defender, Entra, Intune, Purview.

E5 est correct pour les clients qui ont une vraie équipe de sécurité, des charges de travail réglementées, ou qui ont demandé à leur MSP « d'être le SOC ». La plupart des PME n'ont pas besoin d'E5; certaines en ont absolument besoin.

## Quand E5 vaut vraiment la peine

Le pitch honnête d'E5, ce n'est pas « plus de fonctions pour plus d'argent ». C'est *trois capacités spécifiques qui ne sont pas disponibles en dessous d'E5*.

**Accès conditionnel basé sur le risque.** Entra ID P2 (E5 seulement) donne à l'accès conditionnel la capacité de lire le risque utilisateur et le risque de connexion depuis Entra ID Protection au moment de la politique. Ça veut dire que vous pouvez écrire « bloquer la connexion quand le risque utilisateur est élevé » au lieu de « exiger MFA tout le temps ». C'est la différence entre du MFA à coup d'instrument grossier et de la sécurité contextuelle. Pour les clients qui voient fréquemment des attaques d'identité sophistiquées, ça compte.

**Defender for Endpoint Plan 2.** L'EDR complet. La couverture de détection comportementale dans Plan 2 est matériellement plus profonde que Defender for Business (Premium) ou Defender Antivirus seul (E3). Inclut Live Response (shell distant dans un appareil pour enquête), Threat & Vulnerability Management complet, six mois de rétention de télémétrie.

**Privileged Identity Management (PIM).** Élévation administrative juste-à-temps. Les admins n'ont pas le Global Admin permanent; ils demandent l'élévation, approuvent par flux de travail, et le rôle est automatiquement révoqué après un temps défini. Pour n'importe quel client où la menace interne est réelle (c'est presque toujours le cas), PIM est une des meilleures atténuations disponibles, et il existe seulement à E5.

Si un client ne bénéficie pas d'au moins deux de ces trois, E5 est probablement excessif. Vendez-leur Business Premium avec une explication claire de *pourquoi* — c'est un pitch plus honnête que de les faire monter pour des raisons de revenu.

## Ce que la hausse de prix de juillet 2026 veut dire pour les conversations clients

Vous aurez des conversations sur les prix avec la plupart de vos clients dans les 6 à 9 prochains mois. Quelques choses à garder en tête.

**Le différentiel de prix entre Standard et Premium vient juste de rétrécir.** Premium est à 22 $, Standard à 14 $. L'écart était de 9,50 $; il est maintenant de 8 $. L'argument pour faire passer les clients de Standard à Premium vient juste de devenir 16 % moins cher à faire. Utilisez-le.

**Les clients seulement-E3 devraient être évalués pour une pression de mise à niveau.** Les clients E3 qui paient 39 $ dépensent presque le double de ce que Premium coûte, mais ils obtiennent *moins de couverture EDR* sur leurs terminaux. Beaucoup devraient soit descendre à Premium (si moins de 300 utilisateurs) soit monter à E5. Rester sur E3 sans Defender for Endpoint Plan 2 en module additionnel, c'est un entre-deux de sécurité qui devrait être revisité.

**E5 est maintenant un client à 60 $.** Les conversations de renouvellement à 60 $ sont différentes de celles à 57 $. Assurez-vous que le client *utilise réellement* assez de la pile E5 pour la justifier — PIM activé et configuré? Identity Protection nourrit-il vraiment des politiques d'AC basées sur le risque? Defender XDR est-il révisé hebdomadairement? Si trois de ces réponses sont « non », le client pourrait payer pour des capacités qu'il n'exploite pas, et vous avez une conversation soit pour ré-ajuster sa licence, *soit* pour l'aider à exploiter ce qu'il possède.

## Ce que ça veut dire pour l'opérateur

Deux points pratiques.

**Connaissez le palier de licence avant de proposer un contrôle.** « Activez l'accès conditionnel basé sur le risque » est une excellente recommandation, sauf qu'elle n'existe pas en dessous d'E5. Recommander des contrôles auxquels le client n'a pas accès, c'est un problème de crédibilité. La conscience des licences dans les alertes de Panoptica365 (la couche d'analyse IA) est en partie là pour empêcher ça — mais vous, l'opérateur, devriez aussi intérioriser quels contrôles exigent quel palier.

**La conversation sur les licences fait partie de la conversation sur la sécurité.** Les MSP qui traitent le palier de licence comme une question de vente et la sécurité comme une question technique séparée ratent ça. La licence *est* la frontière de sécurité. Si vous ne pouvez pas activer l'accès conditionnel, vous ne pouvez pas appliquer les frontières d'identité. Si vous ne pouvez pas déployer Defender for Endpoint, vous ne pouvez pas répondre significativement à un rançongiciel. Vendre Business Premium, c'est vendre de la sécurité; vendre Business Standard, c'est vendre un produit différent de celui que le client pense acheter.

## Ce qui suit

- **Leçon 6 : Où Panoptica365 s'installe dans le tableau.** La dernière leçon d'orientation avant qu'on passe aux vraies menaces et aux vrais contrôles.

Ensuite, la carte 2 (*Menaces identitaires et patrons d'attaque*) commence. À ce moment-là, quand une alerte recommande « MFA résistant à l'hameçonnage » ou « AC basé sur le risque » ou « Defender for Identity », vous saurez si le client peut agir sur cette recommandation ou si la recommandation elle-même est une conversation de mise à niveau de licence déguisée.

Pour l'instant : les licences ne sont pas un détail de facturation. Ce sont la frontière de sécurité. Vendez Business Premium. Traitez Standard comme un trou de sécurité. Traitez E5 comme une dépense justifiée seulement quand le client utilise réellement ses trois capacités différenciées.

---

*Sources des données dans cette leçon — changements de prix et de fonctionnalités Microsoft 365 en vigueur le 1er juillet 2026 ([Microsoft 365 Blog — Advancing Microsoft 365, décembre 2025](https://www.microsoft.com/en-us/microsoft-365/blog/2025/12/04/advancing-microsoft-365-new-capabilities-and-pricing-update/)); matrices de comparaison de plans et de fonctionnalités Microsoft 365 ([Compare Microsoft 365 Enterprise Plans and Pricing](https://www.microsoft.com/en-us/microsoft-365/enterprise/microsoft-365-plans-and-pricing)); analyse Business Premium vs E3 ([TrustedTech — Business Premium or E3?](https://www.trustedtechteam.com/blogs/microsoft-365/business-premium-vs-e3)); résumé des changements de prix Microsoft 365 2026 ([CloudCapsule 2026 pricing analysis](https://blog.cloudcapsule.io/blog/microsoft-365-pricing-changes-in-2026-what-you-really-need-to-know)).*
