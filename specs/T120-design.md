# T120 — Design

## Analyse du code existant

Confirmé par exploration (grep exhaustif sur `repoOptions`/`selectedRepoName`/`handleRepoChange`/
`RepoOption`/`handleNodeChange` dans `apps/desktop/src`) : le rayon d'impact est **strictement
limité à deux fichiers** pour la Vue Système, un troisième pour la Structure.

- `apps/desktop/src/renderer/contexts/SystemViewContext.tsx` :
  - `RepoOption`/`repoOptions` (l.35-41, 207-211) — un par repo du workspace (`flatNodes`), déjà
    calculé sans requête supplémentaire à partir de `schemasByRepoPath` (fourni par
    `useWorkspaceStructure`, l.200-203) qui contient déjà **tous les `SystemNode` de tous les
    repos** (pas seulement `nodes[0]` — la même donnée que `StructureTab` utilise pour rendre
    l'arbre complet). La fusion ne nécessite donc aucune nouvelle requête.
  - `selectedRepoName`/`handleRepoChange` (l.213, 340-350) — sélection du repo, retombe toujours
    sur `nodes[0]` du repo cible.
  - `nodes`/`selectedNodeId`/`effectiveNode`/`handleNodeChange` (l.219, 224, 228-232, 331-338) —
    sélection du `SystemNode` **dans le repo déjà sélectionné**, in-changée par ce ticket dans sa
    logique de résolution (URL `repo`+`node` → `effectiveNode` → `objectTypes`) : seule sa
    construction en tant qu'option de sélection change.
  - `navigateWith` (l.235-253) et la lecture des search params (l.183-188) écrivent/lisent déjà
    `repo`+`node` (ou `component`) indépendamment — **aucun changement de format d'URL requis**.
- `apps/desktop/src/renderer/components/sidebar/SystemPanel.tsx` :
  - Combobox "Composant" (l.309-327) et "Sous-composant" (l.335-353, masqué par
    `nodes.length > 1`, l.338) — les deux `<select>` à fusionner en un seul.
  - `nodes.length === 0` (l.381, état vide "Aucun composant configuré") reste basé sur `nodes`
    (SystemNode du repo sélectionné) — inchangé, indépendant de la fusion des comboboxes.
- `apps/desktop/src/renderer/components/schema/StructureTab.tsx` (l.351-381) — rendu du
  sous-composant local dans `RepoRow`, à aligner visuellement sur `RepoRow` lui-même (l.244-344).

Aucun autre fichier ne référence `repoOptions`/`selectedRepoName`/`handleRepoChange`/`RepoOption`
(recherche exhaustive) — `handleNodeChange` n'est utilisé que par le combobox "Sous-composant"
retiré. `effectiveNodeId`/`effectiveNode`/`nodes` restent utilisés ailleurs (`SystemView.tsx`,
`CampaignListView.tsx`, `product.tsx`, `components.tsx`) mais uniquement en lecture du résultat
résolu — aucun de ces appelants ne change.

## Découpage proposé

### 1. `SystemViewContext.tsx` — type et construction de la liste plate

Nouveau type, remplaçant `RepoOption` dans l'état exposé (le composant/le repo restent
distinguables en interne, seule la présentation change) :

```ts
/** One entry of the merged "Composant" combobox — a (repo, SystemNode) pair, replacing the
 *  former two-level Composant/Sous-composant cascade (T113 → T120). */
export interface ComponentOption {
  /** Mount name of the owning repo (workspace-unique) — combined with nodeId to navigate. */
  repoName: string
  repoPath: string
  /** SystemNode.name within that repo's schema.yaml — 'root' or a local sub-component name. */
  nodeId: string
  /** Display label for this single option. */
  label: string
  /** Set only when the owning repo defines more than one SystemNode — renders as an
   *  <optgroup> label grouping this repo's entries in the combobox. Absent for the common
   *  case (single SystemNode per repo) ⇒ byte-for-byte identical rendering to before T120. */
  groupLabel?: string
}
```

Construction (remplace le calcul de `repoOptions`, l.207-211) :

