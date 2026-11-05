# 9. Versions et analyse d'impact

[English](../tutorials/09-versions.md) | **Français**

Une **version** est l'état livré d'un dépôt — un composant, ou le produit pour le dépôt racine —
avec la liste des changements qu'elle apporte : `1.2.4` du moteur, `2.0` du lave-linge. Elle porte
l'**analyse d'impact** de ces changements et la liste des **tests à exécuter**, et se fige quand on
la livre. Les exécutions de test disent sur quelle version elles ont été faites
([tutoriel 4](04-tests-campagnes.md)), et la qualité valide une version
([tutoriel 10](10-issues-validation.md)).

Ce tutoriel visite les versions de la démo, puis explique comment déclarer un type de version sur
votre propre projet.

## Les versions de la démo

Chaque dépôt de la démo a son type de version, avec son propre préfixe (un préfixe est unique sur
tout le projet) :

| Dépôt | Version | Statut | Ce qu'elle montre |
|---|---|---|---|
| `ll800-produit` | LLV-0001 `1.0` | released | tag `ll800-produit-1.0`, analyse figée, validation signée |
| `ll800-produit` | LLV-0002 `2.0` | en cours | changements, analyse d'impact, tests à exécuter, validation en cours |
| `ll800-produit` | LLV-0003 `1.1` | abandonnée | correctif de la 1.0, abandonné au profit de la 2.0 |
| `comp-moteur` | MOTV-0001 `1.2.4` | released | tag `comp-moteur-1.2.4`, validation signée |
| `comp-moteur` | MOTV-0002 `1.3` | en cours | MOT-0007 et l'issue MISS-0001 |
| `comp-pompe-vidange` | POMV-0001 `1.0`, POMV-0002 `2.0` | released | la `2.0` porte le tag `v2.0`, celui du montage dans le produit |
| `comp-module-wifi` | WIFV-0001 `1.0` | released | |
| `if-bus-interne` | IFV-0001 `1.1` | released | tag `v1.1` |

Les statuts d'un type de version :

| Statut | Sens |
|---|---|
| **En cours** | la version se prépare : on y ajoute des changements |
| **Released** | livrée : figée, taguée dans git |
| **Abandonnée** | ne sera pas livrée |

## Ouvrir une version

Vue **Version** : le panneau s'ouvre sur **Version produit** (sinon, bouton à icône de paquet en
haut du panneau). Choisir le dépôt dans la liste déroulante : le panneau liste ses versions avec
leur statut ; **Afficher les versions abandonnées** fait réapparaître LLV-0003.

Ouvrir LLV-0001, la version `1.0` du lave-linge :

- **Version précédente** : aucune, c'est la première ;
- **Composants** : la version embarquée de chaque composant réutilisable — moteur `1.2.4`, pompe
  `1.0`, module Wi-Fi `1.0`. Le produit a trois composants : le bus interne est monté sous le
  moteur et suit sa version (MOTV-0001 embarque IFV-0001) ;
- **Changements** : toutes les exigences et tous les tests du dépôt, plus l'issue ISS-0001 ;
- le tag `ll800-produit-1.0` et l'analyse d'impact figée, présentée en tableau.

Un composant local (un dossier du dépôt produit, comme *Sous-système hydraulique*) n'a pas de
version propre : il est livré avec son dépôt. Un composant monté en lecture seule (la pompe, le
module Wi-Fi) non plus : sa version se crée dans son propre dépôt.

