import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { CHANGE_IMPACT_STATUSES, type ChangeImpacted, type ChangeImpactStatus, type ChangeToModify, type ProjectSchema } from '@polenta/types'
import { api } from '../../api'
import { getReqTypeDef, getTestTypeDef } from '../../hooks/useProjectSchema'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { STATUS_LABEL_KEY } from '../../lib/impactStatus'

// GH198 — listes « à modifier » / « impactés » d'un change et sélecteur d'éléments (specs/GH198.md §4).

export interface ElementInfo {
  id: string
  title: string
  category: 'requirement' | 'test'
  /** Libellé du statut (schéma), repli sur le nom. */
  status: string
}

/** Exigences et tests du repo du change (Q3), indexés par ID. */
export function useRepoElements(repoPath: string, schema: ProjectSchema | undefined): Map<string, ElementInfo> {
  const { data: reqs = [] } = useQuery({ queryKey: ['requirements', repoPath], queryFn: () => api.requirements.list(repoPath), enabled: !!repoPath })
  const { data: tests = [] } = useQuery({ queryKey: ['tests', repoPath], queryFn: () => api.tests.list(repoPath), enabled: !!repoPath })
  return useMemo(() => {
    const m = new Map<string, ElementInfo>()
    for (const r of reqs) {
      m.set(r.id, { id: r.id, title: r.title, category: 'requirement', status: getReqTypeDef(schema, r.objectTypeRef)?.statuses?.find(s => s.name === r.status)?.label || r.status })
    }
    for (const tc of tests) {
      m.set(tc.id, { id: tc.id, title: tc.title, category: 'test', status: getTestTypeDef(schema, tc.objectTypeRef)?.statuses?.find(s => s.name === tc.status)?.label || tc.status })
    }
    return m
  }, [reqs, tests, schema])
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id, undefined, { numeric: true })

/** ID cliquable vers la page de l'élément ; « supprimé » quand il n'existe plus. */
function ElementRef({ id, info, repoPath, projectId }: { id: string; info?: ElementInfo; repoPath: string; projectId: string }) {
  const { t } = useTranslation()
  if (!info) {
    return (
      <span className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-ink-3 line-through whitespace-nowrap">{id}</span>
        <span className="text-xs text-status-danger">{t('changes.removed')}</span>
      </span>
    )
  }
  const link = info.category === 'requirement'
    ? <Link to="/req/$reqId" params={{ reqId: id }} search={{ repoPath, projectId, component: undefined, level: undefined }} className="font-mono text-prim hover:underline whitespace-nowrap">{id}</Link>
    : <Link to="/test/$testId" params={{ testId: id }} search={{ repoPath, projectId, component: undefined, level: undefined }} className="font-mono text-prim hover:underline whitespace-nowrap">{id}</Link>
  return (
    <span className="flex items-center gap-2 min-w-0">
      {link}
      <span className="truncate text-ink">{info.title}</span>
      <span className="text-xs text-ink-3 shrink-0">{info.status}</span>
    </span>
  )
}

interface ListProps {
  repoPath: string
  projectId: string
  elements: Map<string, ElementInfo>
  disabled?: boolean
}

