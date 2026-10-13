# GH74 — Scénarios de test

Légende : **[U]** test unitaire vitest, **[E]** e2e web Playwright (`e2e-web/gh74-*.spec.ts`),
**[C]** corpus de non-régression CI, **[M]** manuel. Sprint indiqué entre parenthèses.

## 1. Graphe de données

| # | Scénario | Attendu | Type |
|---|---|---|---|
| G1 | Graphe du jeu de démo (5 repos) | collections §1.1 présentes ; `contractVersion: 1` ; aucun champ `maturity*` / `progress*` ; tests sans `steps` | [U] (1) |
| G2 | `coverageStatus` | identique à `TraceabilityService.getMatrix()` pour chaque exigence de la démo, y compris un lien cross-composant | [U] (1) |
| G3 | Deux repos déclarant `root::exigence` | deux `objectTypes` distincts, distingués par `repo` ; chaque objet porte son `repo` | [U] (1) |
| G4 | `history` | entrée implicite (`implicit: true`) pour une valeur modifiée hors app ; `{}` si aucun champ suivi | [U] (1) |
| G5 | Campagne abandonnée | `completedAt` renseigné ; `history.status` se termine par `abandoned` | [U] (1) |
| G6 | Entrée retirée (GH73) | absente de `entries`, présente dans `removedEntries` avec `removedAt` | [U] (1) |
| G7 | Entrée resynchronisable (GH68) | `resyncable: true` ; copie figée → `false` ; `snapshot` réduit à titre / statut / version | [U] (1) |
| G8 | `entryStatuses` | ordre `pending, INCOMPLETE, BLOCKED, FAIL, PASS`, gravité = `RUN_STATUS_SEVERITY`, libellés fr / en | [U] (1) |
| G9 | Fichier campagne illisible dans un composant | graphe construit, campagnes de ce repo absentes, avertissement journalisé | [U] (1) |
| G10 | Cache | 2ᵉ `build` sans changement → même `version`, pas de relecture des index ; écriture dans `campaigns/` d'un composant → nouvelle version | [U] (1) |
| G11 | Constructions simultanées | 5 `build` concurrents → une seule construction | [U] (1) |
| G12 | MCP (`cache: false`) | chaque appel reconstruit ; résultat identique au desktop | [U] (1) |

## 2. Bac à sable

| # | Scénario | Attendu | Type |
|---|---|---|---|
| S1 | Globaux | `fetch`, `require`, `process`, `setTimeout`, `console`, `WebAssembly` → `undefined` | [U] (1) |
| S2 | Imports interdits | `os`, `fs`, `node:fs`, URL, `../x.js`, `lib/../../x.js` → `kind: 'import'`, « Module introuvable » | [U] (1) |
| S3 | Données en lecture seule | `data.requirements[0].status = 'x'` → `TypeError` (runtime) | [U] (1) |
| S4 | Fuite entre exécutions | `globalThis.leak = 1` / `Array.prototype.sum = …` en exécution 1 → échoue ; invisible en exécution 2 | [U] (1) |
| S5 | Boucle infinie | `kind: 'timeout'` en ≈ 2 s ; exécution suivante OK dans le même contexte | [U] (1) |
| S6 | Allocation massive | `kind: 'memory'` ; mémoire wasm ≤ 128 Mo ; module recréé, exécution suivante OK | [U] (1) |
| S7 | Récursion infinie | `kind: 'stack'`, pas d'abort du module | [U] (1) |
| S8 | Chien de garde | worker qui ne répond plus (simulé) → terminé, recréé, erreur `timeout` ; exécution suivante OK | [U] (1) |
| S9 | Réactivité | pendant S5, un appel IPC / HTTP du serveur web répond en < 100 ms | [U] (1) [M] |
| S10 | Erreurs localisées | `throw` ligne 3 → `script.js:3` ; erreur dans `lib/campaign.js` → ce fichier et sa ligne ; erreur dans une transformation → `<widgetId>.js` | [U] (1) |
| S11 | Sortie invalide | non-tableau, ligne non objet, valeur objet, `_ids` non tableau → `kind: 'rows'` avec ligne / colonne | [U] (1) |
| S12 | Fonction `async` | `kind: 'async'`, « Le script doit être synchrone » | [U] (1) |
| S13 | Pas d'export par défaut | message dédié | [U] (1) |
| S14 | Contrat | `// @polenta contract 2` → `kind: 'contract'`, pas d'exécution ; en-tête absent → v1 | [U] (1) |
| S15 | `PolentaHost` | `timezone` / `today` du client (`Pacific/Auckland` → date du lendemain possible) ; `drill: null` par défaut | [U] (1) |
| S16 | Partage d'exécution | 3 widgets sur la même requête, rafraîchis ensemble → script exécuté 1 fois, 3 transformations | [U] (1) |
| S17 | Invalidation du contexte | modification de `dashboards/lib/history.js` → nouveau contexte, nouveau code pris en compte | [U] (1) |
| S18 | `limit` | `test_script` sur 815 lignes → 200 lignes, `total: 815`, `truncated: true` | [U] (1) |

