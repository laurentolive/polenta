# GH210 — Sprint 1 : reflets Design et Validation

## Fichiers modifiés

- Types : `packages/types/src/validation.ts` (`RequirementReflections`, `RequirementReflectionsList`).
- Main :
  - `reflections.service.ts` (nouveau) ;
  - `versions.service.ts` (`designOf`, `releasedVersions`) ;
  - `container.ts` ;
  - `ipc/index.ts` (`reflections:list`).
- Web : `channel-policy.ts` (`reflections:list` exposé, `ROOT_ARGS` `[0, 2]`).
- Client : `packages/api-client` (`reflections.list`).
- Renderer :
  - `ReflectionCell.tsx` (nouveau : colonnes, texte, valeur avec lien) ;
  - `SystemView.tsx` (chargement à la demande, export) ;
  - `ExcelView.tsx`, `WordView.tsx`, `EditView.tsx`, `FieldConfigModal.tsx` ;
  - `lib/exportColumns.ts` (libellés) ;
  - `useLiveFileSync.ts` ;
  - `fr.json`, `en.json`.
- Tests :
  - `reflections.gh210.test.ts` (7 tests) ;
  - `e2e-desktop/gh210-reflections.spec.ts` ;
  - `e2e-web/gh224-coverage-filter.spec.ts` (en-tête renommé).

## Comportement implémenté

- **Colonnes** : Design (« 1.0 ») et Validation (« Conforme (1.0) »), « — » sinon.
  - Vue Tableau : colonnes, filtrées sur le texte.
  - Vue Document : en-tête de carte.
  - Vue Édition : toujours affichées pour une exigence, comme la vérification.
  - Export xlsx et docx : texte affiché.
- **Calcul** : par le repo propriétaire du type, seulement si une colonne est visible ou la vue Édition ouverte. Invalidé quand une version, une validation, une exigence, le schéma ou `polenta-repo.yaml` change.
- **Validation retenue** : la dernière validation signée dans l'ordre des livraisons. Une annulée est ignorée, et une exigence sans entrée n'a pas de reflet.
- **Lien vers la version** : le label ouvre `/version/$versionId` sur le desktop (`capabilities.productValidation`) ; texte seul sur le web.
- **Libellé** : la colonne de couverture s'appelle « Vérification », y compris dans la fenêtre d'aperçu d'un élément (même clé de libellé).

## Divergences avec le design

- **e2e** : écrit sur le **desktop** plutôt que sur le web. Les canaux `versions:*` et `validations:*` ne sont pas exposés au web, ce qui empêche de préparer une version et une validation par IPC. Le reflet sur le web (U11) reste à vérifier à la main.
- **Libellés d'en-tête** : la vue Tableau les lit dans la table figée de `lib/exportColumns.ts`, pas dans i18n. Les trois libellés y sont donc ajoutés ou renommés, comme `coverageStatus` jusqu'ici.
- **Tri** : la vue Tableau ne trie pas ses colonnes (ordre de l'arbre), il n'y a donc rien à ajouter. Filtre et export portent bien sur le texte affiché.

## Mises à jour SPEC

- **SPEC-REQ §13** : reflets dans les vues exigence (règle de la validation retenue, repo propriétaire, rien de stocké).
- **SPEC-SYSTEM-VIEW** : colonnes `designStatus` / `validationStatus` (configuration des champs), « Vérification » pour le filtre par colonne.
- **SPEC-WEB §11** : reflets disponibles sur le web, label sans lien jusqu'à #252.
- **SPEC-INDEX** : colonne MAJ → GH210 pour SPEC-REQ §13, SPEC-SYSTEM-VIEW (configuration des champs) et SPEC-WEB ; mots-clés de SPEC-REQ §13.

## Vérifications

- `pnpm typecheck` : OK.
- Tests unitaires desktop : 1392 OK, dont 7 nouveaux.
- e2e desktop : `gh210` 1/1 (couvre I1, I2, I6, I7), `gh204` + `gh202` 2/2.
- e2e web : `gh224` (en-tête renommé), `gh206`, `gh203` (vues enregistrées) : 17 réussis.
- Suite e2e complète : non lancée (au merge sur `main`).

## Comment tester manuellement

1. Sur un repo avec une version released et une validation signée, ouvrir la vue Tableau d'un type d'exigence. Dans ⚙️, cocher Design et Validation : les colonnes affichent la version et la décision.
2. Cliquer sur le label de version : la page de la version s'ouvre.
3. Annuler la validation dans la vue Validation : la colonne Validation retombe sur la signée précédente, ou sur « — ».
4. Vue Document et vue Édition : mêmes reflets.
5. Client web : reflets affichés, labels sans lien.
6. Enregistrer une vue avec la colonne Design, la rouvrir : la colonne revient.
