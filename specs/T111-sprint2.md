# T111 — Sprint 2 : panneaux latéraux + Projet/Modèle de données

## Fichiers modifiés

- `components/sidebar/{ProjectPanel,DashboardPanel,RequirementsPanel,SearchPanel,
  SystemPanel,TestsPanel,VersionPanel,ReorderableSidebarSection}.tsx`
- `components/sidebar/version/{BranchCombobox,FileList,GitRefCombobox,
  PinPropagationWarning,VersionCompareSelector,VersionImpactSelector,VersionRepoFolder}.tsx`
- `components/schema/{AddDependencyModal,ElementConfigModal,RemoveDependencyModal,
  RepoBranchSelector,StructureTab,objectTypeEditor}.tsx`
- `routes/schema.tsx`, `routes/search.tsx`
- `i18n/locales/{fr,en}.json` (+271 clés, 378/378 après sprint, parité vérifiée par script)

Périmètre conforme à `T111-design.md` § Sprint 2 — aucun fichier hors liste touché.

## Comportement implémenté

- Tous les libellés statiques des fichiers ci-dessus (titres, boutons, placeholders,
  messages vide/erreur/confirmation, tooltips) passent par `t()`.
- Pluriels FR/EN traités via les suffixes i18next `_one`/`_other` (`campaignCount`,
  `pushCount`, et les deux nouveaux `campaignCountFiltered`/`resultsMatches`/`resultsItems`
  ajoutés puis corrigés pendant la revue, cf. Divergences).
- Config module-scope (`CATEGORY_LABEL_KEY` dans `objectTypeEditor.tsx`/`StructureTab.tsx`,
  `STATUS_LABEL_KEY` dans `SystemPanel.tsx`) stocke des clés de traduction, résolues via
  `t()` au moment du rendu — convention posée en Sprint 1, réutilisée telle quelle.
- `<Trans>` utilisé pour préserver du style inline sur une valeur interpolée
  (`RemoveDependencyModal`, `RepoBranchSelector`, `SystemPanel`, `ReorderableSidebarSection`,
  `VersionRepoFolder`).
- Statuts de schéma projet (`draft`/`review`/`approved`/`obsolete`, valeurs par défaut dans
  `objectTypeEditor.tsx`) **non traduits** — conforme à `T111.md` (donnée projet, pas UI).

## Divergences par rapport au design

Aucune divergence de périmètre. Deux bugs de pluralisation introduits en cours de sprint,
trouvés et corrigés pendant le `/code-review` (cf. Revue ci-dessous) :

- **`campaignCountFiltered`** (`SystemPanel.tsx`) construisait le pluriel à la main
  (`campaigns.length !== 1 ? 's' : ''`) au lieu d'utiliser `_one`/`_other` — la règle FR
  traite 0 comme singulier (contrairement à l'anglais), donc "0 campagne" s'affichait
  "0 campagnes" en français. Corrigé en clés `_one`/`_other` sur `count`, aligné sur la
  clé sœur `campaignCount` du même composant qui utilisait déjà le bon mécanisme.
- **`resultsCount`** (`SearchPanel.tsx`) même anti-pattern, avec un deuxième défaut propre à
  l'anglais : le pluriel de "match" était généré en ajoutant un simple "s" ("2 matchs" au
  lieu de "2 matches"). Corrigé en scindant en deux clés indépendantes pluralisées
  (`resultsMatches`/`resultsItems`, chacune avec `_one`/`_other`), composées en JS plutôt
  que via un seul gabarit à deux compteurs.

Cinq clés dupliquant `common.*` (ou entre elles) trouvées par la revue ont été consolidées
avant commit plutôt que laissées : `schema.page.cancel`/`save` → `common.cancel`/`save` ;
`schema.structureTab.loading` et `sidebar.reorderable.loading` → `common.loading` ;
`schema.elementConfig.delete` et les 6 usages de `sidebar.reorderable.delete` empruntés
hors de leur domaine d'origine → nouvelle clé `common.delete`. Un appel `t()` imbriqué dans
les valeurs d'interpolation d'un autre `t()` (`StructureTab.tsx`, titre du bouton "Modifier"
la dépendance) a été aplati en deux clés distinctes (`editDependencyComponent`/
`editDependencyInterface`) plutôt que composé au runtime.

## Revue

`/code-review` (effort high, 8 angles, exécutés en parallèle) sur le diff complet du sprint.
Convergence de plusieurs angles indépendants sur les deux bugs de pluralisation
(CONFIRMED par les angles B, C, altitude et conventions) et sur les doublons de clés
`common.*` (CONFIRMED par les angles reuse et simplification). Tous les findings retenus
ont été corrigés ; aucun finding CONFIRMED non traité.

`pnpm typecheck` propre après les correctifs. Script de contrôle : parité des clés
`fr.json`/`en.json` (378/378, aucune divergence dans un sens ou l'autre) et JSON valide
dans les deux fichiers.

## Comment tester manuellement

1. `pnpm --filter @polenta/desktop dev` (ou `pnpm build` + lancer l'exécutable packagé).
2. Basculer en anglais depuis le panneau Compte (sélecteur ajouté en Sprint 1).
3. Ouvrir successivement les panneaux latéraux Projet, Suivi, Exigences, Recherche,
   Système, Tests, Version — vérifier l'absence de chaîne française restante.
4. Dans le panneau Système, ouvrir la liste de campagnes avec un filtre actif sur un
   composant sans campagne : le compteur doit afficher "0 campaign" (EN) / rebasculer en
   français doit afficher "0 campagne" au singulier.
5. Dans le panneau Recherche, lancer une recherche avec regex donnant plusieurs
   occurrences dans plusieurs éléments : vérifier "N matches in M items" (EN, pluriel
   anglais correct) / "N occurrences dans M éléments" (FR).
6. Ouvrir Projet → Modèle de données (`routes/schema.tsx`) et les popups d'édition Structure
   (Ajouter/Modifier composant, Ajouter/Modifier interface, Élément) : vérifier boutons
   Enregistrer/Annuler/Supprimer traduits.
7. Non testé interactivement dans cette session (pas d'affichage Electron attachable dans
   ce bac à sable) — vérification statique uniquement (typecheck, parité JSON, revue de
   code multi-angle). Attend validation manuelle humaine avant Sprint 3.