export function ToModifyList({ items, onChange, onAddReopened, ...p }: ListProps & {
  items: ChangeToModify[]
  onChange: (items: ChangeToModify[]) => void
  onAddReopened?: () => void
}) {
  const { t } = useTranslation()
  const [picking, setPicking] = useState(false)
  return (
    <section className="border rounded p-3 mb-4" data-testid="change-to-modify">
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide">{t('changes.toModify')}</p>
        {!p.disabled && (
          <div className="flex gap-3">
            {onAddReopened && (
              <button type="button" className="text-xs text-prim hover:underline" onClick={onAddReopened} data-testid="change-add-reopened">
                {t('changes.addReopened')}
              </button>
            )}
            <button type="button" className="text-xs text-prim hover:underline" onClick={() => setPicking(true)} data-testid="change-to-modify-add">
              {t('changes.add')}
            </button>
          </div>
        )}
      </div>
      {items.length === 0 ? <p className="text-xs text-ink-3">{t('changes.none')}</p> : (
        <ul className="space-y-1">
          {items.map(it => (
            <li key={it.id} className="flex items-center gap-2 text-sm" data-testid={`change-to-modify-${it.id}`}>
              <span className="flex-1 min-w-0"><ElementRef id={it.id} info={p.elements.get(it.id)} repoPath={p.repoPath} projectId={p.projectId} /></span>
              <span className="text-xs text-ink-3 shrink-0">{t(it.state === 'modified' ? 'changes.modified' : 'changes.planned')}</span>
              {!p.disabled && (
                <button type="button" className="text-ink-3 hover:text-status-danger" title={t('changes.remove')} onClick={() => onChange(items.filter(i => i.id !== it.id))}>
                  <X size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {picking && (
        <ElementPickerModal
          title={t('changes.pickTitle')}
          candidates={[...p.elements.values()].filter(e => !items.some(i => i.id === e.id)).sort(byId)}
          onClose={() => setPicking(false)}
          onAdd={ids => { onChange([...items, ...ids.map(id => ({ id, state: 'planned' as const }))]); setPicking(false) }}
        />
      )}
    </section>
  )
}

export function ImpactedList({ items, onChange, ...p }: ListProps & {
  items: ChangeImpacted[]
  onChange: (items: ChangeImpacted[]) => void
}) {
  const { t } = useTranslation()
  const [picking, setPicking] = useState(false)
  const patch = (id: string, change: Partial<ChangeImpacted>) => onChange(items.map(i => (i.id === id ? { ...i, ...change } : i)))
  return (
    <section className="border rounded p-3 mb-4" data-testid="change-impacted">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide">{t('changes.impacted')}</p>
        {!p.disabled && (
          <button type="button" className="text-xs text-prim hover:underline" onClick={() => setPicking(true)} data-testid="change-impacted-add">
            {t('changes.add')}
          </button>
        )}
      </div>
      {items.length === 0 ? <p className="text-xs text-ink-3">{t('changes.none')}</p> : (
        <ul className="space-y-2">
          {items.map(it => (
            <li key={it.id} className="text-sm" data-testid={`change-impacted-${it.id}`}>
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0"><ElementRef id={it.id} info={p.elements.get(it.id)} repoPath={p.repoPath} projectId={p.projectId} /></span>
                {it.source === 'computed' && <span className="text-xs text-ink-3 shrink-0">{t('changes.computed')}</span>}
                <select
                  className="text-xs bg-surface border border-edge rounded px-1 py-0.5 text-ink shrink-0"
                  value={it.status}
                  disabled={p.disabled}
                  aria-label={t('changes.impactStatus')}
                  onChange={e => patch(it.id, { status: e.target.value as ChangeImpactStatus })}
                >
                  {CHANGE_IMPACT_STATUSES.map(s => <option key={s} value={s}>{t(STATUS_LABEL_KEY[s])}</option>)}
                </select>
                {!p.disabled && (
                  <button type="button" className="text-ink-3 hover:text-status-danger" title={t('changes.remove')} onClick={() => onChange(items.filter(i => i.id !== it.id))}>
                    <X size={13} />
                  </button>
                )}
              </div>
              <CommentInput
                value={it.comment ?? ''}
                disabled={p.disabled}
                onCommit={comment => { if (comment !== (it.comment ?? '')) patch(it.id, { comment: comment || undefined }) }}
              />
            </li>
          ))}
        </ul>
      )}
      {picking && (
        <ElementPickerModal
          title={t('changes.pickTitle')}
          candidates={[...p.elements.values()].filter(e => !items.some(i => i.id === e.id)).sort(byId)}
          onClose={() => setPicking(false)}
          onAdd={ids => {
            onChange([...items, ...ids.map(id => ({ id, status: 'impact_non_verifie' as const, source: 'declared' as const }))])
            setPicking(false)
          }}
        />
      )}
    </section>
  )
}

/** Commentaire enregistré à la sortie du champ (pas une écriture par frappe). */
function CommentInput({ value, disabled, onCommit }: { value: string; disabled?: boolean; onCommit: (v: string) => void }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(value)
  const [prev, setPrev] = useState(value)
  if (value !== prev) { setPrev(value); setDraft(value) }
  return (
    <input
      type="text"
      className="mt-1 w-full text-xs bg-surface border border-edge rounded px-2 py-1 text-ink"
      placeholder={t('changes.comment')}
      value={draft}
      disabled={disabled}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => onCommit(draft.trim())}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
    />
  )
}

/** Sélection multiple d'éléments (ID, titre, type), filtrable. */
export function ElementPickerModal({ title, help, candidates, onAdd, onClose, emptyLabel }: {
  title: string
  help?: string
  candidates: ElementInfo[]
  onAdd: (ids: string[]) => void
  onClose: () => void
  emptyLabel?: string
}) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const confirm = () => { if (selected.size > 0) onAdd([...selected]) }
  useModalHotkeys(onClose, confirm)
  const q = filter.trim().toLowerCase()
  const shown = q ? candidates.filter(c => c.id.toLowerCase().includes(q) || c.title.toLowerCase().includes(q)) : candidates
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/40" onClick={onClose}>
      <div role="dialog" aria-label={title} className="bg-surface border border-edge rounded-lg shadow-xl p-5 max-w-xl w-full mx-4 flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-ink mb-1">{title}</h2>
        {help && <p className="text-xs text-ink-3 mb-2">{help}</p>}
        <input
          type="text"
          autoFocus
          className="w-full text-sm bg-surface border border-edge rounded px-2 py-1 text-ink mb-2"
          placeholder={t('changes.pickFilter')}
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <div className="flex-1 overflow-y-auto border border-edge rounded">
          {shown.length === 0 ? <p className="p-3 text-xs text-ink-3">{emptyLabel ?? t('changes.pickNone')}</p> : shown.map(c => (
            <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-hover cursor-pointer" data-testid={`change-pick-${c.id}`}>
              <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
              <span className="font-mono whitespace-nowrap">{c.id}</span>
              <span className="truncate flex-1 text-ink">{c.title}</span>
              <span className="text-xs text-ink-3 shrink-0">{t(c.category === 'requirement' ? 'changes.requirement' : 'changes.test')} · {c.status}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <button type="button" className="text-xs text-ink-3 hover:text-ink" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn-primary-sm" disabled={selected.size === 0} onClick={confirm} data-testid="change-pick-confirm">
            {t('changes.addSelected')}
          </button>
        </div>
      </div>
    </div>
  )
}
