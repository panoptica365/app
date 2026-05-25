# Quoi de neuf dans Panoptica365

Notes de version destinées aux clients. Chaque version ci-dessous décrit ce
qui a changé dans cette version, les plus récentes en premier.

---

## Version 0.1.14 — 2026-05-24

### Modal d’inscription d’app : balises gras s’affichent + plus d’icône de copie en double

Deux petits correctifs détectés lors de la vérification de v0.1.13 sur
P365-Test :

- Trois puces dans le modal (étapes 3.5, 3.6 sur le secret client, et
  étape 1.5 sur le clic sur Inscrire) affichaient
  `<strong>Ajouter</strong>`, `<strong>Valeur</strong>` et
  `<strong>S’inscrire</strong>` comme texte HTML brut au lieu de mettre
  les mots en gras. Même correctif qu’en v0.1.12 — trois attributs
  `data-i18n` basculés en `data-i18n-html`.

- Les lignes de permissions dans le modal avaient deux icônes de copie
  côte à côte par ligne. Causé par le passage du caractère d’icône comme
  texte d’affichage du bouton en plus du span d’icône toujours présent.
  Utilise maintenant un assistant de bouton de copie icône seule dédié.

---

## Version 0.1.13 — 2026-05-24

### Assistant : guide complet d’inscription d’app Entra + bouton Tester la connexion

L’étape Entra de l’assistant de configuration initiale était le plus
long bloc manuel de l’installation — les opérateurs devaient savoir
créer eux-mêmes l’inscription d’app avec le bon paramètre multi-locataire,
les ~58 bonnes autorisations, le consentement d’administrateur et les
deux rôles RBAC pour les modules PowerShell. Facile de manquer quelque
chose et de s’en rendre compte des mois plus tard, quand une
fonctionnalité ne marche pas en silence.

Cette version ajoute une étape **Inscription d’application** dédiée avec
un grand modal contenant des instructions clic par clic détaillées :

- Le catalogue complet des 58 autorisations (47 Microsoft Graph
  application + 6 déléguées, 1 Exchange Online, 2 Management APIs, 2
  Skype/Teams), ordonné pour correspondre à l’interface du portail
  Entra, avec une icône de copie sur chaque nom d’autorisation (plus
  un bouton « tout copier » par catégorie).
- L’URI de redirection dérivée du nom d’hôte, copiable en un clic.
- Attributions de rôles du principal de service étape par étape
  (Administrateur Exchange + Administrateur de la conformité), avec
  des avertissements explicites contre les rôles aux noms similaires
  « Administrateur des destinataires Exchange » / « Administrateur des
  données de conformité » qui ont l’air bons mais ne fonctionneront pas.
- Guide pour créer les trois groupes RBAC (Panoptica365 Admins /
  Operators / Viewers) avec des noms suggérés correspondant à la
  nomenclature interne des rôles de Panoptica365, plus boutons de copie.
- Encadrés codés en couleur : rouge pour les pièges « ne pas faire »,
  ambre pour les étapes faciles à manquer, vert pour les indices
  « vous devriez voir » de confirmation.
- Lien « J’ai déjà une inscription d’app — passer » pour les opérateurs
  qui ont provisionné via PowerShell ou qui réinstallent.

L’étape de collage des identifiants a maintenant :

- Trois champs d’ID de groupe (Admins / Operators / Viewers) au lieu
  d’uniquement l’admin, avec admin marqué recommandé et les deux autres
  facultatifs.
- Un bouton **Tester la connexion** qui acquiert un jeton applicatif
  et lance ~9 appels Graph représentatifs en parallèle. Si la demande
  de jeton échoue, il diagnostique les codes d’erreur Microsoft courants
  (AADSTS7000215 = mauvaise valeur de secret collée, AADSTS90002 =
  mauvais ID de locataire, etc.). Si le jeton fonctionne mais que les
  appels Graph retournent 403, il liste exactement quelles autorisations
  sont manquantes (la cause la plus fréquente est « oublié de cliquer
  sur Accorder le consentement de l’administrateur »).
- Un lien « Rouvrir le modal d’instructions d’inscription d’app » au cas
  où l’opérateur doit revérifier une étape.

Entièrement localisé en/fr/es.

---

