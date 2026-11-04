# GH267 — Design : figer à la signature

## Modèle (`packages/types`)

- `ValidationEntry.atSignature?: ValidationAtSignature`, et `ValidationSignedRun` pour la dernière exécution.
- `isValidationFrozen(state, validation)` : validation non ouverte, avec au moins une copie.
- `ValidationRow.outsideSignature` et `ValidationPage.frozen: 'copy' | 'legacy' | null`.
- `graph.ts` reste autonome (le fichier `polenta.d.ts` en est généré) : `GraphValidationAtSignature` y est écrit à plat.

## Service

- **`signatureCopy(row, history)`**, pure, dans `validation-rows.util` : même « dernière exécution » que la grille (premier run de
  l'historique par test, les plus récents d'abord), et même ajout d'un test absent de la matrice. Clone JSON, car `yaml.dump`
  refuse `undefined`.
- **`sign`** : les lignes déjà contrôlées, puis l'historique de chaque ligne ayant un test local, puis l'écriture. Toute erreur
  remonte avant l'écriture, donc aucun fichier n'est touché.
- **`rows`** découpé : `liveColumns` lit couverture, impact et design. Une validation figée ne l'appelle que si une ligne n'a pas de
  copie, et une erreur y donne des colonnes vides plutôt qu'une page fermée.
- **`buildRows`** : avec copie, la ligne vient de la copie et `review` vaut `null`, car un registre n'est plus à revoir. Sans copie
  dans une validation figée : `outsideSignature`.
- **`carryOver`** retire la copie de la décision reprise.

`ValidationsService` reçoit `Pick<ExecutionHistoryService, 'history'>`. Dans `container.ts`, l'historique est construit après les
validations, d'où un appel différé ; le conteneur MCP en construit un sans `testedConfig`, car il ne signe jamais.

## Renderer

- `ValidationGrid` : mention « À la signature », mention « signée avant le figeage », bandeau et badge « hors signature ».
- `ValidationRuns`, prop `frozen` : ligne de test lue dans la copie (date, verdict, version testée, mentions à la signature) ; les
  exécutions actuelles restent sous le chevron, sans entrée pour un test lié après la signature. Une erreur de l'historique ne masque pas
  le registre.
- `runMentions` accepte un run réduit à `testedConfig` et `executedAt`.

## Coût

Une lecture d'historique par exigence ayant des tests locaux, à la signature seulement. La lecture d'une validation signée devient plus
légère : ni matrice, ni analyse, ni git pour le design.

## Conséquence notée

`buildRows` ne recalcule rien pour une ligne figée : si une exigence change de périmètre après coup, le filtre reste celui du schéma du gel (#266).
