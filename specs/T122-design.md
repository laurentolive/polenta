# T122-design — Serveur MCP pour agents IA

## 0. Prérequis T118 — état vérifié

Vérification faite dans ce worktree (`c:\Dev\polenta-T122`, branche `T122`) :

```
git branch -a          → branche `T118` existe (locale)
git log T118 -1         → 20c71eb fix(main): T118 — sérialise et recale la génération d'ID sur compteur
git diff master...T118 --stat
  campaigns.service.ts      | 22 +-----
  id-counter.util.ts        | 57 ++++++++ (nouveau)
  requirements.service.ts   | 10 +----
  tests.service.ts          |  9 +----
  specs/T118.md              | 63 ++++++++
```

Le correctif existe et est complet (nouveau helper `id-counter.util.ts::nextCounterId` —
file de promesses par `repoPath` + recalage sur `max(compteur, plus haut ID sur disque)`),
mais **n'est pas mergé sur `master`**, et **n'est pas présent dans la branche `T122`**
(vérifié : `requirements.service.ts` dans ce worktree contient toujours l'ancien
`nextId()` en read-modify-write non sérialisé, sans `id-counter.util.ts`).

**Décision** : la branche `T122` doit intégrer le correctif `T118` **avant** que
`bulk_import_*` en mode `dryRun: false` soit implémenté (sprint 2) — sans ça, le
critère d'acceptation "3 campagnes créées en série via MCP → CAMP-0002/0003/0004,
aucune collision" est invérifiable par construction.

Deux options :

1. **Retenue** : au début du sprint 1, l'Agent Dev fait `git merge T118` (ou
   `git rebase T118`) dans la branche `T122`, ramenant `id-counter.util.ts` et les
   3 patches de service. Réutilise le correctif tel quel, pas de divergence de logique.
   **Conséquence à valider par l'humain** : `T122` ne pourra être mergée vers `main`
   qu'après (ou en même temps que) `T118` — si `T118` change avant son propre merge,
   `T122` devra rebaser à nouveau. C'est un couplage de planning, pas un problème
   technique.
2. **Rejetée** : réimplémenter indépendamment la sérialisation/recalage dans `T122`.
   Rejetée — duplique une logique déjà écrite et validée par un autre ticket, et
   crée un risque de divergence/conflit quand `T118` sera mergée séparément sur `master`
   (deux correctifs différents du même bug, à réconcilier a posteriori).
3. **Rejetée** : bloquer entièrement `T122` jusqu'à ce que `T118` soit validée et mergée
   sur `master`, puis rebaser `T122` sur `master`. Plus "propre" en histoire git mais
   immobilise ce ticket sans raison technique — l'option 1 obtient la même garantie de
   correction sans attendre le cycle de validation humaine de `T118`.

**Action requise avant le sprint 1** (à exécuter par l'Agent Dev, pas fait ici — cette
phase Design ne modifie pas de code) : `git merge T118` dans la branche `T122`, puis
`pnpm typecheck` pour confirmer l'intégration propre.

---

## 1. Vue d'ensemble du découpage

Le spec est volumineux (serveur stdio + DI headless + 2 tools de lecture + 3 tools
d'import bulk avec dry-run + 5 tools de mutation de schéma + génération AGENTS.md/
.mcp.json + question de packaging pour la distribution). Découpage en **4 sprints** :

| Sprint | Contenu | Dépend de |
|---|---|---|
| 1 | Squelette serveur MCP stdio + DI headless + tools de lecture | merge T118 dans T122 |
| 2 | Tools d'import massif (`bulk_import_*`) avec dry-run | Sprint 1 |
| 3 | Tools de mutation de schéma (`add_component`, `add_object_type`, `add_field`, `add_status`, `add_link_type`) | Sprint 1 (indépendant du 2) |
| 4 | `AGENTS.md` + `.mcp.json` + packaging distribution + doc finale (`SPEC-MCP-SERVER.md`) | Sprint 1, 2, 3 |

