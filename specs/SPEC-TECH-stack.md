# SPEC-TECH — Stack Technique

> Référence parent : [SPEC.md](../SPEC.md)  
> Dernière révision : 2026-10-13 (GH79 — principe données brutes / indicateurs projet, §1.1)  
> ⚠️ Architecture cible : **client lourd Electron** — pas de serveur HTTP embarqué.

---

## 1. Architecture globale

```
Remote git (GitHub / GitLab / self-hosted — T130 : support Gitea retiré)
        ↑ push / pull (action utilisateur explicite)
┌──────────────────────────────────────────────────────────┐
│  Electron Desktop App                                    │
│                                                          │
│  Main Process (Node.js)                                  │
│  ├── Services métier (Requirements, Tests, Traceability) │
│  ├── GitService      → fs.readFile / fs.writeFile        │
│  ├── SyncService     → commit / push / pull / merge      │
│  ├── AuthService     → PAT stocké dans keychain OS       │
│  └── IPC Handlers   → répondent au renderer              │
│                    ↕ contextBridge (preload)             │
│  Renderer Process (React + Vite)                         │
│  └── ApiClient IPC  → window.polenta.invoke(channel)     │
└──────────────────────────────────────────────────────────┘
        ↓ read / write (working tree local)
┌──────────────────────────────────────────────────────────┐
│  Clone git local                                         │
│  requirements/ tests/ reviews/ links/ ...                │
└──────────────────────────────────────────────────────────┘
        ↑ push / pull
Remote git → source de vérité partagée entre utilisateurs
```

**Principes fondamentaux :**
- **Git = seule source de vérité.** Tout est stocké en YAML dans le repo git.
- **Pas de serveur HTTP.** Les controllers NestJS sont remplacés par des handlers IPC (`ipcMain.handle`).
- **Lecture = working tree.** `fs.readFile` sur les fichiers du repo cloné. Pas de `git show` pour les données courantes.
- **Git commit = action utilisateur explicite.** Les services écrivent sur disque (`fs.writeFile`) sans committer. L'utilisateur committe via le bouton dédié.
- **Pas de PostgreSQL, pas de SQLite obligatoire, pas de migrations.** Index en mémoire reconstruit depuis le working tree.
- **Liens externes** : images et pièces jointes référencées par URL OneDrive dans les RICHTEXT — pas de stockage dans Polenta.

### 1.1 Données brutes dans Polenta, indicateurs de suivi côté projet (décision du 2026-10-13, GH79)

