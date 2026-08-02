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
| **Index mémoire** | Map + MiniSearch | 7.x | Requêtes, filtres, full-text — zéro DB |
| **Moteur de requête dashboards** | AlaSQL | 4.17.x | SQL exécuté sur tableaux JS en mémoire (pas de moteur de stockage) — dashboards/requêtes personnalisables (T77), cf. [SPEC-DASHBOARDS.md](SPEC-DASHBOARDS.md) |
| Export Excel | ExcelJS | 4.4.x | `.xlsx` pour tous les exports xlsx (T43 : cahiers d'exigences/tests/campagne, résultats de requête, analyse d'impact) — introduit en T77 pour le seul résultat de requête, généralisé par T43 via `ExportService`/canal IPC `export:save` (l'ancien canal ad hoc `queries:export-excel` a été retiré) |
| Export Word | docx | 9.7.x | `.docx` pour les exports docx (T43 : cahiers d'exigences/tests, rapport de campagne, dashboard) — construction programmatique (`Document`/`Paragraph`/`Table`), pas de conversion HTML→docx |
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
    ├── counters.yaml                ← compteurs par préfixe
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

Les identifiants sont attribués à la **création** depuis `config/counters.yaml` :

```yaml
# config/counters.yaml
REQ: 42        # prochain numéro d'exigence (préfixe selon le type)
TEST: 15       # prochain numéro de cas de test
REVIEW: 6      # prochain numéro de Review
CAMP: 3        # prochain numéro de Campagne
```

Chaque service lit sa clé, génère l'ID, incrémente, et `fs.writeFile` le fichier (sans committer). Le commit inclura cette mise à jour avec le reste des modifications de la branche `dev-*` courante (cf. workflow "Publier", `SPEC-FORKS-BRANCHES-BASELINES.md` §2).

**Résolution des conflits sur `counters.yaml`** : si deux branches `dev-*` créées depuis la même base génèrent le même ID (ex. deux `REQ-42` sur deux branches), le merge détectera le conflit. La résolution prend la valeur la plus haute des deux, et les IDs en double sur la branche mergée sont renommés. Ce cas est rare car les branches `dev-*` sont créées depuis la branche d'intégration, qui avance linéairement.

**Écritures en série rapprochées (T118, étendu T122)** : `nextCounterId()`
(`id-counter.util.ts`) sérialise chaque lecture+écriture de `counters.yaml` par
`repoPath` via une file de promesses en mémoire, et recale le compteur sur
`max(compteur stocké, plus haut <PREFIX>-NNNN présent sur disque) + 1` — couvre aussi
bien les collisions entre deux `create()` concurrents que les écritures en série
rapide d'un import massif (`bulk_import_*` du serveur MCP, `SPEC-MCP-SERVER.md` §4.2,
qui écrit N objets l'un après l'autre dans une seule requête). Le même fichier expose
`peekNextCounterId()` — variante **lecture seule**, sans écrire `counters.yaml` —
utilisée par le mode `dryRun: true` de `bulk_import_*` pour prévisualiser les IDs qui
seraient attribués, sans effet de bord sur le compteur réel.

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

**État actuel (T84) :** `SyncService.merge()`/`mergeInto()` détectent un conflit via
`err instanceof git.Errors.MergeConflictError` et renvoient `conflicts: string[]` — les chemins
réels des fichiers en conflit (`err.data.filepaths`), pas de résolution champ par champ. Il
n'existe pas de `MergeService` séparé ; en cas d'échec du "Publier" (cf.
`SPEC-FORKS-BRANCHES-BASELINES.md` §2.4), l'utilisateur reste sur sa branche `dev-*`, une
notification affiche le message générique **et** la liste des fichiers en conflit, avec un lien
vers `/version-diff` scopé au repo concerné (root ou composant) et pré-rempli avec le diff entre la
branche `dev-*` et la branche d'intégration — pas d'assistance de résolution dans l'UI au-delà de
ce diff en lecture seule.

**Détail historique (corrigé par T84) :** avant ce ticket, la détection reposait sur
`err.message.includes('MergeConflictError')`, qui ne correspondait en réalité **jamais** — le
message de `MergeConflictError` ne contient pas cette sous-chaîne (il lit "Automatic merge failed
with one or more merge conflicts in the following files: …"). Le catch tombait donc toujours dans
le `throw err`, jamais dans la branche `{ success: false, conflicts: [...] }` : un conflit de merge
remontait comme une erreur non gérée plutôt que comme l'échec binaire documenté. `T84` corrige la
détection (`instanceof` sur la classe typée) en même temps qu'il peuple `conflicts`.

**Non implémenté, hors périmètre (pas de ticket ouvert à ce jour) :** résolution champ par champ
(base/ours/theirs par champ YAML, UI de choix de valeur). Nécessiterait un service lisant les 3
versions du fichier via `git.readYamlRef()`, une comparaison de champs, et une UI dédiée — décrit
pour mémoire, pas engagé.

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
| Application desktop | Binaire via `electron-builder` (`.exe` Windows, `.dmg` macOS, `.AppImage` Linux) |
| Mises à jour | `electron-updater` — vérification au démarrage, téléchargement en arrière-plan |
| Données utilisateur | `app.getPath('userData')` — `workspace.json` (liste des projets), `auth.json` (comptes) |
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
