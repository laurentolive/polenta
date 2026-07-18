# T83 — Sprint 1 : flux "faire une modification" / "Publier" / "Annuler"

Périmètre : sprint 1 uniquement (cf. `specs/T83-design.md` §Sprint) — le flux complet est livré et
utilisable de bout en bout. La suppression du flux "Action" orphelin est reportée au sprint 2.

## Fichiers modifiés / créés

**Nouveaux :**
- `apps/desktop/src/renderer/hooks/useModificationMode.ts` — résout le repo concerné (root par
  défaut, `?repo=` sinon), sa branche courante, sa branche d'intégration configurée, et calcule
  `mode: 'view' | 'edit' | 'other'`
- `apps/desktop/src/renderer/hooks/useIntegrationBranch.ts` — hook partagé (lecture/invalidation
  de `api.baseline.getIntegrationBranch`), utilisé par `useModificationMode` et `project.$id.tsx`
- `apps/desktop/src/renderer/components/layout/ModificationControl.tsx` — l'élément persistant :
  bouton "Faire une modification" (mode Vue) ou paire "Publier"/"Annuler" + indicateur de mode
  (mode Édition), popup de création, confirmation d'annulation, notification d'échec de merge

**Modifiés :**
- `apps/desktop/src/main/services/sync.service.ts` — `discardAll(repoPath)` (nouveau, réutilisé
  par `discard()` par fichier)
- `apps/desktop/src/main/services/git.service.ts` — `setIntegrationBranch(repoPath, branch)`
  (nouveau, fusionne dans `config/project.yaml` sans écraser les autres clés, garde contre un
  fichier non-objet)
- `apps/desktop/src/main/ipc/index.ts` — handlers `sync:discard-all`, `baseline:set-integration-branch`
- `packages/api-client/src/types.ts`, `packages/api-client/src/ipc-client.ts` — wiring des deux
  méthodes ci-dessus
- `apps/desktop/src/renderer/contexts/VersioningContext.tsx` — expose `pendingChangesCount`
  (staged+unstaged du root), pour éviter une deuxième requête `sync:status` dans
  `useModificationMode`
- `apps/desktop/src/renderer/components/layout/AppLayout.tsx` — monte `<ModificationControl />`
- `apps/desktop/src/renderer/routes/project.$id.tsx` — `IntBranchSelector` gagne l'action
  "Définir comme branche d'intégration" (persiste le choix)
- `apps/desktop/src/renderer/components/sidebar/version/VersionRepoFolder.tsx` — le bouton
  existant "Tout annuler" utilise désormais `sync.discardAll` au lieu d'une boucle client-side qui
  ne traitait que les fichiers non stagés (bug préexistant corrigé en passant, cf. revue ci-dessous)

## Comportement implémenté

Conforme à `specs/T83.md` et `specs/T83-design.md` : bouton contextuel reflétant l'état git du
repo concerné, popup titre seul → `dev-<slug>` créé et checkouté, "Publier" (stage + commit +
merge + retour + suppression de branche) et "Annuler" (discard + checkout + suppression de
branche, avec confirmation) fonctionnels.

## Divergences par rapport au design

Une divergence significative par rapport au design initial, trouvée en `/code-review high` (cf.
détail ci-dessous) :

- **Condition du mode "Vue" resserrée.** Le design prévoyait `mode = 'view'` dès que
  `branche courante === branche d'intégration configurée`. La revue a identifié qu'un repo dont la
  branche d'intégration n'a jamais été configurée retombe sur `'main'` (fallback existant), et que
  si la branche courante est aussi `main`, l'égalité était vraie alors que rien ne protège
  réellement cette branche (`isReadonly`/`readOnly` de `VersioningContext`/`SystemViewContext` ne
  traitent que le préfixe `int-*`). Le bouton aurait affiché "Lecture" sur une branche en réalité
  librement éditable — condition corrigée en `branch === integrationBranch && branch.startsWith('int-')`.
  Pas de changement du modèle `config/project.yaml`/`GitService`, seulement de la logique de calcul
  du mode côté renderer.

Le reste est conforme au design (deux nouveaux endpoints, hook indépendant de `SystemViewContext`,
pattern de modale copié de `VersionRepoFolder.tsx`, garde "Publier" sur modifications en attente
uniquement).

## Revue de code (`/code-review high`)

8 angles (3 correctness + 4 cleanup/altitude + conventions), 12 findings retenus après vérification,
tous corrigés sauf un :

- **Corrigés (7 correctness + 4 cleanup) :** dialog "Annuler" non gardé par le mode (pouvait agir
  sur une branche différente si le mode changeait pendant que la confirmation était ouverte) ;
  mode "Vue" trompeur sur branche `main` non configurée (cf. divergence ci-dessus) ; titre effacé
  immédiatement après création de branche (le message de commit par défaut de "Publier" n'était
  donc jamais le titre saisi) ; `discardAllMutation` préexistant de `VersionRepoFolder.tsx` ne
  traitait pas les fichiers stagés malgré son libellé "Tout annuler" (retrofité sur le nouveau
  `sync.discardAll`) ; `repoPath` retombait transitoirement sur le root pendant la résolution d'un
  `?repo=` explicite ; `cancelMutation` sans gestion d'erreur ; `setIntegrationBranch` ne validait
  pas que le YAML existant était bien un objet avant de le fusionner ; requêtes `sync:status`
  redondantes entre le composant et son hook ; duplication de la requête branche d'intégration
  entre `project.$id.tsx` et le hook (extraite dans `useIntegrationBranch`) ; triple duplication de
  la modale dans `ModificationControl.tsx` (extraite en composant local `Overlay`).
- **Non corrigé, noté :** `ApiClient.sync.commit` déclare `Promise<string>` alors que
  `SyncService.commit` retourne un objet `CommitResult` — mismatch préexistant, sans impact sur ce
  sprint (la valeur de retour est ignorée), hors périmètre de T83.

## Comment tester manuellement

1. Ouvrir un projet Polenta, se placer sur la branche d'intégration configurée du repo root (par
   défaut `main` tant qu'aucune branche `int-*` n'a été désignée — voir point 2).
2. Vue Projet → `IntBranchSelector` : créer/sélectionner une branche `int-*`, cliquer "Définir
   comme branche d'intégration" ; vérifier que `config/project.yaml` contient bien
   `integrationBranch: int-<nom>` et que le libellé "Intégration configurée" l'affiche.
3. Checkout cette branche `int-*` (dropdown Baseline) : le bouton "Faire une modification" apparaît
   en haut à droite avec l'indicateur "Lecture".
4. Cliquer, saisir un titre, valider : la branche `dev-<slug>` est créée/checkoutée, l'indicateur
   passe "Édition", boutons "Publier"/"Annuler" affichés.
5. Modifier une exigence (vue Système) : "Publier" devient actif.
6. "Publier" : vérifier le retour automatique sur la branche d'intégration, la disparition de la
   branche `dev-*` (panneau Version), et que l'exigence modifiée est bien présente sur la branche
   d'intégration.
7. Refaire une modification, cliquer "Annuler", confirmer : vérifier le retour sur la branche
   d'intégration sans les changements, et la suppression de la branche `dev-*`.
8. Panneau Version → un repo avec fichiers stagés ET non stagés → "Tout annuler" → vérifier que les
   deux catégories sont bien rejetées (non-régression du fix appliqué).

Non testé interactivement dans cette session (pas d'Electron attachable) — attend validation
manuelle humaine avant de lancer le sprint 2 (suppression du flux Action).
