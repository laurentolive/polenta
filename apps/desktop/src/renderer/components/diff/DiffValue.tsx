import { useTranslation } from 'react-i18next'
import yaml from 'js-yaml'
import type { ObjectTypeDefinition, TestStep } from '@polenta/types'
import { StaticRichTextViewer } from '../../lib/staticRichText'
import { scalarLabel, statusLabel, type DiffUnit } from '../../lib/objectUnits'

/**
 * GH178 — valeur d'une unité dans une colonne du mode Rendu (lecture seule). `at` : version git à
 * laquelle lire les images et diagrammes référencés par un richtext (`null` = working tree).
 */
export function DiffValue({ unit, value, typeDef, repoPath, at }: {
  unit: DiffUnit
  value: unknown
  typeDef?: ObjectTypeDefinition
  repoPath: string
  at: string | null
}) {
  const { t } = useTranslation()
  if (value === undefined) return <p className="text-xs text-ink-3 italic">{t('diffView.absentUnit')}</p>
  if (value === null || value === '') return <Empty />

  switch (unit.kind) {
    case 'title':
      return <p className="text-sm font-semibold text-ink">{String(value)}</p>
    case 'status':
      return <p className="text-sm text-ink">{statusLabel(typeDef, value)}</p>
    case 'richtext':
      return typeof value === 'string'
        ? <StaticRichTextViewer value={value} repoPath={repoPath} at={at} />
        : <RawValue value={value} />
    case 'steps':
      return <StepsValue steps={value} repoPath={repoPath} at={at} />
    case 'field':
      if (typeof value === 'object' && unit.field?.type !== 'multi_enum') return <RawValue value={value} />
      return <p className="text-sm text-ink whitespace-pre-wrap">{scalarLabel(unit.field, value)}</p>
    default:
      return typeof value === 'object'
        ? <RawValue value={value} />
        : <p className="text-sm text-ink whitespace-pre-wrap">{String(value)}</p>
  }
}

function StepsValue({ steps, repoPath, at }: { steps: unknown; repoPath: string; at: string | null }) {
  const { t } = useTranslation()
  if (!Array.isArray(steps)) return <RawValue value={steps} />
  if (steps.length === 0) return <Empty />
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-[11px] text-ink-3 text-left">
          <th className="w-8 px-1 font-normal">#</th>
          <th className="px-1 font-normal">{t('diffView.stepAction')}</th>
          <th className="px-1 font-normal">{t('diffView.stepExpected')}</th>
        </tr>
      </thead>
      <tbody>
        {(steps as TestStep[]).map((s, i) => (
          <tr key={i} className="border-t border-edge-subtle align-top">
            <td className="px-1 py-1 text-ink-3">{i + 1}</td>
            <td className="px-1 py-1 min-w-0"><StaticRichTextViewer value={String(s?.action ?? '')} repoPath={repoPath} at={at} /></td>
            <td className="px-1 py-1 min-w-0"><StaticRichTextViewer value={String(s?.expectedResult ?? '')} repoPath={repoPath} at={at} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function RawValue({ value }: { value: unknown }) {
  return <pre className="text-xs text-ink-2 font-mono whitespace-pre-wrap">{yaml.dump(value, { lineWidth: 120 }).trimEnd()}</pre>
}

function Empty() {
  return <p className="text-xs text-ink-3 italic">—</p>
}
