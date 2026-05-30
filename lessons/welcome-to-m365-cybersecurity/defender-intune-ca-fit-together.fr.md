---
title: "Defender, Intune, accès conditionnel — comment ils s'imbriquent vraiment"
subtitle: "La boucle de conformité en cinq étapes : comment Intune, Defender et l'accès conditionnel se passent le relais dans Entra pour prendre chaque décision de connexion."
icon: "puzzle"
last_updated: 2026-05-29
---

# Defender, Intune, accès conditionnel — comment ils s'imbriquent vraiment

Vous recevez un billet à 9 h 14. *« Karen ne peut pas se connecter à Outlook depuis son portable. Elle vient de changer son mot de passe la semaine passée. SVP aidez. »*

Vous ouvrez trois onglets de navigateur. Le premier, c'est le portail d'admin Entra — vous regardez les journaux de connexion de Karen. Le deuxième, c'est le portail Intune — vous regardez l'état de conformité de son appareil. Le troisième, c'est le portail Defender XDR — vous cherchez des alertes sur son compte.

Trois portails. Trois équipes différentes valent l'UI. Trois modèles mentaux différents. Et la réponse à « pourquoi Karen ne peut pas se connecter » vit quelque part dans les trois.

Cette leçon, c'est pourquoi ces trois portails existent, ce qu'est le vrai travail de chacun, et comment trouver la réponse au billet de Karen sans regarder votre montre toutes les trois minutes.

## La boucle de conformité

Si vous ne retenez qu'un diagramme de tout ce programme, ce devrait être celui-ci. C'est la *boucle de conformité*, et c'est le mécanisme central de la sécurité M365 moderne.

```
   ┌─────────────────────────────────────┐
   │ 1. Intune impose une politique sur  │
   │    l'appareil : chiffrement activé, │
   │    OS à jour, antivirus actif.      │
   └─────────────────┬───────────────────┘
                     │
                     ▼
   ┌─────────────────────────────────────┐
   │ 2. L'appareil rapporte son état à   │
   │    Intune (conforme / non conforme).│
   └─────────────────┬───────────────────┘
                     │
                     ▼
   ┌─────────────────────────────────────┐
   │ 3. Intune écrit un attribut         │
   │    « conforme » ou « non conforme » │
   │    sur la fiche d'appareil dans     │
   │    Entra ID.                        │
   └─────────────────┬───────────────────┘
                     │
                     ▼
   ┌─────────────────────────────────────┐
   │ 4. L'utilisateur se connecte.       │
   │    L'accès conditionnel lit         │
   │    l'attribut de conformité sur     │
   │    l'appareil, plus le risque       │
   │    utilisateur / connexion          │
   │    d'Entra ID Protection.           │
   └─────────────────┬───────────────────┘
                     │
                     ▼
   ┌─────────────────────────────────────┐
   │ 5. L'AC décide : autoriser, bloquer,│
   │    autoriser-avec-MFA, ou autoriser │
   │    avec contrôles de session.       │
   └─────────────────────────────────────┘
```

Cinq étapes. Trois produits. Un résultat — une décision à la porte.

Notez ce que le diagramme vous dit aussi : **l'accès conditionnel ne configure pas l'appareil, et Intune n'autorise ni ne bloque les connexions.** Chacun fait exactement une chose, et ils se passent le relais par l'attribut de conformité sur la fiche d'appareil dans Entra. La fiche d'appareil Entra est le pont.

Cette séparation, c'est pourquoi « je ne peux pas me connecter » peut être un problème d'AC, un problème d'Intune *ou* un problème de Defender — et ils ressemblent tous au même de la part de l'utilisateur.

## Le vrai travail de chacun

Faisons le tour de la boucle.

### Intune — l'autorité de l'état des appareils

Le travail d'Intune, c'est *configurer les appareils et vérifier leur état*. Il ne prend pas de décisions de connexion. Il n'attrape pas de maliciel. Il ne bloque pas l'hameçonnage. Il n'enquête pas sur les incidents.

Il :

