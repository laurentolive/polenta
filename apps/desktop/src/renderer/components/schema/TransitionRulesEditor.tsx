import { useTranslation } from 'react-i18next'
import {
  DEFAULT_TRANSITION_LEVEL, TRANSITION_CATEGORIES, TRANSITION_LEVELS, transitionConditionsFor, transitionRuleIssues,
} from '@polenta/types'
import type { ObjectCategory, TransitionCondition, TransitionLevel, TransitionRule } from '@polenta/types'
import type { EditableStatus } from './objectTypeEditor'
import { selectCellInput, tdClass, thClass } from './objectTypeEditor'

/**
 * GH206 — contraintes de transition d'un type (exigence, test, issue) : une ligne par règle (statut
 * d'arrivée, départ facultatif), un niveau par condition (Aucun contrôle / Notification / Blocage),
 * retrait en un clic. Erreurs et avertissement D5 affichés sous la table, avant l'enregistrement.
 */
export function TransitionRulesEditor({ name, category, statuses, rules, onChange }: {
  name: string
  category: ObjectCategory
  statuses: EditableStatus[]
  rules: TransitionRule[]
  onChange: (rules: TransitionRule[]) => void
}) {
  const { t } = useTranslation()
  if (!TRANSITION_CATEGORIES.includes(category)) return null
  const conditions = transitionConditionsFor(category)
  const statusNames = statuses.map(s => s.name).filter(Boolean)
  const labelOf = (s: string) => statuses.find(x => x.name === s)?.label || s
  const set = (i: number, patch: Partial<TransitionRule>) => {
    const next = [...rules]; next[i] = { ...next[i], ...patch }; onChange(next)
  }
  const setLevel = (i: number, cond: TransitionCondition, level: TransitionLevel) =>
    set(i, { requires: { ...rules[i].requires, [cond]: level } })
  const add = () => {
    const to = statuses.find(s => s.isApproval)?.name ?? statusNames[statusNames.length - 1] ?? ''
    onChange([...rules, { to, requires: { [conditions[0]]: DEFAULT_TRANSITION_LEVEL } }])
  }
  const issues = transitionRuleIssues({ name, category, statuses: statuses.map(s => ({ name: s.name, isApproval: s.isApproval })), transitions: rules })
  const levelLabel: Record<TransitionLevel, string> = {
    off: t('transitions.level.off'), warn: t('transitions.level.warn'), block: t('transitions.level.block'),
  }

  return (
    <div className="mt-3" data-testid="transition-rules">
      <p className="section-label mb-1">{t('transitions.editor.title')}</p>
      <p className="text-[11px] text-ink-3 mb-1">{t('transitions.editor.help')}</p>
      {rules.length > 0 && (
        <table className="w-full text-xs border-collapse mb-1">
          <thead>
            <tr>
              <th className={thClass}>{t('transitions.editor.from')}</th>
              <th className={thClass}>{t('transitions.editor.to')}</th>
              {conditions.map(c => <th key={c} className={thClass}>{t(`transitions.condition.${c}`)}</th>)}
              <th className={thClass}></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule, i) => (
              <tr key={i} className="hover:bg-hover" data-testid={`transition-rule-${i}`}>
                <td className={tdClass}>
                  <select
                    value={rule.from ?? ''}
                    onChange={e => set(i, { from: e.target.value || undefined })}
                    className={selectCellInput}
                    aria-label={t('transitions.editor.from')}
                  >
                    <option value="">{t('transitions.editor.anyStatus')}</option>
                    {statusNames.map(s => <option key={s} value={s}>{labelOf(s)}</option>)}
                  </select>
                </td>
                <td className={tdClass}>
                  <select value={rule.to} onChange={e => set(i, { to: e.target.value })} className={selectCellInput} aria-label={t('transitions.editor.to')}>
                    {!statusNames.includes(rule.to) && <option value={rule.to}>{rule.to}</option>}
                    {statusNames.map(s => <option key={s} value={s}>{labelOf(s)}</option>)}
                  </select>
                </td>
                {conditions.map(c => {
                  const level = rule.requires[c] ?? 'off'
                  return (
                    <td key={c} className={tdClass}>
                      <div className="inline-flex rounded border border-edge overflow-hidden" role="radiogroup" aria-label={t(`transitions.condition.${c}`)}>
                        {TRANSITION_LEVELS.map(l => (
                          <button
                            key={l}
                            type="button"
                            role="radio"
                            aria-checked={level === l}
                            data-testid={`transition-level-${i}-${c}-${l}`}
                            onClick={() => setLevel(i, c, l)}
                            className={`px-1.5 py-0.5 text-[11px] ${level === l
                              ? (l === 'block' ? 'bg-status-danger-bg text-status-danger' : l === 'warn' ? 'bg-status-warning-bg text-status-warning' : 'bg-hover text-ink')
                              : 'text-ink-3 hover:text-ink'}`}
                          >
                            {levelLabel[l]}
                          </button>
                        ))}
                      </div>
                    </td>
                  )
                })}
                <td className={tdClass}>
                  <button
                    type="button"
                    onClick={() => onChange(rules.filter((_, j) => j !== i))}
                    className="px-1 text-ink-3 hover:text-status-danger"
                    title={t('transitions.editor.remove')}
                    aria-label={t('transitions.editor.remove')}
                    data-testid={`transition-remove-${i}`}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {issues.map((issue, k) => (
        <p key={k} className={`text-[11px] ${issue.level === 'error' ? 'text-status-danger' : 'text-status-warning'}`} data-testid={`transition-issue-${issue.level}`}>
          {issue.level === 'error' ? '✕' : '⚠'} {issue.message}
        </p>
      ))}
      <button type="button" onClick={add} disabled={statusNames.length === 0} className="text-xs text-status-info hover:underline disabled:opacity-40" data-testid="transition-add">
        {t('transitions.editor.add')}
      </button>
    </div>
  )
}
