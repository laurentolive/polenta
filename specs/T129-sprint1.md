# T129 — Sprint 1 (final)

## Fichiers modifiés

- `apps/desktop/src/renderer/contexts/SystemViewContext.tsx` — `ComponentOption` devient interne
  (non exportée) et porte désormais `objectTypes` ; nouveau `ComponentTypeOption` exporté (sans
  `key` string — identité par position dans le tableau, cf. Divergences) ; nouveau
  `componentTypeOptions` (fan-out de `componentOptions` × types de chaque nœud) ;
  `handleComponentChange`/`handleTypeChange`/`selectedComponentIndex` remplacés par
  `handleTargetChange`/`selectedComponentTypeIndex`.
- `apps/desktop/src/renderer/components/system/ComponentTypeCombobox.tsx` — nouveau composant
  (combobox filtrable single-select, modelé sur `BranchCombobox.tsx`).
- `apps/desktop/src/renderer/components/sidebar/SystemPanel.tsx` — remplacement des deux
  `<select>` Composant/Élément par `<ComponentTypeCombobox>` ; suppression de
  `renderComponentOptions` (dead code).
- `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` — nouvelles clés
  `sidebar.system.componentElement`/`componentElementPlaceholder` ; clé `sidebar.system.element`
  retirée (devenue inutilisée) ; `sidebar.system.component`/`noComponentConfigured` conservées
  (réutilisées).
- `specs/SPEC-SYSTEM-VIEW.md` — sections "Combobox Composant"/"Combobox Élément" fusionnées en une
  seule section ; tableau "État vide général" mis à jour.
- `specs/SPEC-INDEX.md` — colonne MAJ de la ligne SPEC-SYSTEM-VIEW.md §global → T129.

## Comportement implémenté

Conforme à `specs/T129.md` et `specs/T129-design.md` : un seul combobox filtrable remplace les
deux comboboxes Composant/Élément. Entrées = produit cartésien (`SystemNode` × type), libellé
`chemin composant / type`, groupé par repo uniquement en multi-repo, filtrage substring
insensible à la casse, navigation clavier (flèches/Entrée/Échap) avec défilement automatique de
la ligne surlignée. Un `SystemNode` sans type n'a aucune entrée (invisible depuis ce combobox,
géré via Structure). Format d'URL et restauration de dernière sélection (T52) inchangés.

## Divergences par rapport au design

`specs/T129-design.md` proposait un `ComponentTypeOption.key: string` au format
`` `${repoName}::${nodeId}::${typeId}` ``. La revue de code (`/code-review --effort high`) a
confirmé que ce format est collision-prone : ni les noms de repo ni les noms de `SystemNode`
n'ont de restriction de caractères (`AddDependencyModal.tsx` ne vérifie qu'une valeur non vide),
donc deux triples différents peuvent produire la même clé jointe. Corrigé en repassant à une
identité par **position dans le tableau** `componentTypeOptions` (même principe que l'ancien
`selectedComponentIndex`, dont le commentaire supprimé avertissait déjà explicitement contre ce
risque). `ComponentTypeOption` n'a donc plus de champ `key` ; `SystemViewState` expose
`selectedComponentTypeIndex: number` au lieu d'un `selectedComponentTypeKey: string`.

Le design ne détaillait pas la gestion de l'état "workspace sans aucune entrée" au-delà de
"combobox désactivé + réutilise `noComponentConfigured`" — la revue a montré qu'un `<input
disabled>` ne peut jamais ouvrir son dropdown (donc jamais afficher un message à l'intérieur) ;
implémenté en conséquence comme `placeholder` du champ désactivé plutôt que comme ligne de
dropdown.

## Corrections issues de la revue de code (`/code-review --effort high`)

4 bugs confirmés et corrigés :
1. Clé d'identité `::`-jointe collision-prone → identité par position (cf. Divergences).
2. `onClick` sur le champ ré-ouvrait le dropdown et vidait la recherche en cours à chaque clic à
   l'intérieur (ex. repositionner le curseur en tapant) → le reset ne se fait plus que sur la
   transition fermé→ouvert.
3. État vide global inatteignable (`disabled` empêche l'ouverture) + mauvais message réutilisé
   pour "recherche sans résultat" → placeholder dédié pour l'état vide global, `common.noResults`
   pour la recherche sans résultat.
4. La ligne surlignée au clavier ne défilait jamais dans la vue → `scrollIntoView({block:
   'nearest'})` ajouté.

2 points d'efficacité/dette technique identifiés mais **délibérément non corrigés** dans ce
sprint (périmètre limité aux fichiers du ticket) :
- `componentOptions`/`componentTypeOptions` recalculés sans `useMemo` à chaque render du
  provider — la mémoïsation efficace demanderait de toucher `useWorkspaceStructure.ts` (hook
  partagé, `schemasByRepoPath` y est reconstruit à chaque appel), hors périmètre de ce ticket.
- Le mécanisme clic-extérieur + positionnement par portail est maintenant dupliqué une 4ᵉ fois
  (après `BranchCombobox`/`GitRefCombobox`/`LinkCombobox`) plutôt qu'extrait en hook partagé —
  extraire toucherait plusieurs fichiers sans rapport avec ce ticket.

Ces deux points sont des candidats raisonnables pour un ticket de suivi si l'un ou l'autre
devient sensible en pratique.

## Comment tester manuellement

1. Ouvrir un projet dans la Vue Système (panneau latéral "Système").
2. Vérifier qu'un seul champ "Composant / Élément" apparaît (plus deux comboboxes séparés).
3. Cliquer/focus dessus → liste déroulante avec toutes les entrées (composant + type),
   éventuellement groupées par repo si le workspace en a plusieurs.
4. Taper du texte → la liste se filtre par sous-chaîne insensible à la casse ; taper un texte sans
   correspondance → "Aucun résultat".
5. Flèche bas/haut puis Entrée → sélectionne l'entrée surlignée, referme le dropdown, recharge
   l'arbre/la vue document sur ce composant+type.
6. Cliquer à l'intérieur du champ pendant une recherche en cours (ex. repositionner le curseur) →
   le texte tapé n'est pas effacé.
7. Sur un projet sans aucun type configuré nulle part : le champ est désactivé avec le texte
   "Aucun composant configuré" en placeholder.

Vérifié manuellement via le driver Playwright du skill `run-desktop` (scénarios 2 à 7 ci-dessus
tous passés) ; `tsc --noEmit` sans erreur.
