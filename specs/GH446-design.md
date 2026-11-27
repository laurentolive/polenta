# GH446 — Design : historique Git des objets (popup « Historique »)

Spec validée : [GH446.md](GH446.md), révision 3 (validée par l'humain le 2026-11-27).

## 1. Décisions de design

- **D6 tranchée : réutiliser `FileDiffView`, en lecture seule.** Son mode Brut / Rendu, sa navigation, ses
  largeurs et la préférence globale `diffPrefs` (clé `polenta:diffViewMode`, partagée avec l'écran Diff) sont repris
  tels quels. Il n'est éditable que si `contents.newRef === null` (working tree) ; pour un commit, `newRef` vaut le SHA
  (`sync.service.ts` `commitDiff` → `fileDiffContents(…, sha, …)`), donc aucune action d'enregistrement n'apparaît.
  Pas de second moteur de présentation.
- **Rendu pour les six types.** `FileDiffView` propose le Rendu pour tout fichier YAML (vue générique, typée quand le
  schéma résout le type). Le choix Brut / Rendu est donc proposé pour les six types, ce qui tranche le point ouvert
  de D6 (criterion 8 de la spec).
- **Aucune sélection par défaut** : la popup ouvre la liste et ne lit aucun diff tant qu'un commit n'est pas
  sélectionné (critère 15).
- **Q2 (historique Git seul)** : la popup n'utilise pas `history:get` ni `readEffectiveHistory`. Le GH77 reste
  dans `HistorySection` des éditeurs, inchangé.
- **D1 (chemin par type)** : une seule table partagée client / serveur, dans `packages/types`
  (`objectHistoryFile(kind, id)`), pour que la liste et le diff désignent le même fichier.
- **Type des kinds** : `ObjectCommitKind = 'requirement' | 'test' | 'campaign' | 'issue' | 'version' | 'validation'`.
  `HistoryObjectKind` (GH77) n'est pas modifié (D1 de la révision 3).

## 2. Fichiers

### Backend

| Fichier | Changement |
|---|---|
| `packages/types/src/object-history-file.ts` (nouveau) | `ObjectCommitKind`, `objectHistoryFile(kind, id)` → `requirements/<id>.yaml`, `tests/`, `campaigns/`, `issues/`, `versions/`, `validations/` |
| `packages/types/src/index.ts` | export du nouveau module |
| `apps/desktop/src/main/services/git.service.ts` | `fileCommits` : ajoute `subject` (première ligne du message, `CommitInfo.message`) |
| `apps/desktop/src/main/services/object-commits.service.ts` (nouveau) | `listObjectCommits(git, repoPath, kind, id)` : `fileCommits(repoPath, objectHistoryFile(kind, id))` ; kind inconnu → erreur |
| `apps/desktop/src/main/ipc/index.ts` | `r.handle('history:commits', …)` à côté de `history:get` (l. 607) |
| `packages/api-client/src/types.ts` | `history.commits(repoPath, kind, id): Promise<ObjectCommit[]>` ; type `ObjectCommit { oid, at, by, subject }` |
| `packages/api-client/src/ipc-client.ts` | `history.commits: (p, kind, id) => invoke('history:commits', p, kind, id)` (l. 292) |
| `apps/desktop/src/web-server/channel-policy.ts` | `history:commits` dans `WEB_EXPOSED` et `[0]` dans l'arg policy (comme `history:get`) |

### Renderer

| Fichier | Changement |
|---|---|
| `components/history/ObjectCommitsDialog.tsx` (nouveau) | popup modale : liste des commits (gauche), `FileDiffView` (droite) |
| `components/history/useObjectCommitsTarget.ts` (nouveau, si utile) | état local d'ouverture (`{ repoPath, kind, id, title }`) |
| `components/system/ElementTree.tsx` | item « Historique » pour un nœud `kind === 'item'` ; désactivé si `selectedIds.length > 1` (Q4) ; prop `onHistory(objectId)` |
| `components/sidebar/SystemPanel.tsx` | fournit `onHistory` (catégorie du panneau → `ObjectCommitKind`) ; `CampaignNavList` : menu clic droit → campagne |
| `components/sidebar/version/ProductVersionsPanel.tsx` | `menuItems` : entrée « Historique » (kind `version`) |
| `components/sidebar/ValidationPanel.tsx` | clic droit sur une ligne ayant une validation → kind `validation` |
| `components/system/ExcelView.tsx` | `ExcelContextMenu` : entrée « Historique » pour exigence, test, campagne, issue ; désactivée en sélection multiple |
| `components/system/WordView.tsx` | menu contextuel (aucun n'existe) : « Historique » seul, pour un bloc exigence / test / campagne / issue |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | clés `history.commits.*` |

## 3. Interfaces

```ts
// packages/types/src/object-history-file.ts
export type ObjectCommitKind = 'requirement' | 'test' | 'campaign' | 'issue' | 'version' | 'validation'
const DIRS: Record<ObjectCommitKind, string> = {
  requirement: 'requirements', test: 'tests', campaign: 'campaigns',
  issue: 'issues', version: 'versions', validation: 'validations',
}
export function objectHistoryFile(kind: ObjectCommitKind, id: string): string {
  return `${DIRS[kind]}/${id}.yaml`
}
```

```ts
// apps/desktop/src/main/services/object-commits.service.ts
export async function listObjectCommits(
  git: Pick<GitService, 'fileCommits'>, repoPath: string, kind: string, id: string,
): Promise<ObjectCommit[]> {
  if (!isObjectCommitKind(kind)) throw new Error(`history:commits — unknown object kind: ${kind}`)
  return git.fileCommits(repoPath, objectHistoryFile(kind, id))
}
```

`isObjectCommitKind` vérifie l'appartenance à `DIRS` (liste blanche ; un kind inconnu lève l'erreur, critère 7).

`fileCommits` (premier parent, `--literal-pathspecs`, `--full-history`) renvoie désormais `subject` :
`{ oid, at, by, subject }`, du plus récent au plus ancien (ordre existant de `pathCommits` ; la liste est inversée côté
UI si besoin — à confirmer par le test).

## 4. Popup (`ObjectCommitsDialog`)

- Props : `{ repoPath, kind, id, title, onClose }`. Modale `role="dialog"`, `backdropDismiss(onClose)`, Échap ferme.
- Liste : `useQuery(['object-commits', repoPath, kind, id], () => api.history.commits(repoPath, kind, id))`.
  Ligne : date (`at`), auteur (`by`), `subject`, hash court. État vide : « Aucun commit » (critère 4).
- Sélection : `useState<string | null>(null)`. Pas de sélection au montage (critère 15).
- Diff : `useQuery(['commit-diff', repoPath, sha, path], () => api.sync.commitDiff(repoPath, sha, path), { enabled: !!sha })`,
  puis `<FileDiffView repoPath filepath={path} contents={data} isLoading showPath={false} />`.
  `path = objectHistoryFile(kind, id)`.
- Brut / Rendu : fourni par `FileDiffView` (bouton `data-testid="diff-mode-toggle"`), mémorisé par `diffPrefs`.
- Lecture seule : aucune action d'écriture n'est rendue (newRef = SHA). Ouvrir et fermer ne touche ni le repo ni `git status`.

## 5. Points d'entrée

- **Menu `ElementTree`** : `handleContextAction` reçoit `'history'`, ouvre la popup pour `target.objectId`
  (`target.kind === 'item'`). Le `kind` vient de la catégorie de l'arbre (SystemPanel). Le repo est celui du panneau
  (`repoPath` courant). À confirmer en implémentation : pour un élément de composant affiché dans le produit,
  `repoPath` désigne déjà le repo propriétaire (Q3) ; sinon, le résoudre comme `findOwnerScope` (GH447).
- **Sélection multiple** : `selectedIds.length > 1` → entrée désactivée, info-bulle « sélectionner une seule ligne ».
- **Versions** : `ProductVersionsPanel` ajoute `{ id: 'history', label: t('history.commits.menu'), onSelect }` ; kind
  `version`, `repoPath` = `current.repoPath` (le repo qui porte la version).
- **Campagnes** : `CampaignNavList` ajoute `onContextMenu` sur chaque ligne ; kind `campaign`.
- **Validations** : `ValidationPanel` ajoute `onContextMenu` sur les lignes qui ont une `validation` ; kind `validation`.
  Une version sans validation n'a pas d'entrée (pas de fichier à lire).
- **Excel** : `handleContextMenu` garde déjà le `nodeId` ; l'entrée est ajoutée pour les lignes de catégorie
  exigence / test / campagne / issue (critère 2), pas pour version / validation (critère 3).
- **Word** : `WordView` n'a aucun menu. Ajout d'un `onContextMenu` sur le bloc objet, menu à une entrée.

## 6. Ordre de réalisation (sprints)

1. **Sprint 1 — backend** : `object-commit-kinds` (types), `subject`, `object-commits.service`, IPC `history:commits`,
   api-client, liste blanche web. Tests unitaires. Pas d'UI.
2. **Sprint 2 — popup et panneaux** : `ObjectCommitsDialog`, `ElementTree`, `SystemPanel`/campagnes, versions,
   validations, clés i18n. Tests e2e des entrées du panneau.
3. **Sprint 3 — Excel, Word, finition** : `ExcelContextMenu`, `WordView`, sélection multiple, e2e complet
   (`gh446-history.spec.ts`), revue, vérifications de niveau 1 et 2.

## 7. Risques

- **Volume de commits** : une seule lecture `git log -- <fichier>` par ouverture ; pas de pagination en v1.
- **Repo de composant** : le `repoPath` du panneau doit être celui qui porte l'objet. Vérifié en sprint 2 sur un
  élément de composant (test e2e dédié, à ajouter si le cas existe dans l'app).
- **Rendu** : repose sur `useSchemaAt` (schéma à chaque commit). Un schéma illisible retombe sur le rendu générique,
  comme dans l'écran Diff (pas de régression à inventer).
- **Mémorisation** : la préférence Brut / Rendu est globale (comme l'écran Diff). C'est le comportement voulu
  (« l'utilisateur doit pouvoir choisir le rendu »), pas une préférence par objet.