- **Configure** l'appareil : pousse BitLocker, pousse les politiques Defender, pousse les paramètres du navigateur, pousse les installations d'applications, pousse le fond d'écran si vous êtes cruel.
- **Applique des politiques de conformité** : fixe la barre de ce que « sain » veut dire (version Windows ≥ X, BitLocker activé, signature AV ≤ N jours, pas de jailbreak).
- **Rapporte l'état de conformité** : l'appareil exécute ses politiques, réussit ou échoue, et le rapporte. Cet état arrive comme `isCompliant: true/false` sur la fiche d'appareil dans Entra.
- **Déclenche le déploiement de Defender for Endpoint** : dans la plupart des configurations modernes, Intune est ce qui installe et configure Defender sur chaque appareil.

Si une politique d'accès conditionnel dit « exiger un appareil conforme », Intune est la *source de la réponse* pour cette exigence. Si Intune se trompe sur l'état d'un appareil, l'AC se trompera sur la connexion.

**Où il est configuré :** `intune.microsoft.com` — le centre d'administration Microsoft Intune. (Ancien nom : Microsoft Endpoint Manager. Encore plus ancien : SCCM-sur-Internet.)

### Defender — la couche de détection et de réponse aux menaces

Le travail de Defender, c'est *détecter les comportements malicieux et y répondre*. Il ne configure pas les appareils (Intune fait ça). Il ne prend pas de décisions de connexion (l'AC fait ça). Ce que Defender fait, c'est *surveiller* et, quand la corrélation est assez forte, *réagir*.

« Defender » est en fait une famille de produits :

- **Defender for Endpoint** — s'exécute sur l'appareil. Surveillance comportementale, EDR, remédiation automatique. C'est ce qui attrape les processus de type rançongiciel, les chaînes de scripts suspectes, le vol d'identifiants.
- **Defender for Office 365** — s'exécute sur le flux de courriels et SharePoint. Anti-hameçonnage, Safe Links, Safe Attachments.
- **Defender for Cloud Apps** — s'exécute sur les SaaS enregistrés. Analyse du comportement utilisateur, surveillance des consentements OAuth.
- **Defender for Identity** — s'exécute contre AD local (et la synchronisation hybride). Attrape les patrons de vol d'identifiants et de mouvement latéral.
- **Defender XDR** — la couche de *corrélation* qui prend les signaux de tout ce qui est ci-dessus et les transforme en incidents. (Leçon entière là-dessus juste après — leçon 4.)

Defender ne bloque normalement pas une seule connexion par lui-même. Ce qu'il *fait*, c'est nourrir des signaux de risque dans Entra ID Protection, que l'accès conditionnel peut ensuite lire au moment de l'évaluation de la politique (« le risque de cet utilisateur est élevé → exiger un changement de mot de passe »). Le signal coule dans la même direction que l'état de conformité d'Intune — dans Entra, où l'AC le lit. Même pont, signal différent.

Defender XDR *peut* prendre une action directe via Attack Disruption — désactiver un utilisateur, révoquer ses jetons, contenir un appareil. C'est une exception à la règle « Defender surveille, l'AC décide », et c'est une exception délibérée (corrélation à haute confiance seulement).

**Où il est configuré :** `security.microsoft.com` — le portail Microsoft Defender. (Ancien nom : Microsoft 365 Defender. Ancien : ATP. Encore plus ancien : « on va le renommer le mois prochain ».)

### L'accès conditionnel — le point de décision de la politique

Le travail de l'AC, c'est *évaluer chaque connexion contre un ensemble de conditions* et décider quoi faire. C'est le seul produit des trois qui prend une décision oui / non en temps réel.

Une politique d'AC a quatre parties :

- **Qui** — à quels utilisateurs ou groupes elle s'applique (inclure / exclure).
- **Quoi** — quelles applications ou actions (Exchange, SharePoint, « toutes les applications infonuagiques », opérations administratives sensibles).
- **Conditions** — le contexte : état de l'appareil, emplacement, risque de la connexion, risque de l'utilisateur, application cliente, plateforme.
- **Contrôles** — quoi faire si la politique correspond : bloquer, exiger MFA, exiger un appareil conforme, exiger Hybrid join, appliquer des contrôles de session (fréquence de connexion, Token Protection).

