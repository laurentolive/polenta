/**
 * Régénère, à partir de `src/renderer/theme.config.ts` (source unique) :
 *  - le bloc de variables CSS `:root`/`.dark` dans `src/renderer/index.css`
 *    (entre les marqueurs THEME:GENERATED:START/END)
 *  - `tailwind.theme.generated.js`, consommé par `tailwind.config.js`
 *
 * Ne jamais éditer ces deux sorties à la main — relancer ce script après toute
 * modification de theme.config.ts :
 *
 *   pnpm --filter @polenta/desktop theme:generate
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { themeTokens } from '../src/renderer/theme.config.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CSS_PATH = path.join(__dirname, '../src/renderer/index.css')
const TAILWIND_COLORS_PATH = path.join(__dirname, '../tailwind.theme.generated.js')

const START_MARKER = '/* THEME:GENERATED:START — ne pas éditer à la main, voir theme.config.ts + scripts/generate-theme-css.ts */'
const END_MARKER = '/* THEME:GENERATED:END */'

function buildCssBlock(): string {
  const rootLines: string[] = []
  const darkLines: string[] = []

  for (const [name, value] of Object.entries(themeTokens)) {
    rootLines.push(`    --${name}: ${value.light};`)
    // Une valeur identique dans les deux thèmes n'est déclarée qu'une fois (:root) —
    // c'est le cas des familles figées (activity-*, print-*, status-*-solid/-fg).
    if (value.dark !== value.light) {
      darkLines.push(`    --${name}: ${value.dark};`)
    }
  }

  return [
    START_MARKER,
    '  :root {',
    ...rootLines,
    '  }',
    '',
    '  .dark {',
    ...darkLines,
    '  }',
    END_MARKER,
  ].join('\n')
}

function updateIndexCss() {
  const css = readFileSync(CSS_PATH, 'utf8')
  const startIdx = css.indexOf(START_MARKER)
  const endIdx = css.indexOf(END_MARKER)
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      `Marqueurs THEME:GENERATED introuvables dans ${CSS_PATH} — vérifier que le bloc n'a pas été supprimé.`
    )
  }
  const before = css.slice(0, startIdx)
  const after = css.slice(endIdx + END_MARKER.length)
  writeFileSync(CSS_PATH, before + buildCssBlock() + after, 'utf8')
}

/** RGB triplet -> couleur Tailwind supportant les modificateurs d'opacité (/30, /50...) */
function colorValue(tokenName: string): string {
  return `rgb(var(--${tokenName}) / <alpha-value>)`
}

type ColorTree = { [key: string]: string | ColorTree }

function buildTailwindColors(): ColorTree {
  const colors: ColorTree = {
    canvas: colorValue('canvas'),
    surface: colorValue('surface'),
    hover: colorValue('surface-hover'),
    'folder-row': colorValue('folder-row'),
    'row-hover': colorValue('row-hover'),
    edge: colorValue('edge'),
    'edge-subtle': colorValue('edge-subtle'),
    ink: {
      DEFAULT: colorValue('ink'),
      2: colorValue('ink-2'),
      3: colorValue('ink-3'),
    },
    prim: {
      DEFAULT: colorValue('prim'),
      fg: colorValue('prim-fg'),
    },
    overlay: colorValue('overlay'),
    chart: {},
    status: {},
    activity: {},
    print: {},
  }

  for (const name of Object.keys(themeTokens)) {
    if (name.startsWith('chart-series-')) {
      const n = name.slice('chart-series-'.length)
      ;(colors.chart as ColorTree)[n] = colorValue(name)
    } else if (name.startsWith('status-')) {
      const rest = name.slice('status-'.length) // ex: 'danger-bg' | 'danger'
      const [sentiment, ...variantParts] = rest.split('-')
      const variant = variantParts.length ? variantParts.join('-') : 'DEFAULT'
      const status = colors.status as ColorTree
      status[sentiment] ??= {}
      ;(status[sentiment] as ColorTree)[variant] = colorValue(name)
    } else if (name.startsWith('activity-')) {
      const key = name.slice('activity-'.length)
      ;(colors.activity as ColorTree)[key] = colorValue(name)
    } else if (name.startsWith('print-')) {
      const key = name.slice('print-'.length)
      ;(colors.print as ColorTree)[key] = colorValue(name)
    }
  }

  return colors
}

function updateTailwindColorsFile() {
  const colors = buildTailwindColors()
  const content = `// GÉNÉRÉ — ne pas éditer à la main.
// Source : theme.config.ts — régénérer avec \`pnpm --filter @polenta/desktop theme:generate\`.
export const themeColors = ${JSON.stringify(colors, null, 2)}
`
  writeFileSync(TAILWIND_COLORS_PATH, content, 'utf8')
}

updateIndexCss()
updateTailwindColorsFile()
console.log('theme:generate — index.css et tailwind.theme.generated.js mis à jour.')
