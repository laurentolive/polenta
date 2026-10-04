import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import yaml from 'js-yaml'
import { Check, Columns3, Eye, FileCode } from 'lucide-react'
import {
  changedLineIndexes, changedUnits, findRegions, parseOutput, regionFragments, resolveAllRegions, resolveRegion,
  updateObjectOutput, type Side,
} from '@polenta/merge-core'
import type {
  MergeFileDetail, MergeFileDraft, MergeSessionInfo, MergeValidationIssue, ObjectTypeDefinition,
} from '@polenta/types'
import { RichTextProvider } from '../../contexts/RichTextContext'
import { getReqTypeDef, getTestTypeDef, useProjectSchema } from '../../hooks/useProjectSchema'
import { RawPane } from './RawPane'
import { RenderedObjectPane } from './RenderedObjectPane'
import { mergePrefs, useElementSync, useScrollSyncGroup, type ScrollSyncGroup } from './scrollSync'
import { useMergeFile, useOutputValidation } from './useMergeSession'

interface Props {
  session: MergeSessionInfo
  path: string
  saveFile: (path: string, draft: MergeFileDraft) => Promise<void>
  onMerged: () => void
}

const SAVE_DELAY_MS = 500

type Obj = Record<string, unknown>
type Pane = 'left' | 'base' | 'right'

/**
 * GH37 — résolution d'un fichier. En haut : mes modifications | [ancêtre commun] | destination,
 * en bas sur toute la largeur : la sortie du merge (séparateur redimensionnable). Bascule Raw /
 * Rendu commune à tous les panneaux ; le texte de la sortie reste la seule source de vérité, le
 * mode Rendu l'édite unité par unité (`updateObjectOutput`).
 */
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

