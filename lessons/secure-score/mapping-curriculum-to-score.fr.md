---
title: "Mapper le curriculum sur la note — ce qui fait bouger le chiffre et ce qui ne le fait pas"
subtitle: "Quels contrôles des cartes 3 à 5 se traduisent en recommandations Secure Score à fort impact, et comment prioriser pour gagner le plus de points."
icon: "git-compare"
last_updated: 2026-05-29
---

# Mapper le curriculum sur la note — ce qui fait bouger le chiffre et ce qui ne le fait pas

Un membre du conseil d'administration d'un client, fraîchement sensibilisé à la cybersécurité dans une conférence, demande au MSP un plan écrit pour « améliorer significativement notre Secure Score au prochain trimestre ». Le client est actuellement à 58 %. Le membre du conseil veut 80 % pour la prochaine réunion. Le MSP a environ douze semaines de temps opérateur à mettre là-dessus, étalées sur son carnet de clients normal.

Le MSP fait quoi en premier?

C'est la question d'opérateur la plus fréquente sur Secure Score, et elle a une réponse précise : implémenter la **demi-douzaine à fort impact** — les six recommandations qui font le plus bouger la Secure Score d'un client PME tout en produisant une vraie amélioration de sécurité. La demi-douzaine, c'est là où vit l'essentiel de l'écart entre un tenant à 58 % et un tenant à 88 %. Le reste, c'est du crédit partiel, des items conditionnés par licence, et la longue traîne de plus petites recommandations.

Cette leçon mappe le travail des cartes 3, 4 et 5 sur des recommandations Secure Score précises, identifie la demi-douzaine, et donne un aperçu de ce qui n'apparaît pas du tout dans la note (la leçon 4 couvre ça en profondeur).

## La vue d'ensemble — où vit la note

L'essentiel de la Secure Score d'un tenant PME se trouve dans trois zones, chacune correspondant à une des cartes d'implémentation de ce curriculum :

- **Recommandations Identité** (carte 3 — Conditional Access). MFA, blocages d'authentification héritée, protection admin, posture de connexion. Pour un tenant PME Business Premium, les recommandations d'identité contribuent typiquement à 30-40 % du maximum atteignable.
- **Recommandations Appareils** (carte 4 — Intune). Conformité d'appareil, BitLocker, règles ASR, configuration de Defender for Endpoint. À peu près 25-35 % du maximum atteignable.
- **Recommandations Applications** (carte 5 — Courriel et collaboration). Anti-hameçonnage, Safe Links / Safe Attachments, audit de boîtes aux lettres, politique de quarantaine, contrôles de transfert automatique. À peu près 25-30 % du maximum atteignable.
- **Recommandations Données** (sensitivity labels, DLP, rétention). Surtout sous licence E5; pour les tenants Business Premium, elles sont typiquement Risk Accepted (leçon 2). Petite contribution au maximum atteignable en pratique.

La forme de la note d'un client PME : l'essentiel des points est dans Identité, Appareils, et Applications. Le client à 41 % a des trous dans les trois; le client à 88 % a couvert les items à fort impact dans chacun. La demi-douzaine ci-dessous tire un ou deux items de chacune des trois cartes d'implémentation.

## La demi-douzaine à fort impact

Ces six recommandations font le plus bouger la note pour les clients PME qui roulent Business Premium avec l'écosystème Microsoft complet. Implémenter les six explique routinièrement l'essentiel de l'écart entre un tenant à base de référence basse et un tenant à 80 % et plus.

**1. Exiger MFA pour tous les utilisateurs — carte 3 leçon 2.** Typiquement le plus gros gain Secure Score disponible sur n'importe quel tenant. La recommandation donne du crédit partiel par utilisateur : plein crédit quand 100 % des utilisateurs sont appliqués. Les utilisateurs non appliqués (dirigeants qui exigent des exceptions, comptes de service, contractuels) coûtent du crédit partiel. Le patron d'implémentation de la carte 3 — déployer le modèle CA « Require MFA for all users », porter sur tous les utilisateurs, gérer les exceptions via la discipline d'inclusion/exclusion par utilisateur — pousse directement cette recommandation vers le plein crédit.