```ts
const componentOptions: ComponentOption[] = flatNodes.flatMap(n => {
  const repoNodes = schemasByRepoPath.get(n.repoPath)?.nodes ?? []
  if (repoNodes.length <= 1) {
    // Repo pas encore chargé, ou un seul SystemNode : une entrée, label identique à
    // l'actuel repoOptions (aucun changement pour le cas courant).
    const localLabel = repoNodes[0]?.label
    const label = localLabel && localLabel !== n.name ? `${n.name} — ${localLabel}` : n.name
    return [{ repoName: n.name, repoPath: n.repoPath, nodeId: repoNodes[0]?.name ?? 'root', label }]
  }
  // Plusieurs SystemNode locaux (T113) : un groupe par repo, une entrée par node (root inclus),
  // libellée par son propre label.
  return repoNodes.map(node => ({
    repoName: n.name, repoPath: n.repoPath, nodeId: node.name,
    label: node.label || node.name, groupLabel: n.name,
  }))
})

const selectedComponentKey = `${selectedRepoName}::${effectiveNodeId}`

const handleComponentChange = useCallback(
  (repoName: string, nodeId: string) => {
    const targetOption = componentOptions.find(o => o.repoName === repoName && o.nodeId === nodeId)
    const targetSchema = schemasByRepoPath.get(targetOption?.repoPath ?? '')
    const targetNode = targetSchema?.nodes?.find(n => n.name === nodeId)
    const firstType = targetNode?.objectTypes?.[0]?.name
    navigateWith(repoName, nodeId, firstType)
  },
  [componentOptions, schemasByRepoPath, navigateWith],
)
```

`selectedRepoName` reste une variable interne du provider (déjà nécessaire à `navigateWith`,
`handleTypeChange`, `isNonRootRepo`, etc.) — seul son exposition directe dans `SystemViewState`
disparaît, remplacée par `selectedComponentKey`.

`SystemViewState` : retirer `repoOptions`, `selectedRepoName`, `handleRepoChange`,
`handleNodeChange` ; ajouter `componentOptions`, `selectedComponentKey`, `handleComponentChange`.
Tout le reste (`nodes`, `selectedNodeId`, `effectiveNode`, `effectiveNodeId`, `objectTypes`,
`effectiveType`, `effectiveTypeId`, `handleTypeChange`, `navigateTo`, `isRepoReadonly`,
`repoPath`…) est inchangé — la résolution URL → repo → schéma → node → types garde exactement sa
logique actuelle, seule sa présentation en options de combobox change.

### 2. `SystemPanel.tsx` — un seul combobox

