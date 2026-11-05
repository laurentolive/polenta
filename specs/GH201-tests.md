# GH201 — Scénarios de test

Auto = test unitaire `versions.gh201.test.ts` / `version-tracking.gh201.test.ts` (repo git
temporaire) ; Manuel = à vérifier dans l'application.

## Nominaux

| # | Scénario | Attendu | Couverture |
|---|---|---|---|
| N1 | Ajouter « + Version » sur le repo racine dans Structure | type `version` avec statuts en_cours / released / abandonnee et champ description | Manuel |
| N2 | « Nouvelle version » sur un repo sans version | `versions/<PFX>-0001.yaml`, statut en_cours, `basedOn` absent | Auto + Manuel |
| N3 | Backlog d'un repo sans version | toutes les exigences / tous les tests non terminaux, `kind: new` | Auto |
| N4 | « Tout inclure » | `changes` = tous, sans `base` ; backlog vide | Auto |
| N5 | Passage released (tag proposé `<repo>-<label>`) | commit du seul fichier de version, tag annoté sur ce commit, `freeze.sha` = HEAD précédent, statut released | Auto |
| N6 | Modifier SW-1 après released, nouvelle version | SW-1 au backlog `modified` ; inclus avec `base { sha: freeze.sha, version }` | Auto |
| N7 | Élément non modifié après released | absent du backlog | Auto |
| N8 | « Ajouter » un élément inchangé | inclus, `base` de sa dernière version released | Auto |
| N9 | « Retirer » | l'élément revient au backlog | Auto |
| N10 | Version produit avec composant : 2 versions released du composant après celle de `basedOn` | la page liste les changements des deux, avec composant et version | Auto |
| N11 | « Voir les modifications » d'une ligne | diff `/diff` base → courant (en cours) / freeze (released) ; nouveau face à vide | Manuel |
| N12 | Push du repo après passage released | tag poussé, retiré de `.git/polenta-pending-tags` | Auto (remote local bare) |
| N13 | Sous-panneau Produit | arbre des repos, versions, Backlog (n), Nouvelle version | Manuel |

## Cas limites

| # | Scénario | Attendu | Couverture |
|---|---|---|---|
| L1 | Second type version / type version sur nœud local | `VERSION_TYPE_INVALID` à l'enregistrement | Auto |
| L2 | ~~Nouvelle version alors qu'une est en cours~~ | Sans objet : plusieurs versions en cours permises (PH2) | — |
| L3 | Label déjà pris par une version non abandonnée | `LABEL_TAKEN` ; repris après abandon : accepté | Auto |
| L4 | Tag existant | `TAG_EXISTS`, rien d'écrit | Auto |
| L5 | Composant de `components` non released | `COMPONENT_NOT_RELEASED` | Auto |
| L6 | Élément inclus modifié non commité | `DIRTY_CHANGES` | Auto |
| L7 | Modifier une version released (titre, changes, components, retour en cours) | `VERSION_LOCKED` ; passage abandonnee accepté | Auto |
| L8 | Passage released par `update({ status })` | refusé (`release` obligatoire) | Auto |
| L9 | Repo en lecture seule (composant épinglé) | création / écriture `READONLY_REPO` ; « Nouvelle version » absente | Auto + Manuel |
| L10 | Exigence obsolète jamais livrée | absente du backlog | Auto |
| L11 | Approuvé modifié hors interface | drapeau `outside` | Auto |
| L12 | Élément de `changes` supprimé | ligne « supprimé » (`category: null`) | Auto |
| L13 | Modification de `history` / `needsRevalidation` seule | pas au backlog | Auto |
| L14 | Échec du push du tag (remote absent) | push de la branche non affecté, tag reste en attente | Auto |
| L15 | Graphe : `versions`, `designVersion` | présents ; `designVersion` = première released contenant la version courante | Auto (sprint 3) |
| L16 | MCP `list_versions` / `get_version` / `get_version_backlog` | lecture seule, résultats cohérents avec l'IPC | Auto (sprint 3) |

> GH271 (2026-11-05) — L9, L16 : `milestone-d-coverage.gh271.test.ts`. Branche avancée pendant la release : `versions.gh201.test.ts`. Push du tag par isomorphic-git : demande un vrai serveur, reste à vérifier à la main (`specs/GH271.md`).