**Nouvelle version** crée une version : le **Label**, la **Version précédente** (celle sur laquelle
elle s'appuie, pour établir les changements) et la version embarquée de chaque composant. Un clic
droit sur une version permet de la copier ou de la supprimer tant qu'elle n'est pas livrée (son ID
n'est jamais réutilisé).

## Les changements et le backlog

Le **Backlog des changements** (dans le même panneau) liste les exigences, tests et issues du dépôt
modifiés depuis la dernière version livrée et pas encore rattachés à une version, avec leur
**Nature** : *nouveau*, *modifié*, ou *modifié hors interface* (fichier changé directement dans git).
Dans le dépôt produit, PRD-0006 y figure : elle a été modifiée après la `1.0`.

- Cocher des éléments, choisir la **Version cible**, puis **Inclure la sélection** (ou **Tout
  inclure**).
- Dans la page de la version, le tableau **Changements** liste ce qui est inclus (composant, type,
  ID, titre) ; **Voir les modifications** montre les différences avec la dernière version livrée ;
  **Ajouter** et **Retirer (retour au backlog)** ajustent la liste.

LLV-0002 inclut deux issues, ISS-0002 et ISS-0003, et PRD-0013. Un changement sans exigence ni test
pour le justifier (un correctif, une non-conformité) s'inclut ainsi par une **issue**
([tutoriel 10](10-issues-validation.md)).

## Analyser l'impact

La section **Analyse d'impact** de la page de la version part de chaque changement inclus et
déroule l'**arbre** des éléments liés : tests qui le vérifient, exigences qu'il raffine ou
implémente, et ainsi de suite. Une issue incluse ajoute comme points de départ les exigences qu'elle
impacte (*via ISS-…*) : dans LLV-0002, ISS-0003 amène PRD-0002, et ISS-0002 amène SYS-0004.

Pour chaque nœud de l'arbre :

- un **Statut d'impact**, de *Impact non vérifié* à *Modification vérifiée*, en passant par *Pas
  d'impact réel* ou *Modification à faire* ;
- un **Commentaire**, pour la revue.

Dans LLV-0002, SYS-0002 est en *Impact à tester*, avec le commentaire *À rejouer après la correction
de vitesse.* Tant que la version est en cours, l'analyse est recalculée à l'ouverture (*calculée le
…*) : un élément qui n'est plus atteint le signale. Au passage released elle est **figée**, comme
celle de LLV-0001.

## Les tests à exécuter

La section **Tests à exécuter** déduit de l'analyse les tests à repasser : pour chacun, ce qui l'a
**amené** (le changement d'origine) et la campagne où il figure **déjà**, le cas échéant ; elle
signale aussi les *exigences sans test*. Pour LLV-0002 : TSYS-0002, TSYS-0005 et TSYS-0008, et
PRD-0013 comme exigence sans test. Cocher des tests puis :

- **Créer une campagne** : ouvre la création de campagne avec ces tests ;
- **Ajouter à …** : les ajoute à une campagne existante.

La campagne n'est pas rattachée à la version : c'est chaque exécution qui note sa **version
testée**. Les passages de la DVT portent LLV-0002.

## Livrer : passer released

**Passer released** fige la version :

1. Polenta propose un **Tag** (`<dépôt>-<label>`, modifiable) ;
2. à la confirmation, il enregistre la version, pose le tag git et fige la liste des changements et
   l'analyse d'impact. Le tag part sur le serveur à la prochaine publication (*Tag … pas encore
   poussé* d'ici là).

Le passage est refusé tant qu'un composant embarqué n'est pas lui-même released, ou qu'un élément
inclus a des modifications non enregistrées dans git. Une version released ne se modifie plus,
comme une exigence approuvée. Dans la démo, chaque composant a été livré avant la `1.0` du produit.

Une fois la version livrée, la colonne **Design** des exigences ([tutoriel 3](03-exigences.md#les-quatre-statuts-dune-exigence))
affiche son label pour chaque exigence qu'elle contient dans son état actuel : `1.0` pour
PRD-0001, « — » pour PRD-0006, modifiée depuis.

## Sur le disque

Une version est un fichier `versions/<ID>.yaml` du dépôt : label, version précédente, versions des
composants, changements inclus, saisies de l'analyse d'impact, puis, au passage released, le tag, le
commit et l'analyse figée.

> **Sur votre projet**
>
> Un dépôt a au plus un type de version : chaque dépôt de la démo a déjà le sien. Sur votre projet,
> dans *Projet › Modèle de données › Structure*, sur la ligne du dépôt, **+** puis **+ Version**. Le
> type reçoit un préfixe par défaut, à remplacer au besoin (voir ceux de la démo : `LLV`, `MOTV`…),
> et les trois statuts ci-dessus. Comme pour les autres types, champs et libellés de statuts sont
> modifiables.

## Exercices

**Comparer les trois versions du produit.**
1. Vue **Version**, dépôt produit : ouvrir LLV-0001, LLV-0002, puis LLV-0003 (**Afficher les
   versions abandonnées**).
2. **Nouvelle version** avec le label `1.0`.
3. Recommencer avec le label `1.1`.

Résultat : trois statuts — released, en cours, abandonnée. Le label `1.0` est refusé : *Label déjà
utilisé : …* (code `LABEL_TAKEN`). Le label `1.1`, celui d'une version abandonnée, est accepté : la
version créée est LLV-0004.

**Inclure un changement.**
1. **Backlog des changements** du dépôt produit : cocher PRD-0006.
2. **Version cible** LLV-0002, **Inclure la sélection**.

Résultat : PRD-0006 quitte le backlog et apparaît dans les **Changements** de LLV-0002. L'analyse
d'impact part aussi de PRD-0006.

**Mener l'analyse d'impact.**
1. Ouvrir LLV-0002, **Analyse d'impact** : sur TSYS-0005, choisir *Modification à faire* et écrire
   un commentaire.
2. **Tests à exécuter** : cocher les trois tests, **Créer une campagne**.

Résultat : le statut et le commentaire sont enregistrés dans `versions/LLV-0002.yaml`. La campagne
créée (CAMP-0006 sur une démo neuve) contient TSYS-0002, TSYS-0005 et TSYS-0008.

**Livrer une version de composant.**
1. Ouvrir MOT-0007 (*comp-moteur*), modifier son énoncé, sans publier.
2. Vue **Version**, dépôt `comp-moteur`, MOTV-0002 : **Passer released**.
3. **Terminal**, **Aller à …** `comp-moteur`, puis `git commit -am "Rendement de l'onduleur"`.
4. **Passer released** à nouveau, avec le tag proposé `comp-moteur-1.3`.

Résultat : à l'étape 2, le passage est refusé : *Éléments inclus modifiés et non commités : …*
(code `DIRTY_CHANGES`). À l'étape 4, MOTV-0002 est released et le tag `comp-moteur-1.3` est posé
localement (*pas encore poussé*). Ce passage ne se défait pas : repartir ensuite d'une démo propre
([tutoriel 2](02-prise-en-main.md#repartir-dune-démo-propre)).
