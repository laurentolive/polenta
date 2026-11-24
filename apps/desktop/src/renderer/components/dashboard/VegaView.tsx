import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { printFontFloor } from '@polenta/types'
import { useTheme } from '../../contexts/ThemeContext'
import { useElementSize } from '../../hooks/useElementSize'
import { applySeriesColors, originalRow, resolveTokens, themeConfig } from './vegaTheme'
import { fitSpec, isTooSmall, measureChart, type MeasurableView } from './vegaFit'

/**
 * GH74 — rendu d'une spec Vega-Lite (specs/GH74.md §3). Vega est chargé à la demande (chunk séparé)
 * et tourne SANS `eval` : expressions interprétées (`ast: true` + `vega-interpreter`), comme vérifié
 * par #78 dans Electron et le navigateur. Les lignes sont injectées dans la source de données nommée
 * `rows` ; un clic sur une marque remonte son `datum` (drill-down).
 *
 * GH435 (specs/GH435.md § 3.4, § 3.6) — le graphique occupe exactement le corps de sa carte, axes et légende
 * compris, et se redessine à chaque changement de taille (observation du conteneur, plafonnée à ~8 fois par
 * seconde pendant un glissement). La place de la légende est choisie d'après la taille (`fitSpec`). Chaque
 * rendu se fait hors écran puis REMPLACE le précédent d'un coup (pas de blanc entre deux dessins) ; s'il ne
 * peut pas s'afficher entier (tracé de moins de 48 px, légende que Vega couperait), il n'est pas inséré et le
 * widget affiche « trop petit ».
 */

type Embed = typeof import('vega-embed')['default']
let loading: Promise<{ embed: Embed; expr: unknown }> | null = null

function loadVega() {
  loading ??= Promise.all([import('vega-embed'), import('vega-interpreter')]).then(([e, i]) => ({
    embed: e.default,
    expr: i.expressionInterpreter,
  }))
  return loading
}

/** Intervalle minimal entre deux redessins pendant que la carte change de taille. */
const REDRAW_INTERVAL_MS = 120
/** À l'impression, délai de stabilité de la taille avant d'annoncer le rendu terminé (supérieur à l'intervalle de redessin). */
const PRINT_SETTLE_MS = 250

/** Rôles Vega dont un clic ne désigne aucune ligne de données (légende, axes, titre). */
const NON_DATA_ROLE = /^(axis|legend|title)/

interface Props {
  spec: string
  rows: Record<string, unknown>[]
  /** Clic sur une marque : `datum` de la marque (lignes transformées), absent → rien de cliquable. */
  onMark?: (datum: Record<string, unknown>) => void
  /** Impression (rendu terminé signalé par `onRendered`). */
  printMode?: boolean
  onRendered?: () => void
}

interface Shown {
  finalize: () => void
}

/**
 * Libellé tronqué par Vega (« … » final) : infobulle avec le texte entier, retrouvé par son début parmi les
 * valeurs des lignes. Vega désactive les événements du pointeur sur les libellés : réactivés sur ceux-là.
 */
function addTruncationTooltips(root: HTMLElement, rows: readonly Record<string, unknown>[]): void {
  const truncated = [...root.querySelectorAll<SVGTextElement>('.role-legend-label text, .role-axis-label text')]
    .filter((el) => (el.textContent ?? '').endsWith('…'))
  if (truncated.length === 0) return
  const values = new Set<string>()
  for (const row of rows) for (const v of Object.values(row)) if (typeof v === 'string') values.add(v)
  for (const el of truncated) {
    const start = (el.textContent ?? '').slice(0, -1)
    const full = [...values].find((v) => v.length > start.length && v.startsWith(start))
    if (!full) continue
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
    title.textContent = full
    el.appendChild(title)
    el.style.pointerEvents = 'auto'
  }
}

