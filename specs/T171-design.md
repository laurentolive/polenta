# T171 — Design : base de paramètres partagés entre exigences et tests

Réf. : `specs/T171.md` (spec validée). Travail directement sur `main`.

## 1. Vue d'ensemble

```
parameters/parameters.yaml (un par repo)
        │ lecture / écriture (verrou par repo, clés triées)
        ▼
ParametersService (main) ── usages (scan exigences + tests de tous les repos du workspace)
   │  create/update ── éléments approuvés impactés ──► RevalidationService.markImpactedBy(…, { includeSelf })
   │  resolveForRepo / resolveAtTag
   ▼
CampaignsService (résolution + gel à l'ajout : resolvedParams / paramSourceRef / unresolvedParams)

packages/types/src/parameter-refs.ts (partagé main + renderer) : grammaire, extraction, substitution
        ▼
renderer : useParameterBases → ParamRefContext → rendus (markdown-it, Tiptap, texte brut), exports
```

## 2. Découpage en sprints

La feature ne tient pas en un sprint. Trois sprints, chacun livrable et testable seul :

| Sprint | Périmètre | Critères couverts |
|---|---|---|
| **1 — Base et vue Paramètres** | types, lib de références partagée, `ParametersService` (CRUD, usages, refus de suppression, marquage T172), IPC, vue Paramètres (liste, recherche, dialogue d'édition, « Utilisé par ») | 13, 14, 16, 19 |
| **2 — Affichage et insertion** | rendu des références (valeur, style, survol, double-clic, non résolue) dans Word / Excel / Édition / Recherche, éditeur (`{nom}` stylé), insertion (bouton + `{`), création depuis l'éditeur ou depuis une référence non résolue ; exports exigences et tests | 1, 2, 6, 10, 12, 15, 17, 18 (partie exigences et tests) |
| **3 — Campagnes** | résolution et gel à l'ajout (état courant et baseline), prévisualisation, notifications, règle d'instance unique, exécution et relecture, exports de campagne | 3, 4, 5, 7, 8, 9, 11, 18 (campagne), 20 |

## 3. Sprint 1 — Base de paramètres et vue Paramètres

### 3.1 Types — `packages/types`

- `src/parameter.ts` (nouveau) :
  ```ts
  export interface Parameter { name: string; value: string; unit?: string; description?: string }
  export interface ParametersFile { parameters: Record<string, Omit<Parameter, 'name'>> }
  export interface ParameterUsage {
    elementId: string
    category: 'requirement' | 'test'
    title: string
    status: string
    isApproval: boolean      // statut isApproval du type de l'élément
    isTerminal: boolean      // exclu du refus de suppression, affiché grisé
    repoPath: string         // repo de l'élément (ouverture de la fiche)
    ref: string              // référence telle qu'écrite : `nom` ou `<nœud>::nom`
  }
  export interface RepoParameters { repoPath: string; repoName: string; readonly: boolean; parameters: Parameter[] }
  ```
- `src/parameter-refs.ts` (nouveau) — **seule** implémentation de la grammaire, importée par le
  main et le renderer (remplace `PARAM_RE` de `renderer/lib/testParams.ts`) :
  ```ts
  export const PARAM_REF_RE = /\{(?:([A-Za-z0-9_-]+)::)?([A-Za-z0-9_-]+)\}/g
  export const PARAM_NAME_RE = /^[A-Za-z0-9_-]+$/
  export interface ParamRef { raw: string; node?: string; name: string; key: string /* `nom` ou `nœud::nom` */ }
  export function parseParamRefs(text: string): ParamRef[]
  export function extractTestParamRefs(tc: Pick<TestCase,'preconditions'|'postconditions'|'steps'>): string[] // clés, ordre T97
  export function extractRequirementParamRefs(req: Requirement, textFieldNames: string[]): string[]
  export function formatParamValue(p: Pick<Parameter,'value'|'unit'>): string | null // null si value vide
  export function substituteParamRefs(text: string, lookup: (key: string) => string | null | undefined): string
  ```
  `substituteParamRefs` laisse la référence littérale quand `lookup` rend `null`/`undefined`/vide
  (règle T97 conservée). `extractTestParamRefs` reproduit exactement l'ordre de
  `extractTestParameters` (preconditions → étapes triées par `order`, action puis expectedResult
  → postconditions ; `notes` non scanné).
- `src/index.ts` : exports.

### 3.2 Main — `services/parameters.service.ts` (nouveau)

```ts
export class ParametersService {
  constructor(git, reqIndex, testsIndex, schema, revalidation: RevalidationService, workspaceTree?)

  list(repoPath, workspaceDir?): Promise<RepoParameters[]>            // repo ouvert + composants du workspace
  read(repoPath): Promise<Parameter[]>                                // base d'un repo, triée
  usages(repoPath, name, workspaceDir?): Promise<ParameterUsage[]>
  create(repoPath, p: Parameter, workspaceDir?): Promise<{ marked: ImpactedElement[] }>
  update(repoPath, name, patch: Omit<Parameter,'name'>, workspaceDir?): Promise<{ marked: ImpactedElement[] }>
  delete(repoPath, name, workspaceDir?): Promise<{ deleted: true } | { deleted: false; usages: ParameterUsage[] }>
  resolveBases(repoPath, workspaceDir?): Promise<ResolvedBases>       // sprint 3 (état courant)
  resolveBasesAtTag(repoPath, tag, workspaceDir?): Promise<ResolvedBases> // sprint 3
}
```

- **Stockage** : `parameters/parameters.yaml`. Lecture tolérante (fichier absent, `parameters`
  absent ou non-objet → base vide ; `value` non-chaîne → `String(value)`). Écriture : clés
  triées (`Object.keys().sort()`), `unit`/`description` omis s'ils sont vides, sous
  `withKeyLock(\`${repoPath}::parameters\`)`.
- **Validation** : nom conforme à `PARAM_NAME_RE`, inexistant à la création, existant à la
  modification ; refus d'écriture si le repo est readonly (même règle que T172 :
  `readonlyRepoPaths` du repo ouvert, cf. 3.3).
