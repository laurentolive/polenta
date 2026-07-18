# T97 — Scénarios de test

Prérequis commun : un test `TEST-000X` avec au moins un `{label}` dans une étape ou dans
`preconditions`/`postconditions`, et une campagne active (`planned` ou `in_progress`).

## Scénarios nominaux (golden path)

### T97-01 — Détection d'un paramètre unique
1. Créer/éditer un cas de test dont une étape contient `{voltage}` dans `expectedResult`
   (ex. "Le courant mesuré doit être {voltage}").
2. Ouvrir une campagne active, "+ Ajouter des tests", cocher ce test.
3. **Attendu** : un champ de saisie libellé `{voltage}` apparaît sous la ligne du test coché.

### T97-02 — Saisie bloquante puis ajout
1. Suite de T97-01, laisser le champ `{voltage}` vide, cliquer "Ajouter".
2. **Attendu** : le bouton "Ajouter" est désactivé (ou le clic ne produit aucun effet) tant
   que le champ est vide.
3. Saisir `24V`, cliquer "Ajouter".
4. **Attendu** : le test est ajouté à la campagne (comportement actuel `addTests` inchangé
   sur le reste : dédoublonnage, statut `pending`, campagne passe en `in_progress` si elle
   était `planned` seulement après la première saisie de résultat — inchangé).

### T97-03 — Substitution à l'exécution
1. Suite de T97-02, ouvrir "Exécuter" sur ce test dans la campagne.
2. **Attendu** : le texte de l'étape affiche "Le courant mesuré doit être 24V" — plus de
   `{voltage}` littéral visible dans preconditions/steps/postconditions.

### T97-04 — Cohérence exécution / relecture
1. Suite de T97-03, soumettre le résultat du test (peu importe le résultat par étape).
2. Ouvrir "Voir" sur ce test depuis la liste de la campagne (page `run.$testId`).
3. **Attendu** : même substitution `{voltage}` → `24V` affichée qu'à l'exécution (T97-03).

### T97-05 — Paramètre répété dans plusieurs champs
1. Créer un test avec `{voltage}` présent dans `preconditions`, l'étape 1 `action`, et
   l'étape 2 `expectedResult`.
2. Ajouter ce test à une campagne avec `voltage = 12V`.
3. **Attendu** : un seul champ de saisie `{voltage}` proposé à l'ajout (pas 3) ; à
   l'exécution, les 3 occurrences affichent `12V`.

### T97-06 — Test sans paramètre : comportement inchangé
1. Ajouter à une campagne un test qui ne contient aucun `{label}`.
2. **Attendu** : aucun champ de saisie supplémentaire, ajout immédiat comme avant ce
   ticket ; à l'exécution, rendu identique à avant T97.

### T97-07 — Ajout groupé, paramètres partiels
1. Dans le panneau "+ Ajouter des tests", cocher 3 tests : deux ayant chacun un paramètre
   différent (`{voltage}` et `{duration}`), un sans paramètre.
2. **Attendu** : deux formulaires de saisie distincts apparaissent (un par test concerné),
   le troisième test n'a aucun formulaire ; l'ajout est bloqué tant que les deux champs
   requis ne sont pas remplis.

### T97-08 — Sélection initiale à la création de campagne
1. "Nouvelle campagne", cocher un test avec `{voltage}` dans la liste de sélection
   initiale (avant tout ajout via le panneau "+ Ajouter des tests").
2. **Attendu** : le même formulaire de saisie apparaît sous ce test dans l'écran de
   création ; la création est bloquée tant que la valeur n'est pas saisie ; une fois
   créée, la campagne contient déjà la valeur (visible en exécutant le test).

## Cas limites

