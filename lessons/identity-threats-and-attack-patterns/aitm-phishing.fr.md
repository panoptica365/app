---
title: "Hameçonnage AiTM — le roi de 2026"
subtitle: "Les proxys inverses adversaire-au-milieu volent des cookies de session MFA complets — le MFA standard par push n'est aucune défense."
icon: "fish"
last_updated: 2026-05-29
---

# Hameçonnage AiTM — le roi de 2026

Si la fatigue MFA est le contournement de l'ingénieur social, l'AiTM est le contournement de l'ingénieur. Il ne demande pas à l'utilisateur de prendre une mauvaise décision — il le laisse juste prendre une décision parfaitement correcte sur une parfaite imitation. L'utilisateur tape son mot de passe, complète le prompt MFA, et s'en va en pensant que rien ne s'est passé. Pendant ce temps, l'attaquant détient maintenant un cookie de session entièrement MFA et peut se connecter à M365 comme cet utilisateur depuis n'importe où, sur n'importe quel appareil, jusqu'à ce que le cookie expire.

Microsoft a suivi une **augmentation de 146 % des attaques AiTM en 2024** et la courbe ne s'est pas inversée depuis. Les kits d'hameçonnage qui automatisent cette attaque — Evilginx, Muraena, Modlishka — sont libres, code source ouvert, et faciles à déployer. La barrière de coût pour lancer une campagne AiTM est essentiellement tombée à zéro. Le MFA standard par push n'est aucune défense.

C'est la leçon la plus profonde et la plus longue de la carte parce que l'AiTM est l'attaque identitaire à plus haut impact du moment. Lisez lentement.

## Ce que « adversary in the middle » veut vraiment dire

Imaginez un appel téléphonique routé à travers un opérateur qui peut écouter, prendre des notes, et raccrocher à tout moment. Les deux bouts pensent qu'ils parlent l'un avec l'autre. L'opérateur entend tout.

Maintenant faites de l'opérateur un site web. L'utilisateur tape `outlook.office.com` dans son navigateur. Ou, plus précisément, l'utilisateur *clique sur un lien dans un courriel* qui ressemble à `outlook-office.com.signin-microsoft.help` (un domaine enregistré il y a six heures). Ce domaine, c'est l'opérateur — un proxy inverse. Il transmet chaque requête HTTP au *vrai* service de connexion Microsoft, et transmet chaque réponse au navigateur de l'utilisateur. De l'écran de l'utilisateur, tout paraît normal. La vraie page de connexion Microsoft. Le vrai prompt MFA Microsoft. La vraie question « Rester connecté? » de Microsoft.

La seule chose différente, c'est la barre d'URL. Et personne ne lit la barre d'URL.

Ce que l'opérateur-au-milieu capture, ce n'est pas le mot de passe (bien qu'il l'obtienne aussi). C'est le **cookie de session** — la chose que Microsoft renvoie après une connexion réussie pour dire « ce navigateur est maintenant authentifié jusqu'à 16 h vendredi ». Une fois que le site AiTM a ce cookie, l'attaquant peut le coller dans son propre navigateur, et il *est* l'utilisateur. Plus besoin de mot de passe. Plus besoin de MFA. Le jeton, c'est le prix.

C'est pourquoi le reste de cette carte et les deux prochaines cartes reviennent constamment sur la *protection de session* comme le vrai jeu. Le mot de passe est incident; la session est ce qui compte.

## Étape par étape

Marchons à travers une vraie attaque AiTM :

**Étape 1 : Le courriel d'hameçonnage arrive.** « Action requise : Votre enveloppe DocuSign attend votre révision. » Le lien ressemble à `secure-docusign.helpfile-portal.com/?eid=ABC...`. L'utilisateur clique.

**Étape 2 : L'utilisateur atterrit sur ce qui ressemble à une page de connexion Microsoft.** Parfait au pixel. La barre d'URL montre le domaine de l'attaquant, mais l'utilisateur ne regarde pas. Il tape son adresse courriel.

