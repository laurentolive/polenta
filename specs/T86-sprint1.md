# T86 — Sprint 1 (unique)

## Fichiers modifiés

**Supprimés**
- `apps/desktop/src/renderer/routes/project.$id.tsx` — route "Tableau de bord" (`IntBranchSelector` + `SyncBar`)
- `apps/desktop/src/renderer/components/SyncBar.tsx`

**Nouveaux**
- `apps/desktop/src/renderer/components/schema/IntegrationBranchSelector.tsx` — `IntBranchSelector` déplacé et renommé (le libellé UI "Baseline" devient "Branche d'intégration"), refactoré pour consommer `useBranchCheckout` au lieu de sa propre requête/mutation de checkout
- `apps/desktop/src/renderer/components/schema/RepoBranchSelector.tsx` — nouveau sélecteur de branche inline par repo dans l'arbre Structure
- `apps/desktop/src/renderer/hooks/useBranchCheckout.ts` — hook extrait de `VersionRepoFolder.tsx` (branches/tags/checkout/create/delete), partagé par `VersionRepoFolder`, `RepoBranchSelector` et `IntegrationBranchSelector`

**Modifiés**
- `apps/desktop/src/renderer/components/sidebar/ProjectPanel.tsx` — retrait des entrées "Tableau de bord" et "Droits" (sidebar et lien "Récents" de `NoProjectPanel`)
- `apps/desktop/src/renderer/components/schema/StructureTab.tsx` — `RepoRow` affiche `RepoBranchSelector` (toutes les lignes) et `IntegrationBranchSelector` (ligne root uniquement, sur sa propre ligne) ; `handleDiamondCancel` navigue vers `/` au lieu de `/project/$id`
- `apps/desktop/src/renderer/routes/schema.tsx` — résout `repoPath` depuis `useVersioning()` quand le search param est absent ; appelle `api.workspace.markRecent` ; retrait du bouton "← Projet" devenu sans destination
- `apps/desktop/src/renderer/components/layout/AppLayout.tsx` — le panel `'project'` navigue vers `/schema` ; nettoyage de `deducePanel`/`projectIdFromPath` (dead code après suppression de `/project/$id`)
- `apps/desktop/src/renderer/routes/index.tsx` — les trois points d'entrée (redirection à froid, `goToProject`, lien "Récents") naviguent vers `/schema`
- `apps/desktop/src/renderer/routes/req.$reqId.tsx`, `req.new.tsx`, `test.$testId.tsx`, `test.new.tsx` — boutons "Retour"/"Annuler" retargetés vers `/schema`
- `apps/desktop/src/renderer/components/sidebar/version/VersionRepoFolder.tsx` — consomme `useBranchCheckout` au lieu de sa logique inline (comportement inchangé) ; restaure un bouton "Pousser" (perdu avec `SyncBar`, cf. Findings)
- `apps/desktop/src/renderer/components/sidebar/version/BranchCombobox.tsx` — nouveau prop optionnel `onOpenChange` (chargement paresseux des branches/tags dans `RepoBranchSelector`)
- `apps/desktop/src/renderer/components/sidebar/VersionPanel.tsx` — retrait du prop `isRoot` (devenu inutile, `useBranchCheckout` le déduit lui-même)
- `apps/desktop/src/renderer/routeTree.gen.ts` — régénéré (retrait de `/project/$id`)

## Comportement implémenté

Conforme à `specs/T86.md`/`T86-design.md` : sidebar Projet réduite à "Modèle de données", `/schema` devient la page d'atterrissage par défaut, "Branche d'intégration" (renommé) déplacé sous la ligne root de l'arbre Structure, sélecteur de branche inline (checkout/création réels) sur chaque ligne de repo avec verrouillage en lecture seule sur `dev-*`.

## Divergences par rapport au design

