# SPEC-THEMING — Système de tokens de thème (clair/sombre)

> Référence parent : [SPEC.md](../SPEC.md) §2
> Introduit par T116 (sprints 1–4)

---

## 1. Vue d'ensemble

`apps/desktop/src/renderer/theme.config.ts` est la **source unique** de toutes les
couleurs de l'application desktop, pour les deux thèmes clair/sombre. Aucune couleur
Tailwind brute (`slate-`, `red-`, `blue-`, `green-`, `amber-`, `white`, `black`...) ne
doit apparaître dans `apps/desktop/src/renderer/**/*.tsx` — toute couleur passe par un
**token sémantique**, exposé comme classe Tailwind générée.

Avant T116, les couleurs vivaient dans deux sources semi-dupliquées éditées à la main
(`index.css` + `tailwind.config.js`), sans token pour erreur/succès/avertissement/lien
— d'où un recours systématique à la palette Tailwind brute (69 fichiers sur 117 lors de
l'audit initial).

## 2. Architecture

```
theme.config.ts                    (source unique — édité à la main)
  │
  ├─ scripts/generate-theme-css.ts (pnpm --filter @polenta/desktop theme:generate)
  │
  ├──▶ index.css                   (généré — bloc THEME:GENERATED:START/END)
  │      variables CSS --token: R G B, :root (clair) + .dark (sombre)
  │
  └──▶ tailwind.theme.generated.js (généré)
         theme.extend.colors, classes rgb(var(--token) / <alpha-value>)
```

**Ne jamais éditer `index.css` (bloc généré) ni `tailwind.theme.generated.js` à la
main** — toujours modifier `theme.config.ts` puis relancer :

```
pnpm --filter @polenta/desktop theme:generate
```

Chaque valeur de token est un triplet RGB séparé par des espaces (`"R G B"`, sans
virgules ni `rgb()`), ce qui permet à la fois de l'utiliser en variable CSS brute et
via `rgb(var(--token) / <alpha-value>)` côté Tailwind — les classes générées supportent
donc les modificateurs d'opacité Tailwind (`/30`, `/50`...). Une valeur identique dans
les deux thèmes n'est déclarée qu'une fois dans `:root` (familles figées).

## 3. Familles de tokens

### 3.1 Neutres

`canvas`, `surface`, `surface-hover` (classe `hover`), `folder-row`, `row-hover`,
`edge`, `edge-subtle`, `ink`/`ink-2`/`ink-3`, `prim`/`prim-fg` — fond, texte, bordures
et accent principal de l'application. Repris tels quels de l'architecture pré-T116.

### 3.2 Sentiments (T116) — `status-*`

5 sentiments (`neutral`, `info`, `success`, `warning`, `danger`) × 5 variantes chacun,
seul jeu de tokens couvrant à la fois les 4 systèmes de statuts métier (exigence, test,
campagne, exécution de test), les messages (erreur/succès/avertissement) et les
indicateurs d'interaction/diff — un token par sentiment plutôt qu'un token par statut
métier, pour éliminer la duplication constatée à l'audit (4 systèmes de statuts
quasi identiques réimplémentés indépendamment).

