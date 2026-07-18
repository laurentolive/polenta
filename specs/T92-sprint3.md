# T92 — Sprint 3 (final) : panneaux latéraux + documentation SPEC

## Fichiers modifiés

- `components/sidebar/SystemPanel.tsx` — ajout d'un en-tête `section-label` "Système"
  (`px-4 py-3 border-b border-edge`), avant la barre de filtre/comboboxes existante.
- `components/sidebar/DashboardPanel.tsx` — ajout d'un en-tête `section-label` "Suivi",
  au-dessus des sections "Dashboards"/"Requêtes" (qui gardent leur propre en-tête via
  `ReorderableSidebarSection`, inchangé).
- `components/sidebar/SearchPanel.tsx` — padding de l'en-tête `px-3 py-2` → `px-4 py-3`,
  aligné sur tous les autres panneaux. Contenu (barre de recherche/options) inchangé.
- `specs/SPEC-ELECTRON-DESKTOP.md` — nouvelle section §19.13 documentant `ViewHeader`
  (slots, position du bouton Publier, ancrage des popups de `ModificationControl`) et la
  convention `.section-label` généralisée des panneaux latéraux.
- `specs/SPEC-INDEX.md` — nouvelle ligne d'index pointant vers §19.13 (mots-clés :
  ViewHeader, titre de vue, Publier, ModificationControl, popover, section-label…).

## Comportement implémenté

Conforme à `specs/T92-design.md` §2.8 et à la clause "sprint final" (mise à jour SPEC).
`ProjectPanel`, `VersionPanel`, `RequirementsPanel`, `TestsPanel`, `AccountPanel` déjà
conformes — non modifiés.

## Divergence par rapport au design

Aucune.

## Vérifications effectuées

- `turbo typecheck --filter=@polenta/desktop` : 0 erreur.
- Revue de code manuelle du diff (3 fichiers .tsx, changements minimes et localisés) :
  aucun problème identifié.

## Comment tester manuellement

1. Ouvrir le panneau "Système" (icône `Layers`) — vérifier l'en-tête "SYSTÈME" au-dessus
   du combobox composant/élément.
2. Ouvrir le panneau "Suivi" (icône `LayoutDashboard`) — vérifier l'en-tête "SUIVI"
   au-dessus des sections Dashboards/Requêtes.
3. Ouvrir le panneau "Recherche" — vérifier que le padding de l'en-tête correspond
   visuellement à celui des autres panneaux (Projet, Version…).

---

## Résumé global du ticket (3 sprints)

- **Sprint 1** : `ViewHeader` (nouveau composant), `ModificationControl` ancré (plus de
  `fixed`, popups en popover sous le bouton au lieu de plein écran), retrait du montage
  global dans `AppLayout`, migration pilote de Système + Version. 1 bug trouvé et corrigé
  en review (largeur du popover).
- **Sprint 2** : 16 vues restantes migrées vers `ViewHeader` (17 fichiers), `RichTextToolbar`
  repositionnée de façon cohérente sur les 6 vues qui l'utilisent. 1 bug trouvé et corrigé
  en review (duplication de JSX). `version-diff.tsx` volontairement non migrée (pas de
  titre de vue "premier niveau" dans cette route — écart documenté).
- **Sprint 3** : en-têtes manquants ajoutés à `SystemPanel`/`DashboardPanel`, padding de
  `SearchPanel` aligné, documentation SPEC-ELECTRON-DESKTOP.md §19.13 + SPEC-INDEX.md.

`turbo typecheck --filter=@polenta/desktop` : 0 erreur sur l'ensemble des 3 sprints.
Pas de script `lint` disponible sur ce package. Aucun test automatique existant pour ce
périmètre (UI/layout) — non exécuté.

