# T122-tests — Scénarios de validation

Pas d'infrastructure de test unitaire existante sur `main/services/*` (cf. T118 :
"pas d'infra de test unitaire existante sur ces services") — ces scénarios sont à
exécuter manuellement (client MCP réel ou script Node appelant les tools) par
l'Agent Dev de chaque sprint, comme pour les autres tickets de ce projet. Regroupés
par sprint pour rester exécutables au fur et à mesure (pas seulement en fin de
ticket).

---

## Sprint 1 — Serveur + lecture

### Nominal

1. **Démarrage** : `pnpm --filter desktop run mcp-server -- --repo <repo-polenta-existant>`
   démarre sans erreur, n'ouvre aucune fenêtre Electron, reste actif en attente sur
   stdio (le process ne se termine pas immédiatement).
2. **Découverte** : un client MCP (Claude Code avec `.mcp.json` pointant vers ce
   serveur, ou tout client de test stdio) liste les tools et voit au moins
   `get_schema`, `list_requirements`, `list_tests`, `list_campaigns`.
3. **`get_schema`** sur un repo avec un `.polenta/schema.yaml` non trivial (plusieurs
   nœuds, plusieurs types) retourne une structure fidèle au fichier disque (comparer
   avec `yaml.load` du fichier brut).
4. **`list_requirements`** sans filtre retourne toutes les exigences du repo, triées
   par ID (cohérent avec `RequirementsIndexService.findAll`).
5. **`list_requirements`** avec `filters: { status: 'approved' }` ne retourne que les
   exigences `approved`.
6. **`list_requirements`** avec `filters: { search: '<mot présent dans un titre>' }`
   retourne uniquement les exigences correspondantes.
7. **`list_tests`** / **`list_campaigns`** : mêmes vérifications de base
   (liste complète sans filtre, filtre `type`/`status` pour tests, `component`/
   `level` pour campagnes).

### Cas limites

8. **Repo inexistant** : `--repo <chemin qui n'existe pas>` → le process s'arrête
   immédiatement avec un message d'erreur explicite sur **stderr** (pas stdout —
   vérifier que stdout reste vide ou strictement protocolaire, sinon un client MCP
   strict rejette la connexion).