### T97-09 — Valeur contenant des caractères HTML
1. Ajouter un test avec `{voltage}` à une campagne, saisir la valeur `<b>24</b>&V`.
2. Ouvrir "Exécuter" sur ce test.
3. **Attendu** : le texte affiché montre littéralement `<b>24</b>&V` (caractères visibles,
   pas de mise en gras, pas d'balise interprétée) — pas d'exécution de script, aucune
   altération de la mise en page environnante.

### T97-10 — Paramètre apparu après modification du test (test déjà ajouté)
1. Ajouter un test sans paramètre à une campagne (aucune saisie demandée).
2. Modifier le test (nouveau brouillon puis nouvelle version approuvée) pour y ajouter
   `{pressure}` dans une étape.
3. Ouvrir "Exécuter" sur ce test dans la campagne existante.
4. **Attendu** : `{pressure}` s'affiche littéralement (non substitué), sans erreur ni page
   blanche — l'exécution reste possible normalement.

### T97-11 — Paramètre disparu après modification du test
1. Ajouter un test avec `{voltage}` (valeur `24V`) à une campagne.
2. Modifier le test pour retirer `{voltage}` du texte (nouvelle version).
3. Ouvrir "Exécuter" sur ce test.
4. **Attendu** : pas d'erreur, pas d'affichage résiduel de `24V` orphelin — le texte
   affiché est simplement celui de la nouvelle version, sans `{voltage}`.

### T97-12 — Deux campagnes, même test, valeurs différentes
1. Ajouter le même test avec `{voltage}` à deux campagnes différentes, valeurs `12V` et
   `24V` respectivement.
2. Exécuter le test dans chaque campagne.
3. **Attendu** : chaque exécution affiche sa propre valeur (`12V` dans la première,
   `24V` dans la seconde) — pas de fuite de valeur entre campagnes.

### T97-13 — Édition d'une valeur après ajout
1. Suite de T97-02 (test ajouté, `voltage = 24V`, pas encore exécuté).
2. Depuis la liste des tests de la campagne, éditer la valeur du paramètre, la changer en
   `48V`, enregistrer.
3. Ouvrir "Exécuter" sur ce test.
4. **Attendu** : le texte affiché montre `48V` (pas `24V`) — la correction a bien été
   prise en compte sans retirer/ré-ajouter le test.

### T97-14 — Label avec espace non reconnu comme paramètre
1. Créer un test dont une étape contient littéralement le texte `{à vérifier}` (avec
   espace/accent).
2. Ajouter ce test à une campagne.
3. **Attendu** : aucun champ de saisie proposé pour `{à vérifier}` — reste un texte
   normal, non substitué à l'exécution (affiché tel quel, comme n'importe quel autre
   texte du test).

### T97-15 — Test déjà présent dans la campagne (dédoublonnage)
1. Avec un test déjà ajouté à une campagne (avec ou sans paramètre), tenter de le
   sélectionner à nouveau dans "+ Ajouter des tests" (s'il apparaît encore dans la liste)
   ou vérifier qu'il n'apparaît plus dans `availableTests`.
2. **Attendu** : comportement actuel inchangé — un test déjà dans `testCaseIds` n'apparaît
   plus dans la liste des tests disponibles à l'ajout (filtre déjà en place,
   `campaign.$campaignId.tsx` L137-138).

## Sprint 2 — instances multiples (T97-16 à T97-20)

### T97-16 — Dupliquer une instance de test paramétré
1. Ajouter un test avec `{voltage}` à une campagne active, valeur `12V`.
2. Sur la ligne de ce test dans la liste de la campagne, cliquer l'icône "Dupliquer"
   (Copy), saisir `24V`, confirmer.
3. **Attendu** : le test apparaît maintenant **deux fois** dans la liste — une ligne
   `voltage=12V`, une ligne `voltage=24V` — chacune avec son propre statut (`pending`),
   sa propre action "Exécuter".

### T97-17 — Exécutions indépendantes des deux instances
1. Suite de T97-16, exécuter la première instance (`12V`), soumettre un résultat PASS.
2. Exécuter la seconde instance (`24V`), soumettre un résultat FAIL.
3. **Attendu** : chaque instance affiche son propre statut (PASS / FAIL) dans la liste,
   sans interférence ; ouvrir "Voir" sur chacune affiche la substitution correcte
   (`12V` sur la première, `24V` sur la seconde).

