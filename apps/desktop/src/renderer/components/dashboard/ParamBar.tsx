/**
 * ParamBar — barre de paramètres choisis à l'affichage (GH93) de la requête ouverte (vue `/query`).
 * GH125 : sur un dashboard, plus de barre — chaque widget porte ses sélecteurs dans son en-tête
 * (`WidgetParamSelectors`, mêmes contrôles). En impression : texte « Libellé : valeur ».
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, RotateCcw, SlidersHorizontal } from 'lucide-react'
import type { DashboardSelector, GraphParamValue } from '@polenta/types'
import { labelText, noneText, PARAM_TEXT_MAX, paramValueText } from '@polenta/types'
import type { ParamOptions } from '../../lib/suiviParamValues'
import { optionTitle } from '../../lib/suiviParamValues'

interface Props {
  selectors: readonly DashboardSelector[]
  values: Readonly<Record<string, GraphParamValue>>
  invalid?: Readonly<Record<string, string>>
  options: ParamOptions
  onChange: (key: string, value: GraphParamValue) => void
  /** « Réinitialiser » (absent : pas de bouton). */
  onReset?: () => void
  printMode?: boolean
}

export function ParamBar({ selectors, values, invalid = {}, options, onChange, onReset, printMode = false }: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage?.startsWith('en') ? 'en' : 'fr'
  if (selectors.length === 0) return null

  if (printMode) {
    return (
      <div className="mb-4 text-sm space-y-0.5" data-testid="param-bar-print">
        {selectors.map((s) => (
          <p key={s.key}>
            <span className="font-semibold">{labelText(s.label, lang)} : </span>
            {paramValueText(s, values[s.key] ?? null, lang, (kind, v) => optionTitle(options, kind, v))}
          </p>
        ))}
      </div>
    )
  }

  return (
    <div className="bg-surface border border-edge rounded-lg px-3 py-2 flex flex-wrap items-end gap-x-4 gap-y-2" data-testid="param-bar">
      <SlidersHorizontal size={13} className="text-ink-3 self-center shrink-0" aria-hidden />
      {selectors.map((s) => (
        <div key={s.key} className="flex flex-col gap-0.5 min-w-0">
          <label className="text-[11px] text-ink-3" htmlFor={`param-${s.key}`}>{labelText(s.label, lang)}</label>
          <ParamInput selector={s} idPrefix="param" value={values[s.key] ?? null} options={options} lang={lang} onChange={(v) => onChange(s.key, v)} />
          {invalid[s.key] !== undefined && (
            <span className="flex items-center gap-1 text-[11px] text-status-warning" data-testid="param-not-found">
              <AlertTriangle size={11} className="shrink-0" /> {t('suiviParams.notFound', { value: invalid[s.key] })}
            </span>
          )}
        </div>
      ))}
      {onReset && (
        <button type="button" onClick={onReset} className="btn-secondary-sm flex items-center gap-1.5 self-center ml-auto" data-testid="param-reset">
          <RotateCcw size={11} /> {t('suiviParams.reset')}
        </button>
      )}
    </div>
  )
}

/**
 * GH125 — sélecteurs d'un widget, dans l'en-tête de sa carte : « Libellé [contrôle] » par paramètre
 * déclaré par sa requête, avertissement « Valeur introuvable » par sélecteur, icône Réinitialiser
 * (D1) seulement hors défaut. En impression : lignes « Libellé : valeur » sous le titre.
 */
