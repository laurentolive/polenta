# T115 — Scénarios de test

## Sprint 1 — CSS (profils standard/compact) + migration §A

### Golden path

1. **`.btn-danger`/`.btn-danger-sm` redéfinies** : ouvrir un bouton de
   suppression en taille standard (ex. `RemoveDependencyModal.tsx`) et un en
   taille compacte (ex. `RepoBranchSelector.tsx` confirmation checkout), en
   thème clair puis sombre. Les deux sont plein rouge (`bg-red-600`), texte
   blanc, hover assombrit (`bg-red-700`) — seule la taille diffère. Aucune
   trace de l'ancien style outline.
2. **"Publier" garde sa taille compacte, mais nommée** : ouvrir une vue avec
   des modifications en attente (`mode === 'active'`), le bouton "Publier"
   dans `ViewHeader` est identique visuellement à avant (compact, ombre),
   mais via la classe `.btn-primary-sm shadow` — comparer avec un autre
   bouton `ViewHeader` compact (ex. "Ajouter un widget" sur `dashboard.tsx`)
   qui doit avoir la même taille de texte/padding, sans l'ombre (propre à
   "Publier" seul).
3. **Boutons standard migrés** : ouvrir une modale de la liste "Standard"
   (ex. `AddDependencyModal.tsx`) — le bouton "Annuler" est visuellement
   identique aux autres `.btn-secondary` standard de l'app (ex.
   `RemoveDependencyModal.tsx`).
4. **Popovers compacts cohérents** : ouvrir le popover d'export
   (`ExportButton`) et le popover d'erreur de publication
   (`ModificationControl`) — les boutons y restent en taille compacte
   (`.btn-secondary-sm`/`.btn-primary-sm`), cohérente entre les deux
   popovers (même padding/taille de texte).
5. **Boutons "Enregistrer" inline dans les listes** (ex.
   `campaign.$campaignId.tsx` édition des champs personnalisés) : le bouton
   reste compact (`.btn-primary-sm`), aligné correctement à côté de
   "Annuler", cohérent avec les autres textes `text-xs` de la même section.
6. **Danger compact reconnaissable** : dans `RepoBranchSelector.tsx`/
   `VersionRepoFolder.tsx`, le bouton de confirmation de checkout (perte de
   modifications non publiées) est bien rouge plein malgré sa taille
   compacte — pas de confusion possible avec le bouton "Annuler" à côté.

### Cas limites

7. Bouton `.btn-danger`/`.btn-danger-sm` `disabled` (ex. suppression en
   cours, `isSaving`/`isPending`) : `opacity-50`, curseur `not-allowed`,
   hover inactif — dans les deux tailles.
8. Bouton `.btn-primary`/`.btn-primary-sm` avec icône + texte (`GitMerge`,
   `Download`…) : l'icône reste verticalement centrée avec le texte
   (`flex items-center gap-*` conservé) dans les deux tailles.
9. `impact-analysis.tsx` (boutons `shrink-0` conservés, taille compacte) :
   les boutons ne se compriment pas de façon illisible dans leur conteneur
   flex.
10. Seul le bouton "Publier" porte `shadow` parmi tous les `.btn-primary-sm`
    de l'app — vérifier qu'aucun autre site n'a hérité de l'ombre par copier-
    coller.

### Vérification automatique (grep, cf. `T115.md` critère 5)

11. `git grep -n "px-4 py-1.5 border border-edge rounded text-ink-2"
    apps/desktop/src/renderer` → aucun résultat.
12. `git grep -nE "bg-red-(5|6)00 hover:bg-red-(6|7)00" apps/desktop/src/renderer`
    → aucun résultat (tout est passé par `.btn-danger`/`.btn-danger-sm`).
13. `git grep -nE "btn-(primary|secondary|danger)(-sm)?" apps/desktop/src/renderer -- '*.tsx' | grep -E "text-xs|text-sm|px-[234]|py-1(\.5)?|py-2"`
    → ne retourne que la ligne du bouton "Publier" (seul override toléré :
    `shadow`).

## Sprint 2 — Familles D

### Golden path

14. **`.btn-icon`** : dans `VersionPanel.tsx`, les 4 boutons d'action
    (icônes) ont un style identique entre eux et à
    `ReorderableSidebarSection.tsx` (bouton "ajouter") — même padding, même
    zone de hover, transition cohérente en thème clair/sombre.
15. **`.btn-close`** : dans `RequirementEditModal.tsx` et
    `TestCaseEditModal.tsx`, le bouton "×" a un rendu identique entre les
    deux modales.
16. **Lien-action** : dans `SystemPanel.tsx` ("Ajouter"/"Créer la première"
    campagne) et `ReorderableSidebarSection.tsx`, le lien utilise
    `text-prim` (plus de bleu hardcodé), reste souligné au survol, lisible
    en thème clair et sombre (contraste suffisant sur `--prim`).

### Cas limites

17. Bouton `.btn-icon` `disabled` (ex. `TestsPanel.tsx`,
    `RequirementsPanel.tsx` — `disabled:opacity-40` déjà existant) : le
    comportement disabled est préservé après migration vers la classe.
18. `baseline.tsx:121` (bouton icône avec hover rouge + opacity conditionnée
    par le survol du parent) : confirmer que ce bouton reste **volontairement
    non migré** (cas spécifique documenté en design) et fonctionne toujours
    comme avant (aucune régression, puisque non touché).

### Vérification automatique

19. `git grep -n "text-blue-600 hover:underline" apps/desktop/src/renderer`
    → aucun résultat.
20. `git grep -n "text-ink-3 hover:text-ink text-lg leading-none px-1"
    apps/desktop/src/renderer` → aucun résultat en dehors de la définition
    de `.btn-close` dans `index.css` (les deux sites l'utilisent désormais
    via la classe).

## Hors périmètre de test (cf. Hors scope `T115.md`)

- Badges de statut (`rounded-full`) : aucun changement attendu, non testés
  ici.
- Éléments de menu déroulant/contextuel et lignes de combobox (§D design,
  familles reportées) : non touchés, non testés dans ce ticket.
- `RichTextToolbar`/contrôles TipTap : non touchés.

## Critères de sortie (dernier sprint)

- Les 20 scénarios ci-dessus passent (vérification manuelle visuelle pour
  les golden paths/cas limites, `git grep` pour les vérifications
  automatiques).
- `npm run typecheck`/lint du renderer sans nouvelle erreur.
- Aucune modification de logique métier (`onClick`, mutations, props) — diff
  limité à `index.css` et aux `className` recensés dans `T115-design.md`.
