import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { CHANGE_IMPACT_STATUSES, CLOSED_IMPACT_STATUSES, type ChangeImpactRow, type ChangeImpactStatus, type ChangeToModify, type ProjectSchema } from '@polenta/types'
import { api } from '../../api'
import { getReqTypeDef, getTestTypeDef } from '../../hooks/useProjectSchema'
import { ChangeElementPicker } from './ChangeElementPicker'
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
  workspaceDir: string
  elements: Map<string, ElementInfo>
  disabled?: boolean
}

export function ToModifyList({ items, onChange, ...p }: ListProps & {
  items: ChangeToModify[]
  onChange: (items: ChangeToModify[]) => void
}) {
  const { t } = useTranslation()
  const [picking, setPicking] = useState(false)
  return (
    <section className="border rounded p-3 mb-4" data-testid="change-to-modify">
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide">{t('changes.toModify')}</p>
        {!p.disabled && (
          <button type="button" className="text-xs text-prim hover:underline" onClick={() => setPicking(true)} data-testid="change-to-modify-add">
            {t('changes.add')}
          </button>
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
        <ChangeElementPicker
          repoPath={p.repoPath}
          workspaceDir={p.workspaceDir}
          title={t('changes.pickToModify')}
          excluded={new Set(items.map(i => i.id))}
          onClose={() => setPicking(false)}
          onAdd={ids => { onChange([...items, ...ids.map(id => ({ id, state: 'planned' as const }))]); setPicking(false) }}
        />
      )}
    </section>
  )
}

/**
 * Éléments impactés : déclarés et calculés par l'analyse (GH199), un statut par élément. Seuls les
 * déclarés se retirent ; une ligne calculée qui n'est plus atteinte est signalée.
 */
export function ImpactedList({ rows, onSetImpact, onAddDeclared, onRemoveDeclared, ...p }: ListProps & {
  rows: ChangeImpactRow[]
  onSetImpact: (id: string, status: ChangeImpactStatus, comment: string | undefined) => void
  onAddDeclared: (ids: string[]) => void
  onRemoveDeclared: (id: string) => void
}) {
  const { t } = useTranslation()
  const [picking, setPicking] = useState(false)
  const [openOnly, setOpenOnly] = useState(false)
  const shown = openOnly ? rows.filter(r => !CLOSED_IMPACT_STATUSES.includes(r.status)) : rows
  return (
    <section className="border rounded p-3 mb-4" data-testid="change-impacted">
      <div className="flex items-center justify-between mb-2 gap-3">
        <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide">{t('changes.impacted')}</p>
        <div className="flex-1" />
        {rows.length > 0 && (
          <label className="flex items-center gap-1 text-xs text-ink-3 cursor-pointer">
            <input type="checkbox" checked={openOnly} onChange={e => setOpenOnly(e.target.checked)} data-testid="change-impacted-open-only" />
            {t('changes.openOnly')}
          </label>
        )}
        {!p.disabled && (
          <button type="button" className="text-xs text-prim hover:underline" onClick={() => setPicking(true)} data-testid="change-impacted-add">
            {t('changes.add')}
          </button>
        )}
      </div>
      {shown.length === 0 ? <p className="text-xs text-ink-3">{t('changes.none')}</p> : (
        <ul className="space-y-2">
          {shown.map(it => (
            <li key={it.id} className="text-sm" data-testid={`change-impacted-${it.id}`}>
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0"><ElementRef id={it.id} info={p.elements.get(it.id)} repoPath={p.repoPath} projectId={p.projectId} /></span>
                {it.source === 'computed' && <span className="text-xs text-ink-3 shrink-0">{t('changes.computed')}</span>}
                {!it.reached && <span className="text-xs text-status-warning shrink-0" data-testid="change-impacted-unreached">{t('changes.unreached')}</span>}
                <select
                  className="text-xs bg-surface border border-edge rounded px-1 py-0.5 text-ink shrink-0"
                  value={it.status}
                  disabled={p.disabled}
                  aria-label={t('changes.impactStatus')}
                  onChange={e => onSetImpact(it.id, e.target.value as ChangeImpactStatus, it.comment)}
                >
                  {CHANGE_IMPACT_STATUSES.map(s => <option key={s} value={s}>{t(STATUS_LABEL_KEY[s])}</option>)}
                </select>
                {!p.disabled && it.source === 'declared' && (
                  <button type="button" className="text-ink-3 hover:text-status-danger" title={t('changes.remove')} onClick={() => onRemoveDeclared(it.id)}>
                    <X size={13} />
                  </button>
                )}
              </div>
              <CommentInput
                value={it.comment ?? ''}
                disabled={p.disabled}
                onCommit={comment => { if (comment !== (it.comment ?? '')) onSetImpact(it.id, it.status, comment || undefined) }}
              />
            </li>
          ))}
        </ul>
      )}
      {picking && (
        <ChangeElementPicker
          repoPath={p.repoPath}
          workspaceDir={p.workspaceDir}
          title={t('changes.pickImpacted')}
          excluded={new Set(rows.map(r => r.id))}
          onClose={() => setPicking(false)}
          onAdd={ids => { onAddDeclared(ids); setPicking(false) }}
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
