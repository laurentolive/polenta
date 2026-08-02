/**
 * Source unique des tokens de couleur du thème clair/sombre.
 *
 * Chaque valeur est un triplet RGB séparé par des espaces ("R G B", sans virgules,
 * sans "rgb()") afin d'être utilisable à la fois comme variable CSS brute et via
 * `rgb(var(--token) / <alpha-value>)` côté Tailwind — ce qui permet aux classes
 * générées de supporter les modificateurs d'opacité Tailwind (`/30`, `/50`...).
 *
 * Ce fichier est la seule source de vérité : `scripts/generate-theme-css.ts` en dérive
 * le bloc de variables CSS de `src/renderer/index.css`, et
 * `tailwind.theme.generated.js` (également généré) en dérive le mapping
 * `theme.extend.colors` de `tailwind.config.js`.
 *
 * Ne pas dupliquer une valeur ailleurs dans le code — toujours passer par un token.
 */

export interface ThemeTokenValue {
  light: string
  dark: string
}

export const themeTokens: Record<string, ThemeTokenValue> = {
  // --- Neutres (existants, migrés depuis index.css sans changement visuel) ---
  canvas: { light: '248 250 252', dark: '15 23 42' },
  surface: { light: '255 255 255', dark: '30 41 59' },
  'surface-hover': { light: '241 245 249', dark: '41 53 72' },
  'folder-row': { light: '245 247 251', dark: '35 46 61' },
  'row-hover': { light: '250 251 254', dark: '31 44 58' },
  edge: { light: '226 232 240', dark: '51 65 85' },
  'edge-subtle': { light: '241 245 249', dark: '30 41 59' },
  ink: { light: '15 23 42', dark: '241 245 249' },
  'ink-2': { light: '71 85 105', dark: '203 213 225' },
  'ink-3': { light: '148 163 184', dark: '148 163 184' },
  prim: { light: '15 23 42', dark: '226 232 240' },
  'prim-fg': { light: '248 250 252', dark: '15 23 42' },

  // --- Palette catégorielle des widgets dashboard (T77 sprint 2) — ordre fixe,
  // valeurs reprises telles quelles (skill dataviz § color-formula) ---
  'chart-series-1': { light: '42 120 214', dark: '57 135 229' },
  'chart-series-2': { light: '27 175 122', dark: '25 158 112' },
  'chart-series-3': { light: '237 161 0', dark: '201 133 0' },
  'chart-series-4': { light: '0 131 0', dark: '0 131 0' },
  'chart-series-5': { light: '74 58 167', dark: '144 133 233' },
  'chart-series-6': { light: '227 73 72', dark: '230 103 103' },
  'chart-series-7': { light: '232 123 164', dark: '213 81 129' },
  'chart-series-8': { light: '235 104 52', dark: '217 89 38' },

  // --- Sentiments (T116) — 5 sentiments x 5 variantes, réutilisés par les statuts
  // métier (exigence/test/campagne/exécution), les messages (erreur/succès/
  // avertissement) et les indicateurs d'interaction/diff. Voir specs/T116-design.md §2.1
  // pour les harmonisations décidées (ex. SKIP/BLOCKED -> warning).
  'status-neutral': { light: '51 65 85', dark: '203 213 225' },
  'status-neutral-bg': { light: '241 245 249', dark: '51 65 85' },
  'status-neutral-border': { light: '203 213 225', dark: '71 85 105' },
  'status-neutral-solid': { light: '71 85 105', dark: '71 85 105' },
  'status-neutral-fg': { light: '255 255 255', dark: '255 255 255' },

  'status-info': { light: '29 78 216', dark: '96 165 250' },
  'status-info-bg': { light: '239 246 255', dark: '30 58 138' },
  'status-info-border': { light: '219 234 254', dark: '29 78 216' },
  'status-info-solid': { light: '37 99 235', dark: '37 99 235' },
  'status-info-fg': { light: '255 255 255', dark: '255 255 255' },

  'status-success': { light: '21 128 61', dark: '74 222 128' },
  'status-success-bg': { light: '240 253 244', dark: '20 83 45' },
  'status-success-border': { light: '220 252 231', dark: '21 128 61' },
  'status-success-solid': { light: '22 163 74', dark: '22 163 74' },
  'status-success-fg': { light: '255 255 255', dark: '255 255 255' },

  // status-warning-solid utilise amber-700 (pas amber-600) : amber-600 + texte blanc
  // est sous le seuil WCAG AA (4.5:1) — cf. specs/T116-tests.md § contraste.
  'status-warning': { light: '180 83 9', dark: '251 191 36' },
  'status-warning-bg': { light: '255 251 235', dark: '120 53 15' },
  'status-warning-border': { light: '254 243 199', dark: '180 83 9' },
  'status-warning-solid': { light: '180 83 9', dark: '180 83 9' },
  'status-warning-fg': { light: '255 255 255', dark: '255 255 255' },

  'status-danger': { light: '185 28 28', dark: '248 113 113' },
  'status-danger-bg': { light: '254 242 242', dark: '127 29 29' },
  'status-danger-border': { light: '254 202 202', dark: '185 28 28' },
  'status-danger-solid': { light: '220 38 38', dark: '220 38 38' },
  'status-danger-fg': { light: '255 255 255', dark: '255 255 255' },

  // --- ActivityBar (T116, rendue adaptative en T147) — reprend la palette slate déjà
  // tokenisée côté clair (surface-hover/edge/ink/ink-2/ink-3) pour rester cohérente avec
  // le reste de l'UI ; le thème sombre garde ses valeurs T116 d'origine ---
  'activity-bg': { light: '241 245 249', dark: '15 23 42' },
  'activity-border': { light: '226 232 240', dark: '30 41 59' },
  'activity-fg': { light: '71 85 105', dark: '148 163 184' },
  'activity-fg-hover': { light: '15 23 42', dark: '255 255 255' },
  'activity-bg-active': { light: '226 232 240', dark: '51 65 85' },
  'activity-fg-disabled': { light: '148 163 184', dark: '71 85 105' },

  // --- Impression / export (T116) — figée : rendu papier toujours clair ---
  'print-bg': { light: '255 255 255', dark: '255 255 255' },
  'print-ink': { light: '15 23 42', dark: '15 23 42' },
  'print-ink-2': { light: '100 116 139', dark: '100 116 139' },
  'print-border': { light: '226 232 240', dark: '226 232 240' },

  // --- Assombrissement neutre (T116) — figé : noir dans les deux thèmes, opacité
  // portée par le modificateur Tailwind (/10, /40, /50...) au point d'usage. Couvre
  // la trame de fond des modales ET les survols d'assombrissement ponctuels (ex.
  // ElementTree.tsx) — même besoin visuel, pas de token dédié par cas d'usage ---
  overlay: { light: '0 0 0', dark: '0 0 0' },
}
