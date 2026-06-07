---
title: "Administration du système"
subtitle: "Le reste des Paramètres et les surfaces système : fil du Centre de messages, image de marque, licences, diagnostics, santé, mises à jour et journal d'audit."
icon: "wrench"
last_updated: 2026-06-07
---

# Administration du système

Le guide de clôture : tout ce qu'un Administrateur touche à l'occasion plutôt qu'au quotidien. Tout vit dans **Paramètres** et dans la section **Système** de la barre latérale.

## Fil de messages Microsoft

Microsoft annonce les changements de plateforme dans le Centre de messages — y compris des changements qui modifieront des paramètres que vous surveillez. **Paramètres → Fil de messages Microsoft** vous permet de choisir **un locataire source** dont Panoptica365 lit le Centre de messages chaque jour. Claude filtre le fil pour ne garder que les éléments pertinents aux paramètres surveillés, et ceux-ci arrivent sous forme d'**une seule alerte à l'échelle du MSP** (pas de pollupostage par locataire). Choisissez votre propre locataire MSP ou votre locataire client le plus représentatif comme source; le contenu du fil est le même pour tout Microsoft.

## Image de marque des rapports

**Paramètres → Image de marque des rapports** — le nom de votre entreprise (la ligne *« Préparé par ___ »* sur les couvertures et pieds de page) et votre logo (PNG transparent, max 2 Mo, redimensionné automatiquement). À régler une fois, avant le premier livrable client.

## Clé API Claude

**Paramètres → Clé API Anthropic** — la clé derrière toutes les fonctions IA (analyse d'alertes, résumés, triage, narratifs de rapports). La rotation est indolore : collez la nouvelle clé, **Tester la clé**, puis **Enregistrer** — le processus en cours la prend en compte immédiatement, sans redémarrage.

## Licences

**Paramètres → Licences** — vue en lecture seule de vos sièges sous licence, de l'utilisation actuelle à travers les locataires surveillés, du palier et de l'expiration, avec un bouton **Actualiser maintenant**. Si vous dépassez vos sièges, c'est dit clairement; communiquez avec votre fournisseur pour en ajouter.

## Diagnostics et disque

**Diagnostics** capture un dossier de soutien — journaux, résumés de configuration, santé de la base de données — pour le dépannage avec le soutien technique. Les dossiers sont **expurgés** : aucun secret, mot de passe ni identifiant. Capturez, téléchargez, joignez à votre courriel de soutien.

**Espace disque** montre le stockage du serveur avec des avertissements à 80 % et un état rouge à 90 % — à ces niveaux, une bannière apparaît aussi en haut de l'application. Ne l'ignorez pas; un disque plein emporte la surveillance avec lui.

## Indicateur de santé

Le point de santé coloré dans l'en-tête est l'état de la plateforme elle-même : **Sain**, **Dégradé** ou **Brisé**. Cliquez dessus pour la fenêtre Santé du système — des vérifications par composant, pour que « Dégradé » devienne « quel sous-système, exactement ». Si les alertes semblent étrangement silencieuses, c'est le premier clic à faire. *Tous les systèmes sont normaux* est la réponse que vous voulez.

## Mises à jour et Quoi de neuf

Après une mise à jour, une notification annonce la nouvelle version et la fenêtre **Quoi de neuf dans Panoptica365** résume ce qui a changé — dans votre langue. Trente secondes, et elle fait régulièrement découvrir des fonctionnalités qui passeraient autrement inaperçues (ces guides sont d'ailleurs arrivés par l'une d'elles).

## Le Journal d'audit

**Journal d'audit** (barre latérale → Système, Administrateur) est le registre d'imputabilité, en deux vues :

- **Audit MSP** — les actions des opérateurs sur la plateforme elle-même : connexions, CRUD des modèles, changements de paramètres, refus de rôle (403), cycle de vie des locataires, exportations. Filtrez par catégorie, acteur, description, plage de dates et résultat; des cartes de synthèse montrent le volume et les échecs sur 30 jours.
- **Chronologie unifiée** — les événements d'audit MSP entrelacés avec les événements de changement par locataire (déploiements automatiques et changements consignés manuellement) en un seul flux. C'est la vue « que s'est-il passé autour de 15 h mardi » qui joint *qui a fait quoi dans Panoptica365* à *ce qui a changé dans les locataires*.

Cliquez sur n'importe quelle ligne pour le détail complet : acteur, IP, session, cible, métadonnées.

---

Voilà le tour complet. À partir d'ici, le reste d'Apprendre couvre les connaissances en *sécurité* derrière la plateforme — conception de l'accès conditionnel, références Intune, sécurité du courriel, Secure Score et les schémas d'attaque que vos alertes guettent. Ajoutez des locataires, déployez vos références, ajustez les alertes — puis laissez la plateforme faire la patrouille.
