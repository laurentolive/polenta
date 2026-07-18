# T57 — Sprint 2 : menu contextuel UI

**Commit** : `9559178`  
**Branche** : T57

---

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `apps/desktop/src/renderer/routes/graph.tsx` | +818 lignes : composant `GraphContextMenu`, intégration dans `GraphPage`, extension `CommitFilesRow` |
| `packages/api-client/src/types.ts` | `createTag` : ajout paramètre optionnel `commitSha?` |
| `packages/api-client/src/ipc-client.ts` | `createTag` : passage de `commitSha` au handler IPC |
| `specs/T57-sprint1.md` | Fichier résumé sprint 1 (oublié dans le commit sprint 1) |

---

## Comportement implémenté

### Détection de la cible
- Clic droit sur un **badge de branche** → menu branche (`type: 'branch'`)
- Clic droit sur un **badge de tag** → menu tag (`type: 'tag'`)
- Clic droit sur **le reste de la ligne** (`<tr>` onContextMenu) → menu commit (`type: 'commit'`)
- Les badges utilisent `e.stopPropagation()` pour ne pas déclencher le menu commit

### Tags vs branches
- Query `sync:tags` (staleTime 30s) → `tagSet: Set<string>`
- Un badge est un tag si `tagSet.has(ref)`, branche sinon
- Les tags s'affichent avec une bordure pointillée pour les distinguer visuellement

### Composant GraphContextMenu
- Rendu via `createPortal` dans `document.body`
- Position fixe `{ left: x, top: y }` au curseur
- Fermeture sur `mousedown` extérieur ou `keydown Escape`
- Utilise `useLayoutEffect` + `useRef` pour le recentrage automatique si le menu déborde en bas/droite

### 3 menus distincts
**Branche** : Checkout, Merger → courant, Rebaser, Pousser, Supprimer locale (confirmation), Supprimer remote (confirmation), Diff vs HEAD, Diff vs branche…  
**Tag** : Checkout tag, Créer branche depuis ce tag (prompt), Supprimer tag (confirmation), Diff vs HEAD, Diff vs branche…  
**Commit** : Checkout (HEAD détaché), Créer branche (prompt), Créer tag (prompt), Rebaser, Diff vs HEAD, Diff vs branche…

### Prompts inline
- Remplacent temporairement la liste d'items dans le menu
- Input autofocus, Enter valide, Escape ferme
- Spinner pendant la mutation, erreur affichée sous l'input

### Confirmation actions destructives
- Premier clic → item passe en `"Confirmer ?"` (fond rouge, texte gras)
- Second clic → exécute l'action
- Clic ailleurs → réinitialise l'état de confirmation

### Panel diff
- `CommitFilesRow` étendu avec prop optionnelle `diffShas?: { sha1, sha2 }`
- Si `diffShas` fourni : utilise `api.sync.diffBetween` ; sinon : `api.sync.commitFiles` (comportement original)
- "Diff vs HEAD" : sha2 = `headSha` (commit `isCurrent`)
- "Diff vs branche…" : sélecteur de branche → passe le nom de branche comme `sha2` (résolu côté service)
- `handleDiff` force l'expansion de la ligne (`setSelectedSha(rowSha)`) pour que `CommitFilesRow` soit rendu

---

## Divergences vs design

| # | Divergence | Impact |
|---|---|---|
| 1 | `target.type` utilisé (pas `target.kind` comme dans la spec) | Aucun, cohérent dans tout le composant |
| 2 | `createTag` : `commitSha?` ajouté dans types.ts/ipc-client.ts (oubli Sprint 1) | Correction nécessaire, 2 lignes |
| 3 | Sélecteur branche passe le nom (pas le SHA) comme `sha2` à `diffBetween` | Acceptable si le service isomorphic-git résout les refs ; à surveiller |

---

## Comment tester manuellement

1. Lancer l'app : `pnpm --filter @polenta/desktop dev` depuis `../polenta-T57/`
2. Ouvrir un projet avec plusieurs branches et commits
3. **Menu branche** : clic droit sur un badge de branche → vérifier les items selon conditions
4. **Menu tag** : clic droit sur un badge de tag → vérifier 5 items
5. **Menu commit** : clic droit sur SHA/message → vérifier 6 items
6. **Checkout** : clic sur "Checkout branche" → branche courante change dans le header
7. **Créer branche** : prompt → entrer un nom → branche visible dans le graph sur le bon SHA
8. **Créer tag** : prompt → entrer un nom → tag visible dans le graph sur le bon commit (pas HEAD)
9. **Supprimer branche** : premier clic → "Confirmer ?" ; second clic → branche disparaît
10. **Diff vs HEAD** : panneau inline apparaît avec liste de fichiers ; clic fichier → vue diff
11. **Diff vs branche** : sélecteur de branche apparaît → sélectionner → panneau diff
12. **Fermeture** : clic ailleurs ou Echap → menu se ferme
