import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import yaml from 'js-yaml'
import type { ObjectTypeDefinition } from '@polenta/types'
import { StaticRichTextViewer } from '../../lib/staticRichText'
import { scalarLabel, statusLabel, type DiffUnit } from '../../lib/objectUnits'
import { wordSegments } from '../../lib/wordDiff'

export type DiffSideName = 'before' | 'after'

/**
 * GH178 — valeur d'une unité dans une colonne du mode Rendu (lecture seule). `at` : version git à
 * laquelle lire les images et diagrammes référencés par un richtext (`null` = working tree).
 * `other` (unité modifiée seulement) : valeur de l'autre colonne, pour le diff mot à mot d'un texte.
 */
export function DiffValue({ unit, value, other, side, media, typeDef, repoPath, at }: {
  unit: DiffUnit
  value: unknown
  other?: unknown
  side: DiffSideName
  /** Blocs média à encadrer (richtext). */
  media?: Set<number>
  typeDef?: ObjectTypeDefinition
  repoPath: string
  at: string | null
}) {
  const { t } = useTranslation()
  if (value === undefined) return <p className="text-xs text-ink-3 italic">{t('diffView.absentUnit')}</p>
  if (value === null || value === '') return <Empty />
  const otherText = typeof other === 'string' ? other : undefined

  switch (unit.kind) {
    case 'title':
      return <p className="text-sm font-semibold text-ink"><WordDiffText text={String(value)} other={otherText} side={side} /></p>
    case 'status':
      return <p className="text-sm text-ink">{statusLabel(typeDef, value)}</p>
    case 'richtext':
      return typeof value === 'string'
        ? <RichText value={value} other={otherText} side={side} media={media} repoPath={repoPath} at={at} />
        : <RawValue value={value} />
    case 'steps':
      // Lists of steps are aligned by StepsDiff; anything else is shown as is.
      return <RawValue value={value} />
    case 'field':
      if (typeof value === 'object' && unit.field?.type !== 'multi_enum') return <RawValue value={value} />
      if (unit.field?.type === 'text' && typeof value === 'string') {
        return <p className="text-sm text-ink whitespace-pre-wrap"><WordDiffText text={value} other={otherText} side={side} /></p>
      }
      return <p className="text-sm text-ink whitespace-pre-wrap">{scalarLabel(unit.field, value)}</p>
    default:
      return typeof value === 'object'
        ? <RawValue value={value} />
        : <p className="text-sm text-ink whitespace-pre-wrap"><WordDiffText text={String(value)} other={otherText} side={side} /></p>
  }
}

/** Richtext rendu, avec diff mot à mot quand l'autre version existe. */
export function RichText({ value, other, side, media, repoPath, at }: {
  value: string; other?: string; side: DiffSideName; media?: Set<number>; repoPath: string; at: string | null
}) {
  const diffAgainst = useMemo(() => (other === undefined ? undefined : { other, side }), [other, side])
  return <StaticRichTextViewer value={value} repoPath={repoPath} at={at} diffAgainst={diffAgainst} changedMedia={media} />
}

/** Texte brut avec les mots retirés (Avant) ou ajoutés (Après) marqués. */
export function WordDiffText({ text, other, side }: { text: string; other?: string; side: DiffSideName }) {
  const segments = useMemo(() => (other === undefined || other === text ? null : wordSegments(text, other, side)), [text, other, side])
  if (!segments) return <>{text}</>
  const Mark = side === 'before' ? 'del' : 'ins'
  return (
    <>
      {segments.map((s, i) => s.changed
        ? <Mark key={i} className={side === 'before' ? 'diff-del' : 'diff-ins'}>{s.text}</Mark>
        : <span key={i}>{s.text}</span>)}
    </>
  )
}

export function RawValue({ value }: { value: unknown }) {
  return <pre className="text-xs text-ink-2 font-mono whitespace-pre-wrap">{yaml.dump(value, { lineWidth: 120 }).trimEnd()}</pre>
}

function Empty() {
  return <p className="text-xs text-ink-3 italic">—</p>
}
