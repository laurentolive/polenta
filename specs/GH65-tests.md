# GH65 — Scénarios de test

Spec : [GH65.md](GH65.md) · Design : [GH65-design.md](GH65-design.md).
Colonne **Auto** : `U` = unitaire vitest, `E` = e2e web (`e2e-web/gh65-*.spec.ts`), `M` = manuel.
Les e2e créent leurs propres campagnes (API `window.polenta`), sans dépendre du contenu du projet
démo.

## Sprint 1 — données et temps réel

### Nominal

| # | Scénario | Attendu | Auto |
|---|---|---|---|
| 1.1 | Campagne CAMP-A, 10 entrées : 3 PASS, 1 FAIL, 6 pending. `SELECT status, COUNT(*) AS n FROM campaign_entries GROUP BY status` | PASS 3, FAIL 1, pending 6 | U, E |
| 1.2 | Même jeu, requêtes `pctExecuted` / `pctPass` du seed | 40 / 75 | U |
| 1.3 | Campagne dans le repo racine + campagne dans un repo composant | les deux apparaissent ; `component` = composant du fichier | U |
| 1.4 | Builder : type de campagne du schéma proposé « (entrées) » ; `groupBy status` | même décompte que 1.1 restreint à ce type | U, M |
| 1.5 | Builder : condition sur un champ perso de campagne (`campaign_<nom>`) | filtre appliqué | U |
| 1.6 | Entrée exécutée le `2026-10-12T21:30:00Z` | `executedDay = '2026-10-12'` | U |
| 1.7 | Projet existant seedé « Status », première ouverture de Suivi | dashboard « Campagnes » + 5 requêtes **privés** créés, marqueur `state: done` dans le `.pref`, aucun fichier du repo modifié | U, E |
| 1.7b | Deux utilisateurs du même projet | chacun reçoit son exemplaire privé | U |
| 1.8 | Seed en anglais (`locale: 'en'`) | titres anglais | U |
| 1.9 | Dashboard « Campagnes » supprimé, Suivi rouvert | non recréé | U |
| 1.10 | Dashboard « Campagnes » ouvert ; saisir un résultat dans une campagne (autre onglet) | widgets mis à jour sans action | E |
| 1.11 | Poste A dashboard ouvert, poste B saisit + publie ; tick du pull auto de A (A sans modification) | widgets de A mis à jour sans action | M |
| 1.12 | Idem 1.11, campagne dans un repo composant | idem | M |
| 1.13 | Préférences projet : intervalle 1 min, enregistrer | `schema.yaml` `preferences.autoPullIntervalMinutes: 1` ; un pull par minute sans redémarrage | M |
| 1.14 | Hors ligne avec intervalle 2 | indicateur : « nouvel essai automatique toutes les 2 minutes » | M |
| 1.15 | Tool MCP `run_query` sur `campaign_entries` | résultat identique à l'app | U |

### Cas limites

| # | Scénario | Attendu | Auto |
|---|---|---|---|
| 1.20 | Aucune campagne | table vide, widgets en état « aucune donnée », pas d'erreur | U |
| 1.21 | Campagne sans `objectTypeRef` | présente en SQL (`objectTypeRef` NULL), absente du builder | U |
| 1.22 | Campagne sans `fields`, entrée sans `testSnapshot` ni test live | colonnes vides, pas d'exception | U |
| 1.23 | Champ perso de campagne nommé `status` | colonne `campaign_status`, `status` = statut de l'entrée | U |
| 1.24 | `pctPass` sans aucune entrée exécutée | KPI état vide, pas de NaN/Infinity | U |
| 1.25 | `autoPullIntervalMinutes` = 0, -3, `'abc'`, 1.5, 120, absent | 5, 5, 5, 5, 5, 5 (entier dans [1,60] seulement) | U |
| 1.26 | Seed interrompu après 2 requêtes (erreur simulée), puis relance | aucune requête en double ; seed terminé, `state: done` | U |
| 1.27 | Branche en lecture seule (baseline) | seed historique sauté ; seed « Campagnes » privé quand même (rien dans le repo) | U |
| 1.28 | Deux `dashboards:list` simultanés | un seul dashboard « Campagnes » | U |
| 1.29 | `CampaignsService` absent du constructeur | `campaign_entries` vide, autres tables inchangées | U |
| 1.30 | Requête SQL avec `INTO` sur `campaign_entries` | refusée (garde-fou inchangé) | U |

## Sprint 2 — navigation

### Nominal

| # | Scénario | Attendu | Auto |
|---|---|---|---|
| 2.1 | Widget « Avancement par campagne » (SQL seed), clic sur le segment FAIL de CAMP-A | popup : exactement les entrées FAIL de CAMP-A, compteur = hauteur du segment, pas de bandeau de repli | U, E |
| 2.2 | Widget barre sur requête builder (exigences, `groupBy status`), clic sur `approved` | popup : les exigences approuvées du type, colonnes complètes | U, E |
| 2.3 | Builder avec combinator `OR` (2 conditions) + groupBy, clic sur une barre | lignes = (cond1 OR cond2) AND valeur cliquée | U |
| 2.4 | KPI « % exécuté », clic | popup : toutes les entrées des campagnes `in_progress` | U |
| 2.5 | Camembert, clic sur une part ; courbe, clic sur un point | popup correspondante | M |
| 2.6 | Ligne d'entrée exécutée (popup ou widget table « Entrées en échec ») | onglet résultat d'exécution de l'entrée | E |
| 2.7 | Ligne d'entrée `pending` | onglet page de campagne filtrée `pending` | E |
| 2.8 | Ligne de la table `requirements` / `tests` | éditeur de l'exigence / du test | E |
| 2.9 | Page campagne : clic sur la pastille « 1 FAIL » | liste réduite à l'entrée FAIL, URL `status=FAIL` ; re-clic → liste complète | E |
| 2.10 | Dashboard avec popup ouverte ; nouveau résultat saisi | popup mise à jour | M |

### Cas limites

| # | Scénario | Attendu | Auto |
|---|---|---|---|
| 2.20 | SQL avec jointure, clic sur une barre | lignes du résultat filtrées + bandeau « Détail non disponible… », pas d'erreur | U, E |
| 2.21 | SQL dont la catégorie est une expression (`UPPER(status) AS s`) | repli `result` | U |
| 2.22 | SQL avec sous-requête dans FROM / UNION | repli `result` | U |
| 2.23 | Catégorie `NULL` (barre « — ») | conditions `IS NULL`, lignes NULL retournées | U |
| 2.24 | Valeur contenant une apostrophe (`l'essai`) | échappée, résultat correct | U |
| 2.25 | Ligne sans `id` ni `campaignId` | non cliquable (pas de curseur main) | U, M |
| 2.26 | Ligne avec un `id` inexistant | toast « Objet introuvable », pas de navigation | U |
| 2.27 | Aperçu dans `WidgetConfigModal`, impression du dashboard | aucun élément cliquable | M |
| 2.28 | URL de campagne avec `status=FOO` | ignoré, liste complète | U |
| 2.29 | Objet dans un repo composant | onglet ouvert avec le `repoPath` du composant | U |
| 2.30 | Client web : 2.1, 2.6, 2.9 | même comportement | E |

## Critères d'acceptation (rappel spec)

Les 12 critères de `GH65.md` § Critères d'acceptation ; correspondance : 1→1.1, 2→1.2, 3→1.4,
4→2.1, 5→2.20, 6→2.6/2.7, 7→2.8/2.25, 8→1.7/1.9, 9→1.11/1.12, 10→1.10, 11→1.13/1.25, 12→colonnes E.