| Variante | Classe | Usage |
|---|---|---|
| `status-{s}` | `text-status-{s}` | texte/icône (badges, liens d'état, messages) |
| `status-{s}-bg` | `bg-status-{s}-bg` | fond léger (bloc de message, badge) |
| `status-{s}-border` | `border-status-{s}-border` | bordure d'un bloc à fond léger |
| `status-{s}-solid` | `bg-status-{s}-solid` | fond plein (bouton d'action) |
| `status-{s}-fg` | `text-status-{s}-fg` | texte sur fond plein (toujours blanc) |

**Bordure autonome (sans fond)** — ex. un champ de saisie invalide, un contour de
sélection sur `bg-surface` : utiliser `border-status-{s}` (variante texte, plus saturée)
plutôt que `border-status-{s}-border` (variante pâle, pensée pour accompagner
`status-{s}-bg`, insuffisamment visible seule — cf. `DiamondConflictModal.tsx`,
corrigé en revue sprint 4).

**Harmonisations décidées** (résolvent des incohérences visuelles pré-existantes,
valeurs préservées à l'identique sauf ces cas) :
- `SKIP` (jaune) et `BLOCKED` (orange) des statuts d'exécution de test → `status-warning`
  (même sémantique "à traiter/en attente", libellés textuels restant distincts).
- Statut `review` d'exigence : `status-warning` (ambre) partout — `WordView.tsx`
  utilisait `blue-*` seul, désormais aligné sur les autres écrans.
- `status-warning-solid` utilise `amber-700` (pas `amber-600`) : `amber-600` + texte
  blanc est sous le seuil de contraste WCAG AA (4.5:1).

### 3.3 Catégoriel — `chart-1..8`

Palette catégorielle des widgets dashboard (T77), réutilisée par T116 pour toute
couleur **catégorielle hors sentiment** (distinguer des catégories sans hiérarchie de
gravité) plutôt que d'introduire de nouveaux tokens dédiés :

| Usage | Token |
|---|---|
| Sous-composant / interface (icônes `GitFork`/`ShieldCheck`) | `chart-5` |
| Type "exigence" (icône/badge catégoriel dans l'arbre, recherche) | `chart-1` |
| Type "test" (idem) | `chart-2` |
| Type "campagne" (idem — distinct de `chart-5` pour ne pas se confondre avec le marqueur sous-composant/interface dans le même arbre) | `chart-7` |

Classe Tailwind : `text-chart-N` / `bg-chart-N` (variable CSS sous-jacente :
`--chart-series-N`, nom historique conservé depuis T77).

### 3.4 Familles figées

Valeurs identiques dans les deux thèmes — n'écoutent pas la bascule clair/sombre :

- **`activity-*`** (`bg`, `border`, `fg`, `fg-hover`, `bg-active`, `fg-disabled`) —
  `ActivityBar.tsx` reste volontairement sombre (`slate-900`) quel que soit le thème.
- **`print-*`** (`bg`, `ink`, `ink-2`, `border`) — vues d'impression/export
  (`print.*.tsx`) toujours en rendu clair fixe, indépendamment du thème actif.
- **`overlay`** (noir fixe, `0 0 0`) — assombrissement neutre, opacité portée par le
  modificateur Tailwind au point d'usage (`bg-overlay/10`, `/40`, `/50`...) plutôt que
  par une variante de token dédiée. Couvre à la fois la trame de fond des modales
  (`bg-overlay/40`, `/50`) et les survols d'assombrissement ponctuels sur un élément
  d'arbre (`hover:bg-overlay/10` dans `ElementTree.tsx`) — même besoin visuel de base
  (noir, invariant au thème comme `activity-*`/`print-*`), intensité variable selon le
  point d'usage plutôt qu'un token par cas d'usage.

## 4. Ajouter un nouveau token

1. Ajouter l'entrée dans `themeTokens` (`theme.config.ts`), valeurs `light`/`dark`.
2. Si le nom ne suit pas un préfixe déjà géré (`chart-series-`, `status-`, `activity-`,
   `print-`) par `buildTailwindColors()` dans `scripts/generate-theme-css.ts`, ajouter
   une entrée explicite dans l'objet `colors` de cette fonction (voir `overlay` comme
   exemple d'ajout ad hoc).
3. `pnpm --filter @polenta/desktop theme:generate`.
4. Utiliser la classe Tailwind générée dans le code applicatif — jamais de couleur
   brute.

## 5. Vérification de conformité

Grep de non-régression (zéro résultat attendu) sur `apps/desktop/src/renderer/**/*.tsx` :

```
(bg|text|border|ring|from|to|via|divide|placeholder|fill|stroke|outline|accent|caret|shadow|decoration)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]|\bwhite\b|\bblack\b
```

**Hors périmètre** (exceptions documentées, non couvertes par ce grep) :
- `drawio-viewer.min.js` — bibliothèque tierce vendorisée, style non Tailwind.
- Tableau `COLORS` (hex bruts) dans `routes/graph.tsx` — palette de lignes du graphe
  git, valeurs indépendantes du thème par nature (chaque branche garde sa couleur).
