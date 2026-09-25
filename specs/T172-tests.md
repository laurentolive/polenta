# T172 — Scénarios de test

Pas de framework de test automatisé dans `apps/desktop` : vérification par `tsc` + tests
manuels dans l'app (et, pour les cas service, un script Node ponctuel si utile).

## Jeu de données de départ

Projet avec (repo produit, workspace avec un composant local et un submodule `readonly`) :
- SYS-A `approved`, SYS-B `approved`, SW-C `draft`, SYS-D `obsolete`
- TEST-T1 `approved`, TEST-T2 `draft`
- COMP-R `approved` (exigence d'un composant local), RO-X (exigence d'un nœud `readonly: true`)
- Liens : T1 → SYS-A (verification, créé depuis le test), SYS-A → SW-C (implementation),
  SYS-A → SYS-D, SYS-A → COMP-R, SYS-A → RO-X, SYS-B → T2 (verification, créé depuis l'exigence)

## Nominaux

| # | Action | Attendu |
|---|--------|---------|
| N1 | « Rouvrir en brouillon » sur SYS-A (vue Word) | T1, SW-C, COMP-R ont `needsRevalidation: true` dans leur YAML ; SYS-A non marqué ; T1 reste `approved`, version inchangée |
| N2 | Idem, vérifier sens | T1 (lien créé test → exigence) et SW-C (exigence → exigence) marqués : sens indifférent |
| N3 | Vue Excel, colonne Statut de SYS-B : `approved` → `review` | T2 marqué (lien créé exigence → test) |
| N4 | Vue Excel, statut de TEST-T1 (après l'avoir réapprouvé) : `approved` → `draft` | SYS-A marqué |
| N5 | « Rouvrir en brouillon » sur un test approuvé | Ses exigences liées marquées |
| N6 | Lien inter-repo (COMP-R dans un composant local / autre repo du workspace) | Flag écrit dans le YAML de COMP-R dans **son** repo |
| N7 | Affichage | ⚠ à côté du statut de T1, SW-C, COMP-R dans Excel, Word, Édition ; infobulle « Impact à vérifier » (FR) / « Impact to check » (EN) |
| N8 | Matrice de traçabilité | Cellule SYS-A × T1 = `needs_revalidation`, statut de couverture de SYS-A = `needs_revalidation` |
| N9 | Query Builder | Colonne `needsRevalidation` = `true` sur T1, SW-C ; `false` ailleurs ; absente de la table des liens |
| N10 | Maturité de SW-C | Critère « impact à vérifier » non satisfait |

## Cas limites

| # | Cas | Attendu |
|---|-----|---------|
| L1 | SYS-D `obsolete` (isTerminal) lié à SYS-A | Non marqué |
| L2 | RO-X dans un nœud `readonly: true` | Non marqué, aucune écriture dans son repo, pas d'erreur visible |
| L3 | Lien orphelin (pair supprimé) | Ignoré, la réouverture réussit |
| L4 | Élément sans aucun lien rouvert | Réouverture OK, aucune écriture |
| L5 | Auto-lien (source = cible = X) | X non marqué |
| L6 | Pair déjà marqué, nouvelle réouverture de SYS-A après réapprobation | Flag toujours `true`, YAML non réécrit |
| L7 | Édition d'un champ de SW-C (brouillon) | Aucun marquage de ses pairs |
| L8 | Transition `draft` → `review` → `approved` de SYS-A | Aucun marquage |
| L9 | Pair `approved` (T1) — verrouillé en UI | Marqué malgré le verrou ; reste non éditable |
| L10 | Édition d'un champ d'un élément marqué (après réouverture de celui-ci) | `needsRevalidation` préservé dans le YAML (pas écrasé par `update`) |
| L11 | Élément non marqué | Aucune clé `needsRevalidation` dans son YAML ; pas d'icône |
| L12 | Multi-sélection Excel : statut `approved` → `draft` sur 2 exigences liées entre elles | Chacune marque l'autre ; pas d'interblocage, pas d'erreur |
| L13 | `links/links.yaml` après N1 | Inchangé (diff git vide) |
| L14 | Échec d'écriture d'un pair (fichier en lecture seule sur disque) | Erreur loggée, autres pairs marqués, réouverture de X réussie |
| L15 | `links.yaml` existant avec `needsRevalidation: false` sur les liens | Lecture sans erreur ; aucun impact |
| L16 | Compliance d'interface : rouvrir l'exigence d'interface implémentée par COMP-R | La cellule de COMP-R passe à `covered` (plus `validated`) |

## Critères d'acceptation vérifiables

- `pnpm -C apps/desktop exec tsc --noEmit` (et `packages/types`, `packages/api-client`) : zéro
  nouvelle erreur.
- `grep -rn "computeNeedsRevalidation\|findLinksNeedingRevalidation\|computeRevalidationReqIds" apps/desktop/src packages` : aucun résultat.
- `grep -rn "\.needsRevalidation" apps/desktop/src` : aucune lecture sur un `ObjectLink`.
- CA1 à CA9 de `specs/T172.md` couverts par N1–N10 et L1–L16.