**Étape 3 : Le proxy AiTM transmet cette adresse courriel à `login.microsoftonline.com`.** Microsoft, serviable, retourne *l'image de marque réelle du tenant* de la compagnie de cet utilisateur — le logo du client, le texte de bienvenue personnalisé, le tout. Le proxy retransmet tout ça à l'utilisateur. La page paraît maintenant encore plus légitime, parce qu'elle *est* la page légitime, juste routée.

**Étape 4 : L'utilisateur tape le mot de passe.** Le proxy le capture, transmet à Microsoft. Microsoft répond avec « Défi MFA requis ». Le proxy transmet le prompt MFA à l'utilisateur.

**Étape 5 : L'utilisateur complète le MFA.** Number matching de Microsoft Authenticator, tap de clé FIDO2, peu importe la méthode configurée par l'utilisateur — tout est transmis fidèlement à travers le proxy. L'utilisateur fait exactement ce qu'il fait normalement.

**Étape 6 : Microsoft retourne un cookie de session.** C'est le prix. Le proxy capture le cookie avant de le transmettre à l'utilisateur. Le navigateur de l'utilisateur a maintenant une session fonctionnelle et atterrit sur le vrai Outlook. Il croit qu'il s'est connecté avec succès. Pour ce qui est de Microsoft, il l'a fait.

**Étape 7 : L'attaquant importe le cookie capturé dans son propre navigateur.** Il est maintenant connecté comme l'utilisateur. Pas de défi de mot de passe. Pas de prompt MFA. Microsoft voit un navigateur qui présente un jeton de session valide et authentifié par MFA et accorde l'accès.

**Étape 8 : L'attaquant fait ce pour quoi il est venu.** Lire les courriels, mettre en place des règles de transfert, chercher « virement bancaire » ou « facture » dans la boîte de l'utilisateur, enregistrer un nouvel appareil MFA pour lui-même (pour ne pas avoir à refaire toute cette danse), peut-être pivoter latéralement. Le cookie de session expire après quelques heures, mais à ce moment-là, l'attaquant a soit déjà de la persistance ailleurs, soit a fini son travail.

Le flux entier prend des minutes. L'utilisateur ne sait souvent jamais que ça s'est passé — il a complété la connexion, vu ses courriels, fermé l'onglet, continué sa journée.

## Pourquoi le MFA n'aide pas

C'est la partie qui confond les gens qui ont grandi dans la sécurité il y a dix ans. Le MFA était censé être la réponse. Pourquoi est-ce que ça n'arrête pas ça?

Parce que le MFA prouve *que l'utilisateur est présent au moment de la connexion*. Il ne prouve *pas* que *la connexion va au bon endroit*. Le proxy AiTM se met entre l'utilisateur et Microsoft, et le MFA valide correctement avec le proxy au milieu. L'utilisateur prouve qu'il est présent; le proxy vole le résultat.

C'est la faille structurelle que le vol de jeton exploite en général, et que l'AiTM exploite en particulier. La défense doit être quelque chose qui *lie l'authentification à une destination spécifique*, pas juste à l'utilisateur.

C'est ce que fait le MFA résistant à l'hameçonnage — et pourquoi ça compte vraiment.

## MFA résistant à l'hameçonnage : ce qui est différent

**Les clés de sécurité FIDO2, les passkeys et Windows Hello for Business** utilisent une technique cryptographique appelée *liaison à l'origine*. Quand l'utilisateur enregistre une passkey pour `login.microsoftonline.com`, la passkey est mathématiquement liée à ce domaine précis. Quand l'utilisateur se reconnecte plus tard, le navigateur dit à la passkey contre quel domaine il authentifie. Si le domaine est `outlook-office.com.signin-microsoft.help` au lieu de `login.microsoftonline.com`, la passkey *refuse de signer*.

L'utilisateur ne peut pas contourner ça. Le proxy ne peut pas faire le proxy autour de ça, parce que la signature cryptographique inclut le domaine comme un champ signé. Il n'y a aucun moyen de tromper une passkey pour qu'elle signe pour le mauvais site.

