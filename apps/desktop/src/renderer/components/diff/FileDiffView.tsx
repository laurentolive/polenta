import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import yaml from 'js-yaml'
import { Columns2, Eye, FileCode, Rows2 } from 'lucide-react'
import type { FileDiffContents } from '@polenta/api-client'
import type { ObjectTypeDefinition, ProjectSchema } from '@polenta/types'
import { lineStats } from '../../lib/diffStats'
import { diffPrefs } from '../../lib/diffPrefs'
import { getReqTypeDef, getTestTypeDef, useProjectSchema } from '../../hooks/useProjectSchema'
import { useSchemaAt } from '../../hooks/useSchemaAt'
import { RawDiffView } from './RawDiffView'
import { keyedKindOf, LINKS_DESC, OBJECT_DESC, PARAMETERS_DESC, type StructureDesc } from '@polenta/merge-core'
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

  const stats = useMemo(
    () => (contents ? lineStats(contents.oldContent, contents.newContent) : { added: 0, removed: 0 }),
    [contents],
  )

  const oldRef = contents?.oldRef ?? null
  const newRef = contents?.newRef ?? null
  const isYaml = /\.ya?ml$/i.test(filepath)
  const before = useMemo(() => parseSide(isYaml, contents?.oldContent, contents?.oldMissing), [isYaml, contents])
  const after = useMemo(() => parseSide(isYaml, contents?.newContent, contents?.newMissing), [isYaml, contents])
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
    body = contents && contents.oldContent === contents.newContent
      ? <p className="text-ink-3 italic p-6">{t('diffPage.noDifference')}</p>
      : (
        <RawDiffView
          // Another file or other versions: the navigation starts over.
          key={`${filepath}@${oldRef}..${newRef}`}
          before={contents?.oldContent ?? ''}
          after={contents?.newContent ?? ''}
          layout={layout}
          yamlSyntax={isYaml}
          navBarSlot={navSlot}
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