- **Visibilité cross-composant** (réutilisée par usages et résolution) :
  `visibleComponents(objRepo, workspaceDir)` = nœuds du schéma de `objRepo` portant une `url`
  (nœuds submodules), associés au repo de même nom de montage dans l'arbre workspace (même
  correspondance que `SchemaService.resolveComponentRepoPath`). Un repo composant sans nœud
  submodule n'a aucune référence cross-composant visible (CLAUDE.md règle 8).
- **Usages** : pour chaque repo `R` de `resolveWorkspaceRepoPaths` (util T172), pour chaque
  exigence et test de `R` : références extraites (§3 de la spec) ; une référence `nom` vise la
  base de `R`, une référence `nœud::nom` vise la base du composant `nœud` visible depuis `R`.
  Retient celles qui visent (`repoPath`, `name`). Champs scannés côté exigence : champs `text`,
  `textarea`, `richtext` du type (schéma de `R`, `findObjectTypeDef`) ; type non résolvable →
  tous les champs de type chaîne. `isApproval`/`isTerminal` lus dans le même type.
- **Marquage (spec §9)** — dans `create` et `update`, après écriture :
  - `update` : déclenche seulement si `value` ou `unit` change (pas `description`) ;
  - `create` : déclenche pour les usages existants du nom (références jusque-là non résolues) ;
  - éléments visés : usages avec `isApproval && !isTerminal` ;
  - pour chacun : `revalidation.markImpactedBy(usage.repoPath, usage.elementId, workspaceDir, { includeSelf: true })`.
- **Suppression** : refusée si au moins un usage non terminal ; sinon retrait de la clé.

### 3.3 `RevalidationService` (T172) — option `includeSelf`

`markImpactedBy(repoPath, elementId, workspaceDir?, opts?: { includeSelf?: boolean })` :
si `includeSelf`, `elementId` n'est pas retiré de l'ensemble des éléments à marquer ; il passe
par les mêmes exclusions (terminal, readonly, déjà marqué). Méthode publique supplémentaire
`isRepoReadonly(repoPath, openedRepoPath, workspaceDir)` extraite de `readonlyRepoPaths`, pour
que `ParametersService` applique la même règle readonly.

### 3.4 IPC, container, api-client