C'est la défense technique significative contre l'AiTM, et c'est la *seule* défense qui fonctionne au moment de l'authentification lui-même. Tout le reste de cette leçon, c'est de la mitigation qui se passe après que le jeton est capturé.

Trois méthodes résistantes à l'hameçonnage que vous verrez sur le terrain, avec leurs compromis :

**Passkeys** — stockent la clé privée sur le téléphone de l'utilisateur (passkeys synchronisées) ou l'appareil (passkeys liées à l'appareil). Meilleur UX. Le plus universel. Microsoft pousse fort l'adoption des passkeys depuis fin 2024.

**Clés de sécurité FIDO2** — jeton matériel (YubiKey, etc.). Meilleure posture de sécurité; demande une possession physique. Un peu plus de friction (porter une clé, la brancher). Bon choix pour les utilisateurs à haute valeur — admins, finance, dirigeants.

**Windows Hello for Business** — biométrie ou NIP lié à un identifiant TPM sur un appareil Windows géré. Excellent UX si l'utilisateur est sur un terminal Windows géré. Ne s'étend pas au mobile ou au non-Windows.

Si le client est sur Business Premium ou plus, les trois sont configurables. La migration est graduelle, mais le travail se cumule : chaque utilisateur qui passe devient immunisé à l'AiTM, à la fatigue MFA et au credential stuffing simultanément.

## Ce qui aide aussi (les mitigations secondaires)

Le MFA résistant à l'hameçonnage est la défense centrale. Les autres contrôles dans cette liste sont de la *réduction de risque* — ils rétrécissent le rayon d'explosion d'une compromission AiTM, ou élèvent la chance de détection.

**Accès conditionnel : exiger un appareil conforme.** Si le cookie de session capturé est rejoué depuis un appareil non inscrit dans Intune et marqué conforme, Microsoft rejette. L'attaquant a volé le cookie mais ne peut pas l'utiliser. Ce contrôle est applicable à partir de Business Premium. C'est une des défenses pratiques les plus fortes pour les tenants qui ne peuvent pas passer aux passkeys du jour au lendemain.

**Accès conditionnel : exiger Microsoft Entra hybrid join.** Variante du précédent pour les tenants avec AD hybride. Même idée — jeton utilisable seulement depuis un appareil connu.

**Token Protection** (évolution preview-vers-GA en 2024-2026). Une fonctionnalité Microsoft qui lie cryptographiquement le jeton émis à l'appareil qui l'a demandé. Sans le secret de l'appareil, le jeton lié est inutile pour un attaquant qui a volé le cookie. Supporte actuellement Exchange Online, SharePoint Online et Teams; pas encore universel. Disponible dans Entra ID P1 (Business Premium et au-dessus) via les contrôles de session d'accès conditionnel. Vaut la peine d'activer là où c'est supporté.

**Évaluation d'accès continu (CAE).** Révocation en temps réel des jetons quand les conditions de l'utilisateur changent. Si l'utilisateur est détecté comme compromis, ou si son appartenance à un groupe change, ou si sa localisation change en cours de session, les jetons sont révoqués dans les minutes plutôt qu'à l'expiration. Disponible à travers la plupart des SKU M365. Activez-le.

**Microsoft Defender SmartScreen + filtrage de contenu web.** SmartScreen marque les domaines d'hameçonnage connus en temps réel. Le filtrage de contenu web de Defender for Endpoint peut bloquer les domaines nouvellement enregistrés entièrement (la plupart des domaines AiTM ont quelques jours ou heures). Aucun n'est une défense complète — les domaines du premier jour ne sont pas encore marqués — mais ensemble ils réduisent significativement le taux de succès.

**Defender for Office 365 Safe Links.** Réécriture d'URL et vérifications au moment du clic. Quand l'utilisateur clique sur un lien dans son courriel, Defender for Office 365 revérifie l'URL contre le renseignement de menaces actuel avant de rediriger. Attrape les liens qui sont devenus connus-malicieux entre le moment où le courriel a été envoyé et le moment où l'utilisateur a cliqué.

## Ce que Defender XDR fait à ce sujet (Attack Disruption)

La chose la plus utile que Microsoft a construite pour l'AiTM ces trois dernières années, c'est **Attack Disruption** — la capacité d'action automatique couverte dans la carte 1, leçon 4. Elle s'applique spécifiquement à l'AiTM (et au BEC, à HumOR, et au password spray).

Quand Defender XDR corrèle un incident AiTM à haute confiance — typiquement détecté via la combinaison d'une alerte Defender for Office 365 (l'utilisateur a cliqué sur un site d'hameçonnage AiTM), une anomalie Defender for Cloud Apps (jeton de session volé en cours d'utilisation), et un signal de risque Entra ID Protection — il n'attend pas un opérateur. Il désactive le compte utilisateur dans Entra ID, révoque toutes les sessions actives y compris le cookie volé, et (si l'appareil de l'attaquant peut être identifié) le contient.

