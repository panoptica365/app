---
title: "Emplacement de confiance OU appareil conforme — la politique géo intelligente"
subtitle: "Abandonnez le blocage par pays et ses exclusions pour une politique géo qui fait confiance à l'appareil, pas au lieu."
icon: "map-pin"
last_updated: 2026-05-29
---

# Emplacement de confiance OU appareil conforme — la politique géo intelligente

Un MSP qu'on a récemment audité avait une politique d'accès conditionnel sur le tenant d'un client qui disait, simplement, « bloquer la connexion depuis l'extérieur du Canada ». Elle avait été déployée il y a deux ans. La liste d'exclusions avait grandi à trente-huit entrées.

Espagne (pour les vacances du contrôleur en 2023).
États-Unis (pour le vendeur qui voyage aux salons professionnels).
France (pour la visite familiale du dirigeant, mise en place il y a un an).
Mexique (pour le voyage d'hiver du comptable).
Italie (encore active depuis deux étés, quand le CFO a visité sa famille pendant trois semaines).

La plupart de ces exclusions étaient obsolètes. Le vendeur n'était pas allé à un salon américain depuis huit mois, mais l'exception pour les États-Unis était encore en vigueur. L'exclusion pour l'Espagne était pour un contractuel qui n'y travaillait plus. L'exclusion pour l'Italie existait parce que personne ne s'était souvenu de l'enlever.

Chaque exclusion était un trou dans la politique géo. Ensemble, elles équivalaient à « la politique géo est activée, mais tout l'hémisphère occidental plus la majeure partie de l'Europe est exclu pour divers utilisateurs pour des durées inconnues ». Quelle que soit la sécurité que la politique était censée fournir, elle avait été tranquillement échangée un billet du service d'aide à la fois.

Cette leçon est la politique qui n'accumule pas ce genre de dette.

**Panoptica365 - Only allow access from Canada.** Description : *Connexions seulement depuis le Canada ou depuis des appareils conformes.* Octroi : Aucun (bloquer). Utilisateurs : Tous les utilisateurs. Applications : Toutes les applications infonuagiques. Conditions : Emplacements = 1 emplacement (l'emplacement nommé « Canada »).

Le titre de la leçon dit « Canada » parce que c'est le défaut; en pratique, c'est le modèle pour *n'importe quel* patron emplacement-de-confiance-plus-appareil-conforme. On couvrira la personnalisation géographique plus tard dans la leçon.

## Le patron OU est tout l'intérêt

La plupart des outils de sécurité MSP livrent un modèle « bloquer hors emplacement de confiance » qui paraît direct : définir un emplacement nommé, et bloquer les connexions depuis n'importe où ailleurs. Simple, défendable, correspond au modèle de sécurité.

Ça crée aussi le problème d'accumulation d'exceptions. Chaque voyageur est une exception. Chaque contractuel est une exception. Chaque vacance de dirigeant est une exception. Les exceptions s'accumulent, ne se font jamais retirer, et la politique devient tranquillement une défense fine comme du papier.

Le modèle Panoptica365 n'utilise pas ce patron. Il utilise **(emplacement-de-confiance) OU (appareil-conforme)**. Le contrôle d'octroi est configuré de sorte qu'une connexion satisfait à la politique si *l'une ou l'autre* condition est vraie :

- La connexion est depuis un emplacement nommé de confiance (les IP du bureau, la plage du pays, peu importe ce que vous avez défini), OU
- L'appareil de l'utilisateur est marqué comme conforme dans Intune.

Les deux conditions prouvent la même intention sous-jacente — l'utilisateur a démontré qu'il opère depuis un contexte digne de confiance — et l'une ou l'autre est suffisante. Échouer aux deux signifie que la politique refuse la connexion.

La conséquence : les voyageurs sur des portables gérés ne déclenchent pas la politique, parce que leur appareil satisfait au OU. Les voyageurs sur des appareils personnels, *eux*, déclenchent la politique. La distinction que la politique applique n'est plus « canadien ou non »; c'est « contexte digne de confiance ou non ». C'est la bonne distinction.

## Ce que ça veut dire en pratique

Un vendeur en voyage d'affaires un mardi à Chicago :

- Politique géo naïve : bloquée. Appel au service d'aide. Exception ajoutée pour les États-Unis. Exception oubliée dans six semaines.
- Modèle Panoptica365 : non bloquée si son portable géré est inscrit à Intune et conforme. Pas d'exception nécessaire. Pas d'appel au service d'aide.

Un utilisateur sur son téléphone personnel essayant de se connecter à Outlook pendant qu'il visite sa famille à Paris :

- Politique géo naïve : bloquée. Appel au service d'aide. Exception ajoutée pour la France. Exception oubliée.
- Modèle Panoptica365 : bloquée (parce que le téléphone personnel n'est pas conforme). L'utilisateur peut retourner au portable géré, ou attendre d'être de retour à la maison. *Aucune exception ajoutée; aucune dette de sécurité accumulée.*

Un nouvel attaquant qui essaie de se connecter au compte d'un utilisateur depuis l'Europe de l'Est :

- Politique géo naïve : bloquée. Avec succès.
- Modèle Panoptica365 : bloquée (l'appareil de l'attaquant n'est pas conforme; l'emplacement de l'attaquant n'est pas de confiance). Avec succès.

La politique applique la même frontière de sécurité que le client voulait — les connexions sont restreintes aux contextes dignes de confiance — sans la dette d'opérations.

## Ce que le modèle présume

Pour que le patron de condition OU fonctionne, **la conformité Intune doit être en place et fiable.** Si le client n'a pas Intune (Business Standard ou en dessous), ou a Intune mais n'a pas inscrit d'appareils ou configuré de politiques de conformité, alors le chemin « appareil-conforme » du OU est essentiellement vide. Chaque connexion retombe sur la vérification d'emplacement, la politique se comporte comme un blocage géo naïf, et l'accumulation d'exceptions revient.

Donc les prérequis :

- **Intune Plan 1 ou au-dessus** (base Business Premium).
- **Politiques de conformité configurées** pour les plateformes d'appareils que le client utilise (Windows, iOS, Android, macOS).
- **Appareils inscrits** — une fraction significative de la base d'utilisateurs sur des appareils gérés.
- **Évaluation de conformité fonctionnelle** — appareils qui rapportent conformes quand ils devraient l'être.

La carte 4 (paramètres de modèles Intune) couvre le côté conformité en détail. Pour le modèle d'AC ici, l'opérateur doit vérifier que la conformité est fiable avant de basculer la politique de rapport uniquement à Activé. Le pré-déploiement (leçon 1) couvre ça.

## Le défaut Canada n'est qu'un défaut — personnalisez par client

Le modèle livré nomme « Canada » parce que Panoptica365 a été construit originalement dans un contexte MSP canadien. Pour les clients non canadiens, l'emplacement nommé doit être personnalisé :

- Un MSP qui sert des clients au Mexique définit un emplacement nommé « Mexique » avec les plages IP pertinentes et le code de pays, et importe une version personnalisée de ce modèle avec cet emplacement sélectionné.
- Un MSP français définit « France » ou « UE » selon les patrons de voyage.
- Un MSP multi-région avec des clients américains et canadiens peut avoir des modèles séparés par région.

La mécanique de personnalisation est couverte dans la leçon 8 (Importer vos propres modèles d'AC). Pour l'instant : le *concept* du modèle est portable. L'emplacement est paramétrable. Le patron de condition OU reste le même peu importe la géographie.

## Ce que l'opérateur décide au déploiement

Quand vous déployez ce modèle, l'opérateur répond à quatre questions :

**1. Quel est l'emplacement de confiance?**

Pour la plupart des clients, c'est leur pays, défini comme le code de pays (Microsoft maintient les correspondances pays-vers-IP). Pour les clients avec des emplacements de bureau spécifiques seulement, ce sont les plages IP de bureau comme emplacements nommés séparés. Pour les clients multi-régions, plusieurs emplacements nommés.

L'emplacement de confiance devrait être l'endroit où *la grande majorité* des connexions légitimes proviennent. Si votre client fait affaire dans plusieurs pays, définissez chacun. S'il a des travailleurs à distance qui travaillent vraiment de partout, le chemin basé sur l'emplacement est moins utile et vous appuyez plus fort sur le chemin appareil-conforme.

**2. Qui est couvert?**

Défaut : tous les utilisateurs. Même logique qu'Exiger MFA pour tous les utilisateurs (leçon 2). Les vrais utilisateurs sont couverts; les comptes de service sont exclus par nom avec justification documentée.

**3. Quelles sont les applications?**

Défaut : toutes les applications infonuagiques. La politique s'applique à chaque connexion peu importe l'application. Il n'y a pas de bonne raison de la cadrer plus étroitement pour la plupart des clients.

**4. La conformité Intune fonctionne-t-elle vraiment?**

Si la réponse est « oui », déployez le modèle tel quel.

Si la réponse est « non, mais ça le sera bientôt », déployez avec la conformité Intune encore en cours de déploiement et acceptez que jusqu'à ce que la conformité soit en place, le chemin OU est vide et la politique se comporte comme un blocage géo strict. Mettez un rappel de calendrier pour vérifier après le déploiement d'Intune.

Si la réponse est « non, et ça ne le sera pas bientôt » (parce que le client n'a pas acheté de licences Intune), alors ce modèle est le mauvais choix pour ce client. Utilisez Exiger MFA pour tous les utilisateurs (leçon 2) et acceptez que le contexte géographique n'est pas appliqué.

## Déploiement

Ce modèle se déploie à l'état Activé. Pour les tenants de petite entreprise sans dirigeants qui voyagent à l'international et avec une posture de conformité Intune fiable, déployez et surveillez de près — l'inventaire pré-déploiement devrait avoir attrapé les exceptions typiques.

Pour les tenants avec des voyageurs internationaux fréquents ou où la conformité Intune est encore en cours de déploiement, l'étape manuelle de rapport uniquement dans le portail Entra est recommandée. La raison : les patrons de voyage se cachent dans des cycles mensuels et trimestriels. Une fenêtre de 3 jours rate le dirigeant qui visite sa famille toutes les six semaines. Budgétez une fenêtre de rapport uniquement de 14 jours si vous prenez cette route.

Pendant la fenêtre de vérification (que ce soit rapport uniquement ou surveillance en direct après le déploiement), cherchez les blocages et classez chacun :

- Voyage hors emplacement de confiance sur un appareil conforme → la politique *ne les* aurait *pas* bloqués (bon — le patron OU fait son travail).
- Voyage hors emplacement de confiance sur un appareil non conforme → bloqué. Était-ce un voyage légitime? Si oui, l'utilisateur a besoin d'être sur un appareil géré, ou cet utilisateur est un candidat à l'exclusion. Si le patron de voyage est rare, planifiez de gérer via exemption avec une date de coucher de soleil; s'il est fréquent, cet utilisateur a besoin d'un appareil inscrit à Intune.
- Connexion depuis l'extérieur de l'emplacement de confiance, sans bonne explication → attaquant potentiel. Enquêtez.

Corrigez les exclusions pour les voyageurs légitimes sans appareil géré (avec dates de coucher de soleil dans Panoptica365). Adressez les problèmes de conformité d'appareil pour les utilisateurs qui devraient être sur des appareils gérés mais ne le sont pas.

## À surveiller après l'application

**Connexions bloquées par cette politique.** Devrait être rare en régime permanent. Chaque blocage est une opportunité de demander : était-ce une vraie attaque, ou un utilisateur légitime sans appareil conforme? L'anneau Activité quotidienne fait remonter les blocages d'AC en quasi-temps-réel.

**La liste d'exclusions.** Devrait être stable. Nouvelles entrées apparaissant sans votre connaissance signifient que quelqu'un — un autre admin, un technicien du service d'aide, un utilisateur GDAP délégué — ajoute des exceptions. Enquêtez. La piste d'audit Panoptica365 fait remonter qui, quand et pourquoi pour chaque mutation de politique.

**Changements d'IP de l'emplacement de confiance.** Si l'IP du bureau du client change (migration ISP, ouverture de bureau de succursale), la définition d'emplacement nommé a besoin d'être mise à jour. Jusqu'à ce qu'elle le soit, les connexions légitimes depuis la nouvelle IP seront traitées comme emplacement-non-de-confiance. La première plainte après un déménagement de bureau est habituellement celle-ci.

## Ce que Panoptica365 voit

Trois catégories de signaux :

**Connexions réussies d'IP étrangère** — quand le chemin emplacement-de-confiance de la politique a échoué mais que le chemin appareil-conforme a réussi. Pas un problème (c'est la politique qui fonctionne), mais c'est un signal qui vaut la peine d'être connu — l'utilisateur voyage.

**Connexions d'IP étrangère bloquées** — l'anneau Activité quotidienne montre le décompte de blocages d'AC. Faible en régime permanent; une pointe soudaine suggère une tentative de credential stuffing contre ce client.

**Dérive sur la définition d'emplacement nommé.** Si la liste d'IP ou de pays de l'emplacement nommé change de manière inattendue, Panoptica365 alerte. C'est une façon silencieuse d'attaquer une politique — élargir l'emplacement de confiance jusqu'à ce que l'IP de l'attaquant s'y intègre.

## Le patron retiré, nommé explicitement

Plusieurs MSP (nous y compris, dans des itérations antérieures de ce modèle) ont livré un modèle naïf de blocage géo. On ne le fait plus, pour les raisons ci-dessus. L'anecdote d'audit de l'ouverture de cette leçon est réelle, récente et pas inhabituelle. Si vous héritez d'un client qui a l'ancien patron en place — un blocage géo strict avec une longue liste d'exclusions — le bon mouvement est :

1. Inventoriez les exclusions existantes.
2. Identifiez lesquelles n'étaient jamais nécessaires en premier lieu (utilisateurs partis depuis longtemps, projets complétés).
3. Pour les légitimes restantes, vérifiez la couverture Intune et migrez ces utilisateurs vers des appareils conformes.
4. Remplacez le blocage géo naïf par ce modèle.
5. Retirez la liste d'exclusions — elle devrait être vide après la migration, sauf pour les comptes de service documentés.

C'est une des nettoyages à plus fort levier que vous pouvez faire sur un tenant hérité. La posture de sécurité avant/après est dramatiquement différente même si l'*intention* des deux politiques est la même.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**La condition OU est la leçon.** Chaque fois que vous voyez une politique qui a une seule vérification binaire (emplacement seulement, appareil seulement, MFA seulement), demandez-vous si une condition OU servirait la même intention de sécurité avec moins de fardeau d'opérations. Souvent ce sera le cas. Le modèle de cette leçon est l'exemple canonique; le même patron apparaît dans la leçon 5.

**N'ajoutez pas d'exclusions géographiques à ce modèle.** Si un utilisateur voyage vraiment et qu'il est sur un appareil non conforme, la bonne réponse est « votre appareil a besoin d'être conforme », pas « laissez-moi ajouter l'Italie à la liste d'exceptions ». Tout l'intérêt de la condition OU est de rendre les exclusions inutiles. Ajouter des exclusions défait le design.

**Vérifiez que la conformité Intune est réelle avant de déployer.** Si la conformité ne fonctionne pas, ce modèle dégénère en blocage géo naïf. Le pré-déploiement de la leçon 1 couvre la vérification Intune; ne le sautez pas.

## Ce qui suit

- **Leçon 5 : Conforme OU hybride OU MFA.** L'application plus large du patron de condition OU — trois signaux de confiance comme chemins alternatifs. Même principe de design, portée plus large.
- **Leçon 8 : Importer vos propres modèles d'AC.** Comment un MSP en dehors du Canada personnalise l'emplacement nommé de ce modèle pour sa propre géographie.

Pour l'instant : c'est le modèle qui remplace le patron d'accumulation d'exceptions. Héritez d'un tenant avec un blocage géo naïf, migrez-le vers ce modèle, et la posture d'AC du client devient tranquillement plus sécurisée *et* moins de travail à opérer. Les deux choses comptent.

---

*Sources des données dans cette leçon — Microsoft Learn sur les emplacements nommés en accès conditionnel ([Microsoft Learn — Conditional Access: Locations](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-assignment-network)); sémantique d'octroi OU de l'accès conditionnel ([Microsoft Learn — Conditional Access: Grant](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-grant)); signal de conformité d'appareil Intune en accès conditionnel ([Microsoft Learn — Device compliance](https://learn.microsoft.com/en-us/mem/intune/protect/device-compliance-get-started)).*