## 3. Bibliothèque

| # | Scénario | Attendu | Type |
|---|---|---|---|
| L1 | `entryStep` | sur la démo, égal à `campaign-progress.ts` pour chaque entrée (référence JSON figée avant suppression) | [U] (1) |
| L2 | `maturity` | sur la démo, égal à `computeMaturity` (5 critères, `missing`) | [U] (1) |
| L3 | `campaignsTimeline` | cas fabriqués : entrée ajoutée à J2, FAIL à J3, PASS à J5, retirée à J6 → comptes par jour exacts ; données pré-GH73 (sans `addedAt`, sans run rattaché) → repli GH73 §6.2 | [U] (1) |
| L4 | Fuseau | exécution à 23 h 30 UTC, fuseau `Europe/Paris` → compté le jour suivant | [U] (1) |
| L5 | `valueAt` / `timeline` | valeur avant la 1ʳᵉ entrée = `null` ; entrée implicite prise en compte | [U] (1) |
| L6 | Performance ×50 | `campaignsTimeline` une campagne < 50 ms, toutes < 1 s (contexte en cache) | [C] (1, 4) |
| L7 | `checkJs` | `tsc --noEmit -p resources/dashboard-lib/jsconfig.json` sans erreur | [U] (1) |
| L8 | `polenta.d.ts` à jour | généré depuis `graph.ts` = fichier livré | [U] (1) |
| L9 | Import de composant | `moteur::lib/mesures.js` résolu ; `inconnu::lib/x.js` → « Module introuvable : inconnu::lib/x.js » | [U] (1) |
| L10 | Import relatif | `./status.js` depuis `lib/campaign.js` OK ; `./../x.js` refusé | [U] (1) |
| L11 | Manifeste | chaque fichier livré : dernière empreinte = contenu ; versions uniques | [U] (1) |

## 4. Modèles

| # | Scénario | Attendu | Type |
|---|---|---|---|
| T1 | Déterminisme | chaque modèle, mêmes paramètres → texte identique, empreinte identique | [U] (2) |
| T2 | « Liste filtrée » = ancien builder | pour 10 `BuilderConfig` (opérateurs `= != > < contains in`, ET / OU, regroupement, champ `fields`), lignes identiques à l'ancien SQL (référence figée avant suppression) | [U] (2) |
| T3 | Barres empilées | transformation : regroupement catégorie × série, `count`, union des `_ids` ; spec compile, sans `aggregate` | [U] (2) |
| T4 | Matrice | `worst` = pire statut ; cellule vide absente ; `_ids` des entrées de la cellule | [U] (2) |
| T5 | Aire empilée | couche cliquable présente ; relance `drill` → `_ids` du seul point | [U] (2) |
| T6 | KPI / table | `usermeta.polenta.view` ; rendus natifs | [U] (2) [E] (4) |
| T7 | Détachement | spec modifiée d'un caractère → `state.customized: true` ; « Revenir au modèle » → code régénéré, `customized: false` | [U] (2) [E] (4) |
| T8 | Nouvelle version d'un modèle | `template.version` < embarquée → `state.templateUpdate` ; objet non modifié tant qu'il n'est pas enregistré | [U] (2) |
| T9 | `lib/status.js` supprimé par le projet | widget matrice généré → erreur visible « Module introuvable : lib/status.js » | [U] (2) |