C'est la défense « après les faits » moderne. L'attaque s'est passée; le jeton a été volé; l'attaquant a brièvement eu l'accès. Attack Disruption a coupé l'accès avant que les dommages se propagent. L'opérateur voit l'incident fermé le matin avec une note « compte compromis désactivé automatiquement ».

Deux notes pratiques :

**Vérifier avant de réactiver.** Quand Attack Disruption se déclenche, l'opérateur va recevoir un appel de support client (« je suis verrouillé! »). Résistez à l'envie de réactiver l'utilisateur immédiatement. Vérifiez d'abord que l'AiTM était réel (regardez l'IP source, l'anomalie géographique, le timing), réinitialisez le mot de passe de l'utilisateur, tuez toutes les nouvelles méthodes d'authentification que l'attaquant aurait pu enregistrer, *puis* réactivez. Perturber et réactiver sans criminalistique défait la protection.

**Attack Disruption demande la bonne combinaison de produits.** Defender for Endpoint en mode actif, Defender for Cloud Apps connecté, Defender for Identity pour les signaux sur site si vous en avez un, Defender for Office 365 P1 minimum. La plupart des tenants Business Premium modernes ont les prérequis; certains non. Vérifiez avant de présumer qu'Attack Disruption est activé.

## Ce que Panoptica365 voit

Plusieurs catégories d'alertes dans Panoptica365 sont déclenchées par l'AiTM :

**Connexion réussie depuis une IP étrangère.** Quand un utilisateur qui se connecte normalement depuis un pays a soudainement une connexion réussie depuis un autre, l'alerte se déclenche. La plupart des attaquants AiTM relaient leur rejeu à travers la même infrastructure utilisée pour héberger le kit d'hameçonnage, qui est rarement dans la géographie normale de l'utilisateur.

