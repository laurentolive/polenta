# 4. Tests et campagnes

[English](../tutorials/04-tests-campaigns.md) | **Français**

Un **cas de test** décrit comment vérifier une ou plusieurs exigences. Une **campagne** regroupe des
tests à exécuter ensemble et garde leurs résultats ; chaque résultat dit sur quelle **version** du
produit le test a été passé.

## Les cas de test

Vue **Tests**, type *Lave-linge LL800 / Test Système*. Comme les exigences, les tests sont rangés
en sections et listés en tableau, avec les champs de leur type : niveau, durée estimée, test
destructif…

![Tests système en vue tableau](../img/test-table.png)

Ouvrir **TSYS-0001** (*Mesure de la capacité de charge*) et descendre en bas de l'éditeur :

![Liens et étapes de TSYS-0001](../img/test-steps.png)

- **Liens** : TSYS-0001 *vérifie* PRD-0001. C'est ce lien qui rend l'exigence couverte.
- **Étapes** : une action et un résultat attendu par ligne ; **+ Ajouter une étape** en ajoute une.
  Le résultat attendu de l'étape 1 contient le paramètre `{capacite_kg}` : sa valeur est figée au
  moment où le test entre dans une campagne.
- **Exécutions** : la grille de tous les passages du test, toutes campagnes confondues (voir plus
  bas).

Un test peut aussi itérer sur des exigences : TSYS-0005 (*Vérification des KPI produit*) vérifie le
`{req.kpi_cible}` de chaque exigence qu'on lui associe, avec une instance par exigence dans la
campagne CAMP-0003.

### Les champs d'exécution

Le type de test peut déclarer, dans le modèle de données, des **Champs d'exécution** (saisis une
fois par passage : numéro de série de l'échantillon, banc utilisé…) et des **Champs d'étape**
(saisis à chaque étape : valeur mesurée…). La colonne **Oblig. si** les rend obligatoires selon le
résultat (`result = FAIL` : décrire l'écart). Ils apparaissent à l'exécution et dans le classeur
Excel d'exécution.

Les tests système de la démo ont un champ d'exécution *Banc utilisé* et un champ d'étape *Mesure
relevée*. Le passage de TSYS-0002 en DVT les renseigne : banc B2, 1392 tr/min à la première étape.

## Les campagnes

Vue **Campagnes**. Le dépôt produit en compte cinq, pour les jalons EVT, DVT et PVT :

![Les campagnes de la démo](../img/campaigns.png)

| Campagne | Statut |
|---|---|
| CAMP-0001 EVT | terminée |
| CAMP-0002 DVT | en cours |
| CAMP-0003 KPI | en cours |
| CAMP-0004 Endurance | abandonnée |
| CAMP-0005 PVT | planifiée |

Chaque ligne indique les tests de la campagne et le décompte des résultats. **+ Nouvelle
campagne** en crée une à partir des tests choisis ; dans le sélecteur de tests, ⚙️ choisit les
colonnes affichées, sans perdre la sélection. L'onglet **Depuis une campagne** reprend des entrées
d'une autre campagne : la PVT a ainsi reporté TSYS-0004 depuis la DVT (*Reporté depuis CAMP-0002*).

Une campagne ne contient que des tests de son dépôt. Les tests du moteur ont leur campagne dans
`comp-moteur` : CMOT-0001, *Essais de protection de l'onduleur*, où TMOT-0003 est en échec.

## Une campagne en cours

Ouvrir **DVT — Essais de vérification design** :

![Campagne DVT](../img/campaign.png)

- Les valeurs de paramètres sont celles lues quand le test est entré dans la campagne : la même
  mesure attend 1200 tr/min dans la campagne EVT et 1400 tr/min dans la campagne DVT, créée après le
  changement de valeur.
- Le bandeau orange signale une **référence de paramètre non résolue** dans TSYS-0011 : un
  composant inconnu et une valeur vide. Le test reste exécutable, mais le testeur est prévenu.
- Chaque test a son résultat (*Passé*, *Incomplet*, *En attente*), **Voir** pour relire la dernière
  exécution, **Exécuter** pour en faire une nouvelle. Le résultat de TSYS-0006 vient d'un classeur
  Excel d'exécution (plus bas).
- TSYS-0003 a été retiré de la campagne après son ajout : l'entrée retirée reste dans le fichier de
  la campagne, avec sa date de retrait.
- En bas, **Clore la campagne** ou **Abandonner**.

## Exécuter un test

**Exécuter** sur *TSYS-0008 Détection de balourd* :

![Exécution pas à pas de TSYS-0008](../img/campaign-execute.png)

1. Lire les **préconditions**.
2. Indiquer la **Version testée** : le dépôt produit déclare des versions
   ([tutoriel 9](09-versions.md)), elle est donc obligatoire. Une version de la liste (en cours ou
   livrée), ou **Autre (texte libre)…** ; la version de l'exécution précédente est proposée. Les
   passages de la DVT portent LLV-0002, la version `2.0` en cours. **Structure testée** détaille la
   version de chaque composant et permet de noter un écart : TSYS-0007 a été passé avec un moteur
   en *préversion 1.3-rc2*, au lieu de la version `1.2.4` prévue.
3. Pour chaque étape, choisir le résultat (*Passé*, *Échoué*, *Bloqué*, *Ignoré*), remplir les
   champs d'étape, noter un commentaire si besoin.
4. Remplir les champs d'exécution, choisir le **résultat global** (*Passé*, *Échoué*, *Bloqué*,
   *Incomplet*) et **Soumettre le résultat**.

