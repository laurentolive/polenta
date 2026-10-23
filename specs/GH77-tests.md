# GH77 — Scénarios de test

Légende : **[U]** unitaire vitest, **[E]** e2e client web (`e2e-web/gh77-*.spec.ts`), **[M]** manuel.
Sprint entre crochets.

## Logique pure — `history.ts` [S1]

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| P1 | `applyHistory(null, req draft)` | `history.status = [{ value: draft, at, by }]` | U |
| P2 | Création avec `priority: high` suivi, `statement` richtext suivi | entrée `priority` avec valeur, `statement` sans valeur | U |
| P3 | Création avec champ suivi vide (`''`, absent, `[]`) | aucune entrée pour ce champ | U |
| P4 | `status` draft → review | 1 entrée `review` ajoutée | U |
| P5 | Même valeur avant / après | `history` inchangé (référence identique ou deep-equal) | U |
| P6 | `multi_enum` `"a, b"` → `"b,a"` | aucune entrée | U |
| P7 | Champ vidé | entrée `value: null` | U |
| P8 | 2 champs changés dans un appel | 2 entrées, même `at` | U |
| P9 | `trackStatusHistory: false` | aucune entrée de statut, entrées existantes conservées | U |
| P10 | Champ non suivi modifié | aucune entrée ; `history.<champ>` existant conservé | U |
| P11 | Dernière entrée `review`, valeur avant `approved` (édition à la main), après `obsolete` | insère `approved` (date/auteur du fallback) puis `obsolete` | U |
| P12 | Clé sans entrée, valeur avant `draft`, après `review` (ancienne app / suivi activé) | `draft` avec `source: schema`, puis `review` | U |
| P13 | `effectiveHistory` valeur courante ≠ dernière entrée | entrée finale `implicit: true`, `at/by` du fallback | U |
| P14 | `effectiveHistory` fichier jamais commité (fallback null) | `at` = now, `by` absent | U |
| P15 | `effectiveHistory` champ mode événement | jamais d'entrée implicite | U |
| P16 | Type introuvable (`typeDef` null) | statut suivi, champs non | U |
| P17 | `withoutHistory` | clé retirée, reste intact | U |

## Fusion — `merge-core` [S1]

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| F1 | Les deux branches ajoutent une entrée `status` différente | union triée par `at`, pas de conflit | U |
| F2 | Entrée identique des deux côtés | dédoublonnée | U |
| F3 | `history` absent d'un côté | l'autre côté retenu, pas de conflit | U |
| F4 | Clés différentes de chaque côté (`status` / `priority`) | les deux clés présentes | U |
| F5 | Fusion complète dans l'outil (GH37) de deux branches modifiant le statut du même objet | aucun bloc sur `history`, résultat publié | M |