## Version 0.1.12 — 2026-05-24

### Assistant : les liens et blocs de code intégrés s'affichent correctement

Plusieurs descriptions de l'assistant font référence à Entra
(entra.microsoft.com), à la console Anthropic, à des exemples de noms
d'hôte et au format de clé d'activation `PNX-...`. Ces liens `<a>` et
fragments `<code>` étaient affichés sous forme de texte HTML brut. Le
rendu utilise maintenant le bon mode innerHTML pour les clés i18n
contenant du balisage.

(Détecté lors de la vérification du peaufinage de v0.1.11 sur P365-Test.)

---

## Version 0.1.11 — 2026-05-24

### Peaufinage de l'assistant

Deux petits correctifs détectés lors de la vérification de bout en bout
sur P365-Test (v0.1.10) :

- **Le bouton Retour préserve désormais les valeurs saisies.** Les
  champs du formulaire (y compris les longs GUID Entra, le serveur,
  l'utilisateur et le mot de passe SMTP, la clé Anthropic et la clé
  d'activation de licence) ne sont plus réinitialisés lorsque vous
  cliquez sur Retour. Les valeurs sont mémorisées lors de la navigation
  entre les étapes au sein de la même session d'assistant.

- **Bandeau d'en-tête redessiné.** L'assistant dispose maintenant d'un
  bandeau chromé pleine largeur en haut, avec un logo Panoptica365 bien
  visible et le sélecteur de langue, dans le style visuel de l'en-tête
  de l'application principale. Remplace le petit logo flottant qui
  était peu visible sur le fond sombre.

---

## Version 0.1.10 — 2026-05-24

### Assistant de configuration initiale

Les nouvelles installations démarrent maintenant dans un assistant web
guidé de 7 étapes plutôt que d'exiger une édition manuelle du fichier
`.env` et un appel `curl` d'activation de licence. L'assistant guide
les opérateurs à travers le nom d'hôte et TLS, l'inscription
d'application Entra, le SMTP avec envoi de test, la clé API Anthropic
avec appel de test, l'activation de licence contre le serveur de
licence et un onboarding facultatif du premier locataire.

Les installations existantes sont détectées automatiquement — si un
`LICENSE_TOKEN` valide est déjà présent dans `.env`, la configuration
est marquée comme terminée rétroactivement et l'assistant n'apparaît
jamais. Aucune action requise pour les opérateurs actuels.

L'assistant est entièrement localisé en anglais, français québécois et
espagnol. Les opérateurs choisissent la langue via le sélecteur en haut
à droite ; le choix se reporte sur leurs préférences d'opérateur une
fois la configuration terminée.

---

## Version 0.1.9 — 2026-05-24

### Les images de conteneur proviennent maintenant du GitHub Container Registry

Les nouvelles installations clients ne construisent plus l'image
Panoptica365 à partir du code source. L'image Docker publiée est désormais
publiquement disponible à `ghcr.io/panoptica365/app:latest`, et
`docker-compose.yml` la récupère directement. Il s'agit du prérequis pour
l'installateur de la phase 4 (`install.panoptica365.com/run`, à venir sous
peu) — une commande d'installation d'une ligne permettra de monter une
pile Panoptica365 fonctionnelle sur un hôte Ubuntu vierge en quelques
minutes, sans environnement de développement.

Les installations existantes ne voient aucun changement de comportement.
Pour ceux qui itèrent sur le code source local en mode développement, le
bloc `build:` du fichier compose est conservé — `docker compose build &&
docker compose up` fonctionne exactement comme avant.

---

## Version 0.1.8 — 2026-05-24

### Validation de licence

Panoptica365 exige désormais une licence valide pour démarrer. Chaque
installation s'active une fois contre `license.panoptica365.com` pour
échanger une clé d'activation contre un jeton signé, puis renouvelle ce
jeton chaque semaine pour rester à jour. Le serveur de licence n'est
contacté que pour l'activation et le renouvellement — la vérification
quotidienne est entièrement hors ligne, donc une panne du serveur de
licence ne peut pas mettre votre installation hors service.

L'activation est unique par installation. Une fois que l'installateur (ou
un `curl` contre `/api/v1/activate`) a déposé le jeton dans `.env`, le
démarrage le vérifie et conserve une copie de sauvegarde dans
`data/state/license-cache.json`, de sorte qu'un effacement accidentel de
`.env` ne vous coûte jamais de temps d'arrêt.

