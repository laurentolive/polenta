import { useTranslation } from 'react-i18next'
import { fieldValueToText, type SchemaField } from '@polenta/types'
import { LinkList } from '../links/LinkList'
import { RichTextViewer } from '../RichTextViewer'

// GH196 — valeurs des champs d'exécution ou d'étape d'un run, en lecture seule (spec §4, §6) : liens
// cliquables, valeur d'enum disparue du schéma signalée ⚠, champ retiré du schéma « hors schéma ».

interface Props {
  defs: SchemaField[]
  values: Record<string, unknown> | undefined
  repoPath: string
}

export function RunFieldValues({ defs, values, repoPath }: Props) {
  const { t } = useTranslation()
  const entries = Object.entries(values ?? {})
  if (entries.length === 0) return null
  const known = defs.filter(d => values?.[d.name] !== undefined)
  const unknown = entries.filter(([name]) => !defs.some(d => d.name === name))
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm" data-testid="run-field-values">
      {known.map(def => (
        <Row key={def.name} label={def.label ?? def.name}>
          <Value def={def} value={values![def.name]} repoPath={repoPath} />
        </Row>
      ))}
      {unknown.map(([name, value]) => (
        <Row key={name} label={<>{name} <span className="text-ink-3 italic">({t('campaignPage.outOfSchema')})</span></>}>
          <span className="text-ink-2">{fieldValueToText(value)}</span>
        </Row>
      ))}
    </dl>
  )
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-xs text-ink-3 pt-0.5">{label}</dt>
      <dd className="text-ink min-w-0">{children}</dd>
    </>
  )
}

function Value({ def, value, repoPath }: { def: SchemaField; value: unknown; repoPath: string }) {
  const { t } = useTranslation()
  if (def.type === 'link') return <LinkList value={value} />
  if (def.type === 'richtext' && typeof value === 'string') return <RichTextViewer value={value} repoPath={repoPath} />
  if (def.type === 'boolean') return <>{value === true || value === 'true' ? t('common.yes') : t('common.no')}</>
  const text = fieldValueToText(value)
  if ((def.type === 'enum' || def.type === 'multi_enum') && def.values?.length) {
    const unknownValues = text.split(',').map(v => v.trim()).filter(v => v && !def.values!.includes(v))
    if (unknownValues.length > 0) return <span title={def.values.join(', ')}>{text} <span className="text-status-warning">⚠</span></span>
  }
  return <span className="whitespace-pre-wrap">{text}</span>
}
