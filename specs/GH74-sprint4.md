# GH74 — Sprint 4 : non-régression, e2e, SPEC (dernier sprint)

Périmètre (`specs/GH74-design.md` §9, sprint 4) : corpus de non-régression et budgets de
performance, e2e GH74 complémentaires, mises à jour SPEC / tutoriel / AGENTS.md. S'y ajoutent la
réécriture du projet de démonstration (requêtes SQL → format v1) et l'outil MCP `list_templates`
(manquant, constaté pendant la mise à jour de SPEC-MCP-SERVER).

## Fichiers

### Nouveaux

| Fichier | Rôle |
|---|---|
| `main/services/suivi-corpus.test.ts` | Corpus : démo générée, projet minimal, jeu ×50 ; chaque widget (démo + seeds) exécuté et comparé à sa référence ; budgets |
| `main/services/suivi-corpus.test-util.ts` | Jeu gonflé ×50 (graine fixe), partagé avec `dashboard-lib.test.ts` |
| `main/services/fixtures/suivi-corpus/*.json` | Références : `demo-dashboards`, `demo-seeds`, `minimal-seeds`, `x50-campaigns` (une ligne de résultat par ligne de texte ; mise à jour volontaire par `vitest -u`) |
| `e2e-web/gh74-editing.spec.ts` | D1, T6, R4, R6, T7, R8, R1, F4, F6, D4 (cf. Vérifications) |

### Modifiés (principaux)

| Fichier | Changement |
|---|---|
| `packages/types/src/suivi-templates.ts` | `hashableText`, `queryCode`, `widgetCode` : génération + empreinte partagées par l'application et le générateur de démo |
| `main/services/dashboard-library.service.ts`, `suivi-store.util.ts` | `contentHash` / `applyQueryTemplate` / `applyWidgetTemplate` délèguent aux fonctions partagées (`sha256`) |
| `main/services/dashboard-seed.service.ts` | Définitions des widgets des seeds exportées (corpus) |
| `scripts/demo-lave-linge/content.mjs`, `generate.mjs`, `docs.mjs` | Démo au format v1 : 7 requêtes « Liste filtrée », 2 scripts écrits à la main (liens par type, exigences par version), 9 widgets par modèles ; code et empreinte générés par les modèles de Polenta ; lancement par `tsx` (`pnpm --filter @polenta/desktop demo:generate`) |
| `mcp-server/tools/suivi-script.tools.ts` | Outil `list_templates` (référencé par les descriptions des outils mais absent) ; conventions `usermeta.polenta` dans le contrat |
| `main/services/agents-md.template.ts` | AGENTS.md : vue Suivi en scripts, modèles, `list_templates`, widgets modèle ou transform + spec |
| `renderer/routes/query.tsx` | Historique : modèle + paramètres d'un script généré (au lieu de `const P = {`) |
| `specs/SPEC-DASHBOARDS.md` | Réécrit (graphe, exécution, bibliothèque, modèles, rendu, stockage / seeds / maturité, panneau / bandeau / rafraîchissement, non-régression) |
| `specs/SPEC-MCP-SERVER.md` (§3, §4.5, §7), `SPEC-TESTS.md` (§4.3), `SPEC-TECH-stack.md` (§2), `SPEC-ELECTRON-DESKTOP.md` (§2, §11.4, §14.1), `SPEC-INDEX.md`, `SPEC.md` §2.7, `CONTEXT.md` (D8) | Mises à jour GH74 |
| `docs/tutoriels/06-suivi.md`, `docs/tutorials/06-tracking.md`, `docs/img/dashboard*.png`, `query*.png` | Tutoriel Suivi (modèles, scripts, bibliothèque, bandeau) et captures refaites sur la démo régénérée |

## Comportement implémenté

- **Corpus** : sur trois jeux, chaque widget des dashboards de la démo (lus par les services de
  l'application, format v1, non personnalisés) et des seeds Status / Campagnes est exécuté (script +
  transformation, bibliothèque de départ, horloge et fuseau figés) et comparé à sa référence.
  Graphe de la démo construit par les services réels (workspace complet, composants compris).
- **Budgets** (contexte préparé, médiane de 5) : avancement par campagne et avancement dans le temps
  < 200 ms sur la démo, < 1 s sur ×50 — vérifiés à chaque `pnpm test`.
- **Démo** : plus aucune requête SQL ; « À revalider » = 4, couverture, statuts, liens, versions
  identiques en valeur à l'ancienne démo.

## Divergences par rapport au design

| Design | Implémenté | Raison |
|---|---|---|
| Corpus « en CI » | Exécuté par `pnpm test` | Le dépôt n'a pas de CI qui lance les tests (seul `release.yml`) ; le corpus est prêt à y être branché |
| Rien sur la démo | Générateur de démo réécrit (format v1) | Ses dashboards s'affichaient « Requête SQL non prise en charge » ; le corpus l'utilise comme jeu de référence |
| Générateur en `node` | Lancé par `tsx` | Il importe les modèles TypeScript ; Node 20 (épinglé) n'a pas le type stripping |
| Rapports sprint 2 / 3 : démo « hors de ce repo » | Erreur corrigée : le générateur est dans `scripts/demo-lave-linge/` ; seule la démo **publiée** (`laurentolive/demo-ll800-produit`, clonée par les e2e) est externe | — |