**Contexte.** Les statuts liés entre éléments (exigence ↔ test ↔ campagne) mènent vite à des
besoins propres à chaque client (maturité, étapes d'avancement, etc.). Les coder dans Polenta
ferait grossir le produit d'indicateurs que chaque client voudrait définir à sa façon.

**Décision.**

- **Polenta expose les données brutes du modèle** : objets, champs, liens, campagnes → entrées
  → runs, historique (historique configurable des champs #77, historique daté des campagnes #73).
- **Polenta calcule un indicateur seulement s'il sert à une de ses propres fonctions.**
  Exemples actuels :
  - la couverture test ↔ exigence (matrice de traçabilité, analyse d'impact, badges des vues) ;
  - `needsRevalidation` (T172) ;
  - l'approbation `isApproval` (verrouillage, éligibilité) ;
  - la validation EARS et le contrôle des champs remplis (import en masse, résolution de conflits) ;
  - la resynchronisation des copies de test des campagnes (GH68).
- **Tout ce qui compose, agrège, interprète ou reconstruit des données pour le suivi vit côté
  projet** : scripts et bibliothèque dans le repo du client (#74), livrés comme contenu de départ
  modifiable, jamais comme code de Polenta. Exemples : la maturité, les étapes d'avancement,
  l'état d'une campagne à une date, le dernier résultat.
- **Les écrans de Polenta affichent les données brutes.** Un indicateur projet y apparaît par un
  mécanisme générique (colonnes calculées définies par le projet, livrées par GH70 :
  SPEC-DASHBOARDS §5.2, SPEC-SYSTEM-VIEW §Configuration des champs), pas par du code dédié. Exemple
  livré : « Dernier résultat » des tests (`lastEntryResults`, modèle `campaign-last-result`).

**Règle de décision** pour tout nouvel indicateur : *sert-il à une fonction de Polenta ?*
Oui → calculé dans Polenta (service du main). Non → script côté projet, affiché via le
mécanisme générique. La décision est notée dans la spec du ticket (`specs/GH{N}.md`).

**Tickets concernés** : #74 (graphe de données JSON + scripts JS isolés + Vega-Lite), #78
(prototype QuickJS / Vega-Lite avant le Design de #74), #73, #77, #70 — mis en cohérence le
2026-10-13 ; #76 fermé à ce titre. Les indicateurs de suivi déjà livrés dans Polenta relèvent
de l'ancien modèle et sortent de Polenta avec #74 : colonnes `progress` / `progressRank` /
`testStatus` et règle `campaign-progress` (GH71), maturité des exigences (`maturity.util.ts`,
colonnes `maturity*`, SPEC-DASHBOARDS §5). Restent dans Polenta `isEarsCompliant` et
`isFilled` (import en masse, résolution de conflits) et la pastille « Non approuvé » (GH68,
repose sur `isApproval`).

---

## 2. Stack par couche

| Couche | Technologie | Version | Rôle |
|--------|------------|---------|------|
| Monorepo | Turborepo | 2.x | Builds incrémentaux, scripts partagés |
| Package manager | pnpm | 9.x | Workspaces, performance |
| Langage | TypeScript | 5.4+ | Full-stack |
| **Desktop shell** | Electron | 45.x | Fenêtre native, main process Node.js (31 → 45 : GH218, build 31 révoquée par macOS) |
| Build desktop | electron-vite | 2.x | Bundling main + preload + renderer |
| Distribution | electron-builder | 24.x | Packaging Windows / macOS / Linux |
| **Frontend** | React | 18.x | UI (renderer Electron) |
| Build frontend | Vite | 5.x | Dev server + build |
| UI components | *(aucun — T130)* | — | `apps/desktop` n'utilise ni shadcn/ui ni Radix UI : composants Tailwind custom + `lucide-react` pour les icônes. (`apps/web`, qui utilisait shadcn/ui + Radix UI, a été supprimé par GH44) |
| Styles | Tailwind CSS | 3.x | Utility-first CSS |
| Éditeur RICHTEXT | TipTap | 2.x | WYSIWYG extensible (nœuds custom `drawioEmbed` et `ResizableImage` — diagramme draw.io rendu via le viewer officiel vendoré, images/diagrammes redimensionnables et rognables ; extensions standard `@tiptap/extension-table`+`-row`+`-header`+`-cell` pour les tableaux, cf. `SPEC-REQ-requirements.md` §3.2a/§3.2b/§3.2c) |
| Routage | TanStack Router | 1.x | Type-safe, file-based |
| État serveur | TanStack Query | 5.x | Cache, invalidation, optimistic updates |
| Formulaires | Zod (sans react-hook-form) | 3.x | Validation schema-driven — pas de `react-hook-form` (T130 ; il n'était utilisé que par `apps/web`, supprimé par GH44) |
| **Git engine** | isomorphic-git | 1.25.x | Pur JS — clone, commit, push, pull, merge, branch |
| Fusion 3-voies (GH37) | `@polenta/merge-core` (package du monorepo) + diff3 | — / 0.0.3 | Logique pure du diff et du merge. **GH222** : un seul moteur YAML générique (diff 2 voies `diffTree`, merge 3 voies `MergeContext`) paramétré par des **descriptions de structure** (objets, liens, paramètres, YAML générique, arbres d'affichage) ; `.drawio` par page ; texte non YAML en hunks de lignes avec **le même `diff3`** qu'isomorphic-git ; marqueurs de conflit nommés à toute profondeur, renumérotation. Importé par le main et le renderer (source TS aliasée, bundlée dans le main comme `@polenta/types`), testé par **vitest** (`pnpm --filter @polenta/merge-core test`). Cf. §6. Le diff mot à mot du mode Rendu est une LCS maison (`renderer/lib/wordDiff.ts`) |
| Diff ligne / caractère (GH222) | `@codemirror/merge` | 6.12.2 (MIT) | Mode Raw des vues de diff (`MergeView` côte à côte, `unifiedMergeView` en ligne : caractères changés, gouttière, alignement, régions repliées, navigation) et diff des panneaux de la résolution de conflits contre l'ancêtre (`Chunk.build`). `DIFF_CONFIG` (`lib/diffStats.ts`) : `scanLimit` 50 000, budget 1 s — la limite par défaut (500 caractères) fusionnait les changements éloignés d'un gros fichier. Remplace la LCS plafonnée à 2 000 lignes de GH178 |
| Éditeur de code (GH37) | CodeMirror 6 (`@codemirror/state`, `view`, `commands`, `language`, `lang-yaml`) | 6.x | Panneaux Raw de l'éditeur de résolution des conflits : décorations de lignes et de caractères (GH222), widgets « Prendre gauche / droite / les deux / Réinitialiser » dans chaque panneau, règle de vue d'ensemble, défilement synchronisé. Monaco écarté (lourd, workers à configurer sous Electron). Chunk de la route `/merge-resolve` seulement (≈ 800 kB, chargé à la demande) |
| **Index mémoire** | Map + MiniSearch | 7.x | Requêtes, filtres, full-text — zéro DB |
| **Scripts de la vue Suivi** (GH74) | QuickJS (`quickjs-emscripten-core` + `@jitl/quickjs-wasmfile-release-sync`) | 0.32.0 | Scripts de données et transformations JS du client exécutés dans un bac à sable wasm (mémoire plafonnée, délai, pile), dans un `worker_threads` par process (desktop, serveur web, MCP) — remplace AlaSQL. Cf. [SPEC-DASHBOARDS.md](SPEC-DASHBOARDS.md) §3 |
| Export Excel | ExcelJS | 4.4.x | `.xlsx` pour tous les exports xlsx (T43 : cahiers d'exigences/tests/campagne, résultats de requête, analyse d'impact) — introduit en T77 pour le seul résultat de requête, généralisé par T43 via `ExportService`/canal IPC `export:save` (l'ancien canal ad hoc `queries:export-excel` a été retiré) |
| Export Word | docx | 9.7.x | `.docx` pour les exports docx (T43 : cahiers d'exigences/tests, rapport de campagne, dashboard) — construction programmatique (`Document`/`Paragraph`/`Table`), pas de conversion HTML→docx. Sert aussi à générer les gabarits d'exemple (GH34, `scripts/build-export-templates.ts`) |
| Export Word par gabarit client (GH34) | docxtemplater (cœur MIT) + pizzip + angular-expressions | 3.71.x / 3.x / 1.7.x | Remplissage d'un `.docx` fourni par le client (balises `{{…}}`, boucles, conditions, balises brutes `{{@…}}`). Parseur d'expressions limité au scope de données (pas d'exécution de code depuis un gabarit), filtres en liste blanche. Modules payants (images, HTML) non utilisés : le richtext est converti par Polenta (markdown-it → WordprocessingML, `export/template/markdown-to-ooxml.ts`), médias/numérotation ajoutés au paquet (`docx-package.ts`). Ces 4 libs (+ markdown-it) sont **bundlées** dans le main (`exclude` d'`externalizeDepsPlugin`, deps transitives non hissées par pnpm) et chargées en `import()` au premier export (T141). Détails : `SPEC-ELECTRON-DESKTOP.md` §19.15a |
| Export Excel par gabarit client (GH34) | xlsx-template | 1.4.x | Remplissage d'un `.xlsx` du client (balises `${…}`, lignes modèles `${table:…}`) en conservant tout le classeur (graphiques, images, mise en page) — exceljs écarté (relecture/réécriture perdant graphiques et tableaux croisés). Complété par une réécriture des références (`xlsx-refs.ts`) que la lib ne met pas à jour. Bundlée dans le main comme docxtemplater. Détails : `SPEC-ELECTRON-DESKTOP.md` §19.15a |
| Export PDF | `webContents.printToPDF` (Electron natif) | — | Aucune dépendance ajoutée — rend une route imprimable dédiée (`/print/*`) dans une fenêtre Electron cachée plutôt que de reconstruire du HTML côté main process (T43). Client web (GH44) : mêmes routes rendues par Chromium headless (`playwright-core`, ci-dessous) |
| Rendu des widgets dashboards (GH74) | Vega-Lite (`vega` 6.4.0, `vega-lite` 6.4.3, `vega-embed` 7.3.0, `vega-interpreter` 2.3.2) | — | Specs Vega-Lite rendues sans `eval` (`ast: true` + interpréteur), SVG, chunk paresseux ; couleurs par jetons du thème. Remplace recharts |
| Éditeur de scripts (GH74) | CodeMirror 6 (`@codemirror/lang-javascript` 6.2.2, `lang-json` 6.0.1) | 6.x | Script de données, transformation (JS) et spec (JSON) dans la vue Suivi |
| Parsing YAML | js-yaml | 4.x | Sérialisation des fichiers du repo |
| **Auth desktop** | keytar | 7.x | Stockage sécurisé PAT dans le keychain OS |
| **File watching** | chokidar | 3.x | Détection des changements fichiers (pull, etc.) |
| **Fichiers externes** | OneDrive (liens) | — | Aucun stockage dans Polenta — URLs collées dans les RICHTEXT |
| **Serveur web** (GH44) | Fastify + `@fastify/websocket`, `@fastify/cookie`, `@fastify/multipart`, `@fastify/static` | 5.x | Client web (`apps/desktop/src/web-server/`, `SPEC-WEB.md`) : RPC générique `POST /rpc/:channel`, événements WebSocket, uploads/téléchargements. Bundle esbuild (`scripts/build-web-server.ts`), dépendances externes installées dans l'image. OIDC sans bibliothèque (`auth/oidc.ts`, PKCE). NestJS (`apps/api`) et `apps/web` supprimés (squelettes jamais utilisés) |
| Impression web (GH44) | playwright-core (Chromium headless `chromium-headless-shell`) | 1.64.x | PDF et instantanés draw.io des exports côté serveur, mêmes routes `/print/*` que le desktop (`web-server/print/headless-print.ts`). Seule dépendance de production partagée avec l'outillage de test |
| Tests (GH44) | vitest + Playwright (`@playwright/test`) | 2.x / 1.64.x | vitest : tests unitaires du serveur web (`web-server/*.test.ts`) en plus de `@polenta/merge-core`. Playwright : tests de bout en bout du client web (`e2e-web/`) et de l'interface desktop (`e2e-desktop/`, GH45) |

---

## 3. Structure du monorepo

```
polenta/
├── apps/
│   ├── desktop/                    ← APPLICATION PRINCIPALE (Electron)
│   │   ├── src/
│   │   │   ├── main/               ← Node.js process
│   │   │   │   ├── index.ts        ← BrowserWindow, app lifecycle
│   │   │   │   ├── container.ts    ← DI manuel
│   │   │   │   ├── ipc/            ← handlers IPC (remplacent les controllers)
│   │   │   │   └── services/       ← services métier (sans NestJS)
│   │   │   ├── preload/
│   │   │   │   └── index.ts        ← contextBridge → window.polenta
│   │   │   └── renderer/           ← React app
│   │   ├── electron.vite.config.ts
│   │   └── electron-builder.yml
│   ├── api/                        ← version web NestJS (conservée)
│   └── web/                        ← frontend web (conservé)
├── packages/
│   ├── types/                      ← interfaces TypeScript partagées
│   ├── zod-schemas/                ← schémas Zod partagés
│   ├── merge-core/                 ← fusion 3-voies pure (GH37), partagée main/renderer, testée vitest
│   └── api-client/                 ← interface ApiClient (IPC + HTTP)
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## 4. Modèle de stockage Git

### 4.1 Structure du repo git par projet

```
<project-git-repo>/
├── requirements/
│   ├── SYS-0001.yaml
│   ├── SW-0042.yaml
│   └── ...
├── tests/
│   ├── TEST-0001.yaml
│   └── ...
├── test-runs/
│   └── TEST-0001/
│       └── TEST-0001-run-0001.yaml
├── versions/
│   └── SW-0042/
│       ├── v1.yaml
│       └── v2.yaml
├── links/
│   └── links.yaml
├── reviews/
│   ├── REVIEW-0001.yaml
│   └── ...
├── review-comments/
│   └── REVIEW-0001/
│       └── COMMENT-abc123.yaml
├── impact-acks/
│   └── SW-0042/
│       └── ack-1234567890.yaml
├── campaigns/
├── campaign-runs/
├── baselines/
├── attachments/
│   └── SW-0042/
│       └── diagram.drawio           ← XML DrawIO (texte, mergeable)
└── config/
    ├── project.yaml                 ← integrationBranch (seul champ réel, T130 — §4.5)
    ├── requirement-types.yaml
    └── workflows.yaml
```

### 4.2 Format d'une exigence YAML

```yaml
# requirements/SW-0042.yaml
id: SW-0042
type: software
title: "Le module doit chiffrer les données au repos"
status: approved
currentVersion: 2
hasDraft: false
createdAt: "2026-01-15T10:30:00Z"
createdBy: laurent
updatedAt: "2026-05-20T14:00:00Z"
updatedBy: laurent
parent: SYS-0001
fields:
  criticality: haute
  asil: B
  statement: |
    THE firmware module SHALL encrypt all data written to persistent storage.
  drawio_architecture: "attachments/SW-0042/diagram.drawio"
jiraLinks:
  - key: PROJ-1234
    type: IMPLEMENTS
    summary: "Implement encryption at rest"
    status: "Done"
    linkedAt: "2026-04-10T09:00:00Z"
    linkedBy: laurent
```

**GH77** — champ système facultatif `history` (historique des champs suivis, posé par l'application,
absent tant que vide) : une liste par champ, entrées `{ value?, at, by?, source? }` — voir [SPEC-REQ §4.4](SPEC-REQ-requirements.md#44-historique-des-champs-suivis-gh77).

### 4.3 Mapping Git → Cycle de vie Polenta

| Action Polenta | Opération Git |
|---|---|
| "Faire une modification" | `git checkout -b dev-<slug-du-titre>` via `SyncService.createBranch()`, depuis la branche d'intégration configurée du repo (cf. `SPEC-FORKS-BRANCHES-BASELINES.md` §2) |
| Modifier une exigence | `fs.writeFile` sur le working tree (pas de commit automatique) |
| "Publier" | `git add -A && git commit` (`SyncService.stageAll()`/`commit()`) puis `git merge` (`SyncService.mergeInto()`) vers la branche d'intégration — action utilisateur, pas de review obligatoire |
| Fork de projet | Clone du repo git via `SyncService.clone()` |
| Baseline | `git tag baseline/<nom>` |
| Synchroniser | `SyncService.push()` / `SyncService.pull()` — action utilisateur |

> L'ancien flux "Action" (`ActionService`, branches `user/<login>/ACT-XXXX`, review obligatoire
> avant merge) a été retiré en T83 sprint 2 — il n'était atteignable depuis aucune navigation de
> l'UI. Les Reviews (fonctionnalité générique) restent inchangées et indépendantes de ce mapping.

### 4.4 Gestion des IDs

**GH20 : plus de compteur persistant.** L'ID `<PREFIX>-NNNN` est attribué à la **création**
par `nextCounterId()` (`id-counter.util.ts`, unique module d'attribution — exigences, tests,
campagnes, revues, dashboards et requêtes partagés), qui le **déduit du disque** du repo qui
reçoit le fichier :

```
next(P) = max( plus haut P-NNNN.yaml du dossier du type (récursif),
               plus haute pierre tombale .polenta/tombstones/P-NNNN,
               plus haut numéro attribué pendant la session (mémoire du process) ) + 1
```

- **Pierres tombales** — `.polenta/tombstones/<ID>`, un fichier **vide** par ID, écrit par
  `deleteWithTombstone()` **avant** chaque suppression physique (campagne, dashboard ou
  requête partagés, y compris le passage partagé → privé ; exigences, tests et campagnes d'un
  composant local ou d'un type supprimé depuis l'onglet Structure, GH104). Versionnées avec la suppression,
  jamais supprimées : un ID n'est **jamais réutilisé**, pour aucun type.
- **Sérialisation (T118)** — file de promesses par repo : deux `create()` concurrents du même
  process obtiennent des IDs distincts. Rien n'étant écrit pour réserver un ID, la mémoire de
  session tient lieu de réservation jusqu'à l'écriture du fichier (trou possible si l'objet
  n'est finalement pas écrit ou après un changement de branche, jamais de collision).
  Garde-fou entre process (app + serveur MCP) : chaque `create()` refuse d'écraser un fichier
  existant (`assertNewObjectFile`, erreur `<ID> already exists`).
- **Composants** — une exigence/un test d'un type de composant créé depuis le produit reçoit
  son numéro dans le **repo du composant** ; le repo produit reste une source d'historique
  pour ce prefix (ses pierres tombales et son `counters.yaml` non migré).
- **Migration de `config/counters.yaml`** (fichier pré-GH20, valeur = dernier numéro
  attribué) — paresseuse, à la première attribution dans le repo (app ou MCP), idempotente :
  pour chaque clé numérique dont l'ID n'a plus de fichier dans `requirements/`, `tests/`,
  `campaigns/`, `reviews/`, `dashboards/`, `queries/`, pose la pierre tombale, puis supprime
  le fichier (clés héritées `nextId`/`prefixes` ignorées).
- **`peekNextCounterId()`** — même calcul, **lecture seule** (ni migration, ni mémoire mise à
  jour ; un `counters.yaml` non migré est pris en compte), utilisé par le mode `dryRun: true`
  de `bulk_import_*` (`SPEC-MCP-SERVER.md` §4.2).

**Collisions entre branches** : deux branches parties du même état attribuent le même
prochain ID (plus de conflit sur un fichier partagé, mais deux objets de même ID). Le merge
les signale comme deux ajouts du même fichier. Non traité par GH20 (cf. issue #17) ; depuis
**GH37**, l'éditeur de résolution propose **« Garder les deux »** : l'objet de gauche reçoit le
prochain ID libre (union des fichiers et pierres tombales des trois versions) et ses références
côté gauche sont renumérotées (cf. §6.4).

### 4.5 `config/project.yaml` — configuration du projet

**T130 : seul `integrationBranch` y est réellement lu/écrit** (lecture : `git.service.ts`
`getIntegrationBranch`, repli `main`). Il n'y a pas de `schemaVersion`, `name`, ni
`prefixes` dans ce fichier — les types d'objets et leurs préfixes vivent entièrement dans
`.polenta/schema.yaml` (voir `SPEC-ELECTRON-DESKTOP.md` §20).

**GH106 — écriture commitée.** Le fichier est versionné **dans** chaque branche : une `int-*` créée
depuis une autre en hérite la valeur. La désignation (`IntegrationBranchService.designate`,
`SPEC-FORKS-BRANCHES-BASELINES.md` §2.2) pose donc l'invariant **« sur `int-X`, `project.yaml`
désigne `int-X` »** par un commit qui ne contient que ce fichier : `SyncService.commitSingleFile`
construit l'arbre à partir de celui de HEAD (entrée remplacée, sous-arbres réécrits) et appelle
`git.commit({ tree, parent: [HEAD], ref: 'refs/heads/<branche>' })` — l'index n'est pas lu, les
modifications en attente ne partent pas dans le commit (attention : `ref` doit être complet, un nom
nu est écrit sous `.git/<nom>`). Les autres clés éventuelles sont conservées ; un YAML invalide
(HEAD ou copie de travail) est refusé. `setIntegrationBranch` (écriture non commitée) est déprécié.

```yaml
# config/project.yaml
integrationBranch: integration
```

---

## 5. Index en mémoire (Read model)

L'index est construit depuis le **working tree** (fichiers sur disque), pas depuis les objets git.

### 5.1 Structure

```
RequirementsIndex (par repoPath)
  ├── requirements : Map<id, Requirement>
  ├── links        : RequirementLink[]
  ├── versions     : Map<id, RequirementVersion[]>
  └── search       : MiniSearch  (full-text sur title, statement, rationale)

TestsIndex (par repoPath)
  ├── testCases       : Map<id, TestCase>
  └── runsByTestCase  : Map<id, TestRun[]>  (triés desc par executedAt)
```

### 5.2 Cycle de vie

```
Premier accès sur un repoPath
         │
         ▼
  Index.getOrBuild(repoPath)
         │
  fs.readdir(repoPath/requirements/) → liste les fichiers YAML
         │
  fs.readFile() sur chaque fichier   → 10× plus rapide que git show
         │
  Construit Map + MiniSearch
         │
  Sert la requête depuis le cache

Changement fichier détecté (chokidar)
         │
  RepoWatcherService.onFileChanged()
         │
  index.invalidateFile(repoPath, filePath)  ← invalidation chirurgicale
```

L'index est **idempotent** : le reconstruire depuis le working tree produit toujours le même état.

---

## 6. Gestion des conflits de merge YAML

**Détection (T84, inchangée) :** `SyncService.merge()`/`mergeInto()`/`pull()` appellent `git.merge`
d'isomorphic-git avec `abortOnConflict` (défaut) : un conflit **ne touche ni le working directory ni
l'index** et lève `MergeConflictError`, détectée par `instanceof`. Le résultat
`{ success: false, conflicts, leftRef, rightRef }` porte les chemins en conflit et, depuis GH37, les
deux refs du merge (gauche = « mes modifications », droite = « destination ») pour ouvrir l'éditeur.

### 6.1 Résolution dans l'outil (GH37)

Toute opération en conflit propose **« Résoudre les conflits »**, qui ouvre (ou rouvre, avec son
brouillon) une **session de résolution** dans un onglet `/merge-resolve` :

| Origine | Gauche | Droite | Branche avancée par la finalisation |
|---|---|---|---|
| Publier (`publishWorkspace`) | `dev-<slug>` | intégration | intégration — puis fin de la publication (§6.3) |
| Graphe — merge (`merge`) | branche mergée | branche courante | branche courante (WD réaligné) |
| Graphe — `mergeInto` | `from` | `into` | `into` |
| Rafraîchir (`pull`) | branche locale | `origin/<branche>` | branche locale (WD réaligné) |

- **Service** : `MergeResolutionService` (main, canaux `merge-resolution:*` :
  `open/list/get/get-file/save-file/validate/keep-both/finalize/abandon`). Il ne travaille que sur
  les objets git : il parcourt les trois arbres (gauche, ancêtre commun, droite) avec `git.walk` et
  ne lit le contenu que des chemins modifiés des deux côtés.
- **Logique pure** : `@polenta/merge-core`, partagée entre le main et le renderer. Depuis GH222,
  un **moteur YAML générique** récursif (`MergeContext`) paramétré par une **description de
  structure** par type de fichier (identité des listes, nœuds atomiques, réconciliations, clé de
  bloc) — détail §6.6. Les règles ci-dessous en sont des descriptions :
  - *Objets typés* (exigences, tests, campagnes) : fusion **par unité**, c'est-à-dire chaque clé
    racine hors `fields`, et chaque `fields.<nom>` ; GH222 : une étape de test (`steps~<n>`, `order`
    renuméroté), un run de campagne par `entryId` (`runs~<entryId>`), `testCaseIds` par valeur. Une unité modifiée d'un seul côté, ou à
    l'identique des deux côtés, est reprise sans conflit. `version` prend le max et
    `needsRevalidation` le OU logique. **GH77** : `history` n'est jamais en conflit — union des
    entrées des deux côtés par champ, dédoublonnées sur `(at, by, value, source)`, triées par `at`
    (`mergeHistories`) ; si la valeur fusionnée diffère de la dernière entrée, la règle « valeur
    courante » de SPEC-REQ §4.4 s'applique.
  - *`links/links.yaml`* : fusion par lien (`id`), union des ajouts.
  - *`parameters/parameters.yaml`* : fusion par paramètre, clés triées.
  - *Autre YAML écrit par l'app* (GH222, `kind: 'yaml'`) : fusion structurelle générique — schéma,
    requêtes, dashboards, `polenta-repo.yaml`… ; *arbres d'affichage* (`kind: 'trees'`) : à plat
    par `id`, conflit de position `pos:<id>` ; *`.drawio`* (`kind: 'drawio'`) : par page
    (`page:<id>`), une page modifiée des deux côtés d'abord fusionnée ligne à ligne.
  - *Autres fichiers*, et YAML **non canonique** (commentaire, autre mise en forme : la fusion
    structurelle le réécrirait) : hunks `diff3`, la même bibliothèque qu'isomorphic-git.
  - *Binaires* : choix d'un côté, avec aperçu pour les images.
  - Conséquence : un objet dont des **champs différents** ont changé de chaque côté n'est **pas**
    en conflit, même si git l'aurait signalé ligne à ligne.
- **Sortie** : le **texte** est l'unique source de vérité. Un bloc non résolu y est une région de
  marqueurs nommée par sa clé (`<<<<<<< <gauche> [fields.statement]` … `=======` … `>>>>>>> <droite> [fields.statement]`).
  - Le mode Rendu (exigences et tests) édite une unité via `updateObjectOutput`, sans toucher aux
    régions encore ouvertes.
  - **Validation** (main) :
    - erreurs bloquantes : YAML ou marqueurs invalides, `id` différent du nom de fichier, type ou
      statut inconnu, titre vide, `fields` non objet, `links`/`parameters` mal formés ;
    - avertissements non bloquants : champ `required` vide, énoncé non EARS.
- **Supprimé d'un côté, modifié de l'autre** : Garder / Supprimer. Garder retire la pierre tombale
  `.polenta/tombstones/<ID>` apportée par le côté qui supprimait.
- **Brouillons** : `userData/merge-drafts/<id>.json`, avec `id` = hash(repo, oid gauche, oid droite).
  Ils ne sont jamais écrits dans le repo et sont repris après redémarrage (bouton « Reprendre la
  résolution des conflits » à côté de Publier). Si une branche a bougé, la session est **périmée** :
  elle ne peut plus être finalisée, « Recommencer avec l'état actuel » rouvre le même merge, et
  l'ancien brouillon est remplacé (l'utilisateur en est informé).

### 6.2 Finalisation

1. Les deux branches pointent toujours sur les oids de la session (sinon refus `stale`).
2. Le WD doit être propre si la branche cible est checkoutée, et toujours pour Publier, car la suite
   quitte la branche de travail (sinon refus `dirty-worktree`).
3. Tous les fichiers sont mergés et valides.
4. **L'arbre résultat est reconstruit par Polenta** : parcours des trois arbres, sorties validées,
   fusion propre recalculée pour les fichiers non listés, puis `writeBlob`/`writeTree`. `git.merge`
   n'est pas réutilisé : il ne permet ni supprimé/modifié ni la renumérotation de fichiers sans
   conflit.
5. `git.commit` à deux parents `[cible, autre]` sur la branche cible, puis `checkout` forcé si elle
   est checkoutée. Rien n'est écrit dans le WD avant ce point.

### 6.3 Suite de Publier

`resumePublishAfterResolution` (renderer) :
- retour sur l'intégration et suppression de `dev-<slug>`, seulement si elle était éphémère (T87) ;
- propagation du pin (T82) et raccrochage en cas de HEAD détaché (cas diamant) ;
- publication des repos restants (GH38) sous le même titre, puis push best-effort.

Si la suite échoue, l'écran de fin propose « Réessayer ». Un conflit sur un repo suivant rouvre
l'éditeur pour ce repo.

### 6.4 « Garder les deux » (même ID créé des deux côtés)

L'objet n'existe pas dans l'ancêtre commun, donc toute occurrence de son ID côté gauche désigne
l'objet de gauche.
- Le côté gauche est réécrit dans un **arbre git synthétique** (`leftTreeOid` de la session) :
  chaque fichier modifié à gauche depuis l'ancêtre est renuméroté. Cela couvre le nom de fichier,
  le dossier `test-runs/<ID>/`, et les occurrences de l'ID à mot entier dans le texte (liens, arbres
  d'affichage, campagnes, `entryId` `<ID>-<n>`, mentions).
- La session est ensuite recalculée sur (ancêtre, gauche', droite).
- Les fichiers touchés sans conflit apparaissent comme **« renumérotés »**, à relire puis merger
  (les binaires ne sont que renommés).
- L'ID et les fichiers impactés sont montrés avant confirmation.

**Détail historique (corrigé par T84) :** avant ce ticket, la détection reposait sur
`err.message.includes('MergeConflictError')`, qui ne correspondait en réalité **jamais** — le
message de `MergeConflictError` ne contient pas cette sous-chaîne (il lit "Automatic merge failed
with one or more merge conflicts in the following files: …"). Le catch tombait donc toujours dans
le `throw err`, jamais dans la branche `{ success: false, conflicts: [...] }` : un conflit de merge
remontait comme une erreur non gérée plutôt que comme l'échec binaire documenté. `T84` corrige la
détection (`instanceof` sur la classe typée) en même temps qu'il peuple `conflicts`.

**Non implémenté :**
- résolution d'un rebase en conflit (toujours abandonné automatiquement) ;
- choix à l'intérieur d'un champ (se fait par édition libre) ;
- (GH37, levé par GH222) ~~mode Rendu des campagnes, liens, paramètres, arbres et `.drawio`~~ :
  tout YAML a un Rendu (vue générique), un `.drawio` un choix par page (§6.6).

Les fichiers `.drawio` (XML texte) sont fusionnés page par page depuis GH222 ; une page modifiée des deux côtés passe d'abord par le merge ligne à ligne de git — rarement en conflit grâce aux IDs de nœuds stables.

### 6.5 Vues de diff en mode Rendu (GH178)

Hors résolution de conflits, les trois vues de diff (`/version-diff`, `/diff` working tree et
`/diff?commitSha`) partagent `components/diff/FileDiffView` : bascule Raw / Rendu, préférences
par poste (`lib/diffPrefs.ts`, Rendu par défaut). GH222 : Raw sur `@codemirror/merge`
(`RawDiffView`), Rendu dans la vue générique (`TreeDiffView`) — §6.6 ; ce qui suit reste vrai pour
le rendu des valeurs d'un objet typé.
Spécification fonctionnelle : `specs/GH178.md`.

- **Lecture à une version** : `readFileAt(repoPath, ref, filepath)` (`read-file-at.util.ts`, `ref`
  null = working tree, chemin normalisé, garde hors repo). Les réponses de `sync:diff`,
  `sync:commit-diff` et `sync:diff-file-between` portent `oldRef` / `newRef` (SHA lus, `null` =
  working tree) et `oldMissing` / `newMissing`. `drawio:read` et `image:read` acceptent un 3ᵉ
  argument `ref` ; `schema:get-at(repoPath, ref)` lit `.polenta/schema.yaml` à la ref (cache par
  commit borné). Chaque colonne lit ainsi ses diagrammes, images et schéma à sa propre version.
- **Rendu objet** (exigence, test) : ~~grille à deux colonnes, une rangée par unité~~ (GH222 : vue
  générique, présentation typée `treediff/presentation.ts` ; `id`, `projectId`, `branchId`,
  `objectTypeRef` et `history` masqués). Type résolu dans le schéma Après, puis Avant, puis courant ; libellés de la
  colonne Avant d'abord dans son propre schéma.
- **Diff mot à mot** : jetons (mots, espaces, ponctuation), LCS après retrait du préfixe et du
  suffixe communs, au-delà de 4 000 jetons tout le milieu est marqué sans détail. Un richtext est
  comparé sur son **DOM rendu** (`StaticRichTextViewer` prop `diffAgainst` : l'autre version est
  rendue dans un `<template>` inerte, puis `<del>` / `<ins>` posés nœud texte par nœud texte), pas
  sur le markdown source.
- **Étapes** : alignées par `diffTree` (LCS sur l'étape sans `order`, puis appariement par position
  entre deux ancres — GH222, remplace `alignSteps`).
- **Blocs média** (`lib/mediaDiff.ts`, `useMediaDiff`) : blocs drawio / image alignés par chemin ;
  encadrés si ajoutés, retirés, de référence différente ou de contenu référencé différent (page
  ciblée, image) entre les deux versions. Une unité richtext dont un bloc est encadré compte comme
  modifiée.
- **Fichier `.drawio`** : pages alignées par nom (par nom + id si doublon), rendues par le viewer
  statique à la version de chaque colonne ; diff au niveau de la page.


### 6.6 Moteur générique, mise en évidence, vue générique (GH222)

Spécification fonctionnelle : `specs/GH222.md` ; conception : `specs/GH222-design.md`.

- **Moteur** (`@polenta/merge-core`) :
  - `diffTree(avant, après, desc?)` : arbre de nœuds alignés (`DiffNode` : clé = pointeur
    échappé `/a/@id/#n`, état `unchanged|added|removed|modified|moved`, `indexes` des éléments
    alignés) ;
  - `MergeContext` / `mergeTree` : fusion récursive ; une région de marqueurs peut être à toute
    profondeur (entrée de mapping, élément ou plage de liste, première clé d'un élément) ; une liste
    devenue vide reste une liste (`!!seq`) ;
  - descriptions : `OBJECT_DESC`, `LINKS_DESC`, `PARAMETERS_DESC`, `genericDesc` ; heuristiques
    d'identité des listes (`id`, `entryId`, `name`, `key`, valeur unique, sinon `diff3` sur la forme
    canonique) ; un horodatage YAML (`Date`) est un scalaire (`isPlainObject` l'exclut) ;
  - `detectKind` : `yaml` / `trees` seulement si chaque côté est **exactement** ce qu'écrit l'app
    (`yaml.dump` `lineWidth: 120` ou style Suivi `lineWidth: -1`) — sinon `text` ;
  - `updateOutputAt(texte, chemin, valeur)` (édition en place, régions intactes),
    `canTakeBoth` / `resolveRegionBoth`, `resolveRegion` traite toutes les régions d'une clé ;
    chaque bloc porte le fragment de l'ancêtre (`MergeBlock.base`, `''` = absent de l'ancêtre) et
    `resolveRegionWith` le reprend (« Prendre l'ancêtre », ancêtre commun affiché) ;
  - `canonicalOutput` à la finalisation : réécriture au format de l'app **seulement si nécessaire**
    (ligne `-` seule, `!!seq`, étapes à renuméroter).
- **Session** : `MergeFileEntry.counts` (conflits, repris) ; validation `invalidDrawio`.
- **Mise en évidence** : jetons `diff-*` (`theme.config.ts`, clair / sombre, fonds opaques, texte
  ≥ 4,5:1 — `lib/diffTokens.test.ts`) ; `components/diffkit/` : `OverviewRuler`, `NavBar`,
  `useChangeNavigation` (`F7` / `Maj+F7`, `Alt+↓↑` hors champ éditable), `cmDiff.ts`.
- **Raw** : vues de diff `RawDiffView` (côte à côte / en ligne, préférence `layout`) ; résolution
  `RawPane` : côtés décorés contre l'ancêtre, actions par bloc dans chaque panneau
  (`blockLocator.ts` : fragment au plus près de la ligne de la région), « Prendre les deux »,
  bloc résolu marqué et « Réinitialiser », navigation des conflits, `F7` → fichier suivant.
- **Vue générique** (`components/treediff/`) : colonne Structure (12 px par niveau, plafond 6,
  largeur 180 px réglable, préférence `treeWidth`), une rangée par nœud dans une grille CSS unique,
  valeurs à la même position X ; `presentation.ts` (générique / objet typé) ; `TreeDiffView` (diff) ;
  `mergeModel.ts` + `TreeMerge.tsx` (merge : mêmes rangées en haut et dans la sortie, défilement
  synchronisé par `data-row-key`, cartes de conflit, édition en place) ; `.drawio` en merge :
  `DrawioMergeOutput` (choix par page).
- **Édition depuis le diff** (spec §12) : `DiffEditService.saveWorkingFile` (canal
  `diff:save-working-file`, liste blanche web, texte et texte de départ déclarés `CONTENT_ARGS`).
  Garde de chemin (y compris `realpath`), fichiers maintenus par l'app refusés
  (`isAppMaintainedFile` : `.git/`, `.gitmodules`, schéma, arbres, pierres tombales), refus si le
  disque a changé depuis le chargement (BOM ignoré). Exigence / test : par leur service
  (`requirements.update` + `transition`, `tests.update`, champs retirés en `null`), seulement pour
  `requirements/<id>.yaml` / `tests/<id>.yaml` ; clés non écrites par le service → `unsupported`
  avec la liste ; campagne refusée ; autre fichier écrit tel quel (YAML valide exigé). Renderer :
  brouillon avec son texte de départ (`FileDiffView`), Raw éditable (`revertControls`),
  `treediff/draftEdit.ts` (valeur, « Rétablir », « Ajouter »).
- **Thème** : `theme:generate` réécrit tout le bloc des variables de `index.css` — toute variable
  doit être déclarée dans `theme.config.ts` (les `chart-progress-*` de GH71 l'ont été par GH222 ;
  `themeTokens.gh222.test.ts`).

---

## 7. Images et fichiers externes

**Pas de stockage de fichiers dans Polenta.** Tout passe par des liens externes :

| Type de contenu | Stockage | Référence dans Polenta |
|----------------|----------|----------------------|
| Images dans les RICHTEXT | OneDrive (collé par l'utilisateur) | URL OneDrive dans le HTML TipTap |
| Captures d'écran de test | OneDrive | URL dans le champ `comment` du StepResult |
| Fichiers `.drawio` | Git (`attachments/<reqId>/diagram.drawio`) | Chemin relatif dans le champ DRAWIO |
| Documents PDF, plans | OneDrive | URL dans un champ RICHTEXT |

---

## 8. Authentification

- **PAT (Personal Access Token)** : token généré par l'utilisateur sur son remote git (GitHub…).
- **Stockage sécurisé** : `AuthService` utilise `keytar` pour stocker le PAT dans le keychain natif de l'OS (Credential Manager Windows, Keychain macOS, libsecret Linux).
- **Identité** : nom et email résolus depuis l'API du remote (`GET /user` sur GitHub) ou identité minimale de repli pour les autres hosts (T130 : support Gitea retiré).
- **Utilisation** : `SyncService` appelle `authService.getHttpsCredentials(url)` à chaque push/pull pour fournir les credentials à `isomorphic-git`.
- **Pas de Auth0, pas de JWT, pas de rôles centralisés.** Les droits d'accès aux repos sont gérés par le remote git (permissions de repo).

---

## 9. Distribution

| Composant | Mécanisme |
|-----------|-----------|
| Marque (GH49) | Marque blanche **au build** : `POLENTA_BRAND=<id>` (défaut `polenta`) choisit `apps/desktop/brands/<id>/` (`brand.yaml` : `id`, `productName`, `appId`, `executableName`, `website`, `update`, `theme` ; icônes ; `logo.svg`/`favicon.svg` optionnels — format dans `brands/README.md`). `scripts/brand.ts` valide (toute anomalie fait échouer le build, jamais de repli sur Polenta) ; la marque est figée par `define __POLENTA_BRAND__` dans main/preload/renderer (`electron.vite.config.ts`), dans le bundle MCP (`scripts/build-mcp-server.ts`) et dans le bundle du serveur web (`scripts/build-web-server.ts`, GH44), lue partout via `src/shared/brand.ts` (`BRAND`) ; points d'entrée `tsx` (serveur web en dev, tests) : `scripts/register-brand.ts` d'abord. Par marque : nom affiché, `app.setName(productName)` → dossier userData, service keytar = `id`, dossier de la configuration machine (GH45), `appId`, installeur, icônes, couleurs, source de mise à jour. Identifiants de format inchangés (`.polenta/`, `polenta-repo.yaml`, `window.polenta`, `mcpServers.polenta`, schéma de lien `polenta://`) : projets compatibles entre marques. Marques client commitées seulement avec l'accord explicite du client (repo public). Vérifications : `scripts/check-gh49.ts` |
| Application desktop | Binaire via `electron-builder` (`.dmg` macOS, `.AppImage` Linux), configuration `electron-builder.config.ts` paramétrée par la marque, lancée par `scripts/package.ts` (API programmatique ; refuse un `out/` construit pour une autre marque) — GH49, remplace `electron-builder.yml` ; schéma de protocole `polenta` déclaré pour toutes les marques (lien d'invitation, GH45). Windows (GH26) : installeur **NSIS one-click par utilisateur** `<productName sans espaces ni accents>-Setup-X.Y.Z.exe` (Polenta : `Polenta-Setup-X.Y.Z.exe`) (`perMachine: false`, installé dans `%LOCALAPPDATA%\Programs\<executableName>` — `polenta` pour la marque par défaut, **sans droits admin**) — remplace l'ancien `.exe` portable. Build `electron-builder --publish never` ; `publish: github` (laurentolive/polenta) ne sert qu'à générer `latest.yml`. La CI (`release.yml`, sur tag `vX.Y.Z`) téléverse l'installeur, son `.blockmap` et `latest.yml` ; déclenchement manuel avec `brand` (GH49) → installeur de la marque en artefact du run, jamais publié en release |
| Version (GH158) | Déduite du **tag git** au build, jamais de `package.json` (figé à `0.0.0-dev`) : `scripts/app-version.ts` (`git describe --tags --long --match 'v[0-9]*.[0-9]*.[0-9]*'`) → commit portant `vX.Y.Z` : `X.Y.Z` ; sinon `<dernière release>-alpha.<commits depuis>` (ex. `0.1.3-alpha.5`) ; `POLENTA_VERSION` l'impose (image Docker, sans `.git`) ; ni git ni tag → `0.0.0-dev`. Packagé : `scripts/package.ts` la pose en `extraMetadata.version` (package.json de l'asar → `app.getVersion()`, nom de l'installeur, `latest.yml`) ; en dev : `define __POLENTA_VERSION__` lu par `src/main/app-version.ts` ; serveur web : même `define` (`scripts/build-web-server.ts`). Publier une release = `git tag vX.Y.Z && git push origin vX.Y.Z` (`release.yml` vérifie le format du tag et la version déduite). Une build `-alpha` est antérieure à sa release au sens semver : l'updater lui propose cette release |
| Mises à jour (GH26) | `electron-updater` (`UpdateService`, main) : une seule vérification par session, ~10 s après l'ouverture de la fenêtre, uniquement en build packagé (`POLENTA_FORCE_DEV_UPDATE=1` + `dev-app-update.yml` pour tester en dev) et si la préférence app-level `autoCheckUpdates` (`userData/app-settings.json`, `AppSettingsService`, défaut `true`) est active. Pré-releases/drafts ignorés. GH49 : source = `update` de la marque (`publish` electron-builder → `app-update.yml`) ; marque sans `update` → ni `latest.yml` ni vérification, préférence masquée ; `POLENTA_FORCE_DEV_UPDATE` réservé à la marque `polenta`. **GH45 — verrou** : `autoUpdate: false` dans la configuration machine (DSI) ou `updates: managed` dans la configuration de l'équipe (forge) → `autoCheckUpdates` forcé à `false` et non modifiable (`autoCheckUpdatesLocked`, case grisée avec infobulle dans le panneau Compte) : aucune requête vers github.com (SPEC-ACCOUNTS-AUTH §6-7). Téléchargement en arrière-plan ; installation silencieuse à la fermeture (`autoInstallOnAppQuit`) ou via le badge (`quitAndInstall`). Erreurs (hors ligne, `latest.yml` absent) seulement journalisées `[update]` — jamais affichées |
| Délais réseau (GH15) | Préférence app-level `networkTimeoutSeconds` (« Délai de connexion réseau (s) », panneau Compte › Préférences, entier 10–120, défaut 10, écrite seulement si ≠ 10 ; desktop uniquement — `capabilities.networkTimeout`). Appliquée au process par l'hôte desktop (`HostContext.applyNetworkTimeout` → `net-timeouts.ts`), au démarrage puis à chaque écriture, sans redémarrage ; le serveur web, qui sert plusieurs utilisateurs dans un même process, garde les délais par défaut. Chaque délai de base est multiplié par `réglage / 10` : connexion TCP + TLS 10 s (dispatcher undici toujours explicite — `Agent` en direct, `ProxyAgent` avec `proxyTls`/`requestTls` via proxy, cache par (proxy, délai)), API de la forge 20 s (`forgeRequest`, sondes `timeoutMs: 10_000` incluses), git HTTPS en-têtes/corps 300 s (`git-http.ts`), images distantes des gabarits d'export 10 s. Un délai dépassé (`UND_ERR_CONNECT/HEADERS/BODY_TIMEOUT`, `ETIMEDOUT`) donne un message qui cite le réglage et sa valeur (`describeTimeout`, desktop seulement) ; le code d'origine est conservé, le classement `isNetworkUnreachable` (auto-pull hors ligne, Publier) est inchangé. Publier affiche la cause sous le message « réseau indisponible ». |
| Données utilisateur | `app.getPath('userData')` (dossier nommé d'après `productName` de la marque, GH49 — « Polenta » pour la marque par défaut) — `workspace.json` (liste des projets), `auth.json` (comptes), `app-settings.json` (préférences app-level : `autoCheckUpdates` GH26, `exportTemplatesDir` GH34, `networkTimeoutSeconds` GH15), `forge-config.json` (cache de la configuration d'équipe, GH45 S2b) ; le `userData` est remplaçable par `POLENTA_USER_DATA_DIR` et le service `keytar` par `POLENTA_KEYTAR_SERVICE` (profils isolés des tests d'interface, GH45) |
| Gabarits d'export d'exemple (GH34) | `resources/export-templates/` (5 gabarits Word et 5 gabarits Excel générés par `scripts/build-export-templates.ts` + `Référence des balises.html`) copiés hors `app.asar` via `extraResources` (`resources/export-templates/` du build packagé) ; « Installer les exemples » (panneau Compte) les copie dans `<bibliothèque>/Exemples Polenta/` sans écraser l'existant (`export-templates:install-examples`) |
| Repos git | Dossier choisi par l'utilisateur au clone (`SyncService.clone(remoteUrl, localPath)`) |
| Client web (GH44) | Image Docker `apps/desktop/Dockerfile.web` construite depuis la racine du monorepo, une par version et par marque (`--build-arg POLENTA_BRAND`) : `node:20-bookworm-slim`, bundle `out/web-server/index.cjs`, renderer `out/web`, `resources/`, dépendances externes du bundle (`scripts/web-runtime-package.mjs` : Fastify, playwright-core) et Chromium headless avec ses dépendances système ; utilisateur `node` (uid 1000), volume `/var/lib/polenta-web`, `HEALTHCHECK /healthz`, ~1,2 Go. Déployée par le kit `deploy/` de #45 (`polenta-host instance web enable`, service compose `polenta-web`, site Caddy) — `deploy/RUNBOOK.md` A15, `SPEC-WEB.md` §9 |
| Serveur MCP (T122) | Bundle autonome esbuild (`out/mcp-server/index.cjs`, CJS, `electron` alias-é vers un shim, `keytar` externe) copié hors `app.asar` via `extraResources` (`resources/mcp-server/`) — lancé en build packagé via le binaire Electron lui-même en mode `ELECTRON_RUN_AS_NODE=1` (pas de dépendance à un Node.js système). Détails : `SPEC-MCP-SERVER.md` §2.4. |

---

## 10. Variables d'environnement (apps/desktop)

```bash
# Développement uniquement — pas de .env en production desktop
NODE_ENV=development
VITE_DEV_SERVER_URL=http://localhost:5173    # renderer dev server

# Optionnel — override du chemin userData (tests automatisés)
POLENTA_USER_DATA_PATH=/tmp/polenta-test

# GH49 — marque du build (dossier apps/desktop/brands/<id>/), lue au BUILD uniquement
# (electron-vite, build:mcp-server, package) ; défaut : polenta. Aucun effet sur un binaire déjà construit.
POLENTA_BRAND=demo
```
