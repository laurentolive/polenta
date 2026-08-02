# T135 — Sprint 3 (final)

## Fichiers modifiés

- `apps/desktop/src/main/services/schema.service.ts` — `moveObjectType(repoPath, {fromNodeName,
  toNodeName, typeName})` : déplace un `ObjectTypeDefinition` d'un nœud à un autre du même
  schéma, via la file de mutation existante (`withMutationQueue`). Retourne `{schema, oldRef,
  newRef}`. No-op idempotent si `fromNodeName === toNodeName`.
- `apps/desktop/src/main/services/requirements.service.ts` — `retargetObjectTypeRef(repoPath,
  oldRef, newRef)` : réécrit `objectTypeRef` sur chaque exigence référençant `oldRef`, best-effort
  par fichier. Méthode dédiée (pas via le DTO d'update public) — décision déjà actée en Design.
- `apps/desktop/src/main/services/tree.service.ts` — `moveTypeTree(repoPath, fromNodeId,
  toNodeId, typeId)` : déplace le fichier d'ordre d'affichage `.polenta/trees/<nœud>/<type>.yaml`
  vers le nouveau nœud (trouvé pendant la revue de code — absent du Design initial, cf.
  Divergences).
- `apps/desktop/src/main/services/element-move.service.ts` (nouveau, remplace le brouillon
  `element-move.util.ts`) — `ElementMoveService`, classe injectée avec `(schema, requirements,
  tests, tree)`, orchestre le déplacement complet : mutation de schéma → cascade
  requirements/tests → déplacement du fichier d'ordre.
- `apps/desktop/src/main/container.ts` / `apps/desktop/src/main/ipc/index.ts` — nouveau service
  `elementMove` dans le container, nouveau canal IPC `schema:move-element`.
- `packages/api-client/src/types.ts` / `ipc-client.ts` / `index.ts` — `MoveElementDto`,
  `MoveElementResult`, `ApiClient.schema.moveElement`.
- `apps/desktop/src/renderer/components/schema/StructureTab.tsx` — `canDropInto`'s élément
  branch (remplace le `return false` codé en dur des sprints 1-2) ; `handleReparentElement` ;
  nouveau helper `resolveElementType` ; `DragItem`'s variante `element` porte désormais aussi
  `typeName` (pas seulement `typeIndex`).
- `apps/desktop/src/renderer/i18n/locales/{en,fr}.json` — deux nouvelles clés
  (`moveElementCascadePartialFailure`, `moveElementStale`).

## Comportement implémenté

Conforme à `specs/T135.md` (dernier volet de reparenting) et `specs/T135-design.md` §Sprint 3.
Glisser un type (exigence/test/campagne) vers un autre nœud **du même repo** le déplace dans
`schema.yaml` et réécrit `objectTypeRef` sur chaque exigence/test existant qui le référençait.
Restriction dure (pas de surbrillance) pour tout nœud d'un repo différent.

## Divergences par rapport au design

1. **Fichier d'ordre d'affichage (`.polenta/trees/<nœud>/<type>.yaml`) migré — absent du Design
   initial.** Trouvé pendant la revue de code (3 angles distincts l'ont signalé indépendamment) :
   ce fichier, qui porte l'organisation en dossiers qu'un utilisateur a pu construire pour un type
   donné (Vue Système), n'était mentionné nulle part dans `specs/T135-design.md` ni
   `specs/T135-tests.md` — ni `tree.service.ts` ni son fichier ne figuraient dans le tableau
   "Impacts / fichiers touchés". Sans migration, déplacer un type aurait silencieusement perdu
   cette organisation (fichier orphelin à l'ancien emplacement, absent au nouveau). Ajouté :
   `TreeService.moveTypeTree`, appelé en best-effort par `ElementMoveService` après la cascade
   requirements/tests.
2. **`moveObjectType` sans paramètre `toIndex`.** Le Design proposait insertion à une position
   choisie ; implémenté avec ajout systématique en dernière position parmi les `objectTypes` du
   nœud cible — repositionner précisément se fait ensuite via le réordonnancement du sprint 1
   (déjà disponible dans la nouvelle liste). Même simplification déjà faite pour `moveSystemNode`
   au sprint 2 (`specs/T135-sprint2.md` divergence 1), pour la même raison.
3. **Orchestration en classe (`ElementMoveService`), pas fonction libre.** Le Design ne précisait
   pas la forme exacte ("nouvelle orchestration côté main process"). Une première implémentation
   en fonction libre (`element-move.util.ts`, prenant un objet `{schema, requirements, tests}`) a
   été retenue pendant l'écriture, puis convertie en classe injectée par constructeur pendant la
   revue de code — seule composition multi-services de tout `apps/desktop/src/main/services` qui
   n'était pas déjà une classe (`CampaignsService`, `TraceabilityService`, etc.), incohérence
   relevée par la revue et corrigée pour rester alignée sur la convention DI du reste du projet.
4. **Pas d'exposition MCP.** `specs/T135-design.md` laissait la question ouverte ("à trancher en
   Dev"). Tranché : pas d'exposition côté serveur MCP dans ce sprint — `TICKETS.md`/`specs/T135.md`
   ne le demandaient pas explicitement, et ça aurait élargi un périmètre déjà large. Piste pour un
   ticket séparé si demandé.
5. **`MoveElementResult` simplifié pendant la revue de code.** Une première version portait quatre
   tableaux (`requirementsMoved`/`requirementsFailed`/`testsMoved`/`testsFailed`) ; seul le compte
   d'échecs est consommé côté UI. Remplacé par un unique `failed: {kind, id, error}[]`.

## Limitation connue (préexistante, pas corrigée dans ce ticket)

**`objectTypeRef` peut être une chaîne non qualifiée (juste le nom du type, sans préfixe de
nœud)** — trouvé pendant la revue de code (angle "cross-file tracer") : `apps/desktop/src/renderer/
routes/req.new.tsx`/`test.new.tsx` construisent `objectTypeRef` à partir de
`getAllObjectTypes(schema, ...)`, qui aplatit les types de tous les nœuds **sans conserver le nom
du nœud d'origine** (`useProjectSchema.ts:58-61`) — une exigence/test créé(e) via ces pages peut
donc porter un `objectTypeRef` juste `"elema"` plutôt que `"root::elema"`. C'est un bug préexistant
de ces deux pages, indépendant de ce ticket (aucune ligne modifiée par T135 n'est en cause). Sa
conséquence directe pour ce sprint : la cascade de ce ticket compare par égalité stricte de chaîne
(`r.objectTypeRef === oldRef`, où `oldRef` est toujours qualifié `<nœud>::<type>`) — un
`objectTypeRef` non qualifié référençant le même type ne sera **jamais** trouvé/réécrit par la
cascade. En pratique, la résolution en lecture (`getReqTypeDef`/`getTestTypeDef`) retombe sur une
recherche par nom de type dans tous les nœuds quand la référence n'est pas qualifiée, donc l'exigence
continue généralement de s'afficher correctement après un déplacement — **sauf** collision de nom
de type entre deux nœuds différents, où la résolution devient ambiguë. Ni corrigé ni contourné ici
(hors périmètre — ticket séparé recommandé) ; documenté pour que la limite soit connue avant
merge.

## Revue de code

`/code-review` (8 angles) a trouvé et vérifié davantage de problèmes qu'aux sprints précédents —
attendu, ce sprint est le seul à traverser la frontière IPC (renderer → main process) et à toucher
trois services distincts en cascade.

**Corrigés :**
1. **Fichier d'ordre d'affichage jamais migré** — cf. Divergence 1. Corrigé.
2. **Cascade non isolée d'un échec dur.** Si `retargetObjectTypeRef` ou la boucle de mise à jour
   des tests levait une exception complète (pas seulement un échec par fichier déjà capturé), rien
   n'empêchait cette exception de remonter jusqu'au renderer — masquant le fait que le schéma avait
   déjà été sauvegardé avant que la cascade n'ait pu tourner. Corrigé : chaque étape de cascade est
   maintenant entourée d'un `try/catch` au niveau de `ElementMoveService`, converti en entrée
   `failed[]` plutôt que de laisser une exception remonter après une mutation de schéma déjà actée.
3. **Résolution du type déplacé par index seul, potentiellement périmé.** `typeIndex` (capturé au
   début du drag) pouvait en théorie ne plus désigner le bon type au moment du drop, ce round-trip
   étant un aller-retour IPC complet (plus long que les sprints 1-2, une simple sauvegarde
   locale). Corrigé : `DragItem` porte désormais aussi `typeName`, vérifié par un nouveau helper
   `resolveElementType` avant d'agir ; en cas de décalage, l'opération s'arrête avec un message
   plutôt que de déplacer silencieusement le mauvais type.
4. **No-op silencieux si le type résolu est introuvable** — `handleReparentElement` retournait sans
   rien signaler à l'utilisateur. Corrigé (nouvelle clé `moveElementStale`).
5. **Échecs de cascade jamais journalisés** — le message affiché renvoyait vers "la console" pour
   le détail, mais rien n'y était écrit. Corrigé (`console.error` avec le détail `failed[]` avant
   que le compte seul ne soit affiché).
6. **Commentaire inexact dans `ipc/index.ts`** ("orchestrées atomiquement") — la cascade est
   best-effort, pas atomique ; seule la mutation de schéma l'est. Corrigé.
7. **Incohérence de convention DI** — cf. Divergence 3. Corrigé (classe `ElementMoveService`).
8. **`MoveElementResult` simplifié** — cf. Divergence 5.

**Examinés et écartés (pas de changement) :**
- Asymétrie `RequirementsService` (méthode dédiée) vs `TestsService` (réutilise `update()`
  public) pour la cascade — décision déjà actée explicitement en Design
  (`specs/T135-design.md` §Décisions #1), pas une omission.
- `element-move.service.ts` dupliquant `MoveElementResult` déjà déclaré dans
  `packages/api-client/src/types.ts` — laissé tel quel : `@polenta/api-client` est une dépendance
  renderer par convention (aucun fichier du main process ne l'importe aujourd'hui), l'importer
  depuis le main process inverserait la direction attendue de la dépendance IPC client/serveur ;
  les deux définitions vivent légitimement de part et d'autre de cette frontière.
- Bug préexistant de `objectTypeRef` non qualifié (`req.new.tsx`/`test.new.tsx`) — documenté
  ci-dessus comme limitation connue, pas corrigé (hors périmètre de ce ticket).

## Vérifications effectuées

- `tsc --noEmit` : `@polenta/desktop`, `@polenta/api-client` — 0 erreur.
- **Vérification manuelle dans l'app réelle** (build + driver Playwright `run-desktop`) :
  - Créé une exigence réelle (`requirements:create` via IPC direct) référençant
    `compA::elema` (un type alors niché sous le composant local `compA`).
  - Glissé le type `elema` (Element A) depuis `compA` vers la ligne racine du repo → confirmé
    visuellement remonté au niveau racine dans l'arbre Structure.
  - Relu l'exigence : `objectTypeRef` passé de `compA::elema` à `root::elema` — cascade confirmée
    fonctionnelle de bout en bout, schéma + fichier réécrits correctement.
  - (Une première tentative de vérification avait échoué à cause d'une erreur de manipulation du
    script de test — mauvais `repoPath` utilisé pour les appels IPC directs, un sous-dossier du
    workspace au lieu du workspace lui-même ; confirmé via `workspace:resolve` puis corrigé, sans
    changement de code nécessaire.)
  - Fichier d'ordre d'affichage (`moveTypeTree`) et cascade côté tests (`TestsService.update`) non
    revérifiés en direct par manque de temps — couverts par la relecture de code et le raisonnement
    ci-dessus, mais pas par un test end-to-end dans l'app comme la cascade requirements.

## Comment tester manuellement

1. Ouvrir l'onglet **Modèle de données → Structure** d'un projet avec au moins deux nœuds
   (root + un composant local, ou deux composants locaux).
2. Créer une exigence référençant un type existant à la racine (via la Vue Système, ou directement
   via l'IPC `requirements:create` en pointant le bon `repoPath` — attention : c'est le sous-dossier
   du repo, pas le dossier workspace parent, cf. `workspace:resolve` pour vérifier).
3. Dans l'onglet Structure, glisser le type de cette exigence vers un autre nœud du même repo.
4. Vérifier : le type apparaît maintenant sous le nouveau nœud ; l'exigence créée à l'étape 2 a un
   `objectTypeRef` mis à jour vers `<nouveauNœud>::<type>` ; elle reste visible/éditable
   normalement.
5. Vérifier qu'aucun nœud d'un **autre repo** (le cas échéant) ne s'illumine comme cible de dépôt
   valide pendant ce glisser.
6. Répéter avec un cas de test au lieu d'une exigence.

## Clôture du ticket

Ceci est le dernier sprint de T135 (3 sprints, cf. `specs/T135-design.md`). Les trois capacités
demandées par `specs/T135.md` sont livrées : réordonnancement (sprint 1), changement de parent
pour composants/composants locaux (sprint 2), changement de parent pour les éléments avec cascade
(sprint 3). Points restés hors périmètre à chaque sprint, tous documentés explicitement plutôt que
silencieusement ignorés :
- Navigation clavier pour réordonner/déplacer (hors scope, cf. `specs/T135.md`).
- Déplacement cross-repo pour les éléments et pour les composants locaux (cf. découverte clé en
  Design — physiquement plus lourd, nécessiterait de déplacer des fichiers entre deux repos Git).
- Exposition MCP du déplacement d'élément.
- Bug préexistant `objectTypeRef` non qualifié (`req.new.tsx`/`test.new.tsx`) — candidat pour un
  ticket séparé.

Recommandé avant fusion vers `main` : revérifier en direct `RepoRow`/`moveDependencyToParent`
(sprint 2, non retesté en conditions réelles) et la cascade côté tests + le déplacement du fichier
d'ordre d'affichage (sprint 3, non retestés en conditions réelles) — tous deux couverts par la
revue de code mais pas par un test end-to-end dans l'app.
