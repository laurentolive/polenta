# GH106 — Sprint 2 : branche d'intégration dans l'onglet Structure, refus traduits, SPEC

Spec : `specs/GH103.md` §1. Design : `specs/GH106-design.md` (sprint 2). Tests : `specs/GH106-tests.md`.
Sprint 1 : `specs/GH106-sprint1.md`.

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `apps/desktop/src/renderer/components/schema/IntegrationBranchIndicator.tsx` | **nouveau** — intégration affichée seulement si elle diffère du checkout : « Désigner `int-X` comme intégration » ou « Intégration : `int-Y` » |
| `apps/desktop/src/renderer/components/sidebar/version/BranchCombobox.tsx` | mention « intégration » sur la branche désignée (`integrationBranch`) |
| `apps/desktop/src/renderer/components/schema/CheckoutConfirmModal.tsx` | **nouveau** — garde des modifications en attente, extraite de `RepoBranchSelector` |
| `apps/desktop/src/renderer/components/schema/{StructureTab,RepoBranchSelector}.tsx` | indicateur dans `RepoRow`, pin masqué s'il égale le checkout (`RepoPin`) ; `RepoBranchSelector` : `CheckoutConfirmModal`, intégration marquée, commit abrégé en detached HEAD |
| `apps/desktop/src/renderer/hooks/useDesignateIntegration.ts` | invalidation immédiate (désignation seule : la création passe par la combo) |
| `packages/types/src/branch.ts` | marqueur `⟦integration-guard …⟧` (`encodeIntegrationGuard` / `parseIntegrationGuard`), `isValidIntegrationSuffix` partagé main / renderer |
| `apps/desktop/src/main/services/integration-branch.service.ts` | refus encodés avec le marqueur ; validateur partagé |
| `apps/desktop/src/renderer/api.ts` | refus de la garde traduits dans le transport (comme `⟦forge-access …⟧`) |
| `apps/desktop/src/renderer/lib/branchErrors.ts` | **nouveau** — message sans le préfixe de l'IPC Electron (hook, menu, fenêtre, graphe) |
| `apps/desktop/src/renderer/routes/graph.tsx` | erreurs des mutations via `branchErrorText` |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | `schema.integrationIndicator.*`, `sidebar.version.integrationTag`, `integration.guard.*` |
| `apps/desktop/e2e-web/gh106-structure.spec.ts` | **nouveau** — T-11, T-13, T-30, T-23 |
| `apps/desktop/src/main/services/integration-branch.service.test.ts` | marqueur du refus vérifié à travers le préfixe IPC |
| `specs/SPEC-*.md`, `specs/SPEC-INDEX.md` | cf. § Mises à jour SPEC |

## Comportement implémenté

- **Onglet Structure**, sur chaque repo (pas les composants locaux) :
  - La combo de branche est le seul contrôle : branche courante (en detached HEAD : baseline
    checkoutée, sinon commit abrégé),
    intégration désignée marquée « intégration » dans la liste, checkout sous la garde des
    modifications en attente ; « Nouvelle branche… » `int-<nom>` crée et désigne.
  - L'intégration n'est affichée que si elle diffère de la branche checkoutée : ⚠ « Désigner
    `int-X` comme intégration » (branche courante `int-*` non désignée, cas PH2), sinon
    « Intégration : `int-Y` » pour information. Rien sur `dev-*`.
  - Le pin d'un composant n'est affiché (en avertissement) que s'il désigne une autre version que
    le checkout (nom, SHA, ou tag / branche résolus sur HEAD).
- **Refus des gardes** traduits (français / anglais) dans toutes les UI, y compris le graphe.

## Divergences par rapport au design

1. **Traduction centralisée dans `api.ts`** au lieu d'une traduction par écran (§3.5) : relevé par
   la revue, toute UI qui affiche `err.message` reçoit le texte traduit.
2. **Menu désactivé sur `dev-*`** (non prévu au design) : même règle que `RepoBranchSelector`
   (T83), sinon le menu faisait quitter une modification en cours par un checkout.
3. **Départ « intégration actuelle »** = position courante quand la désignation n'est que le repli
   `main` (la branche `main` peut ne pas exister).
4. **Retour à la branche de départ** après un checkout préalable suivi d'un échec de création :
   fait côté renderer (le service ne connaît que la branche d'où il est parti).
5. **Fenêtres en portail** (`document.body`) : dans la ligne du repo, elles héritaient de
   `select-none` et pouvaient lancer le glisser-déposer de la ligne.
6. Validateur de suffixe **partagé** dans `@polenta/types` au lieu d'être dupliqué.
7. T-30 vérifié au niveau du channel (marqueur transmis) plutôt qu'en cliquant la suppression dans
   le panneau Version : la traduction et l'affichage sont communs à toutes les UI (`api.ts`,
   `BranchNotices`).

8. **Pas de menu « Intégration » ni de fenêtre de création** (retours de validation, ci-dessous) au
   lieu du design §3.4.

## Retours de validation

**1. Menu désactivé en detached HEAD** (projet PH2 : `packBattery-7STD` et trois accessoires,
épinglés sur un commit). Le verrou ne protégeait rien : « Désigner » commite sur la `int-*`, jamais
sur le commit épinglé. Décision : actif ; seul `dev-*` verrouille.
- Statut `readonly` renommé `detached` ; `IntegrationState.headOid` (commit de HEAD) ajouté.
- `createAndDesignate` : en detached HEAD, la position de retour est le commit ; avant, un échec
  laissait HEAD sur une branche supprimée.