- `ipc/index.ts` : `parameters:list`, `parameters:read`, `parameters:usages`,
  `parameters:create`, `parameters:update`, `parameters:delete` (tous avec `workspaceDir?`).
- `container.ts` : `const parameters = new ParametersService(git, reqIndex, testsIndex, schema, revalidation, workspaceTree)` ;
  ajout de `parameters` et `revalidation` à l'interface `Container`.
- `mcp-server/container.ts` : non modifié (outils MCP hors scope).
- `packages/api-client` : section `parameters` (`ipc-client.ts`, `types.ts`).

### 3.5 Renderer — vue Paramètres

- `AppLayout.tsx` : `Panel` + `'parameters'` ; `ActivityBar.tsx` : entrée
  (icône `Variable` de lucide, `requiresProject: true`) ; `Sidebar.tsx` : `ParametersPanel`
  (liste des repos du workspace, filtre de recherche) ; nouvelle route `routes/parameters.tsx`
  (`search: { projectId, repo }`) qui monte `ParametersView`.
- `components/parameters/ParametersView.tsx` : tableau par repo (nom, valeur, unité,
  description, nombre d'utilisations) ; recherche nom/valeur/description ; « Nouveau paramètre »
  masqué sur un repo readonly ; clic → `ParameterEditDialog`.
- `components/parameters/ParameterEditDialog.tsx` : formulaire (nom en création seulement,
  valeur, unité, description), liste « Utilisé par » (liens vers l'élément : route
  `/req/$reqId` ou `/test/$testId` avec le `repoPath` de l'usage ; terminaux grisés), boutons
  Enregistrer / Supprimer. **Confirmation** avant enregistrement quand `value`/`unit` change (ou
  en création) et qu'au moins un usage est approuvé non terminal : la liste de ces éléments est
  affichée, et l'IPC n'est appelé qu'après confirmation. Refus de suppression : la liste
  renvoyée par le main est affichée avec ses liens. Dialogue réutilisé tel quel au sprint 2
  (double-clic sur une référence).
- Invalidation après écriture : `['parameters', …]`, `['parameter-usages', …]`, et
  `invalidateImpactedObjects()` (T172) si `marked` n'est pas vide.
- i18n FR/EN : `parameters.*`, `layout.activityBar.parameters`.

## 4. Sprint 2 — Affichage et insertion

### 4.1 Contexte de résolution — renderer

- `hooks/useParameterBases.ts` : `useParameterBases(workspaceDir, repoPath)` → requête
  `parameters:list` (clé `['parameters', workspaceDir, repoPath]`) + schéma du repo ;
  expose `lookup(key)` → `{ param, repoPath, readonly } | { unresolved: 'missing' | 'empty' | 'unknown_node' }`
  pour les références vues depuis `repoPath`.
- `contexts/ParamRefContext.tsx` : fournit `lookup` et `openParameter(key)` (ouvre
  `ParameterEditDialog`, ou la création pré-remplie pour une référence locale non résolue).
  Monté par `SystemView` (repo sélectionné) et `SearchView`.

### 4.2 Rendus

- **markdown-it** (`lib/staticRichText.tsx`, Word / Excel / Recherche) : règle *inline*
  `param_ref` (plugin local `lib/markdownParamRefs.ts`) émettant
  `<span class="param-ref" data-param-ref="key" title="…">valeur</span>` ou
  `<span class="param-ref param-ref--unresolved" …>{key}</span>`. La résolution passe par
  `env` de `md.render(value, env)` (le `MarkdownIt` partagé reste sans état). Le cache
  `useMemo` de `StaticRichTextViewer` inclut une version des bases. Double-clic : écouteur
  délégué sur le conteneur (`closest('[data-param-ref]')`). Ne s'applique pas dans les blocs de
  code (règle inline).
- **Tiptap** (`RichTextField` en édition, `RichTextViewer` en lecture) : extension
  `tiptap/ParamRefDecoration.ts` (plugin ProseMirror de **décorations**, pas de nœud : la
  sérialisation Markdown reste `{nom}`). Édition : décoration *inline* stylée (`title` = valeur).
  Lecture : décoration inline qui masque le texte source + widget portant la valeur.
  Recalcul sur `docChanged` et sur changement des bases (meta de transaction).
- **Texte brut** (champs `text`/`textarea` des cellules Excel / Word / Édition en lecture) :
  composant `components/ParamRefText.tsx` qui découpe la chaîne avec `parseParamRefs`.
- Style : classes `param-ref` / `param-ref--unresolved` dans la feuille globale (pastille
  légère, jetons `status-info` / `status-warning`), identiques partout.

### 4.3 Insertion

- `components/ParamInsertButton.tsx` dans la barre d'outils de `RichTextField` (à côté de
  `TableInsertButton`) : sélecteur (recherche nom / valeur / unité / repo) → insère `{nom}` ou
  `{nœud::nom}` ; « Créer un paramètre » → `ParameterEditDialog` en création, puis insertion.
- Autocomplétion à la saisie de `{` : suggestion Tiptap (`@tiptap/suggestion`, déjà dépendance
  transitive de StarterKit — à vérifier ; sinon plugin maison) réutilisant la liste du
  sélecteur.
- Champs `text` / `textarea` non riches : saisie manuelle uniquement (spec §9).

### 4.4 Exports exigences et tests

Payloads construits dans le renderer (`SystemView` `getPayload`, routes `print.requirements`,
`print.tests`) : chaque champ texte passe par `substituteParamRefs(text, lookup)` avant d'être
placé dans le payload. Les générateurs `*.docx.ts` / `*.xlsx.ts` du main sont inchangés.

## 5. Sprint 3 — Campagnes

### 5.1 Types

`CampaignTestRun` : `resolvedParams?`, `paramSourceRef?`, `unresolvedParams?` (spec §11).
Nouveau type `ParamResolutionPreview` :
`{ testCaseId, resolved: Record<string,string>, manual: string[], unresolved: { ref, reason }[] }[]`.

### 5.2 Main

- `GitService.readYamlAtTag(repoPath, tag, path)` → `{ tagFound: boolean; data: T | null }` :
  `resolveRef(refs/tags/<tag>)` + déréférencement d'un tag annoté (`readTag`), puis
  `readYamlRef`. Distingue « tag introuvable » de « fichier absent au tag ».
- `ParametersService.resolveBases` / `resolveBasesAtTag(repoPath, tag)` : bases du repo du
  test et des composants visibles, chacune `{ params } | { tagMissing: true }`.
- `CampaignsService` reçoit `parameters: ParametersService` ; `create`, `addTests`,
  `duplicateTest` prennent `workspaceDir?` (IPC mis à jour, signatures DTO inchangées).
  `buildNewRuns` calcule pour chaque test, à partir des bases (tag = `campaign.baselineRef`
  s'il existe, sans repli) :
  - base avec valeur non vide → `resolvedParams[key]` (valeur formatée) ;
  - locale absente de la base (base lisible) → à saisir : valeur prise dans `paramValues`
    fourni par le renderer ;
  - sinon → `unresolvedParams` avec la raison (`tag_not_found`, `missing`, `empty`,
    `unknown_node`) ; une référence locale d'un repo dont le tag est introuvable n'est **pas**
    proposée à la saisie.
  - `paramSourceRef = baselineRef` si présent.
  - `paramValues` reçus pour une clé résolue depuis la base sont ignorés (une référence ne
    figure jamais dans les deux).
- Repo du test = `resolveComponentRepoPath(campaignRepo, tc.objectTypeRef, workspaceDir) ?? campaignRepo`.
- IPC `campaigns:preview-params(repoPath, { campaignId? | baselineRef? }, testCaseIds, workspaceDir?)`
  → `ParamResolutionPreview`, sans écriture.

### 5.3 Renderer

- `lib/testParams.ts` : `extractTestParameters` délègue à `extractTestParamRefs` ;
  `isParamsComplete` et `TestParamFields` reçoivent la liste des clés **à saisir** (issue de la
  prévisualisation) au lieu de toutes les clés.
- `campaign.new.tsx` et le panneau d'ajout de `campaign.$campaignId.tsx` : appel à
  `preview-params` à chaque changement de sélection / `baselineRef` ; résolues en lecture
  seule ; non résolues listées avec leur raison ; notification (toast) après ajout si des
  `unresolvedParams` existent ; « Dupliquer » masqué si le test n'a aucune clé à saisir.
- Liste des tests de la campagne : indicateur ⚠ sur une instance avec `unresolvedParams`.
- Exécution / relecture : lookup = `resolvedParams` puis `paramValues` (`substituteParamRefs`),
  rendu via `ParamRefText` / décoration Tiptap en mode « valeurs figées » (survol : nom +
  origine base / saisie ; pas de double-clic) ; en-tête « Paramètres : `<tag>` » ou « état
  courant » ; bandeau des références non résolues.
- Exports de campagne (`campaign.$campaignId.tsx` `getPayload`, `print.campaign-plan`,
  `print.campaign-report`) : substitution avec le même lookup (les paramètres T97 saisis sont
  désormais substitués).

## 6. Décisions techniques et alternatives rejetées

1. **Grammaire unique dans `packages/types`** — le main (usages, résolution en campagne) et le
   renderer (rendu, exports) doivent reconnaître exactement les mêmes références. Rejeté :
   garder `PARAM_RE` dans le renderer et en dupliquer une copie côté main.
2. **Décorations ProseMirror plutôt qu'un nœud Tiptap** — la référence reste du texte `{nom}`
   dans le Markdown stocké (spec : « les références sont du texte »), aucune migration, et
   `tiptap-markdown` n'a rien à sérialiser. Rejeté : un nœud inline `paramRef`, qui imposerait
   une sérialisation Markdown dédiée et casserait la saisie manuelle `{nom}`.
3. **Résolution de campagne dans le main** — la spec l'impose (§11) et c'est le seul endroit
   qui voit tous les repos et les tags. Le renderer ne calcule qu'une prévisualisation, via le
   même code (IPC).
4. **Marquage déclenché par `ParametersService`** (et non par le renderer après confirmation) —
   même logique que T172 (déclencheur côté service) ; la confirmation n'est qu'une étape UI.
5. **Usages calculés à la demande** (scan des index en mémoire) plutôt qu'un index persistant —
   les index exigences/tests sont déjà en mémoire ; le coût est un scan regex par élément,
   acceptable à la taille des projets actuels (quelques centaines d'éléments). Un cache pourra
   être ajouté si besoin.
6. **Readonly** : même règle que T172 (nœud submodule `readonly` du repo ouvert, par nom de
   montage), factorisée dans `RevalidationService` plutôt que recodée.
7. **Nœuds locaux** : `{nœudLocal::nom}` se résout dans la base du repo (un repo = une base,
   spec §1 principe 3) puisque `resolveComponentRepoPath` ne renvoie rien pour un nœud local.

## 7. Point de spec (sprint 3) — reformulation validée

**Critère 5** (« un test d'un composant `motor-control` ajouté à une campagne du repo produit »)
suppose qu'une campagne du repo produit puisse contenir des tests d'un repo composant.
Aujourd'hui, le panneau d'ajout et `create`/`addTests` ne proposent que les tests du repo de la
campagne (`api.tests.list(repoPath)`, `testsIndex` du repo). Le design résout de façon
générique (repo du test déduit de son `objectTypeRef`), donc le critère sera satisfait dès que
les campagnes inter-repos existeront. Mais T171 **n'ajoute pas** cette capacité. Proposition :
reformuler le critère 5 en « un test de `motor-control`, ajouté à une campagne du repo
`motor-control`, est résolu dans la base de `motor-control` » et laisser les campagnes
inter-repos hors scope.

## 8. Mises à jour SPEC prévues (sprint 3, dernier sprint)

`SPEC-TESTS.md §2.4a, §4.1–4.2, §4.4` ; `SPEC-REQ-requirements.md §3, §5.3` ;
`SPEC-FORKS-BRANCHES-BASELINES.md §5` ; `SPEC-TRACEABILITY.md §3+` (lecture au tag) ;
`SPEC-ELECTRON-DESKTOP.md` (navigation, IPC `parameters:*`, `campaigns:preview-params`) ;
spec d'export ; `CLAUDE.md` (structure `parameters/parameters.yaml`, règles de cohérence) ;
`SPEC-INDEX.md`.
