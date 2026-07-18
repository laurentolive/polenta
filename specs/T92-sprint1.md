# T92 — Sprint 1 : fondations `ViewHeader` + `ModificationControl` ancré

## Fichiers modifiés

- `components/layout/ViewHeader.tsx` (nouveau) — barre de titre partagée (`back`/`title`/
  `subtitle`/`actions` + slot Publier toujours monté quand `currentProjectId` est fourni).
- `components/layout/ModificationControl.tsx` — conteneur racine `fixed top-3 right-4
  z-30` → `relative flex items-center gap-2 shrink-0` ; `Overlay` (plein écran centré)
  remplacé par `PublishPopover` (ancré `absolute right-0 top-full`, click-away + Échap) ;
  bandeaux non modaux (push error, pin warning) déplacés dans un stack `absolute`
  sous le bouton.
- `components/layout/AppLayout.tsx` — retrait du montage global de `ModificationControl`.
- `contexts/SystemViewContext.tsx` — `currentProjectId` ajouté à `SystemViewState`.
- `components/system/SystemView.tsx` — toolbar compacte migrée vers `ViewHeader`
  (`title`/`back`/`actions`), comportement de chaque bouton inchangé.
- `routes/graph.tsx` — en-tête migré vers `ViewHeader` (`title`/`subtitle` = branche) ;
  `PinPropagationWarning` reste hors `ViewHeader`, affiché sous la barre uniquement
  quand non vide.

## Comportement implémenté

Conforme à `specs/T92-design.md` §2.1/2.2/2.3/2.4/2.5/2.6. Le bouton Publier est
maintenant rendu dans le flux de la barre de titre de Système et Version (au lieu de
`fixed` par-dessus le contenu), et ses popups sont ancrés sous le bouton au lieu d'un
overlay plein écran centré.

## Divergence par rapport au design

- **Bug trouvé et corrigé pendant la review** : le panneau de `PublishPopover` utilisait
  initialement `w-full max-w-md`. Sur un élément `absolute`, `w-full` (100%) se résout
  par rapport à son ancêtre positionné le plus proche — ici le petit conteneur du
  bouton (`relative`, largeur "shrink-to-fit" ~100-150px), pas le viewport comme
  auparavant (`Overlay` était dans un `fixed inset-0` plein écran). Le popup se serait
  donc affiché écrasé à la largeur du bouton. Corrigé en largeur fixe `w-96` (384px) au
  lieu de `w-full max-w-md`.
- Non prévu dans le design : `Escape` fermait déjà uniquement le popup de saisie du
  titre avant ce ticket (via l'input), jamais le popup d'erreur/conflit (`Overlay` n'avait
  aucun handler de fermeture au clic ni au clavier). `PublishPopover` ajoute Échap +
  clic-en-dehors aux deux popups uniformément — une amélioration, pas une parité stricte
  avec l'existant (corrige une incohérence relevée en implémentant, cf. `T92-tests.md`
  T92-11).

## Vérifications effectuées

- `pnpm install` (nécessaire — le worktree T92 n'a pas de `node_modules`).
- `turbo typecheck --filter=@polenta/desktop` : 0 erreur.
- Pas de script `lint` sur `@polenta/desktop` (confirmé via `turbo lint` — 0 tâche).
- Revue de code manuelle (diff scan ligne à ligne, audit du comportement retiré,
  traçage cross-fichier) : 1 bug trouvé et corrigé (largeur du popover, ci-dessus).
  Aucun autre problème identifié.

## Comment tester manuellement

1. Ouvrir un projet, aller sur la vue Système (`/product`) avec une modification en
   attente sur la branche d'intégration.
2. Vérifier que le bouton "Publier" apparaît en haut à droite de la barre de titre, sans
   chevaucher la toolbar (sélecteur Excel/Word, undo/redo, richtext).
3. Cliquer "Publier" — vérifier que le popup de saisie s'affiche ancré sous le bouton, à
   ~384px de large, sans assombrir le reste de l'écran.
4. Appuyer sur Échap ou cliquer en dehors — le popup se ferme.
5. Aller sur la vue Version (`/graph`) — vérifier le bouton au même endroit visuel, le
   nom de branche affiché en sous-titre sous "Arbre de versions".
