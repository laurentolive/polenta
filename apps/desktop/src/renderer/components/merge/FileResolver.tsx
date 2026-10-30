import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import yaml from 'js-yaml'
import { Check, Columns3, Eye, FileCode, Redo2, Undo2 } from 'lucide-react'
import {
  canTakeBoth, shortRef, findRegions, parseOutput, resolveRegion, resolveRegionBoth, resolveRegionWith, updateOutputAt,
  yamlStyleOf, type Side,
} from '@polenta/merge-core'
import type {
  MergeFileDetail, MergeFileDraft, MergeKeepBothResult, MergeSessionInfo, MergeValidationIssue, ObjectTypeDefinition,
} from '@polenta/types'
import { api } from '../../api'
import { isEditableTarget } from '../../lib/editableTarget'
import { RichTextProvider } from '../../contexts/RichTextContext'
import { getReqTypeDef, getTestTypeDef, useProjectSchema } from '../../hooks/useProjectSchema'
import { RawPane, type PaneAction, type PaneLabels } from './RawPane'
import { choices, resetBlock, resolvedBlocks, sideAnchors, type ResolvedBlock, type Taken } from './blockLocator'
import { emptyHistory, historyKey, record, redo, undo } from './outputHistory'
import { NavBar } from '../diffkit/NavBar'
import { useChangeNavigation } from '../diffkit/useChangeNavigation'
import { genericPresentation, typedPresentation } from '../treediff/presentation'
import { MergeTreeOutput, MergeTreeTop, useMergeTree } from '../treediff/TreeMerge'
import { DrawioFileDiffView } from '../diff/DrawioFileDiffView'
import { DrawioMergeOutput } from './DrawioMergeOutput'
import { mergePrefs, useElementSync, useScrollSyncGroup, type ScrollSyncGroup } from './scrollSync'
import { useMergeFile, useOutputValidation } from './useMergeSession'

interface Props {
  session: MergeSessionInfo
  path: string
  saveFile: (path: string, draft: MergeFileDraft) => Promise<void>
  onMerged: () => void
  /** « Garder les deux » a recalculé la session (fichiers en conflit renumérotés). */
  onSessionChanged: (session: MergeSessionInfo) => void
  /** GH222 — `F7` après le dernier conflit résolu : fichier suivant à résoudre. */
  onNextFile?: () => void
}

const SAVE_DELAY_MS = 500

type Obj = Record<string, unknown>
type Pane = 'left' | 'base' | 'right'

/**
 * GH37 — résolution d'un fichier. En haut : mes modifications | [ancêtre commun] | destination,
 * en bas sur toute la largeur : la sortie du merge (séparateur redimensionnable). Bascule Raw /
 * Rendu commune à tous les panneaux ; le texte de la sortie reste la seule source de vérité, le
 * mode Rendu l'édite unité par unité (`updateObjectOutput`). GH222 : un bloc résolu peut être
 * repris avec un autre choix ; Ctrl+Z / Ctrl+Y annulent / rétablissent (historique de la sortie).
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

/** A file is resolved by choosing a side (binary, deleted on one side) or by editing a text output
 *  — always the latter for a file brought in by the renumbering (reviewed, present on one side). */
