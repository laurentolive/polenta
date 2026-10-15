/**
 * ParameterDeclEditor — déclaration des paramètres choisis à l'affichage d'une requête écrite à la
 * main (GH93, vue `/query`, mode Script). Liste éditable : nom, type, libellé, valeurs (énumération),
 * défaut, obligatoire ; ajouter / supprimer / réordonner. Les erreurs de `validateParameterDecls`
 * sont affichées sous la liste (l'enregistrement est refusé tant qu'il y en a).
 */
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import type { QueryParameterDef, QueryParameterKind } from '@polenta/types'
import { labelText, QUERY_PARAMETER_KINDS, validateParameterDecls } from '@polenta/types'

interface Props {
  value: QueryParameterDef[]
  onChange: (next: QueryParameterDef[]) => void
  readOnly?: boolean
}

/** `valeur` ou `valeur=libellé`, une par ligne. */
function valuesToText(values: QueryParameterDef['values'], lang: 'fr' | 'en'): string {
  return (values ?? []).map((v) => (v.label ? `${v.value}=${labelText(v.label, lang)}` : v.value)).join('\n')
}

function textToValues(text: string): QueryParameterDef['values'] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf('=')
    return i > 0 ? { value: l.slice(0, i).trim(), label: l.slice(i + 1).trim() } : { value: l }
  })
}

export function ParameterDeclEditor({ value, onChange, readOnly = false }: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage?.startsWith('en') ? 'en' : 'fr'
  const { errors } = validateParameterDecls(value)

  const update = (i: number, patch: Partial<QueryParameterDef>) => {
    const next = value.map((d, j) => {
      if (j !== i) return d
      const merged = { ...d, ...patch } as QueryParameterDef
      // Changement de type : valeurs et défaut de l'ancien type retirés.
      if (patch.kind && patch.kind !== d.kind) {
        delete merged.default
        if (patch.kind === 'enum') merged.values = merged.values ?? []
        else delete merged.values
      }
      return merged
    })
    onChange(next)
  }
  const move = (i: number, delta: number) => {
    const next = [...value]
    const [d] = next.splice(i, 1)
    next.splice(i + delta, 0, d)
    onChange(next)
  }
  const add = () => {
    let n = value.length + 1
    while (value.some((d) => d.name === `param${n}`)) n++
    onChange([...value, { name: `param${n}`, kind: 'campaign', label: t('suiviParams.kinds.campaign') }])
  }

  return (
    <div className="border border-edge rounded-lg" data-testid="param-decl-editor">
      <div className="flex items-center justify-between px-3 py-2 border-b border-edge-subtle">
        <p className="text-xs font-medium text-ink-2">{t('suiviParams.editor.title')}</p>
        {!readOnly && (
          <button type="button" onClick={add} className="btn-secondary-sm flex items-center gap-1" data-testid="param-decl-add">
            <Plus size={11} /> {t('suiviParams.editor.add')}
          </button>
        )}
      </div>
      {value.length === 0 ? (
        <p className="text-[11px] text-ink-3 italic px-3 py-2">{t('suiviParams.editor.empty')}</p>
      ) : (
        <div className="divide-y divide-edge-subtle">
          {value.map((d, i) => (
            <div key={i} className="px-3 py-2 flex flex-wrap items-start gap-2 text-xs" data-testid="param-decl-row">
              <Field label={t('suiviParams.editor.name')}>
                <input value={d.name} disabled={readOnly} onChange={(e) => update(i, { name: e.target.value })} className="input-field text-xs py-1 w-28 font-mono" aria-label={t('suiviParams.editor.name')} />
              </Field>
              <Field label={t('suiviParams.editor.kind')}>
                <select value={d.kind} disabled={readOnly} onChange={(e) => update(i, { kind: e.target.value as QueryParameterKind })} className="input-field text-xs py-1" aria-label={t('suiviParams.editor.kind')}>
                  {QUERY_PARAMETER_KINDS.map((k) => <option key={k} value={k}>{t(`suiviParams.kinds.${k}`)}</option>)}
                </select>
              </Field>
              <Field label={t('suiviParams.editor.label')}>
                <input value={labelText(d.label, lang)} disabled={readOnly} onChange={(e) => update(i, { label: e.target.value })} className="input-field text-xs py-1 w-36" aria-label={t('suiviParams.editor.label')} />
              </Field>
              {d.kind === 'enum' && (
                <Field label={t('suiviParams.editor.values')} hint={t('suiviParams.editor.valuesHint')}>
                  <textarea
                    // Non contrôlé (une ligne vide en cours de saisie serait retirée) : remonté dès que
                    // les valeurs de la ligne changent (suppression, réordonnancement, autre requête).
                    key={`${i}:${JSON.stringify(d.values ?? [])}`}
                    defaultValue={valuesToText(d.values, lang)}
                    disabled={readOnly}
                    onBlur={(e) => update(i, { values: textToValues(e.target.value) })}
                    rows={3}
                    className="input-field text-xs py-1 w-44 font-mono"
                    aria-label={t('suiviParams.editor.values')}
                  />
                </Field>
              )}
              <Field label={t('suiviParams.editor.default')}>
                {d.kind === 'period' ? (
                  <span className="flex items-center gap-1">
                    {(['from', 'to'] as const).map((b) => {
                      const cur = d.default && typeof d.default === 'object' ? d.default : { from: null, to: null }
                      return (
                        <input
                          key={b}
                          type="date"
                          disabled={readOnly}
                          value={cur[b] ?? ''}
                          onChange={(e) => {
                            const next = { ...cur, [b]: e.target.value || null }
                            update(i, { default: next.from || next.to ? next : undefined })
                          }}
                          className="input-field text-xs py-0.5"
                          aria-label={t(`suiviParams.${b}`)}
                        />
                      )
                    })}
                  </span>
                ) : (
                  <input
                    value={typeof d.default === 'string' ? d.default : ''}
                    disabled={readOnly}
                    onChange={(e) => update(i, { default: e.target.value || undefined })}
                    className="input-field text-xs py-1 w-28"
                    aria-label={t('suiviParams.editor.default')}
                  />
                )}
              </Field>
              <label className="flex items-center gap-1 text-[11px] text-ink-2 mt-5">
                <input type="checkbox" checked={!!d.required} disabled={readOnly} onChange={(e) => update(i, { required: e.target.checked || undefined })} />
                {t('suiviParams.editor.required')}
              </label>
              {!readOnly && (
                <span className="flex items-center gap-1 ml-auto mt-5">
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="text-ink-3 hover:text-ink disabled:opacity-30" title={t('suiviParams.editor.up')}><ArrowUp size={12} /></button>
                  <button type="button" disabled={i === value.length - 1} onClick={() => move(i, 1)} className="text-ink-3 hover:text-ink disabled:opacity-30" title={t('suiviParams.editor.down')}><ArrowDown size={12} /></button>
                  <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-ink-3 hover:text-status-danger" title={t('common.delete')}><Trash2 size={12} /></button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {errors.length > 0 && (
        <ul className="px-3 py-2 border-t border-edge-subtle text-[11px] text-status-danger list-disc list-inside" data-testid="param-decl-errors">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-[11px] text-ink-3" title={hint}>{label}</span>
      {children}
    </span>
  )
}