**Non testé interactivement** (pas d'Electron attachable dans cette session) — attend
validation manuelle humaine avant archivage/merge, conformément à la demande de
l'utilisateur ("lance tous les sprints, je ferai une vérif globale").

---

## Correctif post-vérification : marge globale retirée (bord-à-bord partout)

**Retour utilisateur après vérification manuelle** : certaines vues (Projet/Modèle de
données, Recherche, Arbre de version, Baselines, Suivi, Requêtes) affichaient encore une
marge autour de `ViewHeader`, contrairement à la vue Système qui est bord-à-bord — pas la
densité d'affichage voulue.

**Root cause** : `AppLayout.tsx` appliquait `px-8 py-6` sur `<main>`, insérant toutes les
vues dans cette marge. Seule la vue Système y échappait via un hack `-mx-8 -my-6` dans
`product.tsx`/`components.tsx` (marge négative compensant celle de `main`) — jamais
généralisé aux autres vues lors des Sprints 1-2.

**Correctif** :
- `AppLayout.tsx` : `<main className="flex-1 overflow-auto px-8 py-6">` →
  `<main className="flex-1 overflow-auto">` — plus aucune marge globale.
- `product.tsx` / `components.tsx` : hack `-mx-8 -my-6 h-[calc(100%_+_3rem)]` devenu inutile
  (il n'y a plus rien à compenser) → simplifié en `h-full overflow-hidden`.
- **14 vues** qui n'étaient pas déjà en `flex flex-col h-full overflow-hidden`
  (`requirements.tsx`, `tests.tsx`, `dashboard.tsx`, `query.tsx`, `schema.tsx`,
  `req.new.tsx`, `req.$reqId.tsx`, `test.new.tsx`, `test.$testId.tsx`,
  `campaign.$campaignId.tsx`, `campaign.new.tsx`, `campaign.$campaignId.run.$testId.tsx`,
  `compliance.tsx`, `account.tsx`) restructurées sur le même schéma que Système/Version/
  Baselines : `<ViewHeader>` bord-à-bord en premier enfant, puis
  `<div className="flex-1 overflow-y-auto"><div className="max-w-Nxl p-6">…contenu…</div></div>`
  — le titre occupe toute la largeur, le contenu garde sa largeur de lecture confortable
  (`max-w-*`) mais avec son propre padding au lieu d'hériter de celui de `main`.
- Les vues déjà `flex flex-col h-full overflow-hidden` (`graph.tsx`, `baseline.tsx`,
  `diff.tsx`, `campaign.$campaignId.execute.$testId.tsx`, `version-diff.tsx`) n'ont pas eu
  besoin de restructuration — elles sont devenues bord-à-bord automatiquement dès le
  retrait de la marge de `main`, leur contenu ayant déjà son propre padding interne.
- **Régressions corrigées en review** : plusieurs états de chargement/erreur en retour
  anticipé (`if (isLoading) return <p>…`) n'avaient pas leur propre padding — invisibles
  tant que `main` fournissait une marge globale, ils se seraient retrouvés collés au bord
  une fois celle-ci retirée. Corrigés avec `p-4` : `account.tsx`, `req.$reqId.tsx`,
  `test.$testId.tsx`, `schema.tsx` (état "Chargement du schéma…"). `index.tsx` (page
  d'accueil, pas de `ViewHeader`) a reçu un `p-8` direct pour compenser la marge perdue.

**Hors scope / laissé en l'état** : `routes/workspace.tsx` (page de redirection legacy,
retirée depuis T70, message d'erreur qui ne s'affiche que dans un cas limite rare — pas
retouchée pour ne pas gonfler le diff d'un fichier déjà marqué obsolète dans son propre
commentaire d'en-tête).

**Vérification** : `tsc --noEmit -p tsconfig.json` direct (hors cache turbo, pour être sûr
qu'aucune modification récente n'était masquée par un cache stale) : 0 erreur. Revue de
code manuelle de la structure JSX (nesting des `<div>` bord-à-bord/scroll/padding) sur
tous les fichiers restructurés.

**Comment tester manuellement** : ouvrir successivement Système, Projet (Modèle de
données), Version (Arbre + Baselines), Suivi, Requêtes, Exigences, Tests — vérifier que
`ViewHeader` touche les bords (sidebar à gauche, bord de fenêtre à droite/haut) sur
toutes, sans marge visible différente de la vue Système.

---

## Correctif post-vérification 2 : fusion des sous-titres dupliqués (Édition, Version)

**Retour utilisateur** : la vue d'édition (Système, mode Édition) affichait un second
bandeau sous `ViewHeader` — le propre en-tête d'`EditView` (bouton retour + libellé du
type + id) — faisant doublon avec le titre déjà affiché par `ViewHeader` (composant /
type). Demande : supprimer ce bandeau, et compléter le titre de `ViewHeader` avec le
retour et l'id à la place. Idem sur l'Arbre de versions : le sous-titre (nom de branche)
peut être supprimé et intégré directement dans le titre.

**`components/system/EditView.tsx`** : le bouton "← Retour" faisait `onFlushValues(valeurs
locales) puis onBack()` — impossible à dupliquer telle quelle dans `ViewHeader` sans accès
à l'état local (`localValuesRef`) d'`EditView`. Solution : `EditView` passe en
`forwardRef<EditViewHandle, EditViewProps>`, expose `{ triggerBack }` via
`useImperativeHandle` (appelle exactement le même `handleBack` qu'avant — flush puis
`onBack`). Le bandeau d'en-tête interne (`shrink-0 flex items-center gap-3 px-4 py-2.5
border-b border-edge bg-surface`) est retiré ; l'appui sur Échap (raccourci existant, géré
en interne) déclenche toujours la même séquence.

**`components/system/SystemView.tsx`** : `editViewRef` (nouveau, `useRef<EditViewHandle>`)
passé à `<EditView ref={editViewRef}>`. `ViewHeader` du haut :
- `back` : en mode édition, toujours affiché, `onClick={() => editViewRef.current?.triggerBack()}`
  (avant : cette action n'existait qu'au niveau du bouton propre à `EditView`, et le
  `back` de `ViewHeader` était explicitement masqué en mode édition).
- `title` : ajoute l'id de l'objet en cours d'édition (`objectData?.id`, badge
  `font-mono`) à la suite du libellé composant/type déjà affiché — rien n'est ajouté pour
  un nouvel objet pas encore enregistré (`objectData` alors `null`), comme avant.

**`routes/graph.tsx`** : le `subtitle` (nom de branche sous le titre) est retiré ; le nom
de branche (`⎇ nom-de-branche`) est intégré dans le `title` lui-même, à la suite d'"Arbre
de versions — repo", en badge `font-mono` comme l'id ci-dessus.

**Vérification** : `tsc --noEmit -p tsconfig.json` direct : 0 erreur. Revue de code :
confirmé qu'aucun autre composant n'instancie `EditView` (seul `SystemView.tsx`), donc le
changement de signature (`forwardRef`) ne casse aucun autre appelant ; confirmé que
`triggerBack` reproduit exactement l'ancienne séquence flush-puis-navigation.

**Comment tester manuellement** :
1. Système → double-cliquer un élément dans l'arbre pour l'éditer. Vérifier : un seul
   bandeau de titre (plus de bandeau dupliqué), avec bouton "Retour" et l'id de
   l'élément affichés dans ce bandeau unique. Modifier un champ sans le quitter (blur),
   cliquer "Retour" → la modification est bien sauvegardée (flush) avant la navigation.
2. Version (Arbre) → vérifier que le nom de branche apparaît directement dans le titre
   ("Arbre de versions — repo　⎇ branche"), plus de ligne séparée en dessous.
