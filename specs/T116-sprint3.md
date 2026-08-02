# T116 — Sprint 3 : Messages et formulaires

Réf : `specs/T116.md`, `specs/T116-design.md` §4

## Fichiers modifiés

Routes (12) :
- `apps/desktop/src/renderer/routes/preferences.tsx`
- `apps/desktop/src/renderer/routes/query.tsx`
- `apps/desktop/src/renderer/routes/req.new.tsx`
- `apps/desktop/src/renderer/routes/schema.tsx`
- `apps/desktop/src/renderer/routes/test.new.tsx`
- `apps/desktop/src/renderer/routes/workspace.tsx`
- `apps/desktop/src/renderer/routes/baseline.tsx`
- `apps/desktop/src/renderer/routes/campaign.new.tsx`
- `apps/desktop/src/renderer/routes/compliance.tsx`
- `apps/desktop/src/renderer/routes/dashboard.tsx`
- `apps/desktop/src/renderer/routes/index.tsx`
- `apps/desktop/src/renderer/routes/login.tsx`

Modales (6) :
- `apps/desktop/src/renderer/components/schema/AddDependencyModal.tsx`
- `apps/desktop/src/renderer/components/schema/ElementConfigModal.tsx`
- `apps/desktop/src/renderer/components/schema/RemoveDependencyModal.tsx`
- `apps/desktop/src/renderer/components/layout/ConfirmCloseTabModal.tsx`
- `apps/desktop/src/renderer/components/dashboard/WidgetConfigModal.tsx`
- `apps/desktop/src/renderer/components/DiamondConflictModal.tsx`

Panneaux `sidebar/version/*` (5) :
- `apps/desktop/src/renderer/components/sidebar/version/BranchCombobox.tsx`
- `apps/desktop/src/renderer/components/sidebar/version/FileList.tsx`
- `apps/desktop/src/renderer/components/sidebar/version/PinPropagationWarning.tsx`
- `apps/desktop/src/renderer/components/sidebar/version/VersionImpactSelector.tsx`
- `apps/desktop/src/renderer/components/sidebar/version/VersionRepoFolder.tsx`

Champs de formulaire (6) :
- `apps/desktop/src/renderer/components/system/EditView.tsx`
- `apps/desktop/src/renderer/components/system/ExcelView.tsx`
- `apps/desktop/src/renderer/components/system/LinkCombobox.tsx`
- `apps/desktop/src/renderer/components/FilterOptionsToggle.tsx`
- `apps/desktop/src/renderer/components/DynamicField.tsx`
- `apps/desktop/src/renderer/components/schema/objectTypeEditor.tsx` (composants partagés `ConfirmDelete`/`CancelConfirmModal`, réutilisés par plusieurs fichiers ci-dessus)

29 fichiers au total (le lot listé en design §4 en visait ~25 ; l'écart vient des composants partagés `ConfirmDelete`/`CancelConfirmModal` traités une seule fois dans `objectTypeEditor.tsx` plutôt que dupliqués par appelant, et de 2 fichiers `sidebar/version/*` supplémentaires non identifiés dans l'audit initial).

## Comportement implémenté

Les blocs message (erreur/succès/avertissement), les indicateurs interactifs (sélection, focus, lien, onglet actif) et les champs de formulaire des fichiers ci-dessus réutilisent désormais les tokens `status-neutral/info/success/warning/danger` au lieu de classes Tailwind brutes, suivant la table de correspondance de `T116-design.md` §2.3.

**Mappings appliqués** (au-delà de la substitution directe erreur→danger / succès→success / avertissement→warning) :
- Astérisques de champ obligatoire (`text-red-*`) → `status-danger`, uniformisés sur tous les formulaires (`req.new.tsx`, `test.new.tsx`, `campaign.new.tsx`, `EditView.tsx`, `DynamicField.tsx`).
- États actifs de bouton/onglet à fond plein (`bg-blue-600 text-white`) → `bg-status-info-solid text-status-info-fg` (`query.tsx`, `dashboard.tsx`).
- États actifs de bouton/toggle à fond clair (`bg-blue-100 border-blue-300 text-blue-700`) → `bg-status-info-bg border-status-info-border text-status-info` (`schema.tsx`, `WidgetConfigModal.tsx`, `FilterOptionsToggle.tsx`, `ExcelView.tsx`).
- Icônes catégorielles violettes (`text-violet-500`, sens "sous-composant/interface", hors sentiment) → `text-chart-5`, réutilisant la palette catégorielle `chart-series` existante (T77) plutôt qu'un token de statut, conformément à la décision de design §2.1 (`compliance.tsx`, `VersionRepoFolder.tsx`).
- Icônes/boutons "supprimer" à teinte unique sans variante hover dédiée (`text-red-400 hover:text-red-600`) → `text-status-danger hover:opacity-80` (composant partagé `ConfirmDelete`, `schema.tsx`, `ElementConfigModal.tsx`).
- Marqueurs de fichier git (A/M/D) → `status-success`/`status-warning`/`status-danger` respectivement, cohérent avec la sémantique diff déjà tokenisée (`FileList.tsx`, `VersionRepoFolder.tsx`).
- Indicateur "modifications en attente" (point plein ambre) → `bg-status-warning-solid` pour rester visible dans les deux thèmes (`VersionRepoFolder.tsx`).