export function WidgetParamSelectors({ widgetId, selectors, values, invalid = {}, options, onChange, onReset, printMode = false, onPointerInside }: Props & {
  widgetId: string
  /** Pointeur sur les sélecteurs : la carte ne doit pas démarrer de glisser (réordonner). */
  onPointerInside?: (inside: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage?.startsWith('en') ? 'en' : 'fr'
  if (selectors.length === 0) return null

  if (printMode) {
    return (
      <div className="px-3 pt-1 text-[11px] text-ink-2 space-y-0.5" data-testid="widget-params-print">
        {selectors.map((s) => (
          <p key={s.key}>
            <span className="font-semibold">{labelText(s.label, lang)} : </span>
            {paramValueText(s, values[s.key] ?? null, lang, (kind, v) => optionTitle(options, kind, v))}
          </p>
        ))}
      </div>
    )
  }

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-1.5"
      data-testid="widget-params"
      onPointerEnter={() => onPointerInside?.(true)}
      onPointerLeave={() => onPointerInside?.(false)}
    >
      {selectors.map((s) => (
        <div key={s.key} className="flex items-center gap-1 min-w-0">
          <label className="text-[11px] text-ink-3 shrink-0" htmlFor={`wparam-${widgetId}-${s.key}`}>{labelText(s.label, lang)} :</label>
          <ParamInput selector={s} idPrefix={`wparam-${widgetId}`} value={values[s.key] ?? null} options={options} lang={lang} onChange={(v) => onChange(s.key, v)} compact />
          {invalid[s.key] !== undefined && (
            <span className="flex items-center gap-1 text-[11px] text-status-warning" data-testid="param-not-found">
              <AlertTriangle size={11} className="shrink-0" /> {t('suiviParams.notFound', { value: invalid[s.key] })}
            </span>
          )}
        </div>
      ))}
      {onReset && (
        <button type="button" onClick={onReset} title={t('suiviParams.reset')} aria-label={t('suiviParams.reset')} className="text-ink-3 hover:text-ink transition-colors" data-testid="widget-param-reset">
          <RotateCcw size={11} />
        </button>
      )}
    </div>
  )
}

function ParamInput({ selector: s, idPrefix, value, options, lang, onChange, compact = false }: {
  selector: DashboardSelector
  /** Préfixe de l'id du contrôle (unique dans la page : un widget = un préfixe). */
  idPrefix: string
  compact?: boolean
  value: GraphParamValue
  options: ParamOptions
  lang: 'fr' | 'en'
  onChange: (v: GraphParamValue) => void
}) {
  const { t } = useTranslation()
  const id = `${idPrefix}-${s.key}`
  const testId = `param-${s.name}`

  if (s.kind === 'text') return <TextInput id={id} testId={testId} value={typeof value === 'string' ? value : ''} onChange={onChange} />
  if (s.kind === 'period') return <PeriodInput id={id} testId={testId} value={value && typeof value === 'object' ? value : null} onChange={onChange} />

  let choices: { value: string; label: string }[]
  switch (s.kind) {
    case 'campaign':
      choices = (options.campaigns ?? []).map((c) => ({ value: c.id, label: `${c.id} — ${c.title}${c.status ? ` (${t(`suiviParams.campaignStatus.${c.status}`, { defaultValue: c.status })})` : ''}` }))
      break
    case 'component':
      choices = (options.components ?? []).map((c) => ({ value: c, label: c }))
      break
    case 'objectType':
      choices = (options.objectTypes ?? []).map((o) => ({ value: o.objectTypeRef, label: `${o.label} (${o.component})` }))
        .filter((o, i, all) => all.findIndex((x) => x.value === o.value) === i)
      break
    default:
      choices = (s.values ?? []).map((v) => ({ value: v.value, label: v.label ? labelText(v.label, lang) : v.value }))
  }
  const current = typeof value === 'string' ? value : ''
  // Valeur courante absente des options (en chargement) : affichée telle quelle plutôt que perdue.
  if (current && !choices.some((c) => c.value === current)) choices = [{ value: current, label: current }, ...choices]
  return (
    <select
      id={id}
      data-testid={testId}
      value={current}
      onChange={(e) => onChange(e.target.value || null)}
      className={compact ? 'input-field text-[11px] py-0.5 max-w-[14rem]' : 'input-field text-xs py-1 max-w-[22rem]'}
    >
      {(!s.required || !current) && <option value="">{s.required ? t('suiviParams.choose', { label: labelText(s.label, lang) }) : noneText(s.kind, lang)}</option>}
      {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
    </select>
  )
}

/** Texte appliqué à la validation (Entrée ou perte du focus), pas à chaque frappe. */
function TextInput({ id, testId, value, onChange }: { id: string; testId: string; value: string; onChange: (v: GraphParamValue) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const v = draft.trim()
    if (v !== value) onChange(v || null)
  }
  return (
    <input
      id={id}
      data-testid={testId}
      value={draft}
      maxLength={PARAM_TEXT_MAX}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
      className="input-field text-xs py-1 w-48"
    />
  )
}

/** Deux dates facultatives ; « du » postérieur à « au » : refusé, valeur précédente conservée. */
function PeriodInput({ id, testId, value, onChange }: {
  id: string
  testId: string
  value: { from: string | null; to: string | null } | null
  onChange: (v: GraphParamValue) => void
}) {
  const { t } = useTranslation()
  const [error, setError] = useState(false)
  const from = value?.from ?? ''
  const to = value?.to ?? ''
  const set = (next: { from: string; to: string }) => {
    if (next.from && next.to && next.from > next.to) { setError(true); return }
    setError(false)
    onChange(next.from || next.to ? { from: next.from || null, to: next.to || null } : null)
  }
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
        {t('suiviParams.from')}
        <input id={id} data-testid={`${testId}-from`} type="date" value={from} onChange={(e) => set({ from: e.target.value, to })} className="input-field text-xs py-0.5" />
        {t('suiviParams.to')}
        <input data-testid={`${testId}-to`} type="date" value={to} onChange={(e) => set({ from, to: e.target.value })} className="input-field text-xs py-0.5" />
      </span>
      {error && <span className="text-[11px] text-status-danger" data-testid="param-period-error">{t('suiviParams.periodInvalid')}</span>}
    </span>
  )
}
