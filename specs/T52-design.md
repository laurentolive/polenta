# T52 — Design technique : restaurer la sélection composant/élément de la vue Système

## Contexte et état de l'art

Voir `specs/T52.md` pour l'investigation complète. Résumé : `SystemViewContext` pilote déjà
repo/composant/élément via l'URL (`repo`/`node`/`type`), mais rien ne survit à un aller-retour
vers un autre panneau (`AppLayout.handleSelectPanel('system')` remet ces params à `undefined` à
chaque clic, et `SystemViewProvider` est démonté entre-temps) ni à un redémarrage de l'app (rien
n'est écrit sur disque).

Le point d'accroche existant est l'effet de "défaut" de `SystemViewContext.tsx:224-235` : il ne
se déclenche que quand l'URL est vide (`!urlRepo || !urlNode`), et retombe aujourd'hui
inconditionnellement sur `nodes[0]` / premier type. C'est le seul endroit à modifier pour lire une
sélection persistée avant ce fallback.

Aucun nouveau fichier n'est nécessaire : tout tient dans le fichier qui possède déjà la logique de
résolution repo/node/type.

---

## Fichier à modifier

| Fichier | Modification |
|---------|-------------|
| `apps/desktop/src/renderer/contexts/SystemViewContext.tsx` | Lecture/écriture `localStorage` de la dernière sélection valide, branchée sur l'effet de défaut existant |

Aucun autre fichier (composant, IPC, backend) n'est impacté : la persistance est 100% côté
renderer, sur le modèle de `polenta:viewMode:${repoPath}` déjà utilisé dans `SystemView.tsx`.

---

## Nouvelles fonctions locales

Ajoutées en haut de `SystemViewContext.tsx`, à côté des autres helpers de fichier (comme
`treeUpdateObjectId` importé de `useTreeState`) :

```typescript
// ── Dernière sélection persistée (T52) ──────────────────────────────────────

const LAST_SELECTION_PREFIX = 'polenta:lastSelection:'

interface LastSelection {
  repo: string
  node: string
  type: string
}

function readLastSelection(projectId: string): LastSelection | null {
  try {
    const raw = localStorage.getItem(`${LAST_SELECTION_PREFIX}${projectId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (
      typeof parsed?.repo === 'string' &&
      typeof parsed?.node === 'string' &&
      typeof parsed?.type === 'string'
    ) {
      return parsed as LastSelection
    }
    return null
  } catch {
    return null
  }
}

