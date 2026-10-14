import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../contexts/ThemeContext'
import { resolveTokens, themeConfig } from './vegaTheme'

/**
 * GH74 — rendu d'une spec Vega-Lite (specs/GH74.md §3). Vega est chargé à la demande (chunk séparé)
 * et tourne SANS `eval` : expressions interprétées (`ast: true` + `vega-interpreter`), comme vérifié
 * par #78 dans Electron et le navigateur. Les lignes sont injectées dans la source de données nommée
 * `rows` ; un clic sur une marque remonte son `datum` (drill-down).
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

interface Props {
  spec: string
  rows: Record<string, unknown>[]
  /** Clic sur une marque : `datum` de la marque (lignes transformées), absent → rien de cliquable. */
  onMark?: (datum: Record<string, unknown>) => void
  /** Impression (rendu terminé signalé par `onRendered`). */
  printMode?: boolean
  onRendered?: () => void
}

export function VegaView({ spec, rows, onMark, printMode = false, onRendered }: Props) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const onMarkRef = useRef(onMark)
  onMarkRef.current = onMark
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered

  useEffect(() => {
    let cancelled = false
    let finalize: (() => void) | null = null
    setError(null)
    void (async () => {
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(spec) as Record<string, unknown>
      } catch (err) {
        setError(t('dashboardPage.vega.invalidJson', { message: err instanceof Error ? err.message : String(err) }))
        onRenderedRef.current?.()
        return
      }
      const el = host.current
      if (!el) {
        onRenderedRef.current?.()
        return
      }
      try {
        const { embed, expr } = await loadVega()
        if (cancelled) return
        const resolved = resolveTokens(parsed)
        const full = {
          width: 'container',
          height: Math.max(80, el.clientHeight - 40),
          autosize: { type: 'fit', contains: 'padding' },
          ...resolved,
          data: { ...(resolved.data as object), name: 'rows', values: rows },
          config: { ...themeConfig(), ...((resolved.config as object | undefined) ?? {}) },
        }
        const result = await embed(el, full as never, {
          ast: true,
          expr: expr as never,
          // SVG partout : rendu identique à l'impression, marques accessibles (clic, tests).
          renderer: 'svg',
          actions: false,
          mode: 'vega-lite',
        })
        if (cancelled) {
          result.finalize()
          return
        }
        finalize = result.finalize
        result.view.addEventListener('click', (_event, item) => {
          const datum = (item as { datum?: Record<string, unknown> } | null)?.datum
          if (datum && onMarkRef.current) onMarkRef.current(datum)
        })
        if (onMarkRef.current) el.style.cursor = 'pointer'
        await result.view.runAsync()
        onRenderedRef.current?.()
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
        onRenderedRef.current?.()
      }
    })()
    return () => {
      cancelled = true
      finalize?.()
    }
  }, [spec, rows, theme, printMode, t])

  return (
    <div className="h-full w-full relative">
      <div ref={host} className="h-full w-full" data-testid="vega-view" />
      {error && (
        <p className="absolute inset-0 flex items-center justify-center text-xs text-status-danger italic px-4 text-center" data-testid="widget-error">
          {t('dashboardPage.vega.renderError', { message: error })}
        </p>
      )}
    </div>
  )
}
