# T123 — Sprint 1 (fondation : modèle de données + résolution récursive)

## Fichiers modifiés

- `packages/types/src/schema-tree.ts` (nouveau) — module partagé (main + renderer, aucune
  dépendance Node.js) avec les traversées récursives de l'arbre `SystemNode` : `findSystemNode`
  (recherche par nom, n'importe quelle profondeur), `flattenSystemNodes` (aplatissement pré-ordre
  avec chaîne d'ancêtres, pour le futur libellé `›` du combobox Composant), `mapSystemNode`
  (remplacement immuable d'un nœud par son nom). `removeSystemNode`/le compteur de sous-arbre pour
  la confirmation de suppression en cascade sont **repoussés au Sprint 2**, qui les consomme
  réellement (pas d'export inutilisé dans ce sprint).
- `packages/types/src/schema.ts` — `SystemNode` gagne `children?: SystemNode[]`, `roles?`,
  `implements?` (déplacés depuis `ProjectSchema`, toujours acceptés au niveau racine du fichier
  en parallèle pendant la transition, cf. ci-dessous). `ProjectSchema.roles`/`.implements` marqués
  `@deprecated`.
- `packages/types/src/index.ts` — export de `schema-tree.ts`.
- `apps/desktop/src/main/services/schema.service.ts` :
  - `addNode` accepte un `parentName` optionnel — imbrique le nouveau composant dans `children[]`
    du parent désigné (`NODE_NOT_FOUND` si absent), sinon comportement T113 inchangé (racine).
  - Unicité du nom (`addNode`), `requireNode`, `findNodeUsingPrefix`, `replaceObjectType`
    (utilisée par `addObjectType`/`addField`/`addStatus`) : recherche/remplacement récursifs via
    `findSystemNode`/`mapSystemNode`/`flattenSystemNodes` au lieu d'un scan/`.map()` de premier
    niveau — un composant local imbriqué à profondeur ≥ 2 est désormais correctement trouvé et
    modifié par ces méthodes (avant ce sprint, il aurait été introuvable puisque `children`
    n'existait pas).
  - `migrateRootRolesImplements` (nouveau, appelée par `readFromDisk`) — recopie `roles`/
    `implements` du niveau racine du fichier vers le node `root` **sans les retirer du niveau
    racine** (cf. divergence ci-dessous).
- `apps/desktop/src/main/services/schema-lookup.util.ts` — `findObjectTypeDef` résout
  récursivement (`findSystemNode`/`flattenSystemNodes`) au lieu d'un `.find()`/boucle plate.
  Effet en cascade sans modification : `nextId()`/`nextTestId()`
  (`requirements.service.ts`/`tests.service.ts`) et `resolveIdPrefix()`
  (`bulk-import-validation.util.ts`) délèguent déjà tous à cette fonction (T113) — ils héritent de
  la résolution récursive sans changement de code.
- `apps/desktop/src/main/services/bulk-import-validation.util.ts` — `findOwningNode`/
  `findLocalNodeByRefPrefix` : même traitement récursif.
- `apps/desktop/src/mcp-server/tools/schema-mutation.tools.ts` — `add_component` gagne
  `parentName: z.string().optional()` ; description du tool mise à jour.

## Comportement implémenté

Conforme à `specs/T123-design.md` §2-4-5 (fondation), avec une divergence assumée sur la
migration `roles`/`implements` (§4.1 du design).

## Divergence par rapport au design

**§4.1 (migration `roles`/`implements`) rendue additive plutôt que destructive**, trouvée en
auto-relecture après une première implémentation qui suivait le design à la lettre (retirer
`roles`/`implements` du niveau racine du fichier dès la lecture, cf. commentaire initial de
`migrateRootRolesImplements`) :

`workspace-tree.service.ts::readSchema` et `interface-compliance.service.ts::readSchema` lisent
`schema.yaml` **indépendamment de `SchemaService`** (leur propre `fsP.readFile`/`yaml.load`, pas
d'appel à `SchemaService.get()`) — de même, la popup d'édition de rôles côté renderer
(`AddDependencyModal.tsx`/`StructureTab.tsx`, section "Rôles exposés par ce repo") lit
`childSchema?.roles` au niveau racine via l'IPC qui renvoie le `ProjectSchema` tel que
`SchemaService` le produit. Avec une migration destructive (celle du design initial), le
**premier** `save()` qui suit une lecture migrée sur un repo déjà marqué interface (n'importe
quelle mutation, pas seulement une liée aux rôles — renommer un composant, ajouter un type…)
aurait vidé `roles`/`implements` du niveau racine du fichier, cassant silencieusement le badge
"Interface" et la matrice de conformité de ce repo **avant** que le Sprint 3/4 ne migre ces
lecteurs vers `nodes[root]` — une régression réelle sur une fonctionnalité existante, à l'exact
opposé de la règle que `specs/T123-design.md` §10 se fixe à lui-même ("pas de sprint qui […]
régresse un comportement existant en fin de sprint").

**Correctif** : `migrateRootRolesImplements` ne fait plus que recopier `roles`/`implements` sur
le node `root` **en plus** de les laisser au niveau racine du fichier — `ProjectSchema.roles`/
`.implements` restent donc écrits par `save()` pendant toute la transition (Sprint 1-3),
uniquement retirés du niveau racine quand le Sprint qui migre `workspace-tree.service.ts`/
`interface-compliance.service.ts`/la popup renderer vers `nodes[root]` sera terminé (Sprint 3/4,
cf. `specs/T123-design.md` §7-8, déjà prévu à ce sprint-là). `schema.ts` (commentaires
`@deprecated`) mis à jour pour refléter ce comportement transitoire réel plutôt que celui
initialement documenté en Design.

## Vérification effectuée

- `pnpm typecheck` sur `@polenta/desktop`, `@polenta/web`, `@polenta/api-client` : 0 erreur.
  `@polenta/api` échoue (`SystemNode.url` inexistant) — vérifié **pré-existant** (même erreur en
  stashant ce diff sur `T123` avant tout changement) : `apps/api` est un module dormant déjà
  cassé indépendamment de ce ticket, pas une régression introduite ici.
- `pnpm lint` : ESLint indisponible dans cet environnement (`'eslint' n'est pas reconnu…`),
  pré-existant/environnemental, pas lié à ce diff.
- Script de fumée autonome (recréant `findSystemNode`/`flattenSystemNodes`/`mapSystemNode` en JS
  simple, sans dépendre du build du monorepo) : imbrication sur 3 niveaux (`root → boitier →
  capteurs → temperature`), recherche par nom à profondeur 3, chaîne d'ancêtres correcte,
  rejet d'un nom dupliqué sous un parent différent, rejet d'un `parentName` introuvable,
  remplacement immuable d'un nœud profondément imbriqué (l'arbre d'origine n'est pas muté) — tous
  les cas passent. A révélé un commentaire imprécis dans `schema-tree.ts` (`FlatSystemNode`
  documentait à tort que `root` était exclu de la chaîne d'ancêtres — corrigé : `root` y figure
  bien comme n'importe quel ancêtre, l'exclusion visuelle revient à la couche UI du Sprint 3).
- Pas de test via le serveur MCP réel (`add_component` avec `parentName`) dans ce sprint — le
  script de fumée couvre la même logique (celle réellement exposée par le tool), lancer l'app
  complète est réservé à la vérification manuelle de bout en bout prévue en fin de Sprint 2 (une
  fois qu'il y a une UI pour observer le résultat).

## Comment tester manuellement

1. `pnpm --filter @polenta/desktop typecheck` (ou `pnpm typecheck` en ignorant l'échec préexistant
   de `@polenta/api`) → 0 erreur nouvelle.
2. Lancer le serveur MCP (`pnpm --filter @polenta/desktop dev` puis un client MCP, ou via l'agent
   IA configuré) sur un projet de test, appeler `add_component` avec `parentName` pointant vers un
   composant local existant → vérifier dans `.polenta/schema.yaml` que le nouveau nœud apparaît
   bien sous `children:` du parent désigné, pas au niveau racine de `nodes:`.
3. Répéter l'appel avec un `parentName` inexistant → vérifier une erreur explicite (pas de
   création silencieuse ailleurs).
4. Sur un projet dont le `schema.yaml` a encore `roles:`/`implements:` au niveau racine (format
   pré-T123), ouvrir le projet puis déclencher n'importe quelle sauvegarde de schéma (ex.
   renommer `root`) → vérifier que le fichier réécrit conserve toujours `roles:`/`implements:` au
   niveau racine **et** les a également copiés sous le node `root` — pas de régression visuelle du
   badge "Interface" dans l'app.

## Statut

TypeScript : 0 erreur nouvelle (vérifié sur desktop/web/api-client ; `@polenta/api` pré-cassé,
non lié). Revue de code faite en auto-relecture ciblée (la revue multi-agents outillée a échoué en
cours de route sur une limite de session côté API — reprise en relecture directe) : un problème
réel trouvé et corrigé (migration destructive → additive, cf. Divergence ci-dessus), deux exports
prématurés retirés (`removeSystemNode`/compteur de sous-arbre, reportés au Sprint 2 qui les
consomme). Rien n'est encore commité au moment de la rédaction de ce fichier — commit à suivre.