- Tests unitaires : `designate` et `createAndDesignate` en detached, état `detached`.

**2. Même information trois fois sur la ligne** (pin, combo, « Intégration : `int-X` »), et en
detached HEAD pas de combo du tout. Décision : la combo seule ; l'intégration affichée seulement
quand elle diffère du checkout.
- `IntegrationBranchMenu` et `NewIntegrationBranchModal` supprimés, remplacés par
  `IntegrationBranchIndicator` ; la création d'une `int-*` passe par « Nouvelle branche… » de la
  combo (création + désignation depuis le sprint 1 ; pour partir d'une baseline, la checkouter
  d'abord) ; `useDesignateIntegration` ne fait plus que désigner.
- Combo : intégration marquée dans la liste, commit abrégé en detached HEAD.
- Pin masqué s'il égale la branche ou le commit checkouté.
- e2e `gh106-structure.spec.ts` réécrit (T-13, T-11 sur le cas PH2, T-30, T-23).

**3. Pin encore répété** (PH2 : `VE22D` épinglé sur le SHA `c831de5c` que pointe `int-PH2` ;
`packBattery-7STD` épinglé sur `int-VE10A`, sa branche courante). Le pin n'était comparé au commit
qu'en detached HEAD, et sa lecture (10 s) pouvait retarder sur celle de la combo (3 s).
- `RepoPin` : même version si même nom, SHA préfixe de HEAD, ou tag / branche qui résout sur HEAD
  (`sync:resolve-refs`) ; branche lue dans `sync:status` comme la combo, HEAD dans `git:head-sha`.
  Affiché, il l'est en avertissement, avec une infobulle (« Le repo parent pointe sur … »).
- Combo en detached HEAD : la baseline checkoutée (le tag épinglé si plusieurs) avant le commit.
- e2e `GH106-S2-5` (démo : « Pompe de vidange » épinglée sur `v2.0`).

## Mises à jour SPEC

| Section | Résumé |
|---|---|
| `SPEC-FORKS-BRANCHES-BASELINES.md` §2 (intro) | désignation par `IntegrationBranchService`, commit + push, `setIntegrationBranch` déprécié, invariant |
| `SPEC-FORKS-BRANCHES-BASELINES.md` §2.1 | ligne « `int-*` ≠ intégration » : bandeau + « Désigner », bouton par repo dans le popover multi-repo |
| `SPEC-FORKS-BRANCHES-BASELINES.md` §2.2 | remplace le widget `IntegrationBranchSelector` (disparu) : menu « Intégration », désigner, créer, checkout sans effet de bord, gardes de suppression, marqueur traduit |
| `SPEC-FORKS-BRANCHES-BASELINES.md` §2.3 | création manuelle d'une `int-*` = `integration:create` ; suppression gardée |
| `SPEC-TECH-stack.md` §4.5 | `project.yaml` commité à la désignation, invariant, `commitSingleFile` (et le piège du `ref` non complet) |
| `SPEC-ELECTRON-DESKTOP.md` §20.4, §20.6 | IPC `integration:*` ; `IntegrationBranchMenu` et `CheckoutConfirmModal` dans l'onglet Structure |
| `SPEC-WEB.md` §global | channels `integration:*` exposés |
| `SPEC-INDEX.md` | 4 lignes : couverture, mots-clés, MAJ → GH106 |

## Vérifications

- `pnpm typecheck` : 0 erreur.
- `pnpm test` : 633 tests desktop + 38 merge-core, verts.
- `pnpm build:web` puis `npx playwright test` : 104 tests verts, 13 ignorés (forge réelle sans
  accès SSH), dont `gh106-designate.spec.ts` (1) et `gh106-structure.spec.ts` (3).
- `/code-review` (high) sur le diff du sprint : 10 points, tous corrigés (cf. divergences 1 à 6,
  plus : erreur de création affichée une seule fois, « Annuler » désactivé pendant la création,
  invalidations avant la propagation du pin, attente explicite de la confirmation dans l'e2e).

## Tester à la main

1. Modèle de données › Structure : un repo sur sa branche d'intégration n'affiche que sa combo
   (pas de pin ni de « Intégration » répétés). Ouvrir la combo : la branche désignée porte la
   mention « intégration ».
2. Combo › « Nouvelle branche… » `int-v2` : la combo passe à `int-v2`, rien d'autre ne s'affiche,
   `git log -1` montre `Branche d'intégration : int-v2`.
3. Repo épinglé sur un commit (PH2 : `packBattery-7STD`) : la combo montre le commit abrégé et
   « Intégration : `int-VE10A` » s'affiche ; choisir `int-VE10A` dans la combo → le libellé disparaît.
4. Panneau Version : supprimer la branche désignée → message traduit (essayer en anglais dans les
   Préférences).
5. **Cas PH2** : sur `VE22D` (branche `int-PH2`, fichier à `int-VE22D`), « Désigner `int-PH2` comme
   intégration » s'affiche à côté de la combo ; un clic le fait disparaître.
