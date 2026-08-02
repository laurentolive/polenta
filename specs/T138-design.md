# T138 — Design

> Lit `specs/T138.md`. Ticket : afficher `coverageStatus` comme nouveau champ système,
> activable/désactivable dans les 3 vues (Document/Tableau/Édition) via le panneau ⚙️ de
> configuration des champs visibles déjà existant.

## Vue d'ensemble des changements

Trois couches à toucher :

1. **Récupération de la donnée** — un seul appel, ajouté dans `SystemView.tsx`, réutilisant un
   endpoint déjà en place mais aujourd'hui orphelin côté renderer.
2. **Champ système** — enregistrer `coverageStatus` partout où les autres champs système
   (`section`, `id`, `status`…) sont déclarés, pour qu'il apparaisse dans le panneau ⚙️.
3. **Rendu** — un badge/icône non éditable, placé différemment selon la nature de chaque vue
   (voir décisions ci-dessous), plus un composant `CoverageBadge` partagé par les 3.

---

## 1. Récupération de la donnée — aucune nouvelle route IPC

`ipcMain.handle('traceability:matrix', ...)` existe déjà (`apps/desktop/src/main/ipc/index.ts:277-278`)
et délègue à `TraceabilityService.getMatrix()`, qui calcule déjà `coverageStatus` par exigence via
`computeCoverage()`/`computeCoverageStatus()` (`traceability.service.ts:112-214`). Cet endpoint
n'est aujourd'hui appelé par **aucune** page renderer (seul `api.traceability.testPlan` est utilisé,
depuis `impact-analysis.tsx`).

`api` (`apps/desktop/src/renderer/api.ts`) est un client IPC générique (`createIpcClient()` de
`@polenta/api-client`) qui mappe `api.<domaine>.<méthode>(...)` → `ipcRenderer.invoke('<domaine>:<méthode>', ...)`
sans déclaration explicite par domaine — **`api.traceability.matrix(repoPath, {}, workspaceDir)` est
donc déjà appelable tel quel, aucune modification de `api.ts`, du preload ou de l'IPC handler
n'est nécessaire.**

### Changement dans `SystemView.tsx`

Ajouter, à côté des `useQuery`/`useMemo` existants qui construisent `linksByObjectId` (l. 615+) :

```ts
const { data: matrix } = useQuery({
  queryKey: ['traceability-matrix', repoPath, workspaceDir],
  queryFn: () => api.traceability.matrix(repoPath, {}, workspaceDir),
  enabled: !!repoPath && visibleFieldsExcel.includes('coverageStatus')
    || visibleFieldsWord.includes('coverageStatus')
    || visibleFieldsEdit.includes('coverageStatus'),
})

const coverageByReqId = useMemo(() => {
  const map = new Map<string, { coverageStatus: CoverageStatus; cells: MatrixCell[] }>()
  for (const row of matrix?.requirements ?? []) {
    map.set(row.requirement.id, { coverageStatus: row.coverageStatus, cells: row.cells })
  }
  return map
}, [matrix])
```

- `enabled: ...` évite l'appel réseau/IPC (et le calcul `getMatrix` côté main, qui relit tous les
  repos du workspace) tant qu'aucune des 3 vues n'a le champ coché — cohérent avec l'esprit
  "désactivé par défaut, coût nul" du ticket.
- `coverageByReqId` est passé en prop aux 3 vues (`coverageByReqId={coverageByReqId}`), à côté de
  `linksByObjectId` déjà transmis aujourd'hui (`SystemView.tsx:1171, 1199, 1230`).
- Pour retrouver le titre/statut d'exécution de chaque test lié dans le tooltip, `cells[].testCaseId`
  se résout contre `allTests` (déjà chargé dans `SystemView.tsx`, l. ~500-620) — pas de nouvelle
  requête.

