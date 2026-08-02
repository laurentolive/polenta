# T123 — Sprint 3 (interfaces sur SystemNode + UI d'édition)

## Fichiers modifiés

- `apps/desktop/src/main/services/schema.service.ts` — `save()` gagne
  `mirrorRootRolesImplements` : à chaque sauvegarde, `nodes[root].roles`/`.implements` sont
  recopiés sur `ProjectSchema.roles`/`.implements` (niveau racine du fichier, déprécié). Root
  devient la source de vérité ; le niveau racine du fichier n'est plus qu'un miroir tenu à jour
  automatiquement, pour les lecteurs qui lisent encore le fichier directement sans passer par
  `SchemaService` (cf. Sprint 1). Commentaire de `migrateRootRolesImplements` (lecture) mis à jour
  pour refléter ce nouveau rôle complémentaire.
- `apps/desktop/src/main/services/workspace-tree.service.ts` — `getInterfaceFlag`/`getImplements`
  lisent désormais `schema.roles`/`.implements` (fichier, legacy) **ou**, en repli,
  `nodes[root].roles`/`.implements` — couvre le cas d'un repo édité depuis ce ticket avant que
  `mirrorRootRolesImplements` n'ait tourné au moins une fois sur ce fichier précis.
- `apps/desktop/src/renderer/components/schema/RolesImplementsFields.tsx` (nouveau) — extrait de
  `AddDependencyModal.tsx` (T110) en deux composants indépendants réutilisables :
  `RolesExposedFields` (catalogue de rôles exposés) et `ImplementedInterfacesFields` (interfaces
  implémentées). Volontairement sans la section "Rôles joués par le parent" d'AddDependencyModal
  — spécifique à la relation de montage d'un repo séparé, sans équivalent pour un composant local
  (cf. specs/T123-design.md §Alternatives rejetées).
- `apps/desktop/src/renderer/components/schema/AddDependencyModal.tsx` — réutilise
  `RolesExposedFields`/`ImplementedInterfacesFields` au lieu de dupliquer leur JSX ; comportement
  inchangé pour l'édition d'une dépendance en repo séparé.
- `apps/desktop/src/renderer/components/schema/StructureTab.tsx` :
  - `NodeEditTarget` gagne `roles`/`implementsList` ; `NodeEditModal` (utilisé à la fois pour le
    self-edit de `root` et l'édition d'un composant local, imbriqué ou non) affiche désormais
    `RolesExposedFields`/`ImplementedInterfacesFields` en plus de label/description — un composant
    a les mêmes capacités d'interface qu'un composant en repo séparé, cf. specs/T123.md.
  - `handleSaveNodeLabel` écrit `roles`/`implements` sur le `SystemNode` ciblé (`mapSystemNode`) ;
    `refetchTree()` ajouté après la sauvegarde pour rafraîchir le badge "Interface" d'une ligne de
    repo (dérivé de `WorkspaceTreeNode.isInterface`, un cache distinct du cache de schéma).
  - `handleSubmitEditDependency` : le catalogue de rôles/implements d'une dépendance en repo
    séparé s'écrit désormais sur le node `root` de son schema.yaml (`nodes[childNodeIndex]`) au
    lieu du niveau racine du fichier — `refetchTree()` déplacé après le `setQueryData` existant
    (sinon celui-ci, construit avec des données antérieures à l'écriture, aurait écrasé le
    rafraîchissement).
  - `handleOpenEditDependency` : lecture de `catalogRoles`/`implementsList`/`parentRoles` avec
    repli sur le node root (`childRootNode?.roles`/`.implements`, `parentRootNode?.implements`) en
    plus du niveau fichier (legacy).