### Bannière d'expiration

Si une licence payante dépasse sa date d'expiration, une bannière apparaît
en haut de page — ambre pendant la période d'avertissement de 14 jours,
légèrement plus foncée pour les jours 15 à 21 lorsque l'ajout de nouveaux
locataires, modèles Intune et modèles d'accès conditionnel est désactivé,
puis rouge à partir du jour 22 lorsque l'installation passe en mode
lecture seule. Les licences NFR ne voient jamais la bannière, car elles
sont perpétuelles par conception.

Le texte de la bannière et le bouton **Contactez license@panoptica365.com**
sont entièrement localisés en anglais, en français québécois et en
espagnol.

### Ce qui NE change PAS

Les alertes existantes, l'interrogation, la détection de dérive, les
paramètres de sécurité, les rapports et toutes les autres fonctionnalités
continuent exactement comme avant. La validation de licence est une couche
mince au niveau du démarrage et d'un middleware — elle ne touche à aucun
comportement opérationnel sur une licence en règle.

---

## Version 0.1.7 — 2026-05-22

### Voir les nouveautés — dans l'application

L'en-tête comporte désormais un menu **Quoi de neuf** (cliquez sur votre nom
en haut à droite). Chaque version place ses faits saillants à un clic — la
version la plus récente s'affiche par défaut, avec un onglet déroulant
**Versions antérieures** pour consulter l'historique complet.

Vous verrez aussi un petit point non lu à côté de votre nom dès qu'il existe
une version que vous n'avez pas encore consultée, et une notification unique
au premier chargement après une mise à jour — pour qu'aucune nouvelle
version ne vous échappe.

Deux autres petits ajouts dans la même zone : le bouton **Se déconnecter** a
été intégré au même menu déroulant (à côté de Préférences), et la version
actuelle de l'application est désormais affichée au bas de la barre latérale
gauche.

---

## Version 0.1.6 — 2026-05-22

### Nouveau rapport — Évaluation rapide

Un nouveau type de rapport est disponible sous **Rapports → Évaluation
rapide**. Alors que le rapport Documentation de configuration est un
instantané purement factuel, l'Évaluation rapide est un rapport *consultatif*
: il prend la configuration actuelle d'un locataire et la passe à une analyse
approfondie par IA qui met en lumière les forces, les faiblesses et — surtout
— **ce qui manque**.

Il passe en revue l'Accès conditionnel, Intune et l'ensemble des paramètres
de sécurité, et signale les écarts par rapport aux références recommandées
par Microsoft : politiques d'Accès conditionnel manquantes, politiques Intune
absentes ou faibles, paramètres de sécurité qui ont dérivé de leur état
recommandé. Lorsque Panoptica365 dispose déjà d'un modèle capable de combler
une lacune, la recommandation est signalée comme un déploiement en un clic —
et un écart est tout de même rapporté même si aucun modèle n'existe pour le
combler.

Lorsque vous cliquez sur **Générer le rapport**, une boîte apparaît dans
laquelle vous pouvez ajouter du contexte en texte libre pour l'analyse — le
type d'entreprise du client, ses préoccupations connues, tout élément que
l'analyse doit prendre en compte (vous pouvez y coller des notes). Le rapport
est un instantané ponctuel — sans plage de dates — et il est disponible pour
les locataires en mode audit uniquement, ce qui en fait un livrable naturel
pour un engagement d'essai.

### « Interroger maintenant » ne signale plus d'expiration erronée

Le déclenchement d'une interrogation à la demande d'un locataire — surtout
s'il vient d'être ajouté, où la première interrogation doit tout récupérer —
pouvait afficher une erreur « Échec de l'interrogation : HTTP 504 » alors
même que l'interrogation se poursuivait et se terminait avec succès.

Les interrogations à la demande s'exécutent désormais en arrière-plan.
L'interrogation démarre immédiatement, le tableau de bord conserve son état
« Sondage… », et la page se rafraîchit d'elle-même dès que l'interrogation
se termine (ou signale une erreur claire si elle échoue réellement). Une
interrogation de longue durée ne peut plus déclencher d'expiration de la
passerelle.

