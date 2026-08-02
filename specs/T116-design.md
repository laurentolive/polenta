# T116 — Design technique

Réf : `specs/T116.md`

## 1. Constat détaillé (complète l'audit de la spec)

Un inventaire exhaustif (grep sur tous les préfixes de couleur Tailwind + `white`/`black`, sur `apps/desktop/src/renderer/**/*.tsx`) donne :

- **79 fichiers sur 117** utilisent au moins une couleur Tailwind brute (120+ tokens distincts)
- Les couleurs se répartissent en **3 usages fonctionnels récurrents**, pas en un désordre homogène :
  1. **Badges de statut** (~13 fichiers, le noyau le plus dupliqué) — 4 systèmes de statuts quasi identiques réimplémentés indépendamment avec des nuances différentes à chaque fois :
     - Exigence : draft(slate) / review(amber) / approved(green) / obsolete(red)
     - Test : draft(slate) / ready(blue) / passed(green) / failed(red) / blocked(amber) / obsolete(slate atténué)
     - Campagne : planned(slate) / in_progress(blue) / completed(green) / abandoned(red)
     - Exécution de test (run/execute) : NOT_EXECUTED(gray) / PASS(green) / FAIL(red) / BLOCKED(orange) / SKIP(yellow)
  2. **Messages/alertes** (erreur, succès, avertissement) — mêmes 4-5 couleurs, dupliquées avec des nuances légèrement différentes selon le fichier (ex. `red-50/900/20` + `red-200/700/60` + `red-700/400` revient à l'identique dans ~15 fichiers, toujours retapé à la main)
  3. **Interaction/sélection** (bleu : focus ring, lien, sélection, bouton d'action) et **diff** (vert=ajout, rouge=suppression, ambre=modifié) — réutilisent les mêmes 4-5 couleurs que 1 et 2
  4. Quelques couleurs **catégorielles** hors sentiment (violet=sous-composant, purple=type campagne, blue/green=type exigence/test dans l'arbre `StructureTab.tsx`/`ElementTree.tsx`) — proches dans l'esprit de la palette `chart-series-1..8` déjà tokenisée (T77)

- **2 familles volontairement figées** (mêmes valeurs dans les deux thèmes) : ActivityBar (slate-900/800/700/400) et vues d'impression `print.*.tsx` (blanc/slate-900/slate-200, 8 fichiers)

**Conséquence pour le design** : le vrai problème n'est pas "quelques couleurs mal rangées", mais **5 sentiments** (neutre / info / succès / avertissement / danger) réimplémentés indépendamment à chaque écran avec des nuances qui dérivent légèrement. La correction structurelle est donc de créer **un seul jeu de tokens "status"** couvrant ces 5 sentiments, réutilisé par les 4 systèmes de statuts, les messages, et les indicateurs d'interaction/diff — plutôt que des tokens spécifiques par domaine (`--status-draft`, `--status-review`... aurait recréé la duplication au niveau des tokens).

## 2. Architecture des tokens

### 2.1 Fichier source unique : `theme.config.ts`

Nouveau fichier `apps/desktop/src/renderer/theme.config.ts` — objet TypeScript unique, seule source de vérité :

```ts
export const themeTokens = {
  // tokens neutres existants (canvas, surface, ink...) — repris tels quels
  canvas:        { light: '#f8fafc', dark: '#0f172a' },
  surface:       { light: '#ffffff', dark: '#1e293b' },
  // ... (idem structure actuelle, migrée depuis index.css sans changement de valeur)

  // 5 sentiments — chacun 5 variantes
  'status-neutral':       { light: '#334155', dark: '#cbd5e1' },        // texte lisible sur fond neutre
  'status-neutral-bg':    { light: '#f1f5f9', dark: 'rgba(51,65,85,.5)' },
  'status-neutral-border':{ light: '#cbd5e1', dark: '#475569' },
  'status-neutral-solid': { light: '#475569', dark: '#475569' },        // fond bouton/badge plein — fixe
  'status-neutral-fg':    { light: '#f8fafc', dark: '#f8fafc' },        // texte sur fond plein — fixe

  'status-info':          { light: '#1d4ed8', dark: '#60a5fa' },
  'status-info-bg':       { light: '#eff6ff', dark: 'rgba(30,58,138,.4)' },
  'status-info-border':   { light: '#dbeafe', dark: 'rgba(29,78,216,.5)' },
  'status-info-solid':    { light: '#2563eb', dark: '#2563eb' },
  'status-info-fg':       { light: '#ffffff', dark: '#ffffff' },

  'status-success':       { light: '#15803d', dark: '#4ade80' },
  'status-success-bg':    { light: '#f0fdf4', dark: 'rgba(20,83,45,.3)' },
  'status-success-border':{ light: '#dcfce7', dark: 'rgba(21,128,61,.5)' },
  'status-success-solid': { light: '#16a34a', dark: '#16a34a' },
  'status-success-fg':    { light: '#ffffff', dark: '#ffffff' },

  'status-warning':       { light: '#b45309', dark: '#fbbf24' },
  'status-warning-bg':    { light: '#fffbeb', dark: 'rgba(69,26,3,.4)' },
  'status-warning-border':{ light: '#fef3c7', dark: 'rgba(180,83,9,.5)' },
  'status-warning-solid': { light: '#d97706', dark: '#d97706' },
  'status-warning-fg':    { light: '#ffffff', dark: '#ffffff' },

  'status-danger':        { light: '#b91c1c', dark: '#f87171' },
  'status-danger-bg':     { light: '#fef2f2', dark: 'rgba(127,29,29,.2)' },
  'status-danger-border': { light: '#fecaca', dark: 'rgba(185,28,28,.6)' },
  'status-danger-solid':  { light: '#dc2626', dark: '#dc2626' },
  'status-danger-fg':     { light: '#ffffff', dark: '#ffffff' },

  // familles figées (une seule valeur, identique dans les deux thèmes)
  'activity-bg':          { light: '#0f172a', dark: '#0f172a' },
  'activity-border':      { light: '#1e293b', dark: '#1e293b' },
  'activity-fg':          { light: '#94a3b8', dark: '#94a3b8' },
  'activity-fg-hover':    { light: '#ffffff', dark: '#ffffff' },
  'activity-bg-active':   { light: '#334155', dark: '#334155' },
  'activity-fg-disabled': { light: '#475569', dark: '#475569' },

  'print-bg':    { light: '#ffffff', dark: '#ffffff' },
  'print-ink':   { light: '#0f172a', dark: '#0f172a' },
  'print-ink-2': { light: '#64748b', dark: '#64748b' },
  'print-border':{ light: '#e2e8f0', dark: '#e2e8f0' },

  // chart-series-1..8 — migrées depuis index.css sans changement de valeur (T77)
} as const
```

Valeurs indicatives ci-dessus reprises de la palette Tailwind standard (les nuances les plus fréquentes identifiées dans l'audit — ex. `slate-100/700`, `amber-100/800` + `dark:amber-900/30/400`, `green-100/800`, `red-100/700`, `blue-100/700`). **À valider/ajuster en sprint 1** pour contraste WCAG AA (notamment `status-warning-solid` + `status-*-fg` blanc — l'ambre à 600 sur blanc est limite, cf. `T116-tests.md` §checklist contraste).

**Harmonisations décidées** (résolvent le critère d'acceptation 5 de `T116.md` sur les divergences actuelles) :
- Les statuts `SKIP` (jaune) et `BLOCKED` (orange) des campagnes s'unifient sur `status-warning` (ambre) — actuellement deux teintes différentes pour une même sémantique "à traiter/en attente".
- Les nuances de rouge légèrement différentes entre fichiers pour un même usage (`red-500` vs `red-600` pour un bouton "supprimer") s'unifient sur `status-danger-solid`.
- Les couleurs catégorielles hors sentiment (violet=sous-composant, purple=type campagne dans l'arbre) réutilisent la palette `chart-series-1..8` existante plutôt que d'introduire de nouveaux tokens catégoriels — cohérent avec son usage déjà établi (T77) pour distinguer des catégories sans hiérarchie de sentiment.

### 2.2 Génération de `index.css` et `tailwind.config.js`

- Nouveau script `apps/desktop/scripts/generate-theme-css.ts`, exécuté via `tsx` (nouvelle devDependency, légère, mono-usage) : lit `theme.config.ts`, régénère le bloc de variables CSS entre deux marqueurs dans `index.css` :
  ```css
  /* THEME:GENERATED:START — ne pas éditer à la main, voir theme.config.ts + scripts/generate-theme-css.ts */
  :root { --canvas: #f8fafc; ... }
  .dark { --canvas: #0f172a; ... }
  /* THEME:GENERATED:END */
  ```
  Convention alignée sur celle de `tree.yaml`/`update-tree.py` déjà en place dans le projet (fichier généré, jamais édité à la main).
- Nouveau script npm `apps/desktop/package.json` → `"theme:generate": "tsx scripts/generate-theme-css.ts"`. Exécution manuelle par le développeur après modification de `theme.config.ts` (pas de hook automatique dans ce ticket — au-delà du périmètre, à envisager plus tard si oubli récurrent constaté).
- `apps/desktop/tailwind.config.js` importe `theme.config.ts` uniquement pour obtenir la **liste des noms de tokens** (pas les valeurs — celles-ci restent portées par les variables CSS générées) et construit `theme.extend.colors` par dérivation mécanique du nom (`status-danger-bg` → `colors.status.danger.bg = 'var(--status-danger-bg)'`), pour garantir que noms de tokens et classes Tailwind ne peuvent pas diverger.

### 2.3 Classes Tailwind résultantes (exemples d'usage)

| Besoin | Avant (brut) | Après (token) |
|---|---|---|
| Badge "draft" | `bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300` | `bg-status-neutral-bg text-status-neutral` |
| Badge "approved" | `bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400` | `bg-status-success-bg text-status-success` |
| Bloc d'erreur | `bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/60 text-red-700 dark:text-red-400` | `bg-status-danger-bg border-status-danger-border text-status-danger` |
| Bouton supprimer | `bg-red-600 hover:bg-red-700 text-white` | `bg-status-danger-solid hover:opacity-90 text-status-danger-fg` |
| Focus ring / lien | `focus:border-blue-400`, `text-blue-600 hover:underline` | `focus:border-status-info`, `text-status-info hover:underline` |
| Diff ajout/suppression | `text-green-600` / `text-red-500` | `text-status-success` / `text-status-danger` |
| ActivityBar | `bg-slate-900 border-slate-800 text-slate-400` | `bg-activity-bg border-activity-border text-activity-fg` |
| Vue impression | `bg-white text-slate-900 border-slate-200` | `bg-print-bg text-print-ink border-print-border` |

### 2.4 `index.css` — nettoyage des composants existants

`.input-field` (`focus:ring-slate-400/30`) et `.btn-danger` (`border-red-300 text-red-600 ... dark:border-red-700/60 dark:text-red-400 dark:hover:bg-red-900/20`) sont eux-mêmes non conformes (relevé dans l'audit). Migrés vers `focus:ring-status-info/30` et les tokens `status-danger-*` dans le cadre du sprint 1 (fichier central, impact transverse immédiat).

## 3. Fichiers impactés

**Nouveaux** :
- `apps/desktop/src/renderer/theme.config.ts`
- `apps/desktop/scripts/generate-theme-css.ts`

**Modifiés (architecture, sprint 1)** :
- `apps/desktop/src/renderer/index.css` (bloc de variables généré + `.input-field`/`.btn-danger`)
- `apps/desktop/tailwind.config.js` (nouvelles entrées `status`, `activity`, `print`, `chart`)
- `apps/desktop/package.json` (script `theme:generate`, devDependency `tsx`)
- `apps/desktop/src/renderer/components/layout/ActivityBar.tsx`
- 8 routes `print.*.tsx`

**Modifiés (migration mécanique, sprints 2-4)** : les 79 fichiers recensés dans l'audit, par lot (détail §4).

## 4. Découpage en sprints

Le volume (79 fichiers + nouvelle architecture) ne tient pas en un sprint. Découpage proposé, du plus structurant/à plus forte duplication vers le plus périphérique :

- **Sprint 1 — Architecture** : `theme.config.ts`, script de génération, `index.css`/`tailwind.config.js` régénérés, nouveaux tokens `status-*`/`activity-*`/`print-*`, migration `ActivityBar.tsx` + 8 routes `print.*.tsx` + nettoyage `.input-field`/`.btn-danger`. Valide l'architecture de bout en bout sur un périmètre contenu avant de l'appliquer en masse.
- **Sprint 2 — Statuts** (~13 fichiers, duplication la plus forte) : `requirements.tsx`, `req.$reqId.tsx`, `tests.tsx`, `test.$testId.tsx`, `CampaignListView.tsx`, `SystemPanel.tsx`, `WordView.tsx`, `RequirementEditModal.tsx`, `TestCaseEditModal.tsx`, `campaign.$campaignId.tsx`, `campaign.$campaignId_.run.$testId.tsx`, `campaign.$campaignId_.execute.$testId.tsx`. Applique les harmonisations décidées en §2.1 (SKIP/BLOCKED, nuances de rouge).
- **Sprint 3 — Messages et formulaires** (~25 fichiers) : blocs d'erreur/succès/avertissement (`compliance.tsx`, `workspace.tsx`, `login.tsx`, `index.tsx`, `dashboard.tsx`, `query.tsx`, `baseline.tsx`, `schema.tsx`, `preferences.tsx`, `*.new.tsx`, modales `*Modal.tsx`, panneaux `sidebar/version/*`) et champs de formulaire (`EditView.tsx`, `DynamicField.tsx`, `LinkCombobox.tsx`, `ExcelView.tsx`, `FilterOptionsToggle.tsx`, `objectTypeEditor.tsx`).
- **Sprint 4 — Reste + vérification finale** : diff (`diff.tsx`, `version-diff.tsx`), compliance/impact (`impact-analysis.tsx`, `ComplianceMatrix.tsx`), interaction/navigation (`ElementTree.tsx`, `SearchPanel.tsx`, `StructureTab.tsx`, `graph.tsx`, composants `dashboard/*`, `tiptap/*`, `account*`, `export/ExportButton.tsx`, `StepsTable.tsx`, `RepoBranchSelector.tsx`). Dernier sprint : exécute le grep de conformité (critère d'acceptation 2 de `T116.md`), crée `specs/SPEC-THEMING.md` (nouvelle entrée d'index, cf. `T116.md` §Refs SPEC), met à jour `SPEC-INDEX.md`.

Chaque sprint applique le même geste mécanique (remplacer les classes brutes par les classes tokens du tableau §2.3) sur son lot de fichiers — pas de nouvelle décision de conception attendue après le sprint 1, sauf cas particulier remonté en cours de sprint.

## 5. Décisions techniques et alternatives rejetées

- **Un token par sentiment plutôt qu'un token par statut métier** (`status-danger` réutilisé par "obsolete"/"failed"/"abandoned"/erreurs plutôt que `status-obsolete` + `status-failed` + `status-abandoned` séparés) : élimine la duplication constatée dans l'audit (4 systèmes de statuts quasi identiques). Rejeté : tokens par statut métier — aurait déplacé la duplication du CSS vers les tokens sans la résoudre.
- **`theme.config.ts` en TS avec génération de `index.css`** plutôt que garder `index.css` comme unique source : conforme au choix validé en phase Spec (fichier de config TS). Alternative rejetée : faire lire `theme.config.ts` directement par les composants React (via `style={{color: theme.status.danger}}`) — perdrait le mécanisme `.dark` déjà en place (bascule pure CSS, sans re-render React) et casserait l'usage existant (Recharts lit les variables CSS directement).
- **`tsx` comme nouvelle devDependency** pour exécuter le générateur : alternative rejetée — écrire le générateur en `.mjs` pur (sans types) aurait cassé la garantie de cohérence typée entre `theme.config.ts` et le script qui le consomme.
- **Pas de hook pre-commit automatique** pour la génération (contrairement à `update-tree.py`) : périmètre volontairement limité — à ajouter plus tard si des oublis de régénération sont constatés en pratique.
- **Réutilisation de `chart-series-1..8`** pour les couleurs catégorielles de l'arbre (violet/purple/blue/green comme identifiants de type) plutôt que de nouveaux tokens dédiés : évite la prolifération de tokens pour un besoin déjà couvert par une palette catégorielle existante.
