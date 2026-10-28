import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TestStep } from '@polenta/types'
import { alignSteps } from '../../lib/align'
import { RichText } from './DiffValue'

/** GH178 — étapes de test des deux versions, une rangée par étape alignée (`alignSteps`). */
export function StepsDiff({ before, after, repoPath, beforeAt, afterAt }: {
  before: TestStep[]
  after: TestStep[]
  repoPath: string
  beforeAt: string | null
  afterAt: string | null
}) {
  const { t } = useTranslation()
  const rows = useMemo(() => alignSteps(before, after), [before, after])

  const cell = (side: 'before' | 'after', step: TestStep | undefined, num: number | null, other: TestStep | undefined, changed: boolean) => {
    const tone = !changed ? '' : side === 'before'
      ? 'bg-status-danger-bg dark:bg-status-danger-bg/15'
      : 'bg-status-success-bg dark:bg-status-success-bg/15'
    const at = side === 'before' ? beforeAt : afterAt
    return (
      <div className={`px-3 py-1.5 min-w-0 text-sm ${side === 'after' ? 'border-l border-edge' : ''} ${tone}`}>
        {step && (
          <>
            <p className="text-[11px] text-ink-3">{t('diffView.stepNumber', { n: num })}</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="min-w-0">
                <p className="text-[10px] text-ink-3">{t('diffView.stepAction')}</p>
                <RichText value={String(step.action ?? '')} other={other ? String(other.action ?? '') : undefined}
                  side={side} repoPath={repoPath} at={at} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-ink-3">{t('diffView.stepExpected')}</p>
                <RichText value={String(step.expectedResult ?? '')} other={other ? String(other.expectedResult ?? '') : undefined}
                  side={side} repoPath={repoPath} at={at} />
              </div>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="col-span-2 grid grid-cols-2" data-testid="steps-diff">
      {rows.map(([i, j]) => {
        const a = i === null ? undefined : before[i]
        const b = j === null ? undefined : after[j]
        // Judged on what is shown (action, expected result): a change of `notes` alone is not visible here.
        const changed = !a || !b || a.action !== b.action || a.expectedResult !== b.expectedResult
        return (
          <div key={`${i}-${j}`} className="contents" data-step-row={`${i ?? '-'}:${j ?? '-'}`} data-changed={changed || undefined}>
            {cell('before', a, i === null ? null : i + 1, changed ? b : undefined, changed)}
            {cell('after', b, j === null ? null : j + 1, changed ? a : undefined, changed)}
          </div>
        )
      })}
    </div>
  )
}
