# T115 — Design : inventaire et uniformisation du style des boutons

## Révision post-review (amendement `T115.md`)

Le premier jet de ce design proposait de retirer purement et simplement tous
les overrides de taille sur `.btn-primary`/`.btn-secondary`, pour ne garder
qu'une seule taille "standard" partout. Retour humain : les tailles doivent
dépendre du contexte (endroits exigus = boutons plus petits, légitimement),
et les actions à risque de perte de données doivent rester visuellement
distinctes — mais le nombre de profils doit rester limité et cohérent.

Révision : **3 couleurs sémantiques × 2 tailles**, plus les 2 familles hors
couleur déjà prévues en sprint 2 (`.btn-icon`, `.btn-close`). Pas de 3ᵉ
taille, pas de 4ᵉ couleur — la distinction "danger" (couleur) répond au
besoin de visuel différent pour la perte de données, indépendamment de la
taille (déclinée dans les deux tailles pour rester reconnaissable même en
popover compact).

## CSS (`apps/desktop/src/renderer/index.css`)

```css
/* Standard — formulaires, pied de modale, pages avec espace disponible */
.btn-primary {
  @apply bg-prim text-prim-fg rounded px-4 py-2 text-sm font-medium
         hover:opacity-90 active:opacity-80
         disabled:opacity-50 disabled:cursor-not-allowed transition-opacity;
}
.btn-secondary {
  @apply border border-edge rounded px-4 py-2 text-sm text-ink-2
         hover:bg-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors;
}
.btn-danger {
  @apply bg-red-600 text-white rounded px-4 py-2 text-sm font-medium
         hover:bg-red-700 active:bg-red-800
         disabled:opacity-50 disabled:cursor-not-allowed transition-colors;
}

/* Compact — ViewHeader/actions, popovers, actions en ligne dans une liste */
.btn-primary-sm {
  @apply bg-prim text-prim-fg rounded px-3 py-1.5 text-xs font-medium
         hover:opacity-90 active:opacity-80
         disabled:opacity-50 disabled:cursor-not-allowed transition-opacity;
}
.btn-secondary-sm {
  @apply border border-edge rounded px-3 py-1.5 text-xs text-ink-2
         hover:bg-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors;
}
.btn-danger-sm {
  @apply bg-red-600 text-white rounded px-3 py-1.5 text-xs font-medium
         hover:bg-red-700 active:bg-red-800
         disabled:opacity-50 disabled:cursor-not-allowed transition-colors;
}
```

Ratio `standard` → `compact` identique pour les 3 couleurs
(`px-4 py-2 text-sm` → `px-3 py-1.5 text-xs`), pour que la mise à l'échelle
reste perceptiblement cohérente d'une couleur à l'autre. `.btn-sm` (classe
existante, neutre, `px-2 py-1 text-xs`) n'est pas touchée — c'est un
troisième niveau de compacité déjà utilisé pour des contrôles très denses
(`SearchPanel.tsx`, `VersionRepoFolder.tsx`), distinct des profils colorés
ci-dessus, pas de fusion pour éviter de casser ses 4 usages existants.

`shadow` n'est pas intégré à `.btn-primary-sm` : c'était une emphase propre
au bouton "Publier" (CTA le plus important du header), pas une propriété du
profil compact en général. Elle reste ajoutable au cas par cas
(`className="btn-primary-sm shadow"`) — seul "Publier" la garde.

## Règle de choix standard vs compact

- **Compact** (`-sm`) : le bouton vit dans `ViewHeader` (slot `actions`,
  hauteur de barre contrainte `py-2.5`), dans un popover ancré sous un
  déclencheur (largeur fixe type `w-96` ou plus étroit), ou en ligne au
  milieu d'une liste/tableau/section dense où plusieurs autres éléments
  compacts (`text-xs`) l'entourent déjà.
- **Standard** : le bouton vit dans une modale pleine largeur (pied de
  modale avec sa propre respiration), une page de formulaire dédiée, ou tout
  contexte qui n'a pas de contrainte de hauteur/densité particulière.
- En cas de doute (ex. un site dont le contexte exact n'a pas été vérifié
  ligne à ligne dans ce document), l'implémenteur applique cette règle au
  moment du sprint plutôt que de suivre aveuglément le tableau ci-dessous si
  le rendu réel contredit visiblement l'hypothèse prise ici.

