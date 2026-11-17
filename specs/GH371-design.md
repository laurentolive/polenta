# GH371 — Design : modifier statuts, décisions, entryFields et displayIdField d'un type existant (MCP)

Spec : `specs/GH371.md` (S1 : renommage d'une décision utilisée refusé ; Q1 : proposition par défaut ;
Q2 → #377). Deux sprints.

## 1. Vue d'ensemble

```
tools/schema-mutation.tools.ts            (zod d'entrée, « au moins une propriété », traduction des erreurs)
  │
  ▼
SchemaService (main/services/schema.service.ts)
  withMutationQueue(repoPath, …)          ← une entrée de file par appel, migration comprise
    get → contrôles ciblés (SchemaValidationError) → schéma immuable modifié
        → dryRun ? assertSaveable (aucun écrit) : save (mêmes garde-fous) → migration des objets
  │                                         │
  │ validations/*.yaml lus directement      │ port `SchemaValueMigrator` (sprint 2)
  │ (usage des décisions, comme             ▼
  │  assertValidationTypeStable)          FieldRenameService (previewValueRenames, renameValues,
  ▼                                                           objectIdsWithStatus — nouveau)
.polenta/schema.yaml
```

Aucun changement de format de fichier, de types partagés ni de renderer.

## 2. Fichiers

| Fichier | Sprint | Changement |
|---|---|---|
| `apps/desktop/src/main/services/schema.service.ts` | 1, 2 | Nouveaux codes ; `addField` accepte `entryFields` ; méthodes `addDecision`, `updateDecision`, `removeDecision`, `reorderStatuses`, `updateObjectType` (S1), `updateStatus`, `removeStatus` (S2) ; `save` découpé en `assertSaveable` + écriture ; lecture partagée de l'usage des décisions |
| `apps/desktop/src/main/services/field-rename.service.ts` | 2 | `objectIdsWithStatus(repoPath, ref, status)` ; `previewValueRenames` réutilise la même collecte d'objets |
| `apps/desktop/src/mcp-server/container.ts` | 2 | `fieldRename: FieldRenameService` (construit avec issues et validations, comme `main/container.ts`) |
| `apps/desktop/src/mcp-server/tools/schema-mutation.tools.ts` | 1, 2 | Outils `add_decision`, `update_decision`, `remove_decision`, `reorder_statuses`, `update_object_type` (S1), `update_status`, `remove_status` (S2) ; `add_field.list` étendu |
| `apps/desktop/src/main/services/schema-mutation.gh371.test.ts` (nouveau) | 1, 2 | Tests service + handlers (harnais du test GH77 C5 / GH362) |
| `specs/SPEC-MCP-SERVER.md` §4.3, `specs/SPEC-INDEX.md`, `apps/desktop/src/main/services/agents-md.template.ts` | 2 | Documentation |

## 3. Codes d'erreur

`SchemaValidationErrorCode` += `STATUS_NOT_FOUND | STATUS_IN_USE | STATUS_LIST_INVALID | DECISION_NOT_FOUND |
DECISION_NAME_TAKEN`. Helper module `idList(ids: string[]): string` : 5 premiers séparés par `, `, puis
`… et N autres`.

## 4. `SchemaService` — socle commun

### 4.1 `save` découpé

```ts
/** Tous les garde-fous de `save`, sans écrire ; renvoie le schéma tel qu'il serait écrit. */
private async assertSaveable(repoPath: string, schema: ProjectSchema): Promise<ProjectSchema>
async save(repoPath, schema): Promise<void>   // = assertSaveable + écriture + cache (inchangé pour les appelants)
```

Le `dryRun` appelle `assertSaveable` : mêmes refus que l'appel réel, aucun écrit.

### 4.2 Cible commune

```ts
/** Nœud + type, nœud non readonly (NODE_NOT_FOUND / NODE_READONLY / TYPE_NOT_FOUND). */
private requireWritableType(schema, nodeName, typeName): { node: SystemNode; type: ObjectTypeDefinition }
private requireValidationType(type)   // VALIDATION_TYPE_INVALID si category !== 'validation'
private requireStatusList(type)       // STATUS_LIST_INVALID si category === 'campaign'
```

Toutes les nouvelles méthodes : `withMutationQueue(repoPath, async () => { const schema = await this.get(repoPath); … })`,
copie immuable via `replaceObjectType`, `save` à la fin (sprint 1 : jamais de migration).

### 4.3 Usage des décisions (lecture directe de `validations/*.yaml`)

```ts
/** IDs (champ `id`, sinon nom de fichier) des validations du repo dont une entrée — confirmée ou proposée — porte `decision`. */
private async validationsUsingDecision(repoPath: string, decision: string): Promise<string[]>
```

Même source que `assertValidationTypeStable` (fichiers lus par `fs`, sans `ValidationsService` — pas de
dépendance de `SchemaService` vers ce service, qui dépend déjà de lui). `assertValidationTypeStable` est
réécrit sur la même lecture (`readValidationEntries`), comportement inchangé. Toutes les validations du repo
comptent (un seul type validation par repo, `assertValidationTypes`), signées et annulées comprises.

## 5. Sprint 1 — sans migration d'objets

### 5.1 `addField` — `list: 'entryFields'`

`dto.list` : `'fields' | 'runFields' | 'stepFields' | 'entryFields'`. Branche `entryFields`, dans l'ordre :

1. `type.category !== 'validation'` → `VALIDATION_TYPE_INVALID` (« Les entryFields sont réservés au type validation… ») ;
2. `field.name === 'decision'` → `FIELD_NAME_TAKEN` (nom réservé, S4) ; nom déjà dans `entryFields` → `FIELD_NAME_TAKEN` ;
3. `requiredWhenIssues({ ...type, fields: [...entryFields, field] }, { key: 'decision', values: decisions.map(d => d.name) })`
   filtré sur `field.name`, **erreur ou avertissement** → `REQUIRED_WHEN_INVALID` (même règle MCP stricte que les `fields`, GH195) ;
4. ajout en fin de `entryFields`, `save`.

### 5.2 Décisions

```ts
addDecision(repoPath, dto: { nodeName; typeName; decision: ValidationDecisionDef }): Promise<ProjectSchema>
updateDecision(repoPath, dto: { nodeName; typeName; name; to?; label?: string | null; color?: string | null;
  isPending?: true; proposesIssue?: boolean }): Promise<ProjectSchema>
removeDecision(repoPath, dto: { nodeName; typeName; name }): Promise<ProjectSchema>
```

- **add** : `requireValidationType` ; nom pris → `DECISION_NAME_TAKEN` ; `isPending` alors qu'une décision en
  attente existe → `VALIDATION_TYPE_INVALID` ; `proposesIssue: false` / `isPending: false` non écrits ; ajout en fin.
- **update** (ordre des contrôles) : `DECISION_NOT_FOUND` ; `to` (≠ `name`) déjà pris → `DECISION_NAME_TAKEN` ;
  si `to` (≠ `name`) ou `isPending` (décision pas déjà en attente) → `validationsUsingDecision` ; non vide →
  `DECISION_IN_USE` (« … portée par des entrées de VAL-0001, VAL-0002 : elle ne se renomme pas / ne devient pas en
  attente »). Construction : `label` / `color` `null` → clé retirée ; `proposesIssue: false` → clé retirée ;
  `isPending: true` → la marque passe de l'ancienne décision à celle-ci. Renommage : `name` et `requiredWhen.decision`
  des `entryFields` (`renameDecisionRefs`, §5.3). Aucun objet réécrit.
- **remove** : `DECISION_NOT_FOUND` ; décision en attente → `VALIDATION_TYPE_INVALID` ; usage → `DECISION_IN_USE` ;
  `entryFields` dont `requiredWhen.decision` la cite → `REQUIRED_WHEN_INVALID` (champs listés, Q1).

Le `save` final reste le filet (`validationTypeError`, `assertValidationTypeStable`).

### 5.3 Réécriture du pseudo-champ `decision`

`renameRequiredWhenRefs` (`packages/types`) ignore volontairement les renommages de valeur visant le pseudo-champ
(cible `field` ≠ `pseudoKey`). Plutôt que d'élargir sa sémantique (utilisée par l'éditeur), helper local à
`schema.service.ts` :

