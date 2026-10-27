import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import yaml from 'js-yaml'
import { Eye, FileCode } from 'lucide-react'
import type { FileDiffContents } from '@polenta/api-client'
import type { ObjectTypeDefinition, ProjectSchema } from '@polenta/types'
import { computeLineDiff } from '../../lib/lineDiff'
import { diffPrefs } from '../../lib/diffPrefs'
import { getReqTypeDef, getTestTypeDef, useProjectSchema } from '../../hooks/useProjectSchema'
import { useSchemaAt } from '../../hooks/useSchemaAt'
import { LineDiffView } from './LineDiffView'
import { ObjectDiffView } from './ObjectDiffView'
import { DrawioFileDiffView } from './DrawioFileDiffView'

type Obj = Record<string, unknown>
type Parsed = { obj: Obj | null; invalid: boolean }

/**
 * GH178 — diff d'un fichier, commun aux trois écrans (`/version-diff`, `/diff` working tree et
 * commit) : sous-en-tête (chemin, `+n / −n`, bascule Raw / Rendu) puis le diff dans le mode choisi.
 * Le Rendu est proposé pour une exigence ou un test dont le type se résout dans le schéma, et pour un `.drawio`.
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

  const lines = useMemo(
    () => (contents ? computeLineDiff(contents.oldContent, contents.newContent) : []),
    [contents],
  )
  const addCount = lines.filter(l => l.type === 'add').length
  const removeCount = lines.filter(l => l.type === 'remove').length

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
  const canRender = isDrawio || !!typeDef
  const rendered = mode === 'rendered' && canRender
  const beforeLabel = sideLabel(t('diffView.before'), oldRef, false, t)
  const afterLabel = sideLabel(t('diffView.after'), newRef, true, t)

  let body: ReactNode
  if (isLoading || (mode === 'rendered' && schemaLoading)) {
    body = <p className="text-ink-3 italic p-6">{t('common.loading')}</p>
  } else if (!rendered) {
    body = <div className="h-full overflow-auto font-mono text-xs"><LineDiffView lines={lines} /></div>
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
      <ObjectDiffView
        // Un autre fichier ou d'autres versions : les groupes dépliés repartent de zéro.
        key={`${filepath}@${oldRef}..${newRef}`}
        before={{ value: before.obj, at: oldRef, label: beforeLabel, typeDef: beforeTypeDef }}
        after={{ value: after.obj, at: newRef, label: afterLabel, typeDef }}
        typeDef={typeDef}
        repoPath={repoPath}
        hideUnchanged={hideUnchanged}
      />
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-2 border-b border-edge shrink-0 flex items-center gap-3">
        {showPath && <p className="font-mono text-sm text-ink font-medium truncate flex-1">{filepath}</p>}
        {!showPath && <div className="flex-1" />}
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
            <span className="text-status-success">+{addCount}</span>
            {' / '}
            <span className="text-status-danger">−{removeCount}</span>
          </p>
        )}
      </div>
      <div className="flex-1 min-h-0">{body}</div>
    </div>
  )
}

function parseSide(isYaml: boolean, text: string | undefined, missing: boolean | undefined): Parsed {
  if (!isYaml || missing || text === undefined) return { obj: null, invalid: false }
  try {
    const v = yaml.load(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? { obj: v as Obj, invalid: false } : { obj: null, invalid: true }
  } catch {
    return { obj: null, invalid: true }
  }
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