## 5. Stockage et format

| # | Scénario | Attendu | Type |
|---|---|---|---|
| F1 | Création partagée | `queries/QUERY-0003/{query.yaml,script.js}` ; `dashboards/DASHBOARD-0002/{dashboard.yaml,<w>.js,<w>.vl.json}` | [U] (2) |
| F2 | IDs | `QUERY-0001.yaml` historique + `QUERY-0002/` → prochain `QUERY-0003` ; pierre tombale d'un dossier supprimé respectée | [U] (2) |
| F3 | Requête builder historique | lue convertie (`filtered-list`), mêmes lignes ; enregistrée → dossier créé + fichier historique supprimé | [U] (2) |
| F4 | Requête SQL historique | `legacySql`, `readOnly: 'legacy-sql'` ; listing OK ; ses widgets : erreur « Requête SQL non prise en charge » ; mise à jour refusée `SUIVI_READ_ONLY` ; suppression possible | [U] (2) [E] (4) |
| F5 | Widget historique | `bar` + `fieldMapping` → modèle `bar` aux mêmes paramètres ; `preset: campaignProgress` ignoré | [U] (2) |
| F6 | `formatVersion: 2` | lecture seule « Créé par une version plus récente », jamais réécrit (empreinte disque inchangée après ouverture et tentative d'édition) | [U] (2) [E] (4) |
| F7 | Privé | script / transform / spec dans `.pref` ; promotion → fichiers v1, `queryId` remappés | [U] (2) |
| F8 | Dépendances | rétrogradation d'une requête utilisée par un widget partagé : bloquée (inchangé) | [U] (2) |
| F9 | Aucune réécriture au lancement | ouverture d'un repo avec 3 objets historiques → aucun fichier modifié (`git status` propre) | [U] (2) [M] |

## 6. Rendu, drill-down, navigation

| # | Scénario | Attendu | Type |
|---|---|---|---|
| R1 | Thème | jetons `var(--status-success-solid)` résolus ; bascule clair / sombre → couleurs changent | [E] (4) [M] |
| R2 | Clic barre avec `_ids` | popup « Détail » : ID / type / titre / statut des objets ; clic → onglet de l'objet | [E] (4) |
| R3 | Clic aire empilée (sans `_ids`) | relance `drill` → entrées du point ; entrée exécutée → page d'exécution, sinon page campagne filtrée sur son statut | [E] (4) |
| R4 | Aucun ID | « Détail non disponible : le script ne fournit pas d'identifiants » | [E] (4) |
| R5 | ID inconnu | ligne « Objet introuvable » | [U] (2) |
| R6 | Erreur de script / spec | carte du widget : message + fichier + ligne ; jamais un graphe vide | [E] (4) |
| R7 | Spec avec `aggregate` | rendue ; avertissement dans l'éditeur ; drill-down indisponible | [U] (2) [M] |
| R8 | Rafraîchissement | saisie d'un résultat dans une autre fenêtre / pull automatique → widget mis à jour sans action | [E] (4) |
| R9 | Impression PDF | graphes Vega en SVG, `notifyPrintReady` après rendu | [M] (3) |
| R10 | Export docx / xlsx | lignes de la chaîne script + transformation ; `_ids` joint par « , » en xlsx | [U] (3) |
| R11 | Rien de cliquable | aperçu de la popup de configuration et impression | [M] (3) |

## 7. Seeds et bandeau

| # | Scénario | Attendu | Type |
|---|---|---|---|
| D1 | Repo neuf | seed Status (partagé) + bibliothèque + `polenta.d.ts` + `jsconfig.json` ; seed Campagnes privé avec « Avancement dans le temps » | [U] (3) [E] (4) |
| D2 | Seeds GH65 / GH71 existants non modifiés | réécrits en v1 (mêmes ids) ; lignes équivalentes (« Avancement par campagne » sur `entryStep`) | [U] (3) |
| D3 | Seed existant modifié par l'utilisateur | non touché → `legacy-sql` | [U] (3) |
| D4 | Seed Campagnes existant | « Avancement dans le temps » proposé dans le bandeau ; ajouté sur Appliquer | [U] (3) [E] (4) |
| D5 | Fichier de bibliothèque supprimé | jamais recréé par le seed | [U] (3) |
| D6 | Bibliothèque v1 intacte, app livre v2 | bandeau « Mises à jour disponibles (1) » ; Appliquer → fichier v2, modification à publier | [U] (3) [E] (4) |
| D7 | Fichier modifié par le projet | jamais proposé | [U] (3) |
| D8 | Ignorer | masqué pour cet utilisateur (`.pref`) ; proposé à un autre | [U] (3) |
| D9 | Branche en lecture seule (`prj-*`) | bandeau sans bouton Appliquer ; pas de seed partagé | [U] (3) |

## 8. MCP

| # | Scénario | Attendu | Type |
|---|---|---|---|
| M1 | `get_data_contract` | renvoie `polenta.d.ts` + documentation (conventions `_ids`, agrégation en JS, `drill`, jetons) | [U] (1) |
| M2 | `test_script` | script valide → 200 lignes + total ; erreur → fichier / ligne ; avec `queryId` + `transform` | [U] (1) |
| M3 | `create_query` (script) puis `add_widget` (transform + spec) | fichiers v1 écrits ; dashboard ouvert dans l'app rafraîchi (GH18) | [U] (2) [M] |
| M4 | `add_widget` par modèle | `template` + `params` → code généré, `customized: false` | [U] (2) |
| M5 | Spec invalide / `url` / `aggregate` | `SPEC_INVALID` (bloquant) / refus / avertissement `SPEC_AGGREGATE` | [U] (2) |
| M6 | Script en erreur à l'enregistrement | enregistré + avertissement `SCRIPT_ERROR` | [U] (2) |
| M7 | `write_library_module` hors `dashboards/lib/` | refusé (path-guard) | [U] (1) |
| M8 | Bundle MCP | `vega-compile.mjs` chargé par import dynamique depuis le CJS packagé | [U] (2) [M] |

## 9. Page campagne (retrait GH71)

| # | Scénario | Attendu | Type |
|---|---|---|---|
| P1 | Pastilles | une par statut brut présent (PASS / FAIL / BLOCKED / INCOMPLETE / pending) ; clic → filtre `status` | [E] (4) |
| P2 | URL avec `?progress=prep:draft` | ignoré, page non filtrée, pas d'erreur | [E] (4) |
| P3 | « Non approuvé » (GH68) | toujours affichée sur une entrée dont le test n'est pas approuvé | [E] (4) |

## 10. Non-régression et performance

| # | Scénario | Attendu | Type |
|---|---|---|---|
| C1 | Corpus | démo + projet minimal + ×50 : chaque widget du seed → lignes = référence JSON versionnée | [C] (4) |
| C2 | Budget démo | avancement d'une campagne < 200 ms (contexte en cache) | [C] (4) |
| C3 | Budget ×50 | < 1 s, graphe en cache | [C] (4) |
| C4 | Bundles | renderer : surcoût Vega ≤ 320 Ko gzip, en chunk paresseux (point d'entrée + < 2 Ko) ; QuickJS absent du renderer | [M] (4) |
| C5 | Desktop et web | mêmes résultats pour les e2e GH74 en web ; desktop : D1, R2 en manuel | [E] [M] (4) |

## Cas limites transverses

- Repo sans campagne, sans test, sans `dashboards/` : graphe aux collections vides, widgets à l'état vide.
- Workspace sans cache d'arbre (`workspaceDir` absent) : graphe du seul repo ouvert.
- Utilisateur sans droit d'écriture (client web, rôle lecteur) : `suivi:run` autorisé, création /
  `updates-apply` refusés (politique de canaux).
- Script renvoyant `[]` : état vide, pas d'erreur.
- Spec sans `data.name: 'rows'` : erreur `spec` explicite.
