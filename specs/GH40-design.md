# GH40 — Design technique

Spec : `specs/GH40.md`. Un seul sprint (renderer uniquement, aucun changement main/IPC/types).

## Fichiers modifiés

| Fichier | Changement |
|---------|-----------|
| `renderer/components/sidebar/VersionPanel.tsx` | header compacté ; 3ᵉ mode de contenu : `pathname === '/baseline'` → `<BaselineListPanel>` (même pattern que `isCompareView` → `VersionCompareSelector`) ; titre « Baselines » dans ce mode |
| `renderer/components/sidebar/version/VersionRepoFolder.tsx` | icône graphe par repo ; densité ; sections Stagés/Modifications masquées si vides ; ligne « Nothing to commit » ; `PinPropagationWarning` post-commit sorti de la section Stagés |
| `renderer/components/sidebar/version/BaselineListPanel.tsx` | **nouveau** — filtre + liste + dépliage + suppression (code déplacé de `routes/baseline.tsx` : `BaselineItem`, `DeleteBaselineModal`, filtre, `deleteMutation`) |
| `renderer/hooks/useBaselines.ts` | **nouveau** — résolution `repoPath` root + `componentNodes` + `componentRefs` + query `baseline:list` ; partagé par le panneau et la route (même `queryKey`, donc un seul cache) |
| `renderer/routes/baseline.tsx` | la page devient le formulaire : `CreateBaselineModal` → `CreateBaselineForm` rendu inline ; suppression de la liste, du filtre, du bouton « Nouvelle baseline », du bouton Annuler ; bandeau de succès ; `Ctrl+Entrée` |
| `renderer/i18n/locales/en.json`, `fr.json` | nouvelles clés (ci-dessous) |

## Détails

### Icône graphe par repo (`VersionRepoFolder`)
```tsx
<button type="button" title={t('sidebar.version.viewRepoGraph', { name })}
  onClick={e => { e.stopPropagation(); selectRepo(repoPath); navigate({ to: '/graph', search: { projectId, sha: undefined } }) }}
  className="shrink-0 ml-auto … p-0.5"><History size={13} /></button>
```
Placée juste avant le bouton Rafraîchir, qui perd son `ml-auto`. `/graph` lit déjà
`selectedRepoPath` — aucune modification de `graph.tsx`. Header : bouton `History` inchangé.

### Sections vides
`const nothingToCommit = staged.length === 0 && unstaged.length === 0`
- `{staged.length > 0 && <section Stagés/>}`, `{unstaged.length > 0 && <section Modifications/>}`
- `{nothingToCommit && <p className="px-2 py-0.5 text-xs text-ink-3 italic">{t('sidebar.version.nothingToCommit')}</p>}`
- bordure `border-b` sur Stagés uniquement si Modifications est aussi affichée.
- `PinPropagationWarning outcome={commitPinWarning}` déplacé au niveau du bloc déplié, au-dessus
  des sections (sinon démonté dès que le commit vide la section Stagés — critère 5).
- Le `syncStatus` peut être `undefined` au premier chargement : ne pas afficher « Nothing to
  commit » tant que `syncStatus` n'est pas chargé (évite un flash).

### Densité (classes Tailwind)
| Élément | Avant | Après |
|---------|-------|-------|
| Header panneau | `px-4 py-3` | `px-3 py-1.5` |
| Ligne repo | `py-1.5 gap-2` | `py-0.5 gap-1.5` (h ≈ 26 px, contrainte = combobox branche) |
| Sections dépliées | `px-3 py-2`, `mb-1.5` | `px-2 py-1`, `mb-0.5` |
| Ligne « à pousser » | `px-3 py-2` | `px-2 py-1` |
| Liste fichiers | `space-y-0.5` | `space-y-0`, `<li>` `h-5` |
| Bloc déplié | `pb-2` | `pb-1` |
| Conteneur arbre | `py-1` | `py-0.5` |

