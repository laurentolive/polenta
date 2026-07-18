# T122-sprint3 — Tools de mutation de schéma

## Fichiers modifiés

Modifiés :
- `apps/desktop/src/main/services/schema.service.ts` — `SchemaValidationError` (+
  `SchemaValidationErrorCode`), 5 nouvelles méthodes publiques (`addNode`,
  `addObjectType`, `addField`, `addStatus`, `addLinkType`) + helpers privés
  (`requireNode`, `requireNotReadonly`, `requireObjectType`, `findNodeUsingPrefix`,
  `replaceObjectType`) + `withMutationQueue` (sérialisation par `repoPath`, trouvé en
  revue de code — cf. divergences).
- `apps/desktop/src/mcp-server/mcp-types.ts` — nouveau helper `errorToolResult()`
  (réponse MCP `isError: true` standard).
- `apps/desktop/src/mcp-server/index.ts` — enregistre `registerSchemaMutationTools`.
- `TICKETS.md` — T122 passé en statut `coding sprint 3`.

Nouveaux :
- `apps/desktop/src/mcp-server/tools/schema-mutation.tools.ts` — 5 tools MCP
  (`add_component`, `add_object_type`, `add_field`, `add_status`, `add_link_type`),
  zod schemas locaux pour `SchemaField`/`SchemaStatus`/`ObjectTypeDefinition`/
  `LinkTypeDefinition` (pas de zod schema exporté pour ces types aujourd'hui, même
  convention que `createCampaignEntrySchema` du sprint 2), wrapper commun
  `runSchemaMutation()` (try/catch `SchemaValidationError` → `errorToolResult`,
  factorisé — trouvé en revue).

Non modifiés (conforme au design §7 et hors périmètre de ce sprint) :
`apps/desktop/src/main/services/requirements.service.ts`,
`tests.service.ts`, `campaigns.service.ts`, `apps/desktop/src/main/container.ts`,
`apps/desktop/src/main/ipc/index.ts` — le serveur MCP garde son propre point
d'entrée et sa propre DI, aucun changement IPC.

## Comportement implémenté

- **5 méthodes `SchemaService`**, chacune : `get(repoPath)` → valide (lève
  `SchemaValidationError` AVANT tout `save()` si un invariant est violé) → construit
  une copie immuable du schéma (aucun tableau existant — `schema.nodes`,
  `node.objectTypes`, `type.fields`, `type.statuses`, `schema.linkTypes` — n'est
  jamais muté en place, pour ne jamais corrompre l'objet encore référencé par le
  cache tant que `save()` n'a pas réussi) → `save(repoPath, schema)` (réécriture
  complète du fichier, atomicité au niveau du fichier).
- **Règles de validation** (exactement la table du design §4.1) :
  - `addNode` : nom de composant non déjà pris par un `SystemNode` existant
    (comparaison exacte — couvre aussi `"root"`, qui est lui-même un `SystemNode`).
  - `addObjectType` : nœud existe et n'est pas `readonly` ; `objectType.name` non
    déjà pris dans ce nœud ; `objectType.prefix` (si fourni) non déjà utilisé par
    AUCUN type d'AUCUN nœud du `schema.yaml` courant (règle 10 CLAUDE.md — scan
    cross-nœud, pas seulement intra-nœud).
  - `addField` / `addStatus` : nœud et type existent, nœud pas `readonly`, nom du
    champ/statut non déjà présent dans le type ciblé.
  - `addLinkType` : nom non déjà pris dans `schema.linkTypes`.
- **5 tools MCP** un-à-un sur ces méthodes. Chaque refus revient comme
  `{ isError: true, content: [{ type: 'text', text: '[CODE] message' }] }` — jamais
  une exception de protocole (cf. design §5) ; les erreurs inattendues (FS, YAML
  corrompu) continuent de remonter telles quelles.
- `add_component` mappe vers `SchemaService.addNode` (nom de tool aligné sur le
  vocabulaire "composant" du spec/UI, nom de méthode aligné sur le type de données
  `SystemNode` — différence assumée, documentée en commentaire).

## Divergences par rapport au design

