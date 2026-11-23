# GH428 — Design : champs d'exécution renseignés en campagne

> Suit `specs/GH428.md` (validée, Q1 à Q8). Ce document fixe les points d'implémentation.

## 1. Modèle

### 1.1 Schéma (`packages/types/src/schema.ts`, `run-fields.ts`)

- `SchemaField.campaignInput?: boolean` — « Renseigné en campagne ». Écrit seulement si vrai (même convention
  que `defaultVisible`, GH139).
- `runFieldIssues` (`run-fields.ts`) : nouvelles règles, sur les `runFields` seulement :
  - `campaignInput` sur une liste `stepFields` → erreur ;
  - `campaignInput` sur un type non admis (Q7 : `text`, `number`, `enum`, `boolean`, `date`) → erreur.
- `requiredWhen` d'un champ d'entrée : pas de restriction. Il est évalué à l'exécution, comme un champ de
  résultat (le verdict y est connu).

### 1.2 Entrée de campagne (`packages/types/src/campaign.ts`)

- `CampaignTestRun.runInputs?: Record<string, string>` — valeurs saisies en campagne, par nom de champ
  `campaignInput`. Absent tant que vide. Stocké dans `campaigns/<ID>.yaml`, jamais dans `testSnapshot`.
- Valeurs brutes (chaînes), converties à l'écriture par `convertFieldValue` (même conversion que la saisie
  d'un run : nombres à virgule, booléens oui/non, dates).

## 2. Écritures

### 2.1 Saisie en campagne — `CampaignsService.updateRunInputs`

- Signature : `updateRunInputs(repoPath, campaignId, entryId, inputs: Record<string, string>)`.
- Même motif que `updateRunParams` : `enqueue(repoPath, campaignId, …)`, `historyBase`, `persist`.
- Contrôles, rien n'est écrit en cas de refus :
  - entrée inconnue ou retirée → erreur ;
  - type du test résolu dans le schéma (`objectTypeRef` de `testSnapshot`, ou test live) ;
  - clé qui n'est pas un `runFields` `campaignInput` du type → refus ;
  - valeur non convertible → refus (message de `convertFieldValue`).
- Une valeur vide retire la clé. Les valeurs acceptées sont stockées converties (chaînes normalisées).
- Pas de refus lié au statut : modifiable à tout moment (Q3). Une modification ne touche aucun run.

IPC : `campaigns:update-run-inputs` (`ipc/index.ts`, `ipc-client.ts` `campaigns.updateRunInputs`,
`channel-policy.ts` : listé dans les canaux d'écriture, même politique que `campaigns:update-run-params`).

### 2.2 Exécution — `TestsService.execute`

- Quand `dto.campaignEntry` est fourni, le main lit `campaigns/<campaignId>.yaml` dans le repo de la
  campagne (`repoPath`) et prend `runInputs` de l'entrée. Lecture directe par `git.readYaml`, comme les autres
  lectures du service : pas de dépendance vers `CampaignsService`.
- Fusion, pour les seuls champs `campaignInput` du type : `valeur = dto.fields[nom] ?? runInputs[nom]`.
  - `dto.fields` l'emporte : la page d'exécution et l'import du classeur (Q5) fournissent la valeur à figer.
  - Sinon la valeur de l'entrée est reprise.
- La fusion précède `prepareRunFields`, donc `required`, `requiredWhen` et types sont contrôlés sur la valeur
  finale (Q4). Refus : `required_field_missing`, rien n'est écrit.
- Le run porte les valeurs dans `run.fields`, comme tout champ d'exécution. Il ne lit plus l'entrée ensuite.
- Campagne absente ou entrée absente : pas d'entrée, pas de fusion (comportement actuel).

## 3. Lectures et affichage

### 3.1 Grille des entrées (`CampaignEntriesGrid.tsx`)

- Colonnes `run:<nom>` pour chaque champ de `runFields` des types de test présents dans la campagne (union par
  nom, comme `unionRunFields`). Libellé = `label` du champ.
- Sources :
  - champ `campaignInput` : `row.run.runInputs[nom]`, éditable ;
  - autre champ : valeur de `fields[nom]` du dernier run de l'entrée, lecture seule, vide sinon.
- Dernier run : l'historique des exécutions du type (`api.executions.history(repoPath, { objectTypeRef })`,
  comme la Vue Exécutions). On garde les lignes `kind: 'run'` dont `row.campaign.id` est la campagne et
  `row.entry.entryId` est l'entrée, la plus récente l'emporte (`run.executedAt`). Pas d'appel par test.