## Vérifications

- `pnpm typecheck` : OK.
- `pnpm test` : 564 tests desktop (corpus compris) et 38 merge-core, tous verts.
- e2e web :
  - sur la démo **régénérée** (`POLENTA_E2E_DEMO_SOURCE`) : **95 passés, 13 ignorés, 0 échec**
    (dont les captures du tutoriel) ;
  - sur la démo **publiée** : **94 passés, 13 ignorés, 0 échec**. `s2-core` S2-2 (clone depuis une URL,
    composants récupérés sur GitHub) a échoué une fois puis passé seul (instable, sans lien avec GH74).
- `/code-review` : 10 constats, tous corrigés :
  - générateur incompatible Node 20 (→ `tsx`) ;
  - erreurs du générateur masquées dans le corpus ;
  - seed « Status » annoncé à tort dans le guide de la démo ;
  - libellé d'historique identique pour un script modifié (→ paramètres affichés) ;
  - avertissement `MODULE_TYPELESS` ;
  - corpus générant le code par un autre chemin que l'application ;
  - `wasmLocation` inexistant dans SPEC-ELECTRON ;
  - mention « CI » inexacte ;
  - commentaire `TemplateRef.hash` périmé ;
  - références : tableau vide sur une ligne blanche.
- Poids renderer (C4) : chunk Vega paresseux **294 Ko gzip** (build web minifié, budget 320 Ko) ;
  aucune trace de QuickJS dans les bundles renderer.

### Scénarios e2e GH74 (`GH74-tests.md`)

| Scénario | Spec |
|---|---|
| D1 repo neuf (bibliothèque, types, jsconfig, seed Campagnes) | `gh74-editing` D1, `gh74-suivi` B1 |
| D4 seed Campagnes existant → bandeau | `gh74-editing` D4 |
| D6 fichier livré proposé puis appliqué | `gh74-suivi` U1 (variante « nouveau fichier » ; « version antérieure » en unitaire M1) |
| T6 vues natives, T7 détachement / retour au modèle | `gh74-editing` |
| F4 SQL d'avant GH74, F6 format plus récent | `gh74-editing`, `gh65-navigation` 2.8 |
| R1 thème, R4 sans identifiants, R6 erreur, R8 rafraîchissement | `gh74-editing` |
| R2 clic barre, R3 clic aire empilée | `gh65-navigation` 2.1 / 2.6, `gh74-suivi` T1 |
| P1 / P2 pastilles, `progress` ignoré ; P3 « Non approuvé » | `gh71-progress` C1–C3, `gh68-unapproved` |
| Matrice (pire statut, drill-down) | `gh69-matrix` |

### Critères d'acceptation (`specs/GH74.md`)

| Critère | État |
|---|---|
| AlaSQL, QueryBuilder, SqlEditor, modes sql / builder retirés | ✅ (sprint 2) |
| Graphe v1 sans `maturity*` / `progress*` ; `coverageStatus` = matrice | ✅ (sprint 1, corpus) |
| `tsc -p dashboards/jsconfig.json` sur la bibliothèque | ✅ (L7) |
| Isolation, boucle infinie ~2 s, mémoire ≤ 128 Mo, pile, réactivité | ✅ (sprint 1) |
| Contexte durci ; invalidation par `lib/` et les données | ✅ |
| Erreur de script / spec visible avec ligne | ✅ (R6) |
| 6 types + aire empilée en modèles ; seeds équivalents (étapes `entryStep`) | ✅ |
| Script partagé par deux widgets exécuté une fois | ✅ (sprint 1, `script-engine.test`) |
| Couleurs `var(--…)` suivent le thème | ✅ (R1) |
| Personnalisé / « Revenir au modèle » | ✅ (T7) |
| Drill-down `_ids` et relance `polenta.drill` | ✅ (R2, R3) |
| Builder historique converti ; SQL « non prise en charge » | ✅ (F4, unitaires) |
| `formatVersion` supérieure en lecture seule, jamais réécrit | ✅ (F6) |
| Bandeau : version antérieure proposée, fichier modifié non, Appliquer = à publier | ✅ (M1, U1) |
| Import `<composant>::lib/x.js` ; composant inconnu → erreur nommée | ✅ (sprint 1) |
| Outils MCP §10 documentés, AGENTS.md régénéré | ✅ (`list_templates` ajouté) |
| Page campagne : statut brut, plus de `progress`, « Non approuvé » | ✅ |
| Exports Excel / docx / PDF | ✅ (sprint 2, e2e export) |
| Corpus exécuté par `pnpm test`, références versionnées | ✅ (pas de CI de tests dans le dépôt) |
| Desktop et web | e2e web ✅ ; desktop : D1 / R2 à vérifier manuellement |

## Reste (hors GH74)

- **Republier la démo** `laurentolive/demo-ll800-produit` à partir du générateur
  (`pnpm --filter @polenta/desktop demo:generate -- --force`) : la démo publiée garde ses requêtes
  SQL (lecture seule) tant qu'elle n'est pas republiée. Action sur un dépôt public, laissée à
  l'utilisateur.
- Vérification manuelle desktop (packaging du worker et du `.wasm`, D1 / R2).
- Brancher `pnpm test` sur une CI (aucune aujourd'hui).