function writeLastSelection(projectId: string, selection: LastSelection): void {
  try {
    localStorage.setItem(`${LAST_SELECTION_PREFIX}${projectId}`, JSON.stringify(selection))
  } catch {
    // localStorage indisponible (mode privé, quota) — best-effort, pas bloquant
  }
}
```

`projectId` (déjà résolu dans le composant via `sp.get('projectId') ?? currentProjectId`) sert de
clé d'isolation par projet — cohérent avec les autres query keys du fichier
(`['workspace', currentProjectId]`).

---

## Lecture — branchement sur l'effet de défaut existant

L'effet actuel (`SystemViewContext.tsx:224-235`) :

```typescript
useEffect(() => {
  if (!schema || nodes.length === 0 || repoOptions.length === 0) return
  if (!urlRepo || !urlNode) {
    const firstNode = nodes[0].name
    const firstType = nodes[0].objectTypes?.[0]?.name
    navigateWith(selectedRepoName, firstNode, firstType, true)
  } else if (!urlType) {
    const node = nodes.find(n => n.name === urlNode)
    const firstType = node?.objectTypes?.[0]?.name
    if (firstType) navigateWith(selectedRepoName, urlNode, firstType, true)
  }
}, [schema]) // eslint-disable-line react-hooks/exhaustive-deps
```

devient :

```typescript
useEffect(() => {
  if (!schema || nodes.length === 0 || repoOptions.length === 0) return
  if (!urlRepo || !urlNode) {
    const saved = readLastSelection(projectId)
    const savedRepoPath = saved ? repoOptions.find(r => r.name === saved.repo)?.repoPath : undefined
    const savedSchema = savedRepoPath ? schemasByRepoPath.get(savedRepoPath) : undefined
    const savedNode = saved ? savedSchema?.nodes?.find(n => n.name === saved.node) : undefined
    const savedType = saved ? savedNode?.objectTypes?.find(t => t.name === saved.type) : undefined

    if (saved && savedNode && savedType) {
      navigateWith(saved.repo, saved.node, saved.type, true)
    } else {
      const firstNode = nodes[0].name
      const firstType = nodes[0].objectTypes?.[0]?.name
      navigateWith(selectedRepoName, firstNode, firstType, true)
    }
  } else if (!urlType) {
    const node = nodes.find(n => n.name === urlNode)
    const firstType = node?.objectTypes?.[0]?.name
    if (firstType) navigateWith(selectedRepoName, urlNode, firstType, true)
  }
}, [schema]) // eslint-disable-line react-hooks/exhaustive-deps
```

**Pourquoi valider via `schemasByRepoPath` plutôt que `schema`** : `schema` (déjà en scope) ne
couvre que le repo actuellement sélectionné (`selectedRepoName`, résolu à `repoOptions[0]` tant
que l'URL est vide) — pas nécessairement le repo sauvegardé. `schemasByRepoPath` (déjà retourné
par `useWorkspaceStructure`, déjà utilisé ligne 170 pour construire les libellés du combobox
Composant) couvre, lui, tous les repos du workspace et est déjà chargé au moment où cet effet
peut se déclencher (il dépend de `repoOptions.length === 0` qui dérive de `flatNodes`, alimenté
par le même hook). Aucune requête réseau/IPC supplémentaire.

**Pourquoi ça ne boucle pas** : `navigateWith(saved.repo, ...)` met à jour `repo`/`node`/`type`
dans l'URL en une seule navigation. Si `saved.repo !== selectedRepoName` initial, le repo change,
`repoPath`/`schema` (react-query) se rechargent avec une nouvelle référence, l'effet se redéclenche
— mais `urlRepo`/`urlNode` sont désormais renseignés, donc la branche `if (!urlRepo || !urlNode)`
est déjà fausse et rien ne se repasse.

---

## Écriture — persister à chaque sélection valide résolue

Nouvel effet, ajouté après la définition de `effectiveTypeId` (les valeurs déjà validées/avec
fallback, pas les valeurs brutes de l'URL — voir "Décisions techniques") :

```typescript
useEffect(() => {
  if (!projectId || !selectedRepoName || !effectiveNodeId || !effectiveTypeId) return
  writeLastSelection(projectId, { repo: selectedRepoName, node: effectiveNodeId, type: effectiveTypeId })
}, [projectId, selectedRepoName, effectiveNodeId, effectiveTypeId])
```

Cet effet couvre à la fois :
- la sélection initiale (résultat de l'effet de lecture ci-dessus, une fois l'URL mise à jour) ;
- tout changement manuel via les comboboxes (`handleRepoChange`/`handleNodeChange`/
  `handleTypeChange`), qui passent tous par `navigateWith` → changement d'URL →
  `selectedRepoName`/`effectiveNodeId`/`effectiveTypeId` changent → effet redéclenché.

---

## Décisions techniques

| Décision | Raison |
|----------|--------|
| Persister `effectiveNodeId`/`effectiveTypeId`/`selectedRepoName` (valeurs résolues avec fallback) plutôt que `urlNode`/`urlType` bruts | Une URL modifiée à la main avec un `node`/`type` invalide ne doit pas polluer la sélection persistée — les valeurs `effective*` sont déjà garanties correspondre à une entrée réelle du schéma courant |
| `localStorage` plutôt que le fichier `.{githubaccount}.pref` (déjà utilisé pour la config des champs visibles) | Confort de navigation individuel, pas une donnée de projet à partager entre postes ; cohérent avec `polenta:viewMode:${repoPath}` déjà en place dans `SystemView.tsx` ; évite un aller-retour IPC/disque à chaque changement de sélection |
| Clé indexée par `projectId` (pas par `repoPath`) | Le repo par défaut peut différer d'un projet à l'autre ; `projectId` est stable pour un projet donné et déjà utilisé comme clé de query ailleurs dans ce fichier |
| Validation croisée avec `schemasByRepoPath` avant d'appliquer la sélection sauvegardée | Évite de naviguer vers un repo/composant/type supprimé ou renommé depuis la dernière visite (schéma modifié entre-temps) — fallback silencieux vers le comportement par défaut actuel |
| Aucune modification de `AppLayout.tsx` | L'effet de défaut de `SystemViewContext` est déjà le point de passage unique pour toute arrivée sur `/product` avec une URL vide, qu'elle vienne du clic sur l'icône Système, d'un redémarrage d'app, ou d'un lien pré-T72 sans `repo` — un seul endroit à maintenir |
| Pas de nouvel effet distinct pour "changement manuel via combobox" | Le même effet d'écriture couvre tous les cas car il réagit aux valeurs résolues, pas à la source du changement |

---

## Découpage en sprints

Un seul fichier modifié, ~40 lignes ajoutées, aucune nouvelle route/IPC/type partagé → **1 sprint**.

### Sprint 1 (unique)

1. `SystemViewContext.tsx` — helpers `readLastSelection`/`writeLastSelection`, effet de lecture
   modifié, nouvel effet d'écriture.
2. Mise à jour de `specs/SPEC-SYSTEM-VIEW.md` §Persistance de l'état (nouvelle ligne du tableau).
3. Vérification TypeScript + `/code-review` sur le diff.
4. Test manuel des scénarios de `specs/T52-tests.md`.