**2. Bloquer l'authentification héritée — carte 3 leçon 3.** Le deuxième plus gros gain côté identité. L'authentification héritée contourne MFA; la bloquer ferme le trou. La recommandation est notée en binaire — soit l'authentification héritée est bloquée à l'échelle du tenant via Conditional Access, soit non. L'implémentation mappe directement sur le modèle CA « Block legacy authentication » de la carte 3 leçon 3. Pas de crédit partiel; un déploiement de politique fait bouger l'aiguille en une étape.

**3. Activer BitLocker pour les disques OS — carte 4 leçon 4.** Le plus gros gain côté appareil sur la plupart des flottes Windows. Noté par appareil : plein crédit quand chaque appareil Windows géré a BitLocker actif sur le volume OS. Le modèle BitLocker Settings de la carte 4 configure ça via Intune; le crédit par appareil s'accumule à mesure que les appareils chiffrent. Les clients avec des flottes en état mixte (certains chiffrés, d'autres non) obtiennent du crédit partiel; arriver au plein exige le travail opérationnel de mettre les appareils non chiffrés en ligne.

**4. Activer les règles ASR en mode Block — carte 4 leçon 7.** Plusieurs règles ASR sont notées individuellement — chaque règle activée en mode Block contribue à la note. Le modèle ASR Rules Standard de la carte 4 déploie les 19 règles ASR en mode Block par défaut; déployer ce modèle (et confirmer que les règles s'appliquent à tous les appareils gérés) pousse plusieurs recommandations par règle au plein crédit simultanément. C'est le grappin de recommandations où un déploiement débloque le plus d'items de note distincts.

**5. Activer l'audit des boîtes aux lettres pour tous les utilisateurs — carte 5 leçon 6.** Noté en binaire : chaque boîte aux lettres du tenant a soit le journal d'audit activé, soit non. Le paramètre d'audit de boîte aux lettres de la carte 5 leçon 6 pousse ça à l'échelle du tenant via Panoptica365. Les nouvelles boîtes aux lettres dérivent vers les paramètres d'audit par défaut (l'exemple canonique de la carte 5); réappliquer la posture stricte restaure le plein crédit. La recommandation est aussi un des items les plus à fort impact pour la préparation forensique — note et sécurité s'alignent proprement ici.

**6. Activer la politique de sécurité prédéfinie Standard ou Strict — carte 5 leçons 3, 7 et 10.** C'est le multiplicateur en bundle. La politique de sécurité prédéfinie de Microsoft configure anti-hameçonnage, Safe Links, Safe Attachments, anti-maliciel, et politiques de quarantaine en une fois. Activer Standard ou Strict sur le tenant déplace plusieurs recommandations Secure Score distinctes au plein crédit simultanément — typiquement un swing de 5-10 points sur un tenant Business Premium. L'implémentation, c'est trois clics dans le portail Defender; c'est la recommandation au plus haut effet par effort de tout le curriculum.

Ces six items, implémentés de bout en bout sur un client qui part à 41 %, font routinièrement bouger ce client dans la fourchette 75-85 %. L'écart qui reste pour atteindre 88 % et plus vient de la longue traîne de plus petites recommandations (items à crédit partiel, règles ASR additionnelles hors de l'ensemble standard, plus petits réglages anti-hameçonnage, items conditionnés par licence gérés via Risk Accepted, remédiation de vulnérabilités qui doit se faire continuellement, etc.).

## L'activation DKIM — la quasi-incluse dans la demi-douzaine

Vaut la peine d'être nommée séparément parce que c'est l'item d'authentification courriel couvert par la carte 5 mais qui n'a pas fait la demi-douzaine :

**Activer la signature DKIM pour tous les domaines personnalisés — carte 5 leçon 4.** Ça *est* une recommandation Secure Score, notée séparément, et raisonnablement à forte valeur. Elle n'est pas dans la demi-douzaine parce que le travail d'implémentation par domaine — publier des CNAME DNS pour chaque domaine accepté, activer la signature par domaine dans le portail M365 — est une tâche opérationnelle plus impliquée que les items de la demi-douzaine, et la contribution à la note par tenant est plus petite que chacune des six au-dessus. Mais elle devrait être sur la liste à court terme de l'opérateur pour n'importe quel client qui roule la pile courriel complète.

