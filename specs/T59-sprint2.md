# T59 Sprint 2 — Migration diff graph.tsx → page /version-diff

**Date** : 2026-06-24  
**Branche** : T59  
**Commit** : feat(version): T59 sprint2 — diff graph.tsx → page /version-diff

---

## Objectif

Migrer les actions diff du menu contextuel de `graph.tsx` pour naviguer vers la page dédiée `/version-diff` au lieu d'afficher un panel inline dans la table des commits.

---

## Modifications apportées

### `apps/desktop/src/renderer/routes/graph.tsx`

#### Suppressions

- **`diffShas` prop** de `CommitFilesRow` — la prop était optionnelle et déclenchait un mode alternatif (appel `diffBetween` au lieu de `commitFiles`). Supprimée intégralement.
- **`diffTarget` state** dans `GraphPage` — état `{ rowSha, diffShas }` qui pilotait l'affichage du diff inline. Supprimé.
- **`handleDiff` callback** dans `GraphPage` — callback `useCallback` passé via prop `onDiff` au menu contextuel. Supprimé.
- **`onDiff` prop** de `GraphContextMenuProps` — inutile maintenant que la navigation est interne au composant.
- **Branche `diffBetween`** dans la query de `CommitFilesRow` — simplifiée pour n'utiliser que `commitFiles`.
- **Commentaire et variable `navSha`** dans `CommitFilesRow` — n'est plus nécessaire.

#### Ajouts

- **`projectId` prop** dans `GraphContextMenuProps` — nécessaire pour construire l'URL de navigation.
- **`const navigate = useNavigate()`** dans `GraphContextMenu` — navigation TanStack Router directe depuis le composant menu.
- **`handleDiffVsHead(sha)`** → navigue vers `/version-diff` avec `sha1=sha` + `sha2=headSha`.
- **`handleDiffVsBranch(sha, ref2)`** → navigue vers `/version-diff` avec `sha1=sha` + `ref2=branchName`.

#### Comportement conservé

- `CommitFilesRow` fonctionne toujours pour afficher les fichiers modifiés d'un commit (expand/collapse en cliquant sur une ligne). Les liens de fichiers naviguent toujours vers `/diff`.
- Le sélecteur de branche inline (`selectorMode === 'diff'`) est conservé : il permet à l'utilisateur de choisir `ref2` avant de naviguer vers `/version-diff` avec les deux paramètres pré-remplis.
- Le sélecteur de branche pour le merge (`selectorMode === 'merge'`) est inchangé.

---

## Paramètres de navigation

| Action menu | URL générée |
|-------------|-------------|
| "Diff branche vs HEAD" (branche non courante) | `/version-diff?projectId=X&sha1=<sha_branche>&sha2=<sha_HEAD>` |
| "Diff tag vs HEAD" | `/version-diff?projectId=X&sha1=<sha_tag>&sha2=<sha_HEAD>` |
| "Diff commit vs HEAD" (commit non courant) | `/version-diff?projectId=X&sha1=<sha_commit>&sha2=<sha_HEAD>` |
| "Diff … vs branche…" (après sélection) | `/version-diff?projectId=X&sha1=<sha>&ref2=<nom_branche>` |

Note : tous les paramètres optionnels (`ref1`, `ref2`, `sha1`, `sha2`) sont passés explicitement (même si `undefined`) car TanStack Router exige que tous les champs du `validateSearch` soient présents.

---

## TypeScript

`npx tsc --noEmit` → 0 erreur.

---

## Scénarios de test manuels

### Scénario 1 — Diff branche vs HEAD

1. Ouvrir la page `/graph` pour un projet avec plusieurs branches
2. Faire clic droit sur le badge d'une branche non courante dans la colonne Message
3. Cliquer "Diff branche vs HEAD"
4. **Attendu** : navigation vers `/version-diff` avec Objet A = SHA de la branche, Objet B = HEAD
5. **Vérifier** : les deux comboboxes sont pré-remplies avec les labels corrects (`# abc1234` ou `⎇ main`)
6. **Vérifier** : la liste de fichiers diff apparaît automatiquement

### Scénario 2 — Diff tag vs HEAD

1. Ouvrir `/graph` pour un projet avec au moins un tag
2. Faire clic droit sur un badge de tag
3. Cliquer "Diff tag vs HEAD"
4. **Attendu** : navigation vers `/version-diff` avec Objet A = SHA du tag, Objet B = HEAD
5. **Vérifier** : combobox Objet A affiche `⊙ v1.0.0` (ou le nom du tag)

### Scénario 3 — Diff commit vs HEAD

1. Ouvrir `/graph`
2. Faire clic droit sur une ligne de commit non courant (pas le HEAD)
3. Cliquer "Diff commit vs HEAD"
4. **Attendu** : navigation vers `/version-diff` avec Objet A = SHA du commit
5. **Vérifier** : combobox Objet A affiche `# abc1234`

### Scénario 4 — Diff vs branche…

1. Ouvrir `/graph`
2. Faire clic droit sur un commit ou une branche
3. Cliquer "Diff commit vs branche…" (ou "Diff branche vs branche…")
4. **Attendu** : sélecteur inline des branches s'ouvre
5. Cliquer sur une branche dans la liste
6. **Attendu** : navigation vers `/version-diff` avec Objet A = SHA source, Objet B = nom de la branche choisie
7. **Vérifier** : combobox Objet B pré-remplie avec `⎇ <nom_branche>`

### Scénario 5 — Expand commit (régression)

1. Ouvrir `/graph`
2. Cliquer sur une ligne de commit quelconque
3. **Attendu** : panneau des fichiers du commit s'ouvre en dessous (expand/collapse normal)
4. **Vérifier** : les fichiers M/A/D sont listés
5. Cliquer sur un fichier dans le panneau
6. **Attendu** : navigation vers `/diff` (diff du fichier dans ce commit vs son parent), PAS vers `/version-diff`

### Scénario 6 — Retour depuis version-diff

1. Depuis `/graph`, déclencher un "Diff vs HEAD"
2. Dans `/version-diff`, cliquer le bouton "← Retour"
3. **Attendu** : retour vers `/graph` avec le même `projectId`

---

## Hors scope Sprint 2

- Bouton "Comparer vs HEAD" en accès direct dans la colonne actions de chaque ligne commit (mentionné dans le design comme optionnel)
- Scroll automatique sur sélection de fichier dans `/version-diff`
- États de chargement granulaires dans `/version-diff`