Les décisions que l'AC prend sont *la* frontière de sécurité M365 en pratique. Si vous avez une bonne politique d'AC en place — « les utilisateurs peuvent lire leur courrier seulement depuis un appareil conforme, ou après MFA depuis un emplacement de confiance » — la plupart des menaces de la carte 2 échouent purement ou déclenchent une détection ailleurs dans la pile.

Ce que l'AC ne fait *pas* :

- Il ne configure pas les appareils. (Intune.)
- Il n'attrape pas le maliciel. (Defender for Endpoint.)
- Il ne bloque pas les courriels d'hameçonnage. (Defender for Office 365.)
- Il n'enquête pas sur les incidents. (Defender XDR.)

**Où il est configuré :** `entra.microsoft.com` (ou l'ancien `portal.azure.com` → Entra ID → Sécurité → Accès conditionnel). Le centre d'administration Microsoft Entra.

## Trois portails, un modèle mental

L'éparpillement à trois portails est réel. Microsoft promet depuis des années de les consolider. Ils ne l'ont pas fait, et on peut soutenir qu'ils ne le feront pas, parce que chaque portail a un public différent à l'interne chez Microsoft (équipe Endpoint, équipe Sécurité, équipe Identité) et une cadence de livraison différente.

Le modèle mental qui rend l'éparpillement gérable :

| Question | Portail |
|---|---|
| « Est-ce que cet appareil est sain? » | Intune |
| « Est-ce que quelque chose de malicieux se passe? » | Defender |
| « Est-ce que cette connexion a été autorisée, et pourquoi? » | Entra (journaux de connexion + accès conditionnel) |

Quand on revient au billet de Karen, la question « pourquoi elle ne peut pas se connecter? » se décompose par portail :

- Si le **journal de connexion dans Entra** dit « bloqué par la politique d'accès conditionnel *X* » → problème d'AC. Ouvrez cette politique dans Entra, regardez les conditions correspondantes, trouvez celle qui échoue.
- Si la connexion a réussi mais que Outlook lance des erreurs d'accès, et que l'**appareil montre non-conforme dans Intune** → problème d'Intune. Ouvrez la politique de conformité, voyez ce qui échoue sur l'appareil (probablement BitLocker désactivé ou OS pas à jour).
- Si la **connexion est autorisée et l'appareil est conforme**, mais que l'utilisateur est éjecté à répétition et qu'il y a des **alertes Defender** sur le compte → probablement une révocation de jeton par Defender XDR Attack Disruption. Ce qui, quelque part sous la frustration, est une *bonne* chose — quelqu'un vient de hameçonner Karen et le système l'a attrapé.

Même billet, trois causes racines complètement différentes, trois remèdes complètement différents.

## Mauvaises configurations courantes, et comment elles se manifestent

Un petit guide de terrain, parce que celles-ci reviennent encore et encore.

**Politique d'AC qui exclut le mauvais groupe.** « Exiger MFA pour tous les utilisateurs » avec l'exclusion « Invités » appliquée par erreur à un groupe synchronisé qui inclut une partie du personnel. La moitié du personnel ne se fait pas appliquer le MFA. L'alerte MFA-désactivée dans Panoptica365 va se déclencher sur ces utilisateurs; avant de présumer que c'est un problème de méthodes d'authentification par utilisateur, vérifiez la liste d'exclusion de l'AC. Le bogue est presque toujours au niveau de la politique, pas au niveau de l'utilisateur.

**Politique de conformité Intune trop laxiste.** « Exiger BitLocker » sonne bien, mais si la politique ne *fait pas échouer* l'appareil quand BitLocker est désactivé, les appareils peuvent rapporter conformes sans être réellement chiffrés. Vérifiez les conditions d'échec de la politique de conformité, pas seulement son état cible. Une politique de conformité sans dents est pire qu'aucune politique — elle vous donne une fausse confiance.

**Defender for Endpoint pas déployé sur tous les appareils.** Intune est *censé* pousser Defender, mais les groupes d'exclusion, les variantes d'OS, ou les appareils pré-Intune passent au travers. Des appareils apparaissent dans Intune mais pas dans Defender. L'inventaire d'appareils de Defender XDR et la liste d'appareils Intune devraient correspondre à quelques pour cent près; s'ils sont très différents, quelque chose manque. Faites cette réconciliation périodiquement.

**Politique d'AC en « Report-only » laissée pour toujours.** Le mode Report-only est super pour tester — l'AC évalue la politique et journalise ce qui se serait passé, mais ne l'applique pas en réalité. L'erreur, c'est de livrer une politique en Report-only et d'oublier de la basculer à On. La politique « existe » mais n'applique rien. Le détecteur de dérive AC de Panoptica365 ne va pas signaler ça tout seul; vous devez vérifier l'état des politiques à la main. Oui, c'est énervant. Oui, on le sait.

**Defender alerte sur un utilisateur mais l'AC ne capte pas le risque.** Entra ID Protection P2 est requis pour l'AC basé sur le risque. Si le client est sur Business Premium (P1 seulement), l'AC ne peut pas lire le signal de risque utilisateur même quand Defender le génère. L'alerte reste là. L'utilisateur se connecte quand même. C'est un des plus forts arguments pour faire passer les tenants à plus haut risque à E5 — couvert dans la leçon 5.

## Ce que ça veut dire pour l'opérateur

Deux points pratiques.

**Quand quelque chose va mal, nommez la couche d'abord.** « La connexion a échoué » n'est pas une cause racine; c'est un symptôme. La cause racine vit dans l'AC, dans Intune, dans Defender, ou directement dans les méthodes d'authentification de l'utilisateur. Identifier la couche avant de commencer à changer des paramètres, c'est la différence entre une correction de 10 minutes et une partie de pêche de 90 minutes à travers trois portails.

**La plupart de votre *temps* dans cette pile sera passée sur l'accès conditionnel.** Intune se configure-et-revisite. Defender se gère largement tout seul. L'AC demande une attention continue — chaque nouvelle application, chaque nouveau groupe d'utilisateurs, chaque nouvelle exigence de conformité crée de la pression sur l'ensemble des politiques d'AC. C'est pour ça que la carte 3 est entièrement dédiée aux politiques de modèles d'AC. Les autres outils sont configurés; l'AC est *opéré*.

## Ce qui suit

- **Leçon 4 : Defender XDR — ce que c'est, ce que ce n'est pas.** On a parlé de lui comme de la couche de corrélation; la leçon 4 est le plongeon profond sur pourquoi XDR n'est pas EDR, n'est pas SIEM, et n'est pas un produit unique.
- **Leçon 5 : Les licences Microsoft 365 — qu'est-ce qui débloque quoi.** La raison pour laquelle Entra ID Protection (et l'AC basé sur le risque) n'est pas disponible dans chaque tenant.
- **Leçon 6 : Où Panoptica365 s'installe dans le tableau.** Indice : il ne remplace aucun de ces trois portails. Il rend juste la moitié-observation du travail gérable.

Pour l'instant : trois portails, trois travaux, une boucle. Intune produit des signaux de confiance. Defender produit des signaux de risque. L'accès conditionnel lit les deux et décide. Chaque connexion dans M365 exécute cette boucle.

---

*Sources des données dans cette leçon — Microsoft Learn sur la boucle de conformité de l'accès conditionnel et l'évaluation d'état d'appareil ([Microsoft Learn — Construire une politique d'accès conditionnel](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-policies)); Microsoft Learn — mécaniques d'Attack Disruption de Defender XDR ([Microsoft Learn — Automatic attack disruption](https://learn.microsoft.com/en-us/defender-xdr/automatic-attack-disruption)); référence des politiques de conformité Intune ([Microsoft Learn — Use compliance policies](https://learn.microsoft.com/en-us/mem/intune/protect/device-compliance-get-started)).*
