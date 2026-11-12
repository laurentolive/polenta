# GH340 — Sprint 2 (final) : reprise des dates par la mise en conformité

Spec : `specs/GH340.md` · design : `specs/GH340-design.md` · scénarios : `specs/GH340-tests.md` ·
sprint 1 : `specs/GH340-sprint1.md`.

## Fichiers modifiés

- `apps/desktop/src/main/services/git.service.ts` : `auditDatesFromHistory(repoPath, prefixes)`.
  Un parcours de tous les commits atteignables, hors fusions, pour avoir l'auteur réel :
  - les fichiers touchés seulement par une fusion prennent leurs dates de ces commits ;
  - les dates sont des dates de commit ;
  - un dépôt superficiel est toléré ;
  - les sous-arbres sont mémoïsés.
- `apps/desktop/src/main/services/repo-conformity.service.ts` : élément `audit-dates`.
  - `filesWithoutDates` : test textuel des quatre clés, avec cache par fichier (date et taille).
  - `fillAuditDates` : ajout en texte des seules clés absentes, en fin de fichier.
  - Pas de commit vide si rien n'a pu être écrit.
- `packages/api-client/src/types.ts` : `ConformityItem.id` reçoit `audit-dates`.
- `apps/desktop/src/renderer/components/sidebar/version/ConformityNotice.tsx` : `count` passé à la
  traduction.
- `apps/desktop/src/renderer/i18n/locales/fr.json`, `en.json` : `item_audit-dates_one` / `_other`.
- Tests :
  - `repo-conformity.gh340.test.ts` (C1–C5, C5b, C7, sur un vrai dépôt git) ;
  - `history.write-paths.test.ts` (`fillAuditDates` autorisé, avec sa justification) ;
  - `e2e-web/gh340-audit-dates.spec.ts` (C1, C6, W1, W2, R2).
- Specs : `GH340.md` §6 (précisions ci-dessous), `SPEC-INDEX.md` (colonne MAJ).

## Comportement

Un dépôt dont des exigences, tests ou issues n'ont pas leurs quatre dates affiche, dans le panneau
Version : « dates de création / modification de N objets, reprises de l'historique git ».

- **Valider** :
  - les dates absentes sont ajoutées depuis git ;
  - un commit `[polenta] Mise en conformité du dépôt (audit-dates)` ne contient que ces fichiers,
    et il est poussé ;
  - une valeur présente n'est jamais réécrite ; commentaires et mise en forme sont conservés.
- **Plus tard** : rien n'est écrit, la proposition revient à la prochaine ouverture.

## Divergences avec la spec et le design

Après `/code-review`. Spec §6 et design mis à jour.

- **Date de commit au lieu de la date d'auteur** : la date d'auteur survit à un rebase ou à un
  cherry-pick et peut précéder la création. Même choix que la reprise GH77.
- **Fichiers créés dans un commit de fusion** (« Garder les deux », résolution de conflit) : ils
  sont datés par ce commit. Sinon, ils restaient proposés indéfiniment.
- **Ajout textuel en fin de fichier**, au lieu d'une relecture et réécriture YAML. Une réécriture
  aurait perdu les commentaires, et transformé les dates non quotées des champs en horodatages
  complets.
- **Cas laissés de côté** : un fichier non complétable (pas d'historique, YAML en style flux) reste
  proposé. Si rien n'a été écrit, aucun commit vide n'est créé.
- **Vérification toutes les 30 s** : un fichier n'est relu que si sa date ou sa taille a changé.
- **Limite connue** : les renommages et déplacements ne sont pas suivis (création = le commit qui
  crée le chemin), comme GH100.

## Mises à jour SPEC (dernier sprint)

Sections de `## Refs SPEC` comparées avec l'implémentation finale :
- `SPEC-REQ` §3.4 et §4.4, `SPEC-TESTS` §2.4a et §4.5, `SPEC-TECH-stack` §6.6 : mises à jour au
  sprint 1, conformes.
- `SPEC-TECH-stack` §4.2 : l'exemple montrait déjà les quatre champs dans le YAML, il est désormais
  exact ; aucune modification.
- `specs/GH336.md` §6 (mise en conformité) : le flux reste inchangé, avec un élément de plus, décrit
  dans `GH340.md` §6.
- `SPEC-INDEX.md` : colonne MAJ → GH340 pour SPEC-REQ §3 et §4, SPEC-TESTS §2–3 et §4.5,
  SPEC-TECH §6.

## Vérifications

- `pnpm typecheck` : OK.
- `pnpm lint` : OK.
- `pnpm test` : OK (desktop 1 749, merge-core 83, admin-service 124).
- e2e (`pnpm build:web` puis `npx playwright test e2e-web/gh340- e2e-web/gh77-history
  e2e-web/gh222-tree-merge e2e-web/gh74-editing`) : gh340 2/2, voisins 18/18.

  Première passe : le test C1/C6 ouvrait la vue « Version produit » (`/versions`), où l'arbre des
  dépôts ne s'affiche pas. Corrigé dans le test (navigation vers `/local-impact`), pas dans
  l'application.
- Non lancé : suite e2e complète (niveau 3, après le « Validé »).

## Tester à la main

1. Ouvrir un projet existant (par exemple handstickProduct, sur sa branche d'intégration, arbre
   propre). Panneau Version : la ligne « dates de création / modification de N objets » apparaît.
2. Cliquer **Plus tard** : la ligne disparaît et aucun fichier n'est modifié.
3. Rouvrir le workspace, puis **Valider** :
   - un commit `[polenta] … (audit-dates)` est poussé ;
   - les objets affichent Créé le / par et Modifié le / par ;
   - une exigence modifiée sur une branche fusionnée porte l'auteur de la modification, pas celui
     de la fusion.
4. Composant épinglé (lecture seule) : aucune proposition (scénario C8).
5. Changer de branche sur handstickProduct : la reconstruction des listes ne doit plus être
   perceptible.
