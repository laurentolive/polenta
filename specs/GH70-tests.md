# GH70 — Scénarios de test

> Spec : [GH70.md](GH70.md) — design : [GH70-design.md](GH70-design.md).
> U = unitaire (`pnpm test`), E = e2e web (`e2e-web/gh70-*.spec.ts`), M = manuel.

## 1. Nominal

| # | Scénario | Attendu | Type | Sprint |
|---|---|---|---|---|
| N1 | Créer depuis `/query` une requête partagée par le modèle « Dernier résultat de campagne » | `query.yaml` contient `column` (libellé, `categories: [test]`, `enum`, 4 valeurs) ; requête non personnalisée | E | 1 |
| N2 | Requête script partagée : cocher « Utiliser comme colonne », type `number`, catégorie Exigences, enregistrer, recharger | déclaration relue à l'identique dans l'éditeur | E | 1 |
| N3 | `create_query` MCP avec `column` puis `list_queries` | `column` renvoyé, `columnError` absent | U | 1 |
| N4 | Vue Système, type de test, ⚙️ onglet Tableau | section « Colonnes calculées » avec « Dernier résultat (calc) », décochée | E | 2 |
| N5 | Cocher la colonne | colonne affichée ; pref `fieldVisibility[...].excel` contient `query::QUERY-xxxx` | E | 2 |
| N6 | Démo : test dont la dernière entrée exécutée est `FAIL` | cellule `FAIL` ; test jamais exécuté en campagne : vide | E | 2 |
| N7 | Survol de la cellule | infobulle `CAMP-xxxx — titre · AAAA-MM-JJ · exécutant` | E | 2 |
| N8 | Double-clic sur la cellule | onglet de la campagne ouvert, entrée ciblée | E | 2 |
| N9 | Saisir un résultat `PASS` sur cette entrée dans la campagne, revenir à la vue | cellule `PASS` sans rechargement | E | 2 |
| N10 | Filtre de colonne T51 `FAIL` | seuls les tests en échec restent | E | 2 |
| N11 | ⚙️ onglet Document, cocher la colonne | valeur affichée dans la carte, libellé « Dernier résultat » | E | 2 |
| N12 | Export Excel de la vue avec la colonne visible | colonne « Dernier résultat » présente avec les valeurs | U (`buildExportRows`) + M | 2 |
| N13 | Impression PDF (cahier de tests) avec la colonne en Document | valeurs présentes, pas de `…` | M | 2 |
| N14 | Sélecteur de tests d'une campagne, colonne visible en Tableau | colonne affichée, infobulle ; double-clic sans effet | E | 2 |

## 2. Bibliothèque (`lastEntryResults`)

| # | Cas | Attendu | Type |
|---|---|---|---|
| L1 | Test exécuté dans deux campagnes (FAIL le 1er, PASS le 3) | PASS (le plus récent) | U |
| L2 | Plus récent dans une campagne `abandoned` | celui-là est retenu | U |
| L3 | Deux instances (test itérant) dans la même campagne | l'instance au `executedAt` le plus récent | U |
| L4 | Seulement un run hors campagne | absent de la `Map` | U |
| L5 | Entrée `pending` (jamais exécutée) ou retirée | ignorée | U |
| L6 | `lastResult` (existante) | résultat inchangé (non-régression) | U |
| L7 | Manifest | nouvelle version de `campaign.js`, ancienne empreinte connue → proposée au bandeau | U |

## 3. Cas limites

| # | Cas | Attendu | Type | Sprint |
|---|---|---|---|---|
| C1 | `column` sur une requête privée (UI « Enregistrer sous » Privé, service, MCP) | refus `COLUMN_PRIVATE`, message lisible | U + E | 1 |
| C2 | Passage partagé → privé d'une requête avec colonne | confirmation ; déclaration retirée ; colonne disparaît de ⚙️ | U + M | 1 |
| C3 | `query.yaml` édité : `type: drawio`, ou enum sans `values`, ou `appliesTo` non objet | `columnError` ; requête exécutable en Suivi ; non proposée en ⚙️ ; erreur visible dans `/query` ; sauvegarde sans corriger refusée | U + E | 1 / 2 |
| C4 | Requête sans `column` : empreinte | identique à avant GH70 (aucune requête de seed détachée) | U | 1 |
| C5 | `update_query` avec `template` et `column` | refus (`column` généré par le modèle) | U | 1 |
| C6 | Script qui `throw` | vue utilisable, cellules vides, ⚠ dans l'en-tête avec `message (script.js:N)` | E | 2 |
| C7 | Ligne sans `id` ou sans `value` | erreur `rows` affichée en ⚠ | U (`columnValuesFromRows`) + E | 2 |
| C8 | Deux lignes pour le même `id` | la première est retenue | U | 2 |
| C9 | `id` inconnu dans les lignes | ignoré | U | 2 |
| C10 | Valeur `MAYBE` pour un enum `[PASS, FAIL]` | affichée telle quelle | U | 2 |
| C11 | `value: null` | cellule vide | U | 2 |
| C12 | Requête supprimée alors que la colonne est cochée | colonne absente des vues et de ⚙️ ; pref non réécrite | E | 2 |
| C13 | Requête avec paramètre obligatoire | ⚠ erreur `params` | U | 2 |
| C14 | Cellule calculée : double-clic, F2, Ctrl+V, Suppr, édition en masse (multi-sélection + édition d'une autre colonne) | aucune écriture sur `query::*` | E | 2 |
| C15 | Colonne non visible dans la vue courante | aucune exécution du script (pas d'appel `suivi:run`) | U (hook) | 2 |
| C16 | Vue Système positionnée sur un repo composant (T72) | colonnes du projet proposées, valeurs correctes | M | 2 |
| C17 | Type d'exigence avec une colonne `categories: [test]` | non proposée | U (`columnAppliesTo`) | 2 |
| C18 | `appliesTo.objectTypes: ['root::cas-de-test']` | proposée pour ce type seulement | U | 2 |
| C19 | Script lent (proche de 2 s) | tableau affiché immédiatement, `…` dans la colonne puis valeurs | M | 2 |
| C20 | Type `richtext` | rendu mis en forme, lecture seule | M | 2 |

## 4. Critères d'acceptation vérifiables

Chaque critère de la spec §7 est couvert : 1 → N4/C17 ; 2 → N5 ; 3 → N6/L4 ; 4 → L1/L2 ; 5 → N9 ;
6 → N7/N8 ; 7 → C14 ; 8 → N10 ; 9 → C6 ; 10 → N11 ; 11 → N12 ; 12 → C1/C3 ; 13 → N3 ;
14 → revue de code (aucune référence à `campaign` dans `useComputedColumns`, `suivi-columns.ts`, vues).