### T97-18 — Test sans paramètre : duplication impossible
1. Ajouter un test sans aucun `{label}` à une campagne.
2. **Attendu** : aucune icône "Dupliquer" n'apparaît sur sa ligne — comportement limité à
   une seule inclusion, inchangé par le sprint 2.

### T97-19 — Valeurs affichées directement dans la liste
1. Ajouter un test avec `{voltage}`/`{duration}` à une campagne, valeurs `24V`/`15`.
2. **Attendu** : sans cliquer sur l'icône d'édition, la ligne du test affiche directement
   `voltage=24V · duration=15` sous son titre.

### T97-20 — Dupliquer une campagne clôturée : action masquée
1. Clore une campagne (`completed` ou `abandoned`) contenant un test paramétré.
2. **Attendu** : l'icône "Dupliquer" n'apparaît plus sur la ligne (masquée comme les
   actions "Ajouter des tests"/"Exécuter") ; l'icône d'édition des valeurs, elle, reste
   visible (correction de valeur toujours possible après clôture, cf. CA6).

### T97-21 — Compatibilité ascendante (campagne pré-sprint 2)
1. Ouvrir une campagne créée avant ce sprint (fichier YAML sans `entryId` dans `runs[]`).
2. **Attendu** : la liste des tests s'affiche normalement (pas d'erreur, pas de ligne
   dupliquée par accident), "Exécuter"/"Voir" fonctionnent normalement sur chaque test.

### T97-22 — Ajouter une 2ᵉ instance depuis le panneau groupé (pas seulement "Dupliquer")
1. Ajouter un test avec `{voltage}` à une campagne, valeur `12V`.
2. Rouvrir "+ Ajouter des tests" : le test avec `{voltage}` doit **toujours apparaître**
   dans la liste des tests disponibles (avec une mention "déjà présent"), contrairement à
   un test sans paramètre déjà ajouté (qui disparaît de la liste, comportement inchangé).
3. Le cocher à nouveau, saisir `24V`, confirmer.
4. **Attendu** : une 2ᵉ instance (`voltage=24V`) est ajoutée à la campagne, en plus de la
   première (`voltage=12V`) — sans effacer ni modifier la première.

## Critères d'acceptation vérifiables

- [ ] CA1 (T97.md) — `extractTestParameters` détecte les `{label}` uniques de
      preconditions/postconditions/steps, pas des `fields`/`equipment` — T97-01, T97-14
- [ ] CA2 — le panneau d'ajout demande une valeur par paramètre détecté et bloque tant
      qu'une valeur requise est vide — T97-02, T97-07, T97-08
- [ ] CA3 — les valeurs sont stockées par test et par campagne, indépendamment — T97-12
- [ ] CA4 — substitution échappée à l'exécution et à la relecture d'un run — T97-03,
      T97-04, T97-09
- [ ] CA5 — un `{label}` sans valeur stockée s'affiche littéralement sans erreur — T97-10
- [ ] CA6 — les valeurs sont modifiables après ajout — T97-13
- [ ] CA7 — un test sans paramètre n'a aucun changement de comportement — T97-06, T97-15,
      T97-18
- [ ] CA8 (sprint 2) — un test paramétré peut être inclus plusieurs fois, chaque instance
      indépendante — T97-16, T97-17
- [ ] CA9 (sprint 2) — les valeurs de paramètres sont visibles dans la liste sans clic
      supplémentaire — T97-19
- [ ] CA10 (sprint 2) — compatibilité ascendante des campagnes existantes — T97-21
- [ ] CA11 (sprint 2) — une 2ᵉ instance d'un test paramétré peut être ajoutée depuis le
      panneau groupé "+ Ajouter des tests" (pas seulement via "Dupliquer") — T97-22
