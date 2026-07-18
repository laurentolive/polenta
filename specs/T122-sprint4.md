# T122-sprint4 — `AGENTS.md`/`.mcp.json` (création + régénération à l'ouverture), packaging, doc finale

**Dernier sprint du ticket.** Périmètre : design initial (§6 de `specs/T122-design.md`)
**étendu** par le point 7 ajouté à `specs/T122.md` juste avant ce sprint — absorbe T121
(vérification/régénération d'`AGENTS.md`/`.mcp.json` à l'ouverture d'un projet
**existant**, pas seulement à la création).

## Fichiers modifiés

Nouveaux :
- `apps/desktop/src/mcp-server/mcp-json.template.ts` — `buildMcpJsonContent`,
  `extractMcpJsonVersion`, `MCP_JSON_TEMPLATE_VERSION` (contenu/version de
  `.mcp.json`, sans dépendance à `electron`).
- `apps/desktop/src/mcp-server/electron-shim.ts` — substitut d'`electron`
  (`app`/`shell`/`BrowserWindow` en Proxy qui échouent explicitement si invoqués),
  utilisé UNIQUEMENT au bundling packagé (`esbuild --alias:electron=...`).
- `apps/desktop/src/main/services/mcp-launch.util.ts` —
  `resolveMcpServerLaunchConfig()` : résout la commande de lancement du serveur MCP
  selon `app.isPackaged` (dev : `node` + `tsx` + source ; packagé : binaire Electron
  en `ELECTRON_RUN_AS_NODE=1` + bundle `resources/mcp-server/index.cjs`).
- `specs/SPEC-MCP-SERVER.md` — doc finale (point d'entrée, DI, les 12 tools avec
  contrats entrée/sortie, packaging, mécanisme de génération/régénération).

Modifiés :
- `apps/desktop/src/main/services/agents-md.template.ts` — `AGENTS_MD_TEMPLATE_VERSION`
  (marqueur de version), `extractAgentsMdVersion()`, marqueur
  `<!-- polenta:agents-md-version:N -->` en tête du template, nouvelle section
  "Serveur MCP — interface programmatique préférée..." (liste des 12 tools, mention du
  repli YAML direct pour les clients sans MCP).
- `apps/desktop/src/main/services/workspace.service.ts` — `createNewProject()` écrit
  désormais `.mcp.json` en plus d'`AGENTS.md` (committé par le commit initial) ;
  nouvelle méthode publique `ensureAgentFiles(rootRepoPath)` + privées
  `ensureAgentsMd`/`ensureMcpJson`/`ensureVersionedFile` (factorisée en revue) ;
  `openWorkspace()` appelle `ensureAgentFiles` à chaque ouverture d'un projet avec un
  `rootRepoPath` résolu, avant tout autre traitement (y compris le court-circuit
  "cache de tree valide").
- `apps/desktop/package.json` — nouveau script `build:mcp-server` (bundle esbuild
  autonome), `package` l'invoque avant `electron-builder` ; nouvelle devDependency
  `esbuild`.
- `apps/desktop/electron-builder.yml` — `out/mcp-server/**/*` exclu de `files`
  (app.asar), copié séparément via `extraResources` (`resources/mcp-server/`) avec
  `node_modules/keytar` à côté (dépendance native externalisée par esbuild).
- `TICKETS.md` — T122 passé en `coding sprint 4` ; entrée **T121 retirée** (absorbée
  par ce ticket, cf. note dans `specs/T122.md`).
- `specs/SPEC-ELECTRON-DESKTOP.md`, `specs/SPEC-TECH-stack.md`,
  `specs/SPEC-TEMPLATES.md`, `specs/SPEC-REQ-requirements.md`, `specs/SPEC-TESTS.md`,
  `specs/SPEC-INDEX.md` — cf. § Mises à jour SPEC ci-dessous.