**Familles figées laissées inchangées** : les overlays de modale (`bg-black/40`, `bg-black/50`) sont hors périmètre — comportement déjà établi en sprint 1/2 (identiques dans les deux thèmes par nature, non retouchés dans les fichiers déjà migrés comme `RequirementEditModal.tsx`).

## Vérifications effectuées

- Grep de conformité restreint aux 29 fichiers du sprint (couleurs Tailwind brutes + `white`/`black`, tous préfixes y compris `outline-`/`accent-`/`shadow-` omis du premier passage puis ajoutés) : 0 résultat restant hors overlays `bg-black/*`.
- `pnpm --filter @polenta/desktop typecheck` : 0 erreur.
- `/code-review` (effort high, 5 angles via subagents) : 1 problème confirmé et corrigé — `DiamondConflictModal.tsx` utilisait `border-status-danger-border` (variante pâle, pensée pour un bloc de message avec fond) comme contour seul d'un champ de saisie invalide, rendant l'indication d'erreur trop peu visible par rapport à l'original `border-red-500` ; corrigé en `border-status-danger` (teinte plus saturée, cohérent avec `.btn-danger` dans `index.css`). Les autres angles n'ont remonté que des observations hors périmètre : duplication de motifs de classes déjà présente avant ce sprint (refactor non demandé par le ticket) et incohérence transitoire avec `StructureTab.tsx` (fichier explicitement prévu en sprint 4 — `text-violet-500` non encore migré vers `text-chart-5` à cet endroit, cf. ci-dessous).
- Diff symétrique (125 insertions / 125 suppressions sur 29 fichiers) : confirme que seules des classes ont été substituées, aucune structure JSX modifiée.

## Divergences par rapport au design

Aucune divergence de fond. Deux ajustements mineurs par rapport à la liste indicative de `T116-design.md` §4 :
- 2 fichiers `sidebar/version/*` supplémentaires (`FileList.tsx`, `PinPropagationWarning.tsx`) contenaient des couleurs brutes non recensées dans l'audit initial — traités dans ce sprint car dans le même dossier que le lot prévu.
- `RequirementEditModal.tsx`/`TestCaseEditModal.tsx` figuraient dans la formulation générique "modales `*Modal.tsx`" du design mais avaient déjà été traités en sprint 2 (statuts + couleurs annexes) — non retouchés ici.

## Incohérence connue, non corrigée (attendue avant sprint 4)

`StructureTab.tsx` (prévu en sprint 4, catégorie "interaction/navigation") utilise encore `text-violet-500` brut pour le même indicateur "sous-composant/interface" (icônes `GitFork` l.251, `ShieldCheck` l.943) que `VersionRepoFolder.tsx` et `compliance.tsx` migrent ici vers `text-chart-5`. Résultat transitoire : ces deux panneaux affichent une teinte violette légèrement différente jusqu'au sprint 4. Comportement attendu d'une migration en plusieurs sprints — à résorber par le grep de conformité final du sprint 4.

## Comment tester manuellement

1. `pnpm --filter @polenta/desktop dev`.
2. Ouvrir successivement : Préférences, Modèle de données (schema), Connexion (login), Écran d'accueil, un Dashboard, la vue Requêtes (query), Baseline, création de campagne/exigence/test (`+`), Conformité interfaces, panneau Version (checkout/commit/push, comparaison de baselines, analyse d'impact).
3. Déclencher une erreur dans chaque écran (ex. champ obligatoire vide, tag de baseline dupliqué, échec de checkout) : le bloc d'erreur doit être rouge (`status-danger`) et cohérent visuellement entre écrans.
4. Dans le panneau Version, modifier un fichier suivi : vérifier que les marqueurs A/M/D (vert/ambre/rouge) et le point "modifications en attente" restent visibles et cohérents en clair et sombre.
5. Ouvrir un des dialogues de suppression (Structure du Modèle de données, RemoveDependencyModal, VersionImpactSelector) : le bouton "Supprimer" doit être rouge plein cohérent avec les boutons de suppression déjà migrés en sprint 2.
6. Basculer clair/sombre sur chacun de ces écrans : aucune zone ne doit rester bloquée sur l'ancienne palette (hors overlays de modale, volontairement figés).

## Suite

Sprint 4 (reste + vérification finale — diff, compliance/impact, interaction/navigation dont `StructureTab.tsx`, dashboard widgets, tiptap, export) peut démarrer. Dernier sprint : exécuter le grep de conformité global (critère d'acceptation 2 de `T116.md`), créer `specs/SPEC-THEMING.md`, mettre à jour `SPEC-INDEX.md`.
