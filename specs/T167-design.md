# T167 — Design technique

Réf. : `specs/T167.md`. Cible : `apps/desktop` (renderer uniquement — aucun
changement main/IPC).

## 1. Vue d'ensemble

Trois briques :

1. **`lib/searchQuery.ts`** (nouveau) — extraction des utilitaires purs de
   recherche/remplacement aujourd'hui privés de `SearchPanel.tsx`.
2. **`contexts/SearchContext.tsx`** (nouveau) — `SearchProvider` monté dans
   `AppLayout`, porte l'état de recherche partagé (requête, options, filtres,
   résultats calculés, cible « goto », élément en édition) + les mutations de
   remplacement. `SearchPanel` et la route `/search` le consomment.
3. **Zone principale `/search`** — `routes/search.tsx` devient un aiguilleur :
   - état vide (actuel) si pas de résultat ;
   - **`SearchResultsDoc`** (nouveau) — liste de cartes lecture seule style Vue
     Word, si résultats ;
   - **`SearchEditPane`** (nouveau, sprint 2) — `EditView` câblé, si un élément
     est en cours d'édition.

Aucune modification de `WordView.tsx` / `SystemView.tsx` (on réutilise des
sous-composants et des helpers, pas le conteneur).

## 2. `lib/searchQuery.ts` — extraction (sprint 1)

Déplacer tel quel depuis `SearchPanel.tsx` (aucun changement de logique) :

```ts
export interface SearchOpts { caseSensitive: boolean; wholeWord: boolean; isRegex: boolean; preserveCase: boolean }
export interface SearchTypes { requirements: boolean; tests: boolean; campaigns: boolean }
export type ItemType = 'requirement' | 'test' | 'campaign'
export interface MatchedField { key: string; excerpt: string; matchStart: number; matchLength: number }
export interface SearchResult { itemType: ItemType; id: string; title: string; matches: MatchedField[] }

export function escapeRegex(s: string): string
export function buildRegex(query: string, opts: SearchOpts): RegExp | null
export function applyPreserveCase(original: string, replacement: string): string
export function replaceInText(text: string, regex: RegExp, replacement: string, preserveCase: boolean): string
export function getStringFields(fields: Record<string, unknown>): Array<{ key: string; value: string }>
export function findMatches(fields: Array<{ key: string; value: string }>, regex: RegExp): MatchedField[]
```

`SearchPanel.tsx` importe désormais ces symboles. Les composants `ToggleBtn`,
`ExcerptView`, `ResultItem` restent dans `SearchPanel.tsx` (spécifiques au
panneau). `ExcerptView` pourra être réexporté si `SearchResultsDoc` veut le même
rendu d'extrait (optionnel).

## 3. `contexts/SearchContext.tsx` — `SearchProvider` (sprint 1)

### 3.1 Montage

Dans `AppLayout.tsx`, brancher `<SearchProvider>` dans la branche
`currentProjectId` (celle qui renvoie le JSX avec tous les providers), au même
niveau que `SystemViewProvider` :

```
<VersioningProvider>
  <SelectedRepoProvider key={currentProjectId}>
    <CompareRefsProvider>
      <ImpactAnalysisProvider>
        <SystemViewProvider currentProjectId={currentProjectId}>
          <SearchProvider currentProjectId={currentProjectId}>
            {inner}
          </SearchProvider>
        </SystemViewProvider>
      ...
```

`inner` contient à la fois la `Sidebar` (donc `SearchPanel`) et l'`<Outlet/>`
(donc la route `/search`) → les deux consomment le même contexte.

Conséquence assumée (cf. spec §5) : l'état de recherche survit à la navigation
hors `/search` et au retour, tant que le projet reste ouvert. `key` sur
`SelectedRepoProvider` force déjà un remount au changement de projet ; ajouter
`key={currentProjectId}` sur `SearchProvider` pour repartir d'une recherche
vierge au changement de projet.

### 3.2 État porté

Repris **à l'identique** de `SearchPanel` (mêmes `useState`, mêmes valeurs par
défaut) :

- `query`, `setQuery`
- `replaceQuery`, `setReplaceQuery`
- `showReplace`, `setShowReplace`
- `opts: SearchOpts`, `setOpts`
- `types: SearchTypes`, `setTypes`
- `replacing`, `replaceError`

Dérivés (repris de `SearchPanel`) :

