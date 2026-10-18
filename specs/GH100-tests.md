# GH100 — Scénarios de test

Fixture : workspace à 2 repos — `prod` (racine, nœud `root`, type `PRODUCT_REQ`, `links/links.yaml`,
une campagne) et `comp` (nœud `root`, types `COMP_REQ` (2 exigences `COMP_REQ-0001/0002`) et
`COMP_TEST` (1 test `COMP_TEST-0001` avec 2 runs), arbre `.polenta/trees/root/COMP_REQ.yaml` avec
un dossier).

## Main — `type-rename.util.ts` (pur)

- **T1** `renumberAll` : `COMP_REQ-0001` réécrit ; `COMP_REQ-00011`, `XCOMP_REQ-0001`,
  `A-COMP_REQ-0001` intacts ; `COMP_TEST-0001-2` (entryId) et `COMP_TEST-0001-run-0003` réécrits.
- **T2** chemin par segments : `test-runs/COMP_TEST-0001/COMP_TEST-0001-run-0001.yaml` →
  `test-runs/NEW_TEST-0001/NEW_TEST-0001-run-0001.yaml`.
- **T3** permutation sans collision : deux paires appliquées en une passe ne se recouvrent pas
  (pas de réécriture d'un ID déjà réécrit).

## Main — `TypeRenameService`

- **T4** nom + préfixe `COMP_REQ` → `VE22D_REQ` : fichiers `VE22D_REQ-0001/0002.yaml` (`id`,
  `objectTypeRef: root::VE22D_REQ`), anciens fichiers absents, `history` identique, pierres tombales
  `COMP_REQ-0001/0002` dans `comp`, arbre `trees/root/VE22D_REQ.yaml` (`typeId`, `objectId`s,
  dossier conservé), ancien arbre absent.
- **T5** lien dans `prod/links/links.yaml` (`targetId: COMP_REQ-0001`) → `VE22D_REQ-0001` ; une
  ref `root::COMP_REQ` dans les `linkTypes` de `prod` et de `comp` → `root::VE22D_REQ`.
- **T6** test `COMP_TEST` → `NEW_TEST` (préfixe) : campagne de `prod` (`testCaseIds`, `entryId`,
  `runs[].testCaseId`, `testSnapshot.id`, `testSnapshot.objectTypeRef`), dossier et fichiers
  `test-runs/`, `runId` dans le contenu — tous migrés.
- **T7** nom seul (préfixe inchangé) : IDs et noms de fichier inchangés ; `objectTypeRef`, arbre,
  refs de liens migrés.
- **T8** collision : `comp/.polenta/tombstones/VE22D_REQ-0002` existe (ou une pierre tombale
  `VE22D_REQ-0002` dans `prod`) → `plan.errors` = `ID_COLLISION`, `apply` refuse, **aucun fichier
  modifié** (comparaison du contenu des deux repos avant / après).
- **T9** collision de ref : `prod` déclare aussi un type `root::COMP_REQ` → les `linkTypes` de `prod`
  ne sont pas réécrits, ceux de `comp` oui ; snapshot de campagne d'un test de `prod` de type
  `root::COMP_REQ`-homonyme non touché.
- **T10** repo du workspace absent du disque → `REPO_MISSING`, aucune écriture. Type campagne :
  changement de préfixe → `objects` vide, IDs `CAMP-NNNN` inchangés.

## Renderer

- **T11** `typeRename(updated, raw)` : `null` si nom et préfixe inchangés ; DTO sinon (nom seul,
  préfixe seul, les deux).
- **T12** flux : plan avec erreurs → message, `schema.save` non appelé.
- **T13** flux : Annuler la confirmation → ni `schema.save` ni `renameType`.
- **T14** flux : renommage de champ + de type dans la même édition → `renameFields` appelé avec
  l'**ancien** `objectTypeRef`, puis `renameType`.

## Manuel (PH2)

- **M1** `hmi-PH2` : remettre `HMI_PH2_REQ` (nom + préfixe) → les 2 exigences réapparaissent ;
  renommer en `VE22D_REQ` → confirmation « 2 objets », puis elles restent visibles sous
  `VE22D_REQ-0001/0002`, même ordre.