Non modifiés (conforme au périmètre) : `apps/desktop/src/mcp-server/index.ts`,
`container.ts`, `tools/*` (aucun changement de tool dans ce sprint — uniquement
génération/régénération de fichiers de config et packaging), `main/container.ts`,
`main/ipc/index.ts`.

## Comportement implémenté

### 1. Génération à la création d'un projet (comportement du design initial, confirmé)

`createNewProject()` écrit `AGENTS.md` (mentionnant désormais le serveur MCP) et
`.mcp.json` (pointant vers une commande qui démarre effectivement le serveur, résolue
par `resolveMcpServerLaunchConfig()`), tous deux inclus dans le commit initial `init:
create project` — `git status` après création est propre.

### 2. Vérification/régénération à l'ouverture d'un projet existant (point 7, absorbe T121)

`WorkspaceService.openWorkspace()` appelle `ensureAgentFiles(rootRepoPath)` à chaque
ouverture. Pour `AGENTS.md` et `.mcp.json` indépendamment (`Promise.all`) :

- Lit le fichier existant, en extrait le marqueur de version embarqué (commentaire
  `<!-- polenta:agents-md-version:N -->` en tête pour `AGENTS.md` ; champ JSON racine
  `_polentaTemplateVersion` pour `.mcp.json`).
- Marqueur absent ou périmé (< version courante) → régénération complète (réécriture
  intégrale, PAS un merge de contenu — cf. divergence documentée plus bas).
- Marqueur égal à la version courante → **aucune écriture** (mtime/hash inchangés,
  vérifié manuellement, cf. § Vérifications).

Best-effort : une erreur de lecture/écriture est journalisée sur stderr, n'empêche
jamais l'ouverture du projet.

### 3. Packaging — invocable depuis une app Electron packagée

`pnpm --filter @polenta/desktop run build:mcp-server` (nouveau script, esbuild)
produit un bundle CJS autonome `out/mcp-server/index.cjs` :
- `electron` alias-é vers `electron-shim.ts` (jamais réellement invoqué par les tools
  MCP — cf. `specs/T122-design.md` §2.1 — le shim lève une erreur explicite s'il
  l'était, au lieu d'un `Cannot find module 'electron'` cryptique).
- `keytar` (addon natif) marqué `--external`, résolu au runtime par la remontée
  standard de `node_modules`.

`electron-builder.yml` copie ce bundle hors `app.asar` via `extraResources`
(`resources/mcp-server/`, avec `node_modules/keytar` à côté). En build packagé,
`.mcp.json` pointe vers le binaire Electron packagé lui-même
(`process.execPath`), lancé en mode `ELECTRON_RUN_AS_NODE=1` sur ce bundle — évite
toute dépendance à un Node.js système sur le poste de l'utilisateur final.

### 4. Doc finale

`specs/SPEC-MCP-SERVER.md` — point d'entrée (dev + packagé), DI headless, les 12
tools (contrats entrée/sortie complets), convention d'erreur, mécanisme de
génération/régénération, limitations connues (reprises des sprints 1-3 + celles de
ce sprint).

## Divergences par rapport au design

- **`.mcp.json` embarque un marqueur de version** (`_polentaTemplateVersion`, champ
  JSON racine) — le design (§6.2) ne montrait qu'un exemple de contenu sans marqueur ;
  nécessaire pour satisfaire le point 7 du spec ("marqueur de version... équivalent
  pour `.mcp.json`"), symétrique à `AGENTS_MD_TEMPLATE_VERSION`. Les clients MCP
  ignorent les clés inconnues à la racine — vérifié en conditions réelles (§
  Vérifications, scénario 1) : la découverte des tools n'est pas perturbée.
- **`electron-shim.ts` (nouveau, absent du design)** — le design évoquait un bundle
  esbuild sans détailler comment gérer l'import `electron` des services réutilisés
  (`AuthService` notamment) dans un contexte Node autonome packagé. Solution choisie
  après investigation au sprint 4 : alias esbuild vers un shim qui échoue
  explicitement si `app`/`shell` sont réellement invoqués (jamais le cas dans les
  tools MCP), plutôt qu'un `Noop*Service` typé au niveau service (alternative déjà
  évoquée au sprint 1 pour un usage plus large, ici limitée au strict nécessaire du
  packaging).