**Alternative rejetée** : ajouter une méthode dédiée et plus légère côté `TraceabilityService` (ex.
`getCoverageMap()` ne retournant que `Map<reqId, CoverageStatus>` sans recharger `requirements`/
`testCases` en double). Rejetée pour ce ticket : `getMatrix()` fait déjà exactement le calcul voulu,
est déjà exposée, déjà testée en théorie par son usage prévu (matrice de traçabilité) — dupliquer une
variante plus étroite maintenant, avant qu'un vrai besoin de perf soit mesuré, irait à l'encontre de
"pas d'abstraction prématurée". À reconsidérer si `getMatrix()` s'avère trop lourd en pratique (gros
repo/workspace) une fois mesuré.

---

## 2. Déclarer `coverageStatus` comme champ système

Quatre listes dupliquées existent aujourd'hui pour "quels champs sont des champs système" (pas de
module partagé — cohérent avec le fait que `status`/`name`/`section` ont chacun un traitement
légèrement différent d'une vue à l'autre) :

| Fichier | Ligne | Rôle |
|---|---|---|
| `SystemView.tsx` | `104` `const systemFields = [...]` | liste affichée dans le panneau ⚙️ (labels l. 99) |
| `SystemView.tsx` | `570-572` `visibleFieldsExcel/Word/Edit` (état par défaut) | **ne pas** y ajouter `coverageStatus` — désactivé par défaut |
| `WordView.tsx` | `76` `isSystemField()` | affichage du tag "(sys)" dans le panneau |
| `ExcelView.tsx` | `69` `isSystemField()` | idem |
| `EditView.tsx` | `14` `SYSTEM_FIELDS` | détermine si un `visibleFields` coché est un champ système (l. 439-441) |

Ajouter `'coverageStatus'` :
- à `systemFields` (`SystemView.tsx:104`) + libellé i18n `system.fieldConfig.colCoverage` (nouvelle
  clé `fr.json`/`en.json`, à côté de `colStatus`) ;
- à `isSystemField()` dans `WordView.tsx` et `ExcelView.tsx` ;
- **pas** à `EditView.tsx`'s `SYSTEM_FIELDS` — voir §3.3, traitement différent dans cette vue.

**Alternative rejetée** : factoriser les 4 listes dupliquées en un seul module partagé
(`system/systemFields.ts`) à l'occasion de ce ticket. Rejetée — refactor transverse hors du périmètre
d'un ticket qui ajoute un champ ; le faire ici mélangerait la revue fonctionnelle et un renommage
mécanique sur 3 fichiers. Signalé comme dette si un futur ticket ajoute encore un champ système.

---

## 3. Rendu

### 3.1 Composant partagé `CoverageBadge`

Nouveau fichier `apps/desktop/src/renderer/components/system/CoverageBadge.tsx` :

```ts
interface CoverageBadgeProps {
  coverage: { coverageStatus: CoverageStatus; cells: MatrixCell[] } | undefined
  testsById: Map<string, TestCase>
}
```

