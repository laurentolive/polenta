import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import yaml from 'js-yaml'
import { Columns2, Eye, FileCode, Pencil, Rows2, Save } from 'lucide-react'
import type { FileDiffContents } from '@polenta/api-client'
import type { ObjectTypeDefinition, ProjectSchema } from '@polenta/types'
import { lineStats } from '../../lib/diffStats'
import { diffPrefs } from '../../lib/diffPrefs'
import { getReqTypeDef, getTestTypeDef, useProjectSchema } from '../../hooks/useProjectSchema'
import { useSchemaAt } from '../../hooks/useSchemaAt'
import { RawDiffView } from './RawDiffView'
import { keyedKindOf, LINKS_DESC, OBJECT_DESC, PARAMETERS_DESC, yamlStyleOf, type StructureDesc } from '@polenta/merge-core'
import { isAppMaintainedFile, type DiffSaveResult } from '@polenta/types'
import { api } from '../../api'
import { useRegisterTabDirty } from '../../contexts/TabsContext'
import { TreeDiffView } from '../treediff/TreeDiffView'
import { genericPresentation, typedPresentation } from '../treediff/presentation'
import { DrawioFileDiffView } from './DrawioFileDiffView'

type Obj = Record<string, unknown>
/** `value` : the parsed YAML (`undefined` = absent from that version), `obj` : the same when it is a mapping. */
type Parsed = { value: unknown; obj: Obj | null; invalid: boolean }

/**
 * GH178 — diff d'un fichier, commun aux trois écrans (`/version-diff`, `/diff` working tree et
 * commit) : sous-en-tête (chemin, `+n / −n`, bascule Raw / Rendu) puis le diff dans le mode choisi.
 * Le Rendu est proposé pour une exigence ou un test dont le type se résout dans le schéma, et pour un `.drawio`.
 * GH222 : Raw sur `@codemirror/merge` (côte à côte / en ligne, navigation, règle de vue d'ensemble).
 * GH222 §12 : une modification locale (Après = working tree) se modifie dans le diff — brouillon,
 * « ← Rétablir », « Enregistrer » / `Ctrl+S`.
 */