Vaut la peine d'être explicite sur ce qui est noté et ce qui ne l'est pas côté authentification courriel : **l'activation DKIM est notée** (Microsoft peut vérifier la bascule côté tenant et les enregistrements DNS publiés). **La publication SPF n'est pas notée comme recommandation Secure Score de la façon que les opérateurs supposent parfois** — même si SPF est critique pour le portrait d'authentification courriel plus large. **La publication DMARC et tout le parcours `p=none → p=quarantine → p=reject` ne sont pas notés du tout** — Microsoft ne peut pas vérifier de façon fiable ce qui se trouve à `_dmarc.client.com` pour des domaines externes arbitraires. Le travail DMARC compte pour la sécurité; il ne fait juste pas bouger la note. La leçon 4 de cette carte couvre ça et d'autres travaux non notés mais critiques en profondeur.

## La longue traîne — items à crédit partiel et conditionnés par licence

Au-delà de la demi-douzaine, des dizaines de plus petites recommandations contribuent à la note. Quelques exemples :

- **MFA pour les rôles administratifs** — distinct de « MFA pour tous les utilisateurs »; souvent déjà couvert si la politique tous-utilisateurs est en place, mais nommé comme sa propre recommandation.
- **Désactiver des méthodes de connexion individuelles** (MFA par SMS, MFA par appel vocal) — petites recommandations par méthode.
- **Règles ASR précises qui ne sont pas dans l'ensemble standard** — règles additionnelles qui ne font pas partie des 19 du modèle ASR de la carte 4 mais qui sont notées individuellement.
- **Remédiation de vulnérabilités** — recommandations par CVE pilotées par MDVM qui vont et viennent à mesure que Microsoft détecte de nouvelles vulnérabilités sur les terminaux gérés (la cause de mouvement de note quotidien de la leçon 2).
- **Configurer la politique anti-pourriel sortante pour restreindre** — carte 5 leçon 9; plus petite contribution individuelle.
- **Désactiver Basic Auth pour la soumission SMTP** — carte 5 leçon 9; petit mais suivi.
- **Bloquer le transfert automatique externe** — carte 5 leçon 5; petit mais suivi.

Ces items ne font pas beaucoup bouger la note individuellement, mais en agrégat, ils expliquent l'écart entre un tenant à 80 % et un tenant à 88 %. Le travail d'amener un client de « assez bon » à « exemplaire », c'est le travail de moudre à travers cette longue traîne — dont la majeure partie a déjà été couverte par le curriculum dans les cartes 3, 4 et 5.

## Ce qui N'EST PAS dans la note — l'aperçu

Pour devancer la question naturelle de l'opérateur : une bonne partie du travail des cartes 3, 4 et 5 n'apparaît pas du tout dans la Secure Score. La leçon 4 couvre ça en détail, mais la liste principale :

- **La publication DMARC et tout le parcours d'application** — côté DNS; non noté.
- **La publication SPF** — non notée comme vérification DNS validée.
- **Listes d'expéditeurs de confiance anti-hameçonnage spécifiques au client** — le *préréglage* est noté; le réglage par client ne l'est pas.
- **Hygiène des règles de flux de courrier** — le travail d'auditer les règles de transport trimestriellement; non noté.
- **Exceptions de transfert automatique Remote Domain par domaine** — le blocage à l'échelle du tenant est noté; la discipline du registre d'exceptions ne l'est pas.
- **Détection et triage de dérive** — le rythme opérationnel au cœur des cartes 4 et 5; non noté.
- **Revues annuelles de dette de configuration** — le travail d'audit; non noté.
- **Maintenance du registre d'exceptions client** — la discipline qui compose; non notée.
- **Formation à la sensibilisation à la sécurité et simulations d'hameçonnage** — même quand elles sont exécutées; non notées directement (« Attack Simulation Training », fonctionnalité E5 connexe, est notée si vous l'avez, mais le travail de sensibilisation lui-même ne l'est pas).
- **Capacité de réponse aux incidents** — la discipline hors plateforme d'avoir un runbook, de l'avoir testé, d'avoir un contact hors heures de bureau — rien de tout ça n'est noté.

