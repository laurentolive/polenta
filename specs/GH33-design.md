# GH33 — Design : sélecteur de tests en vue Excel pour les campagnes

Spec : `specs/GH33.md`. **Deux sprints** (découpage en fin de document).

## Vue d'ensemble

```
TestPickerModal                      (nouveau, modale 2 étapes, état de sélection)
├── étape 1
│   ├── combobox type de test        (types `test` du repo, ref `<nœud>::<type>`)
│   ├── filtre global + FilterOptionsToggle
│   ├── TestPickerGrid               (nouveau, charge arbre/prefs/liens du type affiché)
│   │   └── ExcelView mode `selection` (nouvelle prop, lecture seule + cases à cocher)
│   └── pied : compteur, vider, Annuler / Suivant|Ajouter
└── étape 2
    ├── ReqInstancePicker / TestParamFields   (existants, sortis des listes actuelles)
    └── pied : Précédent / Ajouter (N)
```

La logique de sélection (clic, Ctrl, Maj, ancre, cases de groupe) est isolée dans des fonctions
pures (`lib/gridSelection.ts`). `ExcelView` ne fait que les appeler.

## Fichiers modifiés / créés

| Fichier | Nature | Pourquoi |
|---------|--------|----------|
| `apps/desktop/src/renderer/lib/gridSelection.ts` | nouveau | Fonctions pures : clic de ligne, clic de case, état et bascule d'un groupe, élagage de l'arbre. |
| `apps/desktop/src/renderer/components/system/ExcelView.tsx` | modifié | Prop `selection` : colonne de cases, lecture seule forcée, sémantique de clic GH33, comptage des lignes affichées. Plus un correctif du popover de filtre colonne (`Échap` arrêté, voir D6). |
| `apps/desktop/src/renderer/components/campaign/TestPickerGrid.tsx` | nouveau | Charge l'arbre, les prefs Vue Excel, les liens et les étapes du type affiché, élague l'arbre et monte `ExcelView` en mode sélection. |
| `apps/desktop/src/renderer/components/campaign/TestPickerModal.tsx` | nouveau | Modale 2 étapes, état de sélection/paramètres, compteur, confirmation d'abandon. |
| `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx` | modifié (sprint 1) | Le panneau en ligne « + Ajouter des tests » est remplacé par la modale. `handleConfirmAdd` est conservé et reçoit le résultat de la modale. |
| `apps/desktop/src/renderer/routes/campaign.new.tsx` | modifié (sprint 2) | La liste de cases est remplacée par un bouton, un récapitulatif et la modale. |
| `apps/desktop/src/renderer/hooks/useProjectSchema.ts` | + `getTestTypeRefs(schema)` | Liste `{ ref, label, typeDef }` des types `test` de tous les nœuds locaux (`getAllObjectTypes` ne donne pas le nom du nœud). |
| `apps/desktop/src/renderer/i18n/locales/fr.json`, `en.json` | clés `campaignPage.picker.*` | Nouveaux libellés ; clés devenues inutiles supprimées au sprint 2. |
| `specs/SPEC-TESTS.md` §4.2, `specs/SPEC-SYSTEM-VIEW.md` §Vue Excel / §Filtre par colonne, `specs/SPEC-INDEX.md` | sprint 2 | Mises à jour de fin de ticket. |

Aucun changement côté main/IPC. On réutilise les canaux existants : `tests:list`, `tree:get`,
`pref:get-field-visibility`, `auth:project-username`, `requirements:links-all`,
`campaigns:preview-params`, `campaigns:add-tests`, `campaigns:duplicate-test` et
`campaigns:create`.

## `lib/gridSelection.ts` (pur, sans React)

