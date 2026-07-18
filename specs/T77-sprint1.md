# T77 — Sprint 1 : moteur de requête AlaSQL + vue Requêtes

**Statut** : coding sprint 1 → prêt pour revue humaine
**Branche** : T77
**Worktree** : `../polenta-T77/`

---

## Périmètre réalisé

Conforme au périmètre sprint 1 de `specs/T77-design.md` § "Découpage en sprints" :
dépendances, moteur de requête, CRUD requêtes sauvegardées + historique, IPC,
types partagés, panneau latéral (section "Requêtes" uniquement), vue Requêtes
complète (builder, SQL avancé, résultat, sauvegarde, historique, export Excel).

Aucune section "Dashboards" dans le panneau latéral, aucun widget, aucune règle de
scope/dépendance widget↔requête — hors périmètre sprint 1, comme demandé.

---

## Fichiers créés / modifiés

### Dépendances
- `apps/desktop/package.json` — ajout `alasql` (^4.17.3) et `exceljs` (^4.4.0).
- `pnpm-lock.yaml` — régénéré par `pnpm add`.

### Types partagés
- `packages/types/src/dashboard.ts` **(NEW)** — `QueryScope`, `QueryMode`,
  `BuilderCondition`, `BuilderConfig`, `QueryDefinition`, `SavedQuery`,
  `QueryHistoryEntry`, `QueryResultColumn`, `QueryResult`, plus `WidgetType`,
  `WidgetSize`, `WidgetFieldMapping`, `Widget`, `Dashboard` déclarés par
  anticipation pour le sprint 2 (non câblés à un service/UI, comme autorisé par
  la consigne).
- `packages/types/src/index.ts` — export du nouveau fichier.

### Main process
- `apps/desktop/src/main/services/query-engine.service.ts` **(NEW)** — construit
  le dataset agrégé (repo courant + composants submodules via
  `WorkspaceTreeService.readCache()`) à partir de `RequirementsIndexService` et
  `TestsIndexService`, traduit un `BuilderConfig` en SQL, exécute via AlaSQL,
  exporte le résultat en `.xlsx` via `exceljs`.
- `apps/desktop/src/main/services/saved-queries.service.ts` **(NEW)** — CRUD
  requêtes sauvegardées (privé dans `.{username}.pref`, partagé dans
  `queries/QUERY-xxxx.yaml` avec compteur dans `config/counters.yaml`, pattern
  repris de `reviews.service.ts`), historique (toujours privé, purge auto +
  suppression manuelle), ordre d'affichage de la section "Requêtes" du panneau
  latéral.
- `apps/desktop/src/main/services/schema-lookup.util.ts` **(NEW)** — lookup
  partagé d'un `ObjectTypeDefinition` par `objectTypeRef`, utilisé par les deux
  services ci-dessus (évite deux implémentations qui auraient pu diverger).
- `apps/desktop/src/main/services/pref-store.util.ts` **(NEW)** — lecture/écriture
  partagée du fichier `.{username}.pref`, extraites de `ipc/pref.handlers.ts` pour
  que `saved-queries.service.ts` ne réimplémente pas la même logique.
- `apps/desktop/src/main/ipc/pref.handlers.ts` **(MODIFIED)** — utilise le nouvel
  util partagé au lieu de ses fonctions privées (comportement inchangé).
- `apps/desktop/src/main/ipc/index.ts` **(MODIFIED)** — handlers `queries:*`
  (execute, builder-to-sql, export-excel, list, create, update, delete,
  history-list, history-add, history-delete, order-get, order-set).
- `apps/desktop/src/main/container.ts` **(MODIFIED)** — instancie et enregistre
  `QueryEngineService` et `SavedQueriesService`.

### API client
- `packages/api-client/src/types.ts` **(MODIFIED)** — namespace `queries.*` +
  DTOs (`CreateSavedQueryDto`, `UpdateSavedQueryDto`, `AddHistoryEntryDto`,
  `ExportExcelResult`).
- `packages/api-client/src/ipc-client.ts` **(MODIFIED)** — implémentation.

### Renderer
- `apps/desktop/src/renderer/components/layout/ActivityBar.tsx` — entrée panel
  `dashboard` (icône `LayoutDashboard`, libellé "Suivi").
- `apps/desktop/src/renderer/components/layout/AppLayout.tsx` — `Panel` étendu,
  `deducePanel('/query') → 'dashboard'`, navigation dédiée.
- `apps/desktop/src/renderer/components/layout/Sidebar.tsx` — branchement du
  panel `dashboard` → `DashboardPanel`.