function loadObject(text: string | null): Obj | null {
  if (text === null) return null
  try {
    const v = yaml.load(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null
  } catch {
    return null
  }
}

function Resolver({ session, path, saveFile, onMerged, detail }: Props & { detail: MergeFileDetail }) {
  const { t } = useTranslation()
  const choiceMode = isChoiceFile(detail)
  const [text, setText] = useState<string>(detail.draft?.text ?? detail.initialOutput ?? '')
  const [choice, setChoice] = useState<Side | undefined>(detail.draft?.choice)
  const [merged, setMerged] = useState(detail.state === 'merged')
  const [saving, setSaving] = useState(false)
  const [mode, setModeState] = useState(mergePrefs.mode)
  const [showBase, setShowBaseState] = useState(mergePrefs.showBase)
  const [split, setSplit] = useState(mergePrefs.split)
  const setMode = (m: 'raw' | 'rendered') => { setModeState(m); mergePrefs.setMode(m) }
  const setShowBase = (v: boolean) => { setShowBaseState(v); mergePrefs.setShowBase(v) }

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

  // ─── Mode Rendu : type de l'objet et valeurs des trois versions ───────────────────
  const { data: schema } = useProjectSchema(session.repoPath)
  const objects = useMemo(() => ({
    base: loadObject(detail.base), left: loadObject(detail.left), right: loadObject(detail.right),
  }), [detail.base, detail.left, detail.right])
  const typeDef: ObjectTypeDefinition | undefined = useMemo(() => {
    const ref = String((objects.right ?? objects.left)?.objectTypeRef ?? '')
    return ref ? getReqTypeDef(schema, ref) ?? getTestTypeDef(schema, ref) : undefined
  }, [schema, objects])
  const canRender = detail.kind === 'object' && !!typeDef
  const rendered = mode === 'rendered' && canRender

  const changed = useMemo(() => ({
    left: objects.left ? changedUnits(objects.base, objects.left) : new Set<string>(),
    right: objects.right ? changedUnits(objects.base, objects.right) : new Set<string>(),
  }), [objects])
  const lineHighlight = useMemo(() => ({
    left: detail.left === null ? null : withSide('left', changedLineIndexes(detail.base, detail.left)),
    right: detail.right === null ? null : withSide('right', changedLineIndexes(detail.base, detail.right)),
  }), [detail.base, detail.left, detail.right])

  const yamlSyntax = /\.ya?ml$/i.test(path)
  const takeLabels = useMemo(() => ({ takeLeft: t('mergeResolve.takeLeft'), takeRight: t('mergeResolve.takeRight') }), [t])
  const group = useScrollSyncGroup()
  const units = detail.kind === 'object'

  // ─── Séparateur haut / sortie ────────────────────────────────────────────────────
  const body = useRef<HTMLDivElement>(null)
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const rect = body.current!.getBoundingClientRect()
    let last = split
    const move = (ev: PointerEvent) => {
      last = Math.min(85, Math.max(15, ((ev.clientY - rect.top) / rect.height) * 100))
      setSplit(last)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      mergePrefs.setSplit(last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const sidePane = (pane: Pane) => {
    const textOf = pane === 'left' ? detail.left : pane === 'right' ? detail.right : detail.base
    const obj = objects[pane]
    const title = pane === 'left'
      ? t('mergeResolve.leftPane', { ref: session.leftRef })
      : pane === 'right' ? t('mergeResolve.rightPane', { ref: session.rightRef }) : t('mergeResolve.basePane')
    const tone = pane === 'base' ? undefined : pane
    let content: ReactNode
    if (textOf === null) {
      content = (
        <p className="p-4 text-xs text-ink-3 italic">
          {detail.kind === 'binary' ? t('mergeResolve.binaryContent')
            : pane === 'base' ? t('mergeResolve.absentInBase') : t('mergeResolve.absentOnSide')}
        </p>
      )
    } else if (rendered && obj) {
      content = (
        <SyncedRendered group={group} id={pane} value={obj} typeDef={typeDef} repoPath={session.repoPath}
          tone={tone} changed={pane === 'base' ? undefined : changed[pane]} />
      )
    } else {
      content = (
        <RawPane value={textOf} readOnly yamlSyntax={yamlSyntax}
          highlight={pane === 'base' ? null : lineHighlight[pane]}
          sync={{ group, id: pane, units }} />
      )
    }
    return (
      <div key={pane} className={`flex flex-col min-h-0 min-w-0 ${pane !== 'left' ? 'border-l border-edge' : ''}`}>
        <PaneTitle tone={tone}>{title}</PaneTitle>
        <div className="flex-1 min-h-0">{content}</div>
      </div>
    )
  }

  const parsed = useMemo(() => (rendered ? parseOutput('object', text) : null), [rendered, text])
  const conflicts = useMemo(() => (rendered ? regionFragments(text) : undefined), [rendered, text])

  let output: ReactNode
  if (choiceMode) {
    output = <ChoicePanel detail={detail} choice={choice} onChoose={updateChoice} />
  } else if (rendered && parsed?.value && !parsed.error) {
    output = (
      <SyncedRendered group={group} id="output" value={parsed.value} typeDef={typeDef} repoPath={session.repoPath}
        conflicts={conflicts}
        onResolve={(key, side) => updateText(resolveRegion(text, key, side))}
        onChangeUnit={(key, value) => {
          const next = updateObjectOutput(text, key, value)
          if (next !== null) updateText(next)
        }} />
    )
  } else if (rendered) {
    output = <p className="p-4 text-xs text-status-warning">{t('mergeResolve.renderUnavailable')}</p>
  } else {
    output = (
      <RawPane value={text} onChange={updateText} labels={takeLabels} yamlSyntax={yamlSyntax}
        onResolve={(key, side) => updateText(resolveRegion(text, key, side))}
        sync={{ group, id: 'output', units }} />
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* En-tête du fichier */}
      <div className="px-4 pt-2 shrink-0 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-mono text-sm text-ink font-medium truncate">{path}</p>
          <p className="text-xs text-ink-3 truncate">
            {t(`mergeResolve.conflict.${detail.conflict}`)}
            {detail.objectId && <> · {detail.objectId}{detail.title ? ` — ${detail.title}` : ''}</>}
          </p>
        </div>
        <button type="button" className="btn-primary-sm flex items-center gap-1 shrink-0" disabled={!canMerge || saving} onClick={merge}>
          <Check size={12} />
          {merged ? t('mergeResolve.merged') : t('mergeResolve.merge')}
        </button>
      </div>
      <div className="px-4 py-2 border-b border-edge shrink-0 flex flex-wrap items-center gap-2">
        <div className="flex rounded border border-edge overflow-hidden shrink-0" role="group">
          <ToggleButton active={!rendered} onClick={() => setMode('raw')} icon={<FileCode size={12} />} label={t('mergeResolve.modeRaw')} />
          <ToggleButton active={rendered} disabled={!canRender} onClick={() => setMode('rendered')} icon={<Eye size={12} />}
            label={t('mergeResolve.modeRendered')} title={canRender ? undefined : t('mergeResolve.renderNotSupported')} />
        </div>
        <button type="button" onClick={() => setShowBase(!showBase)} aria-pressed={showBase}
          className={`${showBase ? 'btn-primary-sm' : 'btn-secondary-sm'} flex items-center gap-1 shrink-0`}>
          <Columns3 size={12} />
          {t('mergeResolve.showBase')}
        </button>
        {!choiceMode && (
          <>
            <button type="button" className="btn-secondary-sm shrink-0" disabled={regions.regions.length === 0}
              onClick={() => updateText(resolveAllRegions(text, 'left'))}>
              {t('mergeResolve.allLeft')}
            </button>
            <button type="button" className="btn-secondary-sm shrink-0" disabled={regions.regions.length === 0}
              onClick={() => updateText(resolveAllRegions(text, 'right'))}>
              {t('mergeResolve.allRight')}
            </button>
          </>
        )}
      </div>

      <RichTextProvider>
        <div ref={body} className="flex-1 min-h-0 flex flex-col">
          {/* Rangée du haut : mes modifications | [ancêtre commun] | destination */}
          <div className={`grid min-h-0 ${showBase ? 'grid-cols-3' : 'grid-cols-2'}`} style={{ height: `${split}%` }}>
            {sidePane('left')}
            {showBase && sidePane('base')}
            {sidePane('right')}
          </div>

          <div
            role="separator"
            aria-orientation="horizontal"
            onPointerDown={startDrag}
            className="h-1.5 shrink-0 cursor-row-resize bg-edge hover:bg-ink-3 transition-colors"
          />

          {/* Sortie du merge */}
          <div className="flex-1 min-h-0 flex flex-col">
            <PaneTitle>
              {t('mergeResolve.outputPane')}
              {!choiceMode && regions.regions.length > 0 && (
                <span className="ml-2 text-status-warning normal-case">
                  {t('mergeResolve.blocksLeft', { count: regions.regions.length })}
                </span>
              )}
            </PaneTitle>
            <div className="flex-1 min-h-0">{output}</div>
            {!choiceMode && <ValidationBar parseError={regions.error} issues={validation} />}
          </div>
        </div>
      </RichTextProvider>
    </div>
  )
}

function withSide(side: Side, set: Set<number> | null) {
  return set ? { side, lines: set } : null
}

function SyncedRendered(props: { group: ScrollSyncGroup; id: string } & Omit<React.ComponentProps<typeof RenderedObjectPane>, 'onScroll'>) {
  const { group, id, ...rest } = props
  const { ref, onScroll } = useElementSync(group, id)
  return <RenderedObjectPane ref={ref} onScroll={onScroll} {...rest} />
}

function ToggleButton({ active, disabled, onClick, icon, label, title }: {
  active: boolean; disabled?: boolean; onClick: () => void; icon: ReactNode; label: string; title?: string
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-pressed={active}
      className={`px-2 py-1 text-xs flex items-center gap-1 ${active ? 'bg-prim text-prim-fg' : 'bg-surface text-ink-2 hover:bg-surface-hover'} disabled:opacity-40 disabled:cursor-not-allowed`}>
      {icon}{label}
    </button>
  )
}

function PaneTitle({ children, tone }: { children: ReactNode; tone?: Side }) {
  const dot = tone === 'left' ? 'bg-status-info-solid' : tone === 'right' ? 'bg-status-success-solid' : 'bg-ink-3'
  return (
    <div className="px-3 py-1 border-b border-edge-subtle bg-canvas text-[11px] uppercase tracking-wide text-ink-3 shrink-0 flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
      <span className="truncate">{children}</span>
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
  const errors = parseError
    ? [t('mergeResolve.validation.markers', { message: parseError })]
    : (issues?.errors ?? []).filter(i => i.code !== 'unresolved').map(msg)
  const warnings = (issues?.warnings ?? []).map(msg)
  if (errors.length === 0 && warnings.length === 0) return null
  return (
    <div className="px-3 py-1.5 border-t border-edge text-xs shrink-0 space-y-0.5 max-h-24 overflow-auto">
      {errors.map(e => <p key={e} className="text-status-danger">{e}</p>)}
      {warnings.map(w => <p key={w} className="text-status-warning">{w}</p>)}
    </div>
  )
}