Ce n'est pas une plainte sur la note; c'est un fait sur ce que la note mesure. Un tenant à 92 % sans discipline opérationnelle est moins sécurisé qu'un tenant à 82 % avec un MSP qui répond aux alertes de dérive en quelques heures et fait des revues annuelles. La leçon 4 rend ça explicite.

## Ce que ça veut dire pour l'opérateur

Trois points à retenir.

**La demi-douzaine, c'est là où vit le plan d'amélioration client.** Quand un client demande « comment on améliore notre note? » — et il va le demander — la réponse, ce sont les six items au-dessus, en ordre d'effet. L'essentiel de l'écart entre un tenant à base de référence basse et un tenant PME en santé vit dans ces six recommandations. Documentez la demi-douzaine comme plan abouti; amenez-le aux rencontres de renouvellement comme chemin d'amélioration visible.

**Le curriculum, c'est le moteur de la note.** L'essentiel du travail des cartes 3, 4 et 5 fait directement monter la Secure Score. Les opérateurs qui ont intériorisé le curriculum ont déjà fait — ou savent exactement comment faire — le travail qui fait bouger le pourcentage. Secure Score n'est pas un projet séparé; c'est la couche de mesure par-dessus le travail que le curriculum enseigne.

**La discipline opérationnelle ne note pas. Faites-la quand même.** Une fraction significative de la valeur sécurité livrée par un bon MSP n'apparaît pas du tout dans Secure Score — triage de dérive, revues annuelles, gestion des exceptions client, application DMARC, hygiène des règles de flux de courrier. Les clients vous mesurent par la note parce que c'est le chiffre qu'ils peuvent voir; vous devez savoir que le travail non noté, c'est ce qui les garde en sécurité entre les instantanés.

## Ce qui suit

- **Leçon 4 : Où Secure Score induit en erreur.** Les angles morts, les pièges du jeu de score, et l'histoire du 92 % qui s'est fait BEC. Pourquoi courir après le 100 % est le mauvais objectif — et à quoi ressemble le bon.
- **Leçon 5 : Secure Score face client.** Comment utiliser le pourcentage dans les conversations de renouvellement, le rapport de base de référence, et le récit de tendance.

Pour l'instant : ouvrez le tableau de bord principal de Panoptica365, trouvez le client avec la plus basse Secure Score de votre carnet. C'est le client pour qui vous devriez écrire le plan demi-douzaine cette semaine. Six recommandations, chacune mappée sur une leçon de la carte 3 / 4 / 5, chacune avec une implémentation définie. À la prochaine conversation de renouvellement, la note de ce client a bougé.

---

*Sources des données dans cette leçon — Microsoft Learn sur le catalogue de recommandations Microsoft Secure Score ([Microsoft Learn — Improvement actions](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score-improvement-actions)); notation des recommandations Conditional Access pour MFA et auth héritée ([Microsoft Learn — Conditional Access Secure Score recommendations](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-policy-common)); recommandations BitLocker et conformité Intune ([Microsoft Learn — Intune Secure Score recommendations](https://learn.microsoft.com/en-us/mem/intune/protect/security-baseline-settings-mdm-all)); référence Secure Score des règles de réduction de surface d'attaque ([Microsoft Learn — Enable ASR rules](https://learn.microsoft.com/en-us/defender-endpoint/enable-attack-surface-reduction)); recommandation d'audit de boîtes aux lettres ([Microsoft Learn — Enable mailbox auditing](https://learn.microsoft.com/en-us/purview/audit-mailboxes)); impact Secure Score de la politique de sécurité prédéfinie ([Microsoft Learn — Preset security policies](https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies)); recommandation de signature DKIM ([Microsoft Learn — Use DKIM to validate outbound email](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dkim-configure)).*