```ts
/** Remplace `from` par `to` dans `requiredWhen[key]` de chaque champ (dédoublonné) ; champs sans référence intacts. */
function renamePseudoRefs(fields: SchemaField[], key: string, from: string, to: string): SchemaField[]
```

Utilisé pour `decision` (renommage d'une décision) et pour `status` (sprint 2, `remove_status` + `replaceWith` ; le
renommage d'un statut peut l'utiliser aussi — même résultat que `renameRequiredWhenRefs(rw, [], [rename])`).

### 5.4 `reorderStatuses`

`(repoPath, { nodeName, typeName, order: string[] })` : `requireStatusList` ; `order` doit être une permutation
exacte (même longueur, aucun doublon, tous connus) sinon `STATUS_LIST_INVALID` (manquants / inconnus / doublons cités) ;
`statuses` réordonné (objets inchangés) ; `save` (`validationTypeError` → `VALIDATION_TYPE_INVALID` si un statut marqué
passe en tête du type validation).

### 5.5 `updateObjectType`

`(repoPath, { nodeName, typeName, label?: string | null, color?: string | null, displayIdField?: string | null,
trackStatusHistory?: boolean })` : `null` retire la clé ; `trackStatusHistory: true` retire la clé, `false` l'écrit.
Contrôles explicites avant `save` : `displayIdFieldError(updated)` non nul → `DISPLAY_ID_FIELD_INVALID` (contrôle
direct : `assertValidDisplayIdFields` ne refuse qu'une erreur *nouvelle*) ; `trackStatusHistory: false` sur le type
validation → `VALIDATION_TYPE_INVALID`.

## 6. Sprint 2 — statuts avec migration

### 6.1 Port de migration

```ts
/** GH371 — migration des objets après une écriture du schéma (FieldRenameService ; type seul : pas de cycle). */
export type SchemaValueMigrator = Pick<FieldRenameService, 'previewValueRenames' | 'renameValues' | 'objectIdsWithStatus'>
```

Passé en argument des deux méthodes (pas de dépendance de construction : `FieldRenameService` dépend de services
qui dépendent de `SchemaService`). `FieldRenameService.objectIdsWithStatus(repoPath, ref, status)` : IDs des
exigences, tests, campagnes, issues et validations du type dont le **statut courant** est `status` (même collecte que
`previewValueRenames`, factorisée en `typeObjects`).

Résultats :

```ts
export interface StatusMutationResult { schema: ProjectSchema; migration: FieldRenameResult }
export interface StatusMutationPreview { dryRun: true; schema: ProjectSchema; preview: { withOld: number; withNew: number } }
```

### 6.2 `updateStatus`

`(repoPath, dto: { nodeName; typeName; name; to?; label?: string | null; color?: string | null; isApproval?: boolean;
isTerminal?: boolean; dryRun? }, migrator)` :

1. `requireWritableType`, `requireStatusList`, statut absent → `STATUS_NOT_FOUND` ;
2. `to` ≠ `name` déjà pris → `STATUS_NAME_TAKEN` ;
3. statut construit (`null` / `false` retirent la clé) ; si renommage : `transitions = renameTransitionRefs(...)`,
   `fields = renamePseudoRefs(fields, 'status', name, to)` ;
4. `dryRun` : `assertSaveable` ; `preview` = `previewValueRenames([{ target: { kind: 'status' }, from: name, to }])[0]`
   (sans renommage : `{ 0, 0 }`) ;
5. sinon `save` puis, si renommage, `migrator.renameValues(...)` (sinon `emptyFieldRenameResult()`).

Les marques (`isApproval`, `isTerminal`) et le gel des statuts marqués des types validation / version restent
contrôlés par `save` (`validationTypeError`, `assertValidationTypeStable`, `assertVersionTypeStable`).

### 6.3 `removeStatus`

`(repoPath, dto: { nodeName; typeName; name; replaceWith?; dryRun? }, migrator)` :

1. cible + `requireStatusList` ; `name` / `replaceWith` introuvables → `STATUS_NOT_FOUND` ; `replaceWith === name`
   ou dernier statut du type → `STATUS_LIST_INVALID` ;
2. sans `replaceWith` : `objectIdsWithStatus` non vide → `STATUS_IN_USE` (« N objet(s) : IDs ») ; règles citant le
   statut (`rulesCitingStatus`) → `TRANSITION_INVALID` ; `fields` dont `requiredWhen.status` le cite →
   `REQUIRED_WHEN_INVALID` (Q1) ;
3. avec `replaceWith` : `transitions = renameTransitionRefs(..., name → replaceWith)`, `fields` réécrits vers
   `replaceWith` ; une règle devenue invalide (doublon, `from` = `to`) est refusée par `save` (`TRANSITION_INVALID`) ;
4. statut retiré de `statuses` ; `dryRun` : `assertSaveable`, `preview` = aperçu du renommage `name → replaceWith`
   (sans `replaceWith` : `{ 0, 0 }`) ; sinon `save` puis `renameValues(name → replaceWith)` si `replaceWith`.

### 6.4 Outils

`update_status` / `remove_status` invalident d'abord les index exigences / tests / issues du repo
(`freshenIndexes` de `suivi-common.ts` n'est pas réutilisé tel quel : il couvre tout le workspace ; ici
`reqIndex.invalidate`, `testsIndex.invalidate`, `issues.invalidate` sur `container.repoPath`) : le process MCP n'a
pas de watcher, un objet créé par l'application depuis le dernier appel doit compter pour `STATUS_IN_USE` et être
migré.

## 7. Couche outils (`schema-mutation.tools.ts`)

- `runSchemaMutation` généralisé : `op: () => Promise<unknown>` (réponse JSON telle quelle).
- « Au moins une propriété à modifier » (`update_decision`, `update_status`, `update_object_type`) : contrôlé dans le
  handler, qui lève `McpError(InvalidParams, 'Input validation error: …')` — même réponse que l'échec zod du SDK
  (l'API `registerTool` prend une forme zod brute, sans `refine` au niveau objet). `isPending: z.literal(true)` :
  `false` rejeté par zod.
- Schéma zod `validationDecisionSchema` local (`name` min 1, `label?`, `color?`, `isPending?`, `proposesIssue?`).

## 8. Décisions et alternatives écartées

| Décision | Alternative écartée |
|---|---|
| Méthodes ciblées dans `SchemaService` + port de migration en argument | Nouveau service orchestrateur hors `SchemaService` : il aurait dû exposer `withMutationQueue` publiquement ; la file et les garde-fous restent dans un seul module |
| Usage des décisions lu dans `validations/*.yaml` par `SchemaService` | Injecter `ValidationsService` (cycle de construction) |
| `renamePseudoRefs` local | Étendre `renameRequiredWhenRefs` au pseudo-champ : changerait le comportement de l'éditeur (`withRenamedRequiredWhen`) |
| `assertSaveable` séparé de `save` | `dryRun` sans garde-fous de `save` : contredirait « mêmes refus que l'appel réel » |

## 9. Limites (identiques à l'application)

- Les **versions** (`versions/*.yaml`) ne sont ni comptées par `STATUS_IN_USE` ni migrées au renommage d'un statut du
  type version (périmètre de `previewValueRenames` / `renameValues`, comme l'éditeur GH82) ; les statuts marqués du
  type version restent gelés tant que des versions existent (`VERSION_TYPE_INVALID`).
- Cache de schéma du process MCP non relu avant mutation (comme les `add_*`, SPEC-MCP-SERVER §7).

## 10. Sprints

| Sprint | Périmètre | Vérification |
|---|---|---|
| 1 | Codes, `assertSaveable`, lecture des décisions, `add_field entryFields`, `add_decision` / `update_decision` / `remove_decision`, `reorder_statuses`, `update_object_type` | typecheck, `schema-mutation.gh371.test.ts`, tests MCP existants, `pnpm test` |
| 2 | `objectIdsWithStatus`, conteneur MCP, `update_status` / `remove_status` (dryRun, migration), pipelining, docs (SPEC-MCP-SERVER §4.3, SPEC-INDEX, AGENTS.md) | idem |

Pas d'e2e : aucun changement du renderer ni du serveur web.
