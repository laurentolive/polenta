# GH77 — Design : historique configurable des champs

Spec : `specs/GH77.md`. Scénarios : `specs/GH77-tests.md`.

## Vue d'ensemble

```
packages/types/src/history.ts   ← logique pure (champs suivis, diff avant/après, entrée implicite)
packages/merge-core             ← union de `history` à la fusion (mergeUnit)
main/services/history.service.ts ← identité (acteur), application à l'écriture, lecture effective
     ├─ RequirementsService / TestsService / CampaignsService / RevalidationService : un point d'écriture chacun
     ├─ IPC history:get + MCP (lecture, bulk import)
     ├─ field-rename.service.ts   (sprint 2)
     └─ history-backfill.service.ts (sprint 3)
renderer : objectTypeEditor (cases, renommage), HistorySection (sprint 3)
```

Découpage en **3 sprints** :

| Sprint | Périmètre | Résultat livrable |
|--------|-----------|-------------------|
| 1 | Types, logique pure, alimentation sur **toutes** les écritures, fusion, `testSnapshot`, lecture effective (IPC + MCP), docs `CLAUDE.md` / `AGENTS.md` | Plus aucune perte de données : le statut est historisé partout (défaut `true`), même sans UI |
| 2 | Éditeur de schéma (cases « Historiser »), MCP `add_object_type`, renommage de champ (migration valeur + `history`) | Le client choisit ses champs suivis ; renommer ne casse plus rien |
| 3 | Reprise `git log`, section « Historique », mises à jour SPEC | Données existantes reprises, historique visible |