Si `BranchCombobox` impose une hauteur > 24 px, lui passer une variante compacte via une prop
`compact?: boolean` (à vérifier au dev ; sinon pas de changement de `BranchCombobox`).

### `useBaselines(projectId)`
```ts
export function useBaselines(projectId: string) {
  // workspace:resolve → repoPath ; useWorkspaceStructure → flatNodes
  // componentNodes = flatNodes.filter(n => n.repoPath !== repoPath)
  // componentRefs ; useQuery(['baseline:list', repoPath, componentRefs])
  return { repoPath, workspaceDir, flatNodes, componentNodes, componentRefs, baselines, isLoading, structureError, structureConflicts }
}
```
Le panneau reçoit `projectId` (déjà prop de `VersionPanel`).

### `BaselineListPanel`
- Filtre `input-field text-xs py-1 pl-6` en tête (shrink-0), liste en `overflow-y-auto`.
- `BaselineItem` repris tel quel (déplacé), lignes `py-1` sans bordure de carte (le panneau fait
  office de conteneur), `divide-y divide-edge-subtle`.
- `DeleteBaselineModal` + `deleteMutation` déplacés ici (la suppression vit avec la liste).
  Invalidations inchangées : `baseline:list`, `sync:tags`.

### `routes/baseline.tsx` → formulaire
- Garde : readiness (`statusQueries`, `integrationBranchQueries`, `tagsQueries`), `nextTag`,
  `mainTag`, `message`, `createMutation`, `tagWarning` ; `baselines`/`componentNodes` via `useBaselines`.
- `CreateBaselineModal` → `CreateBaselineForm` : même JSX sans overlay/cadre modal, dans
  `<div className="flex-1 overflow-y-auto px-6 py-4"><div className="max-w-2xl space-y-4">…`.
  Bouton « Créer la baseline » aligné à droite en bas du formulaire, pas de bouton Annuler.
- `useModalHotkeys` retiré (Échap fermait la popup ; Entrée hors textarea déclencherait une
  création involontaire depuis le champ tag — on ne garde que `Ctrl+Entrée`) : `onKeyDown` sur le
  conteneur du formulaire : `if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canCreate) create()`.
- Succès : `setCreatedTag(record.tag)` → bandeau `text-status-success` « Baseline {{tag}} créée »
  en tête du formulaire, effacé à la prochaine saisie dans le tag/message ou au prochain create.
- `ViewHeader` : `actions` supprimé, `back` conservé.

### i18n
| Clé | en | fr |
|-----|----|----|
| `sidebar.version.nothingToCommit` | Nothing to commit | Rien à commiter |
| `sidebar.version.viewRepoGraph` | View history of {{name}} | Voir l'historique de {{name}} |
| `sidebar.version.baselinesTitle` | Baselines | Baselines |
| `baselinePage.baselineCreated` | Baseline {{tag}} created | Baseline {{tag}} créée |

Clés devenues inutilisées (`sidebar.version.noStagedFile`, `noModification`) : vérifier par grep
qu'aucun autre usage n'existe avant suppression.

## Décisions / alternatives rejetées
- **Liste dans `VersionPanel` pilotée par la route** (validé humain) plutôt qu'un toggle local :
  cohérent avec la vue Comparer, pas d'état supplémentaire.
- **Hook partagé `useBaselines`** plutôt que dupliquer la query : même `queryKey`, la création
  depuis la page rafraîchit le panneau automatiquement via l'invalidation existante.
- **Pas de contexte partagé pour la baseline sélectionnée** : dépliage sur place uniquement
  (validé humain), aucun état à faire transiter entre panneau et vue.
- **`DeleteBaselineModal` conservé en modal** : confirmation destructive, la spec ne demande
  d'intégrer que la popup de création.

## Découpage
Un sprint : les 6 fichiers ci-dessus. Vérification `pnpm --filter desktop typecheck` + `/code-review`.
