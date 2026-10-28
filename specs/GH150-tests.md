# GH150 — Scénarios de test

Tests unitaires (vitest) sur un dossier temporaire avec `GitService` réel, comme
`history.writes.test.ts`. Fichiers : `update-validation.gh150.test.ts`, `update.tools.gh150.test.ts`,
`parameters.tools.gh150.test.ts`.

## Nominal

- U1 — `update_requirements` `dryRun` : aucun fichier modifié ; aperçu avant/après par champ.
- U2 — `title` + `fields` modifiés : fichier réécrit, autres champs conservés, `history` du champ suivi
  avec `source: mcp`.
- U3 — `fields: { x: null }` retire `x`.
- U4 — exigence `approved` → `draft` : version +1, `needsRevalidation` sur l'élément lié.
- U5 — statut + champs dans la même entrée : champs puis statut, deux entrées d'historique.
- U6 — `update_tests` : `steps` remplacés, statut changé.
- U7 — fichier réécrit au format `writeYaml` : relu puis réécrit par le service → identique.
- P1 — `list_parameters` : paramètres et `usageCounts`.
- P2 — `set_parameters` crée et modifie ; `parameters.yaml` trié.
- P3 — `set_parameters` change la valeur d'un paramètre utilisé par une exigence approuvée → marquée.
- P4 — `delete_parameter` d'un paramètre inutilisé → supprimé.

## Cas limites

- E1 — ID inconnu → erreur sur l'entrée, les autres passent.
- E2 — `status` inconnu du type → erreur `field: status`.
- E3 — clé de `fields` non déclarée → erreur ; valeur d'enum hors liste → erreur.
- E4 — champ `required` vidé (`null`) → erreur ; champ EARS non conforme → erreur.
- E5 — objet d'un repo en lecture seule → `READONLY_REPO`.
- E6 — `entries` vide → résultat vide, pas d'erreur.
- P5 — `delete_parameter` d'un paramètre utilisé par un élément non terminal → `deleted: false` + usages.
- P6 — `set_parameters` nom invalide → erreur sur l'entrée.
- P7 — `repo` inconnu → erreur.

## Garde-fous existants

- `history.write-paths.test.ts` (W12) : aucune écriture d'objet hors `persist` — les nouveaux tools
  passent par les services, le test ne doit pas changer.
- `AGENTS.md` : version du gabarit incrémentée.
