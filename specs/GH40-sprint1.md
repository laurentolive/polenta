# GH40 — Sprint 1 (unique)

## Fichiers modifiés

| Fichier | |
|---------|--|
| `apps/desktop/src/renderer/components/sidebar/VersionPanel.tsx` | header compact ; mode `/baseline` → `BaselineListPanel`, titre « Baselines » |
| `apps/desktop/src/renderer/components/sidebar/version/VersionRepoFolder.tsx` | icône graphe par repo ; densité ; sections vides masquées ; « Rien à committer » ; avertissement de pin sorti de la section Stagés |
| `apps/desktop/src/renderer/components/sidebar/version/BaselineListPanel.tsx` | **nouveau** — filtre, liste, dépliage, suppression (déplacés de la route) |
| `apps/desktop/src/renderer/hooks/useBaselines.ts` | **nouveau** — repo root, composants, `baseline:list` partagés |
| `apps/desktop/src/renderer/routes/baseline.tsx` | la vue = formulaire de création inline (`CreateBaselineForm`), bandeau de succès, `Ctrl+Entrée` |
| `apps/desktop/src/renderer/i18n/locales/{en,fr}.json` | + `nothingToCommit`, `viewRepoGraph`, `baselinesTitle`, `baselinePage.baselineCreated` ; − `noStagedFile`, `noModification` (plus utilisées) |
| `specs/SPEC-ELECTRON-DESKTOP.md`, `specs/SPEC-FORKS-BRANCHES-BASELINES.md`, `specs/SPEC-INDEX.md` | mises à jour SPEC (ci-dessous) |

## Comportement implémenté

Conforme à `specs/GH40.md` §1–5 et au design.

## Divergences par rapport au design / à la spec

- Libellé fr : « Rien à committer » (et non « commiter ») pour rester cohérent avec les libellés
  existants (« Aucune modification stagée à committer »).
- `BranchCombobox` : aucune variante compacte nécessaire (déclencheur `input-field py-1 text-xs`
  ≈ 26 px, compatible avec la cible ≤ 28 px).
- Ajout issu de `/code-review` : le formulaire ne se fermant plus après une création, `nextTag()`
  propose encore le tag tout juste créé tant que la liste des tags n'est pas rechargée — ce tag est
  refusé (bouton désactivé) jusqu'au rechargement (`dataUpdatedAt` de `sync:tags` du root), pour
  éviter une double soumission. La garde se lève ensuite, ce qui permet de recréer le même tag si la
  baseline a été supprimée entre-temps.
- Petite contraction de la liste dans le panneau (lignes `py-1`, sans cadre de carte) par rapport
  à l'ancienne page.

## Mises à jour SPEC

| Fichier / section | Modification |
|-------------------|--------------|
| `SPEC-ELECTRON-DESKTOP.md` §19.8b | bloc « GH40 — état actuel du panneau » : arbre multi-repo, icône graphe par repo vs header, sections vides masquées / « Rien à committer », densité, contenu piloté par la route (`/baseline` → `BaselineListPanel`) |
| `SPEC-ELECTRON-DESKTOP.md` §19.13 | route `/baseline` ajoutée (panneau Version = liste, vue = formulaire) |
| `SPEC-FORKS-BRANCHES-BASELINES.md` §5.2 | note « GH40 — UI de création » : formulaire inline, liste dans le panneau, garde anti-double soumission |
| `SPEC-INDEX.md` | nouvelle ligne §19.8b/§19.13 (MAJ GH40) ; ligne §5 baselines → MAJ GH40 |

## Vérifications

- `pnpm --filter @polenta/desktop typecheck` : 0 erreur.
- `/code-review` (medium) : 1 constat (double soumission du tag) corrigé ; rien d'autre.
- Pas de tests automatiques renderer dans le projet.

## Test manuel

Lancer l'app (`pnpm dev` dans `apps/desktop`) sur un workspace multi-repo et dérouler
`specs/GH40-tests.md` : V1–V12 (panneau Version), B1–B13 (baselines), non-régression.