Sprint 2 et 3 sont indépendants entre eux (peuvent être réordonnés ou menés par deux
passes distinctes de l'Agent Dev) mais tous deux dépendent du squelette du sprint 1.
Sprint 4 ferme le ticket : il suppose que les tools existent déjà pour documenter leurs
contrats réels dans `AGENTS.md`/`SPEC-MCP-SERVER.md` plutôt que d'anticiper.

---

## 2. Sprint 1 — Squelette serveur + DI headless + tools de lecture

### 2.1 Problème clé : DI sans process Electron

`container.ts` construit les services avec des dépendances qui, transitivement,
importent `electron` :

```
WorkspaceService → app.getPath('userData')          (workspace.service.ts, méthode, pas constructeur)
AuthService       → app.getPath('userData'), keytar  (auth.service.ts, méthode, pas constructeur)
SyncService(auth) → délègue à AuthService pour token
WorkspaceTreeService(sync, polentaRepo) → clone via SyncService si dépendance manquante
```

Vérifié : `import { app, shell } from 'electron'` en tête de fichier ne plante ni à
l'import ni à la construction (`app`/`shell` ne sont utilisés que dans le corps de
méthodes, jamais dans un constructeur) — seul un **appel réel** à une méthode
`AuthService`/`SyncService` qui touche `app.getPath` planterait hors Electron.

