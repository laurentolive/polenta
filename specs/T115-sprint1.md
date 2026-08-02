# T115 — Sprint 1 : fondations CSS + migration primary/secondary/danger

## Fichiers modifiés

- `apps/desktop/src/renderer/index.css` : `.btn-danger` redéfinie en plein
  rouge (`bg-red-600 hover:bg-red-700`) ; ajout de `.btn-primary-sm`,
  `.btn-secondary-sm`, `.btn-danger-sm` (variantes compactes,
  `px-3 py-1.5 text-xs`) ; commentaire clarifié sur `.btn-sm` (préexistante,
  distincte, quand l'utiliser vs `.btn-secondary-sm`).
- 34 fichiers `.tsx` sous `apps/desktop/src/renderer/` : migration des
  `className` de boutons vers les 6 classes partagées, selon le mapping de
  `specs/T115-design.md` §A. Liste complète : `ModificationControl.tsx`,
  `ExportButton.tsx`, `RepoBranchSelector.tsx`, `VersionRepoFolder.tsx`,
  `VersionImpactSelector.tsx`, `baseline.tsx`, `campaign.$campaignId.tsx`,
  `dashboard.tsx`, `query.tsx`, `impact-analysis.tsx`, `preferences.tsx`,
  `schema.tsx`, `index.tsx`, `req.$reqId.tsx`, `AddDependencyModal.tsx`,
  `ElementConfigModal.tsx`, `StructureTab.tsx`, `RemoveDependencyModal.tsx`,
  `objectTypeEditor.tsx`, `ConfirmCloseTabModal.tsx`,
  `RequirementEditModal.tsx`, `TestCaseEditModal.tsx`,
  `WidgetConfigModal.tsx`, `ElementTree.tsx`, `ExcelView.tsx`,
  `ReorderableSidebarSection.tsx`, `SystemPanel.tsx`, `DashboardGrid.tsx`,
  `DiamondConflictModal.tsx`, `DashboardPanel.tsx`.

## Comportement implémenté

- Tous les boutons `primary`/`secondary`/`danger` du renderer utilisent
  désormais l'une des 6 classes partagées (3 couleurs × standard/compact),
  jamais une redéfinition Tailwind inline dupliquant l'une d'elles.
- "Publier" (`ModificationControl.tsx`) utilise `.btn-primary-sm shadow` —
  seul site à garder `shadow`, comme décidé en Design.
- Toute action destructive (suppression, checkout forcé perdant des
  modifications non publiées, fermeture sans enregistrer, marquage
  obsolète…) utilise `.btn-danger`/`.btn-danger-sm` (plein rouge),
  reconnaissable indépendamment du contexte/de la taille.
- Taille standard vs compacte choisie site par site selon le contexte réel
  (`ViewHeader`/popover/ligne dense → compact ; pied de modale/page de
  formulaire → standard), pas mécaniquement par famille de pattern.

## Divergences par rapport au design

Le design (`T115-design.md`) listait les sites par pattern de className
repéré au grep ; l'implémentation a révélé quelques sites que ce grep n'avait
pas capturés, ou mal classés :

- **`preferences.tsx`/`schema.tsx`** ("Annuler"/"Enregistrer") : le design
  les classait "standard" (page de formulaire) ; ce sont en réalité des
  boutons du slot `actions` de `ViewHeader` (contexte compact) — corrigés en
  `.btn-secondary-sm`/`.btn-primary-sm`.
- **`VersionImpactSelector.tsx:182/186`** : le design les classait "compact"
  par analogie avec le reste du fichier ; ce sont en fait les boutons d'une
  modale plein écran classique (`fixed inset-0 bg-black/40`, comme
  `RemoveDependencyModal.tsx`) — corrigés en `.btn-secondary`/`.btn-danger`
  standard.
- **`req.$reqId.tsx:229,242,249`** ("Marquer obsolète" + barre de
  confirmation inline) : site absent du design (le pattern
  `bg-red-600 text-white ... disabled:opacity-50` sans `hover:` n'était pas
  couvert par le grep `bg-red-(5|6)00 hover:bg-red-(6|7)00`, et le style
  outline-red préexistant, identique à l'ancien `.btn-danger`, n'était pas
  non plus dans les listes). Migré en `.btn-danger`/`.btn-secondary`
  standard — la section "Transitions de statut" a de la place et son bouton
  voisin (`nextStatus`, ligne 211) était déjà en taille standard ; cette
  taille corrige une incohérence préexistante plutôt que d'en introduire une.
- **3 sites `btn-secondary text-sm`/`btn-primary text-sm`** non couverts par
  le grep du design (celui-ci cherchait `text-xs`, pas `text-sm`, ce dernier
  étant un no-op visuel mais un override redondant) :
  `DiamondConflictModal.tsx:135,142`, `query.tsx:463,470` (modale
  "Sauvegarder"), `DashboardPanel.tsx:238,245` (modale "Créer un dashboard").
  Nettoyés pour cohérence.

Ces corrections ont été appliquées directement pendant le sprint (sites
manqués par l'inventaire, pas des divergences de décision) — pas d'écart
avec les décisions actées en cadrage humain ou en Design.

## Revue de code

8 angles exécutés (`/code-review medium`). 3 findings retenus après
vérification :
- **Corrigé** : `disabled:opacity-50` laissé redondant sur ~12 sites après
  migration (les classes partagées l'appliquent déjà) — nettoyé.
- **Corrigé** : ambiguïté entre `.btn-sm` (préexistante) et
  `.btn-secondary-sm` (nouvelle) sans règle documentée — commentaire
  `index.css` complété avec la règle de choix et des exemples.
- **Accepté sans changement** : duplication CSS entre chaque paire
  standard/compact (`index.css`) — trade-off documenté en Design (même ratio
  d'échelle sur les 3 couleurs), refactoring en base partagée jugé
  disproportionné pour ce ticket.
- 2 candidats "removed-behavior" ont été réfutés : la perte de `shadow` sur
  `baseline.tsx:479` (décision Design : seul "Publier" le garde) et
  l'agrandissement des boutons de `req.$reqId.tsx` (contextuellement
  correct, cf. Divergences ci-dessus).

## Vérifications effectuées

- `git grep` sur les 2 patterns ad-hoc du design (duplication `.btn-secondary`,
  rouge plein dupliqué) : aucun résultat.
- `git grep` sur les classes `btn-*`/`btn-*-sm` combinées à un override de
  taille (`text-xs`/`text-sm`/`px-*`/`py-*`) : aucun résultat en dehors du
  `shadow` toléré sur "Publier".
- `npm run typecheck` (apps/desktop) : 0 erreur, avant et après le nettoyage
  post-revue.
- Pas de modification de logique métier (`onClick`, mutations, props) — diff
  limité à `index.css` et aux `className`.

## Comment tester manuellement

1. Ouvrir l'app, charger un projet avec des modifications en attente —
   vérifier que "Publier" (`ViewHeader`) est compact avec ombre, boutons
   "Annuler"/"Publier" dans son popover en taille standard.
2. Ouvrir une modale de suppression (ex. panneau Système → supprimer un
   élément) — le bouton "Supprimer" est plein rouge, standard.
3. Ouvrir Version → checkout d'une branche avec modifications non commitées
   — le popover de confirmation a "Annuler"/"Forcer le checkout" en taille
   compacte, "Forcer le checkout" plein rouge.
4. Ouvrir une exigence, section "Transitions de statut" — "Marquer
   obsolète" et son bouton de confirmation sont maintenant à la même taille
   que le bouton de transition normal à côté.
5. Basculer thème clair/sombre sur chacun des écrans ci-dessus — contrastes
   corrects, pas de résidu de l'ancien style outline rouge.

## Suite

Sprint 2 (`T115-design.md`) : `.btn-icon`, `.btn-close`, correction des liens
`text-blue-600` hardcodés. Périmètre inchangé par ce sprint.