```ts
export interface ClickInput {
  selected: ReadonlySet<string>   // objectIds sélectionnés (tous types confondus)
  displayed: readonly string[]    // objectIds des lignes de test affichées, dans l'ordre
  anchor: string | null           // objectId
  target: string                  // objectId cliqué
  ctrl: boolean                   // ctrlKey || metaKey
  shift: boolean
}
export interface ClickResult { selected: Set<string>; anchor: string | null }

/** Clic sur la ligne (hors case) — §2.3. */
export function rowClick(i: ClickInput): ClickResult
/** Clic sur la case d'une ligne — §2.3 (Maj = applique l'état cible à la plage). */
export function checkboxClick(i: Omit<ClickInput, 'ctrl'>): ClickResult

export type GroupState = 'all' | 'some' | 'none' | 'disabled'
/** État de la case d'un groupe (dossier ou en-tête) d'après ses objectIds éligibles. */
export function groupState(ids: readonly string[], selected: ReadonlySet<string>): GroupState
/** Bascule d'un groupe : tous cochés → les décoche, sinon les coche tous. */
export function toggleGroup(ids: readonly string[], selected: ReadonlySet<string>): Set<string>

/** Arbre réduit aux items dont l'objectId est dans `keep`. Les dossiers sont conservés, même
 *  vides. Les objectIds de `keep` absents de l'arbre sont ajoutés en fin de racine comme items
 *  synthétiques (id `orphan:<objectId>`). */
export function pruneTree(root: TypeTreeNode[], keep: ReadonlySet<string>, titles: Map<string, string>): TypeTreeNode[]
```

Règles (spec §2.3) :
- **Plage** = `displayed.slice(min(iA, iT), max(iA, iT) + 1)`, avec `iA` l'index de l'ancre.
  Si l'ancre est absente de `displayed`, Maj est ignoré : le clic est traité comme un clic sans
  Maj, et la ligne cliquée devient l'ancre.
- `rowClick` :
  - **simple** : `selected − displayed + {target}` ;
  - **Ctrl** : bascule de `target` ;
  - **Maj** : `selected − displayed + plage` ;
  - **Ctrl+Maj** : `selected + plage`.
  L'ancre devient `target` sauf avec Maj, où elle reste inchangée.
- `checkboxClick` : sans Maj, bascule de `target` et l'ancre devient `target`. Avec Maj, l'état
  cible est `!selected.has(target)` et il est appliqué à toute la plage ; l'ancre reste inchangée.
- **Tests non affichés** : aucune fonction ne retire un id absent de `displayed`, sauf
  `toggleGroup`, qui ne reçoit que des ids filtrés (D3).

## `ExcelView` — prop `selection`

```ts
interface ExcelSelectionMode {
  selected: ReadonlySet<string>             // objectIds
  onChange: (next: Set<string>) => void
  /** Rapporte les objectIds des lignes de test affichées (après filtres et repli), à chaque
   *  changement — sert au compteur « dont M non affichés ». */
  onDisplayedChange?: (objectIds: string[]) => void
  /** Badge optionnel à côté de l'ID (ex. « déjà ×2 »). */
  renderIdBadge?: (objectId: string) => React.ReactNode
}
selection?: ExcelSelectionMode
```

Quand `selection` est fourni :

1. **Lecture seule forcée**, indépendamment des callbacks passés :
   - `onInlineEdit`, `onRenameNode`, `onRootChange`, `onStepsChange`, `onItemNodeAdded` et
     `onEditOpen` sont traités comme absents (`const ro = !!selection`, puis
     `onX = ro ? undefined : onX` en tête du composant) ;
   - `openLinkPopover` ne fait rien. La cellule de lien affiche ses valeurs, mais un clic ne
     sélectionne plus la cellule et n'ouvre plus le popover (`LinkCell` reçoit
     `interactive={false}`) ;
   - pas de menu contextuel de ligne (`handleContextMenu` sort immédiatement) ;
   - le menu « Figer les volets » de l'en-tête reste disponible (spec : colonnes figées
     modifiables mais non persistées, voir D4) ;
   - dans `handleKeyDown`, Ctrl+C/X/V, Suppr, F2 et `Échap` sont ignorés. `Échap` remonte donc à
     la modale.
2. **Colonne de cases** dans l'emplacement de la colonne d'action (index −1, 32 px), toujours
   figée (`position: sticky; left: 0`). `editIconColWidth` devient
   `leadingColWidth = onEditOpen || selection ? 32 : 0`, ce qui garde des décalages corrects
   pour les colonnes figées. `onEditOpen` et `selection` sont exclusifs (le point 1 neutralise
   `onEditOpen`).
   - En-tête : `<input type="checkbox">` avec `indeterminate` posé par une ref, état
     `groupState(matchedIds)`.
   - Dossier : même logique sur `matchedIdsByFolder.get(folder.id)`, case `disabled` si l'état
     est `'disabled'`.
   - Item : `checked = selected.has(objectId)` ; `onClick` appelle `checkboxClick` avec
     `stopPropagation`, ce qui ne déclenche pas le clic de ligne.