export function VegaView({ spec, rows, onMark, printMode = false, onRendered }: Props) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const host = useRef<HTMLDivElement | null>(null)
  const [sizeRef, size] = useElementSize<HTMLDivElement>(REDRAW_INTERVAL_MS)
  const setHost = useCallback((el: HTMLDivElement | null) => {
    host.current = el
    sizeRef(el)
  }, [sizeRef])
  const [error, setError] = useState<string | null>(null)
  const [tooSmall, setTooSmall] = useState(false)
  /** Rendu actuellement inséré dans la page. */
  const shown = useRef<Shown | null>(null)
  const onMarkRef = useRef(onMark)
  onMarkRef.current = onMark
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered

  const measured = size !== null
  const width = size?.width ?? 0
  const height = size?.height ?? 0

  useEffect(() => {
    if (!measured) return
    // Conteneur sans taille (replié, masqué) : rien à dessiner, et l'impression n'attend pas ce widget.
    if (width < 1 || height < 1) {
      onRenderedRef.current?.()
      return
    }
    let cancelled = false
    let settle: ReturnType<typeof setTimeout> | null = null
    /** Rendu terminé à la taille courante. À l'impression, seulement une fois la taille restée stable : un
     *  changement de taille (en-tête qui s'allonge, polices) relance le rendu et annule cette annonce, pour
     *  qu'un PDF ne soit jamais pris entre deux dessins. */
    const signalRendered = () => {
      if (printMode) settle = setTimeout(() => onRenderedRef.current?.(), PRINT_SETTLE_MS)
      else onRenderedRef.current?.()
    }
    /** Retire le rendu affiché (erreur, trop petit) ; `finalize` libère ses écouteurs. */
    const clear = () => {
      shown.current?.finalize()
      shown.current = null
      host.current?.replaceChildren()
    }
    void (async () => {
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(spec) as Record<string, unknown>
      } catch (err) {
        clear()
        setTooSmall(false)
        setError(t('dashboardPage.vega.invalidJson', { message: err instanceof Error ? err.message : String(err) }))
        onRenderedRef.current?.()
        return
      }
      const el = host.current
      if (!el) {
        onRenderedRef.current?.()
        return
      }
      /** Rendu hors écran en cours de préparation : libéré si une étape échoue avant son insertion. */
      let staged: Shown | null = null
      try {
        const { embed, expr } = await loadVega()
        if (cancelled) return
        const minFont = printMode ? printFontFloor() : undefined
        const prepared = resolveTokens(applySeriesColors(parsed, rows))
        const fitted = fitSpec(prepared as Record<string, unknown>, { width, height, rows, minFont })
        // Vega modifie les données en place (dates analysées, bornes d'empilement) : il reçoit des
        // copies, injectées après la compilation (`view.data`) ; un clic remonte la ligne d'origine
        // (colonnes telles que produites par le script, pour la relance `polenta.drill`).
        const copies = rows.map((r) => ({ ...r }))
        const full = {
          width,
          height,
          autosize: { type: 'fit', contains: 'padding' },
          ...fitted,
          data: { ...(fitted.data as object), name: 'rows' },
          config: { ...themeConfig(undefined, minFont), ...((fitted.config as object | undefined) ?? {}) },
        }
        // Rendu hors écran : inséré seulement s'il est complet.
        const staging = document.createElement('div')
        staging.style.display = 'block'
        const result = await embed(staging, full as never, {
          ast: true,
          expr: expr as never,
          // SVG partout : rendu identique à l'impression, marques accessibles (clic, tests).
          renderer: 'svg',
          actions: false,
          mode: 'vega-lite',
        })
        staged = { finalize: result.finalize }
        if (cancelled) {
          result.finalize()
          return
        }
        await result.view.data('rows', copies).runAsync()
        // `autosize: fit` ne calcule sa mise en page qu'une fois, au premier passage, quand la source `rows`
        // est encore vide : sans légende ni libellés d'axe, donc trop optimiste. Un second passage, une fois les
        // lignes là, place le tracé d'après la légende et les axes réels (vérifié dans Chromium : sans lui la
        // légende dépasse de la vue ; avec lui le tracé se réduit et tout tient).
        await result.view.resize().runAsync()
        if (cancelled) {
          result.finalize()
          return
        }
        if (isTooSmall(measureChart(result.view as unknown as MeasurableView, { width, height }))) {
          result.finalize()
          staged = null
          clear()
          setError(null)
          setTooSmall(true)
          signalRendered()
          return
        }
        result.view.addEventListener('click', (_event, item) => {
          const hit = item as { datum?: Record<string, unknown>; mark?: { role?: string } } | null
          if (hit?.mark?.role && NON_DATA_ROLE.test(hit.mark.role)) return
          // Marque calculée par Vega (agrégat) : son propre datum.
          if (hit?.datum && onMarkRef.current) onMarkRef.current(originalRow(hit.datum, rows) ?? hit.datum)
        })
        addTruncationTooltips(staging, rows)
        const previous = shown.current
        el.replaceChildren(staging)
        el.style.cursor = onMarkRef.current ? 'pointer' : ''
        shown.current = { finalize: result.finalize }
        staged = null
        previous?.finalize()
        setError(null)
        setTooSmall(false)
        signalRendered()
      } catch (err) {
        staged?.finalize()
        if (cancelled) return
        clear()
        setTooSmall(false)
        setError(err instanceof Error ? err.message : String(err))
        onRenderedRef.current?.()
      }
    })()
    return () => {
      cancelled = true
      if (settle) clearTimeout(settle)
    }
  }, [spec, rows, theme, printMode, t, measured, width, height])

  // Démontage : le dernier rendu libère ses écouteurs.
  useEffect(() => () => {
    shown.current?.finalize()
    shown.current = null
  }, [])

  return (
    <div className="relative flex-1 min-h-0 w-full">
      <div ref={setHost} className="absolute inset-0" data-testid="vega-view" />
      {tooSmall && !error && (
        <p className="absolute inset-0 flex items-center justify-center text-xs text-ink-3 italic px-4 text-center" data-testid="widget-too-small">
          {t('dashboardPage.widget.tooSmall')}
        </p>
      )}
      {error && (
        <p className="absolute inset-0 flex items-center justify-center text-xs text-status-danger italic px-4 text-center" data-testid="widget-error">
          {t('dashboardPage.vega.renderError', { message: error })}
        </p>
      )}
    </div>
  )
}
