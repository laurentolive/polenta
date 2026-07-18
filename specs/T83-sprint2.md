# T83 — Sprint 2 : suppression du flux "Action" orphelin

Périmètre : sprint 2 (dernier sprint) — cf. `specs/T83-design.md` §Sprint. Complète T83 : le
workflow simplifié "faire une modification"/"Publier"/"Annuler" (sprint 1) est désormais le seul
mécanisme de branche/merge dans l'application ; l'ancien flux "Action" (review-gated, inatteignable
depuis la navigation) est entièrement retiré.

## Fichiers modifiés / supprimés

**Supprimés :**
- `apps/desktop/src/main/services/action.service.ts`
- `apps/desktop/src/renderer/routes/action.new.tsx`, `action.$actionId.tsx`
- `packages/types/src/action.ts`

**Modifiés :**
- `apps/desktop/src/main/ipc/index.ts` — handlers `actions:*` (create/get-current/get/list/
  submit-for-review/merge/abandon/update) et `reviews:get-by-action` retirés ; imports
  `ActionService`/`CreateActionDto` retirés ; `action: ActionService` retiré de l'interface
  `Container`
- `apps/desktop/src/main/container.ts` — wiring `ActionService` retiré (instanciation, setter
  injection `git.setActionService(action)`, entrée `action` du littéral passé à
  `registerIpcHandlers`)
- `apps/desktop/src/main/services/git.service.ts` — champ `actionService`, `setActionService()` et
  le bloc de tracking automatique dans `writeYaml()` retirés
- `apps/desktop/src/main/services/reviews.service.ts` — `findByAction()` et
  `hasApprovedReviewForAction()` retirés (zéro appelant restant) ; `CreateReviewDto.actionId`
  devient optionnel (cohérent avec `Review.actionId?: string`, plus aucune Action à référencer)
- `apps/desktop/src/main/services/sync.service.ts` — commentaire obsolète mentionnant
  `ActionService` corrigé
- `packages/api-client/src/types.ts`, `packages/api-client/src/ipc-client.ts` — bloc `actions:{...}`
  retiré, `getByAction` retiré de `reviews:{...}`, `Action`/`CreateActionDto` retirés des imports,
  `CreateReviewDto.actionId` aligné en optionnel
- `packages/types/src/index.ts` — `export * from './action'` retiré
- `apps/desktop/src/renderer/components/layout/AppLayout.tsx` — branche `/action/` de
  `deducePanel()` retirée
- `apps/desktop/src/renderer/routeTree.gen.ts` — les deux entrées de route Action retirées à la
  main, précisément (le générateur TanStack Router disponible dans l'environnement produit un
  format différent de celui committé — cf. divergence ci-dessous — un édit ciblé était plus sûr
  qu'une régénération complète)
- `SPEC.md`, `specs/SPEC-FORKS-BRANCHES-BASELINES.md`, `specs/SPEC-TECH-stack.md`,
  `specs/SPEC-REVIEWS.md`, `specs/SPEC-INDEX.md` — toutes les mentions vivantes du flux Action
  corrigées pour refléter le modèle réel (dev-*/Publier/Annuler), colonne `MAJ` mise à jour

## Divergences par rapport au design

- **Régénération de `routeTree.gen.ts` : édit manuel ciblé au lieu d'une régénération automatique.**
  Le design (et la convention CLAUDE.md "ne jamais éditer `tree.yaml` à la main", bien que ce ne
  soit pas le même fichier) supposaient une régénération via le toolchain TanStack Router.
  `electron-vite build` a révélé un bug préexistant de configuration (`routesDirectory` résolu deux
  fois relativement à `root: './src/renderer'`, cf. `electron.vite.config.ts:29-37`) qui fait
  planter la génération — hors périmètre de T83 à corriger. Invoquer directement
  `@tanstack/router-generator` a fonctionné mais a produit un style de sortie différent de celui
  committé (ordre des routes, commentaires d'en-tête, lignes vides) pour cause de version/config
  distincte de celle réellement utilisée par le plugin Vite du projet — un tel diff aurait ajouté
  ~800 lignes de churn non lié à ce ticket. Un édit manuel précis (suppression des 42 lignes
  concernant exactement les deux routes Action, aucune autre ligne touchée) a été préféré : diff
  minimal, aucun risque de divergence de format avec le reste du fichier.
- **Périmètre de la correction documentaire élargi au-delà du design.** `specs/T83-design.md` ne
  listait que `SPEC-FORKS-BRANCHES-BASELINES.md` §2 et `SPEC-TECH-stack.md` §4.3/§6. La revue de
  code a trouvé des mentions vivantes et contradictoires du flux Action dans `SPEC.md` (diagramme
  d'entités §3, contrainte §5 — jamais listé dans le design) et `SPEC-REVIEWS.md` (§2.2, référence
  au mécanisme `action.affectedItems` supprimé), plus deux mentions oubliées dans
  `SPEC-TECH-stack.md` lui-même (diagramme d'architecture, arborescence de fichiers) qui rendaient
  le fichier auto-contradictoire avec sa propre section corrigée. Toutes corrigées.
- **`CreateReviewDto.actionId` rendu optionnel.** Ni le spec ni le design ne mentionnaient ce champ ;
  trouvé en revue de code comme incohérence de type (`Review.actionId` optionnel mais
  `CreateReviewDto.actionId` obligatoire, sans plus aucune Action à référencer). Corrigé par
  cohérence, portée minimale (un seul champ, pas de remaniement de `ReviewsService`).

## Revue de code

Un agent de revue ciblé (au lieu des 8 angles complets du sprint 1 — le diff de sprint 2 est
presque entièrement de la suppression mécanique, `pnpm typecheck` couvrant déjà l'essentiel du
risque). Six points relevés, tous corrigés : mentions vivantes du flux Action dans `SPEC.md` (non
prévu par le design) et `SPEC-TECH-stack.md` (mentions oubliées malgré la correction ciblée du
sprint), description obsolète du remplissage de `objects` dans `SPEC-REVIEWS.md`, et l'incohérence
`CreateReviewDto.actionId` (deux fichiers). Confirmé propres après vérification exhaustive : aucune
référence résiduelle en code (`ActionService`, routes, IPC, types), aucun autre consommateur du
tracking `affectedItems` supprimé, `routeTree.gen.ts` structurellement cohérent (26 routes, aucune
entrée orpheline), `reviews.service.ts` sans dépendance cachée à `findByAction`.

## Comment tester manuellement

1. Naviguer directement vers `/action/new` ou `/action/$actionId` (URL manuelle) : route
   inexistante, 404 du routeur.
2. Écrire/modifier une exigence, un test, un fichier `requirements/*.yaml` quelconque : fonctionne
   normalement (le tracking `affectedItems` supprimé n'était consommé par rien d'autre).
3. `pnpm typecheck` (packages `@polenta/desktop`, `@polenta/api-client`, `@polenta/types`) : zéro
   erreur.
4. Revalider le flux sprint 1 (bouton "faire une modification"/"Publier"/"Annuler") pour confirmer
   l'absence de régression suite au retrait du flux Action (aucun chevauchement de code entre les
   deux flux, donc non-régression attendue mais à vérifier interactivement).

Non testé interactivement dans cette session (pas d'Electron attachable) — T83 est maintenant
complet (2/2 sprints codés, revues de code passées) et attend validation manuelle humaine avant
archivage vers `tickets_archive.md` et proposition de merge vers `main`.