9. **Repo sans `.polenta/schema.yaml`** (dossier git valide mais jamais initialisé
   comme projet Polenta) : le serveur démarre, `get_schema` retourne le schéma par
   défaut (`root` seul, pas d'erreur) — comportement identique à l'UI
   (`SchemaService.readFromDisk` retombe déjà sur `DEFAULT_SCHEMA`).
10. **Liste vide** : `list_campaigns` sur un repo sans aucune campagne retourne un
    tableau vide, pas une erreur.
11. **Volume important** : repo avec > 200 exigences, `list_requirements` sans filtre
    → réponse tronquée avec `truncated: true` et `total` correct (pas un plantage ni
    une réponse silencieusement incomplète sans le signaler).
12. **`--workspace` absent** : le serveur démarre en mode mono-repo ; une
    `objectTypeRef` pointant vers un vrai composant submodule (nœud avec `url`)
    dans `list_requirements` ne fait pas planter le tool (résolution silencieuse
    vers le repo racine, comportement documenté en design comme limitation connue —
    à vérifier que c'est bien silencieux et pas une exception).

---

## Sprint 2 — Import massif

### Nominal (golden path — critère d'acceptation principal du ticket)

13. **`bulk_import_requirements` en `dryRun: true`** sur 3 entrées (2 valides pour un
    type existant avec champs requis renseignés, 1 avec un champ `required: true`
    manquant) → réponse avec 2 entrées dans `wouldCreate` (IDs prévisionnels
    distincts, format `<PREFIX>-XXXX` correct) et 1 dans `errors` (raison citant le
    nom du champ manquant) ; **aucun fichier créé** dans `requirements/` (vérifier
    via `git status`/liste de fichiers avant/après, strictement identique).
14. **Même appel en `dryRun: false`** → crée exactement 2 fichiers `.yaml`/`.md`
    (selon format réel des services) dans `requirements/`, avec les IDs annoncés en
    dry-run (ou des IDs cohérents si l'état a changé entre les deux appels — au
    minimum : distincts et sans collision avec l'existant) ; `errors` contient
    toujours l'entrée invalide, non créée.
15. **IDs distincts sans collision (validation directe T118)** : 10 créations de
    requirements dans un seul appel `bulk_import_requirements(dryRun: false)` →
    10 fichiers distincts, 10 IDs consécutifs sans trou ni doublon, aucun fichier
    existant écrasé (vérifier avant/après sur un repo qui a déjà quelques exigences).
16. Idem 13-15 pour `bulk_import_tests` et `bulk_import_campaigns`.

### Cas limites

17. **Liste vide** : `bulk_import_requirements([], dryRun: true)` et
    `dryRun: false` → `summary: { total: 0, ok: 0, failed: 0 }`, aucune écriture,
    pas d'erreur.
18. **Toutes les entrées invalides** (`dryRun: true`, 3 entrées avec champ requis
    manquant sur les 3) → `wouldCreate: []`, `errors` contient les 3, `summary.ok
    === 0`. Même vérification en `dryRun: false` : aucun fichier créé.
19. **`objectTypeRef` inconnu** (type qui n'existe dans aucun nœud du schéma) →
    entrée en erreur avec message explicite, n'interrompt pas la validation des
    autres entrées du batch.
20. **Champ `validator: EARS` avec texte non conforme** (ex. `statement: "Le système
    doit démarrer vite"`, sans `SHALL`/mot-clé EARS) → entrée en erreur explicite
    citant la non-conformité EARS ; une entrée avec un `statement` conforme
    (`WHEN ... THE ... SHALL ...`) dans le même batch reste valide.
21. **Nœud `readonly: true`** : `objectTypeRef` pointant vers un type appartenant à
    un nœud avec `readonly: true` → entrée refusée en `dryRun: true` **et**
    `dryRun: false`, avec message explicite ("nœud en lecture seule") ; le fichier
    n'est jamais écrit.
22. **Échec best-effort partiel en écriture réelle** : sur un batch de 3 entrées
    valides, si l'une déclenche une erreur d'écriture inattendue (ex. permissions —
    simulable en rendant le dossier `requirements/` temporairement en lecture
    seule pour une seule entrée n'est pas trivial ; à défaut, vérifier au moins que
    le code ne fait pas `Promise.all` — lecture du code suffit si la repro FS est
    impraticable) → les entrées précédentes déjà écrites sur disque ne sont pas
    annulées/rollback.
23. **Ordre d'exécution série, pas parallèle** : sur un batch de 5 entrées valides
    en `dryRun: false`, les IDs attribués sont dans l'ordre du batch (entrée 0 obtient
    l'ID le plus bas, entrée 4 le plus haut) — vérifie l'absence de course même en
    l'absence de vraie concurrence externe.

---

## Sprint 3 — Mutation de schéma

### Nominal

24. **`add_component`** avec un nom inédit → `schema.yaml` contient le nouveau
    `SystemNode` (`readonly: false` par défaut, `objectTypes: []`), les nœuds
    existants sont inchangés (diff du fichier limité à l'ajout).
25. **`add_object_type`** sur le nœud créé en 24, avec un `prefix` inédit dans tout
    le projet → le type apparaît sous `nodes[].objectTypes[]` avec les champs
    fournis.
26. **`add_field`** / **`add_status`** sur le type créé en 25 → le champ/statut
    apparaît dans `fields[]`/`statuses[]` du type, sans dupliquer les champs/statuts
    déjà présents.
27. **`add_link_type`** avec un `name` inédit → apparaît dans `schema.linkTypes`.

### Cas limites

28. **`add_component` avec nom déjà pris** (collision avec un `SystemNode`
    existant, y compris `root`) → refusé, message explicite, `schema.yaml`
    strictement inchangé (comparer le contenu du fichier avant/après, pas seulement
    "pas d'exception").
29. **`add_object_type` avec `prefix` déjà pris ailleurs dans le projet** (autre
    nœud, autre type — pas seulement le même nœud) → refusé, `schema.yaml`
    inchangé. Vérifier spécifiquement le cas cross-nœud (prefix pris par un type
    d'un *autre* composant), pas seulement l'intra-nœud.
30. **`add_object_type` sur un `nodeName` inexistant** → refusé, message explicite
    citant le nom recherché.
31. **`add_field`/`add_status` avec un nom déjà présent dans le type ciblé** →
    refusé (pas de doublon silencieux dans `fields[]`/`statuses[]`).
32. **Écriture ciblant un nœud `readonly: true`** : `add_object_type`, `add_field`,
    `add_status` visant un nœud existant marqué `readonly: true` → refusés tous les
    trois, `schema.yaml` inchangé. (`add_component` n'est pas concerné — il crée
    toujours un nouveau nœud, jamais `readonly` par défaut.)
33. **`add_link_type` avec `name` déjà pris** → refusé, `schema.yaml` inchangé.
34. **Erreurs structurées, pas d'exception protocole** : chaque refus ci-dessus
    (28-33) revient comme réponse de tool `isError: true` avec un message lisible —
    pas une erreur de transport MCP qui casserait la session du client.

---

## Sprint 4 — `AGENTS.md` / `.mcp.json` / packaging

### Nominal

35. **Nouveau projet** (`workspace:create-new` / `createNewProject`) → `AGENTS.md`
    généré mentionne explicitement le serveur MCP (nom des tools ou renvoi clair) ;
    `.mcp.json` est présent à la racine, JSON valide, avec une entrée `mcpServers`
    pointant vers une commande qui, exécutée telle quelle depuis ce répertoire,
    démarre effectivement un serveur MCP fonctionnel sur ce repo (test bout-en-bout :
    exécuter la commande générée, vérifier qu'un client peut s'y connecter).
36. **Git status propre après génération** : `AGENTS.md`, `.mcp.json` et les autres
    fichiers d'init sont committés par le commit initial `init: create project`
    existant (comme `AGENTS.md`/`.gitignore` aujourd'hui) — pas laissés non suivis.

### Cas limites

37. **Mode packagé vs dev** : la commande générée dans `.mcp.json` diffère (ou pas,
    selon la résolution retenue en sprint 4) entre un lancement depuis le monorepo
    source (`pnpm dev`) et une app packagée (`electron-builder`) — au minimum,
    documenter/vérifier qu'aucune des deux ne produit un chemin cassé (fichier
    inexistant) dans son contexte respectif.

---

## Critères d'acceptation globaux (recopiés/affinés depuis `T122.md`, à cocher en fin de ticket)

- [ ] `pnpm --filter desktop run mcp-server -- --repo <path>` démarre un serveur
      MCP stdio fonctionnel, sans lancer Electron (scénario 1).
- [ ] Un client MCP découvre tous les tools (lecture, import bulk, mutation schéma)
      (scénario 2, + équivalents sprint 2/3 une fois ces tools livrés).
- [ ] `bulk_import_requirements(dryRun: true)` sur 3 entrées (2 valides, 1 invalide)
      → aperçu correct, aucune écriture (scénario 13).
- [ ] Le même appel en `dryRun: false` crée 2 fichiers avec IDs distincts et
      corrects — validation directe que T118 est intégré (scénarios 14-15).
- [ ] `add_component` avec nom déjà pris → refusé, `schema.yaml` inchangé
      (scénario 28).
- [ ] `add_object_type` avec `prefix` déjà pris ailleurs dans le projet → refusé
      (scénario 29).
- [ ] Un tool d'écriture ciblant un nœud `readonly: true` est refusé (scénarios 21,
      32).
- [ ] Aucun tool ne déclenche de commit git — `git status` après un import massif
      réussi montre les fichiers créés comme non committés (à vérifier
      explicitement dans les scénarios 14/15/16 — ajouter la vérification `git
      status` après écriture, pas seulement l'existence des fichiers).
- [ ] `AGENTS.md` mentionne le serveur MCP ; `.mcp.json` généré démarre
      effectivement le serveur (scénario 35).
- [ ] TypeScript/lint : zéro nouvelle erreur (`pnpm typecheck` à chaque sprint, pas
      seulement en fin de ticket).
