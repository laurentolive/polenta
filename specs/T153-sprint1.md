# T153 — Sprint 1 (final)

## Fichiers modifiés

- `apps/desktop/src/renderer/components/sidebar/version/VersionRepoFolder.tsx` — mutation
  `pullMutation` (`api.sync.pull`), bouton icône `RefreshCw` dans l'en-tête du repo (avant le
  `BranchCombobox`), désactivé si `isDirty` ou pull en cours, tooltip contextuel, affichage de
  l'erreur en cas d'échec.
- `apps/desktop/src/renderer/i18n/locales/fr.json` / `en.json` — clés `sidebar.version.refresh`,
  `refreshTooltip`, `refreshing`, `refreshError`, `refreshBlockedDirty`.
- `specs/SPEC-FORKS-BRANCHES-BASELINES.md` §2.1 — documentation du bouton Rafraîchir/pull.
- `specs/SPEC-INDEX.md` — colonne MAJ mise à jour pour cette section → T153.
- `TICKETS.md` — entrée T153.

Aucun changement backend/IPC/api-client : `SyncService.pull()`, le handler IPC `sync:pull` et
`api.sync.pull()` existaient déjà (depuis T74/T87) mais n'avaient jamais d'appelant côté UI.

## Comportement implémenté

- Bouton "Rafraîchir" visible en permanence à côté du nom de chaque repo (root, composant,
  intégration) dans le panneau Version, quel que soit son état `ahead`/`behind`.
- Clic → `git pull` (`api.sync.pull(repoPath)`), invalidation de `sync:status` et `sync:graph` en
  cas de succès.
- Désactivé (icône grisée, `disabled`) tant que le repo a des fichiers stagés ou non stagés —
  même calcul `isDirty` déjà utilisé pour bloquer un checkout direct. Tooltip explicite dans ce
  cas ("Committez ou annulez d'abord…").
- Erreur de pull affichée sous l'en-tête du repo (pas de `catch` silencieux), même emplacement que
  l'erreur de checkout existante.

## Divergences par rapport au design initial

Aucune — implémentation conforme à `specs/T153.md`. Le hors-scope (compteur `behind`, gestion
dédiée des conflits de merge après pull) n'a pas été traité, comme prévu.

## Comment tester manuellement

1. `pnpm --filter @polenta/desktop build` puis lancer l'app (`pnpm --filter @polenta/desktop dev`
   ou build+driver Playwright).
2. Créer/ouvrir un projet, aller dans l'onglet Version.
3. Repo propre → l'icône Rafraîchir (à côté du nom, avant le sélecteur de branche) est active ;
   cliquer déclenche un pull (visible via l'icône qui tourne, puis statut rafraîchi). Sans remote
   configuré, l'erreur isomorphic-git ("remote OR url parameter") s'affiche — comportement attendu
   pour un projet local sans remote, pas un bug de ce ticket.
4. Modifier un fichier (staged ou non) → l'icône devient grisée/désactivée, tooltip "Committez ou
   annulez d'abord…" ; le clic ne déclenche aucun appel.
5. Vérifié en conditions réelles via le driver Playwright (`apps/desktop/.claude/skills/run-desktop`) :
   capture d'écran + inspection DOM (`disabled: true` + tooltip correct sur repo dirty,
   `disabled: false` + tooltip "git pull" sur repo propre, message d'erreur affiché après clic sur
   repo sans remote).

Vérifications automatiques : `pnpm --filter @polenta/desktop typecheck` → 0 erreur.

## Mises à jour SPEC

- `SPEC-FORKS-BRANCHES-BASELINES.md` §2.1 : ajout d'un paragraphe documentant le bouton
  Rafraîchir/pull (T153), juste après le paragraphe existant sur le discard "Tout annuler" (T87).
- `SPEC-INDEX.md` : ligne §1–2 de `SPEC-FORKS-BRANCHES-BASELINES.md` — mots-clés et colonne MAJ
  mis à jour (T87 → T153).