3. **Ensembles calculés** (`useMemo`, à chaque rendu filtré) :
   - `displayedIds` : objectIds des `filteredRows` de type item, dans l'ordre (collapse et
     filtres appliqués). Reportés via `onDisplayedChange` dans un `useEffect` dont la clé est
     `displayedIds.join('\n')` ;
   - `matchedIds` : parcours **complet** de `root`, **ignorant le repli**, des items qui
     passent `itemMatchesFilters`. Avec `foldersHidden`, le parcours est identique (le repli est
     déjà ignoré dans ce cas) ;
   - `matchedIdsByFolder: Map<folderId, string[]>` : même parcours, accumulé par dossier
     ancêtre.
4. **Clics** :
   - ligne item : `rowClick` à la place de `handleRowSelect` ;
   - ligne dossier : `onToggle` au simple clic, à la place de la sélection (spec : un clic sur
     un dossier replie ou déplie). Le double-clic n'a plus d'effet ;
   - l'ancre est un état local de `ExcelView` (objectId) ;
   - `effectiveSelectedIds` (sélection de nœuds T149) n'est pas utilisé dans ce mode.
5. **Surbrillance** : une ligne est en `bg-status-info-bg` si `selected.has(objectId)`.
6. Le filtre global reste fourni par l'appelant (`filter`, `filterOptions`). Les filtres colonne
   restent l'état local existant (T51). Ils sont réinitialisés au changement de type par un
   `key={typeRef}` sur `ExcelView`, posé par `TestPickerGrid`.

Le mode n'a **aucun effet sur la vue système**, qui ne passe pas `selection`. Seul le correctif
`Échap` du popover (D6) est commun.

## `TestPickerGrid`

```ts
interface TestPickerGridProps {
  repoPath: string
  typeRef: string                      // `<nœud>::<type>`
  typeDef: ObjectTypeDefinition
  tests: TestCase[]                    // tests proposés de ce type (déjà filtrés par l'appelant)
  username: string
  filter: string
  filterOptions: FilterOptions
  selection: ExcelSelectionMode
}
```

- **Requêtes** :
  - `['tree', repoPath, node, type]`, même clé que `SystemViewContext`, donc cache partagé ;
  - `['pref-visibility', repoPath, username, typeRef]`, même clé que `SystemView` ;
  - `['links-all', repoPath]`.
  Un spinner (`ViewLoading`) s'affiche tant que l'arbre ou les prefs sont en attente.
- **Colonnes** : `prefs.excel`, sinon le fallback de `SystemView` (`section, name, id, status,
  steps` + 3 premiers champs). Ce fallback est extrait dans une fonction partagée
  `defaultVisibleFields(typeDef)`, exportée de `lib/exportColumns.ts`, qui sert déjà à
  `print.tests.tsx` (même ordre). `foldersHidden = !(prefs.showFoldersExcel ?? true)`.
  `rowMaxLines` est lu depuis `localStorage` `polenta:excelRowMaxLines`, avec la même borne que
  `SystemView`, extraite en helper `readExcelRowMaxLines()` dans `RowMaxHeightButton.tsx`.
- **État local non persisté** :
  - `collapsedFolders`, initialisé depuis `prefs.collapsedFoldersExcel` ;
  - `freezeColCount`, initialisé depuis `prefs.freezeColCountExcel`.
  Les setters ne touchent qu'à l'état local, jamais à `pref:save`.
- **Arbre** : `pruneTree(tree.root, idsOf(tests), titles)`. `sectionNumbers` est calculé sur
  l'arbre **non élagué**, pour garder la numérotation de la vue système.
- `objects = tests.map(normalizeObject)` ; `stepsByObjectId` est construit comme dans
  `SystemView`.
- Pas de `candidateObjects`, `onLinkChange` ni `onColumnsReorder` (le glisser-déposer de
  colonnes reste désactivé).

## `TestPickerModal`

```ts
interface TestPickerModalProps {
  repoPath: string
  workspaceDir: string
  mode: 'create' | 'add'
  /** Tests proposés (règles §2.2 calculées par l'appelant, inchangées). */
  candidates: TestCase[]
  defaultTypeRef?: string               // composant/niveau de la route
  baselineRef?: string                  // création : saisi dans le formulaire ; ajout : campagne
  initial: PickerResult                 // sélection et saisies à restituer (création), vide pour l'ajout
  presentOf: (testId: string) => Set<string>   // T179, () => new Set() à la création
  includedCount?: (testId: string) => number   // badge « déjà ×N » (ajout)
  onConfirm: (r: PickerResult) => Promise<void> | void
  onCancel: () => void
}
interface PickerResult {
  testIds: string[]                     // ordre : ordre d'affichage (type, puis arbre)
  paramValues: Record<string, Record<string, string>>
  reqSel: ReqSelectionState
}
```

