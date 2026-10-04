import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import {
  changedLineIndexes, findRegions, resolveAllRegions, resolveRegion, type Side,
} from '@polenta/merge-core'
import type { MergeFileDetail, MergeFileDraft, MergeSessionInfo, MergeValidationIssue } from '@polenta/types'
import { RawPane } from './RawPane'
import { useMergeFile, useOutputValidation } from './useMergeSession'

interface Props {
  session: MergeSessionInfo
  path: string
  saveFile: (path: string, draft: MergeFileDraft) => Promise<void>
  onMerged: () => void
}

const SAVE_DELAY_MS = 500

/** GH37 — résolution d'un fichier : mes modifications | destination en haut, sortie en bas. */
export function FileResolver(props: Props) {
  const { t } = useTranslation()
  const { data: detail, isLoading, error } = useMergeFile(props.session.id, props.path)
  if (isLoading) return <p className="p-6 text-sm text-ink-3 italic">{t('common.loading')}</p>
  if (error || !detail) {
    return <p className="p-6 text-sm text-status-danger">{error instanceof Error ? error.message : String(error)}</p>
  }
  // Keyed by path: the local output state starts over for each file.
  return <Resolver key={detail.path} {...props} detail={detail} />
}

/** A file is resolved by choosing a side (binary, deleted on one side) or by editing a text output. */
function isChoiceFile(d: MergeFileDetail): boolean {
  return d.kind === 'binary' || d.left === null || d.right === null
}

function Resolver({ session, path, saveFile, onMerged, detail }: Props & { detail: MergeFileDetail }) {
  const { t } = useTranslation()
  const choiceMode = isChoiceFile(detail)
  const [text, setText] = useState<string>(detail.draft?.text ?? detail.initialOutput ?? '')
  const [choice, setChoice] = useState<Side | undefined>(detail.draft?.choice)
  const [merged, setMerged] = useState(detail.state === 'merged')
  const [saving, setSaving] = useState(false)

  // Debounced draft save — and flushed when leaving the file, so nothing typed is lost.
  const pending = useRef<MergeFileDraft | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flush = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const draft = pending.current
    pending.current = null
    // The session may be gone by then (finalized/abandoned elsewhere): nothing left to save to.
    if (draft) saveFile(path, draft).catch(() => {})
  }
  const scheduleSave = (draft: MergeFileDraft) => {
    pending.current = draft
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, SAVE_DELAY_MS)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => flush, [])

  // Un fichier mergé qui change repasse « à résoudre » tout de suite (pas après le délai) : sinon
  // « Finaliser » resterait actif et committerait l'ancienne sortie.
  const update = (draft: MergeFileDraft) => {
    const wasMerged = merged
    setMerged(false)
    scheduleSave(draft)
    if (wasMerged) flush()
  }
  const updateText = (next: string) => {
    setText(next)
    update({ state: 'todo', text: next })
  }
  const updateChoice = (side: Side) => {
    setChoice(side)
    update({ state: 'todo', choice: side })
  }

  const regions = useMemo(() => findRegions(text), [text])
  const validation = useOutputValidation(session.id, choiceMode ? null : path, choiceMode ? null : text)
  const canMerge = choiceMode
    ? choice !== undefined
    : !regions.error && regions.regions.length === 0 && !!validation && validation.errors.length === 0

  async function merge() {
    if (timer.current) clearTimeout(timer.current)
    pending.current = null
    setSaving(true)
    try {
      await saveFile(path, choiceMode ? { state: 'merged', choice } : { state: 'merged', text })
      setMerged(true)
      onMerged()
    } finally {
      setSaving(false)
    }
  }

  const leftHighlight = useMemo(
    () => (detail.left === null ? null : lines('left', changedLineIndexes(detail.base, detail.left))),
    [detail.base, detail.left],
  )
  const rightHighlight = useMemo(
    () => (detail.right === null ? null : lines('right', changedLineIndexes(detail.base, detail.right))),
    [detail.base, detail.right],
  )
  const yamlSyntax = /\.ya?ml$/i.test(path)
  const takeLabels = useMemo(() => ({ takeLeft: t('mergeResolve.takeLeft'), takeRight: t('mergeResolve.takeRight') }), [t])

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* En-tête du fichier */}
      <div className="px-4 py-2 border-b border-edge shrink-0 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-mono text-sm text-ink font-medium truncate">{path}</p>
          <p className="text-xs text-ink-3">
            {t(`mergeResolve.conflict.${detail.conflict}`)}
            {detail.objectId && <> · {detail.objectId}{detail.title ? ` — ${detail.title}` : ''}</>}
          </p>
        </div>
        {!choiceMode && (
          <>
            <button type="button" className="btn-secondary-sm" disabled={regions.regions.length === 0}
              onClick={() => updateText(resolveAllRegions(text, 'left'))}>
              {t('mergeResolve.allLeft')}
            </button>
            <button type="button" className="btn-secondary-sm" disabled={regions.regions.length === 0}
              onClick={() => updateText(resolveAllRegions(text, 'right'))}>
              {t('mergeResolve.allRight')}
            </button>
          </>
        )}
        <button type="button" className="btn-primary-sm flex items-center gap-1" disabled={!canMerge || saving} onClick={merge}>
          <Check size={12} />
          {merged ? t('mergeResolve.merged') : t('mergeResolve.merge')}
        </button>
      </div>

      {/* Rangée du haut : mes modifications | destination */}
      <div className="grid grid-cols-2 min-h-0 border-b border-edge" style={{ flex: '1 1 45%' }}>
        <SidePane
          title={t('mergeResolve.leftPane', { ref: session.leftRef })}
          tone="left"
          text={detail.left}
          binary={detail.kind === 'binary'}
          highlight={leftHighlight}
          yamlSyntax={yamlSyntax}
        />
        <SidePane
          title={t('mergeResolve.rightPane', { ref: session.rightRef })}
          tone="right"
          text={detail.right}
          binary={detail.kind === 'binary'}
          highlight={rightHighlight}
          yamlSyntax={yamlSyntax}
          bordered
        />
      </div>

      {/* Sortie du merge */}
      <div className="flex flex-col min-h-0" style={{ flex: '1 1 55%' }}>
        <PaneTitle>
          {t('mergeResolve.outputPane')}
          {!choiceMode && regions.regions.length > 0 && (
            <span className="ml-2 text-status-warning normal-case">
              {t('mergeResolve.blocksLeft', { count: regions.regions.length })}
            </span>
          )}
        </PaneTitle>
        {choiceMode ? (
          <ChoicePanel detail={detail} choice={choice} onChoose={updateChoice} />
        ) : (
          <div className="flex-1 min-h-0">
            <RawPane value={text} onChange={updateText} labels={takeLabels} yamlSyntax={yamlSyntax}
              onResolve={(key, side) => updateText(resolveRegion(text, key, side))} />
          </div>
        )}
        {!choiceMode && <ValidationBar parseError={regions.error} issues={validation} />}
      </div>
    </div>
  )
}