- **`keytar` copié dans `extraResources` (`resources/mcp-server/node_modules/keytar`)**
  — détail de packaging non anticipé par le design (§6.2 le signalait explicitement
  comme "à vérifier en conditions réelles"). Nécessaire car `AuthService` importe
  `keytar` de façon statique (même si jamais invoqué par les tools MCP) — sans ce
  copiage, le simple `require('keytar')` échouerait au chargement du bundle packagé
  (fichier hors `app.asar`, pas de remontée `node_modules` possible sans lui).
- **`ensureVersionedFile` factorisée (trouvé en revue de code, avant tout commit)** —
  l'implémentation initiale dupliquait le motif "lire → extraire version → comparer →
  écrire" à l'identique dans `ensureAgentsMd`/`ensureMcpJson`. Factorisé en une
  méthode privée commune paramétrée par `label`/`extractVersion`/`targetVersion`/
  `buildContent` (callback paresseux — `.mcp.json` n'est reconstruit, donc
  `app.getAppPath()`/`app.isPackaged` évalués, que si une régénération s'avère
  effectivement nécessaire).
- **Packaging vérifié différemment de ce que le design anticipait** : plutôt qu'un
  build `electron-builder` complet (installeur réel, hors de portée raisonnable dans
  cet environnement — outils de signature/téléchargement, temps d'exécution), le
  mécanisme exact du lancement packagé (`ELECTRON_RUN_AS_NODE=1` + binaire Electron +
  bundle esbuild) a été reproduit et vérifié directement :
  `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe
  out/mcp-server/index.cjs --repo <path>` démarre bien le serveur (pas de crash au
  chargement, `[mcp-server] démarré` sur stderr). Documenté comme vérification
  partielle dans `SPEC-MCP-SERVER.md` §2.4/§7 — un build `electron-builder` complet
  reste à valider par l'humain avant une première release packagée.

Aucune autre divergence de périmètre — le reste (génération à la création, contenu
des 12 tools, DI, convention d'erreur) est inchangé depuis les sprints 1-3.

## Mises à jour SPEC

Conformément à `WORKFLOW.md` § Agent Dev "Si dernier sprint" : chaque section listée
dans `## Refs SPEC` de `specs/T122.md` a été comparée à l'implémentation finale.

| Fichier | Section | Modification |
|---|---|---|
| `SPEC-ELECTRON-DESKTOP.md` | §1 | Note précisant que le serveur MCP (stdio, process séparé) n'est pas une exception à la règle "pas de serveur HTTP" — c'est un second point d'entrée sur le même noyau de services, sans port réseau, sans commit/push automatique. |
| `SPEC-TECH-stack.md` | §4 (§4.4 Gestion des IDs) | Note sur `peekNextCounterId` (lecture seule, dry-run) et la couverture de T118 étendue aux écritures en série d'un import massif MCP. |
| `SPEC-TECH-stack.md` | §9 (Distribution) — **nouvelle ligne** | Ligne "Serveur MCP (T122)" : bundle esbuild autonome, `extraResources`, lancement via `ELECTRON_RUN_AS_NODE`. |
| `SPEC-TEMPLATES.md` | §3 | Note : `add_component` (MCP) crée un sous-composant local par le même mécanisme (`SchemaService.addNode`) — pas de submodule via MCP. |
| `SPEC-REQ-requirements.md` | §2 (2.1 ObjectType) | Note : modèle manipulé tel quel par `get_schema`/`bulk_import_requirements`/`add_object_type`. |
| `SPEC-REQ-requirements.md` | §3 (3.1 SchemaField) | Note : `validator: EARS` est la seule règle enforcée en dur par le serveur MCP (bulk import), le reste reste hors enforcement (statu quo). |
| `SPEC-REQ-requirements.md` | §6 (Identifiants) | Note : `bulk_import_requirements` prévisualise (`peekNextCounterId`) puis attribue (mécanisme T118) les IDs, sans collision. |
| `SPEC-TESTS.md` | §1 (Vue d'ensemble) | Note : `list_tests`/`list_campaigns`/`bulk_import_tests`/`bulk_import_campaigns` exposés via MCP ; `TestRun`/exécution hors périmètre MCP. |
| `SPEC-MCP-SERVER.md` | — | **Nouveau fichier** — doc complète du serveur MCP (point d'entrée, DI, 12 tools, packaging, génération/régénération AGENTS.md/.mcp.json, limitations connues). |
| `SPEC-INDEX.md` | — | Colonne `MAJ` mise à jour → `T122` pour toutes les sections ci-dessus (+ nouvelle ligne `SPEC-TECH-stack.md` §9, nouvelle ligne `SPEC-MCP-SERVER.md`). |

## Vérifications effectuées

- `pnpm --filter @polenta/desktop run typecheck` → 0 erreur (avant et après le
  correctif de revue).
- Revue de code effectuée **en inline** (skill `code-review`, effort *high*, 8 angles
  couverts manuellement — correctness A/B/C, cleanup reuse/simplification/efficiency,
  altitude, conventions CLAUDE.md) : 1 point relevé et corrigé avant commit
  (**[mineur, corrigé]** duplication du motif "lire → comparer version → écrire" entre
  `ensureAgentsMd`/`ensureMcpJson`, factorisée en `ensureVersionedFile`). Aucun bug de
  correctness trouvé — en particulier vérifié : pas de risque d'écrasement d'un
  `rootRepoPath` non résolu (le call site est placé après le `return` anticipé de la
  branche "pas de rootRepo"), pas de comparaison de type erronée sur le marqueur de
  version, pas de calcul de commande de lancement gaspillé sur le chemin "déjà à jour"
  (très majoritaire à chaque ouverture).
- **Bundle esbuild** (`pnpm run build:mcp-server`) : construit sans erreur
  (`out/mcp-server/index.cjs`, ~1.8 Mo). Démarré avec succès :
  - `node out/mcp-server/index.cjs --repo <path>` (Node système).
  - `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe
    out/mcp-server/index.cjs --repo <path>` (reproduit exactement le mécanisme
    packagé, cf. divergences ci-dessus).
  - Un vrai client MCP (`@modelcontextprotocol/sdk` `Client`/`StdioClientTransport`,
    en lançant **la commande exacte générée dans `.mcp.json`** par
    `createNewProject()`) se connecte, découvre les 12 tools, et `get_schema` répond
    correctement — validation bout-en-bout du critère d'acceptation "`.mcp.json`
    généré... pointe vers un point d'entrée qui démarre effectivement le serveur".
- **Vérification manuelle bout-en-bout via l'app desktop réelle** (build
  `electron-vite build` + skill `run-desktop`, Playwright `_electron`, sur des copies
  jetables — jamais `C:\Dev\polenta-demo\aspirateur-demo` directement) :
  1. **Création d'un nouveau projet** (`C:/tmp/t122-new-project/MonProjetT122`) :
     `AGENTS.md` (marqueur `v1`, section MCP présente) et `.mcp.json` (marqueur
     `_polentaTemplateVersion: 1`, commande `node` + `tsx` + source, mode dev) générés,
     tous deux dans le commit `init: create project`, `git status` propre. Le serveur
     MCP démarré avec la commande exacte de ce `.mcp.json` répond bien (cf. ci-dessus).
  2. **Ouverture d'un projet existant sans ces fichiers** (copie jetable de
     `aspirateur-demo`) : les deux fichiers générés automatiquement à l'ouverture,
     apparaissent en `??` (non trackés) dans `git status` — jamais committés
     automatiquement.
  3. **Réouverture du même projet** (marqueurs désormais à jour) : `stat`/`md5sum`
     avant/après identiques sur les deux fichiers — **aucune écriture**, confirmé
     bit à bit.
  4. **Marqueurs rendus périmés manuellement** (`agents-md-version:0`,
     `_polentaTemplateVersion: 0`, + une note utilisateur ajoutée en bas
     d'`AGENTS.md`) puis réouverture : les deux fichiers régénérés (mtime et hash
     changés, contenu redevenu identique à celui d'un projet fraîchement créé) — la
     note utilisateur ajoutée en bas **n'a pas survécu** à cette régénération réelle
     (comportement attendu et documenté : réécriture simple par marqueur de version,
     pas un merge de contenu — cf. `specs/T122.md` "Hors scope").

  Scénarios couverts (numérotation `specs/T122-tests.md` § Sprint 4) : 35 (nominal,
  bout-en-bout réel), 36 (git status propre après création), plus les 3 scénarios du
  point 7 non numérotés explicitement dans `T122-tests.md` (rédigé avant l'extension
  du périmètre) : absent → généré, à jour → inchangé (mtime/hash), périmé →
  régénéré. Scénario 37 (mode packagé vs dev) : la commande générée diffère bien
  entre les deux (vérifié par lecture + test direct du mécanisme
  `ELECTRON_RUN_AS_NODE`, cf. divergences ci-dessus) — un build `electron-builder`
  complet n'a pas été exécuté dans cet environnement (documenté comme limitation,
  `SPEC-MCP-SERVER.md` §7).

## Comment tester manuellement

```bash
# 1. Build de l'app + bundle mcp-server
pnpm --filter @polenta/desktop run build
pnpm --filter @polenta/desktop run build:mcp-server   # produit out/mcp-server/index.cjs

# 2. Vérifier le bundle packagé démarre (sans électron-builder complet) :
ELECTRON_RUN_AS_NODE=1 apps/desktop/node_modules/electron/dist/electron.exe \
  apps/desktop/out/mcp-server/index.cjs --repo <repo-polenta-existant>
# → doit afficher "[mcp-server] démarré — repo: ..." sur stderr, rester actif.
```

Dans l'app desktop (`pnpm --filter @polenta/desktop dev`, ou build packagé) :

1. **Créer un nouveau projet** → vérifier `AGENTS.md` (mentionne le serveur MCP) et
   `.mcp.json` (JSON valide, `mcpServers.polenta`) à la racine, tous deux committés
   par `init: create project`.
2. **Ouvrir un projet existant sans ces fichiers** (ex. un repo Polenta créé avant
   T106) → les deux fichiers doivent apparaître après ouverture, non committés
   (`git status` → `??`).
3. **Rouvrir le même projet** → `AGENTS.md`/`.mcp.json` doivent avoir un mtime
   strictement inchangé (`stat`/`Get-Item .LastWriteTime`).
4. **Modifier manuellement le marqueur** (`<!-- polenta:agents-md-version:0 -->` en
   tête d'`AGENTS.md`, ou `"_polentaTemplateVersion": 0` dans `.mcp.json`) puis
   rouvrir → le fichier modifié doit être régénéré (mtime changé, marqueur revenu à
   la version courante).

## Ce qui reste (hors périmètre de ce ticket)

- Build `electron-builder` complet (installeur réel) non exécuté dans cet
  environnement — à valider par l'humain avant une première release packagée
  (cf. `SPEC-MCP-SERVER.md` §7).
- Limitations déjà documentées aux sprints 1-3 (mode mono-repo par défaut, scan
  `prefix` mono-repo pour `add_object_type`, `readonly` non vérifié dans les services
  `create()` eux-mêmes, repli silencieux de `readFromDisk()` sur `DEFAULT_SCHEMA`) —
  reprises et consolidées dans `SPEC-MCP-SERVER.md` §7, non retraitées ici (hors
  périmètre de ce sprint).