**Tools MCP concernés dans ce ticket n'appellent jamais ces méthodes** : aucun tool
(lecture, import bulk, mutation schéma) ne fait de clone/push/pull/commit ni de lecture
de token — cohérent avec le hors-scope explicite du spec ("jamais de commit/push
automatique", "pas de création de submodule via MCP"). `SchemaService` reçoit un
paramètre `auth` qu'il n'utilise déjà nulle part dans le code actuel (vérifié —
`grep this.auth` dans `schema.service.ts` ne retourne rien).

**Décision** : `apps/desktop/src/mcp-server/container.ts` réutilise **exactement**
les mêmes classes que `main/container.ts` (`AuthService`, `SyncService`,
`PolentaRepoService`, `WorkspaceTreeService`, `SchemaService`, `RequirementsIndexService`,
`TestsIndexService`, `RequirementsService`, `TestsService`, `CampaignsService`) —
même DI, comme demandé par le spec — mais **sans** `RepoWatcherService` (chokidar,
inutile pour un process qui répond à des appels ponctuels puis se termine, pas de
notion de "vue live" côté MCP) ni les services hors-périmètre (`ReviewsService`,
`TraceabilityService`, `QueryEngineService`, `DashboardsService`, `ExportService`…).

**Risque documenté (pas un blocage)** : cette approche s'appuie sur le fait que le
code actuel n'appelle `app.getPath`/`keytar` que paresseusement, à l'intérieur de
méthodes jamais invoquées par les tools MCP — pas sur une garantie du système de
types (rien n'empêche un futur changement de `WorkspaceTreeService`/`SchemaService`
d'appeler `auth`/`sync` de façon plus agressive et de casser silencieusement le
serveur MCP en usage réel, alors que `pnpm typecheck` resterait vert). Alternative
rejetée : construire un `NoopAuthService`/`NoopSyncService` factices typés
(implémentant la même interface publique, chaque méthode lançant une erreur
explicite "non disponible en mode MCP"). Rejetée pour le sprint 1 par simplicité —
**recommandée comme durcissement à prévoir si un futur sprint MCP élargit le
périmètre** (ex. lecture de tree cache multi-repo plus poussée) ; à documenter dans
`T122-sprint1.md` comme dette technique explicite plutôt que silencieuse.

### 2.2 Nouveaux fichiers

- **`apps/desktop/src/mcp-server/container.ts`** — `createMcpContainer(repoPath: string, workspaceDir?: string): McpContainer` (synchrone, pas de `createContainer()` async comme le main Electron — pas de fenêtre à ouvrir). Retourne `{ schema, requirements, tests, campaigns, workspaceTree, git }`.
- **`apps/desktop/src/mcp-server/index.ts`** — point d'entrée exécutable :
  - parse `--repo <path>` (obligatoire) et `--workspace <path>` (optionnel, sinon
    replié sur `repoPath` — cas mono-repo autonome, cf. §2.3) depuis `process.argv`,
    avec repli sur les variables d'environnement `POLENTA_REPO_PATH`/
    `POLENTA_WORKSPACE_DIR` (les deux mécanismes documentés dans le spec sont
    supportés — CLI prioritaire si les deux sont fournis) ;
  - échec explicite (`process.exit(1)` + message sur stderr, jamais sur stdout —
    stdout est le canal du protocole stdio MCP, toute pollution le casse) si
    `repoPath` n'est pas fourni ou n'existe pas sur disque ;
  - construit le container, instancie `McpServer` (`@modelcontextprotocol/sdk`),
    enregistre les tools (§2.4), connecte `StdioServerTransport`.
- **`apps/desktop/src/mcp-server/tools/schema.tools.ts`** — tool `get_schema`.
- **`apps/desktop/src/mcp-server/tools/read.tools.ts`** — tools `list_requirements`,
  `list_tests`, `list_campaigns`.
- **`apps/desktop/src/mcp-server/mcp-types.ts`** — types partagés entre tools
  (résultats, erreurs structurées).

### 2.3 Résolution `workspaceDir` — mono-repo par défaut

Le spec acte "un repo fixe par instance" mais reste ouvert sur le mécanisme exact.
Décision : `--repo` est la seule option obligatoire. Si `--workspace` est omis, le
serveur fonctionne en **mode mono-repo** : `resolveComponentRepoPath()` ne pourra
jamais router vers un composant *submodule* réel (nœud avec `url`) — seuls la racine
(`root`) et les sous-composants **locaux** (T113, sans `url`, même repoPath) sont
correctement gérés (déjà le comportement de `resolveComponentRepoPath()` : un nœud
sans entrée dans l'arbre workspace retombe sur `repoPath`, ce qui est correct pour un
sous-composant local puisqu'il vit physiquement dans le même repo).

Si `--workspace` est fourni, le serveur lit le cache existant
(`<workspaceDir>/.polenta/tree.cache.yaml` via `WorkspaceTreeService.readCache()`) —
**sans jamais appeler `buildTree()`/`openWorkspace()`**, qui peuvent déclencher un
`SyncService.clone()` (donc potentiellement de l'auth réseau) pour une dépendance
manquante. Si le cache est absent, le comportement se dégrade proprement en mode
mono-repo (log d'avertissement sur stderr, pas d'échec).

**Alternative rejetée** : reconstruire l'arbre à chaque démarrage du serveur MCP
(cohérence garantie avec l'état git réel). Rejetée — un import massif ou une
modification de schéma déclenchés par un agent ne doivent pas pouvoir provoquer un
clone réseau implicite hors du contrôle explicite de l'utilisateur (cohérent avec
"jamais de commit/push automatique" et plus largement avec le principe d'un outil
strictement local pour le périmètre de ce ticket).

### 2.4 Tools de lecture (sprint 1)

```ts
// get_schema — pas de paramètre, retourne .polenta/schema.yaml résolu
type GetSchemaResult = ProjectSchema

// list_requirements(filters?: { type?: string; status?: string; search?: string })
//   → réutilise RequirementsService.findAll (donc RequirementFilters existant)
// list_tests(filters?: { type?: string; status?: string; search?: string })
//   → TestsService.findAll n'accepte aujourd'hui aucun filtre (findAll(repoPath) seul) —
//     filtrage type/status/search fait en mémoire côté tool MCP dans ce sprint
//     (pas de changement de signature de TestsService — cohérent avec "réutiliser
//     tel quel", le filtrage est un besoin propre à l'exploration MCP)
// list_campaigns(filters?: { component?: string; level?: string })
//   → réutilise CampaignsService.list(repoPath, component?, level?) tel quel
```

Chaque résultat de liste est plafonné en sortie (troncature + compteur total) pour
éviter qu'un projet avec des milliers d'objets ne sature le contexte de l'agent
appelant — seuil proposé : 200 objets par appel, avec `truncated: boolean` et
`total: number` dans la réponse ; l'agent doit affiner ses filtres au-delà. Ce
plafond est une décision de ce ticket (le spec ne le précise pas), documentée ici
plutôt que découverte en usage.

### 2.5 `apps/desktop/package.json`

- Nouvelle dépendance : `@modelcontextprotocol/sdk` (version à fixer par l'Agent Dev
  sur la dernière stable au moment de l'implémentation — API des tools continue
  d'évoluer, aucune version n'est déjà utilisée ailleurs dans ce repo, aucune
  contrainte de compat à respecter).
- Nouvelle devDependency : `tsx` (exécution directe de `.ts` sans étape de build,
  pour le mode dev/CLI — le repo n'a aujourd'hui aucun runner TS standalone hors
  `electron-vite`).
- Nouveau script : `"mcp-server": "tsx src/mcp-server/index.ts"` — satisfait le
  critère d'acceptation `pnpm --filter desktop run mcp-server -- --repo <path>`.
  Le build de production packagé (bundle autonome, sans dépendre de `tsx`/du
  monorepo source) est traité au sprint 4 (question de distribution, pas bloquante
  pour le développement/test de ce ticket).

---

## 3. Sprint 2 — Tools d'import massif (`bulk_import_*`)

### 3.1 Couche de validation dry-run

Nouveau fichier **`apps/desktop/src/main/services/bulk-import-validation.util.ts`**
(dans `main/services`, pas dans `mcp-server/` — logique métier pure, testable sans
MCP, réutilisable si `apps/api` ressuscite un jour comme le spec le laisse ouvert) :

```ts
export interface BulkEntryError {
  index: number
  reason: string          // message humain, ex. "champ requis 'priority' manquant"
  field?: string          // nom du champ en cause, si applicable
}

export interface BulkValidationResult<TDto> {
  valid: Array<{ index: number; dto: TDto; predictedId: string }>
  errors: BulkEntryError[]
}

export function validateBulkEntries<TDto extends { objectTypeRef: string; fields?: Record<string, unknown> }>(
  schema: ProjectSchema,
  entries: TDto[],
  nextIdPreview: (objectTypeRef: string, countSoFar: number) => string,
): BulkValidationResult<TDto>
```

Règles vérifiées par entrée (dans cet ordre — la première échouée arrête la
validation de cette entrée, ne bloque pas les autres) :

1. `objectTypeRef` résout vers un `ObjectTypeDefinition` existant
   (`findObjectTypeDef`, déjà partagé) — `'unresolvable'` (cross-composant non
   vérifiable) est **accepté** avec un avertissement, pas une erreur bloquante :
   cohérent avec le comportement déjà toléré ailleurs (schema-lookup.util.ts) pour
   ne pas bloquer les refs cross-composant légitimes.
2. Le nœud propriétaire du type n'est pas `readonly: true` — sinon erreur explicite
   `"nœud '<name>' en lecture seule"` (nouvelle règle, cf. §3.3).
3. Tous les champs `required: true` du type sont présents et non vides dans
   `dto.fields`.
4. Pour chaque champ avec `validator: 'EARS'` : le texte du champ correspond à l'un
   des 5 patterns EARS (Ubiquitaire/Événementiel/Conditionnel/Optionnel/Réponse
   indésirable, cf. `CLAUDE.md`) — vérification par regex sur les mots-clés
   structurants (`SHALL`, et un des `WHEN|WHILE|WHERE|IF...THEN` en tête), pas une
   validation grammaticale complète. **Ce point est explicitement demandé par le
   bullet 3 du spec** ("EARS si le champ a `validator: EARS`") — ce n'est **pas**
   l'enforcement générique des règles de `CLAUDE.md` §"Règles de cohérence" (ex.
   règle 1 "tout SHALL a un critère d'acceptance", règle 3 "toute exigence approved
   a un lien vers un test") qui, elle, reste hors scope (statu quo : documentée
   dans `AGENTS.md`, pas enforcée) — la distinction est fine mais explicite dans le
   spec, donc actée ici sans aller-retour humain supplémentaire.

`predictedId` en mode dry-run : calculé par une variante **read-only** de
`nextCounterId` (T118) — lit `config/counters.yaml` + liste les fichiers existants,
calcule `max(...) + 1 + countSoFar` (où `countSoFar` = nombre d'entrées déjà
"seraient créées" du même préfixe plus tôt dans le même batch, pour que les IDs
prévisionnels d'un même batch soient distincts) **sans écrire** `counters.yaml`.
Nécessite d'exporter une fonction `peekNextCounterId` (lecture seule) depuis
`id-counter.util.ts` à côté de `nextCounterId` (écriture) — petite extension du
fichier introduit par T118, pas une réécriture.

### 3.2 Tools

```ts
// bulk_import_requirements(entries: CreateRequirementDto[], dryRun = true)
// bulk_import_tests(entries: CreateTestCaseDto[], dryRun = true)
// bulk_import_campaigns(entries: CreateCampaignDto[], dryRun = true)

interface BulkImportToolResult {
  dryRun: boolean
  summary: { total: number; ok: number; failed: number }
  created: Array<{ index: number; id: string }>       // dryRun: false uniquement, IDs réels
  wouldCreate: Array<{ index: number; id: string }>    // dryRun: true uniquement, IDs prévisionnels
  errors: BulkEntryError[]
}
```

`dryRun: false` : itère les entrées valides (résultat de `validateBulkEntries`) et
appelle `RequirementsService.create`/`TestsService.create`/`CampaignsService.create`
**en série** (pas de `Promise.all` — l'ordre conditionne les IDs attribués via
`nextCounterId`, et le spec demande explicitement "best-effort, pas transactionnel").
Une entrée qui échoue à l'écriture (erreur imprévue, ex. FS) est reportée dans
`errors` sans annuler les précédentes déjà écrites — conforme au spec.

### 3.3 Lecture `readonly` par entrée

`RequirementsService.create`/`TestsService.create`/`CampaignsService.create`
n'appliquent **aujourd'hui aucune vérification `readonly`** (vérifié en lisant les
trois fichiers — `create()` résout juste `targetRepo` et écrit). C'est un manque
préexistant, pas introduit par ce ticket, mais le critère d'acceptation "nœud
readonly refusé" doit être satisfait **au niveau du tool MCP** (dans
`validateBulkEntries`, §3.1 règle 2) — décision : ne pas modifier
`RequirementsService.create` lui-même dans ce ticket (risque de régression sur l'UI,
hors scope) ; le refus `readonly` est une garde ajoutée dans la couche de validation
bulk-import, appliquée uniquement au chemin MCP. **Alternative rejetée** : ajouter la
vérification directement dans les 3 services `create()` — plus "correct" globalement
(protégerait aussi l'UI, qui aujourd'hui peut écrire dans un nœud readonly sans
qu'aucun test ne l'empêche) mais élargit le scope de ce ticket à un correctif UI non
demandé ; à signaler comme constat séparé, pas traité ici (ticket dédié si souhaité).

---

## 4. Sprint 3 — Tools de mutation de schéma

### 4.1 Nouvelles méthodes `SchemaService`

```ts
export class SchemaValidationError extends Error {
  constructor(public readonly code: SchemaValidationErrorCode, message: string) { super(message) }
}
export type SchemaValidationErrorCode =
  | 'NODE_NAME_TAKEN' | 'NODE_NOT_FOUND' | 'NODE_READONLY'
  | 'TYPE_NAME_TAKEN' | 'TYPE_NOT_FOUND' | 'PREFIX_TAKEN'
  | 'FIELD_NAME_TAKEN' | 'STATUS_NAME_TAKEN' | 'LINK_TYPE_NAME_TAKEN'

// SchemaService — nouvelles méthodes publiques
addNode(repoPath: string, dto: { name: string; label: string; description?: string; readonly?: boolean }): Promise<ProjectSchema>
addObjectType(repoPath: string, dto: { nodeName: string; objectType: ObjectTypeDefinition }): Promise<ProjectSchema>
addField(repoPath: string, dto: { nodeName: string; typeName: string; field: SchemaField }): Promise<ProjectSchema>
addStatus(repoPath: string, dto: { nodeName: string; typeName: string; status: SchemaStatus }): Promise<ProjectSchema>
addLinkType(repoPath: string, dto: { linkType: LinkTypeDefinition }): Promise<ProjectSchema>
```

Chaque méthode : `get(repoPath)` → clone en mémoire → valide → mute la copie →
`save(repoPath, schema)` (réécriture complète du fichier — atomicité au niveau du
fichier, exactement ce que le spec demande : "réécriture complète en interne").
Aucune n'écrit si la validation échoue (lève `SchemaValidationError` avant tout
appel à `save()`).

Règles de validation (par méthode) :

| Méthode | Vérifie |
|---|---|
| `addNode` | `name` non déjà pris par un `SystemNode` existant (comparaison exacte, sensible à la casse — cohérent avec le message renderer déjà existant "Ce nom est déjà utilisé", `StructureTab.tsx` ligne 686) |
| `addObjectType` | nœud `nodeName` existe et n'est pas `readonly: true` ; `objectType.prefix` non déjà utilisé par **aucun** type d'**aucun** nœud du projet (règle 10 CLAUDE.md — scan de tous les `nodes[].objectTypes[].prefix`) ; `objectType.name` non déjà pris dans ce nœud |
| `addField` | nœud/type existent ; nœud pas `readonly` ; `field.name` non déjà présent dans `type.fields` |
| `addStatus` | nœud/type existent ; nœud pas `readonly` ; `status.name` non déjà présent dans `type.statuses` |
| `addLinkType` | `linkType.name` non déjà pris parmi `schema.linkTypes` |

**Pourquoi dans `SchemaService` plutôt qu'un nouveau service `SchemaMutationService`**
(alternative envisagée) : ces méthodes complètent naturellement `get()`/`save()`
déjà là, partagent le même cache interne (`invalidate()` après `save()` déjà géré),
et le spec demande explicitement leur réutilisation "à terme" par `StructureTab`
(UI) — les garder au même endroit que `save()` évite d'avoir deux points d'entrée
pour modifier le même fichier. Rejetée : un service séparé aurait dupliqué l'accès
au cache et à `readFromDisk`/`save` sans bénéfice net.

### 4.2 Tools

Un tool MCP par méthode (`add_component`, `add_object_type`, `add_field`,
`add_status`, `add_link_type`), traduisant `SchemaValidationError` en réponse MCP
`isError: true` avec le `code` et le message, plutôt que de laisser remonter une
exception protocole (cf. §5).

`add_component` mappe vers `addNode` — nom de tool aligné sur le vocabulaire du
spec/UI ("composant"), nom de méthode aligné sur le type de données
(`SystemNode` → `addNode`), différence assumée et documentée en commentaire pour
éviter la confusion à la prochaine lecture.

---

## 5. Convention d'erreur des tools MCP

Deux catégories, traitées différemment (norme MCP) :

- **Erreur de validation métier attendue** (prefix pris, node readonly, champ
  manquant…) → le tool **retourne** `{ isError: true, content: [{ type: 'text',
  text: '<message>' }] }`, jamais une exception JS non catchée — l'agent appelant
  voit un résultat de tool structuré, pas une erreur de protocole.
- **Erreur inattendue** (FS, YAML corrompu, bug) → laissée remonter, le SDK MCP la
  traduit en erreur protocole côté client. Pas de tentative de faire semblant que
  tout va bien.

Chaque handler de tool est donc écrit `try { ... } catch (e) { if (e instanceof
SchemaValidationError) return { isError: true, ... }; throw e }` (mutation de
schéma) ou équivalent pour les erreurs de validation bulk-import (déjà portées
dans `BulkEntryError[]`, jamais levées).

---

## 6. Sprint 4 — `AGENTS.md`, `.mcp.json`, packaging, doc finale

### 6.1 `agents-md.template.ts`

Nouvelle section ajoutée (après "Où trouver les règles...", avant "Invariants à
respecter") mentionnant : le serveur MCP comme mécanisme préféré si le client de
l'agent le supporte, la liste des tools disponibles en une ligne chacun, et un
rappel explicite que la lecture/écriture directe des YAML documentée plus haut
reste le repli pour tout agent sans client MCP — sans dupliquer le contenu déjà
présent (renvoi, pas répétition).

### 6.2 `.mcp.json` — `workspace.service.ts::createNewProject()`

Nouveau fichier écrit à côté de `AGENTS.md`/`.gitignore` (mêmes lignes 90-97 du
fichier actuel) :

```json
{
  "mcpServers": {
    "polenta": {
      "command": "node",
      "args": ["<résolu au moment de la génération>", "--repo", "."]
    }
  }
}
```

**Question ouverte non triviale, à trancher explicitement au sprint 4** : quel est
le chemin exécutable en mode packagé (app installée via `electron-builder`, pas le
monorepo source) ? Le bundle `mcp-server` (sprint 1, produit par un futur script
`build:mcp-server`, ex. via `tsup`/`esbuild`, hors scope détaillé de ce document —
proposé mais pas figé) doit être copié dans les ressources de l'app packagée
(`extraResources` dans `electron-builder.yml`, non encore configuré) pour qu'un
chemin stable existe côté utilisateur final. Piste retenue pour le sprint 4 : le
chemin est résolu à l'écriture de `.mcp.json` via `process.resourcesPath` (Electron)
en build packagé, ou un chemin relatif au repo Polenta source en dev — deux branches
dans `createNewProject()` selon `app.isPackaged`. **Ce détail de packaging n'est
volontairement pas figé plus précisément ici** : il dépend de choix
`electron-builder` qui débordent du périmètre "conception des tools MCP" de ce
document et doivent être vérifiés en conditions réelles (build packagé exécuté) par
l'Agent Dev du sprint 4, pas supposés en Design.

### 6.3 Documentation `SPEC-MCP-SERVER.md`

Le spec liste ce fichier comme "à créer en fin de ticket" dans `## Refs SPEC` — c'est
une tâche du **dernier sprint Dev** (WORKFLOW.md, étape "Si dernier sprint : met à
jour SPEC-INDEX.md"), pas de la phase Design. Signalé ici pour mémoire, pas traité.

---

## 7. Fichiers impactés — récapitulatif

| Fichier | Sprint | Nature |
|---|---|---|
| `apps/desktop/src/mcp-server/container.ts` | 1 | nouveau |
| `apps/desktop/src/mcp-server/index.ts` | 1 | nouveau |
| `apps/desktop/src/mcp-server/tools/schema.tools.ts` | 1 | nouveau |
| `apps/desktop/src/mcp-server/tools/read.tools.ts` | 1 | nouveau |
| `apps/desktop/src/mcp-server/mcp-types.ts` | 1 | nouveau |
| `apps/desktop/package.json` | 1 | modifié (deps + script) |
| `apps/desktop/src/main/services/id-counter.util.ts` | 1 (via merge T118) puis 2 | modifié (ajout `peekNextCounterId`) |
| `apps/desktop/src/main/services/bulk-import-validation.util.ts` | 2 | nouveau |
| `apps/desktop/src/mcp-server/tools/bulk-import.tools.ts` | 2 | nouveau |
| `apps/desktop/src/main/services/schema.service.ts` | 3 | modifié (5 nouvelles méthodes + `SchemaValidationError`) |
| `apps/desktop/src/mcp-server/tools/schema-mutation.tools.ts` | 3 | nouveau |
| `apps/desktop/src/main/services/agents-md.template.ts` | 4 | modifié |
| `apps/desktop/src/main/services/workspace.service.ts` | 4 | modifié (`createNewProject`) |
| `apps/desktop/src/mcp-server/mcp-json.template.ts` | 4 | nouveau |
| `electron-builder.yml` (racine `apps/desktop`, à localiser) | 4 | modifié (extraResources) |
| `specs/SPEC-MCP-SERVER.md` | 4 (dernier sprint Dev) | nouveau — hors périmètre Design |

`apps/desktop/src/main/container.ts` et `apps/desktop/src/main/ipc/index.ts` ne sont
**pas modifiés** — le serveur MCP a son propre point d'entrée et sa propre DI
(§2.2), pas de nouveau handler IPC (aucun besoin, le renderer Electron n'a pas
besoin d'appeler ces tools).