- `IntegrationBranchSelector` a été **refactoré pour consommer `useBranchCheckout`** plutôt que déplacé verbatim comme prévu au design — nécessaire pour que le widget hérite du garde-fou `dev-*` (repéré en revue de code, la version "verbatim" du design initial le contournait silencieusement).
- Le sélecteur inline (`RepoBranchSelector`) charge les branches/tags **paresseusement** (à l'ouverture du dropdown, via un nouveau prop `onOpenChange` sur `BranchCombobox`) plutôt qu'en continu dès le montage de la ligne — non prévu au design, ajouté suite à un problème de performance repéré en revue (polling N×2 pour chaque repo de l'arbre dès l'ouverture de `/schema`).
- `handleDiamondCancel` navigue vers `/` plutôt que de simplement effacer l'état local — le design ne précisait pas ce cas, repéré en revue (l'état `conflicts`, distinct de `localConflicts`, n'était sinon jamais effacé).
- Un bouton "Pousser" a été ajouté à `VersionRepoFolder.tsx` — non prévu au design, qui supposait à tort que le push était déjà couvert par le panneau Version.

## `/code-review high` — 9 findings, tous corrigés

1. **[correctness]** Perte de la capacité de push (aucune UI de remplacement) — bouton "Pousser" restauré dans `VersionRepoFolder.tsx`
2. **[correctness]** Le checkout inline n'invalidait pas `['workspace-open', workspaceDir]` → pin désynchronisé avec la modale "Modifier" — `useBranchCheckout` invalide désormais cette query
3. **[correctness]** Sélecteur inline sans confirmation sur repo modifié (contrairement à `VersionRepoFolder`) — garde `isDirty` + modale de confirmation ajoutés à `RepoBranchSelector`
4. **[correctness]** "Annuler" sur un conflit diamant persistant (`conflicts`, pas `localConflicts`) ne fermait pas la modale — navigation vers `/` ajoutée
5. **[correctness]** `IntegrationBranchSelector` réimplémentait son propre checkout, contournant le garde `dev-*` — refactoré pour utiliser `useBranchCheckout`
6. **[correctness]** `api.workspace.markRecent` non appelé sur le chemin de redémarrage à froid / icône ActivityBar — appelé depuis `schema.tsx`
7. **[efficiency]** Polling branches/tags continu pour chaque ligne de l'arbre dès le montage — chargement paresseux via `onOpenChange`
8. **[simplification]** Requête de résolution `repoPath` dupliquée avec `VersioningContext` — remplacée par `useVersioning()`
9. **[simplification]** Conditionnel mort dans `AppLayout.deducePanel` — supprimé

## Mises à jour SPEC

- `SPEC-FORKS-BRANCHES-BASELINES.md` §2.2 — référence à `IntBranchSelector`/`project.$id.tsx` corrigée vers `IntegrationBranchSelector` dans l'onglet Structure
- `SPEC-PROJECT-MANAGEMENT.md` §6 — bouton "Fermer le projet" redocumenté dans `ProjectPanel.tsx` (route `/project/$id` retirée)
- `SPEC-ELECTRON-DESKTOP.md` §19.3 — ligne de table `/project/$id` remplacée par `/schema`
- `SPEC-ELECTRON-DESKTOP.md` §19.6 — schéma du panneau Projet mis à jour (retrait Tableau de bord/Droits), note T86 ajoutée
- `SPEC-INDEX.md` — colonne `MAJ` mise à jour pour les 3 sections ci-dessus → `T86`, nouvelle ligne ajoutée pour §19.3/§19.6 (jusqu'ici non indexées)

## Vérification

- `pnpm typecheck` — 0 erreur
- `pnpm build` — succès (warning `ENOENT` du générateur de routes pré-existant, sans effet, confirmé identique sur `main`)
- **Testé interactivement** (Electron lancé via le driver Playwright de ce worktree) : création d'un projet test, confirmation visuelle que la sidebar n'affiche plus que "Modèle de données", atterrissage sur `/schema` avec `repoPath` vide résolu correctement via le fallback, widget "Branche d'intégration" fonctionnel sous la ligne root, dropdown du sélecteur de branche inline opérationnel, et **bouton "Pousser" du panneau Version confirmé fonctionnel** ("↑1 commit à pousser" affiché après création du projet).

## Comment tester manuellement

1. Ouvrir un projet existant multi-composants — vérifier que la sidebar Projet n'affiche que "Modèle de données".
2. Vérifier l'atterrissage sur l'onglet Structure de `/schema` après ouverture/redémarrage à froid.
3. Sur la ligne du repo root : vérifier le widget "Branche d'intégration" (sélection/création `int-*`, bouton "Définir comme branche d'intégration") et le sélecteur de branche inline (checkout réel).
4. Sur un composant : vérifier le sélecteur inline, avec confirmation si le repo a des modifications en attente ; vérifier que le pin affiché et la modale "Modifier" restent synchronisés après un checkout inline.
5. Mettre un repo sur une branche `dev-*` (bouton "Faire une modification" ailleurs dans l'app) — vérifier que le sélecteur inline devient un simple badge en lecture seule.
6. Dans le panneau Version, committer puis vérifier l'apparition du bouton "Pousser".
