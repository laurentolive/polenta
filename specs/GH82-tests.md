# GH82 — Scénarios de test

Légende : **[U]** unitaire vitest, **[E]** e2e client web (`e2e-web/gh82-*.spec.ts`), **[M]** manuel.

## Logique pure — `renameValues` [U]

| # | Scénario | Attendu |
|---|----------|---------|
| P1 | statut `review → en-revue`, objet en `review` | `status` et valeurs de `history.status` réécrits |
| P2 | objet dans un autre statut | `null` (inchangé) |
| P3 | enum `haute → high` | `fields.f` et `history.f` réécrits |
| P4 | multi_enum `"haute, basse"`, `haute → high` | `"high, basse"` ; tableau YAML `[haute, basse]` → `[high, basse]` |
| P5 | échange `a ↔ b` | objets `a` → `b`, `b` → `a` |
| P6 | renommage d'un champ absent de l'objet | `null` |
| P7 | entrée d'historique sans `value` (événement) | intacte |

## Éditeur — détection [U]

| # | Scénario | Attendu |
|---|----------|---------|
| D1 | statut renommé (même ligne) | `{ status, from, to }` |
| D2 | statut supprimé puis ajouté | aucun renommage |
| D3 | enum `a, b, c` → `a, bb, c` | `b → bb` |
| D4 | enum `a, b` → `a, b, c` (ajout) | aucun renommage pour ce champ |
| D5 | champ renommé `prio → priorite` + valeur `haute → high` | cible `priorite` |
| D6 | champ enum passé en `text` | aucun renommage de valeur |
| D7 | `default: haute`, renommage retenu | `default: high` ; renommage décoché : inchangé |

## Main — migration et aperçu [U]

| # | Scénario | Attendu |
|---|----------|---------|
| M1 | statut renommé, exigences du type | migrées, aucune nouvelle entrée d'historique, pas de `needsRevalidation`, `version` inchangée |
| M2 | statut d'approbation d'un type de test renommé | copies `testSnapshot` migrées dans toutes les campagnes ; `snapshots` compté |
| M3 | enum d'un type de campagne | campagnes du type migrées |
| M4 | aperçu | `withOld` / `withNew` justes, rien n'est écrit |
| M5 | fichier en échec | les autres migrés, échec listé |
| M6 | `rewriteObjects` : le renommage de champ (GH77) reste vert | tests GH77 inchangés |
| M7 | canal IPC : `objectTypeRef` ou renommages mal formés | erreur |

## Bout en bout [E]

| # | Scénario | Attendu |
|---|----------|---------|
| E1 | Renommer un statut dans l'onglet Structure → confirmation (nombre d'objets) → Enregistrer et migrer | bannière ; exigences migrées (IPC) ; libellé affiché dans le détail |
| E2 | Renommer deux valeurs, décocher l'une | seule la ligne cochée migrée ; schéma enregistré avec les deux |
| E3 | Annuler dans la confirmation | schéma inchangé, l'édition reste ouverte |
| E4 | Renommer vers une valeur portée par un objet | avertissement de collision visible |

## Manuel [M]

- Statut d'approbation d'un type de test renommé : page d'une campagne contenant un brouillon de ce
  type, pas de pastille « Non approuvé » erronée (GH68).
- Réordonner puis renommer des valeurs dans la même édition : la confirmation montre les
  propositions, on décoche les fausses.

## Non-régression

`pnpm test`, `pnpm --filter @polenta/desktop test:e2e:web` (dont `gh77-history.spec.ts`), `tsc`.
