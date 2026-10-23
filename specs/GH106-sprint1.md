# GH106 — Sprint 1 : désignation, branche par défaut de la forge, gardes, « Désigner » dans Publier

Spec : `specs/GH103.md` §1. Design : `specs/GH106-design.md` (sprint 1). Tests : `specs/GH106-tests.md`.

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `packages/types/src/branch.ts` | `IntegrationState`, `IntegrationStatus`, `DesignateOutcome`, `DefaultBranchOutcome`, `IntegrationGuardCode` |
| `packages/api-client/src/{types,ipc-client}.ts` | namespace `integration` (`state`, `designate`, `create`) ; `baseline.setIntegrationBranch` marqué déprécié |
| `apps/desktop/src/main/services/integration-branch.service.ts` | **nouveau** — `state`, `designate`, `createAndDesignate`, `assertDeletable`, `IntegrationBranchGuardError` |
| `apps/desktop/src/main/services/sync.service.ts` | `commitSingleFile` (commit construit sur l'arbre de HEAD, index non lu), `readFileAtHead` |
| `apps/desktop/src/main/services/forge/{forge-provider,forgejo.provider,github.provider,forge.service}.ts` | `repoInfo` / `setDefaultBranch` (Forgejo, GitHub), `ForgeService.alignDefaultBranch`, provider choisi par compte |
| `apps/desktop/src/main/container.ts`, `main/ipc/index.ts` | service `integration`, channels `integration:*`, gardes dans `sync:delete-branch` / `sync:delete-remote-branch`, `GRAPH_WRITE_CHANNELS` |
| `apps/desktop/src/web-server/channel-policy.ts` | channels `integration:*` exposés, argument chemin `[0]` |
| `apps/desktop/src/renderer/hooks/useDesignateIntegration.ts` | **nouveau** — mutation partagée, `designateNotices`, `invalidateIntegration` |
| `apps/desktop/src/renderer/hooks/useBranchCheckout.ts` | checkout sans écriture ; création d'une `int-*` = `integration:create` + propagation du pin ; `branchNotices` (refus de suppression, échecs de création, résultat de la désignation) |
| `apps/desktop/src/renderer/components/layout/ModificationControl.tsx` | bandeau « n'est pas désignée… » + bouton « Désigner » ; popover multi-repo avec « Désigner » par repo |
| `apps/desktop/src/renderer/components/sidebar/version/BranchNotices.tsx` | **nouveau** — affichage de `branchNotices` (panneau Version, `RepoBranchSelector`) |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | `layout.modificationControl.{notDesignated,designate,designating,designateFailed}` (remplacent `blockedBranch`), `integration.notice.*` |
| Tests | `integration-branch.service.test.ts` (25), `forge/forge.default-branch.test.ts` (8), `e2e-web/gh106-designate.spec.ts` (1) |

## Comportement implémenté

- **Désigner `int-X`** : checkout si besoin (une branche seulement distante est suivie), puis commit
  `Branche d'intégration : int-X` qui ne contient que `config/project.yaml`. Les modifications en
  attente, indexées ou non, restent en attente. Ensuite : push, puis branche par défaut de la forge
  si le compte est admin. Le push et la forge ne font jamais échouer la désignation : leur résultat
  revient dans `DesignateOutcome`.
- **Copie de travail réalignée** même quand HEAD est déjà juste (reste d'une écriture non commitée
  de l'ancien code). Un `project.yaml` en YAML invalide (HEAD ou WD) est refusé, sans rien écrire.
- **Créer une `int-*`** (panneau Version, `RepoBranchSelector`) = création + désignation. En cas
  d'échec avant le commit de désignation, la branche est retirée et HEAD revient sur la branche de
  départ.
- **Checkout d'une `int-*`** : aucun commit, aucune écriture.
- **« Publier »** sur une `int-*` non désignée : bandeau avec « Désigner `int-X` ». Dans le popover
  multi-repo, un bouton par repo concerné ; les repos bloqués pour une autre raison restent listés.
- **Gardes** : suppression (locale ou sur `origin`) de la branche **explicitement** désignée, ou de
  la dernière `int-*`, refusée. Le message s'affiche dans le panneau Version et l'onglet Structure.
  Le repli `main` d'un repo sans `project.yaml` n'est pas protégé.

## Divergences par rapport au design

1. **`createAndDesignate` revient en arrière** sur échec (point non prévu au design, relevé par la
   revue de code) : sans cela, un échec laissait le repo sur une `int-*` non désignée et un nouvel
   essai butait sur « existe déjà ».
2. **Copie de travail réalignée sans commit** si HEAD désigne déjà la branche (design §2.2 étape 3
   la sautait) : sinon « Désigner » pouvait ne rien faire et laisser « Publier » bloqué.
3. **YAML invalide refusé** au lieu d'être remplacé par `{ integrationBranch }` (design §2.2 étape 5
   ne traitait pas ce cas).
4. **Garde « désignée »** basée sur la valeur écrite dans `project.yaml`, pas sur
   `getIntegrationBranch` (qui renvoie `main` par défaut).
5. **403 de la forge** non converti en « non admin » : il passe par `guard()` (bannière de
   reconnexion si jeton révoqué) ; un 404 donne une erreur explicite.
6. **Messages des gardes affichés dès ce sprint** (`BranchNotices`) au lieu du sprint 2 (§3.5) : le
   refus était sinon silencieux dans le panneau Version. Ils restent en français dans les deux
   langues (texte venu du main) : la traduction par code est faite au sprint 2.
7. `CheckoutConfirmModal` n'est pas extraite : aucun flux du sprint 1 ne fait de checkout par
   « Désigner » (le bandeau désigne la branche courante). L'extraction est faite au sprint 2 avec
   le menu de l'onglet Structure.

## Mises à jour SPEC

Aucune : les sections de `## Refs SPEC` sont mises à jour au dernier sprint (sprint 2).

## Vérifications

- `pnpm typecheck` : 0 erreur (desktop, api-client, merge-core, e2e compris).
- `pnpm test` : 633 tests desktop + 38 merge-core, tous verts.
- `pnpm build:web` puis `npx playwright test` : suite e2e web complète, 100 tests verts, 13 ignorés
  (forge réelle sans accès SSH). `gh106-designate.spec.ts` vert après les corrections.
- Lint : le dépôt n'a pas de configuration ESLint (`eslint.config.*` absent), rien à exécuter.
- `/code-review` (high) sur le diff : 10 points, 9 corrigés (cf. divergences), 1 reporté
  (traduction du message de garde, sprint 2).

## Tester à la main

1. **Cas PH2** : dans `hmi-PH2` (sur `int-PH2`, fichier à `int-VE22D`), ouvrir le projet. Le
   bandeau à côté de « Publier » affiche « `int-PH2` n'est pas désignée comme branche
   d'intégration (le fichier indique `int-VE22D`) ». Cliquer « Désigner `int-PH2` ».
   - Le bandeau disparaît, « Publier » est actif.
   - `git log -1 int-PH2` : `Branche d'intégration : int-PH2`, seul `config/project.yaml` modifié.
   - `origin/int-PH2` existe ; sur la forge, la branche par défaut est `int-PH2` si le compte est
     admin du repo.
2. Panneau Version : créer `int-test`. Elle est désignée et commitée sans autre action.
3. Panneau Version : supprimer la branche désignée → message de refus sous le repo.
4. Avec une modification en attente sur une exigence, désigner : l'exigence reste modifiée et
   n'est pas dans le commit de désignation.