Le sprint 1 est volontairement autonome et mergeable seul : c'est lui qui arrête la perte de données
(priorité de l'issue). Un champ personnalisé peut déjà être suivi en éditant `schema.yaml` à la main.

---

## 1. Types (`packages/types`) — sprint 1

### 1.1 `schema.ts`

```ts
export interface SchemaField {
  …
  /** GH77 — historiser les changements de ce champ (`history.<name>`). Écrit seulement si vrai. */
  trackHistory?: boolean
}
export interface ObjectTypeDefinition {
  …
  /** GH77 — historiser le statut (`history.status`). Absent = true ; écrit seulement si false. */
  trackStatusHistory?: boolean
}
```

Attention à l'encodage de `schema.ts` : des commentaires y sont déjà en double encodage (`CatÃ©gorie`).
Éditer avec l'outil Edit uniquement (pas de heredoc / sed), sans retoucher ces lignes.

### 1.2 `history.ts` (nouveau, exporté par `index.ts`)

```ts
export type HistorySource = 'mcp' | 'git' | 'schema'
export interface HistoryEntry {
  value?: unknown            // absent pour un champ « événement seul »
  at: string                 // ISO UTC à la seconde
  by?: string                // absent seulement pour une entrée implicite d'un fichier jamais commité
  source?: HistorySource
  implicit?: true            // lecture seulement, jamais écrit sur disque
}
export type ObjectHistory = Record<string, HistoryEntry[]>   // clé : 'status' | nom de champ
export interface HistoryActor { by: string; source?: HistorySource }

/** Champs suivis d'un type : [{ key: 'status' | name, mode: 'value' | 'event' }]. */
export function trackedKeys(typeDef: ObjectTypeDefinition | null): TrackedKey[]
/** Types de champ acceptant trackHistory, et leur mode (spec §3). drawio/richtext/textarea → 'event'. */
export function historyModeFor(type: SchemaFieldType): 'value' | 'event'
export const HISTORY_TRACKABLE_TYPES: SchemaFieldType[]   // tous les types actuels
/** Égalité de valeur pour l'historique (multi_enum : ensembles, via parseMultiEnumValue). */
export function sameHistoryValue(type: SchemaFieldType | 'status', a: unknown, b: unknown): boolean

/**
 * Cœur de l'alimentation. Renvoie `after` avec `history` complété — sans muter les entrées.
 *  - before null → création : une entrée par clé suivie ayant une valeur (non vide).
 *  - sinon : pour chaque clé suivie, si la valeur a changé → entrée (value null si vidée ;
 *    pas de value en mode 'event').
 *  - comble d'abord le trou (spec §7) : si la dernière entrée connue ≠ valeur AVANT, on insère
 *    l'entrée implicite de `before` (fallback = date/auteur du dernier commit) sans `implicit`,
 *    avec `source: 'schema'` quand la clé n'avait aucune entrée (démarrage du suivi, §6.1).
 *  - n'ajoute rien si rien n'a changé ; ne supprime jamais une clé de `history`.
 *  - toutes les entrées d'un appel partagent le même `at` (`now`).
 */
export function applyHistory<T extends HistoryCarrier>(
  before: T | null, after: T, typeDef: ObjectTypeDefinition | null,
  actor: HistoryActor, now: Date, fallback: { at: string | null; by: string | null },
): T

/** Lecture (spec §7) : historique + entrée implicite `implicit: true` si la valeur courante diffère. */
export function effectiveHistory(obj: HistoryCarrier, typeDef: ObjectTypeDefinition | null,
  fallback: { at: string | null; by: string | null }, now: Date): ObjectHistory

/** `testSnapshot` (spec §11). */
export function withoutHistory<T extends { history?: unknown }>(obj: T): Omit<T, 'history'>
```

`HistoryCarrier = { status: string; fields: Record<string, unknown>; history?: ObjectHistory }`.

Le `fallback` de `applyHistory` sert au comblement du trou : on ne sait pas *quand* la valeur
`before` a été posée, on prend la date/auteur du dernier commit du fichier (spec §7.1).

`Requirement`, `TestCase`, `TestCampaign` : ajout de `history?: ObjectHistory`.

### 1.3 Statut « vide »

`status` est toujours présent ; `fields.x` absent, `''`, `null` ou `[]` = vide. À la création, une
clé vide ne produit pas d'entrée. Passer d'une valeur à vide produit `value: null`.

---

## 2. Main — alimentation (sprint 1)

### 2.1 `HistoryService` (`main/services/history.service.ts`, nouveau)

```ts
export class HistoryService {
  constructor(
    private git: GitService,
    private schema: SchemaService,
    private actor: (repoPath: string) => Promise<HistoryActor>,
    private now: () => Date = () => new Date(),
  ) {}
  /** À appeler juste avant writeYaml, sous le verrou de l'objet. */
  async stamp<T extends HistoryCarrier>(repoPath: string, objectTypeRef: string | undefined,
    before: T | null, after: T, fallback?: { at: string | null; by: string | null } | (() => Promise<…>)): Promise<T>
  /** Lecture effective pour l'IPC / le MCP. */
  async effective(repoPath: string, kind: 'requirement' | 'test' | 'campaign', id: string): Promise<ObjectHistory>
}
```

- `typeDef` : résolu dans le schéma du **repo ouvert** (`findObjectTypeDef`, comme `readTypeDef` des
  services). Type introuvable (`unresolvable`, ancien type) → seul le statut est suivi (défaut).
- `fallback` paresseux : on n'appelle `git.fileHistory` que si un comblement est nécessaire (rare) —
  exigences / tests : `existing.updatedAt/updatedBy` déjà fournis par l'index, pas d'appel git ;
  campagnes : `git.fileHistory(repo, campaigns/<id>.yaml)` seulement dans ce cas.
- Pas de dépendance circulaire : `HistoryService` ne dépend que de `git` et `schema`.

**Acteur** (spec §5), injecté à la construction :

| Hôte | `actor` |
|------|---------|
| desktop / web (`createContainer`) | `repoPath => auth.projectUsername(repoPath).then(by => ({ by }))` |
| MCP (`createMcpContainer`) | `() => ({ by: user ?? 'local', source: 'mcp' })` |

`projectUsername` dans le conteneur web : le conteneur est par utilisateur (GH44) et son
`AuthService` lit le compte de la session. À vérifier en sprint 1 par un test du serveur web ; si le
login n'est pas celui attendu, passer par l'identité de session exposée au conteneur web.

### 2.2 Branchement — un point d'écriture par service

Règle : **aucun appel à `writeYaml` sur un fichier d'objet sans passer par `history.stamp`**. Pour
le garantir, chaque service centralise son écriture d'objet dans une méthode privée :

| Service | Méthode privée | Appelants actuels redirigés |
|---------|----------------|-----------------------------|
| `RequirementsService` | `persist(repo, before, after)` | `create`, `update`, `openDraft`, `transition`, `retargetObjectTypeRef` |
| `TestsService` | `persist(repo, before, after)` | `create`, `update`, `openDraft` |
| `CampaignsService` | `mutate(repo, id, fn)` = `get` → `structuredClone` → `fn` → `stamp` → `writeYaml` | `update`, `updateRun`, `close`, `refreshEntries` (si `changed`), les 4 autres mutations d'entrées ; `create` appelle `stamp(null, …)` |
| `RevalidationService` | écriture existante (l. 309 et levée T173 l. 347) passe par `stamp` | — (n'ajoute jamais d'entrée, mais comble le trou comme toute écriture) |

`omitAuditFields` reste appliqué après `stamp`. Les campagnes mutent l'objet en place : `mutate`
garantit la copie `before`.

`ElementMoveService` passe déjà par `requirements.retargetObjectTypeRef` et `tests.update` → couvert.
Bulk import MCP → `create` des trois services → couvert (acteur MCP).

**Garde-fou** : un test unitaire (`history.write-paths.test.ts`) lit les sources de `main/services`
et échoue si un `writeYaml(…, \`requirements/` / `tests/` / `campaigns/` apparaît hors de la méthode
d'écriture désignée. Rattrape un futur chemin d'écriture oublié.

### 2.3 `testSnapshot` (spec §11)

`CampaignsService.snapshotsFor` applique `withoutHistory` à chaque test : couvre la création, l'ajout,
le report (GH64) et la resynchronisation (GH68), qui passent tous par `snapshotsFor`.
`refreshEntries` compare `toPlain(next)` sans `history` à la copie existante : une copie pré-GH77
sans `history` ne doit pas être réécrite pour cette seule raison (déjà le cas, `next` n'en a plus).

### 2.4 Fusion (`packages/merge-core/src/object.ts`)

Dans `mergeUnit`, cas `unit === 'history'` avant le conflit : `mergeHistories(l, r)` → pour chaque clé,
union des entrées des deux côtés, dédoublonnage sur `(at, by, value, source)` (sérialisation
canonique), tri stable par `at`. Jamais de conflit, même si un seul côté a la clé. Export de
`mergeHistories` (réutilisé par la reprise git, §4). Tests vitest dans `merge-core`.

Le résultat de fusion n'appelle pas `stamp` : aucune entrée créée (spec §5). La valeur courante
fusionnée peut différer de la dernière entrée → entrée implicite à la lecture, comblée à la
prochaine écriture (spec §8.2).

### 2.5 Lecture effective

- IPC `history:get(repoPath, kind, id)` → `HistoryService.effective` (exigences / tests : objet de
  l'index avec `updatedAt/By` ; campagnes : `get` + `git.fileHistory` seulement si un écart existe).
  Exposé dans `preload`, `api-client` (client web) et le registre de handlers.
- MCP : les tools de lecture d'un objet (`read.tools.ts`) incluent `history` effectif (avec
  `implicit: true`). Les listes n'incluent pas `history` (volume) — à confirmer à la relecture du
  contrat des tools ; #74 fixera le contrat du graphe.

### 2.6 Documentation (sprint 1)

- `CLAUDE.md` : champs système fixes (+ `history`), exemple de schéma (`trackStatusHistory`,
  `trackHistory`), règle de cohérence n° 12, « Ce que tu ne dois PAS faire » (+ éditer `history`).
- `agents-md.template.ts` : `history` dans les champs système + règle, `AGENTS_MD_TEMPLATE_VERSION`
  +1. Format d'objet périmé : non touché (#60).

---

## 3. Sprint 2 — configuration et renommage

### 3.1 Éditeur de schéma (`objectTypeEditor.tsx`)

- `EditableObjectType.trackStatusHistory: boolean` (défaut `true`) ; case « Historiser le statut ».
  `editableToObjType` n'écrit la clé que si `false`.
- `EditableField.trackHistory: boolean` ; case « Historiser » affichée pour tout type de
  `HISTORY_TRACKABLE_TYPES` (aujourd'hui tous), avec une infobulle « valeur » / « date et auteur
  seulement » selon `historyModeFor`. `editableToField` n'écrit la clé que si vrai.
- `EditableField.originalName?: string` (non persisté) : posé par `fieldToEditable`, absent pour un
  champ ajouté dans la session. Renommage = `originalName && originalName !== name`. Supprimer puis
  recréer un champ ne porte pas d'`originalName` → pas de renommage.
- i18n : clés FR / EN.

### 3.2 MCP `add_object_type`

`schemaFieldSchema` + `trackHistory`, `objectTypeDefinitionSchema` + `trackStatusHistory` (zod
retire sinon les clés). Doc des tools et `AGENTS.md` (+1 version si le texte change).

### 3.3 Renommage de champ (`main/services/field-rename.service.ts`, nouveau)

```ts
renameFields(repoPath: string, objectTypeRef: string, renames: Array<{ from: string; to: string }>,
  workspaceDir?: string): Promise<FieldRenameResult>
// FieldRenameResult = { migrated: string[]; skipped: { id, reason: 'target_exists' }[]; failed: { id, error }[] }
```

- Repo des objets : `schema.resolveComponentRepoPath(repoPath, objectTypeRef, workspaceDir) ?? repoPath`.
- Objets : exigences (`reqIndex.findAll({ type })`), tests (`testsIndex`), campagnes (`campaigns.list`
  filtrées sur `objectTypeRef`).
- Par objet, sous le même verrou que les services (`withKeyLock` / `enqueue` campagnes) :
  - si `fields[to]` ou `history[to]` existe déjà → `skipped` ;
  - sinon déplace `fields[from]` → `fields[to]` et `history[from]` → `history[to]` (ordre des clés
    conservé), écrit **sans** `stamp` (pas de changement de valeur) ; objet sans `from` → rien.
- Au mieux par fichier (`try/catch` → `failed`), comme `retargetObjectTypeRef`.
- Méthodes dédiées `renameFieldKeys` dans chaque service (même raison que `retargetObjectTypeRef` :
  pas d'exposition par le DTO public). Le garde-fou §2.2 les autorise explicitement.
- IPC `schema:rename-fields`, preload, `api-client`.

Flux renderer (`StructureTab.handleSaveElement`) : `saveSchema` puis, s'il y a des renommages,
`api.schema.renameFields` ; compte rendu dans une bannière de l'onglet Structure (« N objets
migrés ; M non migrés : … », liste dépliable). Schéma enregistré avant la migration : même
philosophie que `ElementMoveService` (pas de retour arrière ; les échecs sont listés, l'utilisateur
corrige à la main).

---

## 4. Sprint 3 — reprise git et affichage

### 4.1 `HistoryBackfillService` (`main/services/history-backfill.service.ts`)

```ts
run(repoPath: string, onProgress?: (p: { done: number; total: number }) => void): Promise<BackfillResult>
// BackfillResult = { objects: number; entriesAdded: number; failed: { file, error }[] }
```

Algorithme (un seul parcours de l'historique, pas un `git.log` par fichier) :
1. `git.log({ ref: HEAD })` → commits, parcourus du plus ancien au plus récent, **premier parent**.
2. Pour chaque commit : fichiers modifiés sous `requirements/`, `tests/`, `campaigns/` par
   comparaison d'arbres avec le parent (réutilise `diffSubtrees` de `GitService`, rendu public ou
   exposé via une méthode `changedFilesByCommit(prefixes)`).
3. Lecture du blob, `yaml.load`, valeurs des clés suivies (config de suivi **actuelle** du schéma).
   Une valeur différente de la précédente version du même fichier → entrée
   `{ value, at: commit.author.timestamp, by: commit.author.name, source: 'git' }` ; mode
   « événement » : une entrée dès que le contenu du champ change. Premier commit du fichier = valeur
   initiale.
4. Fusion avec `history` du fichier courant via `mergeHistories`, puis suppression des entrées `git`
   doublons d'une entrée applicative : même clé, même valeur, `at` dans `]commit précédent du
   fichier ; commit]` (spec §9.3).
5. Écriture des seuls fichiers changés, sous verrou, sans `stamp`.

`by` = nom de l'auteur du commit (git ne connaît pas le login forge). Écart assumé avec les entrées
applicatives (login) ; `source: git` le signale. **Point à valider.**

Rejouable : les entrées produites sont identiques d'une exécution à l'autre → dédoublonnées par
`mergeHistories`.

Coût : un parcours de commits + une lecture de blob par (commit, fichier modifié). Mesure sur le
repo de démo et sur un repo généré (2 000 objets × 200 commits) dans le sprint ; borne retenue si
> 60 s : option « depuis le commit X » (non prévue sinon).

UI : bouton « Reconstruire l'historique depuis git » dans le panneau Projet (par repo du workspace),
confirmation, barre de progression (événement `history:backfill-progress`), compte rendu. IPC
`history:backfill`. Client web : même bouton (service côté serveur).

### 4.2 Section « Historique » (`renderer/components/history/HistorySection.tsx`)

- Repliée par défaut ; chargement via `api.history.get` à l'ouverture.
- Une liste par clé (« Statut » puis champs dans l'ordre du schéma ; clés inconnues du schéma en fin,
  nom brut) ; entrées récentes d'abord ; libellé du statut / de la valeur d'enum depuis le schéma,
  sinon valeur brute ; `null` → « (vide) » ; mode événement → « modifié ».
- Badges : `MCP`, `git`, `schema`, « déduite » (implicit).
- Intégrée dans `req.$reqId.tsx`, `test.$testId.tsx`, `campaign.$campaignId.tsx` et `EditView`
  (Vue Système, onglet Édition), sous les champs.

### 4.3 Mises à jour SPEC (sprint final)

`SPEC-REQ` §2.1, §3.1, §3.4, §4 ; `SPEC-TESTS` §2–3, §4.1–4.2 ; `SPEC-TECH` §4, §6 ;
`SPEC-ELECTRON-DESKTOP` §20 ; `SPEC-MCP-SERVER` ; `SPEC-TEMPLATES` §1–4 ; `SPEC-INDEX` (colonne MAJ).

---

## Décisions techniques et alternatives rejetées

| Décision | Alternatives rejetées |
|----------|----------------------|
| Logique pure dans `@polenta/types` (partagée main / MCP / renderer / futur graphe #74) | Dans `main` seulement : le renderer et #74 la réimplémenteraient |
| `stamp` explicite dans une méthode d'écriture par service + test garde-fou | Hook dans `GitService.writeYaml` : il ne connaît ni l'objet *avant* ni le type, et écrit aussi des fichiers non-objets ; un décorateur générique masquerait l'acteur |
| Entrée implicite calculée à la lecture, pas dans l'index | Dans `RequirementsIndexService` : l'index n'a pas le schéma, et toutes les lectures en paieraient le coût |
| Union sans conflit dans `mergeUnit` | Conflit présenté à l'utilisateur : aucune décision possible, les deux côtés sont vrais |
| `git.fileHistory` paresseux pour les campagnes | Champs `updatedAt` sur les campagnes : hors sujet |
| Renommage après l'enregistrement du schéma | Transaction schéma + objets : impossible sur des fichiers, cohérent avec `ElementMoveService` |
| Reprise git en un parcours de commits | `git.log({ filepath })` par fichier : coût quadratique sur un gros repo (cf. `fileHistoryMap`, T142) |

## Risques

- **Chemin d'écriture oublié** → garde-fou §2.2.
- **Identité web** (`projectUsername` dans le conteneur par utilisateur) → test serveur web S1.
- **Taille des fichiers** : un champ très modifié (ex. statut de campagne) reste petit ; un champ
  `richtext` suivi en mode événement ajoute ~1 ligne par sauvegarde *effective* (autosave sans
  changement = rien). Acceptable ; à surveiller.
- **Horloges** : `at` vient du poste ; un poste déréglé produit un tri faux après fusion. Accepté.