- Visibilité : `defaultVisible` (Q6) ; le panneau 👁 liste toutes les colonnes (GH389).
- Édition : `onCellEdit` uniquement pour les colonnes `campaignInput` (`isEditable`). Éditeur : `enum`
  (liste de valeurs, ou Oui/Non pour un booléen) sinon `text` ; la conversion est faite par le service.
- Échec : `CellEditFailure` avec le message du service, affiché par la grille.
- Une indication « dernier run : <valeur> » apparaît quand `runInputs[nom]` diffère de la valeur du dernier run
  (Q3). Ligne sans run : pas d'indication.

### 3.2 Page d'exécution (`campaign.$campaignId_.execute.$testId.tsx`)

- Préremplissage : à l'ouverture de l'entrée, `runFieldValues[nom] = entry.runInputs[nom]` pour les champs
  `campaignInput`. Effet dédié, qui n'écrase pas une saisie en cours (même principe que le Q7 existant).
- Ces champs sont affichés en lecture seule (`DynamicField disabled`) sous le libellé « renseigné en campagne ».
- Les autres champs d'exécution restent saisissables.

### 3.3 Classeur Excel (`campaign-execution.xlsx.ts`, `campaign-execution-import.ts`)

- Export : pour une ligne d'instance en attente, la colonne `run:<nom>` d'un champ `campaignInput` reprend
  `runInputs`. Les colonnes existent déjà : **pas de changement de format** (`EXECUTION_SHEET_FORMAT_VERSION`
  inchangé).
- Import : la valeur du classeur est passée en `dto.fields` et l'emporte (§2.2). Une cellule vide reprend
  `runInputs` (pas de suppression silencieuse de la saisie de campagne).

### 3.4 Vue Exécutions (GH400)

- Inchangée (Q8). Elle affiche déjà les champs d'exécution des runs, donc les valeurs d'entrée figées.

## 4. Schéma — éditeur

- `objectTypeEditor.tsx` (sections « Champs d'exécution ») : case « Renseigné en campagne » par champ, écrite
  seulement si vraie. Visible uniquement sur la liste `runFields`.
- Textes en i18n `fr.json` et `en.json`.

## 5. Cas limites

- **Renommage** d'un champ d'exécution : les `runInputs` des entrées gardent l'ancienne clé. Ils deviennent
  « hors schéma » et ne sont plus ni lus ni affichés. Même limite que les runs (GH196 §10). Migration hors
  périmètre, à traiter si le besoin apparaît.
- **Suppression** d'un champ : même traitement (clé ignorée).
- **Type** d'un champ changé : la valeur est convertie à l'exécution ; une valeur devenue invalide fait échouer
  l'exécution avec le message de conversion. Pas de conversion automatique.
- **Entrée retirée** (`removedRuns`) : non modifiable (refus dans `updateRunInputs`).
- **Test de composant** : la campagne est dans le repo du composant (GH202, GH255). La lecture de la campagne se
  fait dans `repoPath`, la même logique que pour `campaignEntry`.

## 6. Ce qui ne change pas

- Le fichier du test, sa copie (`testSnapshot`), son approbation, son historique.
- Les runs existants : `run.fields` n'est jamais réécrit.
- La saisie de paramètres `{nom}` (`paramValues`) : mécanisme distinct.
- Le MCP : aucun outil ajouté (hors périmètre, GH428 §6).

## 7. Découpage

- **Sprint 1 — modèle et écritures** : types, `runFieldIssues`, `updateRunInputs` + IPC + client + politique,
  fusion dans `TestsService.execute`, tests unitaires.
- **Sprint 2 — interface** : grille (colonnes, édition, dernier run), page d'exécution (préremplissage et
  lecture seule), éditeur de schéma, i18n, tests unitaires des fonctions pures.
- **Sprint 3 — classeur et e2e** : export des valeurs pré-remplies, scénario e2e `gh428-run-inputs.spec.ts`,
  vérification de niveau 2.
