# T115 — Sprint 2 (dernier) : icône seule, fermeture, liens hardcodés

## Fichiers modifiés

- `apps/desktop/src/renderer/index.css` : ajout de `.btn-icon` et
  `.btn-close`.
- `components/sidebar/VersionPanel.tsx` (4 boutons icône), `TestsPanel.tsx`,
  `RequirementsPanel.tsx`, `ReorderableSidebarSection.tsx` (icône + lien) →
  `.btn-icon`.
- `components/impact/RequirementEditModal.tsx`,
  `components/impact/TestCaseEditModal.tsx` → `.btn-close`.
- `components/sidebar/SystemPanel.tsx`, `components/system/CampaignListView.tsx`
  → lien `text-blue-600 hover:underline` remplacé par `text-prim
  hover:underline`.

## Comportement implémenté

- Tous les boutons icône seule identifiés en Design (VersionPanel ×4,
  TestsPanel, RequirementsPanel, ReorderableSidebarSection) utilisent
  `.btn-icon`, avec la couleur de texte (`text-prim` pour les actions
  "ajouter"/navigation, `text-ink-3 hover:text-ink` pour les actions
  neutres) ajoutée par l'appelant, comme prévu en Design.
- Les 2 boutons de fermeture "×" de modale utilisent `.btn-close`.
- Les 3 liens-action hardcodés en bleu utilisent désormais le token
  `text-prim` du thème.

## Divergences par rapport au design

- **`components/sidebar/version/VersionImpactSelector.tsx:247`** : un
  second site au pattern identique à `baseline.tsx:121` (icône avec
  `hover:text-red-500` + opacité conditionnée par `group-hover`/`isActive`)
  a été repéré pendant la vérification par grep — non listé dans le design
  (seul `baseline.tsx:121` y figurait). Même traitement : **volontairement
  non migré** vers `.btn-icon`, pour la même raison (état conditionnel
  spécifique, pas une simple variante de couleur statique).
- Aucune autre divergence — le reste correspond exactement au périmètre
  `T115-design.md` §D.

## Mises à jour SPEC effectuées

- `specs/SPEC-ELECTRON-DESKTOP.md` : nouvelle section **§19.14 Système de
  classes de boutons**, documentant les 3 couleurs × 2 tailles,
  `.btn-icon`/`.btn-close`/`.btn-sm` et la règle de choix standard/compact.
  Insérée après §19.13 (qui référence déjà `ViewHeader`/`ModificationControl`
  /`ExportButton` mais ne documentait pas leur style CSS).
- `specs/SPEC-INDEX.md` : nouvelle ligne pour §19.14 (mots-clés bouton,
  btn-primary/secondary/danger/icon/close/sm, compact, standard, MAJ → T115).

## Revue de code

Diff sprint 2 petit et mécanique (9 fichiers, ~13 sites) — revue directe
plutôt que le pipeline à 8 agents du sprint 1 (proportionné à l'ampleur).
Vérifié : définitions CSS cohérentes avec le design, tous les `onClick`/
`disabled`/`title` préservés, aucune classe dupliquée avec un override de
taille résiduel, aucune régression sur les sites déjà migrés en sprint 1.
Aucun problème trouvé.

## Vérifications effectuées

- `git grep "text-blue-600 hover:underline"` : aucun résultat.
- `git grep` sur le pattern du bouton "×" ad-hoc : aucun résultat en dehors
  de la définition `.btn-close` dans `index.css`.
- `git grep` sur `p-1 rounded (text-prim|text-ink-3)...hover:` : ne
  retourne plus que les 2 sites volontairement exclus (`baseline.tsx:121`,
  `VersionImpactSelector.tsx:247`).
- `npm run typecheck` (apps/desktop) : 0 erreur.
- Pas de modification de logique métier — diff limité à `index.css` et aux
  `className`.

## Comment tester manuellement

1. Panneau Version (sidebar) : les 4 boutons icône (Baselines, Arbre de
   versions, Comparer, Analyse d'impact) ont un style identique
   (padding/hover), clair et sombre.
2. Panneaux Exigences/Tests : bouton "+" (nouveau) — hover, `disabled`
   quand aucun repo n'est chargé.
3. Ouvrir une exigence ou un test en édition (modale) — le bouton "×" en
   haut à droite ferme la modale, même rendu dans les deux modales.
4. Système → Campagnes, avec 0 campagne : le lien "Créer la première" est
   en couleur du thème (`--prim`), plus en bleu, souligné au survol —
   clair et sombre.
5. `baseline.tsx` et le sélecteur d'impact de version : les boutons de
   suppression au survol (icône qui devient rouge) fonctionnent toujours
   à l'identique (non touchés par ce sprint).

## Bilan T115 (fin du ticket)

- Sprint 1 : 6 profils de boutons colorés (primary/secondary/danger ×
  standard/compact), migration de ~50 sites.
- Sprint 2 : `.btn-icon`, `.btn-close`, 3 liens hardcodés corrigés.
- Familles explicitement hors scope (actées en Design, non traitées) :
  éléments de menu déroulant/contextuel à action discrète et lignes de
  sélection de combobox/liste (~25-30 sites hétérogènes) — à considérer
  comme ticket de suivi séparé si souhaité.