Remplace les deux blocs (l.309-353) par un seul, avec un petit helper de rendu d'options
groupées (les entrées d'un même repo sont déjà contiguës dans `componentOptions`, `flatMap`
préservant l'ordre de `flatNodes` — un simple passage séquentiel suffit, pas de tri requis) :

```tsx
function renderComponentOptions(options: ComponentOption[]) {
  const elements: React.ReactNode[] = []
  let i = 0
  while (i < options.length) {
    const opt = options[i]
    if (!opt.groupLabel) {
      elements.push(<option key={`${opt.repoName}::${opt.nodeId}`} value={`${opt.repoName}::${opt.nodeId}`}>{opt.label}</option>)
      i++
      continue
    }
    const groupEnd = options.findIndex((o, j) => j >= i && o.groupLabel !== opt.groupLabel)
    const groupItems = options.slice(i, groupEnd === -1 ? options.length : groupEnd)
    elements.push(
      <optgroup key={opt.groupLabel} label={opt.groupLabel}>
        {groupItems.map(o => (
          <option key={`${o.repoName}::${o.nodeId}`} value={`${o.repoName}::${o.nodeId}`}>{o.label}</option>
        ))}
      </optgroup>,
    )
    i = groupEnd === -1 ? options.length : groupEnd
  }
  return elements
}
```

```tsx
{/* ── Combobox Composant (fusion Composant/Sous-composant — T120) ── */}
<div className="flex items-center gap-2 px-3 py-2 border-b border-edge shrink-0">
  <label className="text-xs text-ink-3 shrink-0">Composant</label>
  <select
    value={selectedComponentKey}
    onChange={e => {
      const [repoName, nodeId] = e.target.value.split('::')
      handleComponentChange(repoName, nodeId)
    }}
    className="input-field flex-1 text-xs py-1"
  >
    {componentOptions.length === 0 ? (
      <option value="">Aucun composant configuré</option>
    ) : (
      renderComponentOptions(componentOptions)
    )}
  </select>
</div>
```

Le bloc "Sous-composant" (ancien l.335-353) est supprimé intégralement, ainsi que son
commentaire. `isRepoReadonly` (bandeau, l.329-333) reste inchangé — il dépend de `repoPath`, pas
du combobox. `nodes.length === 0` (état vide "Aucun composant configuré", l.381) reste tel quel.

**Risque identifié — `nodeId` avec `::` littéral** : la clé composite utilise `::` comme
séparateur (même convention que `objectTypeRef`, ex. `motor-control::req-fw`). Un nom de repo ou
de `SystemNode` contenant déjà `::` casserait le split naïf. Aucune validation actuelle
n'interdit `::` dans un nom de mount ou de `SystemNode` — **à vérifier en sprint** : soit ajouter
cette contrainte à la validation de nom (cohérent avec l'usage existant de `::` comme séparateur
réservé ailleurs dans le schéma), soit utiliser un caractère de séparation improbable et découpler
proprement (ex. stocker l'option elle-même plutôt que sa clé reconstituée, en indexant par
position dans `componentOptions` — plus robuste, pas de parsing de chaîne). **Décision retenue** :
indexer par position (`data-index` sur chaque `<option>`, ou retrouver l'option par
`repoName === X && nodeId === Y` seulement si aucun des deux ne contient jamais `::` — sprint
Dev tranche définitivement en fonction de ce qui existe déjà comme contrainte de nommage).

### 3. `StructureTab.tsx` — parité visuelle du sous-composant local

Remplace la ligne texte simple (l.354-360) par un rendu incluant une icône, au même poids visuel
que `RepoRow` (l.255, `text-sm font-medium text-ink`) au lieu de l'actuel `text-xs font-medium
text-ink-2` :

```tsx
<Component size={14} className="text-ink-3 shrink-0" />
<span className="text-sm font-medium text-ink truncate">
  {localNode.label || localNode.name}
</span>
```

(import `Component` depuis `lucide-react`, ajouté à l'import existant l.4 — icône distincte de
`FolderGit2`/repo et `GitFork`/interface, sans évoquer un repo git puisqu'un sous-composant local
n'en a pas). Le reste de la ligne (`AddElementMenu`, renommer, supprimer) et l'imbrication sous le
repo conteneur restent inchangés — l'imbrication reste une contrainte de stockage réelle
(le node vit dans le `schema.yaml` de ce repo), pas une hiérarchie de navigation à retirer.

## Alternatives rejetées

- **Dupliquer les données en un vrai niveau plat côté modèle** (aplatir `SystemNode` dans
  `WorkspaceTreeNode` ou une nouvelle structure combinée persistée) : rejeté — la spec (Hors
  scope) exclut tout changement au modèle de données ; la fusion est une pure reprojection de
  données déjà chargées (`flatNodes` + `schemasByRepoPath`), pas une nouvelle source de vérité.
- **Deux combobox mais synchronisés visuellement** (ex. rétrécir "Sous-composant" en ligne
  secondaire discrète) : rejeté — ne répond pas au ticket, qui demande explicitement la
  disparition du niveau de navigation, pas juste un habillage.
- **Un seul combobox sans `<optgroup>`, libellés "Repo — Node" concaténés** (option 3 proposée
  à la question de cadrage) : rejeté par retour utilisateur (option 1 retenue) — perd la lisibilité
  dès que plusieurs repos ont des sous-composants, chaque libellé devenant long.

## Découpage en sprints

**Un seul sprint.** Rayon d'impact confirmé étroit (3 fichiers de code + 2 fichiers de spec),
aucune nouvelle requête réseau/IPC, aucun changement de modèle de données ni de format d'URL —
la complexité tient dans la construction de la liste groupée et la consolidation des deux
handlers en un seul, pas dans l'étendue des fichiers touchés.

## Refs SPEC

Reprend les refs de `specs/T120.md` (`SPEC-SYSTEM-VIEW.md` §global, `SPEC-TEMPLATES.md` §3).