## A. Boutons `primary`/`secondary`/`danger` — profil par site

Remplace les tableaux A/B/C de la version précédente : chaque site reçoit
désormais un profil explicite (`.btn-primary`, `.btn-primary-sm`,
`.btn-secondary`, `.btn-secondary-sm`, `.btn-danger`, `.btn-danger-sm`) au
lieu d'un retrait pur et simple de tout override.

### Compact (`-sm`) — contexte `ViewHeader`/popover/ligne dense

| Fichier:ligne | Contexte | Profil cible |
|---|---|---|
| `components/layout/ModificationControl.tsx:233` | Bouton "Publier", `ViewHeader` actions | `.btn-primary-sm shadow` (seul site à garder `shadow`) |
| `components/layout/ModificationControl.tsx:326` | Bouton dans popover d'erreur de publication | `.btn-primary-sm` |
| `components/layout/ModificationControl.tsx:312` | "Fermer" dans le même popover | `.btn-secondary-sm` |
| `routes/baseline.tsx:479` | Action `ViewHeader` | `.btn-primary-sm` |
| `routes/campaign.$campaignId.tsx:324,406,580,607` | Confirmer une édition inline dans une section dense | `.btn-primary-sm` (4 sites) |
| `routes/dashboard.tsx:225` | "Ajouter un widget", `ViewHeader` actions | `.btn-primary-sm` |
| `routes/query.tsx:301` | Action `ViewHeader` | `.btn-primary-sm` |
| `routes/query.tsx:309` | Action `ViewHeader` | `.btn-secondary-sm` |
| `routes/impact-analysis.tsx:500` | Action `ViewHeader` (`shrink-0` conservé) | `.btn-primary-sm` |
| `routes/impact-analysis.tsx:474` | Action `ViewHeader` (`shrink-0` conservé) | `.btn-secondary-sm` |
| `components/export/ExportButton.tsx:67` | Déclencheur "Exporter", `ViewHeader` actions | `.btn-secondary-sm` |
| `components/export/ExportButton.tsx:109,125,128,131` | Boutons dans le popover de formats/résultat | `.btn-secondary-sm` (4 sites) |
| `components/schema/RepoBranchSelector.tsx:91` | "Annuler" dans popover de confirmation checkout | `.btn-secondary-sm` |
| `components/schema/RepoBranchSelector.tsx:97` | Confirmer le checkout (état non sauvegardé perdu) | `.btn-danger-sm` |
| `components/sidebar/version/VersionRepoFolder.tsx:372` | "Annuler" dans popover de confirmation checkout | `.btn-secondary-sm` |
| `components/sidebar/version/VersionRepoFolder.tsx:378` | Confirmer le checkout | `.btn-danger-sm` |
| `components/sidebar/version/VersionImpactSelector.tsx:182` | Sélecteur compact multi-niveaux (contexte déjà dense, cf. lignes 44/60/69 en `text-xs`) | `.btn-secondary-sm` |
| `components/sidebar/version/VersionImpactSelector.tsx:186` | Idem, action destructive dans le même sélecteur | `.btn-danger-sm` |

### Standard — modale pleine largeur / page de formulaire