**Connexion à déplacement impossible.** Deux connexions réussies du même utilisateur séparées par une impossibilité physique (Toronto, puis Bucarest, à 90 minutes d'écart). Signal post-AiTM classique — l'utilisateur est à Toronto, l'attaquant a rejoué son cookie depuis Bucarest.

**Nouvelle méthode d'authentification enregistrée.** Les attaquants aiment ajouter leur propre méthode MFA après une AiTM réussie pour ne pas avoir à répéter toute la danse. Ça apparaît dans le journal d'audit Entra et Panoptica365 le fait remonter comme alerte.

**Règle de transfert de boîte suspecte créée.** L'utilisateur ne serait pas en train de créer une règle qui transfère tout courriel `facture OR paiement OR virement` à une adresse Gmail. C'est un attaquant. Les alertes sur règles de transfert et règles de boîte reviennent fréquemment dans l'activité de suivi de l'AiTM.

**Incidents AiTM de Defender XDR** ingérés directement. Quand Microsoft a noté un incident comme AiTM et a soit perturbé soit alerté, ça arrive dans Panoptica365 comme une alerte à haute gravité avec la gravité Microsoft originale et l'analyse préservée.

L'approche de triage : quand vous voyez *n'importe laquelle* de ces alertes sur un utilisateur, présumez l'AiTM jusqu'à preuve du contraire. Tirez le journal de connexion Entra pour l'utilisateur, cherchez la connexion qui a immédiatement précédé l'activité suspecte, vérifiez l'IP source et l'agent utilisateur. Une connexion réussie depuis une IP résidentielle dans un pays où l'utilisateur n'a jamais été, avec un agent utilisateur de navigateur par défaut, le même jour qu'une alerte d'IP étrangère — c'est le patron. Traitez ça comme une compromission.

## Ce que ça veut dire pour l'opérateur

Quatre points à retenir pour le travail quotidien.

**L'AiTM est la menace unique la plus importante contre laquelle concevoir des défenses en 2026.** C'est l'attaque qui défait le MFA que la plupart des clients pensent être protecteur. Chaque conversation que vous avez sur le durcissement de l'identité devrait atteindre passkeys / FIDO2 / Hybrid join / AC d'appareil conforme avant qu'elle n'atteigne quoi que ce soit d'autre.

**Le MFA basé sur push n'est plus adéquat pour les utilisateurs à haute valeur.** Admins, finance, dirigeants, n'importe qui avec accès aux données sensibles — ces utilisateurs devraient être sur des méthodes résistantes à l'hameçonnage. Utilisez les politiques de force d'authentification d'accès conditionnel pour *exiger* un MFA résistant à l'hameçonnage pour les apps sensibles même quand la méthode par défaut de l'utilisateur reste push.

**Token Protection et CAE ne sont pas optionnels.** Activez-les pour chaque tenant Business Premium et au-dessus. Ils n'empêchent pas l'AiTM au moment de l'authentification, mais ils rétrécissent la fenêtre pendant laquelle un jeton volé est utile.

**Faire confiance à Attack Disruption, puis vérifier.** Quand Defender XDR déclenche Attack Disruption sur un utilisateur, le bon flux de travail d'opérateur est : confirmer que l'action a l'air correcte, rassembler la criminalistique, corriger la compromission sous-jacente (nouvelles méthodes d'authentification, règles de boîte, etc.), puis réactiver. Pas l'inverse.

## Ce qui suit

- **Leçon 4 : Hameçonnage par consentement OAuth.** L'attaque qui survit à une réinitialisation de mot de passe. L'AiTM est bruyant; l'hameçonnage par consentement est silencieux, et il dure.
- **Leçon 5 : Abus du code d'appareil.** Le flux de code d'appareil Microsoft détourné. Plus proche de l'AiTM en mécanisme, mais avec une charge utile différente.
- **Leçon 6 : BEC.** Le dénouement économique. Ce que l'attaquant fait vraiment avec la session acquise par AiTM.

Pour l'instant : l'AiTM est l'attaque qui a appris à l'industrie que le MFA-seul ne suffit pas. Les défenses existent. Le travail est opérationnel — migrer vers des méthodes résistantes à l'hameçonnage, activer Token Protection et CAE, configurer Attack Disruption, former les utilisateurs des clients à ne jamais faire confiance à la barre d'URL. C'est faisable. C'est juste pas encore fait.

---

*Sources des données dans cette leçon — Microsoft Defender Threat Intelligence sur la montée des attaques AiTM ([Microsoft Security Blog — Defeating adversary-in-the-middle](https://www.microsoft.com/en-us/security/blog/2022/07/12/from-cookie-theft-to-bec-attackers-use-aitm-phishing-sites-as-entry-point-to-further-financial-fraud/)); paysage des techniques AiTM 2026 ([Jeffrey Appel — AiTM/MFA phishing 2026 edition](https://jeffreyappel.nl/)); mécaniques de Token Protection ([Microsoft Learn — Token protection in Conditional Access](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-token-protection)); évaluation d'accès continu ([Microsoft Learn — Continuous access evaluation](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-continuous-access-evaluation)); configuration d'Attack Disruption ([Microsoft Learn — Configure automatic attack disruption](https://learn.microsoft.com/en-us/defender-xdr/configure-attack-disruption)); liaison à l'origine FIDO2 / passkey ([Microsoft Learn — Passwordless authentication](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-passwordless)).*
