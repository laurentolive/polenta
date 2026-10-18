# GH100 — Sprint 1 : moteur de migration (main process)

## Livré
- Types partagés : `TypeRenameDto`, `TypeRenamePlan` (`packages/types/src/schema.ts`),
  `TypeRenameResult` (`history.ts`).
- `services/type-rename.util.ts` (pur) : `idRenamer` (une passe, frontières d'ID de GH37),
  `renamePath` (par segment), liste blanche `ID_DATA_DIRS`, `listDataFiles`, `pruneEmptyDirs`.
- `services/type-rename.service.ts` : `plan` (aperçu sans écriture) et `rename` (pré-contrôles
  tout ou rien `REPO_MISSING` / `ID_COLLISION`, puis préfixe → nom, au mieux par fichier).
- `TreeService.renameTypeTree` ; `CampaignsService.rewriteSnapshots(…, onlyIds)`.
- Câblage : `container.ts`, IPC `schema:preview-type-rename` / `schema:rename-type` (validation
  du DTO, `GRAPH_WRITE_CHANNELS`), liste blanche du client web (`channel-policy.ts`, chemins
  `[0, 1]`), `api-client` (`previewTypeRename`, `renameType`).

## Écart au design
- Les objets migrés par le changement de préfixe ne sont pas recomptés par l'étape « nom » :
  compte rendu intermédiaire fusionné sans doublon (trouvé par T4).

## Tests
`type-rename.util.test.ts` (T1–T3), `type-rename.service.test.ts` (aperçu + T4–T10) : 11/11.
`pnpm typecheck` OK ; suite desktop complète : 611/611.

## Sprint 2
Renderer : `typeRename` (objectTypeEditor), modale de confirmation, flux `StructureTab`
(champs → valeurs → type), i18n, doc SPEC (T11–T14).
