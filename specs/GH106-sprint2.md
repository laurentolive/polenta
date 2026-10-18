# GH106 — Sprint 2 : menu « Intégration » de l'onglet Structure, nouvelle branche d'intégration, SPEC

Spec : `specs/GH103.md` §1. Design : `specs/GH106-design.md` (sprint 2). Tests : `specs/GH106-tests.md`.
Sprint 1 : `specs/GH106-sprint1.md`.

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `apps/desktop/src/renderer/components/schema/IntegrationBranchMenu.tsx` | **nouveau** — « Intégration : `int-X` » sur la ligne de chaque repo : pastilles, choix d'une `int-*`, « Nouvelle branche d'intégration… » |
| `apps/desktop/src/renderer/components/schema/NewIntegrationBranchModal.tsx` | **nouveau** — préfixe `int-` imposé, nom vérifié à la saisie, départ depuis l'intégration actuelle ou une baseline |
| `apps/desktop/src/renderer/components/schema/CheckoutConfirmModal.tsx` | **nouveau** — garde des modifications en attente, extraite de `RepoBranchSelector` |
| `apps/desktop/src/renderer/components/schema/{StructureTab,RepoBranchSelector}.tsx` | menu inséré dans `RepoRow` ; `RepoBranchSelector` utilise `CheckoutConfirmModal` |
| `apps/desktop/src/renderer/hooks/useDesignateIntegration.ts` | création (`integration:create`, checkout préalable avec retour à la branche de départ sur échec), invalidation immédiate, `lastKind` |
| `packages/types/src/branch.ts` | marqueur `⟦integration-guard …⟧` (`encodeIntegrationGuard` / `parseIntegrationGuard`), `isValidIntegrationSuffix` partagé main / renderer |
| `apps/desktop/src/main/services/integration-branch.service.ts` | refus encodés avec le marqueur ; validateur partagé |
| `apps/desktop/src/renderer/api.ts` | refus de la garde traduits dans le transport (comme `⟦forge-access …⟧`) |
| `apps/desktop/src/renderer/lib/branchErrors.ts` | **nouveau** — message sans le préfixe de l'IPC Electron (hook, menu, fenêtre, graphe) |
| `apps/desktop/src/renderer/routes/graph.tsx` | erreurs des mutations via `branchErrorText` |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | `schema.integrationMenu.*`, `schema.newIntegrationBranch.*`, `integration.guard.*` |
| `apps/desktop/e2e-web/gh106-structure.spec.ts` | **nouveau** — T-11, T-13, T-30 |
| `apps/desktop/src/main/services/integration-branch.service.test.ts` | marqueur du refus vérifié à travers le préfixe IPC |
| `specs/SPEC-*.md`, `specs/SPEC-INDEX.md` | cf. § Mises à jour SPEC |

## Comportement implémenté

- **Onglet Structure** : sur chaque repo (pas les composants locaux), « Intégration : `int-X` ».
  - Pastille ⚠ **incohérente** (branche courante `int-*` non désignée) : « Désigner `<courante>` »
    en tête du menu.
  - Pastille **hors convention** (intégration sans `int-`, p. ex. le repli `main`) : rien n'est
    bloqué.
  - Menu actif en detached HEAD (composant épinglé, baseline) : choisir une branche en fait le
    checkout. Désactivé seulement sur une branche `dev-*` (modification en cours).
  - Menu : `int-*` locales et distantes (« distante »), la désignée cochée ; choisir une autre
    branche la désigne (checkout sous la garde des modifications en attente).
  - « Nouvelle branche d'intégration… » : création + désignation. Départ « intégration actuelle »
    (avec checkout préalable si on est ailleurs, et retour à la branche de départ si la création
    échoue) ou baseline. Sans désignation écrite, le départ est la position courante.
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

8. **Menu actif en detached HEAD** (retour de validation, cf. plus bas) au lieu de « menu désactivé
   pour `readonly` » (design §3.4, spec GH103 §1.1).

## Retour de validation : menu actif en detached HEAD

Constat (projet PH2) : `packBattery-7STD` et trois accessoires, épinglés sur un commit par le
produit, sont en detached HEAD ; le menu y était désactivé alors que le sélecteur de branche voisin
permet le même checkout. Le verrou ne protégeait rien (« Désigner » commite sur la `int-*`, jamais
sur le commit épinglé ; la fenêtre de création propose déjà « depuis une baseline »). Décision :
menu actif, seul `dev-*` le verrouille.

- Statut `readonly` renommé `detached` ; `IntegrationState.headOid` (commit de HEAD) ajouté.
- Choisir une `int-*`, y compris la désignée : checkout puis désignation.
- Nouvelle branche : depuis l'intégration désignée si elle existe (checkout préalable, retour au
  commit de départ si la création échoue), sinon depuis le commit courant (« Commit actuel (abc1234) »).
- `createAndDesignate` : en detached HEAD, la position de retour est le commit ; avant, l'échec
  laissait HEAD sur une branche supprimée.
- Tests : 3 unitaires (`designate` et `createAndDesignate` en detached, état `detached`), e2e
  `GH106-S2-4`.
- Spec GH103 §1.1 et `SPEC-FORKS-BRANCHES-BASELINES.md` §2.2 mises à jour.

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

1. Modèle de données › Structure : chaque repo affiche « Intégration : … ». Un repo en `main` sans
   `project.yaml` a la pastille grise ; un repo épinglé sur une baseline a le menu grisé.
2. « Nouvelle branche d'intégration… » : saisir `a b` → message d'erreur, bouton désactivé ;
   saisir `v2` → « Créer et désigner ». Le libellé passe à `int-v2`, `git log -1` montre
   `Branche d'intégration : int-v2`.
3. Rouvrir le menu, choisir l'ancienne `int-*` : avec des modifications en attente, la
   confirmation « Forcer le checkout » apparaît ; après, le libellé revient.
4. Panneau Version : supprimer la branche désignée → message traduit (essayer en anglais dans les
   Préférences).
5. **Cas PH2** : dans `hmi-PH2`, le menu montre la pastille ⚠ et « Désigner `int-PH2` ».
