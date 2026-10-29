import { useMemo } from 'react'
import yaml from 'js-yaml'
import { StaticRichTextViewer } from '../../lib/staticRichText'
import { wordSegments } from '../../lib/wordDiff'

export type DiffSideName = 'before' | 'after'

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