- `apps/desktop/src/renderer/components/sidebar/DashboardPanel.tsx` **(NEW)** —
  section "Requêtes" : liste réorganisable par drag & drop natif HTML5 (même
  technique que `ElementTree`, sans nouvelle lib), filtre texte, bouton
  "Ajouter", suppression avec confirmation.
- `apps/desktop/src/renderer/routes/query.tsx` **(NEW)** — vue Requêtes : bascule
  builder/SQL, table de résultat, Sauvegarder (modal titre + portée), listes
  "Requêtes sauvegardées" et "Historique" filtrables, export Excel.
- `apps/desktop/src/renderer/components/dashboard/QueryBuilder.tsx`,
  `SqlEditor.tsx`, `ResultTable.tsx` **(NEW)**.
- `apps/desktop/src/renderer/routeTree.gen.ts` **(MODIFIED)** — entrée `/query`
  ajoutée à la main (voir § "Point d'attention build" ci-dessous).

---

## Comportement implémenté

- **Dataset** : `requirements`, `tests`, `links` — champs `fields{}` étalés au
  premier niveau (accessibles directement en SQL, ex. `WHERE priority = 'high'`),
  colonne `component` (nom du nœud `schema.yaml`) sur chaque ligne. Reconstruit à
  chaque exécution depuis les index en mémoire existants — jamais mis en cache ni
  persisté. Sans submodule, `component` vaut simplement le nom du dossier du repo
  (pas de régression mono-repo).
- **Builder** : sélection d'un type d'objet (catégories `requirement`/`test`
  uniquement — les campagnes ne font pas partie du dataset), conditions
  champ/opérateur/valeur combinées en ET/OU, group by optionnel (→ `COUNT(*)`).
  Traduit en SQL côté main process ; `queries:builder-to-sql` expose cette
  traduction pour préremplir l'éditeur SQL lors de la bascule.
- **SQL avancé** : lecture seule sur l'index — voir § "Garde-fous" ci-dessous.
- **Sauvegarde** : titre + portée au moment du clic ; privé → `.{username}.pref`,
  partagé → `queries/QUERY-xxxx.yaml` (ID via `config/counters.yaml`).
- **Historique** : chaque exécution réussie (builder ou SQL) est ajoutée en tête
  de liste, toujours privé. Purge automatique au chargement des entrées
  builder-mode dont le type ou un champ référencé a disparu du schéma local ;
  les entrées SQL-mode et les refs cross-composant non résolvables localement
  sont conservées par défaut (cf. § Divergences). Croix de suppression manuelle
  par entrée, sans confirmation.
- **Export Excel** : dialogue natif "Enregistrer sous" puis écriture `.xlsx`
  (colonnes = colonnes du résultat courant) via `exceljs`.
- **Panneau latéral** : section "Requêtes" réorganisable (ordre stocké dans
  `.{username}.pref`, clé `queriesOrder` — ajout non explicitement listé dans la
  consigne mais nécessaire : aucun objet du domaine ne porte nativement un ordre
  d'affichage, et le DnD était explicitement demandé pour ce sprint).

---

## Garde-fous — durcis pendant la revue

Le premier jet (avant `/code-review high`) ne couvrait que le mode SQL brut avec
une liste de mots-clés interdits appliquée à la chaîne SQL fournie par
l'utilisateur. La revue (3 agents en parallèle, angles correctness/reuse/
altitude) a remonté plusieurs trous confirmés, vérifiés ensuite contre la vraie
librairie AlaSQL (scripts Node ad hoc, pas seulement le typecheck) :

1. **Le SQL généré par le builder n'était jamais passé par le garde-fou** — un
   `BuilderCondition.field` corrompu (fichier `queries/*.yaml` partagé édité à la
   main, ou payload IPC malformé) pouvait s'échapper des crochets `[...]` et
   injecter du SQL arbitraire dans la requête générée par `buildSql()`.
   → Fix : allowlist des noms de champs (`resolveTableInfo` + `assertField`) et
   `assertReadOnlySql()` appelé sur la SQL finale **des deux modes**.
2. **La liste de mots-clés interdits ne couvrait pas `SELECT ... INTO
   CSV/JSON/TXT/XLS/XLSX/SQL(chemin)`** — AlaSQL implémente réellement ces
   fonctions d'écriture fichier (confirmé en lisant `alasql/dist/alasql.js` puis
   en exécutant un vrai `SELECT ... INTO CSV(...)` qui écrit bien un fichier
   depuis le process principal Electron). Le commentaire d'origine ("pas de
   faille de sécurité réelle, l'index ne contient que des tableaux JS") était
   donc faux pour ce cas précis. → Fix : `INTO` (+ `ALTER`, `TRUNCATE`) ajoutés
   à `FORBIDDEN_SQL`.
