# SPEC-DASHBOARDS — Module Dashboards & Requêtes

> Référence parent : [SPEC.md](../SPEC.md) §2.7
> Dépend de : [SPEC-TECH-stack.md](SPEC-TECH-stack.md) §2/§5, [SPEC-TRACEABILITY.md](SPEC-TRACEABILITY.md), [SPEC-REQ-requirements.md](SPEC-REQ-requirements.md)
> Introduit par T77 (sprints 1–3)

---

## 1. Vue d'ensemble

Système de **dashboards personnalisables par requêtes façon SQL**, remplaçant l'ancien
"Tableau de bord" statique de la page Projet (StatCards/répartitions/récemment
modifiées — retiré sans reprise en sprint 3).

Trois entités, chacune privée ou partagée : **Requête** (`SavedQuery`), **Widget**
(embarqué dans un Dashboard, pas d'entité/fichier propre), **Dashboard**.

Nouvel onglet `ActivityBar` "Suivi" — panneau latéral à deux sections repliables
empilées (Dashboards / Requêtes, §6), deux familles de vues (`/query`, `/dashboard`).
La vue Requêtes contient l'éditeur, le résultat, la sauvegarde, l'historique et l'export.
Les requêtes sauvegardées ne sont listées que dans le panneau latéral (GH14).

---

## 2. Moteur de requête (`query-engine.service.ts`)

- **AlaSQL** — SQL exécuté directement sur des tableaux JS en mémoire, pas de moteur
  de stockage. Cohérent avec `SPEC.md` §5 / `CONTEXT.md` D1 ("pas de base de données
  applicative").
- **Dataset** reconstruit à chaque exécution depuis les index en mémoire déjà
  maintenus par `RequirementsIndexService`/`TestsIndexService` — jamais persisté ni
  mis en cache sur disque. Trois tables : `requirements`, `tests`, `links`, une ligne
  par objet, champs `fields{}` étalés au premier niveau (accessibles directement en
  SQL). Colonne `component` sur chaque ligne (`requirements`/`tests`/`links`) —
  résolue en deux temps (`query-engine.service.ts`, `rowComponentFor()`) : d'abord le
  repo/submodule (repo courant + composants submodules agrégés via
  `WorkspaceTreeService`), puis affinée au composant local (`SystemNode`, T123 — un
  composant local a les mêmes capacités qu'un composant en repo séparé, cf.
  CLAUDE.md) que l'`objectTypeRef` de la ligne résout réellement, à n'importe quelle
  profondeur d'imbrication. Le tag repo/submodule ne reste utilisé que pour le nœud
  `root` par défaut (repo sans composants locaux additionnels, cas historique
  inchangé) ou quand la ref est irrésolvable. `links` n'a pas d'`objectTypeRef`
  propre (un lien référence deux objets via `sourceId`/`targetId`) — reste taggé au
  niveau repo/submodule uniquement.
- **Colonnes dérivées sur `requirements`** (T77 sprint 3, cf. §5 ci-dessous) :
  `coverageStatus` + 5 colonnes booléennes `maturity*` + `maturityMissingCriteria`.
- **Deux modes** : builder guidé (traduit en SQL côté service, champs limités à une
  allowlist par type d'objet — protection contre l'injection d'un `BuilderCondition`
  corrompu) et SQL avancé (texte libre, lecture seule).
- **Garde-fou lecture seule** : rejette `INSERT/UPDATE/DELETE/DROP/CREATE/ALTER/
  TRUNCATE/ATTACH/INTO` (ce dernier car AlaSQL implémente `SELECT ... INTO
  CSV/JSON/.../SQL(path)`, un vecteur d'écriture fichier) sur la SQL finale, quel
  que soit le mode d'origine.
- **Export Excel** du résultat courant via `exceljs` (infra autonome, ne dépend pas
  du ticket T43 export cahier, non encore implémenté au moment de T77).

---

## 3. Stockage — privé / partagé

| Entité | Partagé | Privé |
|---|---|---|
| Requête (`SavedQuery`) | `queries/QUERY-xxxx.yaml`, un fichier par requête, ID via `nextCounterId` (pierre tombale à la suppression ou au passage en privé, GH20) | clé `savedQueries` dans `.{username}.pref`, ID `local-<ts>-<rand>` |
| Dashboard (`Dashboard`) | `dashboards/DASHBOARD-xxxx.yaml`, widgets **embarqués** dans le YAML (pas de fichier séparé par widget) | clé `dashboards` dans `.{username}.pref` |
| Historique de requêtes | — | toujours privé (`queryHistory` dans `.pref`), sans exception |
| Widget | pas de stockage propre — scope hérité du Dashboard parent | idem |

Ordre d'affichage des sections du panneau latéral : `queriesOrder`/`dashboardsOrder`
dans `.{username}.pref` (préférence d'affichage, indépendante du scope de chaque
objet référencé).

### 3.1 Règles de dépendance et de scope

- Un widget ne peut être partagé que si sa requête l'est — appliqué à la fois côté
  UI (filtre proactif du sélecteur de requête) et côté service
  (`DashboardsService.setScope`/`addWidget`/`updateWidget`), défense en profondeur.
- Rétrogradation (partagé → privé) d'une requête bloquée si des widgets partagés en
  dépendent (`SavedQueriesService.findDependentWidgets`, via `DashboardsService`).
- Suppression d'une requête utilisée par au moins un widget : bloquée, liste des
  dépendants affichée.
- Promotion (privé → partagé) toujours libre ; l'id de la requête change (schémas
  d'id différents privé/partagé) — les widgets des dashboards privés du même
  utilisateur qui la référencaient sont remappés vers le nouvel id
  (`DashboardsService.remapWidgetQueryId`), pour ne jamais laisser de référence
  pendante.
- **Limite connue** : la détection de dépendants ne voit pas les dashboards privés
  d'un *autre* utilisateur (fichier `.pref` non accessible depuis la session
  courante) — compromis assumé, pas un bug à corriger dans ce périmètre.

---

## 4. Vue Dashboard — widgets

- Grille à tailles prédéfinies (`sm`/`md`/`lg` → 1/2/4 colonnes sur une grille à 4
  colonnes), réordonnable par drag & drop natif HTML5 (même pattern que
  l'`ElementTree` de la vue Système) — pas de redimensionnement libre en pixels.
- 5 types de widget : barres, camembert, courbe (recharts), tuile KPI, table. Le
  type n'est **jamais contraint** par la forme du résultat de la requête — aperçu
  live dans la popup de configuration, l'utilisateur reste seul juge.
- Chaque widget gère explicitement le résultat vide et le mapping incomplet (état
  vide dédié, jamais un chart cassé) — y compris le cas "widget dont la requête
  sous-jacente a été supprimée" (ne devrait pas arriver grâce aux garde-fous de
  §3.1, mais affiche un état "requête introuvable" en défense plutôt que de
  planter).

### 4.1 Widget barres — empilement (`fieldMapping.stacked`)

- Uniquement significatif quand `series` est renseigné (multi-série) — ignoré sinon.
- Par défaut (`stacked` absent/`false`) : une barre groupée par valeur de série,
  comportement historique inchangé.
- `stacked: true` : les séries partagent un même `stackId` recharts et s'empilent au
  lieu d'être juxtaposées — seul le segment le plus haut de la pile reçoit des coins
  arrondis (les segments inférieurs restent carrés, sans quoi un arrondi médian
  laisserait un espace visible avec le segment empilé au-dessus).
- Réglable dans la popup de configuration du widget (case à cocher visible
  uniquement pour un widget `bar` avec une `series` sélectionnée) — pas seulement
  câblé pour le dashboard **Status** pré-configuré (§5.1).

---

## 5. Dashboards pré-configurés & critères de maturité (T77 sprint 3)

### 5.1 Seed automatique

Un dashboard **partagé** est créé automatiquement au premier accès à
l'onglet "Suivi" si le dossier `dashboards/` est vide et n'a jamais été seedé
(marqueur `dashboards/.seeded.yaml`, invisible du listing car les fichiers dont le
nom commence par `.` sont ignorés par `GitService.listFiles`) : **Status**
(T148 : les templates **Couverture**, **Avancement**, **Maturité** livrés en T77
sprint 3 ont été retirés du seed — plus jugés utiles une fois `coverageStatus`
disponible directement en colonne de dataset SQL). Le seed ne se redéclenche
jamais si le dossier est non vide au premier accès (contient déjà des dashboards
partagés) ni s'il a déjà eu lieu — un utilisateur qui supprime le template ne le
voit pas revenir. Implémenté côté main process (`DashboardSeedService`, appelé
depuis le handler IPC `dashboards:list`), pas côté renderer.

Chaque dashboard pré-configuré est un dashboard partagé normal : modifiable,
supprimable, widgets ajoutables/retirables comme n'importe quel dashboard partagé —
aucune UI ni contrainte spéciale ne le distingue après sa création.

**Garde-fous** (trouvés en revue sprint 3) : le marqueur n'est écrit qu'une fois le
seed **entièrement réussi** (jamais sur le chemin "dossier déjà non vide", qu'il
s'agisse de dashboards pré-existants ou des restes d'une tentative précédente
échouée à mi-chemin) — un échec partiel reste donc retentable plutôt que figé
indéfiniment. Deux appels quasi simultanés à `dashboards:list` (deux fenêtres, ou un
double-fetch) partagent la même tentative en cours via un cache en mémoire
(`DashboardSeedService.inFlightSeeds`), pour ne jamais créer les dashboards en
double. Le seed est également sauté (sans écrire de marqueur, pour retenter plus
tard) si la branche courante est en lecture seule (`''` ou `prj-*`, même règle que
`VersioningContext.isReadonly` côté renderer) — `dashboards:list` est passé de
lecture pure à lecture+écriture avec ce seed, et rien d'autre dans le process
principal n'empêchait jusqu'ici une écriture sur une baseline.

- **Status** : une barre empilée par composant (`fieldMapping.stacked: true`),
  chaque segment représentant le nombre d'exigences de ce composant dans un
  `status` donné (`category: component`, `series: status`, `measure: count`) — voir
  §4.1 pour l'option d'empilement générique introduite pour ce widget — plus une
  seconde barre empilée par composant, même principe mais un segment par
  `coverageStatus` (`category: component`, `series: coverageStatus`,
  `measure: count`) au lieu de `status`.

### 5.2 Critères de maturité — calcul exact

Basé sur `CLAUDE.md` § "Règles de cohérence — à vérifier systématiquement".
Implémenté dans `apps/desktop/src/main/services/maturity.util.ts`, appelé depuis
`query-engine.service.ts` pour chaque ligne de la table `requirements`. Schema-driven
(aucun nom de champ n'est codé en dur — `schema.yaml` est configurable par projet).

| # | Critère (T77.md) | Colonne dataset | Implémentation |
|---|---|---|---|
| 1 | Tous les champs `required: true` du type sont remplis | `maturityRequiredFieldsOk` | Pour chaque champ custom du type (`ObjectTypeDefinition.fields`) marqué `required: true`, vérifie que `r.fields[nom]` est non vide (chaîne non blanche après suppression du HTML pour les champs richtext, tableau non vide, sinon présent). Type non résolvable (cross-composant, ou type supprimé du schéma) → passant par défaut (impossible à vérifier ≠ invalide). |
| 2 | `statement` respecte la syntaxe EARS | `maturityEarsOk` | Appliqué à **tout champ dont `validator: EARS`** dans le schéma (pas seulement un champ nommé `statement`). Heuristique : après suppression du HTML, le texte doit commencer par un des 5 mots-clés EARS (`WHEN`/`WHILE`/`WHERE`/`IF`/`THE`) et contenir `SHALL` ensuite (regex `^\s*(WHEN\|WHILE\|WHERE\|IF\|THE)\b[\s\S]*\bSHALL\b`, insensible à la casse). Pas de parseur grammatical complet. Aucun champ `validator: EARS` déclaré → passant par défaut. |
| 3 | Au moins un critère d'acceptance mesurable | `maturityAcceptanceOk` | Cherche un champ dont le `name` ou le `label` contient "accept" (insensible à la casse — correspond à la convention `acceptanceCriteria` de `CLAUDE.md` sans la coder en dur). "Mesurable" = non vide ET (contient un item de checklist markdown `- [ ]`/`- [x]`, ou contient un chiffre — seuil/valeur en prose). Aucun champ correspondant dans le type → passant par défaut. |
| 4 | Si `status: approved` → au moins un lien de vérification vers un test | `maturityVerificationOk` | Réutilise `coverageStatus` (voir §5.3) : `!isApproved OR coverageStatus !== 'not_covered'`. Le statut "approuvé" est résolu depuis `typeDef.statuses[].isApproval` (pas la chaîne littérale `'approved'`) — un projet dont le statut d'approbation porte un autre nom (ex. `valide`) est géré correctement ; repli sur `'approved'` uniquement si le type n'est pas résolvable ou ne déclare aucun statut `isApproval`. Ne re-dérive pas le matching lien test↔exigence une seconde fois. |
| 5 | L'exigence n'est pas marquée `needsRevalidation` | `maturityNoRevalidation` | T172 : lecture directe du flag de l'exigence (posé quand un élément lié quitte l'approbation, SPEC-REQ §5.3) — plus de scan des liens ; `TraceabilityService.computeRevalidationReqIds()` supprimé. Libellé du critère manquant : « impact à vérifier ». |

**Robustesse supplémentaire** (trouvée en revue sprint 3) : un `objectTypeRef` manquant ou malformé sur une exigence (frontmatter édité à la main) ne fait plus planter la construction du dataset (`findObjectTypeDef` traite désormais toute valeur non-string/vide comme `'unresolvable'` plutôt que de lever une exception) — et une telle exigence est explicitement comptée comme non mûre (`"type d'objet invalide"` dans `maturityMissingCriteria`), plutôt que silencieusement traitée comme "impossible à vérifier donc conforme".
| — | Agrégat | `maturityOk` (ET des 5), `maturityMissingCriteria` (libellés des critères manquants, séparés par virgule) | — |

**Robustesse** : toutes les lectures de `r.fields[...]` sont défensives
(`req.fields ?? {}`) — `requirements-index.service.ts` caste le YAML brut en
`Requirement` sans normalisation runtime, donc un frontmatter édité à la main sans
bloc `fields:` ne fait pas planter le calcul (c'est justement le cas d'usage visé :
lister ce qui est incomplet).

### 5.3 Couverture (`coverageStatus`)

Colonne exposée directement sur `requirements`, réutilisant
`TraceabilityService.computeCoverage()` (méthode publique extraite en sprint 3 de
la boucle jusque-là interne à `getMatrix()`) — aucune ré-implémentation du matching
lien test↔exigence ni du calcul d'agrégat `CoverageStatus` dans le moteur de
requête. Voir [SPEC-TRACEABILITY.md](SPEC-TRACEABILITY.md) §2.2 pour la définition
et la priorité de calcul des statuts.

**Calculée sur le graphe de liens agrégé de TOUS les composants du périmètre**, pas
repo par repo : un lien de vérification pertinent pour une exigence d'un composant
peut être stocké dans — ou référencer un cas de test vivant dans — le repo d'un
autre composant (liens cross-composant T69/T70). `query-engine.service.ts` agrège
requirements/tests/links de tous les repos avant d'appeler `computeCoverage()` une
seule fois, exactement comme `getMatrix()` le fait déjà via `resolveRepoPaths()` —
sans quoi `coverageStatus` divergerait silencieusement de la Matrice de traçabilité
pour toute exigence à couverture cross-composant. La résolution du schéma
(critères 1-3, spécifique à chaque composant) reste en revanche par repo, chaque
composant étant schema-autonome (cf. `CLAUDE.md`).

---

## 6. Panneau latéral

Deux sections indépendantes ("Dashboards", "Requêtes"), chacune réorganisable par
glisser-déposer (composant générique `ReorderableSidebarSection`, partagé), filtre
texte dynamique. Clic sur un dashboard → vue Dashboard ; clic sur une requête → vue
Requêtes avec cette requête chargée dans l'éditeur adapté à son mode d'origine.

**Disposition (GH14 — remplace les onglets à icônes de T92)** : les deux sections sont
affichées ensemble, empilées (Dashboards en haut), sous l'en-tête « Suivi ».
- Chaque section se replie ou se déplie par clic sur son en-tête (chevron + libellé). Le
  bouton « + » reste actif quand la section est repliée.
- Une section repliée n'affiche que son en-tête.
- Les sections dépliées se partagent la hauteur : toute la hauteur si une seule est
  dépliée. Si les deux le sont, le partage suit un séparateur déplaçable entre elles
  (défaut 50/50, 140 px minimum par section, double-clic → 50/50). Le ratio est
  persisté en `localStorage['polenta:suiviSplit']`.
- L'état replié/déplié est persisté en `localStorage['polenta:suiviCollapsed']`
  (`{dashboards, queries}`, commun à tous les projets). Par défaut, les deux sections
  sont dépliées, y compris en cas de valeur illisible.
- Une section se déplie automatiquement quand l'élément actif de l'URL (`dashboardId` /
  `queryId`) figure dans sa liste. Un id d'historique ne déplie rien.

La suppression d'une requête sauvegardée se fait uniquement depuis ce panneau (la vue
Requêtes n'a plus de liste « Requêtes sauvegardées » depuis GH14).

### 6.1 Rafraîchissement sur écriture externe (GH18)

Requêtes et dashboards peuvent être écrits hors de l'app (tools MCP, `SPEC-MCP-SERVER.md`
§4.5). `useLiveFileSync` (renderer, alimenté par `RepoWatcherService`) invalide :
- `queries/**` → clés `['queries', repoPath, …]` ;
- `dashboards/**` → `['dashboards' | 'dashboard' | 'print-dashboard', repoPath, …]` (liste
  **et** dashboard ouvert) ;
- `.{user}.pref` → toutes les clés ci-dessus + `queries-order` / `dashboards-order`.

Match par préfixe `[clé, repoPath]`, quel que soit l'utilisateur. Une écriture de l'app
elle-même (dont l'historique de requêtes, stocké dans `.pref`) déclenche aussi un refetch —
redondant et sans conséquence. Un objet créé hors de l'app n'est pas ajouté à
`queriesOrder`/`dashboardsOrder` : il apparaît en fin de section.

---

## 7. Hors scope

- Via MCP (GH18) : changement de scope privé ↔ partagé, ordre du panneau latéral,
  historique de requêtes, seed — réservés à l'app.
- Redimensionnement libre des widgets en pixels — grille à tailles prédéfinies
  seulement.
- Partage/duplication d'un widget entre plusieurs dashboards.
- Export des dashboards complets (PDF/Excel).
- Alertes/notifications sur seuils, requêtes planifiées, historique/versioning des
  résultats de dashboard dans le temps.