- **Coque** : overlay `fixed inset-0 z-50 bg-overlay/40`, carte `w-[95vw] h-[90vh] flex
  flex-col`. `useModalHotkeys(requestCancel)`, désactivé pendant la confirmation d'abandon.
- **État** : `step: 1 | 2`, `typeRef`, `filter`, `filterOptions`, `selected: Set<string>`,
  `displayed: string[]` (rapportés par la grille), `paramValues`, `reqSel`, `confirmAbandon`.
- **Types** : `getTestTypeRefs(schema)`. Type par défaut : `defaultTypeRef` s'il fait partie
  de la liste, sinon le premier. Changer de type remet le filtre global à zéro, mais ni la
  sélection ni les options de filtre.
- **Compteur** :
  - `N = selected.size` ;
  - `M = |selected − displayed|` ;
  - un test présélectionné qui ne fait pas partie de `candidates` (préremplissage T46 hors
    filtre composant/niveau) est compté dans N et dans M.
- **Prévisualisation** : `useParamPreview(repoPath, { baselineRef }, [...selected],
  workspaceDir)`, branché dès l'étape 1 (choix D5).
  - `needsInput(id) = isIteratingPreview(p) || (p?.manual?.length ?? 0) > 0` ;
  - `hasStep2 = [...selected].some(needsInput)` ;
  - à l'étape 1, le bouton principal vaut « Suivant » si `hasStep2`, sinon « Ajouter (N) » ou
    « Valider la sélection (N) ». Il est désactivé si `selected.size === 0` en mode `add`, ou
    pendant le chargement de la prévisualisation.
- **Étape 2** : les tests de `selected` qui vérifient `needsInput`, dans l'ordre d'affichage,
  avec le même JSX que les listes actuelles (`ReqInstancePicker` / `TestParamFields`, déplacé
  tel quel), puis la ligne repliée « K tests sans paramètre ».
  - Bouton : `countInstances(...)` et `isAddComplete(...)`, inchangés, déplacés de
    `campaign.$campaignId.tsx` vers `lib/reqInstances.ts` s'ils n'y sont pas déjà ;
  - « Précédent » revient à l'étape 1. À la confirmation, `paramValues` et `reqSel` sont
    élagués aux tests encore sélectionnés.
- **Confirmation** : `onConfirm(result)`. En mode `add`, le bouton passe à « Ajout… » ; si la
  promesse est rejetée, le message s'affiche dans le pied et la modale reste ouverte. En mode
  `create`, l'appelant ferme la modale.
- **Abandon** : `requestCancel` compare l'état courant à `initial` (ensembles d'ids, plus
  `paramValues` et `reqSel` en JSON). S'il diffère, un mini-dialogue « Abandonner la
  sélection ? » (Abandonner / Continuer) s'affiche ; sinon `onCancel()`. Le clic sur l'overlay
  suit le même chemin.

## Intégration

### Sprint 1 — `campaign.$campaignId.tsx`

- `candidates = availableTests`, calculé exactement comme aujourd'hui (approuvés, règles
  T97/T179) et sans `testFilter`.
- Le bouton « + Ajouter des tests » invalide `campaign-param-preview` (comportement conservé)
  et ouvre la modale (`mode='add'`, `baselineRef = campaign.baselineRef`, `presentOf`
  existant, `includedCount`).
- `onConfirm` : le corps actuel de `handleConfirmAdd`, paramétré par le `PickerResult` (même
  répartition `addTests` / `duplicateTest` / itérants). On le ferme seulement en cas de succès.
- Sont supprimés : `selectedToAdd`, `addParamValues`, `addReqSel`, `testFilter`, le JSX du
  panneau en ligne, et `useParamPreview` s'il ne sert qu'au panneau (il sert aussi à
  `availableTests` : il est conservé, avec la même source).

### Sprint 2 — `campaign.new.tsx`

- `candidates = tests`, la liste actuelle filtrée par composant/niveau, sans contrôle
  d'approbation (spec §2.2).
- `selectedTests`, `paramValues` et `reqSel` restent l'état du formulaire, qui reste la source
  de vérité pour `createMutation` (inchangé). La modale reçoit `initial = { testIds:
  [...selectedTests], paramValues, reqSel }` et `onConfirm` les remplace.