function isChoiceFile(d: MergeFileDetail): boolean {
  if (d.conflict === 'renumbered') return false
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

function Resolver({ session, path, saveFile, onMerged, onSessionChanged, onNextFile, detail }: Props & { detail: MergeFileDetail }) {
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
  // GH222 — historique de la sortie (Ctrl+Z / Ctrl+Y) ; `textNow` suit le texte sans attendre un
  // rendu (deux changements rapprochés).
  const textNow = useRef(text)
  const hist = useRef(emptyHistory())
  const [, bump] = useState(0)
  const setOutput = (next: string) => {
    textNow.current = next
    setText(next)
    update({ state: 'todo', text: next })
  }
  /** A new output text; `group` merges a burst of typing in one place into one undo step. */
  const updateText = (next: string, group?: string) => {
    if (next === textNow.current) return
    hist.current = record(hist.current, textNow.current, group, Date.now())
    bump(n => n + 1)
    setOutput(next)
  }
  const step = (dir: 'undo' | 'redo') => {
    const r = (dir === 'undo' ? undo : redo)(hist.current, textNow.current)
    if (!r) return
    hist.current = r.history
    bump(n => n + 1)
    setOutput(r.text)
  }
  // Ctrl+Z / Ctrl+Y anywhere in the resolver — or with the focus nowhere, as after a click on a
  // choice whose button then goes away. A text field (Rendu) or the Raw editor handles its own.
  const root = useRef<HTMLDivElement>(null)
  const stepNow = useRef(step)
  stepNow.current = step
  useEffect(() => {
    if (choiceMode) return
    const onKey = (e: KeyboardEvent) => {
      const dir = historyKey(e)
      const el = e.target as HTMLElement
      const box = root.current
      if (!dir || e.defaultPrevented || !box || box.offsetParent === null) return
      if (el !== document.body && !box.contains(el)) return
      if (isEditableTarget(el) || el.closest('select')) return
      // Not the System view's own Ctrl+Z (listening on `window`): this one is the merge's.
      e.preventDefault()
      e.stopPropagation()
      stepNow.current(dir)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [choiceMode])
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
  // GH222 — every YAML file has a Rendu (generic view); typed objects get their schema's labels.
  // A file to resolve by choosing a side (deleted on one side) can be read rendered too.
  const canRender = RENDERABLE.has(detail.kind)
  const rendered = mode === 'rendered' && canRender
  const presentation = useMemo(() => (typeDef ? typedPresentation(typeDef, t) : genericPresentation), [typeDef, t])
  // GH222 — ce que chaque côté a changé depuis l'ancêtre (ligne et caractères).
  const against = useMemo(() => ({
    left: { base: detail.base, side: 'left' as Side },
    right: { base: detail.base, side: 'right' as Side },
  }), [detail.base])

  const yamlSyntax = /\.ya?ml$/i.test(path)
  const paneLabels: PaneLabels = useMemo(() => ({
    takeLeft: t('mergeResolve.takeLeft'),
    takeRight: t('mergeResolve.takeRight'),
    takeBoth: t('mergeResolve.takeBoth'),
    takeBase: t('mergeResolve.takeBase'),
    reset: t('mergeResolve.reset'),
    resolved: {
      left: t('mergeResolve.resolvedLeft'), right: t('mergeResolve.resolvedRight'), both: t('mergeResolve.resolvedBoth'),
      base: t('mergeResolve.resolvedBase'),
    },
    ruler: t('diffkit.change.ruler'),
  }), [t])
  const group = useScrollSyncGroup()
  const units = detail.kind === 'object'

  // ─── GH222 : blocs dans chaque panneau, résolus, navigation ──────────────────────
  const markerLabels = useMemo(() => ({ left: shortRef(session.leftRef), right: shortRef(session.rightRef) }), [session.leftRef, session.rightRef])
  // Open blocks as a stable signature: typing in the output does not rebuild the side actions.
  const openSig = regions.regions.map(r => r.key).join('\u0000')

  // Where each block's region is (or was when resolved): the resolved text and the side
  // fragments are looked for nearest to it (a short fragment may appear elsewhere in the file).
  const initialHints = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of findRegions(detail.initialOutput ?? '').regions) m.set(r.key, r.start)
    return m
  }, [detail.initialOutput])
  const [resolvedAt, setResolvedAt] = useState<Map<string, number>>(new Map())
  const hints = useMemo(() => new Map([...initialHints, ...resolvedAt]), [initialHints, resolvedAt])
  const resolved = useMemo(() => (choiceMode ? NONE : resolvedBlocks(text, detail.blocks, markerLabels, hints)), [choiceMode, text, detail.blocks, markerLabels, hints])
  // Latest output, resolved blocks and updater, for the actions built once per set of blocks.
  const latest = useRef({ text, regions, resolved, updateText })
  latest.current = { text, regions, resolved, updateText }

  /** Resolves a block with `taken` — an open one, or a resolved one (changing one's mind: its
   *  region is put back, then the new choice taken). « Prendre l'ancêtre » takes the block's
   *  ancestor fragment (`''` = the node goes away). */
  const choose = (key: string, taken: Taken) => {
    const { text: current, regions: open, resolved: done, updateText: update } = latest.current
    const block = detail.blocks.find(b => b.key === key)
    let from = current
    let at = open.regions.find(r => r.key === key)?.start
    if (at === undefined) {
      const found = done.find(r => r.key === key)
      if (!found || !block) return
      from = resetBlock(current, block, found, markerLabels)
      at = found.from
    }
    const next = taken === 'both' ? resolveRegionBoth(from, key)
      : taken === 'base' ? (block?.base === undefined ? from : resolveRegionWith(from, key, block.base))
        : resolveRegion(from, key, taken)
    if (next === from) return
    const line = at
    setResolvedAt(prev => new Map(prev).set(key, line))
    update(next)
  }
  /** « Tout à gauche / droite » : every block, open or resolved otherwise, takes `side`. Bottom-up,
   *  so that each block's line stays valid. */
  const takeAll = (side: Side) => {
    let next = text
    const others = resolved.filter(r => r.taken !== side).sort((a, b) => b.from - a.from)
    for (const r of others) {
      const block = detail.blocks.find(b => b.key === r.key)
      if (block) next = resetBlock(next, block, r, markerLabels)
    }
    const at = new Map<string, number>()
    for (const r of [...findRegions(next).regions].sort((a, b) => b.start - a.start)) {
      next = resolveRegion(next, r.key, side)
      at.set(r.key, r.start)
    }
    if (next === text) return
    setResolvedAt(prev => new Map([...prev, ...at]))
    updateText(next)
  }
  const canTakeAll = (side: Side) => regions.regions.length > 0 || resolved.some(r => r.taken !== side)
  const takeBase = (key: string) => choose(key, 'base')
  const canTakeBase = (key: string) => detail.blocks.find(b => b.key === key)?.base !== undefined
  /** Choices still possible on a resolved block (Rendu). */
  const otherChoices = (r: ResolvedBlock): Taken[] => {
    const block = detail.blocks.find(b => b.key === r.key)
    return block ? choices(block, markerLabels).filter(c => c !== r.taken && (c !== 'base' || showBase)) : []
  }

  // Each side's action, on open blocks and on blocks resolved otherwise (changing one's mind).
  const resolvedSig = resolved.map(r => `${r.key}\u0000${r.taken}\u0000${r.from}`).join('\u0001')
  const sideActions = useMemo(() => {
    const at = new Map<string, number>(latest.current.regions.regions.map(r => [r.key, r.start] as const))
    const taken = new Map<string, Taken>()
    for (const r of latest.current.resolved) { at.set(r.key, r.from); taken.set(r.key, r.taken) }
    const make = (side: Side | 'base'): PaneAction[] => {
      const sideText = side === 'left' ? detail.left : side === 'right' ? detail.right : detail.base
      if (sideText === null || choiceMode) return []
      return sideAnchors(sideText, detail.blocks, at, side).filter(a => taken.get(a.key) !== side).map(a => ({
        key: a.key,
        line: a.line,
        label: side === 'left' ? t('mergeResolve.takeLeft') : side === 'right' ? t('mergeResolve.takeRight') : t('mergeResolve.takeBase'),
        run: () => choose(a.key, side),
      }))
    }
    return { left: make('left'), right: make('right'), base: make('base') }
    // choose reads the latest state through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, openSig, resolvedSig, choiceMode, t])
  const resetBlockOf = (found: ResolvedBlock) => {
    const block = detail.blocks.find(b => b.key === found.key)
    if (block) updateText(resetBlock(text, block, found, markerLabels))
  }
  const outputLabels = useMemo(() => ({ ...paneLabels, ruler: t('diffkit.conflict.ruler') }), [paneLabels, t])

  // ─── GH222 : vue générique (Rendu) ───────────────────────────────────────────────
  const parsedOutput = useMemo(() => (rendered ? parseOutput(detail.kind, text) : null), [rendered, detail.kind, text])
  const openKeys = useMemo(() => regions.regions.map(r => r.key), [regions])
  const tree = useMergeTree({
    enabled: rendered && detail.kind !== 'drawio', detail, presentation, openKeys, resolved: rendered ? resolved : NONE, parsedOutput: parsedOutput?.value,
  })
  // An edit in place is written in the file's own YAML style.
  const outputStyle = useMemo(() => yamlStyleOf(detail.right ?? detail.left ?? '') ?? undefined, [detail.right, detail.left])
  const editAt = (outPath: (string | number)[], value: unknown) => {
    const next = updateOutputAt(latest.current.text, outPath, value, outputStyle)
    if (next !== null) updateText(next, `edit:${JSON.stringify(outPath)}`)
  }

  const outputBox = useRef<HTMLDivElement>(null)
  const [reveal, setReveal] = useState<{ from: number; to: number } | null>(null)
  const goConflict = (i: number) => {
    const r = regions.regions[i]
    if (!r) return
    if (rendered) {
      outputBox.current?.querySelector(`[data-unit="${CSS.escape(r.key)}"]`)?.scrollIntoView({ block: 'start' })
    } else {
      setReveal({ from: r.start, to: r.end })
    }
  }
  const nav = useChangeNavigation(regions.regions.length, goConflict, {
    onPastEnd: regions.regions.length === 0 ? onNextFile : undefined,
    listKey: openSig,
    // A file resolved by choosing a side has no conflict to walk through: F7 stays put.
    enabled: !choiceMode,
  })

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
    const title = pane === 'left'
      ? t('mergeResolve.leftPane', { ref: shortRef(session.leftRef) })
      : pane === 'right' ? t('mergeResolve.rightPane', { ref: shortRef(session.rightRef) }) : t('mergeResolve.basePane')
    const tone = pane === 'base' ? undefined : pane
    let content: ReactNode
    const image = detail.images?.[pane]
    if (image) {
      content = (
        <div className="h-full overflow-auto p-3 flex items-start justify-center bg-canvas">
          <img src={image} alt={title} className="max-w-full border border-edge" />
        </div>
      )
    } else if (textOf === null) {
      content = (
        <p className="p-4 text-xs text-ink-3 italic">
          {detail.kind === 'binary' ? t('mergeResolve.binaryContent')
            : pane === 'base' ? t('mergeResolve.absentInBase') : t('mergeResolve.absentOnSide')}
        </p>
      )
    } else {
      content = (
        <RawPane value={textOf} readOnly yamlSyntax={yamlSyntax} labels={paneLabels}
          against={pane === 'base' ? null : against[pane]}
          actions={sideActions[pane]}
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

  let output: ReactNode
  if (choiceMode) {
    output = <ChoicePanel detail={detail} choice={choice} onChoose={updateChoice} />
  } else if (rendered && detail.kind === 'drawio') {
    output = (
      <DrawioMergeOutput text={text} repoPath={session.repoPath} filepath={path}
        leftAt={session.leftOid} rightAt={session.rightOid}
        onTake={choose} />
    )
  } else if (rendered && parsedOutput?.value && !parsedOutput.error) {
    output = (
      <SyncedTree group={group} id="output">
        <MergeTreeOutput model={tree} typeDef={typeDef} repoPath={session.repoPath}
          canBoth={key => canTakeBoth(text, key)}
          onTake={choose}
          onBoth={key => choose(key, 'both')}
          onBase={showBase ? takeBase : undefined}
          canBase={canTakeBase}
          onReset={resetBlockOf}
          otherChoices={otherChoices}
          onSwitch={(r, taken) => choose(r.key, taken)}
          onEdit={editAt}
          labels={{ output: t('mergeResolve.outputPane'), resolved: paneLabels.resolved }} />
      </SyncedTree>
    )
  } else if (rendered) {
    output = <p className="p-4 text-xs text-status-warning">{t('mergeResolve.renderUnavailable')}</p>
  } else {
    output = (
      <RawPane value={text} onChange={next => updateText(next, 'type')} labels={outputLabels} yamlSyntax={yamlSyntax}
        onResolve={choose}
        onBoth={key => choose(key, 'both')}
        onBase={showBase ? takeBase : undefined}
        blocks={detail.blocks}
        markerLabels={markerLabels}
        hints={hints}
        onReset={resetBlockOf}
        onSwitch={(r, taken) => choose(r.key, taken)}
        onUndo={() => step('undo')}
        onRedo={() => step('redo')}
        reveal={reveal}
        sync={{ group, id: 'output', units }} />
    )
  }

  return (
    <div ref={root} className="flex flex-col h-full min-h-0">
      {/* En-tête du fichier */}
      <div className="px-4 pt-2 shrink-0 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-mono text-sm text-ink font-medium truncate">{path}</p>
          <p className="text-xs text-ink-3 truncate">
            {t(`mergeResolve.conflict.${detail.conflict}`)}
            {detail.objectId && <> · {detail.objectId}{detail.title ? ` — ${detail.title}` : ''}</>}
          </p>
        </div>
        {/* Raw / Rendu et ancêtre commun : icônes seules, libellé en info-bulle. */}
        <div className="flex rounded border border-edge overflow-hidden shrink-0" role="group">
          <ToggleButton active={!rendered} onClick={() => setMode('raw')} icon={<FileCode size={12} />} label={t('mergeResolve.modeRaw')} />
          <ToggleButton active={rendered} disabled={!canRender} onClick={() => setMode('rendered')} icon={<Eye size={12} />}
            label={t('mergeResolve.modeRendered')} title={canRender ? undefined : t('mergeResolve.renderNotSupported')} />
        </div>
        <ToggleButton active={showBase} onClick={() => setShowBase(!showBase)} icon={<Columns3 size={12} />}
          label={t('mergeResolve.showBase')} framed />
        <button type="button" className="btn-primary-sm flex items-center gap-1 shrink-0" disabled={!canMerge || saving} onClick={merge}>
          <Check size={12} />
          {merged ? t('mergeResolve.merged') : t('mergeResolve.merge')}
        </button>
      </div>
      {!choiceMode && (
        <div className="px-4 py-2 border-b border-edge shrink-0 flex flex-wrap items-center gap-2">
          <NavBar kind="conflict" index={nav.index} count={regions.regions.length} onPrev={nav.prev} onNext={nav.next} />
          <div className="flex rounded border border-edge overflow-hidden shrink-0" role="group">
            <button type="button" className="px-1.5 py-1 bg-surface text-ink-2 hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={hist.current.past.length === 0} onClick={() => step('undo')}
              title={t('mergeResolve.undo')} aria-label={t('mergeResolve.undo')}>
              <Undo2 size={12} />
            </button>
            <button type="button" className="px-1.5 py-1 bg-surface text-ink-2 hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed border-l border-edge"
              disabled={hist.current.future.length === 0} onClick={() => step('redo')}
              title={t('mergeResolve.redo')} aria-label={t('mergeResolve.redo')}>
              <Redo2 size={12} />
            </button>
          </div>
          <button type="button" className="btn-secondary-sm shrink-0" disabled={!canTakeAll('left')}
            onClick={() => takeAll('left')}>
            {t('mergeResolve.allLeft')}
          </button>
          <button type="button" className="btn-secondary-sm shrink-0" disabled={!canTakeAll('right')}
            onClick={() => takeAll('right')}>
            {t('mergeResolve.allRight')}
          </button>
        </div>
      )}

      <RichTextProvider>
        <div ref={body} className="flex-1 min-h-0 flex flex-col">
          {/* Rangée du haut : mes modifications | [ancêtre commun] | destination */}
          {rendered && detail.kind === 'drawio'
            ? (
              // GH222 — `.drawio` : pages de chaque côté, à leur commit (même vue que les diffs).
              <div className="min-h-0" style={{ height: `${split}%` }}>
                <DrawioFileDiffView repoPath={session.repoPath} filepath={path} hideUnchanged={false}
                  before={{ at: session.leftOid, missing: detail.left === null, label: t('mergeResolve.leftPane', { ref: shortRef(session.leftRef) }) }}
                  after={{ at: session.rightOid, missing: detail.right === null, label: t('mergeResolve.rightPane', { ref: shortRef(session.rightRef) }) }} />
              </div>
            )
            : rendered
            ? (
              // GH222 — vue générique : une seule grille, colonne Structure + un panneau par version.
              <div className="min-h-0" style={{ height: `${split}%` }}>
                <SyncedTree group={group} id="top">
                  <MergeTreeTop model={tree} showBase={showBase} typeDef={typeDef} repoPath={session.repoPath}
                    labels={{
                      left: t('mergeResolve.leftPane', { ref: shortRef(session.leftRef) }),
                      base: t('mergeResolve.basePane'),
                      right: t('mergeResolve.rightPane', { ref: shortRef(session.rightRef) }),
                    }}
                    onTake={choose}
                    onBase={takeBase} canBase={canTakeBase} />
                </SyncedTree>
              </div>
            )
            : (
              <div className={`grid min-h-0 ${showBase ? 'grid-cols-3' : 'grid-cols-2'}`} style={{ height: `${split}%` }}>
                {sidePane('left')}
                {showBase && sidePane('base')}
                {sidePane('right')}
              </div>
            )}

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
            {detail.conflict === 'both-added' && detail.kind === 'object' && (
              <KeepBothBar session={session} path={path} onApplied={onSessionChanged} />
            )}
            <div ref={outputBox} className="flex-1 min-h-0">{output}</div>
            {!choiceMode && <ValidationBar parseError={regions.error} issues={validation} />}
          </div>
        </div>
      </RichTextProvider>
    </div>
  )
}

const NONE: ResolvedBlock[] = []

/** File kinds the generic view can show (YAML). */
const RENDERABLE = new Set<MergeFileDetail['kind']>(['object', 'links', 'parameters', 'yaml', 'trees', 'drawio'])

/** A scrolling pane of the generic view, kept on the same row as the other panes. */
function SyncedTree({ group, id, children }: { group: ScrollSyncGroup; id: string; children: ReactNode }) {
  const { ref, onScroll } = useElementSync(group, id, 'data-row-key')
  return <div ref={ref} onScroll={onScroll} className="relative h-full overflow-auto" data-testid={`merge-tree-${id}`}>{children}</div>
}

/** Icon-only toggle; `label` is its tooltip (`title` replaces it). `framed`: standalone, with its own border. */
function ToggleButton({ active, disabled, onClick, icon, label, title, framed }: {
  active: boolean; disabled?: boolean; onClick: () => void; icon: ReactNode; label: string; title?: string; framed?: boolean
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title ?? label} aria-label={label} aria-pressed={active}
      className={`px-2 py-1.5 flex items-center shrink-0 ${framed ? 'rounded border border-edge' : ''} ${active ? 'bg-prim text-prim-fg' : 'bg-surface text-ink-2 hover:bg-surface-hover'} disabled:opacity-40 disabled:cursor-not-allowed`}>
      {icon}
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

/**
 * « Garder les deux » (sprint 3) : l'objet de gauche reçoit le prochain ID libre, ses références
 * côté gauche suivent. Aperçu (ID attribué, fichiers réécrits) avant confirmation.
 */
function KeepBothBar({ session, path, onApplied }: { session: MergeSessionInfo; path: string; onApplied: (s: MergeSessionInfo) => void }) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<MergeKeepBothResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (apply: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.mergeResolution.keepBoth(session.id, path, apply)
      if (apply && res.session) onApplied(res.session)
      else setPreview(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="px-3 py-2 border-b border-edge bg-status-info-bg text-xs shrink-0">
      {!preview ? (
        <div className="flex items-center gap-2">
          <p className="flex-1 text-ink-2">{t('mergeResolve.keepBoth.hint')}</p>
          <button type="button" className="btn-secondary-sm" disabled={busy} onClick={() => void run(false)}>
            {t('mergeResolve.keepBoth.button')}
          </button>
        </div>
      ) : (
        <div>
          <p className="text-ink mb-1">{t('mergeResolve.keepBoth.preview', { oldId: preview.oldId, newId: preview.newId })}</p>
          <ul className="font-mono text-ink-2 list-disc list-inside max-h-24 overflow-auto mb-2">
            {preview.impacted.map(p => <li key={p}>{p}</li>)}
          </ul>
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn-secondary-sm" disabled={busy} onClick={() => setPreview(null)}>{t('common.cancel')}</button>
            <button type="button" className="btn-primary-sm" disabled={busy} onClick={() => void run(true)}>
              {t('mergeResolve.keepBoth.confirm', { newId: preview.newId })}
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-status-danger mt-1">{error}</p>}
    </div>
  )
}
