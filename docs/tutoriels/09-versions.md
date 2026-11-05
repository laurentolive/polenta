# 9. Versions et analyse d'impact

[English](../tutorials/09-versions.md) | **Français**

Une **version** est l'état livré d'un dépôt — un composant, ou le produit pour le dépôt racine —
avec la liste des changements qu'elle apporte : `1.2.4` du moteur, `2.0` du lave-linge. Elle porte
l'**analyse d'impact** de ces changements et la liste des **tests à exécuter**, et se fige quand on
la livre. Les exécutions de test disent sur quelle version elles ont été faites
([tutoriel 4](04-tests-campagnes.md)), et la qualité valide une version
([tutoriel 10](10-issues-validation.md)).

La démo ne déclare pas de versions : ce tutoriel se suit en ajoutant un type de version au dépôt
produit de la démo, ou sur votre propre projet.

## Déclarer un type de version

Un dépôt a au plus un type de version. Dans *Projet › Modèle de données › Structure*, sur la ligne du
dépôt (*Lave-linge LL800*), **+** puis **+ Version**. Le type reçoit un préfixe (`LLV`…) et les
statuts par défaut :

| Statut | Sens |
|---|---|
| **En cours** | la version se prépare : on y ajoute des changements |
| **Released** | livrée : figée, taguée dans git |
| **Abandonnée** | ne sera pas livrée |

Comme pour les autres types, champs et libellés de statuts sont modifiables. Un composant local (un
dossier du dépôt produit) n'a pas de version propre : il est livré avec son dépôt. Un composant en
lecture seule non plus : sa version se crée dans son propre dépôt.

## Créer une version

Vue **Version** : le panneau s'ouvre sur **Version produit** (sinon, bouton à icône de paquet en haut du panneau) :

1. choisir le dépôt dans la liste déroulante ;
2. **Nouvelle version** : le **Label** (`1.0`), la **Version précédente** (celle sur laquelle elle
   s'appuie, pour établir les changements) et, pour chaque composant réutilisable, la version de ce
   composant qu'elle embarque ;
3. **Créer**.

Le panneau liste les versions du dépôt avec leur statut ; **Afficher les versions abandonnées** les
fait réapparaître. Un clic droit sur une version permet de la copier ou de la supprimer tant
qu'elle n'est pas livrée (son ID n'est jamais réutilisé).

## Les changements et le backlog

Le **Backlog des changements** (dans le même panneau) liste les exigences, tests et issues du dépôt
modifiés depuis la dernière version livrée et pas encore rattachés à une version, avec leur
**Nature** : *nouveau*, *modifié*, ou *modifié hors interface* (fichier changé directement dans git).

- Cocher des éléments, choisir la **Version cible**, puis **Inclure la sélection** (ou **Tout
  inclure**).
- Dans la page de la version, le tableau **Changements** liste ce qui est inclus (composant, type,
  ID, titre) ; **Voir les modifications** montre les différences avec la dernière version livrée ;
  **Ajouter** et **Retirer (retour au backlog)** ajustent la liste.

Un changement sans exigence ni test pour le justifier (un correctif, une non-conformité) s'inclut
par une **issue** ([tutoriel 10](10-issues-validation.md)).

## Analyser l'impact

La section **Analyse d'impact** de la page de la version part de chaque changement inclus et
déroule l'**arbre** des éléments liés : tests qui le vérifient, exigences qu'il raffine ou
implémente, et ainsi de suite. Une issue incluse ajoute comme points de départ les exigences qu'elle
impacte (*via ISS-…*).

Pour chaque nœud de l'arbre :

- un **Statut d'impact**, de *Impact non vérifié* à *Modification vérifiée*, en passant par *Pas
  d'impact réel* ou *Modification à faire* ;
- un **Commentaire**, pour la revue.

Tant que la version est en cours, l'analyse est recalculée à l'ouverture (*calculée le …*) : un
élément qui n'est plus atteint le signale. Au passage released elle est **figée** et présentée en
tableau.

## Les tests à exécuter

La section **Tests à exécuter** déduit de l'analyse les tests à repasser : pour chacun, ce qui l'a
**amené** (le changement d'origine) et la campagne où il figure **déjà**, le cas échéant ; elle
signale aussi les *exigences sans test*. Cocher des tests puis :

- **Créer une campagne** : ouvre la création de campagne avec ces tests ;
- **Ajouter à …** : les ajoute à une campagne existante.

La campagne n'est pas rattachée à la version : c'est chaque exécution qui note sa **version
testée**.

## Livrer : passer released

**Passer released** fige la version :

1. Polenta propose un **Tag** (`<dépôt>-<label>`, modifiable) ;
2. à la confirmation, il enregistre la version, pose le tag git et fige la liste des changements et
   l'analyse d'impact. Le tag part sur le serveur à la prochaine publication (*Tag … pas encore
   poussé* d'ici là).

Le passage est refusé tant qu'un composant embarqué n'est pas lui-même released, ou qu'un élément
inclus a des modifications non enregistrées. Une version released ne se modifie plus, comme une
exigence approuvée.

Une fois la version livrée, la colonne **Design** des exigences ([tutoriel 3](03-exigences.md#les-quatre-statuts-dune-exigence))
affiche son label pour chaque exigence qu'elle contient dans son état actuel.

## Sur le disque

Une version est un fichier `versions/<ID>.yaml` du dépôt : label, version précédente, versions des
composants, changements inclus, saisies de l'analyse d'impact, puis, au passage released, le tag, le
commit et l'analyse figée.