- Icône + couleur par statut, réutilisant la palette déjà en place dans `ComplianceMatrix.tsx`
  (`CheckCircle2`/`AlertCircle`/`XCircle` de `lucide-react`, classes `text-status-success`/
  `-warning`/`-danger`) :
  - `validated` → `CheckCircle2`, `text-status-success`
  - `needs_revalidation` → `AlertTriangle` (ou `AlertCircle`, à trancher visuellement en dev — les
    deux existent déjà dans `lucide-react` et sont utilisés ailleurs dans le repo), `text-status-warning`
  - `failing` → `XCircle`, `text-status-danger`
  - `covered` → `Circle` rempli à moitié — pas d'équivalent direct ; utiliser `AlertCircle` avec une
    classe neutre (`text-ink-3` ou variante warning atténuée) le temps qu'un design tranche une icône
    dédiée — **ne bloque pas le sprint**, ajustable en pur CSS/icône ensuite.
  - `not_covered` → `Circle` (contour), `text-ink-3` (neutre, pas d'alerte).
- `title`/tooltip natif HTML (`<span title="...">`) listant, ligne par ligne, chaque `cell` résolu
  via `testsById.get(cell.testCaseId)` → `${tc.id} — ${tc.title} (${cell.status})` ; si `cells` est
  vide, tooltip = `t('system.coverage.noLinkedTest')`.
- `coverage === undefined` (exigence absente de `coverageByReqId`, ne devrait pas arriver pour une
  vraie exigence mais couvre les `TestCase`) → ne rend rien (`return null`), satisfait le critère
  "les TestCase n'affichent rien pour ce champ" sans branche supplémentaire côté appelant.

### 3.2 `WordView.tsx` — badge dans l'en-tête de carte

`status`/`version` sont déjà rendus hors de la boucle `fields.map` générique, dans l'en-tête de
`ItemCard` (l. 461-490), et exclus du corps via `fieldsAlreadyInHeader` (l. 435). `coverageStatus`
suit exactement ce chemin plutôt que la boucle de champs génériques :

- Ajouter `'coverageStatus'` à `fieldsAlreadyInHeader` (l. 435).
- Dans le même bloc IIFE que `status`/`version` (l. 461-490), ajouter, seulement si
  `visibleFields.includes('coverageStatus')` et `typeDef?.category === 'requirement'` :
  `<CoverageBadge coverage={coverageByReqId?.get(node.objectId ?? '')} testsById={testsById} />`

### 3.3 `ExcelView.tsx` — colonne dédiée

Contrairement à `WordView`, `ExcelView` traite chaque champ visible comme sa propre colonne (`<td>`
par `col`, cf. le rendu de `version`/`createdAt`/liens). Il n'y a pas ici d'équivalent "en-tête de
carte" où fusionner l'icône sans casser ce modèle en grille — **`coverageStatus` est donc une colonne
à part entière**, au même titre que tout autre champ système cochable (correction du choix initial
envisagé en Spec, qui suggérait de le fusionner dans la cellule ID/titre — cf. `specs/T138.md`
§Hors-scope, paragraphe de correction).

Ajouter, avant le fallback générique `InlineCell` (l. 1350+, comme la branche `col.startsWith('link::')`
juste au-dessus) :

```ts
if (col === 'coverageStatus') {
  return (
    <td key={col} className="border border-edge px-2 py-1 text-center">
      <CoverageBadge coverage={coverageByReqId?.get(node.objectId ?? '')} testsById={testsById} />
    </td>
  )
}
```

Le libellé de colonne (en-tête `<th>`, fonction analogue à `getColumnLabel` de `WordView`) suit le
même ajout de branche `col === 'coverageStatus'` → `t('system.fieldConfig.colCoverage')`.

### 3.4 `EditView.tsx` — badge fixe près du titre, hors du pipeline `FieldRow`

`EditView` n'a pas de zone d'en-tête équivalente à `WordView` : `status` y est traité comme un champ
du formulaire parmi d'autres, via `orderedFields` → `FieldRow`/`FieldControl` (cf. le cas spécial
`name === 'status'` l. 456-460 qui construit un `SchemaField` de type `enum`). `FieldControl` est un
composant partagé (rendu générique par `type` de `SchemaField` : text/enum/richtext/multi_enum…) —
lui apprendre un type synthétique "badge en lecture seule" pour un seul champ non-métier serait une
extension de portée large pour un composant partagé, potentiellement réutilisé ailleurs (cf. note
T126 sur `DynamicField`/`MultiEnumCheckboxes`).

**Décision** : ne pas faire transiter `coverageStatus` par `orderedFields`/`FieldRow`. Le rendre comme
un élément fixe, indépendant du système de rangées de champs, positionné juste après le titre de
l'exigence en cours d'édition (zone où `EditView` affiche déjà nom/ID de l'élément avant la liste des
champs) — gated par `visibleFields.includes('coverageStatus') && typeDef?.category === 'requirement'`,
même garde que dans `WordView`/`ExcelView`.

