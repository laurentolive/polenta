# GH446 — Scénarios de test

Référence : [GH446.md](GH446.md) §4 (critères 1 à 18), [GH446-design.md](GH446-design.md).

## Niveau 1 — pendant le développement

- `pnpm typecheck`, `pnpm lint` (fichiers touchés, `eslint <fichiers>` si la base n'est pas encore à jour).
- `npx vitest run` sur les fichiers touchés, dont `channel-policy.test.ts` (classement de tous les canaux).

## Backend — unitaire

| ID | Fichier | Cas | Critère |
|---|---|---|---|
| U1 | `object-history-file.test.ts` | `objectHistoryFile` pour les six kinds → `requirements/`, `tests/`, `campaigns/`, `issues/`, `versions/`, `validations/` | 16 |
| U2 | `object-commits.service.test.ts` | objet modifié trois fois (dépôt git temporaire) → trois entrées, du plus récent au plus ancien, `at`, `by`, `subject` exacts | 12 |
| U3 | idem | fichier jamais commité / dépôt sans commit → `[]` | 14 |
| U4 | idem | commit qui touche un autre fichier : la liste ne compte que les commits de l'objet | 13 |
| U5 | idem | kind inconnu → erreur `unknown object kind` ; `history:get` non modifié (`readEffectiveHistory` inchangé) | 7 |
| U6 | `git.service.test.ts` (ou voisin) | `fileCommits` renvoie `subject` = première ligne du message | 12 |
| U7 | `channel-policy.test.ts` | `history:commits` classé (exposé, arg policy `[0]`) | 17 |

## Renderer — composants

| ID | Fichier | Cas | Critère |
|---|---|---|---|
| R1 | `ObjectCommitsDialog.test.tsx` | aucun appel `commitDiff` au montage ; appel à la sélection d'un commit | 15 |
| R2 | idem | liste vide → « Aucun commit » | 4, 14 |

## E2E — `apps/desktop/e2e-web/gh446-history.spec.ts` (clic souris)

| ID | Cas | Critère |
|---|---|---|
| E1 | Clic droit sur une exigence, un test, une issue, un élément de l'arbre → « Historique » → popup avec les commits de l'objet | 1 |
| E2 | Clic droit sur une version, une campagne, une validation → « Historique » → popup avec les commits du fichier correspondant | 1 |
| E3 | Vue Excel : clic droit sur exigence, test, campagne, issue → même entrée ; version / validation : pas d'entrée | 2, 3 |
| E4 | Vue Word : clic droit sur un bloc exigence → même entrée | 2 |
| E5 | Sélection multiple : entrée désactivée | Q4 |
| E6 | Objet jamais commité : « Aucun commit » ; pas d'erreur | 4 |
| E7 | Composant en lecture seule : entrée présente et popup fonctionnelle | 5 |
| E8 | Ouverture, sélection d'un commit, fermeture : `git status` identique avant / après | 6 |
| E9 | Sélection d'un commit → diff du fichier ; commit multi-fichiers → seul le fichier de l'objet ; premier commit → ajout | 13, 14 |
| E10 | Brut / Rendu : bascule, mémorisée après fermeture et réouverture | 8 |
| E11 | Rendu : un champ modifié à un commit apparaît dans la vue | 18 |
| E12 | Section GH77 des éditeurs inchangée ; la popup n'affiche pas les champs suivis | 10 |
| E13 | Client web : la popup fonctionne (même entrée, même diff) | 17 |

Les e2e s'exécutent sur le build web (`pnpm build:web` puis `npx playwright test e2e-web/gh446-`). Chaque entrée de menu
est testée au clic souris (leçon 2026-11-19, GH416).

## Vérification de niveau 2 — avant la validation

- `pnpm test` complet.
- `npx playwright test e2e-web/gh446-` (les specs du ticket), plus les voisines `gh77-*` (historique des éditeurs) et
  `gh446` pour la non-régression de `HistorySection`.
- Niveau 3 (suite complète) : requis au push du lot, le ticket touche le renderer et les services du main.
