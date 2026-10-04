# SPEC-TECH — Stack Technique

> Référence parent : [SPEC.md](../SPEC.md)  
> Dernière révision : 2026-06-04  
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

---

## 2. Stack par couche

| Couche | Technologie | Version | Rôle |
|--------|------------|---------|------|
| Monorepo | Turborepo | 2.x | Builds incrémentaux, scripts partagés |
| Package manager | pnpm | 9.x | Workspaces, performance |
| Langage | TypeScript | 5.4+ | Full-stack |
| **Desktop shell** | Electron | 31.x | Fenêtre native, main process Node.js |
| Build desktop | electron-vite | 2.x | Bundling main + preload + renderer |
| Distribution | electron-builder | 24.x | Packaging Windows / macOS / Linux |
| **Frontend** | React | 18.x | UI (renderer Electron) |
| Build frontend | Vite | 5.x | Dev server + build |
| UI components | *(aucun — T130)* | — | `apps/desktop` n'utilise ni shadcn/ui ni Radix UI : composants Tailwind custom + `lucide-react` pour les icônes. shadcn/ui + Radix UI sont utilisés côté `apps/web` uniquement |
| Styles | Tailwind CSS | 3.x | Utility-first CSS |
| Éditeur RICHTEXT | TipTap | 2.x | WYSIWYG extensible (nœuds custom `drawioEmbed` et `ResizableImage` — diagramme draw.io rendu via le viewer officiel vendoré, images/diagrammes redimensionnables et rognables ; extensions standard `@tiptap/extension-table`+`-row`+`-header`+`-cell` pour les tableaux, cf. `SPEC-REQ-requirements.md` §3.2a/§3.2b/§3.2c) |
| Routage | TanStack Router | 1.x | Type-safe, file-based |
| État serveur | TanStack Query | 5.x | Cache, invalidation, optimistic updates |
| Formulaires | Zod (sans react-hook-form) | 3.x | Validation schema-driven — `react-hook-form` fait partie du stack `apps/web` uniquement, absent d'`apps/desktop` (T130) |
| **Git engine** | isomorphic-git | 1.25.x | Pur JS — clone, commit, push, pull, merge, branch |
| Fusion 3-voies (GH37) | `@polenta/merge-core` (package du monorepo) + diff3 | — / 0.0.3 | Logique pure de résolution des conflits : fusion par champ des objets, par lien (`links.yaml`) / par paramètre (`parameters.yaml`), hunks de lignes avec **le même `diff3`** qu'isomorphic-git (un fichier est en conflit ici exactement quand il l'est pour `git.merge`), marqueurs de conflit nommés, renumérotation. Importé par le main et le renderer (source TS aliasée, bundlée dans le main comme `@polenta/types`), seul package testé par **vitest** (`pnpm --filter @polenta/merge-core test`). Cf. §6 |
| Éditeur de code (GH37) | CodeMirror 6 (`@codemirror/state`, `view`, `commands`, `language`, `lang-yaml`) | 6.x | Panneaux Raw de l'éditeur de résolution des conflits : décorations de lignes, widgets « Prendre gauche/droite », défilement synchronisé. Monaco écarté (lourd, workers à configurer sous Electron). Chunk de la route `/merge-resolve` seulement (≈ 800 kB, chargé à la demande) |
| **Index mémoire** | Map + MiniSearch | 7.x | Requêtes, filtres, full-text — zéro DB |
| **Moteur de requête dashboards** | AlaSQL | 4.17.x | SQL exécuté sur tableaux JS en mémoire (pas de moteur de stockage) — dashboards/requêtes personnalisables (T77), cf. [SPEC-DASHBOARDS.md](SPEC-DASHBOARDS.md) |
| Export Excel | ExcelJS | 4.4.x | `.xlsx` pour tous les exports xlsx (T43 : cahiers d'exigences/tests/campagne, résultats de requête, analyse d'impact) — introduit en T77 pour le seul résultat de requête, généralisé par T43 via `ExportService`/canal IPC `export:save` (l'ancien canal ad hoc `queries:export-excel` a été retiré) |
| Export Word | docx | 9.7.x | `.docx` pour les exports docx (T43 : cahiers d'exigences/tests, rapport de campagne, dashboard) — construction programmatique (`Document`/`Paragraph`/`Table`), pas de conversion HTML→docx. Sert aussi à générer les gabarits d'exemple (GH34, `scripts/build-export-templates.ts`) |
| Export Word par gabarit client (GH34) | docxtemplater (cœur MIT) + pizzip + angular-expressions | 3.71.x / 3.x / 1.7.x | Remplissage d'un `.docx` fourni par le client (balises `{{…}}`, boucles, conditions, balises brutes `{{@…}}`). Parseur d'expressions limité au scope de données (pas d'exécution de code depuis un gabarit), filtres en liste blanche. Modules payants (images, HTML) non utilisés : le richtext est converti par Polenta (markdown-it → WordprocessingML, `export/template/markdown-to-ooxml.ts`), médias/numérotation ajoutés au paquet (`docx-package.ts`). Ces 4 libs (+ markdown-it) sont **bundlées** dans le main (`exclude` d'`externalizeDepsPlugin`, deps transitives non hissées par pnpm) et chargées en `import()` au premier export (T141). Détails : `SPEC-ELECTRON-DESKTOP.md` §19.15a |
| Export Excel par gabarit client (GH34) | xlsx-template | 1.4.x | Remplissage d'un `.xlsx` du client (balises `${…}`, lignes modèles `${table:…}`) en conservant tout le classeur (graphiques, images, mise en page) — exceljs écarté (relecture/réécriture perdant graphiques et tableaux croisés). Complété par une réécriture des références (`xlsx-refs.ts`) que la lib ne met pas à jour. Bundlée dans le main comme docxtemplater. Détails : `SPEC-ELECTRON-DESKTOP.md` §19.15a |
| Export PDF | `webContents.printToPDF` (Electron natif) | — | Aucune dépendance ajoutée — rend une route imprimable dédiée (`/print/*`) dans une fenêtre Electron cachée plutôt que de reconstruire du HTML côté main process (T43) |
| Rendu des widgets dashboards | recharts | 2.12.x | Barres/camembert/courbe — thémable via les tokens CSS du design system (T77) |
| Parsing YAML | js-yaml | 4.x | Sérialisation des fichiers du repo |
| **Auth desktop** | keytar | 7.x | Stockage sécurisé PAT dans le keychain OS |
| **File watching** | chokidar | 3.x | Détection des changements fichiers (pull, etc.) |
| **Fichiers externes** | OneDrive (liens) | — | Aucun stockage dans Polenta — URLs collées dans les RICHTEXT |
| Version serveur web | NestJS 10.x | 10.x | Conservé dans `apps/api` pour une future version web |

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
  requête partagés, y compris le passage partagé → privé). Versionnées avec la suppression,
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

**T130 : seul `integrationBranch` y est réellement lu/écrit** (`git.service.ts` —
`getIntegrationBranch`/`setIntegrationBranch`). Il n'y a pas de `schemaVersion`, `name`, ni
`prefixes` dans ce fichier — les types d'objets et leurs préfixes vivent entièrement dans
`.polenta/schema.yaml` (voir `SPEC-ELECTRON-DESKTOP.md` §20).

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
- **Logique pure** : `@polenta/merge-core`, partagée entre le main et le renderer.
  - *Objets typés* (exigences, tests, campagnes) : fusion **par unité**, c'est-à-dire chaque clé
    racine hors `fields`, et chaque `fields.<nom>`. Une unité modifiée d'un seul côté, ou à
    l'identique des deux côtés, est reprise sans conflit. `version` prend le max et
    `needsRevalidation` le OU logique.
  - *`links/links.yaml`* : fusion par lien (`id`), union des ajouts.
  - *`parameters/parameters.yaml`* : fusion par paramètre, clés triées.
  - *Autres fichiers* : hunks `diff3`, la même bibliothèque qu'isomorphic-git.
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

**Non implémenté (hors périmètre GH37) :**
- résolution d'un rebase en conflit (toujours abandonné automatiquement) ;
- choix à l'intérieur d'un champ (se fait par édition libre) ;
- mode Rendu des campagnes, liens, paramètres, arbres et `.drawio` (Raw seulement).

Les fichiers `.drawio` (XML texte) bénéficient du merge git ligne par ligne — rarement en conflit grâce aux IDs de nœuds stables.

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
| Application desktop | Binaire via `electron-builder` (`.dmg` macOS, `.AppImage` Linux). Windows (GH26) : installeur **NSIS one-click par utilisateur** `Polenta-Setup-X.Y.Z.exe` (`perMachine: false`, installé dans `%LOCALAPPDATA%\Programs\Polenta`, **sans droits admin**) — remplace l'ancien `.exe` portable. Build `electron-builder --publish never` ; `publish: github` (laurentolive/polenta) ne sert qu'à générer `latest.yml`. La CI (`release.yml`, sur tag `vX.Y.Z`) téléverse l'installeur, son `.blockmap` et `latest.yml` |
| Mises à jour (GH26) | `electron-updater` (`UpdateService`, main) : une seule vérification par session, ~10 s après l'ouverture de la fenêtre, uniquement en build packagé (`POLENTA_FORCE_DEV_UPDATE=1` + `dev-app-update.yml` pour tester en dev) et si la préférence app-level `autoCheckUpdates` (`userData/app-settings.json`, `AppSettingsService`, défaut `true`) est active. Pré-releases/drafts ignorés. Téléchargement en arrière-plan ; installation silencieuse à la fermeture (`autoInstallOnAppQuit`) ou via le badge (`quitAndInstall`). Erreurs (hors ligne, `latest.yml` absent) seulement journalisées `[update]` — jamais affichées |
| Données utilisateur | `app.getPath('userData')` — `workspace.json` (liste des projets), `auth.json` (comptes), `app-settings.json` (préférences app-level : `autoCheckUpdates` GH26, `exportTemplatesDir` GH34) |
| Gabarits d'export d'exemple (GH34) | `resources/export-templates/` (5 gabarits Word et 5 gabarits Excel générés par `scripts/build-export-templates.ts` + `Référence des balises.html`) copiés hors `app.asar` via `extraResources` (`resources/export-templates/` du build packagé) ; « Installer les exemples » (panneau Compte) les copie dans `<bibliothèque>/Exemples Polenta/` sans écraser l'existant (`export-templates:install-examples`) |
| Repos git | Dossier choisi par l'utilisateur au clone (`SyncService.clone(remoteUrl, localPath)`) |
| Serveur MCP (T122) | Bundle autonome esbuild (`out/mcp-server/index.cjs`, CJS, `electron` alias-é vers un shim, `keytar` externe) copié hors `app.asar` via `extraResources` (`resources/mcp-server/`) — lancé en build packagé via le binaire Electron lui-même en mode `ELECTRON_RUN_AS_NODE=1` (pas de dépendance à un Node.js système). Détails : `SPEC-MCP-SERVER.md` §2.4. |

---

## 10. Variables d'environnement (apps/desktop)

```bash
# Développement uniquement — pas de .env en production desktop
NODE_ENV=development
VITE_DEV_SERVER_URL=http://localhost:5173    # renderer dev server

# Optionnel — override du chemin userData (tests automatisés)
POLENTA_USER_DATA_PATH=/tmp/polenta-test
```