Le résultat est enregistré dans `test-runs/` du dépôt du test, avec une copie figée de la version
et de la structure testées. Un test du moteur s'exécute dans une campagne du moteur : le résultat en
échec de TMOT-0003 est dans `comp-moteur`, rattaché à CMOT-0001. Quand un test est exécuté
plusieurs fois, la dernière exécution fait foi : TSYS-0004, en échec en EVT, est passé en DVT.

**En cas d'échec**, Polenta propose de tracer le problème : *Exécution en échec — voulez-vous tracer
ce problème dans une issue ?*, avec **Créer une issue**, **Lier à une issue existante** ou
**Ignorer** ([tutoriel 10](10-issues-validation.md)). Dans la démo, l'échec de TSYS-0004 en EVT a
donné ISS-0001, et celui de TSYS-0005 sur PRD-0002 (1352 tr/min mesurés) a donné ISS-0003.

## L'historique des exécutions

En bas de la fiche d'un test, et de celle d'une exigence, la section **Exécutions** liste tous les
passages : verdict, date, testeur, durée, campagne, version du test, **version testée**, écarts,
origine (*saisie* ou *import Excel*)… **Colonnes** choisit les colonnes, **Afficher les étapes**
détaille chaque passage. C'est l'endroit pour répondre à « sur quelle version ce test a-t-il été
passé ? ».

## Hors de l'outil

En haut de la campagne :

| Bouton | Usage |
|---|---|
| **Exporter le cahier** | le plan de test, à imprimer ou à faire relire |
| **Exporter le rapport** | les résultats de la campagne |
| **Excel d'exécution** | **Exporter le classeur d'exécution…** à remplir au banc (étapes, champs d'exécution, version testée), puis **Importer des résultats…** : un aperçu sépare les lignes à importer, en erreur et en avertissement avant l'import |

## Exercices

**Ajouter une étape à un test.**
1. Ouvrir TSYS-0011 (brouillon), **+ Ajouter une étape** : une action, un résultat attendu.

Résultat : l'étape apparaît dans la page du test, à la suite des autres.

**Créer une campagne, puis modifier un test.**
1. **+ Nouvelle campagne** avec TSYS-0009 et TSYS-0010 (CAMP-0006 sur une démo neuve).
2. Modifier une étape de TSYS-0009.
3. Rouvrir la campagne.

Résultat : la campagne garde la copie du test prise à sa création. Polenta signale que le test a
changé depuis et propose de mettre l'entrée à jour.

**Chercher un test du moteur dans une campagne produit.**
1. **+ Nouvelle campagne**, **Sélectionner des tests…** : chercher TMOT-0003.
2. Vue **Campagnes**, campagnes de `comp-moteur` : ouvrir CMOT-0001.

Résultat : le sélecteur ne propose que des tests du dépôt produit ; TMOT-0003 n'y est pas. Il est
dans CMOT-0001, avec son résultat en échec.

**Saisir les champs d'exécution.**
1. Ouvrir CAMP-0005, **Exécuter** sur TSYS-0001.
2. Choisir LLV-0002 comme version testée, renseigner *Banc utilisé* et une *Mesure relevée* par
   étape, puis **Soumettre le résultat**.
3. **Voir** le résultat.

Résultat : le banc et les mesures sont enregistrés dans l'exécution.

**Indiquer la version testée.**
1. Ouvrir CAMP-0002, **Exécuter** sur TSYS-0008.
2. Soumettre sans version testée.
3. Choisir LLV-0002. Dans **Structure testée**, indiquer pour `comp-moteur` une autre valeur que
   `1.2.4`, puis soumettre.

Résultat : à l'étape 2, l'exécution est refusée : *La version testée est obligatoire.* (code
`TESTED_VERSION_REQUIRED`). À l'étape 3, l'exécution est enregistrée avec un écart, affiché dans
l'historique des exécutions.

**Lire l'historique d'un test.**
1. Ouvrir TSYS-0004, section **Exécutions**.

Résultat : un échec en EVT (CAMP-0001), sans version testée, puis un succès en DVT (CAMP-0002) sur
la version `2.0`.

**Reporter des résultats et retirer une entrée.**
1. **+ Nouvelle campagne**, onglet **Depuis une campagne** : cocher CAMP-0002 et reprendre ses
   entrées passées.
2. Dans la nouvelle campagne, exécuter un test, puis **Retirer ce test de la campagne**.

Résultat : les entrées reprises portent *Reporté depuis CAMP-0002*. L'entrée retirée quitte la liste
mais reste dans le fichier de la campagne, avec son exécution.

**Exécuter un test itératif.**
1. Ouvrir CAMP-0003 : une instance de TSYS-0005 par exigence liée.
2. Exécuter l'instance de PRD-0001.

Résultat : chaque instance attend le `{req.kpi_cible}` de son exigence ; l'instance de PRD-0002 est
en échec (1352 tr/min).

**Exécuter hors de l'outil.**
1. Ouvrir CAMP-0005, **Excel d'exécution › Exporter le classeur d'exécution…**.
2. Remplir une ligne (résultat, version testée, champs d'exécution), enregistrer.
3. **Importer des résultats…**, relire l'aperçu, importer.

Résultat : l'exécution importée porte l'origine *import Excel*, comme celle de TSYS-0006 dans la
DVT.

**Mettre un test en échec.**
1. Ouvrir CAMP-0002, **Exécuter** sur TSYS-0008, version LLV-0002, résultat global *Échoué*.

Résultat : Polenta propose *Créer une issue*, *Lier à une issue existante* ou *Ignorer*. La suite se
fait au [tutoriel 10](10-issues-validation.md#exercices).