function lines(side: Side, set: Set<number> | null) {
  return set ? { side, lines: set } : null
}

function PaneTitle({ children, tone }: { children: React.ReactNode; tone?: Side }) {
  const dot = tone === 'left' ? 'bg-status-info-solid' : tone === 'right' ? 'bg-status-success-solid' : null
  return (
    <div className="px-3 py-1 border-b border-edge-subtle bg-canvas text-[11px] uppercase tracking-wide text-ink-3 shrink-0 flex items-center gap-1.5">
      {dot && <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />}
      <span className="truncate">{children}</span>
    </div>
  )
}

function SidePane(props: {
  title: string; tone: Side; text: string | null; binary: boolean
  highlight: { side: Side; lines: Set<number> } | null; yamlSyntax: boolean; bordered?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className={`flex flex-col min-h-0 ${props.bordered ? 'border-l border-edge' : ''}`}>
      <PaneTitle tone={props.tone}>{props.title}</PaneTitle>
      <div className="flex-1 min-h-0">
        {props.text !== null ? (
          <RawPane value={props.text} readOnly highlight={props.highlight} yamlSyntax={props.yamlSyntax} />
        ) : (
          <p className="p-4 text-xs text-ink-3 italic">
            {props.binary ? t('mergeResolve.binaryContent') : t('mergeResolve.absentOnSide')}
          </p>
        )}
      </div>
    </div>
  )
}

function ChoicePanel({ detail, choice, onChoose }: { detail: MergeFileDetail; choice?: Side; onChoose: (s: Side) => void }) {
  const { t } = useTranslation()
  const options: { side: Side; label: string }[] =
    detail.conflict === 'deleted-left'
      ? [{ side: 'right', label: t('mergeResolve.keepModified') }, { side: 'left', label: t('mergeResolve.deleteFile') }]
      : detail.conflict === 'deleted-right'
        ? [{ side: 'left', label: t('mergeResolve.keepModified') }, { side: 'right', label: t('mergeResolve.deleteFile') }]
        : [{ side: 'left', label: t('mergeResolve.takeLeftFile') }, { side: 'right', label: t('mergeResolve.takeRightFile') }]
  return (
    <div className="p-4 flex flex-col gap-3">
      <p className="text-xs text-ink-2">
        {detail.kind === 'binary' ? t('mergeResolve.binaryHint') : t('mergeResolve.deletedHint')}
      </p>
      <div className="flex gap-2">
        {options.map(o => (
          <button key={o.side} type="button" onClick={() => onChoose(o.side)}
            className={choice === o.side ? 'btn-primary-sm' : 'btn-secondary-sm'}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function ValidationBar({ parseError, issues }: { parseError?: string; issues: { errors: MergeValidationIssue[]; warnings: MergeValidationIssue[] } | null }) {
  const { t } = useTranslation()
  const msg = (i: MergeValidationIssue) => t(`mergeResolve.validation.${i.code}`, i.params ?? {})
  const errors = parseError ? [t('mergeResolve.validation.markers', { message: parseError })] : (issues?.errors ?? []).filter(i => i.code !== 'unresolved').map(msg)
  const warnings = (issues?.warnings ?? []).map(msg)
  if (errors.length === 0 && warnings.length === 0) return null
  return (
    <div className="px-3 py-1.5 border-t border-edge text-xs shrink-0 space-y-0.5 max-h-24 overflow-auto">
      {errors.map(e => <p key={e} className="text-status-danger">{e}</p>)}
      {warnings.map(w => <p key={w} className="text-status-warning">{w}</p>)}
    </div>
  )
}
