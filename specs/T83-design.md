# T83 — Design technique

## Fichiers à modifier / créer

### Sprint 1 — nouveau flux (bouton, popup, Publier, Annuler, config branche d'intégration)

| Fichier | Action |
|---|---|
| `apps/desktop/src/main/services/sync.service.ts` | Ajout `discardAll(repoPath: string): Promise<void>` — même pattern que `unstageAll` (`statusMatrix` complet) combiné à la logique de restauration par fichier déjà dans `discard()` (restaure depuis HEAD ou supprime si fichier nouveau). Nécessaire pour "Annuler" : aujourd'hui `discard()` n'existe qu'au fichier unique. |
| `apps/desktop/src/main/services/git.service.ts` | Ajout `setIntegrationBranch(repoPath: string, branch: string): Promise<void>` — lit `config/project.yaml` existant (`readYaml`, peut être `null`), fusionne `{ ...existing, integrationBranch: branch }`, `writeYaml`. Ne doit **pas** écraser les autres clés du fichier (`schemaVersion`, etc.). |
| `apps/desktop/src/main/ipc/index.ts` | Nouveaux handlers : `sync:discard-all` (→ `c.sync.discardAll`) à côté de `sync:discard` (L158) ; `baseline:set-integration-branch` (→ `c.git.setIntegrationBranch`) juste après `baseline:get-integration-branch` (L341) |
| `packages/api-client/src/types.ts` | `ApiClient.sync` : ajout `discardAll(repoPath: string): Promise<void>`. `ApiClient.baseline` : ajout `setIntegrationBranch(repoPath: string, branch: string): Promise<void>` |
| `packages/api-client/src/ipc-client.ts` | Wiring des deux méthodes ci-dessus, même pattern que leurs voisines existantes |
| `apps/desktop/src/renderer/hooks/useModificationMode.ts` **(nouveau)** | Hook autonome (n'utilise **pas** `useSystemView()` — cf. décision technique 1) qui résout `repoPath` (root par défaut via `useVersioning()`, override si `?repo=` présent dans l'URL — même résolution que `SystemViewContext.tsx:187-216`, dupliquée en ~15 lignes plutôt que dépendre d'un provider optionnel), interroge `sync:status` + `baseline:get-integration-branch` pour ce `repoPath`, et calcule `mode: 'view' \| 'edit' \| 'other'` |
| `apps/desktop/src/renderer/components/layout/ModificationControl.tsx` **(nouveau)** | Le bouton persistant + indicateur de mode + popup "Faire une modification" + paire "Publier"/"Annuler" + dialog de confirmation Annuler. Consomme `useModificationMode()`. |
| `apps/desktop/src/renderer/components/layout/AppLayout.tsx` | Monte `<ModificationControl />` dans l'arbre `inner` (L129-142), en frère de `<main>` — visible quel que soit le panneau actif, cohérent avec le constat que `SyncBar` (montée uniquement sur `/project/$id`) n'est pas un bon précédent ici |
| `apps/desktop/src/renderer/routes/project.$id.tsx` | `IntBranchSelector` (L14-110) : le `<select>` existant gagne une action "Définir comme branche d'intégration" (bouton/icône à côté de la valeur sélectionnée) qui appelle `api.baseline.setIntegrationBranch(repoPath, currentIntBranch)` ; affiche laquelle est actuellement configurée (requête `api.baseline.getIntegrationBranch`, déjà exposée) à côté du `<select>` |

### Sprint 2 — suppression du flux Action orphelin

| Fichier | Action |
|---|---|
| `apps/desktop/src/main/services/action.service.ts` | Suppression complète du fichier |
| `apps/desktop/src/renderer/routes/action.new.tsx`, `action.$actionId.tsx` | Suppression complète |
| `apps/desktop/src/renderer/routeTree.gen.ts` | Régénéré automatiquement (script codegen TanStack Router du monorepo) après suppression des routes — ne pas éditer à la main |
| `apps/desktop/src/main/ipc/index.ts` | Suppression handlers `actions:*` (create/get-current/get/list/submit-for-review/merge/abandon/update) ; suppression `reviews:get-by-action` (plus aucun appelant une fois `action.$actionId.tsx` supprimé) ; suppression `import type { ActionService }`, `action: ActionService` de l'interface `Container`, `CreateActionDto` de l'import `@polenta/types` |
| `apps/desktop/src/main/container.ts` | Suppression `import { ActionService }`, `const action = new ActionService(...)`, `git.setActionService(action)` (+ commentaire associé), `action,` du littéral passé à `registerIpcHandlers` |
| `apps/desktop/src/main/services/git.service.ts` | Suppression `actionService` (champ privé), `setActionService()`, `import type { ActionService }`, et le bloc de tracking automatique dans `writeYaml()` (L39-43 — match regex `requirements\|tests` + appel `trackAffectedItem`) |
| `apps/desktop/src/main/services/reviews.service.ts` | Suppression `findByAction()` (L71) et `hasApprovedReviewForAction()` (L129-132) — zéro appelant restant une fois `actions:*`/`reviews:get-by-action` supprimés. Le reste de `ReviewsService` (review générique, non liée à Action) n'est **pas** touché — cf. décision technique 5 |
| `packages/api-client/src/types.ts` | Suppression bloc `actions: {...}` complet ; suppression `getByAction` de `ApiClient.reviews` ; suppression `Action`/`CreateActionDto` de l'import `@polenta/types` |
| `packages/api-client/src/ipc-client.ts` | Suppression bloc `actions: {...}` ; suppression `getByAction` de `reviews: {...}` |
| `packages/types/src/action.ts` | Suppression complète du fichier |
| `packages/types/src/index.ts` | Suppression `export * from './action'` |
| `apps/desktop/src/renderer/components/layout/AppLayout.tsx` | `deducePanel()` : suppression de la branche `pathname.startsWith('/action/')` (L30-38 actuel, devient mort) |
| `specs/SPEC-FORKS-BRANCHES-BASELINES.md` §2 | Correction ciblée : remplacer les mentions `BranchService`/`MergeService`/branches `feat-`/`fix-`/`variant-`/`jira/PROJ-NNN-` (jamais implémentées) par le modèle réellement livré — `SyncService` + IPC `sync:*`, convention `int-`/`dev-` (T81), workflow "faire une modification"/"Publier" (T83) |
| `specs/SPEC-TECH-stack.md` §4.3, §6 | Retirer les mentions `ActionService.create()`/`submitForReview()`/`ActionService.merge()` du mapping git/cycle de vie ; documenter le flux réel (`sync.createBranch`/`stageAll`/`commit`/`mergeInto`) |

## Nouveaux types / interfaces

```ts
// apps/desktop/src/renderer/hooks/useModificationMode.ts
export type ModificationMode = 'view' | 'edit' | 'other'

export interface ModificationModeState {
  repoPath: string
  branch: string                // branche courante du repo concerné
  integrationBranch: string     // branche d'intégration configurée du repo concerné
  mode: ModificationMode
  isLoading: boolean
  refetch: () => void
}
```

`ApiClient.sync` gagne :
```ts
discardAll(repoPath: string): Promise<void>
```

`ApiClient.baseline` gagne :
```ts
setIntegrationBranch(repoPath: string, branch: string): Promise<void>
```

Aucun nouveau type partagé dans `packages/types` — `MergeResult`, `SyncStatus`, `BranchInfo` existants
suffisent. Le titre de la modification (pour le message de commit) est un état local React dans
`ModificationControl.tsx`, pas un type partagé.

## Décisions techniques

1. **`useModificationMode` ne consomme pas `useSystemView()`.** `SystemViewProvider` n'est monté que
   pour `routePanel === 'system'` (`AppLayout.tsx:149-157`), alors que `ModificationControl` doit
   être visible sur tous les panneaux (Projet, Version, Suivi…). `useSystemView()` lève une erreur
   hors provider (`SystemViewContext.tsx:160`, contexte initialisé à `null`). *Alternative
   rejetée* : rendre `useSystemView()` tolérant à l'absence de provider (retour `null` au lieu de
   throw) — rejetée, ça changerait le contrat de tous ses appelants existants pour un seul nouveau
   consommateur. À la place, `useModificationMode` duplique la petite résolution `repoPath`
   (`?repo=` de l'URL → nœud de `useWorkspaceStructure`, sinon root via `useVersioning()`) déjà
   présente dans `SystemViewContext.tsx:187-216` — dupliquer ~15 lignes de résolution d'URL est
   moins risqué que coupler un composant de chrome global à un provider conditionnel.

2. **`sync:status` réutilisé tel quel pour la branche courante — pas de nouveau endpoint "current
   branch only".** `useModificationMode` interroge `['sync:status', repoPath]`, déjà en cache
   partagé avec `VersioningContext` (root) et `VersionRepoFolder`/`SystemViewContext` (non-root) —
   react-query dédup automatiquement, pas de requête réseau/IPC supplémentaire dans le cas courant
   où le panneau Version ou la vue Système est déjà ouverte.

3. **Garde d'activation du bouton "Publier" : `staged.length + unstaged.length > 0` uniquement**,
   pas de comparaison avec l'historique de la branche d'intégration (pas de `mergeBase`/comptage de
   commits d'avance). *Limite acceptée* : si l'utilisateur committe manuellement depuis le panneau
   Version pendant une édition T83 (branche `dev-*` propre après un commit manuel), "Publier"
   redevient temporairement inactif jusqu'à la prochaine modification de fichier — cas rare
   (mélange volontaire du flux simplifié et du panneau Version avancé sur la même branche), non
   traité pour rester dans le périmètre du ticket ; l'utilisateur peut toujours merger/checkout
   manuellement depuis le panneau Version dans ce cas. *Alternative rejetée* : exposer
   `GitService.mergeBase` (déjà existant, usage interne uniquement — cf. `traceability.service.ts`)
   via un nouvel endpoint pour calculer "commits d'avance sur la branche d'intégration" —
   complexité disproportionnée pour un cas limite rare, non demandé par les critères d'acceptation
   du spec (qui ne parlent que de "modifications en attente").

4. **Séquence "Publier" : `stageAll` → `commit` → `mergeInto` → (succès) `checkoutBranch` vers la
   branche d'intégration → `deleteBranch` de la branche `dev-*`.** Le `checkout` de la branche
   d'intégration se fait **après** le merge, pas avant : `mergeInto(repoPath, dev, int)` opère par
   référence (`ours: intoBranch`, cf. `sync.service.ts:505-524`) sans nécessiter que `intoBranch`
   soit la branche courante — l'utilisateur reste sur `dev-*` pendant l'appel. Si `mergeInto`
   échoue (conflit), aucun `checkout`/`deleteBranch` n'est exécuté : l'utilisateur reste sur
   `dev-*`, rien n'est perdu, cohérent avec le critère d'acceptation 7 du spec.

5. **Suppression `ActionService`/`reviews:get-by-action` uniquement — le reste de `ReviewsService`
   (review générique) n'est pas touché**, même si un grep confirme qu'aucune route vivante ne
   l'atteint non plus aujourd'hui (`api.reviews.*` n'est appelé que depuis `action.$actionId.tsx`,
   qui disparaît). Rendre tout `ReviewsService`/`reviews:*` mort serait vrai après ce ticket, mais
   décider de le supprimer est une question distincte que l'utilisateur n'a pas tranchée pour T83
   (portée décidée : suppression du flux Action, pas nettoyage exhaustif de Review) — laissé en
   l'état, candidat pour un futur ticket si confirmé inutile.

6. **`SyncService.discardAll` : nouvelle méthode plutôt que boucler côté renderer sur
   `sync.discard(repoPath, file)` par fichier.** Le renderer connaît déjà la liste des fichiers
   modifiés (`sync:status`), mais une boucle de N appels IPC séquentiels pour "Annuler" est plus
   lente et plus fragile (échec partiel possible) qu'un seul appel main-process qui recalcule son
   propre `statusMatrix` — même raisonnement que `stageAll`/`unstageAll` existants, qui suivent déjà
   ce pattern côté main process plutôt que côté renderer.

7. **Popup "Faire une modification" et confirmation "Annuler" répliquent le style visuel des
   modales déjà existantes dans `VersionRepoFolder.tsx`** (overlay `fixed inset-0 bg-black/50`,
   carte `bg-surface border border-edge rounded-lg shadow-xl`) plutôt que d'introduire un composant
   `<Dialog>` générique partagé — il n'en existe aucun aujourd'hui (chaque écran gère son overlay),
   et en créer un pour ce seul ticket serait une extraction prématurée (cohérent avec le principe
   déjà appliqué dans les designs T78/T79 de ne pas anticiper une réutilisation non encore
   demandée). "Annuler" copie précisément le variant destructif (`VersionRepoFolder.tsx:343-366`,
   bouton rouge + paragraphe explicatif) puisqu'il combine trois effets destructifs (discard +
   checkout + suppression de branche).

8. **Nom de branche `dev-<slug>` : slug = titre en minuscules, espaces/ponctuation → `-`,
   compression des tirets multiples, troncature à 40 caractères, trim des tirets en bord.**
   Collision : si `dev-<slug>` existe déjà dans `api.sync.branches(repoPath)`, suffixe numérique
   incrémental (`dev-<slug>-2`, `dev-<slug>-3`…) jusqu'à trouver un nom libre. Logique locale à
   `ModificationControl.tsx`, pas de nouvel endroit partagé (aucun autre flux du code n'a besoin de
   slugifier un titre en nom de branche aujourd'hui).

9. **Titre de la modification conservé en état React local (`useState` dans
   `ModificationControl.tsx`), pas persisté.** Sert de message de commit par défaut pour "Publier".
   Si l'app est redémarrée pendant une édition en cours (le composant remonte, l'état est perdu),
   le titre n'est plus disponible : repli sur un message générique (`Modification sur <nom de la
   branche dev-*>`) — cohérent avec le hors-scope explicite du spec ("pas de fichier YAML de suivi
   comme le faisait `ActionService`"). Le mode Édition lui-même reste correctement détecté après
   redémarrage (dérivé de la branche git courante, pas de l'état applicatif), seul le message de
   commit par défaut se dégrade.

10. **`config/project.yaml` fusionné, jamais écrasé, dans `setIntegrationBranch`.** Lit d'abord via
    `readYaml` (peut retourner `null` si le fichier n'existe pas encore), fusionne
    `{ ...(existing ?? {}), integrationBranch: branch }`, puis `writeYaml`. Nécessaire car ce
    fichier peut porter d'autres clés de configuration projet (`schemaVersion`, etc., cf.
    `SPEC-TECH-stack.md` §4.5) que ce endpoint ne doit pas perdre.

## Sprint

**Deux sprints.**

- **Sprint 1 — flux complet "faire une modification"/"Publier"/"Annuler" + configuration de la
  branche d'intégration.** C'est la valeur livrée par le ticket ; testable et utilisable de bout en
  bout sans dépendre de la suppression du flux Action (les deux flux peuvent coexister
  temporairement sans collision — l'ancien est simplement inatteignable depuis la navigation, comme
  aujourd'hui).
- **Sprint 2 — suppression du flux Action orphelin + mise à jour des specs obsolètes.** Découplé
  du sprint 1 par sécurité : si le sprint 1 révèle un besoin de garder `ActionService` temporairement
  (peu probable mais possible, ex. si `GitService.writeYaml`'s tracking automatique s'avère
  utilisé ailleurs de façon non détectée par le grep), le sprint 2 peut être reporté sans bloquer la
  livraison de la fonctionnalité principale. Inclut aussi la mise à jour de
  `SPEC-FORKS-BRANCHES-BASELINES.md`/`SPEC-TECH-stack.md` (étape "dernier sprint" du workflow).

Taille comparable à T78 (deux sprints, UI + wiring nouveau) plutôt qu'à T79/T80 (un sprint,
extension mécanique d'un pattern déjà en place) : T83 introduit un composant de chrome global
nouveau, deux nouveaux endpoints, une méthode `SyncService` nouvelle, et une suppression de code
touchant 8+ fichiers — plus que ce qu'un seul sprint peut raisonnablement absorber proprement avec
revue de code entre les deux.