3. **Faux positif** : la regex testait la SQL brute, donc une requête légitime
   contenant le mot "update" dans un littéral (`... LIKE '%please update%'`)
   était rejetée à tort. → Fix : les littéraux `'...'` sont neutralisés avant le
   test.
4. **Opérateur "contient" cassé** : implémenté au départ via `LIKE '%valeur%'`
   avec un échappement `[%]`/`[_]` façon T-SQL — mais l'implémentation LIKE
   d'AlaSQL fait juste `pattern.replace(/%/g, '.*')` puis `new RegExp(...)`, sans
   support de l'échappement crochet ; testé avec la vraie lib, ça retournait 0
   résultat même quand la sous-chaîne était bien présente. → Fix : UDF
   `POLENTA_CONTAINS` (sous-chaîne JS pure, sans sémantique de motif), vérifiée
   avec un script Node contre `alasql` réel.
5. **Opérateur "in" cassé** : le champ de saisie du builder décrit "dans (liste
   ,)" mais la valeur (une chaîne unique) n'était jamais découpée avant d'être
   passée à `IN (...)`, donc `status IN ('approved,review')` ne matchait jamais
   rien. → Fix : découpage par virgule côté `query-engine.service.ts` si la
   valeur n'est pas déjà un tableau.

Chaque point ci-dessus a été re-testé avec de vrais appels à `alasql` (pas
seulement `tsc --noEmit`) — voir la conversation de dev pour les scripts utilisés
(non committés, exécutés depuis `apps/desktop` puis supprimés).

Le garde-fou reste un **filet de sécurité pour l'utilisateur** (éviter la
confusion "je peux modifier les données via ce mode"), pas une isolation contre
un attaquant qui contrôlerait déjà le process Electron — cohérent avec l'esprit
initial du design, juste avec un périmètre de mots-clés/chemins réellement
complet désormais.

---

## Divergences par rapport au design

- **`queriesOrder`** (clé pref supplémentaire, non listée dans
  `T77-design.md` § Stockage) — nécessaire pour le drag & drop du panneau
  latéral demandé explicitement pour ce sprint ; aucune entité du domaine
  (`SavedQuery`, `QueryHistoryEntry`) ne porte un ordre d'affichage.
