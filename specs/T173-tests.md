# T173 — Scénarios de test

Réf. : `specs/T173.md`, `specs/T173-design.md`.

Deux niveaux :
- **S** — script de service hors UI (tsx, repos git temporaires, sans Electron), sur
  `RevalidationService.listFlagged` / `clear` ;
- **M** — vérification manuelle dans l'app.

Jeu de données de base (repo racine `prod`, commité) : `SYS-0001` (approved), `SYS-0002`
(approved) enfant de `SYS-0001` (lien `SYS-0002 → SYS-0001`), `TEST-0001` (approved) couvrant
`SYS-0001` (lien `TEST-0001 → SYS-0001`), `SW-0010` (draft) lien `implementation`
`SYS-0001 → SW-0010`. Composant `comp` (repo séparé) : `MC-0001` (approved), lien produit
`MC-0001 → SYS-0001`. Composant `ro` monté sous un nœud `readonly: true` : `RO-0001`.
Marquage initial obtenu en rouvrant `SYS-0001` en brouillon (T172) : `SYS-0002`, `TEST-0001`,
`SW-0010`, `MC-0001` marqués.

## 1. Nominal

| # | Niv. | Action | Attendu | CA |
|---|------|--------|---------|----|
| N1 | S | `listFlagged(prod, ws)` | 4 éléments : `SW-0010`, `SYS-0002`, `MC-0001` (exigences, `MC-0001` avec `repo.name` = `comp`) puis `TEST-0001` ; tri exigences puis tests, par id | CA5 |
| N2 | S | Idem, `linked` de `TEST-0001` | `[SYS-0001]` avec `status: draft`, `approved: false`, `linkType` du lien, `version` courante | CA5 |
| N3 | S | `clear(prod, ['TEST-0001'], ws)` | `cleared: ['TEST-0001']` ; YAML sans clé `needsRevalidation` ; diff git limité à cette ligne ; `status`/`version` inchangés ; `links/links.yaml` inchangé | CA1 |
| N4 | S | `clear` sur `SYS-0002` (approved) | Levée OK malgré l'approbation | CA2 |
| N5 | S | `clear(prod, ['MC-0001'], ws)` | Clé retirée dans `comp/requirements/MC-0001.yaml`, rien écrit dans `prod` | CA2 |
| N6 | S | `clear(prod, ['SW-0010','SYS-0002','SW-0010'], ws)` | Dédupliqué ; `cleared` = 2 ids ; `listFlagged` ne les contient plus | CA4 |
| N7 | S | Après N3, `reqIndex`/`testsIndex.findById('TEST-0001')` | `needsRevalidation` absent (index à jour sans rechargement) | CA6 |
| N8 | S | Après N3, rouvrir à nouveau `SYS-0001` (réapprouvée entre-temps) | `TEST-0001` re-marqué (T172 inchangé) | spec UC7 |
| N9 | M | Analyse « Modifications locales » après réouverture de `SYS-0001` | `TEST-0001`, `SYS-0002`, `SW-0010`, `MC-0001` dans les arbres avec ⚠, case et « Lever le flag » ; `SYS-0001` (élément changé) sans bouton | CA3 |
| N10 | M | Clic « Lever le flag » sur `TEST-0001` | ⚠ disparaît de la ligne, puis sans rechargement : colonne Statut Excel, vue Word, éditeur, cellule de matrice ; l'élément reste dans l'analyse locale sans devenir « élément changé » | CA3, CA6 |
| N11 | M | Cocher 3 nœuds, « Lever le flag de la sélection (3) » | Confirmation « 3 éléments » ; après OK les 3 flags levés, sélection vidée | CA4 |
| N12 | M | Analyse baseline v1.0 → v1.1 contenant `SYS-0002` marqué après sa création | ⚠ + bouton affichés sur le nœud (flag live) ; levée OK ; statut d'impact du nœud inchangé | CA3, CA8 |
| N13 | M | Changer le statut d'impact d'un nœud marqué à `impact_teste` | Flag toujours présent | CA8 |
| N14 | M | Entrée « Impact à vérifier (N) » (sprint 2) | Visible avec N exact ; non sélectionnée automatiquement ; liste = N1 ; dépliage d'une ligne → éléments liés, `SYS-0001` signalé « non approuvé » | CA5 |
| N15 | M | Lever tous les flags depuis la liste de repli | Entrée disparaît, page revient au message d'invite | CA5 |
| N16 | M | Modifier un paramètre utilisé par une exigence approuvée (T171) | Éléments marqués absents des analyses, présents dans « Impact à vérifier », levables | CA5 |
| N17 | M | Clic sur un id (arbre ou liste de repli, élément d'un composant) | Popup ouvert sur l'élément, dans le bon repo | spec §2.3 |

## 2. Cas limites

| # | Niv. | Action | Attendu | CA |
|---|------|--------|---------|----|
| L1 | S | `clear` sur un élément non marqué | `unchanged: [id]`, fichier non réécrit (mtime/contenu identiques) | CA1 |
| L2 | S | `clear` sur un id inexistant | `failed: [{ id, reason: 'not_found' }]`, pas d'exception | CA4 |
| L3 | S | `clear` sur `RO-0001` (marqué à la main dans la fixture) | `failed: readonly`, fichier inchangé | CA2 |
| L4 | S | `clear(['TEST-0001','NOPE-1','SW-0010'])` | `cleared` = 2, `failed` = `NOPE-1` ; les levées réussies sont écrites | CA4 |
| L5 | S | `clear` sur un élément marqué puis passé `obsolete` | Levée effectuée (pas de filtre terminal) | design §4 |
| L6 | S | `listFlagged` sans aucun élément marqué | `[]` | CA5 |
| L7 | S | Élément marqué avec un lien orphelin (pair supprimé) | `linked` n'inclut pas le pair introuvable, pas d'erreur | CA5 |
| L8 | S | `clear` et `update` (autosave du titre) concurrents sur le même élément | Titre modifié **et** flag levé (verrou par fichier, aucun écrasement) | spec §6 |
| L9 | S | `markImpactedBy` après refactor (`buildContext`, `locate`) | Scénarios T172 N1–N6 inchangés | design §5 |
| L10 | M | Même élément présent deux fois dans une analyse (deux éléments changés) | Levée sur une occurrence → ⚠ disparaît des deux | spec UC6 |
| L11 | M | Changer d'analyse active avec une sélection en cours | Sélection vidée | spec §2.2 |
| L12 | M | Analyse locale active, modification externe d'un fichier `requirements/` pendant qu'une sélection existe | Recalcul live ; les nœuds encore marqués restent cochés | spec §2.2 |
| L13 | M | Levée multiple avec un id en échec (fichier en lecture seule sur disque) | Bandeau d'erreur listant l'id et le motif ; les autres levés | CA4 |
| L14 | M | Basculer l'app en EN | Tous les libellés T173 traduits | CA9 |

## 3. Non-régression

| # | Niv. | Vérification | CA |
|---|------|--------------|----|
| R1 | S | Aucun fichier créé sous `impact-acks/` ni `impact-analyses/` par `clear` ; aucun commit | CA7 |
| R2 | M | Statut d'impact, commentaire, export XLSX/PDF et génération de campagne d'une analyse baseline inchangés | CA8 |
| R3 | M | Matrice : cellule `needs_revalidation` redevient `covered`/`validated` après levée des deux extrémités ; maturité critère 5 satisfait | CA6 |
| R4 | — | `tsc` (desktop, types, api-client) sans nouvelle erreur | CA10 |
