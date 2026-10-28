# GH126 — Scénarios de test

Légende : **U** test unitaire (`pnpm test`), **E** e2e client web (`e2e-web/gh126-*.spec.ts`),
**M** manuel. Les numéros `CA n` renvoient aux critères d'acceptation de `specs/GH126.md` §7.

## 1. Types et validation (U — `suivi-columns.test.ts`)

| # | Scénario | Attendu |
|---|---|---|
| T1 | Déclaration GH70 sans `splitColumn` | `validateColumnDecl` identique à avant ; `columnValuesFromRows` inchangé (CA 1) |
| T2 | `splitColumn: campaignId`, `splitLabelColumn: campaignTitle` | décl. normalisée avec les deux propriétés |
| T3 | `splitColumn: ''` / `null` | absent (colonne simple), pas d'erreur |
| T4 | `splitColumn: 12` | erreur `column.splitColumn : nom de colonne attendu` |
| T5 | `splitLabelColumn` sans `splitColumn` | erreur « réservé aux colonnes éclatées » (CA 12) |
| T6 | `computedColumnKey('QUERY-0007', 'CAMP-0005')` / sans split | `query::QUERY-0007::CAMP-0005` / `query::QUERY-0007` |
| T7 | `parseComputedColumnKey` : simple, sous-colonne, valeur contenant `::`, clé `link::x` | `{queryId}`, `{queryId, split}`, split complet, `null` |

## 2. Éclatement des lignes (U)

| # | Scénario | Attendu |
|---|---|---|
| T8 | Lignes RE2, RP1, RP2 dans cet ordre (valeurs mêlées) | 3 sous-colonnes dans l'ordre de première apparition |
| T9 | Libellé : `splitLabelColumn` présent / vide / absent de la décl. | libellé de la 1re ligne / la valeur / la valeur |
| T10 | Deux lignes même (id, split) | la première retenue |
| T11 | Même id dans deux splits | une valeur dans chaque sous-colonne |
| T12 | Ligne sans valeur de split (absente, `null`, `''`) | erreur « Ligne N (ID) : colonne « campaignId » manquante. », aucune colonne (CA 11) |
| T13 | Valeur de split numérique `3` | clé et libellé `"3"` |
| T14 | 51 valeurs distinctes | erreur « 50 sous-colonnes au maximum (51 trouvées) » (CA 11) |
| T15 | Résultat vide | aucune sous-colonne, pas d'erreur |
| T16 | `_ids` / `tooltip` | cible et infobulle par cellule comme GH70 |

## 3. Persistance et MCP (U)

| # | Scénario | Attendu |
|---|---|---|
| T17 | Enregistrer une requête partagée avec `splitColumn` / `splitLabelColumn` | écrits dans `query.yaml`, relus à l'identique |
| T18 | Requête issue d'un modèle : ajouter `splitColumn` | pas de détachement du modèle (empreinte inchangée) |
| T19 | MCP `create_query` avec `column.splitColumn` | colonne créée ; `list_queries` renvoie les deux propriétés (CA 13) |
| T20 | MCP `create_query` avec `splitLabelColumn` seul | `[COLUMN_INVALID]` (CA 12) |

## 4. Hook et vues (E — `gh126-split-column.spec.ts`, requête Script éclatée sur la démo)

| # | Scénario | Attendu |
|---|---|---|
| T21 | Ouvrir ⚙️ sur un type de test | groupe « libellé » + une case par valeur, ordre du script, toutes décochées (CA 2) |
| T22 | ⚙️ sur un type d'exigence (appliesTo test) | aucun groupe |
| T23 | Cocher 2 sous-colonnes en Tableau | deux colonnes, en-tête = libellé de la sous-colonne ; préférences `query::ID::v1`, `query::ID::v2` (CA 3) |
| T24 | Recharger la vue | colonnes toujours là, pas de saut (colonne de substitution puis valeurs) |
| T25 | Test présent non exécuté / absent | `pending` / cellule vide (CA 4) |
| T26 | Infobulle d'en-tête | « libellé du groupe — libellé » (CA 8) |
| T27 | Double-clic cellule | ouverture de la cible `_ids` (CA 8) |
| T28 | Filtre de colonne `FAIL` sur une sous-colonne | seules les lignes en échec dans cette sous-colonne (CA 9) |
| T29 | Cellule : double-clic d'édition, F2, coller | sans effet (lecture seule) |
| T30 | Saisir un résultat dans une campagne de la démo | cellule mise à jour sans recharger (CA 7) |
| T31 | Créer une nouvelle campagne puis rouvrir ⚙️ | nouvelle case décochée, sans recharger (CA 6) |
| T32 | Supprimer la campagne d'une sous-colonne cochée | colonne disparaît, aucune erreur, préférence non réécrite (CA 6) |
| T33 | Script qui `throw` avec une sous-colonne cochée | ⚠ dans l'en-tête de la sous-colonne, vue utilisable ; ⚠ + message dans le groupe ⚙️ (CA 11) |
| T34 | Onglet Document : cocher une sous-colonne | champ dans la carte Vue Word (CA 10) |
| T35 | Export Excel | une colonne par sous-colonne visible, en-tête = libellé (CA 10) |
| T36 | Colonne GH70 simple existante (« Dernier résultat ») | comportement inchangé (CA 1) |
| T37 | Requête éclatée non visible, ⚙️ fermé | script non exécuté (aucun `suivi:run` pour elle) |

## 5. Saisie `/query` (E)

| # | Scénario | Attendu |
|---|---|---|
| T38 | Cocher « Une colonne par valeur de », choisir `campaignId`, libellé `campaignTitle`, enregistrer | `query.yaml` porte les deux propriétés |
| T39 | Décocher | les deux propriétés retirées |
| T40 | Requête privée | section désactivée (inchangé GH70) |

## 6. Bibliothèque et modèle (U, sprint 2)

| # | Scénario | Attendu |
|---|---|---|
| T41 | `entryResultsByCampaign` : 3 campagnes, ordre de création | ordre RE2, RP1, RP2 ; égalité de date → ordre d'ID |
| T42 | Test itérant PASS + FAIL dans une campagne | `status: FAIL`, `statuses: [PASS, FAIL]` (CA 5) |
| T43 | Test itérant PASS + pending | `pending` |
| T44 | Campagne abandonnée | incluse |
| T45 | Entrées retirées (`removedEntries`) | ignorées |
| T46 | Aucune entrée exécutée | `executedAt: null`, `entryId` de la première entrée |
| T47 | Modèle `campaign-results` : script généré exécuté sur la démo | lignes `id`, `value`, `campaignId`, `campaignTitle`, `tooltip`, `_ids` ; corpus figé |
| T48 | Modèle : déclaration proposée | `splitColumn: campaignId`, `splitLabelColumn: campaignTitle`, enum avec `pending` |
| T49 | Manifest : empreinte v4 = fichier ; v3 connue | bandeau propose la mise à jour (`suivi-updates.test.ts`) |
| T50 | Requête « Entrées de campagne » + `idColumn: testCaseId`, `valueColumn: status`, `splitColumn: campaignId` | une sous-colonne par campagne sans code |

## 7. Manuel (M)

| # | Scénario | Attendu |
|---|---|---|
| M1 | PH2 après mise à jour de la bibliothèque : créer « Résultat par campagne » depuis le modèle | ⚙️ propose RE2, RP1, RP2 ; valeurs identiques à QUERY-0004/5/6 |
| M2 | CA 14 : relecture du diff | aucun code Polenta propre aux campagnes hors `resources/dashboard-lib/` et du modèle |