- `apps/desktop/src/renderer/lib/workspaceActions.ts` — `updateInterfaceRoles` (rôles joués par un
  parent pour une interface qu'il monte) lit `schema.implements` ou, en repli, `nodes[root]
  .implements`, et écrit désormais sur le node `root` plutôt que sur le niveau racine du fichier —
  cohérent avec `mirrorRootRolesImplements`, qui sinon écraserait cette écriture au prochain
  `save()` (root reste la source de vérité).
- `apps/desktop/src/renderer/contexts/SystemViewContext.tsx` — `componentOptions` aplatit l'arbre
  (`flattenSystemNodes`) et libelle une entrée imbriquée en chemin `Parent › Enfant` (ancêtre
  `root` filtré du chemin, cf. specs/T123-design.md §9). Les trois lookups de nœud par nom
  (`effectiveNode`, restauration de dernière sélection, `handleComponentChange`) utilisent
  `findSystemNode` (récursif) au lieu de `.find()` de premier niveau.
- `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` — `rolesExposedLabel` généralisé ("ce
  composant" au lieu de "ce repo"), pour rester exact dans les deux contextes de réutilisation.

## Comportement implémenté

Conforme à `specs/T123-design.md` §7-10 (Sprint 3). N'importe quel composant — `root`, local, ou
imbriqué à n'importe quelle profondeur — peut désormais exposer des rôles et/ou implémenter des
interfaces depuis la même popup d'édition, avec le badge "Interface" qui suit.

## Divergence par rapport au design

Aucune divergence de comportement — un ajustement d'ordre d'opérations trouvé en relecture avant
commit (pas en test manuel cette fois) : `handleSubmitEditDependency` appelait `refetchTree()`
immédiatement après avoir sauvegardé le node root, mais juste **avant** le
`qc.setQueryData(['workspace-open', workspaceDir], result)` déjà existant plus bas dans la
fonction — `result` provient d'un appel `addDependency()` antérieur à l'écriture roles/implements,
donc ce `setQueryData` aurait écrasé le refetch avec des données obsolètes. Corrigé en déplaçant
`refetchTree()` après ce `setQueryData`.

## Vérification effectuée

- `pnpm --filter @polenta/desktop typecheck` : 0 erreur, à plusieurs reprises au fil du sprint.
- **Test manuel dans l'app réelle** (build + pilotage automatisé), sur un projet de test dédié
  (`T123Sprint3`, nettoyé après coup) :
  - Créé un composant local `moteur` (T113) → ouvert sa popup d'édition → confirmé la présence des
    sections "Rôles exposés"/"Interfaces implémentées" (absentes avant ce sprint).
  - Ajouté un rôle `device` à `moteur`, enregistré → `schema.yaml` inspecté sur disque : `roles`
    écrit sur le node `moteur` lui-même, absent du niveau racine du fichier (comportement attendu,
    `root` n'a pas de rôles ici) → badge "Interface" affiché sur la ligne de `moteur` dans l'arbre
    Structure après le refetch.
  - Ouvert la popup de self-edit de `root` (pencil sur la ligne de repo) → confirmé qu'elle
    affiche exactement les mêmes sections "Rôles exposés"/"Interfaces implémentées" que la popup
    d'un composant local — unification confirmée de bout en bout, pas seulement au niveau du code.

## Comment tester manuellement

1. `pnpm --filter @polenta/desktop build && pnpm --filter @polenta/desktop dev`.
2. Créer ou ouvrir un projet, créer un composant local (T113).
3. Cliquer son crayon d'édition → vérifier les sections "Rôles exposés"/"Interfaces implémentées".
4. Ajouter un rôle → Enregistrer → vérifier le badge "Interface" sur sa ligne, et dans
   `schema.yaml` que `roles` est écrit sur ce node précis (pas au niveau racine du fichier).
5. Répéter sur un composant imbriqué (profondeur ≥ 2, T123 sprint 2) → même résultat.
6. Cliquer le crayon de self-edit d'un repo (racine du workspace, sans parent) → vérifier que la
   même popup, avec les mêmes sections, s'affiche.
7. Sur un repo mounté comme dépendance d'un autre (T110), éditer ses rôles/implémentations depuis
   la popup existante (crayon fusionné sur la ligne de dépendance) → vérifier que `schema.yaml` du
   repo enfant écrit désormais `roles`/`implements` sur son node `root`, plus au niveau racine du
   fichier — et que le badge "Interface"/la case à cocher "Rôles joués par le parent" continuent
   de fonctionner sans régression.
8. Dans la Vue Système, vérifier que le combobox "Composant" affiche `Parent › Enfant` pour un
   composant local imbriqué.

## Statut

TypeScript : 0 erreur. Testé manuellement dans l'app réelle (build + pilotage automatisé) :
édition de roles/implements sur un composant local, badge "Interface" qui suit, et unification
confirmée entre la popup de self-edit de `root` et celle d'un composant local. Point non re-testé
manuellement dans cette session (déjà validé par construction/relecture) : l'édition d'une
dépendance en repo séparé existante (scénario 7 ci-dessus) et le libellé en chemin `›` du combobox
Vue Système (scénario 8) — à couvrir en Sprint 4 (non-régression finale) si pas fait d'ici là.