- `repoPath` — via `useQuery(['workspace', currentProjectId])` →
  `project.localPath` (identique à aujourd'hui).
- `regex = useMemo(buildRegex(query, opts))`, `regexInvalid`.
- Les 3 `useQuery` `['requirements'|'tests'|'campaigns', repoPath]` avec
  `enabled: !!repoPath && types.X && !!regex` — **inchangé** : aucun fetch tant
  qu'aucune recherche saisie (critère d'acceptation #10).
- `results: SearchResult[]` — `useMemo` identique à l'actuel `results` de
  `SearchPanel`.
- `totalMatches`.

Nouveau (goto) :

- `gotoTarget: { id: string | null; seq: number }` — même pattern que
  `SystemViewContext` (lignes 491-496).
- `setGoto(id: string | null)` → `seq + 1`.
- `clearGoto()`.

Nouveau (édition — sprint 2, mais le champ d'état est introduit en sprint 1
inerte) :

- `editing: { id: string; itemType: 'requirement' | 'test' } | null`
- `openEditor(r: SearchResult)`, `closeEditor()`
- Ouvrir l'éditeur **efface** la cible goto (`clearGoto`) et vice-versa
  (cohérent avec `SystemView` : entrer en Édition ⇒ `clearGoto()`).

### 3.3 Mutations de remplacement

Déplacer `replaceInItem`, `handleReplaceOne`, `handleReplaceAll` dans le
provider (elles ont besoin de `results`, `regex`, `repoPath`, `queryClient`).
Exposées telles quelles ; seul `SearchPanel` les appelle.

### 3.4 API du contexte

```ts
interface SearchContextValue {
  // état recherche
  query: string; setQuery: (v: string) => void
  replaceQuery: string; setReplaceQuery: (v: string) => void
  showReplace: boolean; setShowReplace: (v: boolean) => void
  opts: SearchOpts; setOpts: React.Dispatch<React.SetStateAction<SearchOpts>>
  types: SearchTypes; setTypes: React.Dispatch<React.SetStateAction<SearchTypes>>
  // dérivés
  repoPath: string
  regex: RegExp | null
  regexInvalid: boolean
  results: SearchResult[]
  totalMatches: number
  requirements: Requirement[]; tests: TestCase[]; campaigns: TestCampaign[]
  // remplacement
  replacing: boolean; replaceError: string | null
  handleReplaceOne: (r: SearchResult) => Promise<void>
  handleReplaceAll: () => Promise<void>
  // goto
  gotoId: string | null; gotoSeq: number
  setGoto: (id: string | null) => void
  clearGoto: () => void
  // édition inline (sprint 2)
  editing: { id: string; itemType: 'requirement' | 'test' } | null
  openEditor: (r: SearchResult) => void
  closeEditor: () => void
}
```

`useSearch()` — hook d'accès, throw hors provider (même pattern que
`useSystemView`).

## 4. `SearchPanel.tsx` — refactor consommateur (sprint 1)

Suppression de tous les `useState`/`useQuery`/`useMemo` listés §3.2, remplacés
par `const { ... } = useSearch()`. Le JSX du header (champ, `ToggleBtn`,
remplacement, filtres de type, ligne de statut) est **inchangé** — seules les
sources des valeurs/callbacks changent.

Changements de comportement :

- `navigateTo(result)` (qui faisait `navigate({ to: '/req/$reqId' … })`) est
  **supprimé**. `ResultItem.onNavigate` devient `() => setGoto(result.id)`.
