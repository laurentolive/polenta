# T81 — Sprint 1 (unique)

## Fichiers modifiés

- `packages/api-client/src/types.ts` — `BranchInfo.type`: `'prj' | 'tck' | 'other'` → `'int' | 'dev' | 'other'`
- `apps/desktop/src/main/services/sync.service.ts` — `listBranches()` : type de retour et détection de préfixe (`int-`/`dev-` au lieu de `prj-`/`tck-`)
- `apps/desktop/src/renderer/contexts/VersioningContext.tsx` — `isReadonly` teste `branch.startsWith('int-')`
- `apps/desktop/src/renderer/routes/project.$id.tsx` — `PrjBranchSelector` → `IntBranchSelector`, `prjBranches`/`currentPrjBranch` → `intBranches`/`currentIntBranch`, préfixe de création `int-`, libellé UI `int-`
- `apps/desktop/src/renderer/components/sidebar/VersionPanel.tsx` — badge `b.type === 'int'` affichant `int`

## Comportement implémenté

Renommage mécanique complet du préfixe de nomenclature de branches : `prj-*` → `int-*`, `tck-*` → `dev-*`, sans changement de comportement fonctionnel (readonly, filtrage, création de branche). Tous les consommateurs de `BranchInfo`/`listBranches` ont été vérifiés (`git.service.ts`, `ipc/index.ts`, `VersionPanel.tsx`) — aucun autre point d'usage du préfixe trouvé.

## Divergences par rapport au design

Aucune (pas de phase Design séparée — ticket suffisamment simple et mécanique pour aller directement en sprint dev, décidé avec l'utilisateur).

## Mises à jour SPEC

Aucune. `SPEC-FORKS-BRANCHES-BASELINES.md` §2 ne documente pas la convention `prj-`/`tck-` (elle n'existait que dans le code et les tickets T30/T78-T85) — pas de contenu à corriger. Une formalisation éventuelle de la convention `int-`/`dev-*` dans cette spec relève de T78.

## Vérifications

- `pnpm --filter @polenta/desktop --filter @polenta/api-client typecheck` : OK (0 erreur)
- Erreur préexistante `apps/api/src/modules/git/schema.service.ts:66` (`SystemNode.url`) : confirmée présente sur `master` avant ce ticket, non liée à T81, non corrigée ici (hors périmètre)
- Aucun test automatique existant sur ce périmètre (`sync.service.ts`, `VersioningContext.tsx`) à exécuter
- `/code-review medium` sur le diff : 0 finding

## Comment tester manuellement

1. Ouvrir un projet dans l'app
2. Page Projet (`project.$id.tsx`) : créer une branche via le sélecteur — vérifier qu'elle est créée avec le préfixe `int-`
3. Vue Version (`VersionPanel.tsx`) : vérifier que les branches `int-*` affichent le badge `int`
4. Checkout sur une branche `int-*` : vérifier que l'UI passe en lecture seule (`isReadonly`)
5. Checkout sur une branche `dev-*` ou autre : vérifier que l'UI reste éditable