- Les tests préremplis (T46) sont dans `selectedTests` dès le montage (inchangé). Ils passent
  donc dans `initial.testIds`, y compris ceux absents de `candidates`, et aucune prop
  supplémentaire n'est nécessaire : `M` les compte, puisqu'ils ne sont jamais affichés.
- **Récapitulatif** sous le bouton :
  - une ligne par test sélectionné : ID, titre, « ×N instances » si le test est itérant,
    valeurs saisies sous la forme `label=valeur` tronquée ;
  - bouton « Modifier », qui ouvre la modale ;
  - si un test sélectionné n'est pas complet (`isAddComplete` faux, par exemple un
    `baselineRef` modifié après coup qui fait apparaître des références à saisir), un avertissement
    s'affiche et « Créer » reste désactivé (règle actuelle).

## Décisions et alternatives rejetées

- **D1 — Étendre `ExcelView` plutôt que créer une grille dédiée.** La spec exige les mêmes
  colonnes, cellules et filtres que la Vue Excel. Une copie divergerait vite. Le surcoût se
  limite à des gardes en tête de composant et à une colonne de tête.
- **D2 — La sélection porte sur des `objectId`, pas des `nodeId`.** Elle doit survivre au
  changement de type (arbres différents) et alimente directement `testCaseIds`. La sélection de
  nœuds T149 n'est pas réutilisée.
- **D3 — Deux notions de « visible ».** `displayed` (filtres et repli) sert aux plages et au
  clic simple ; `matched` (filtres seuls) sert aux cases de groupe. C'est ce qu'exige la spec :
  « un dossier replié est inclus » pour les cases, mais une plage ne traverse pas ce qu'on ne
  voit pas.
- **D4 — Préférences lues, jamais écrites.** Repli et colonnes figées sont des copies locales.
  On a rejeté l'idée de partager les setters de `SystemView`, qui auraient persisté les
  manipulations faites dans le sélecteur (contraire à la spec, critère 3).
- **D5 — Prévisualisation dès l'étape 1.** Elle sert à décider s'il faut afficher « Suivant »
  ou « Ajouter » et à garder le nombre d'instances juste. C'est déjà le comportement actuel (la
  prévisualisation suit la sélection) et la requête est mise en cache par lot d'ids. Rejeté :
  calculer à l'entrée de l'étape 2, ce qui provoquerait un aller-retour visible et un libellé
  de bouton instable.
- **D6 — `Échap` dans le popover de filtre colonne** appelle `e.stopPropagation()` et
  `e.nativeEvent.stopImmediatePropagation()`. Sans cela, l'écouteur `window` de
  `useModalHotkeys` fermerait la modale (spec §2.5). Dans la vue système, il n'y a aucun
  écouteur `window` concurrent : le comportement est inchangé.
- **D7 — Tests absents de l'arbre** (créés hors de l'UI) : ils sont ajoutés en fin de racine
  plutôt qu'ignorés, pour qu'aucun test proposé ne soit inatteignable. La vue système ne les
  montre pas : cet écart est assumé et documenté dans la mise à jour de SPEC.
- **D8 — Pas de virtualisation supplémentaire.** `ExcelView` rend déjà par lots
  (`INITIAL_RENDERED_ROWS`). Les ensembles calculés sont en O(n) par rendu.

## Découpage en sprints

**Sprint 1** — cœur et ajout à une campagne existante :
- `lib/gridSelection.ts` ;
- `ExcelView` en mode `selection`, plus le correctif D6 ;
- `TestPickerGrid` et `TestPickerModal` (modes `add` et `create` implémentés, seul `add`
  branché) ;
- `getTestTypeRefs`, `defaultVisibleFields`, `readExcelRowMaxLines` ;
- intégration dans `campaign.$campaignId.tsx` et i18n.

Validation humaine : scénarios N, S, F et A de `GH33-tests.md` dans une campagne existante.

**Sprint 2** — création et clôture :
- intégration dans `campaign.new.tsx` (bouton, récapitulatif, préremplissage T46) ;
- nettoyage des clés i18n inutilisées ;
- mises à jour SPEC (`SPEC-TESTS` §4.2, `SPEC-SYSTEM-VIEW` §Vue Excel / §Filtre par colonne) et
  `SPEC-INDEX`.

Validation humaine : scénarios C et L de `GH33-tests.md`, puis non-régression de la vue
système (R).