### Les rapports PDF se génèrent désormais sur les installations serveur

La génération d'un rapport de Documentation ou de Posture de sécurité d'un
locataire pouvait échouer sur une installation serveur avec une erreur
« No module named … » — le programme d'installation n'aprovisionnait pas les
bibliothèques Python (ReportLab, matplotlib) dont dépendent les générateurs
PDF. Le script d'installation crée maintenant un environnement Python dédié
avec ces bibliothèques, de sorte que la génération de rapports PDF fonctionne
dès l'installation.

### L'ajout d'un nouveau locataire est désormais fiable dès la première tentative

L'intégration d'un tout nouveau locataire pouvait échouer dès la première
tentative avec une erreur de consentement — l'application Panoptica365
finissait enregistrée dans le locataire client avec ses permissions
accordées, mais le locataire n'apparaissait pas dans votre liste, vous
obligeant à exécuter **Ajouter un locataire** une seconde fois pour qu'il
s'affiche.

La cause : le point de terminaison de consentement administrateur de
Microsoft échouait par intermittence à la redirection lorsque des permissions
pour deux API différentes (Microsoft Graph et l'API d'administration Teams)
étaient demandées dans un même consentement — alors même que le consentement
lui-même avait réussi. Ajouter un locataire les demande maintenant en deux
étapes de consentement distinctes : la première enregistre le locataire, la
seconde accorde les permissions d'administration Teams. Une défaillance à la
première tentative ne se produit plus. Vous verrez deux écrans de
consentement Microsoft pendant l'ajout d'un locataire au lieu d'un, et le
locataire est enregistré après le premier, quel que soit le résultat du
second.

---

## Version 0.1.5 — 2026-05-21

### Suppressions plus propres des locataires en mode audit uniquement

Lorsqu'un locataire en mode audit uniquement atteint la fin de son cycle de
vie de 21 jours et est automatiquement nettoyé de Panoptica365, l'opérateur
reçoit un courriel récapitulatif confirmant ce qui a été supprimé.
Auparavant, ce courriel pouvait inclure un avertissement parasite « 1 erreur
lors de la cascade » qui faisait référence à une table de catalogue de règles
globales que le nettoyage n'avait jamais besoin de toucher. L'avertissement
était visuellement alarmant mais n'avait aucun effet sur le nettoyage réel.

L'inventaire de nettoyage a été corrigé. Les futures suppressions de
locataires en mode audit uniquement signaleront zéro erreur dans le courriel
récapitulatif — ce que vous voyez dans le courriel correspond désormais à ce
qui s'est réellement passé.

### Document de conception du mode audit uniquement mis à jour

Le document de conception à `Documentation/Audit-Only-Tenant-Mode.docx` a été
enrichi d'une annexe d'état en date du 2026-05-21. L'annexe consigne la
validation en production de bout en bout sur le premier locataire payant en
mode audit (consentement → interrogation → exportation d'instantané →
courriel d'avertissement à 14 jours → suppression en cascade à 21 jours +
rappel de révocation), le balayage d'intégration ajouté le 29 avril pour
exclure les locataires en mode audit des alertes/IA/notifications/
vérifications de santé, l'extraction Graph en direct ajoutée au regroupeur
d'instantanés le même jour, et la correction de l'inventaire de cascade
ci-dessus.

---

## Version 0.1.4 — 2026-05-21

### Basculement rapide entre locataires depuis le tableau de bord

L'en-tête du tableau de bord du locataire inclut désormais un **sélecteur de
locataire** — une liste déroulante répertoriant tous vos locataires, à
l'emplacement où se trouvait auparavant le nom du locataire.

- Passez directement du tableau de bord d'un locataire à celui d'un autre
  sans revenir à la console principale et choisir un locataire dans la liste.
- Votre onglet actuel est conservé lors du basculement. Si vous consultez
  les **Politiques Intune** d'un locataire, choisir un autre locataire vous
  amène directement aux **Politiques Intune** de ce locataire — et il en va
  de même pour les onglets Vue d'ensemble, Alertes, Politiques AC et
  Journal des modifications.

Cela élimine plusieurs clics dans la tâche courante de passer en revue la
même zone sur plusieurs locataires.