- **Purge de l'historique limitée aux entrées builder-mode dont le type est
  résolvable localement** — les entrées SQL-mode ne sont jamais purgées
  automatiquement (on ne parse pas le SQL pour distinguer une référence de champ
  périmée d'une requête volontairement écrite ainsi), et les refs
  cross-composant (`nodeName::type` où `nodeName` n'est pas déclaré localement
  avec ses `objectTypes`) sont traitées comme "impossible à vérifier depuis ce
  repo" plutôt que "invalide", pour éviter un faux-positif de purge. Documenté
  dans le code (`saved-queries.service.ts`, `isHistoryEntryValid`).
- **Dataset sans `coverageStatus` précalculé** — `T77-design.md` §"Widgets
  pré-configurés" prévoit que le dataset expose la sémantique `CoverageStatus`
  directement sur `requirements`/`links` pour le futur dashboard "Couverture"
  (sprint 3). Ce calcul dépend de `TraceabilityService` (test runs + liens +
  logique de statut) — non implémenté ce sprint car explicitement hors
  périmètre sprint 1 (aucun widget n'existe encore) ; à ajouter au moment du
  sprint 3 sans revoir la structure actuelle du dataset (ajout de colonnes, pas
  de refonte).
- **Sauvegarde = toujours une création** — cliquer "Sauvegarder" sur une requête
  déjà chargée depuis la liste crée une nouvelle entrée plutôt que de mettre à
  jour l'existante en place. `SavedQueriesService.update()` existe et est câblé
  côté IPC/api-client, mais la vue Requêtes ne l'utilise pas encore ce sprint
  (aucun scénario de `T77-tests.md` sprint 1 ne demande explicitement une mise à
  jour en place). Facile à ajouter en sprint 2 si besoin.
- **Pas de garde anti-doublon dans l'historique** — relire une requête déjà
  sauvegardée (clic répété dans la liste) réexécute la requête et ajoute une
  entrée d'historique à chaque fois, conformément à la lettre de
  `specs/T77.md` ("chaque exécution... est enregistrée automatiquement"), même
  si cela peut sembler redondant à l'usage. Choix documenté ici plutôt que
  changé unilatéralement, à trancher en revue humaine si le comportement
  attendu est différent.

---

## Tests automatiques

Aucun script de test (`vitest`/`jest`) n'existe dans ce monorepo à ce jour — vérifié
(`grep` sur les `package.json`, aucun fichier `*.test.ts`/`*.spec.ts`). Rien à lancer
côté "tests automatiques" pour ce sprint. Vérifications effectuées à la place :
- `pnpm --filter @polenta/desktop typecheck` → 0 erreur.
- `pnpm typecheck` (monorepo complet) → 0 nouvelle erreur (la seule erreur
  restante, `apps/api/src/modules/git/schema.service.ts:66` — `Property 'url'
  does not exist on type 'SystemNode'` — préexiste sur `T77` avant tout
  changement de ce sprint, vérifié via `git stash`).
- `/code-review high` (3 agents parallèles, 8 angles) → voir § Garde-fous et
  § Nettoyage ci-dessous pour les correctifs appliqués.
- Scripts Node ad hoc contre la vraie librairie `alasql` (pas seulement le
  typecheck) pour vérifier le comportement réel des opérateurs et du garde-fou
  SQL — voir § Garde-fous.

## Nettoyage appliqué suite à la revue (au-delà des garde-fous)

- Extraction de `schema-lookup.util.ts` (lookup `ObjectTypeDefinition` partagé
  entre `query-engine.service.ts` et `saved-queries.service.ts`, qui
  dupliquaient la même logique).
- Extraction de `pref-store.util.ts` (lecture/écriture `.{username}.pref`
  partagée entre `ipc/pref.handlers.ts` et `saved-queries.service.ts`).
- `SavedQueriesService.listShared()` parallélisé (`Promise.all` au lieu d'une
  boucle séquentielle de lectures YAML).
- `QueryBuilder.tsx` : un champ custom qui reprendrait le nom d'un champ système
  (ex. un schéma avec un champ personnalisé nommé `status`) est masqué dans la
  liste des champs du builder plutôt que proposé en double — le dataset fait
  toujours gagner le champ système en cas de collision, donc l'afficher aurait
  créé une option trompeuse.
- `query.tsx` : garde anti-réponse-périmée (`requestIdRef`) — ouvrir une requête
  lente puis naviguer ailleurs avant qu'elle ne réponde n'écrase plus
  l'éditeur/résultat affiché avec une réponse arrivée après coup.

---

## Comment tester manuellement

**L'application Electron n'a pas été lancée dans cet environnement** (pas
d'affichage/interaction UI disponible ici — sandbox CLI sans serveur X /
Electron runtime interactif). Toute la vérification a été faite via :
- `tsc --noEmit` (main + renderer + packages),
- lecture attentive du code et des call-sites,
- exécution de scripts Node autonomes contre la vraie librairie `alasql`
  (opérateurs `contains`/`in`, garde-fou `FORBIDDEN_SQL`, preuve du vecteur
  `SELECT ... INTO CSV(...)`).

**Aucun test manuel de l'UI (clics, rendu, drag & drop réel) n'a donc été
effectué.** Pour vérifier en local avec l'app lancée (`pnpm --filter
@polenta/desktop dev`), suivre les scénarios de `specs/T77-tests.md` §
"Sprint 1 — Requêtes" (scénarios 1 à 6) :

1. Onglet "Suivi" (icône `LayoutDashboard` dans l'`ActivityBar`) → panneau
   "Requêtes" → bouton `+` → vue Requêtes vide.
2. Builder : choisir un type (ex. exigence système), ajouter une condition
   (`priority = high`), Exécuter → table de résultat.
3. "SQL avancé" → le SQL équivalent est préaffiché et modifiable → Exécuter.
4. Sauvegarder → titre + portée privée → apparaît dans "Requêtes sauvegardées"
   (vue + panneau latéral).
5. Exécuter 2-3 requêtes différentes → "Historique" les liste, plus récente en
   premier ; cliquer une entrée recharge l'éditeur dans le bon mode.
6. Filtrer les deux listes par texte.
7. Exporter en Excel → dialogue "Enregistrer sous" → fichier `.xlsx` généré,
   colonnes/lignes correspondant au résultat affiché.
8. Cas limite : taper `DELETE FROM requirements` en SQL avancé → rejeté avec
   message explicite, sans exécution.
9. Glisser-déposer une requête dans le panneau latéral → ordre conservé après
   rechargement de la vue.

---

## Ce qui reste pour la suite (hors périmètre sprint 1, pour mémoire)

Sprint 2 (Widgets + Dashboards) et sprint 3 (dashboards pré-configurés + retrait
de l'ancien tableau de bord) inchangés par rapport à `T77-design.md`. Aucun
fichier de ces sprints n'a été créé par anticipation, à l'exception des types
`Widget`/`Dashboard` dans `packages/types/src/dashboard.ts` (autorisé
explicitement par la consigne de ce sprint).
