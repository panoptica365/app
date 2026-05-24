# Quoi de neuf dans Panoptica365

Notes de version destinées aux clients. Chaque version ci-dessous décrit ce
qui a changé dans cette version, les plus récentes en premier.

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