- Nouveau `onOpen(result)` sur `ResultItem` :
  - `itemType === 'campaign'` → `navigate({ to: '/campaign/$campaignId', params, search })`
    (comportement d'ouverture campagne, cf. spec §3) ;
  - sinon → `openEditor(result)` (sprint 2 ; sprint 1 : temporairement
    `navigate` vers `/req|/test` comme avant, voir §8).
- `ResultItem` : `onClick` du bouton titre → `onNavigate` (= goto) ;
  `onDoubleClick` sur la ligne d'en-tête → `onOpen`.
  - Attention `<button>` imbriqués : la ligne d'en-tête actuelle est un
    `<button onClick={onNavigate}>`. Ajouter `onDoubleClick` sur ce même
    élément fonctionne. Garder le `onClick` d'expansion du chevron distinct
    (`stopPropagation`).

`SearchPanel` garde ses props `{ currentProjectId, projectId }` (projectId sert
encore à `navigate` pour le cas campagne).

## 5. `SearchResultsDoc.tsx` — liste lecture seule (sprint 1)

Nouveau composant sous `components/search/`.

### 5.1 Props

```ts
interface Props {
  repoPath: string
  results: SearchResult[]
  requirements: Requirement[]
  tests: TestCase[]
  campaigns: TestCampaign[]
  regex: RegExp | null            // pour la surbrillance
  gotoId: string | null
  gotoSeq: number
  onGoto: (id: string) => void
  onOpen: (r: SearchResult) => void
}
```

### 5.2 Rendu

- Conteneur `ref` + `useScrollToNode(containerRef, gotoId, gotoSeq)` (hook
  existant, réutilisé tel quel).
- `.map(results)` → une `<ResultCard>` par résultat, dans l'ordre de `results`
  (déjà : exigences, tests, campagnes).
- Résolution de l'objet complet : `requirements.find(r => r.id === res.id)` etc.
- Résolution du `typeDef` : `useProjectSchema(repoPath)` +
  `getReqTypeDef` / `getTestTypeDef` / `getCampaignTypeDef` selon `itemType`.
- `ResultCard` reprend la structure de `WordView.ItemCard` **en lecture seule**,
  extraite en un rendu autonome (pas d'import de `ItemCard`, qui est interne à
  `WordView.tsx` et couplé aux callbacks d'édition). Éléments repris :
  - `data-node-id={res.id}` sur la carte (pour `useScrollToNode`) ;
  - contour goto quand `gotoId === res.id` : réutiliser le style « anneau » de
    la Vue Word (`ring-2 ring-inset ring-status-info-solid rounded`). NB :
    `WordView.tsx` et `ExcelView.tsx` définissent **chacun** leur propre
    `GOTO_OUTLINE_CLASS` (styles différents — `ring` vs `outline`). Extraction
    dans un module partagé = **optionnelle** (nice-to-have) ; sinon `SearchResultsDoc`
    déclare sa propre constante alignée sur celle de `WordView` (comme
    `ExcelView` fait déjà la sienne). Ne pas modifier le style existant des
    deux vues.
  - en-tête : badge catégorie (`CATEGORY_CHART_BG[category]`, libellé
    `EX`/`TC`/`CA`), `id` mono, titre, badge statut, `v{version}`. Le mapping
    statut→classe (`getStatusClass`, privé à `WordView.tsx`) est court (~6
    lignes) : le dupliquer dans un helper `components/search/` ou l'extraire
    dans un module partagé — au choix du Dev, sans changer `WordView`.
  - corps : pour chaque champ du `typeDef` (ordre `typeDef.fields`), + repli sur
    les clés de `fields` brutes si `typeDef` absent :
    - `richtext` → `<StaticRichTextViewer value={v} repoPath={repoPath}
      highlightRegex={regex ?? undefined} />` (voir §5.3) ;
    - autres → `<HighlightedText value={v} regex={regex} />` (span simple).
  - `onClick={() => onGoto(res.id)}` sur la carte (hors zones interactives) ;
    `onDoubleClick={() => onOpen(res)}`.
  - clic sur le fond du conteneur (hors carte) → `onGoto` avec `null`? — non :
    `setGoto(null)` via un handler `onClickEmpty` passé en prop, ou géré dans la
    route. Simplest : `onContainerClick` si `e.target === containerRef.current`
    → `onGoto('')` interprété comme clear. Décision : ajouter
    `onClearGoto: () => void` en prop.
- Test : afficher la table des étapes en lecture seule
  (`<StepsTable steps={…} disabled />` — `StepsTable` supporte déjà
  `disabled`).
- Campagne : en-tête + champs `fields` string uniquement (pas de `typeDef`
  requis), pas d'étapes.

### 5.3 Surbrillance des occurrences

- Champs simples : `HighlightedText` — découpe `value` sur `regex` (clone avec
  `flags` frais, `g`), alterne `<span>` / `<mark class="bg-status-warning-solid/70
  rounded-sm px-px">`.
- Champs `richtext` : ajouter une prop optionnelle
  `highlightRegex?: RegExp` à `StaticRichTextViewer`. Nouvel `useEffect`
  (après le rendu `html`, comme les effets image/drawio) qui parcourt les nœuds
  texte du conteneur (`TreeWalker`, `NodeFilter.SHOW_TEXT`, en ignorant ceux
  sous `pre`, `code`, `.static-drawio`) et remplace chaque nœud contenant une
  correspondance par un fragment `text/<mark>/text`. Best effort : sur
  structure complexe (tableaux…) le champ reste lisible même si une occurrence
  n'est pas surlignée (cf. spec Hors scope). Sans `highlightRegex` : effet
  inerte, zéro régression pour la Vue Word.

## 6. `SearchEditPane.tsx` — édition inline (sprint 2)

Nouveau composant sous `components/search/`. Câble `EditView` **sans** la
machinerie arbre/undo/DnD de `SystemView`. Monté par `routes/search.tsx` quand
`editing != null`.

### 6.1 Données

- `editing = { id, itemType }` depuis le contexte.
- `category = itemType`.
- `useQuery(['object', repoPath, category, id])` → `api.requirements.get` /
  `api.tests.get` (même clé de cache que `SystemView` → réutilisation du cache
  si l'objet a déjà été chargé ailleurs).
- `objectData: Record<string,string>` — via `normalizeObject` (déjà partagé) ou
  la même dérivation que `SystemView.objectData` (inclut `title`).
- `typeDef` via `useProjectSchema` + `getReqTypeDef`/`getTestTypeDef`.
- `linkTypes` : `schema.linkTypes` (ou l'équivalent utilisé par `SystemView` —
  `useSystemView().linkTypes` n'est pas accessible ici ; lire depuis le schéma
  du repo). Vérifier la source exacte en Design/Dev (`ProjectSchema.linkTypes`).
- `candidateObjects` : `api.requirements.list` + `api.tests.list` (déjà chargées
  par le contexte de recherche → réutiliser `requirements`/`tests` du contexte,
  + `refToCategory` dérivé du schéma comme `SystemView`).
- `linksByObjectId` : `api.requirements.linksAll(repoPath)` → `Map` (copie de la
  dérivation `SystemView`).
- `coverageByReqId` : `api.traceability.matrix(repoPath)` — `enabled` seulement
  si `category === 'requirement'`.
- `testsById` : `Map` depuis `tests`.
- Étapes (test) : dérivées de l'objet chargé (`tc.steps` triées), état local +
  autosave debouncé 800 ms → `api.tests.update(..., { steps })` (copie de
  `SystemView.handleWordViewStepsChange` / bloc étapes d'édition).

### 6.2 Handlers passés à `EditView`

Reprendre, en version allégée (pas d'opérations d'arbre), depuis `SystemView` :

- `onBlurField(field, value)` :
  - `field === 'name'` → `api.<cat>.update(repoPath, id, { title: value })`
    (dans `SystemView` ça renomme le nœud d'arbre ; ici, pas d'arbre → simple
    update `title`), puis invalider `['object', …]` + `results` (via
    `queryClient.invalidateQueries(['requirements'|'tests', repoPath])`).
  - `field === 'status'` → `api.requirements.transition` / `api.tests.update({
    status })`.
  - sinon → `api.<cat>.update(repoPath, id, { fields: { [field]: value } })`.
  - debounce par `objectId:field` (copie du `inlineEditTimers` de `SystemView`).
- `onFlushValues(values, target?)` — copie de `SystemView.handleFlushEditValues`
  **branche "objet existant" uniquement** (jamais de création en Vue
  Recherche ; `editing.id` désigne toujours un objet réel). Retourne `boolean`
  (contrat T159 conservé : `EditView` retente sur échec).
- `onLinkChange` → invalider `['links-all', repoPath]` + `['traceability-matrix',
  repoPath]`.
- `onReopenDraft` → `api.requirements.openDraft` / `api.tests.openDraft`.
- `onNavigateToObject(peerId, opts)` → **toujours** `openTab('/req/'|'/test/' +
  peerId, { repoPath, projectId })` (pas de nav en place — cf. spec §3). `opts.newTab`
  ignoré (déjà un onglet).
- `onBack` → `closeEditor()` du contexte (réaffiche `SearchResultsDoc`).

### 6.3 Props `EditView`

- `nodeId = editing.id` (synthétique — `EditView` exige `nodeId` non-null pour
  rendre ; sa seule autre utilisation est `getValue('section')` et la clé
  `React.Fragment key={nodeId}`, sans effet ici).
- `nodeName = objectData.title` (alimente le champ « Nom »).
- `visibleFields = ['name', 'id', 'status', ...typeDef.fields.map(f => f.name)]`
  — **sans `section`** (pas de numérotation en Vue Recherche).
- `sectionNumbers` : non fourni (pas de `section` dans `visibleFields`).
- `readOnly` : `useVersioning().isReadonly` (repo root figé sur baseline ⇒
  `branch === ''`). `SystemView.readOnly` combine en plus `effectiveNode.readonly`
  (drapeau par nœud) et le cas repo-dépendance détaché — non pertinents ici
  (Recherche = repo root). Un nœud local marqué `readonly: true` dont un élément
  apparaît dans les résultats resterait éditable via cette voie : écart mineur
  connu, à documenter (`T167-sprint2.md`) — repli possible : masquer le
  double-clic d'édition si `getReqTypeDef`/`getTestTypeDef` remonte un nœud
  `readonly`. Critère #14 couvert pour le cas baseline.
- `coverageByReqId`, `testsById`, `linkTypes`, `objectLinks`,
  `candidateObjects`, `repoPath` : cf. §6.1.
- `children` : bloc `StepsTable` si test (copie du JSX `SystemView`
  `isEditingTestCase`).
- `ref` : `EditViewHandle` pour le bouton retour du `ViewHeader`.

### 6.4 En-tête

`routes/search.tsx` rend un `<ViewHeader>` :

- mode liste : `title = t('sidebar.search.title')` (« Recherche »), pas de back.
- mode édition : `title = <libellé type> <id mono>`, `back = { onClick: () =>
  editViewRef.current?.triggerBack() }` (même séquence flush-then-back que
  `SystemView`).
- `actions` en mode édition : `<RichTextToolbar repoPath={repoPath} />` (la
  toolbar contextuelle des champs richtext). Nécessite d'envelopper le contenu
  de `SearchEditPane` dans `<RichTextProvider>` (comme `SystemView`).

## 7. `routes/search.tsx` — aiguilleur (sprints 1 & 2)

```tsx
function SearchPage() {
  const { editing, results, /* … */ } = useSearch()
  // header + switch :
  //   editing        → <RichTextProvider><SearchEditPane …/></RichTextProvider>   (sprint 2)
  //   results.length → <SearchResultsDoc …/>                                       (sprint 1)
  //   sinon          → état vide actuel (icône + message)
}
```

`validateSearch` inchangé (`projectId`). La route lit tout le reste du contexte.
`ViewHeader` ajouté (aujourd'hui la page n'en a pas) — cohérent avec les autres
vues principales.

Cas « aucun résultat » (regex valide, 0 match) : message dédié
(`t('common.noResults')`) au lieu de l'invite générique — critère #15.

## 8. Découpage sprints

### Sprint 1 — infrastructure + liste lecture seule + goto

- `lib/searchQuery.ts` (extraction).
- `lib/gotoOutline.ts` + `components/system/statusBadge.ts` (extraction de
  `GOTO_OUTLINE_CLASS` / `getStatusClass` depuis `WordView.tsx`, réimport côté
  `WordView`).
- `contexts/SearchContext.tsx` + montage dans `AppLayout.tsx`.
- Refactor `SearchPanel.tsx` → consommateur. Clic simple = `setGoto`.
- `StaticRichTextViewer` : prop optionnelle `highlightRegex` + effet TreeWalker.
- `components/search/SearchResultsDoc.tsx` + `ResultCard` + `HighlightedText`.
- `routes/search.tsx` : header + aiguillage liste / vide.
- **Double-clic** (transitoire) : conserve l'ouverture des pages détail
  `/req/$id` / `/test/$id` / `/campaign/$id` (navigation, comme le clic simple
  faisait avant T167) — aucune régression fonctionnelle, l'édition inline arrive
  au sprint 2. Documenté dans `T167-sprint1.md`.

Critères couverts : #1, #2, #3, #9, #10 + #4/#5 (goto).

### Sprint 2 — édition inline

- `components/search/SearchEditPane.tsx` (câblage `EditView`).
- Contexte : `editing` / `openEditor` / `closeEditor` activés.
- `SearchPanel` + `SearchResultsDoc` : double-clic → `openEditor` (req/test),
  `navigate('/campaign/$id')` (campagne).
- `routes/search.tsx` : branche édition + `ViewHeader` back + `RichTextProvider`
  + `RichTextToolbar`.
- `readOnly` via `useVersioning`.
- **Doc** : nouvelle section `SPEC-ELECTRON-DESKTOP.md` §Vue Recherche (panneau
  + zone principale + goto + édition inline + partage d'état) ; MAJ
  `SPEC-INDEX.md` (nouvelle ligne + `MAJ = T167` sur les lignes touchées :
  `SPEC-SYSTEM-VIEW` §goto si on y ajoute une mention transverse).

Critères couverts : #4 (pas de nav), #6, #7, #8, #11, #12, #13, #14, #15.

## 9. Impacts fichiers

| Fichier | Sprint | Nature |
|---|---|---|
| `apps/desktop/src/renderer/lib/searchQuery.ts` | 1 | **nouveau** (extraction) |
| `.../lib/gotoOutline.ts` + `.../components/system/statusBadge.ts` | 1 | **optionnels** — extraction constante/helper ; sinon dupliqués dans `components/search/` |
| `apps/desktop/src/renderer/components/system/WordView.tsx` | 1 | imports seulement **si** extraction — sinon **non touché** |
| `apps/desktop/src/renderer/contexts/SearchContext.tsx` | 1 | **nouveau** |
| `apps/desktop/src/renderer/components/layout/AppLayout.tsx` | 1 | montage `SearchProvider` |
| `apps/desktop/src/renderer/components/sidebar/SearchPanel.tsx` | 1 | refactor consommateur + clic = goto |
| `apps/desktop/src/renderer/lib/staticRichText.tsx` | 1 | prop `highlightRegex` + effet |
| `apps/desktop/src/renderer/components/search/SearchResultsDoc.tsx` | 1 | **nouveau** |
| `apps/desktop/src/renderer/routes/search.tsx` | 1 & 2 | aiguilleur + header |
| `apps/desktop/src/renderer/components/search/SearchEditPane.tsx` | 2 | **nouveau** |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | 1 & 2 | clés `search.*` (cartes, header, retour, aucun résultat) |
| `specs/SPEC-ELECTRON-DESKTOP.md`, `specs/SPEC-INDEX.md` | 2 | section Vue Recherche |

## 10. Décisions & alternatives rejetées

- **Réutiliser `WordView` directement pour la liste** — rejeté : `WordView`
  exige `root: TypeTreeNode[]` + un `typeDef` unique + gère dossiers/sections/
  liens/DnD/goto internes. Une liste plate multi-types demanderait de fabriquer
  un faux arbre et un faux type commun. `ResultCard` autonome (≈120 lignes) est
  plus simple et découplé.
- **Extraire `ItemCard` de `WordView` dans un composant partagé** — rejeté pour
  ce ticket : `ItemCard` est fortement couplé aux callbacks d'édition inline
  (liens, multi-enum, statut éditable, steps). Un refactor propre dépasse le
  périmètre ; on ne partage que les petits helpers purs (`GOTO_OUTLINE_CLASS`,
  `getStatusClass`).
- **Extraire toute la logique d'édition de `SystemView` dans un hook
  `useObjectEditor` réutilisé des deux côtés** — rejeté : gros refactor de
  `SystemView` (risque de régression sur Exigences/Tests, hors ticket).
  `SearchEditPane` duplique ~150 lignes de handlers, sans les opérations
  d'arbre/undo/DnD/création. Dette acceptée et notée (candidat à un futur
  ticket de mutualisation).
- **State de recherche laissé dans `SearchPanel`, remonté via un store léger
  (zustand)** — rejeté : le projet n'utilise pas zustand côté desktop (cf.
  `SPEC-TECH-stack` §2, contextes React partout). Un Context est cohérent.
- **Route dédiée `/search/edit/$id` pour l'édition** — rejeté : la spec impose
  « sans quitter la Vue Recherche » et un simple état de contexte suffit ;
  une sous-route ajouterait du bruit d'historique et compliquerait le retour.
- **Double-clic ouvre un nouvel onglet `/req/$id`** (au lieu de l'inline) —
  écarté : la spec (Q validée) demande l'édition inline via `EditView` complet.
  Le nouvel onglet reste le comportement pour les **objets liés** depuis
  `EditView`.
