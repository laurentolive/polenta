# T59 — Design technique : Vue diff dédiée entre deux objets git

## Contexte et état de l'art

T59 crée une page `/version-diff` complète pour comparer deux objets git arbitraires (branche, tag, SHA).
T57 (menu contextuel dans graph) est déclaré comme pré-requis dans la spec T59 mais n'est pas encore mergé : la branche T57 n'existe pas dans ce worktree. **T59 implémente donc tout le pipeline depuis zéro**, sans s'appuyer sur un `diffBetween` existant.

L'arbre actuel n'a ni la route, ni le service `diffBetween`/`diffFileBetween`, ni le bouton dans VersionPanel, ni la logique de résolution ref→SHA pour des refs arbitraires.

---

## Fichiers à créer

| Fichier | Rôle |
|---------|------|
| `apps/desktop/src/renderer/routes/version-diff.tsx` | Nouvelle page TanStack Router |

## Fichiers à modifier

| Fichier | Modification |
|---------|-------------|
| `apps/desktop/src/main/services/sync.service.ts` | Ajouter `diffBetween()` et `diffFileBetween()` |
| `apps/desktop/src/main/ipc/index.ts` | Enregistrer `sync:diff-between` et `sync:diff-file-between` |
| `packages/api-client/src/types.ts` | Ajouter les deux méthodes dans l'interface `ApiClient.sync` |
| `packages/api-client/src/ipc-client.ts` | Câbler les deux appels IPC |
| `apps/desktop/src/renderer/components/sidebar/VersionPanel.tsx` | Ajouter le bouton GitDiff (import + bouton) |
| `apps/desktop/src/renderer/routes/graph.tsx` | Simplification : supprimer `diffShas`/`diffTarget` + ajouter navigation (si T57 n'est pas mergé avant T59) |

> Note : `graph.tsx` n'a pas encore les props `diffShas`/`diffTarget` (T57 non mergé). La simplification décrite dans la spec ne nécessite aucun retrait dans l'état actuel — il suffira d'ajouter un bouton de navigation vers `/version-diff` sur les lignes de commit si souhaité. Ce point est hors scope sprint 1 si T57 n'est pas là.

---

## Nouveaux services

### 1. `diffBetween(repoPath, sha1, sha2): Promise<SyncFileStatus[]>`

Compare deux SHAs arbitraires (pas commit vs parent) et retourne la liste des fichiers modifiés.

**Implémentation** : réutiliser `git.walk` avec deux arbres `TREE({ ref: sha1 })` et `TREE({ ref: sha2 })` — exactement le même pattern que `commitFiles` mais sans résolution du parent :

```typescript
async diffBetween(repoPath: string, sha1: string, sha2: string): Promise<SyncFileStatus[]> {
  const files: SyncFileStatus[] = []
  await git.walk({
    fs,
    dir: repoPath,
    trees: [git.TREE({ ref: sha1 }), git.TREE({ ref: sha2 })],
    map: async (filepath, [A, B]) => {
      if (filepath === '.') return
      const Atype = A ? await A.type() : undefined
      const Btype = B ? await B.type() : undefined
      if (Atype === 'tree' || Btype === 'tree') return
      const Aoid = A ? await A.oid() : undefined
      const Boid = B ? await B.oid() : undefined
      if (Aoid === Boid) return
      if (!A && B) files.push({ path: filepath, marker: 'A' })
      else if (A && !B) files.push({ path: filepath, marker: 'D' })
      else files.push({ path: filepath, marker: 'M' })
    },
  })
  return files
}
```

IPC channel : `sync:diff-between`

### 2. `diffFileBetween(repoPath, sha1, sha2, filepath): Promise<{ oldContent: string; newContent: string }>`

Lit le blob du fichier à sha1 (oldContent) et à sha2 (newContent) :

```typescript
async diffFileBetween(
  repoPath: string,
  sha1: string,
  sha2: string,
  filepath: string,
): Promise<{ oldContent: string; newContent: string }> {
  let oldContent = ''
  try {
    const { blob } = await git.readBlob({ fs, dir: repoPath, oid: sha1, filepath })
    oldContent = new TextDecoder().decode(blob)
  } catch {}

  let newContent = ''
  try {
    const { blob } = await git.readBlob({ fs, dir: repoPath, oid: sha2, filepath })
    newContent = new TextDecoder().decode(blob)
  } catch {}

  return { oldContent, newContent }
}
```

IPC channel : `sync:diff-file-between`

---

## Résolution ref → SHA dans le renderer

La page `/version-diff` doit résoudre un nom de branche ou de tag en SHA pour appeler `diffBetween(sha1, sha2)`.

**Approche retenue** : réutiliser la query `sync:graph` déjà chargée dans le renderer. Le graph retourne `GraphCommit[]` avec le champ `refs: string[]` (noms de branches) et le champ `sha`. Les tags sont retournés par `sync:tags`.

Côté renderer, on construit une map `refName → sha` depuis les deux sources :

```typescript
// Depuis commits
const refToSha = new Map<string, string>()
for (const commit of commits) {
  for (const ref of commit.refs) {
    refToSha.set(ref, commit.sha)
  }
  // Le SHA court sert à la recherche mais on stocke le SHA complet
  refToSha.set(commit.sha, commit.sha)
  refToSha.set(commit.short, commit.sha)
}
// Depuis les tags : appel séparé à sync:tags + resolveRef côté renderer
// Alternative plus simple : graph() inclut déjà les refs des tags si le tag pointe sur un commit visible
```

**Cas des tags** : `graph.tsx` fait déjà `listBranches` + `git.log`. Dans `sync.service.ts/graph()`, les `refs` incluent uniquement les branches. Les tags NE sont PAS inclus dans `GraphCommit.refs`.

Pour les tags, on a deux options :
- Option A : enrichir `graph()` pour inclure les tags dans `refs` (modifie la structure existante)
- Option B : appeler `api.sync.tags(repoPath)` pour récupérer les noms, puis résoudre chaque tag via un appel IPC `sync:resolve-ref(tagName) → sha`
- **Option C (retenue)** : ajouter un nouveau service `resolveRefs(repoPath): Promise<GitRef[]>` qui retourne l'ensemble branche+tag+commits récents avec leur SHA, ce qui permet de peupler les comboboxes ET de faire la map ref→sha en un seul appel.

### Service `resolveRefs(repoPath): Promise<GitRef[]>`

```typescript
export interface GitRef {
  name: string        // "main", "origin/main", "v1.0.0", "abc1234"
  sha: string         // SHA complet
  type: 'branch' | 'remote-branch' | 'tag' | 'commit'
  short?: string      // SHA court pour les commits
  message?: string    // Début du message pour les commits
}
```

Implémentation :
- Branches locales : `git.listBranches({ fs, dir })` → type `branch`
- Branches remote : `git.listBranches({ fs, dir, remote: 'origin' })` → type `remote-branch`, préfixe `origin/`
- Tags : `git.listTags({ fs, dir })` → type `tag`
- Pour chaque ref, `git.resolveRef` → sha
- Commits récents (50 derniers) : depuis `git.log` → type `commit`, message tronqué à 60 chars

IPC channel : `sync:resolve-refs`

Méthode ajoutée à `ApiClient.sync` : `resolveRefs(repoPath: string): Promise<GitRef[]>`

---

## Structure de la route `/version-diff`

Fichier : `apps/desktop/src/renderer/routes/version-diff.tsx`

```typescript
export const Route = createFileRoute('/version-diff')({
  component: VersionDiffPage,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
    ref1: (s['ref1'] as string) || undefined,
    sha1: (s['sha1'] as string) || undefined,
    ref2: (s['ref2'] as string) || undefined,
    sha2: (s['sha2'] as string) || undefined,
  }),
})
```

**Priorité de résolution** : `sha` > `ref`. Si `sha1` est fourni dans les paramètres URL, il est utilisé directement. Sinon, on cherche `ref1` dans la map `refToSha`.

**Layout** :
- Flex horizontal : panel gauche `w-64` + zone principale `flex-1`
- Panel gauche : deux `<select>` ou comboboxes filtrables pour Objet A et Objet B, puis liste de fichiers
- Zone principale : rendu diff (table identique à `/diff`) ou message placeholder

---

## Combobox de sélection d'objet git

Composant `GitRefCombobox` (local à `version-diff.tsx`) :

- Props : `refs: GitRef[]`, `value: string | undefined`, `onChange: (sha: string, label: string) => void`
- Affichage : input filtrable, dropdown avec groupes (Branches locales / Branches remote / Tags / Commits)
- Affichage de la valeur sélectionnée : `⎇ main`, `⊙ v1.0.0`, `# abc1234`
- Icône lucide : `GitBranch` pour branch, `Tag` pour tag, `Hash` pour commit
- On stocke le SHA en état interne ; le label affiché est reconstruit depuis `GitRef`

---

## Logique de la page `VersionDiffPage`

```
1. Charger le projet (workspace:get) → repoPath
2. Charger resolveRefs(repoPath) → liste de refs pour les comboboxes
3. Initialiser sha1/sha2 depuis les paramètres URL (priorité sha > ref)
4. Quand sha1 ET sha2 sont définis :
   → query diffBetween(repoPath, sha1, sha2) → liste de fichiers
5. Quand un fichier est sélectionné (selectedFile) ET sha1+sha2 définis :
   → query diffFileBetween(repoPath, sha1, sha2, selectedFile) → { oldContent, newContent }
   → computeLineDiff(old, new) → afficher la table
6. Changer sha1 ou sha2 → reset selectedFile → relance diffBetween
```

---

## Bouton GitDiff dans VersionPanel

Fichier : `apps/desktop/src/renderer/components/sidebar/VersionPanel.tsx`

Ajout dans l'import lucide : `GitCompare` (ou `Diff` — à confirmer selon disponibilité lucide-react v0.x dans le projet).

Vérifier la version de lucide-react installée pour choisir le bon nom d'icône.

Bouton inséré après le bouton `History` (lignes 406-414 actuelles) :

```tsx
<button
  type="button"
  onClick={() => navigate({ to: '/version-diff', search: { projectId } })}
  className="p-1 rounded text-prim hover:bg-hover transition-colors"
  title="Comparer deux versions"
>
  <GitCompare size={14} />
</button>
```

---

## Réutilisation du rendu diff de `/diff`

La fonction `computeLineDiff` dans `diff.tsx` est locale et non exportée. Deux options :

- **Option A (retenue)** : Dupliquer `computeLineDiff` dans `version-diff.tsx` — la fonction est pure (sans dépendances) et fait ~45 lignes. Duplication justifiée pour éviter un refactoring de `diff.tsx` hors scope T59.
- Option B : Extraire dans `utils/diff.ts` et importer depuis les deux routes. Plus propre mais modifie `diff.tsx`.

Idem pour la table de rendu : dupliquer le `<table>` ou extraire un composant `DiffTable`. Option A retenue pour le sprint 1 pour minimiser les changements sur le code existant.

---

## Simplification de `graph.tsx` (suppression diffShas/diffTarget)

La spec demande de supprimer la logique inline de diff de `graph.tsx`. Or, dans l'état actuel du code (T57 non mergé), `graph.tsx` **n'a pas** ces props. Le `CommitFilesRow` actuel navigue directement vers `/diff` (commit vs parent) via `navigate({ to: '/diff', search: { projectId, filepath, commitSha } })`.

Modification minimale à apporter dans `graph.tsx` pour T59 :
- Ajouter un bouton "Comparer..." sur les lignes de commit (colonne actions) qui navigue vers `/version-diff?projectId=...&sha1=<sha>&sha2=<HEAD_sha>` — optionnel, hors scope sprint 1.
- Aucune suppression nécessaire : rien à supprimer.

---

## Découpage en sprints

Estimation totale : ~9-12h, >10 fichiers modifiés → **2 sprints**.

### Sprint 1 — Plomberie + page de base (5-6h)

**Objectif** : avoir la page `/version-diff` fonctionnelle, accessible depuis VersionPanel, avec comboboxes et liste de fichiers.

Fichiers :
1. `sync.service.ts` — ajouter `diffBetween`, `diffFileBetween`, `resolveRefs` + interface `GitRef`
2. `ipc/index.ts` — enregistrer `sync:diff-between`, `sync:diff-file-between`, `sync:resolve-refs`
3. `packages/api-client/src/types.ts` — ajouter `GitRef` + les 3 méthodes dans `ApiClient.sync`
4. `packages/api-client/src/ipc-client.ts` — câbler les 3 appels
5. `routes/version-diff.tsx` — créer la page complète (comboboxes + liste fichiers + zone diff)
6. `VersionPanel.tsx` — ajouter le bouton GitDiff

**Livrable** : on peut ouvrir `/version-diff`, sélectionner deux refs, voir la liste de fichiers et le diff d'un fichier.

### Sprint 2 — Pré-remplissage depuis graph + polish (3-4h)

**Objectif** : navigation depuis `graph.tsx` avec params pré-remplis + polish UX.

Fichiers :
1. `routes/graph.tsx` — ajouter un bouton "Comparer vs HEAD" sur les lignes de commit, naviguant vers `/version-diff?sha1=<sha>&sha2=<headSha>&projectId=...`
2. `routes/version-diff.tsx` — affiner UX : scroll auto sur sélection fichier, état loading granulaire, message d'état approprié pour chaque cas vide
3. Vérification TypeScript zero-erreur sur l'ensemble du diff

---

## Décisions techniques

| Décision | Raison |
|----------|--------|
| `resolveRefs` = appel IPC dédié | Évite de modifier la structure de `GraphCommit` et centralise la logique dans le main process |
| Duplication de `computeLineDiff` | Évite de modifier `diff.tsx` hors scope T59 ; la fonction est pure et courte |
| Pas d'extraction de composant `DiffTable` | Même raison — minimise les changements dans un fichier stable |
| Résolution sha prioritaire sur ref | Conforme à la spec ; permet aux navigations depuis graph (qui ont le SHA) d'être déterministes |
| Pas de `diffBetween` pour working tree | Hors scope T59 ; les deux objets sont toujours des commits/tags/branches commitées |