## Écritures (main) [S1]

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| W1 | `requirements.create` | `history.status` draft, `by` = acteur | U |
| W2 | `requirements.transition` / `openDraft` / `update` (champ suivi) | 1 entrée chacun | U |
| W3 | `requirements.update` sans changement (autosave) | fichier sans nouvelle entrée | U |
| W4 | `tests.create` / `update` (statut direct) / `openDraft` | 1 entrée chacun | U |
| W5 | `campaigns.create` | `history.status` planned | U |
| W6 | `campaigns.updateRun` sur campagne `planned` | entrée `in_progress` ; 2e résultat : rien | U |
| W7 | `campaigns.close(completed)` | entrée `completed` | U |
| W8 | `campaigns.update` champ personnalisé suivi | entrée | U |
| W9 | Pose / levée de `needsRevalidation` (T172 / T173) | aucune entrée (sauf comblement d'écart) | U |
| W10 | `retargetObjectTypeRef`, déplacement d'élément | aucune entrée | U |
| W11 | Bulk import MCP (exigences, tests, campagnes) | `by` = `--user` ou `local`, `source: mcp` | U |
| W12 | Test garde-fou : aucun `writeYaml` d'objet hors méthode désignée | passe ; échoue si on en ajoute un | U |
| W13 | Campagne : ajout d'un test (copie), report GH64, resynchro GH68 | `testSnapshot` sans `history` | U |
| W14 | Fichier pré-GH77 sans `history` : lecture puis écriture | aucune erreur, historique démarre (P12) | U |
| W15 | Deux écritures concurrentes sur le même objet (autosave + transition) | les deux entrées présentes (verrou) | U |
| W16 | Client web : changement de statut | `by` = login de la session | E |
| W17 | Desktop : changement de statut dans la vue Tableau, bouton de transition, « Rouvrir » | 1 entrée chacun dans le YAML | M |

## Lecture [S1]

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| L1 | `history:get` sur exigence au YAML modifié à la main | entrée `implicit: true` en dernier | U |
| L2 | `history:get` campagne sans écart | pas d'appel `fileHistory` | U |
| L3 | Tool MCP de lecture d'un objet | `history` présent, implicite marqué | U |

## Configuration et renommage [S2]

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| C1 | Nouveau type : case « Historiser le statut » cochée ; enregistrer | pas de clé `trackStatusHistory` dans le YAML | U/E |
| C2 | Décocher → enregistrer | `trackStatusHistory: false` | E |
| C3 | Cocher « Historiser » sur un champ enum | `trackHistory: true` ; une édition du champ ajoute une entrée | E |
| C4 | Infobulle mode événement sur richtext / textarea | texte « date et auteur seulement » | M |
| C5 | MCP `add_object_type` avec `trackHistory` | clé conservée dans `schema.yaml` | U |
| R1 | Renommer `priority` → `criticite` (suivi) | valeurs et `history` migrés sur tous les objets du type ; aucune nouvelle entrée | U/E |
| R2 | Objet ayant déjà `fields.criticite` | non modifié, listé « non migré » | U |
| R3 | Fichier illisible parmi les objets | les autres migrés, échec listé | U |
| R4 | Supprimer un champ puis en ajouter un du même nouveau nom | pas de migration | U |
| R5 | Renommer un champ d'un type de composant (autre repo) | objets du repo composant migrés | M |
| R6 | Renommer deux champs en même temps (`a`→`b`, `b`→`c`) | migration correcte (ordre géré, pas d'écrasement) | U |
| R7 | Renommer un champ de type campagne | campagnes migrées | U |

## Reprise git et affichage [S3]

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| B1 | Repo de démo : exigence passée draft → review → approved en 3 commits | 3 entrées `source: git`, dates et auteurs des commits | U |
| B2 | Relancer la reprise | aucune entrée ajoutée | U |
| B3 | Entrée applicative déjà présente pour un changement commité | pas de doublon `git` | U |
| B4 | Champ richtext suivi modifié dans 2 commits | 2 entrées sans valeur | U |
| B5 | Commit de fusion | changements vus par le premier parent, pas de doublon | U |
| B6 | Fichier YAML corrompu dans un commit | ignoré, listé dans `failed` | U |
| B7 | Mesure sur repo 2 000 objets × 200 commits | temps noté dans le résumé de sprint | M |
| B8 | Bouton panneau Projet : confirmation, progression, compte rendu, fichiers à publier | conforme | E/M |
| H1 | Section « Historique » d'une exigence | repliée ; statut puis champs ; libellés du schéma | E |
| H2 | Valeur retirée du schéma | affichée brute | U/M |
| H3 | Entrées `mcp`, `git`, `schema`, implicite | badges correspondants | E |
| H4 | Campagne et test | section présente | E |
| H5 | Objet sans historique | message « Aucun historique » | E |

## Non-régression

- `pnpm test` complet, `pnpm --filter @polenta/desktop test:e2e:web` (GH65, GH68, GH69, GH71).
- `tsc` zéro erreur nouvelle.
- Fusion GH37 existante (tests merge-core) inchangée hors `history`.