| Fichier:ligne | Contexte | Profil cible |
|---|---|---|
| `components/schema/AddDependencyModal.tsx:145,148` | Pied de modale | `.btn-secondary` / `.btn-primary` |
| `components/schema/ElementConfigModal.tsx:129,132` | Pied de modale | `.btn-secondary` / `.btn-primary` |
| `components/schema/StructureTab.tsx:462,465` | Pied de modale | `.btn-secondary` / `.btn-primary` |
| `components/schema/RemoveDependencyModal.tsx:38,45` | Pied de modale | `.btn-secondary` / `.btn-danger` |
| `components/schema/objectTypeEditor.tsx:159,163,184,188` | Pied de modale (2 paires) | `.btn-secondary` / `.btn-danger` |
| `components/layout/ConfirmCloseTabModal.tsx:29,33` | Pied de modale | `.btn-secondary` / `.btn-danger` |
| `components/impact/RequirementEditModal.tsx:99` | Pied de modale | `.btn-secondary` |
| `components/impact/TestCaseEditModal.tsx:116` | Pied de modale | `.btn-secondary` |
| `routes/baseline.tsx:274,321,329` | Pied de dialogue création baseline | `.btn-secondary` (×2) / `.btn-danger` |
| `routes/preferences.tsx:127` | Page de formulaire | `.btn-primary` |
| `routes/schema.tsx:480` | Page de formulaire | `.btn-primary` |
| `routes/index.tsx:140,162,184` | Page d'accueil, cartes d'action | `.btn-secondary` (×3) |
| `routes/req.$reqId.tsx:249` | Page dédiée | `.btn-secondary` |
| `components/dashboard/WidgetConfigModal.tsx:221` | Pied de modale | `.btn-primary` |
| `components/system/ElementTree.tsx:802,806` | Confirmation inline (pas dans un popover étroit) | `.btn-secondary` / `.btn-danger` |
| `components/system/ExcelView.tsx:1086,1090` | Confirmation inline | `.btn-secondary` / `.btn-danger` |
| `components/schema/RepoBranchSelector.tsx` (autres sites hors popover) | — | n/a, déjà couvert ci-dessus |
| `routes/campaign.$campaignId.tsx:694` | Modale de confirmation pleine largeur | `.btn-danger` |
| `components/sidebar/ReorderableSidebarSection.tsx:251` | Modale de confirmation | `.btn-danger` |
| `components/sidebar/SystemPanel.tsx:272` | Modale de confirmation | `.btn-danger` |
| `components/dashboard/DashboardGrid.tsx:216` | Modale de confirmation | `.btn-danger` |

Ce tableau remplace entièrement les listes A/B/C de la version précédente du
design (mêmes sites, profil précisé au lieu d'un simple retrait
d'override).

## D. Familles reportées hors de ce ticket (inchangé)

Décisions inchangées par cet amendement (aucun rapport avec la taille
contextuelle) :

- **Icône seule** (~8 sites) → sprint 2, nouvelle classe `.btn-icon`.
- **Lien-action** (3 sites, `text-blue-600`) → sprint 2, remplacement
  ponctuel par `text-prim`.
- **Bouton de fermeture "×"** (2 sites) → sprint 2, nouvelle classe
  `.btn-close`.
- **Éléments de menu déroulant/contextuel et lignes de combobox** (~25-30
  sites) → explicitement hors scope de T115, non traité (cf. version
  précédente de ce document pour le détail).

```css
.btn-icon {
  @apply p-1 rounded hover:bg-hover disabled:opacity-40
         disabled:cursor-not-allowed transition-colors;
}
.btn-close {
  @apply text-ink-3 hover:text-ink text-lg leading-none px-1;
}
```

`.btn-icon` ne fixe pas de couleur de texte par défaut (les appelants
gardent `text-ink-3 hover:text-ink` ou `text-prim` en plus de `btn-icon`) —
inchangé, cf. justification dans la version précédente. `baseline.tsx:121`
reste volontairement non migré (hover rouge + opacity conditionnée par le
survol du parent, cas réellement spécifique).

## Découpage en sprints

**Sprint 1 — Fondations CSS + profils primary/secondary/danger (§A)**
- Ajouter les 6 classes (`.btn-primary`/`.btn-secondary`/`.btn-danger` déjà
  existantes mais `.btn-danger` redéfinie, + les 3 nouvelles `-sm`) dans
  `index.css`.
- Appliquer le profil de chaque site listé en §A (~40 sites, tableaux
  compact + standard).
- Critères d'acceptation `T115.md` couverts : 1, 2, 3, 4 (adapté aux
  profils), 5 (grep adapté aux nouveaux patterns), 6, 7.

**Sprint 2 — Familles secondaires (§D)**
- Ajouter `.btn-icon` et `.btn-close`.
- Migrer les ~8 sites icône seule, les 2 sites `×`, corriger les 3 liens
  bleus.
- Critères d'acceptation `T115.md` couverts : 6, 8, complète 5 et 7.

Pas de dépendance inverse entre les deux sprints.

## Vérification automatique (remplace celle de la version précédente)

- `git grep -nE "btn-(primary|secondary|danger)(-sm)?" apps/desktop/src/renderer -- '*.tsx' | grep -E "text-xs|text-sm|px-[234]|py-1(\.5)?|py-2"`
  ne doit plus retourner aucun site où le profil ET un override de taille
  coexistent (seul `shadow` reste toléré, uniquement sur le site "Publier").
- Les grep de la version précédente (patterns ad-hoc dupliqués B/C) restent
  valables tels quels pour vérifier qu'aucune redéfinition inline ne
  subsiste.