- **Trouvé et corrigé en code-review, avant tout commit — sérialisation par
  `repoPath`** (`withMutationQueue`, non mentionnée dans le design) : le design
  décrit chaque méthode comme un simple `get → mute → save`, sans discuter de
  concurrence. Or un agent MCP peut enchaîner plusieurs `add_*` sur le même
  `repoPath` sans attendre la réponse précédente (le protocole JSON-RPC stdio
  autorise le pipelining) — sans sérialisation, deux `get()` concurrents liraient
  le même schéma avant que l'un ou l'autre `save()` n'écrive, et le second `save()`
  écraserait silencieusement la mutation du premier (perte de données, aucune
  erreur signalée). C'est exactement la classe de bug que T118 a corrigée pour
  `counters.yaml` (`id-counter.util.ts` : file de promesses par `repoPath`) — même
  remède appliqué ici, au niveau `SchemaService` plutôt qu'un utilitaire partagé
  (le graphe get→mutate→save est spécifique à chaque méthode `add*`, pas de
  signature générique déjà exportée à réutiliser telle quelle). Vérifié
  manuellement que les 5 méthodes passent bien par la queue (lecture du code —
  repro d'une vraie course nécessiterait un client MCP pipelinant explicitement,
  non exercé en test manuel).
- **Trouvé et corrigé en code-review — garde défensive dans `addField`** :
  `ObjectTypeDefinition.fields` est typé non-optionnel (`SchemaField[]`), mais
  `SchemaService.readFromDisk()` caste le YAML brut sans validation runtime — un
  `schema.yaml` édité à la main sans `fields:` sur un type aurait fait planter
  `addField` avec une `TypeError` non catchée (crash du process MCP) au lieu d'une
  `SchemaValidationError` propre. Corrigé : `type.fields ?? []`.
