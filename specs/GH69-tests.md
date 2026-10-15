# GH69 — Scénarios de test : widget « Matrice »

Spec : [GH69.md](GH69.md) — Design : [GH69-design.md](GH69-design.md).

Jeu de données de référence (projet démo ou fixture e2e) : 3 campagnes CAMP-A (créée J1), CAMP-B
(J2), CAMP-C (J3) ; tests TEST-0002, TEST-0010, TEST-0003.

| Campagne | TEST-0002 | TEST-0003 | TEST-0010 |
|---|---|---|---|
| CAMP-A | PASS | FAIL | — (absent) |
| CAMP-B | PASS + FAIL (2 instances) | pending | PASS |
| CAMP-C | — | BLOCKED + PASS | PASS + PASS |

Requête Q1 : `SELECT testCaseId, testTitle, campaignId, campaignCreatedAt, status FROM campaign_entries ORDER BY campaignCreatedAt`.
Widget W1 : Matrice, Lignes `testCaseId`, Libellé `testTitle`, Colonnes `campaignId`, Valeur `status`.

## Nominal

| # | Scénario | Attendu | Auto |
|---|---|---|---|
| N1 | `SELECT campaignId, campaignCreatedAt FROM campaign_entries` | `campaignCreatedAt` = `createdAt` de la campagne, identique sur toutes ses lignes | unit |
| N2 | Builder sur un type de campagne | `campaignCreatedAt` proposé, opérateurs de date | manuel |
| N3 | Popup widget, type « Matrice » | 4 sélecteurs (Lignes, Libellé facultatif, Colonnes, Valeur) ; Enregistrer désactivé tant que Lignes/Colonnes/Valeur vides | e2e |
| N4 | W1 sur Q1 | Colonnes CAMP-A, CAMP-B, CAMP-C dans cet ordre ; lignes TEST-0002, TEST-0003, TEST-0010 dans cet ordre ; libellés de test à côté | unit + e2e |
| N5 | Cellule TEST-0002 × CAMP-B | `FAIL ×2`, couleur danger, infobulle « 1 PASS, 1 FAIL » (libellés traduits) | unit + e2e |
| N6 | Cellule TEST-0003 × CAMP-C | `BLOCKED ×2`, couleur warning | unit |
| N7 | Cellule TEST-0010 × CAMP-C | `PASS ×2`, couleur success | unit |
| N8 | Cellule TEST-0003 × CAMP-B | `pending` (neutre), sans compteur | unit |
| N9 | Cellule TEST-0010 × CAMP-A | « · » neutre, distinct visuellement de `pending`, non cliquable | unit + e2e |
| N10 | Clic sur TEST-0002 × CAMP-B | Popup Détail : exactement les 2 entrées ; clic sur une entrée exécutée → résultat d'exécution dans un nouvel onglet | e2e |
| N11 | Clic en-tête de ligne TEST-0003 | Fiche du test ouverte dans un nouvel onglet | e2e |
| N12 | Clic en-tête de colonne CAMP-B | Page campagne ouverte | e2e |
| N13 | Widget enregistré, dashboard rouvert | Mapping conservé, rendu identique | e2e |
| N14 | Requête modifiée (ORDER BY campaignCreatedAt DESC) | Colonnes inversées CAMP-C, CAMP-B, CAMP-A | unit |

## Agrégations non statut

| # | Scénario | Attendu | Auto |
|---|---|---|---|
| A1 | `SELECT testCaseId, campaignId, COUNT(*) AS n FROM campaign_entries GROUP BY testCaseId, campaignId`, Valeur `n` | Nombre d'entrées par cellule (TEST-0002 × CAMP-B = 2) | unit |
| A2 | Deux lignes de valeur `3` et `4` (nombre ou chaîne numérique) dans la même cellule | `7` | unit |
| A3 | Valeur `executedBy` avec « alice », « bob », « alice » | « alice, bob » ; infobulle texte complet | unit |
| A4 | Cellule mêlant `PASS` et un texte libre | Rendu texte « PASS, xxx », sans couleur de statut | unit |
| A5 | Valeur `executed` (booléen) | Rendu texte (pas de somme), pas d'erreur | unit |

## Cas limites

| # | Scénario | Attendu | Auto |
|---|---|---|---|
| L1 | Résultat vide | État « Aucune donnée » | unit |
| L2 | Mapping incomplet (ex. basculé depuis « Barres » sans `series`) | État « Choisissez les lignes, les colonnes et la valeur » | unit + e2e |
| L3 | Lignes ou Colonnes `null` | Regroupées sous « — », triées en dernier côté lignes ; en-tête « — » non cliquable | unit |
| L4 | Colonne choisie absente du résultat (requête modifiée après coup) | Toutes les lignes sous « — » ou état vide, jamais d'exception | unit |
| L5 | Tri naturel : TEST-0002, TEST-0010, TEST-0003, test-0001 | test-0001, TEST-0002, TEST-0003, TEST-0010 | unit |
| L6 | Colonnes = `campaignTitle` (non-ID) ; en-têtes `executedDay`, statut, colonne concaténée | En-têtes non cliquables (seule une valeur en forme d'ID `PREFIXE-123` l'est) ; ID bien formé mais inexistant → mention « Objet introuvable » | e2e |
| L7 | Une seule ligne / une seule colonne | Matrice 1 × N ou N × 1 correcte | unit |
| L8 | 200 tests × 30 campagnes (~6 000 lignes) | En-tête et première colonne restent visibles au défilement horizontal/vertical ; pas de gel perceptible (< 300 ms de rendu) | manuel |
| L9 | Aperçu dans la popup de configuration | Rendu identique, rien de cliquable | e2e |
| L10 | Impression du dashboard (`printMode`) | Rendu statique, pas de curseur pointer, pas de clic | manuel |
| L11 | Thème sombre | Couleurs de statut lisibles (tokens `status-*`), fond des colonnes figées opaque | manuel |
| L12 | Requête privée dans un dashboard partagé | Non proposée (règle §3.1 inchangée) | existant |
| L13 | Drill-down d'une requête SQL non réécrivable (jointure) | Popup en mode repli « Détail non disponible… », lignes du résultat portant les deux valeurs | manuel |

## MCP

| # | Scénario | Attendu | Auto |
|---|---|---|---|
| M1 | `add_widget` type `matrix`, mapping `{category, series, measure, label}`, `dryRun: false` | Widget créé, visible dans l'app | unit (tools) |
| M2 | `update_widget` passant un widget `bar` en `matrix` | Accepté | unit (tools) |
| M3 | `add_widget` avec clé de mapping inconnue | Rejeté (schéma strict, inchangé) | existant |

## Non-régression

- Widgets barres / camembert / courbe / KPI / table inchangés (rendu, drill-down) — e2e GH65 verts.
- Page campagne : pastilles de statut identiques après déplacement de `RUN_STATUS_CLASS` /
  `RUN_STATUS_LABEL_KEY` vers `lib/runStatus.ts`.
- Seed « Campagnes » inchangé.