**Alternative rejetée** : étendre `SchemaField`/`FieldControl` avec un type `'readonly-badge'`
générique. Rejetée pour ce ticket — sur-généralise pour un seul cas d'usage actuel ; à reconsidérer
si un futur champ système en lecture seule (ex. `createdAt` déjà présent mais rendu comme texte
simple, pas comme badge) a besoin du même mécanisme.

**Conséquence sur l'écart `[ABSENT]` "onglet Édition" de `FieldConfigModal`** (`SPEC-AUDIT.md`) :
comme `coverageStatus` ne passe pas par `orderedFields` en Édition, il ne dépend pas de
`visibleFieldsEdit` pour son *rendu* interne — mais on garde la même garde `visibleFields.includes(...)`
que les 2 autres vues pour la cohérence de comportement utilisateur (cocher/décocher dans le panneau
⚙️, quand cet onglet existera). **Tant que l'onglet "Édition" n'existe pas dans `FieldConfigModal`
(écart pré-existant, non comblé par ce ticket)**, `visibleFieldsEdit` reste figé à sa valeur par
défaut (`SystemView.tsx:572`, `['section', 'name', 'id', 'status']`) pour tout utilisateur — donc le
badge de couverture restera **invisible en vue Édition** jusqu'à ce qu'un ticket dédié ajoute cet
onglet, sauf si on l'ajoute directement au tableau par défaut (option 2 de `specs/T138.md`).
→ **Retenu : option 2** — ajouter `'coverageStatus'` à la valeur par défaut de `visibleFieldsEdit`
(`SystemView.tsx:572`), donc **toujours visible en vue Édition**, non désactivable tant que l'écart
`FieldConfigModal` n'est pas comblé (документé comme limitation connue, pas un bug). Choisi plutôt que
l'option 1 (ajouter l'onglet manquant) pour rester dans le périmètre du ticket — combler
`[ABSENT]` "onglet Édition" reste un ticket séparé, plus large que `coverageStatus` seul.

---

## Nouveaux types / interfaces

Aucun nouveau type partagé (`packages/types`) — `CoverageStatus`, `MatrixCell`, `TraceabilityMatrix`
existent déjà et sont réutilisés tels quels. Seule addition : les props `coverageByReqId?: Map<string,
{ coverageStatus: CoverageStatus; cells: MatrixCell[] }>` et `testsById?: Map<string, TestCase>` sur
`WordViewProps`/`ExcelViewProps`/`EditViewProps`, et le composant `CoverageBadge` (local à
`apps/desktop/src/renderer/components/system/`).

## Fichiers modifiés (récapitulatif)

- `apps/desktop/src/renderer/components/system/SystemView.tsx` — query `traceability.matrix`,
  `coverageByReqId`, `systemFields`, libellé panneau ⚙️, défaut `visibleFieldsEdit`, props passées
  aux 3 vues.
- `apps/desktop/src/renderer/components/system/CoverageBadge.tsx` — **nouveau**.
- `apps/desktop/src/renderer/components/system/WordView.tsx` — `isSystemField`, `fieldsAlreadyInHeader`,
  rendu badge en-tête.
- `apps/desktop/src/renderer/components/system/ExcelView.tsx` — `isSystemField`, colonne dédiée,
  libellé d'en-tête de colonne.
- `apps/desktop/src/renderer/components/system/EditView.tsx` — badge fixe près du titre (hors
  `orderedFields`).
- `apps/desktop/src/renderer/i18n/locales/fr.json`, `en.json` — nouvelles clés
  (`system.fieldConfig.colCoverage`, `system.coverage.noLinkedTest`, libellés du tooltip).

## Découpage en sprints

Tient en **un seul sprint** — pas de dépendance externe, périmètre borné à 5 fichiers + 1 nouveau
composant, aucune migration de données, aucun nouveau endpoint IPC.