- **Trouvé en code-review, NON corrigé, documenté comme limitation connue —
  `addObjectType.prefix` : scan mono-repo, pas workspace-wide.** Le design dit
  "prefix non déjà utilisé par aucun type d'aucun nœud du projet" et précise
  lui-même la portée exacte : "scan de tous les `nodes[].objectTypes[].prefix`"
  (§4.1) — c'est exactement ce qui est implémenté (`findNodeUsingPrefix` scanne
  `schema.nodes` du `schema.yaml` COURANT). Mais un vrai composant submodule (nœud
  avec `url`, dont le `schema.yaml` vit dans un autre repo du workspace) n'a pas
  ses `objectTypes` inlinés dans le schéma courant (CLAUDE.md : "objectTypes absent
  → le schéma du composant fait foi") — ses prefixes ne sont donc PAS visibles par
  ce scan. C'est cohérent avec le mode mono-repo de tout le serveur MCP de ce
  ticket (sprint 1, design §2.3 : `--workspace` absent = mono-repo, et même présent
  le cache de tree ne contient pas d'agrégation de schémas cross-repo) — pas une
  régression introduite par ce sprint, mais une limite réelle à connaître : sur un
  produit avec de vrais submodules git, `add_object_type` peut accepter un prefix
  qui collisionne avec un composant externe non chargé. Documenté en commentaire
  directement au-dessus de `addObjectType` dans le code. Un futur sprint qui
  voudrait fermer ce trou devrait agréger les schémas des composants du workspace
  (hors périmètre "5 méthodes ciblées" de ce sprint).
- **Trouvé en code-review, NON corrigé, documenté — repli silencieux de
  `readFromDisk()` sur `DEFAULT_SCHEMA` en cas d'échec de lecture/parse, désormais
  exploité par des écritures autonomes.** `SchemaService.readFromDisk()`
  (pré-existante, pas modifiée par ce sprint) avale TOUTE erreur (fichier absent
  ET YAML corrompu/illisible) et retombe sur `DEFAULT_SCHEMA` (juste `root`, aucun
  type). Avant ce sprint, `save()` n'était atteint que via une action UI
  explicite — un humain voyait le formulaire vide/anormal avant de valider. Depuis
  ce sprint, `addNode`/`addObjectType`/etc. enchaînent `get()` → mutation → `save()`
  de façon autonome depuis un agent MCP : si `schema.yaml` est transitoirement
  illisible (erreur d'encodage, YAML corrompu, corruption disque) au moment d'un
  appel `add_*`, l'appel réussit silencieusement sur un schéma quasi vide et
  ÉCRASE le fichier réel, perdant tous les nœuds/types/liens existants sans aucune
  erreur. Risque réel mais **pas corrigé dans ce sprint** : `readFromDisk()` est
  une méthode partagée par TOUS les appelants de `SchemaService` (renderer Electron
  via IPC, tools de lecture des sprints 1/2, ce sprint) — distinguer "fichier
  absent" (légitime, comportement testé et voulu, cf. `T122-tests.md` scénario 9)
  de "fichier présent mais illisible" (devrait probablement lever plutôt que
  masquer) est un changement de comportement cross-cutting qui dépasse le
  périmètre "5 méthodes ciblées sur SchemaService" et risquerait de régresser un
  comportement dont dépend potentiellement l'UI ou les tools de lecture existants.
  Signalé ici comme constat séparé (même traitement que les autres dettes déjà
  actées aux sprints 1/2), pas traité — **recommandé comme durcissement pour un
  ticket dédié** si jugé prioritaire.
- **Trouvé en code-review, NON corrigé (accepté), documenté — duplication
  intentionnelle du try/catch réduite mais pas éliminée à la racine.** Le design ne
  précise pas la structure interne des handlers de tools ; l'implémentation
  initiale répétait le bloc `try { ... } catch (e) { if (e instanceof
  SchemaValidationError) ... }` 5 fois à l'identique — factorisé en
  `runSchemaMutation()` (un wrapper partagé) avant commit, cf. ci-dessus.
- **Aucune autre divergence de périmètre.** Signatures des 5 méthodes identiques à
  celles du design §4.1 ; noms des tools identiques à §4.2 ; codes d'erreur
  identiques à la liste `SchemaValidationErrorCode` du design.

## Vérifications effectuées

- `pnpm --filter @polenta/desktop run typecheck` → 0 erreur (avant et après les
  corrections de revue).
- Revue de code effectuée en inline avec la skill `code-review` (effort *high*, 8
  angles couverts en 3 passes combinées — correctness A/B/C, cleanup
  reuse/simplification/efficiency, altitude+conventions) : 5 points relevés.
  1. **[critique, corrigé]** Absence de sérialisation par `repoPath` sur les 5
     méthodes `add_*` — course silencieuse en cas d'appels `add_*` pipelinés sur le
     même repo (même classe de bug que T118). Corrigé (`withMutationQueue`, cf.
     divergence ci-dessus).
  2. **[mineur, corrigé]** `addField` plantait avec une `TypeError` non catchée si
     `type.fields` était `undefined` au runtime (YAML hand-édité non conforme au
     type TypeScript). Corrigé (`?? []`).
  3. **[mineur, corrigé]** Try/catch `SchemaValidationError → errorToolResult`
     dupliqué à l'identique dans les 5 handlers de `schema-mutation.tools.ts`.
     Corrigé (`runSchemaMutation()`).
  4. **[limitation connue, non corrigé, documenté]** `addObjectType.prefix` : scan
     mono-repo uniquement, cf. divergence ci-dessus.
  5. **[risque résiduel, non corrigé, documenté]** Repli silencieux de
     `readFromDisk()` sur `DEFAULT_SCHEMA`, désormais exploitable en écriture
     autonome, cf. divergence ci-dessus.
  Deux autres pistes soulevées (schémas zod locaux dupliquant les unions
  TypeScript `SchemaFieldType`/`ObjectCategory` ; `findNodeUsingPrefix` distinct du
  check client-side de `StructureTab.tsx`) évaluées et **non retenues** : cohérent
  avec le précédent déjà posé au sprint 2 (schémas zod locaux pour surface MCP
  externe) et avec l'intention explicite du design (`SchemaService` devient la
  future source de vérité partagée, `StructureTab.tsx` n'est pas dans le périmètre
  de ce sprint).
- Vérification manuelle bout-en-bout via un vrai client MCP
  (`@modelcontextprotocol/sdk` `Client`/`StdioClientTransport`, script jetable
  supprimé après usage) contre une **copie jetable** de
  `C:\Dev\polenta-demo\aspirateur-demo` (`C:\Dev\polenta-test-t122-sprint3`,
  supprimée après le test) — 31 assertions, toutes passées :
  - Découverte : les 5 tools de mutation sont bien listés, en plus des tools des
    sprints 1/2.
  - **Scénario 24** : `add_component` avec nom inédit → nœud créé
    (`readonly: false`, `objectTypes: []`), `root` inchangé.
  - **Scénario 25** : `add_object_type` sur ce nœud avec prefix inédit (`EDGE`) →
    type présent avec les champs fournis.
  - **Scénario 26** : `add_field`/`add_status` sur ce type → champ/statut présents,
    pas de doublon.
  - **Scénario 27** : `add_link_type` avec nom inédit → présent dans
    `schema.linkTypes`.
  - **Scénario 28** : `add_component` avec nom déjà pris (`"root"`, puis un nœud
    tout juste créé) → refusé (`isError: true`) dans les deux cas, `schema.yaml`
    strictement identique avant/après (comparaison de contenu brut, pas seulement
    "pas d'exception").
  - **Scénario 29** : `add_object_type` avec `prefix: "SYS"` (déjà pris par
    `root::exigence-systeme`, donc CROSS-NŒUD car ciblant `edge-comp`) → refusé,
    message citant `PREFIX_TAKEN`, fichier inchangé.
  - **Scénario 30** : `add_object_type` sur un `nodeName` inexistant → refusé,
    message citant le nom recherché (`"does-not-exist"`).
  - **Scénario 31** : `add_field`/`add_status` avec un nom déjà présent dans le
    type ciblé → refusés, fichier inchangé.
  - **Scénario 32** : composant `readonly: true` créé via `add_component`, puis
    `add_object_type`/`add_field`/`add_status` visant ce nœud → refusés tous les
    trois avec `NODE_READONLY` (vérifié que le readonly est bien contrôlé AVANT
    l'existence du type — `add_field`/`add_status` visaient un `typeName`
    inexistant sur ce nœud et ont quand même renvoyé `NODE_READONLY`, pas
    `TYPE_NOT_FOUND`), fichier inchangé.
  - **Scénario 33** : `add_link_type` avec nom déjà pris (`"implementation"`) →
    refusé, fichier inchangé.
  - **Scénario 34** : les 8 refus ci-dessus sont tous revenus comme réponse de tool
    structurée (`isError: true`, message lisible) — aucune exception de protocole
    n'a jamais fermé la connexion du client.
  - **`get_schema` relu après toutes les mutations** : la sortie du tool est
    strictement identique (comparaison JSON) au contenu réel de `schema.yaml` sur
    disque — l'ajout est visible immédiatement, pas seulement en cache.
  - `git status` dans le repo de test après toutes les écritures : `schema.yaml`
    apparaît modifié (`M`), jamais commité — aucun tool n'a déclenché de commit.

Scénarios de `specs/T122-tests.md` couverts (section "Sprint 3 — Mutation de
schéma") : 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34 — tous exercés.

## Comment tester manuellement

```bash
# Toujours sur une COPIE jetable d'un repo Polenta réel, jamais l'original
# (dryRun n'existe pas pour ces tools — chaque appel réussi écrit immédiatement) :
pnpm --filter @polenta/desktop run mcp-server -- --repo "C:\chemin\vers\repo-polenta-copie"
```

Avec un client MCP (Claude Code via `.mcp.json`, ou tout client de test stdio),
appeler `get_schema` d'abord pour connaître les nœuds/prefixes existants, puis par
exemple :

```json
// 1. Ajouter un composant local
{ "name": "hmi", "label": "Interface Homme-Machine" }
// → add_component

// 2. Ajouter un type d'objet dans ce composant (prefix inédit dans tout le projet)
{ "nodeName": "hmi", "objectType": {
    "name": "exigence-hmi", "category": "requirement", "prefix": "HMI", "fields": []
} }
// → add_object_type

// 3. Ajouter un champ, un statut
{ "nodeName": "hmi", "typeName": "exigence-hmi",
  "field": { "name": "statement", "type": "richtext", "validator": "EARS", "required": true } }
// → add_field
{ "nodeName": "hmi", "typeName": "exigence-hmi", "status": { "name": "draft", "label": "Brouillon" } }
// → add_status

// 4. Ajouter un type de lien
{ "linkType": { "name": "trace", "labelSourceToTarget": "trace vers",
    "labelTargetToSource": "est tracé par" } }
// → add_link_type
```

Vérifier ensuite `get_schema` : le composant/type/champ/statut/lien créés doivent
apparaître immédiatement. Vérifier `git status` : `.polenta/schema.yaml` apparaît
modifié, jamais commité. Pour les cas de refus : rejouer les mêmes appels
(collision), cibler un `nodeName`/`prefix` déjà pris, ou un nœud créé avec
`"readonly": true` — chaque refus revient en `isError: true` avec un message
explicite, pas une erreur de connexion.

## Ce qui reste (hors périmètre de ce sprint)

- Sprint 4 : `AGENTS.md` mis à jour (mention du serveur MCP), `.mcp.json` généré
  par `WorkspaceService.createNewProject()`, packaging (`electron-builder.yml`,
  résolution du chemin exécutable en build packagé vs dev), `specs/SPEC-MCP-SERVER.md`.