export function FileDiffView({ repoPath, filepath, contents, isLoading, showPath = true }: {
  repoPath: string
  filepath: string
  contents?: FileDiffContents
  isLoading: boolean
  /** Le chemin est déjà dans le titre de la vue (`/diff`). */
  showPath?: boolean
}) {
  const { t } = useTranslation()
  const [mode, setModeState] = useState(diffPrefs.mode)
  const [hideUnchanged, setHideUnchangedState] = useState(diffPrefs.hideUnchanged)
  const setMode = (m: 'raw' | 'rendered') => { setModeState(m); diffPrefs.setMode(m) }
  const setHideUnchanged = (v: boolean) => { setHideUnchangedState(v); diffPrefs.setHideUnchanged(v) }
  const [layout, setLayoutState] = useState(diffPrefs.layout)
  const setLayout = (v: 'side' | 'inline') => { setLayoutState(v); diffPrefs.setLayout(v) }
  // The Raw view mounts its navigation (« 3 / 12 », précédent / suivant) in this sub-header.
  const [navSlot, setNavSlot] = useState<HTMLElement | null>(null)

  // ─── GH222 §12 : côté Après modifiable (modification locale) ──────────────────────
  const editable = !!contents && contents.newRef === null && !contents.newMissing && !isAppMaintainedFile(filepath)
  // The draft keeps the text it started from (`baseline`): a re-read of the file (window focus,
  // another tool) never drops it, and a change on disk is caught when saving (`changed`).
  const [draft, setDraft] = useState<{ text: string; baseline: string } | null>(null)
  const [saveState, setSaveState] = useState<{ busy?: boolean; error?: DiffSaveResult; saved?: boolean }>({})
  useEffect(() => { setDraft(null); setSaveState({}) }, [filepath, repoPath])
  const afterText = draft?.text ?? contents?.newContent ?? ''
  const dirty = editable && draft !== null && draft.text !== draft.baseline
  useRegisterTabDirty(dirty)
  const qc = useQueryClient()
  const editDraft = (text: string) => {
    setDraft(d => ({ text, baseline: d?.baseline ?? contents?.newContent ?? '' }))
    setSaveState({})
  }
  const save = async () => {
    if (!dirty || draft === null) return
    setSaveState({ busy: true })
    try {
      const res = await api.diffEdit.saveWorkingFile(repoPath, filepath, draft.text, draft.baseline)
      if (!res.ok) { setSaveState({ error: res }); return }
      setDraft(null)
      setSaveState({ saved: true })
      await refresh()
    } catch (err) {
      setSaveState({ error: { ok: false, reason: 'invalid', message: err instanceof Error ? err.message : String(err) } })
    }
  }
  // The diff, the Version panel and the object views read the file again — not the whole app.
  const refresh = () => qc.invalidateQueries({
    predicate: q => typeof q.queryKey[0] === 'string' && /^(sync|status|requirements|tests|links|history|diff)/.test(q.queryKey[0]),
  })
  const reload = async () => { setDraft(null); setSaveState({}); await refresh() }
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    if (!editable) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void saveRef.current() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editable])

  const stats = useMemo(
    () => (contents ? lineStats(contents.oldContent, afterText) : { added: 0, removed: 0 }),
    [contents, afterText],
  )

  const oldRef = contents?.oldRef ?? null
  const newRef = contents?.newRef ?? null
  const isYaml = /\.ya?ml$/i.test(filepath)
  const before = useMemo(() => parseSide(isYaml, contents?.oldContent, contents?.oldMissing), [isYaml, contents])
  const after = useMemo(() => parseSide(isYaml, afterText, contents?.newMissing), [isYaml, afterText, contents])
  // Rendu edits rewrite the YAML: only for a file written as the app writes it (no comment lost).
  const editStyle = useMemo(() => (editable && isYaml ? yamlStyleOf(contents?.newContent ?? '') : null), [editable, isYaml, contents])
  const objectTypeRef = String((after.obj ?? before.obj)?.objectTypeRef ?? '')

  const current = useProjectSchema(repoPath)
  const afterSchema = useSchemaAt(repoPath, objectTypeRef ? newRef : null)
  const beforeSchema = useSchemaAt(repoPath, objectTypeRef ? oldRef : null)
  // Schéma Après (working tree = schéma courant), puis Avant, puis courant (types de composants).
  const typeDef = useMemo(() => findType(
    [newRef ? afterSchema.data : current.data, oldRef ? beforeSchema.data : undefined, current.data],
    objectTypeRef,
  ), [newRef, oldRef, afterSchema.data, beforeSchema.data, current.data, objectTypeRef])
  // Libellés de la colonne Avant (statut renommé entre les deux versions…) : son propre schéma d'abord.
  const beforeTypeDef = useMemo(
    () => findType([oldRef ? beforeSchema.data : undefined], objectTypeRef) ?? typeDef,
    [oldRef, beforeSchema.data, objectTypeRef, typeDef],
  )
  const schemaLoading = !!objectTypeRef && (current.isLoading || afterSchema.isLoading || beforeSchema.isLoading)

  const isDrawio = /\.drawio$/i.test(filepath)
  // GH222 — every YAML file has a Rendu (generic view); typed objects get their schema's labels.
  const canRender = isDrawio || !!typeDef || isYaml
  const presentation = useMemo(() => (typeDef ? typedPresentation(typeDef, t) : genericPresentation), [typeDef, t])
  const rendered = mode === 'rendered' && canRender
  const beforeLabel = sideLabel(t('diffView.before'), oldRef, false, t)
  const afterLabel = sideLabel(t('diffView.after'), newRef, true, t)

  let body: ReactNode
  if (isLoading || (mode === 'rendered' && schemaLoading)) {
    body = <p className="text-ink-3 italic p-6">{t('common.loading')}</p>
  } else if (!rendered) {
    body = contents && !editable && contents.oldContent === contents.newContent
      ? <p className="text-ink-3 italic p-6">{t('diffPage.noDifference')}</p>
      : (
        <RawDiffView
          // Another file or other versions: the navigation starts over.
          key={`${filepath}@${oldRef}..${newRef}`}
          before={contents?.oldContent ?? ''}
          after={afterText}
          layout={layout}
          yamlSyntax={isYaml}
          navBarSlot={navSlot}
          onChange={editable ? editDraft : undefined}
        />
      )
  } else if (isDrawio) {
    body = (
      <DrawioFileDiffView
        key={`${filepath}@${oldRef}..${newRef}`}
        repoPath={repoPath}
        filepath={filepath}
        before={{ at: oldRef, missing: !!contents?.oldMissing, label: beforeLabel }}
        after={{ at: newRef, missing: !!contents?.newMissing, label: afterLabel }}
        hideUnchanged={hideUnchanged}
      />
    )
  } else if (before.invalid || after.invalid) {
    body = <p className="p-6 text-xs text-status-warning">{t('diffView.renderUnavailable')}</p>
  } else {
    body = (
      <TreeDiffView
        // Un autre fichier ou d'autres versions : les nœuds dépliés repartent de zéro.
        key={`${filepath}@${oldRef}..${newRef}`}
        before={{ value: before.value, at: oldRef, label: beforeLabel, typeDef: beforeTypeDef }}
        after={{ value: after.value, at: newRef, label: afterLabel, typeDef }}
        presentation={presentation}
        desc={descFor(filepath, !!objectTypeRef)}
        repoPath={repoPath}
        hideUnchanged={hideUnchanged}
        navSlot={navSlot}
        testId={typeDef ? 'object-diff' : 'tree-diff'}
        edit={editStyle ? { text: afterText, style: editStyle, onChange: editDraft } : undefined}
      />
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-2 border-b border-edge shrink-0 flex items-center gap-3">
        {showPath && <p className="font-mono text-sm text-ink font-medium truncate flex-1">{filepath}</p>}
        {!showPath && <div className="flex-1" />}
        {(!rendered || !isDrawio) && <span ref={setNavSlot} className="contents" />}
        {!rendered && (
          <div className="flex rounded border border-edge overflow-hidden shrink-0" role="group" data-testid="diff-layout-toggle">
            <ToggleButton active={layout === 'side'} onClick={() => setLayout('side')} icon={<Columns2 size={12} />} label={t('diffView.sideBySide')} />
            <ToggleButton active={layout === 'inline'} onClick={() => setLayout('inline')} icon={<Rows2 size={12} />} label={t('diffView.inline')} />
          </div>
        )}
        {canRender && rendered && (
          <label className="flex items-center gap-1 text-xs text-ink-2 shrink-0 cursor-pointer">
            <input type="checkbox" checked={hideUnchanged} onChange={e => setHideUnchanged(e.target.checked)} />
            {t('diffView.hideUnchanged')}
          </label>
        )}
        {canRender && (
          <div className="flex rounded border border-edge overflow-hidden shrink-0" role="group" data-testid="diff-mode-toggle">
            <ToggleButton active={!rendered} onClick={() => setMode('raw')} icon={<FileCode size={12} />} label={t('diffView.raw')} />
            <ToggleButton active={rendered} onClick={() => setMode('rendered')} icon={<Eye size={12} />} label={t('diffView.rendered')} />
          </div>
        )}
        {!isLoading && contents && (
          <p className="text-xs text-ink-3 shrink-0">
            <span className="text-status-success">+{stats.added}</span>
            {' / '}
            <span className="text-status-danger">−{stats.removed}</span>
          </p>
        )}
      </div>
      {editable && (
        <div className="px-4 py-1 border-b border-edge shrink-0 flex items-center gap-2 text-xs bg-canvas" data-testid="diff-edit-bar">
          <Pencil size={12} className="text-ink-3" />
          <span className="text-ink-3">{t('diffView.editable')}</span>
          {dirty && <span className="text-status-warning">{t('diffView.unsaved')}</span>}
          {saveState.saved && !dirty && <span className="text-status-success">{t('diffView.saved')}</span>}
          {saveState.error && !saveState.error.ok && (
            <span className="text-status-danger truncate" data-testid="diff-save-error">
              {t(`diffView.saveError.${saveState.error.reason}`, {
                message: saveState.error.message ?? '', keys: (saveState.error.keys ?? []).join(', '),
              })}
            </span>
          )}
          <div className="flex-1" />
          {saveState.error && !saveState.error.ok && saveState.error.reason === 'changed' && (
            <button type="button" className="btn-secondary-sm" onClick={() => void reload()}>{t('diffView.reload')}</button>
          )}
          <button type="button" className="btn-primary-sm flex items-center gap-1" disabled={!dirty || saveState.busy}
            onClick={() => void save()} title="Ctrl+S">
            <Save size={12} />{t('diffView.save')}
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0">{body}</div>
    </div>
  )
}

function parseSide(isYaml: boolean, text: string | undefined, missing: boolean | undefined): Parsed {
  if (!isYaml || missing || text === undefined) return { value: undefined, obj: null, invalid: false }
  try {
    // An empty or comment-only file is an empty document, not an absent one.
    const v = yaml.load(text) ?? null
    return { value: v, obj: v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : null, invalid: false }
  } catch {
    return { value: undefined, obj: null, invalid: true }
  }
}

/** Same pairing of list elements as the merge of the file (GH222 design §2.3): links by `id`,
 *  parameters by name, typed objects by their own rules; other YAML by the generic heuristics. */
function descFor(filepath: string, typed: boolean): StructureDesc | undefined {
  if (typed) return OBJECT_DESC
  const keyed = keyedKindOf(filepath)
  return keyed === 'links' ? LINKS_DESC : keyed === 'parameters' ? PARAMETERS_DESC : undefined
}

function findType(schemas: Array<ProjectSchema | null | undefined>, ref: string): ObjectTypeDefinition | undefined {
  if (!ref) return undefined
  for (const s of schemas) {
    const found = s ? getReqTypeDef(s, ref) ?? getTestTypeDef(s, ref) : undefined
    if (found) return found
  }
  return undefined
}

function sideLabel(side: string, ref: string | null, isAfter: boolean, t: (k: string) => string): string {
  if (ref) return `${side} · ${/^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref}`
  return isAfter ? `${side} · ${t('diffView.workingTree')}` : side
}

function ToggleButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`px-2 py-1 text-xs flex items-center gap-1 ${active ? 'bg-prim text-prim-fg' : 'bg-surface text-ink-2 hover:bg-surface-hover'}`}>
      {icon}{label}
    </button>
  )
}
