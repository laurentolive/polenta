import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { CHANGE_IMPACT_STATUSES, CLOSED_IMPACT_STATUSES, isToProcess, type ChangeImpactRow, type ChangeImpactStatus, type ChangeToModify, type ProjectSchema } from '@polenta/types'
import { api } from '../../api'
import { getReqTypeDef, getTestTypeDef } from '../../hooks/useProjectSchema'
import { ChangeElementPicker } from './ChangeElementPicker'
import { AssignToChangeDialog } from './AssignToChangeDialog'
import { STATUS_LABEL_KEY } from '../../lib/impactStatus'

// GH198 — listes « à modifier » / « impactés » d'un change et sélecteur d'éléments (specs/GH198.md §4).

export interface ElementInfo {
  id: string
  title: string
  category: 'requirement' | 'test'
  /** Libellé du statut (schéma), repli sur le nom. */
  status: string
  /** GH199 §8bis — ni approuvé ni terminal : travail à faire sur l'élément. */
  toProcess: boolean
}

/** Exigences et tests du repo du change (Q3), indexés par ID. */
export function useRepoElements(repoPath: string, schema: ProjectSchema | undefined): Map<string, ElementInfo> {
  const { data: reqs = [] } = useQuery({ queryKey: ['requirements', repoPath], queryFn: () => api.requirements.list(repoPath), enabled: !!repoPath })
  const { data: tests = [] } = useQuery({ queryKey: ['tests', repoPath], queryFn: () => api.tests.list(repoPath), enabled: !!repoPath })
  return useMemo(() => {
    const m = new Map<string, ElementInfo>()
    for (const r of reqs) {
      const statuses = getReqTypeDef(schema, r.objectTypeRef)?.statuses
      m.set(r.id, { id: r.id, title: r.title, category: 'requirement', status: statuses?.find(s => s.name === r.status)?.label || r.status, toProcess: isToProcess(statuses, r.status) })
    }
    for (const tc of tests) {
      const statuses = getTestTypeDef(schema, tc.objectTypeRef)?.statuses
      m.set(tc.id, { id: tc.id, title: tc.title, category: 'test', status: statuses?.find(s => s.name === tc.status)?.label || tc.status, toProcess: isToProcess(statuses, tc.status) })
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

/** Titre de section repliable, avec le nombre d'éléments (visible une fois repliée). */
function SectionToggle({ label, count, open, onToggle, testId }: { label: string; count: number; open: boolean; onToggle: () => void; testId: string }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} data-testid={testId}
      className="flex items-center gap-1 text-xs font-semibold text-ink-2 uppercase tracking-wide hover:text-ink">
      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      {label}
      <span className="font-normal text-ink-3 normal-case">({count})</span>
    </button>
  )
}

interface ListProps {
  repoPath: string
  projectId: string
  workspaceDir: string
  elements: Map<string, ElementInfo>
  disabled?: boolean
}

export function ToModifyList({ items, onChange, changeId, component, alsoIn, ...p }: ListProps & {
  items: ChangeToModify[]
  onChange: (items: ChangeToModify[]) => void
  /** GH199 §8bis — « Déplacer vers… » : change courant et son composant. */
  changeId: string
  component: string
  /** GH199 §8bis — autres changes ouverts qui listent l'élément. */
  alsoIn: Map<string, string[]>
}) {
  const { t } = useTranslation()
  const [picking, setPicking] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [moving, setMoving] = useState(false)
  const [open, setOpen] = useState(true)
  const chosen = items.filter(i => selected.has(i.id)).map(i => i.id)
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  return (
    <section className="border rounded p-3 mb-4" data-testid="change-to-modify">
      <div className="flex items-center justify-between mb-2 gap-2">
        <SectionToggle label={t('changes.toModify')} count={items.length} open={open} onToggle={() => setOpen(o => !o)} testId="change-to-modify-toggle" />
        <div className="flex-1" />
        {!p.disabled && chosen.length > 0 && (
          <button type="button" className="text-xs text-prim hover:underline" onClick={() => setMoving(true)} data-testid="change-to-modify-move">
            {t('changes.moveTo', { count: chosen.length })}
          </button>
        )}
        {!p.disabled && (
          <button type="button" className="text-xs text-prim hover:underline" onClick={() => setPicking(true)} data-testid="change-to-modify-add">
            {t('changes.add')}
          </button>
        )}
      </div>
      {!open ? null : items.length === 0 ? <p className="text-xs text-ink-3">{t('changes.none')}</p> : (
        <ul className="space-y-1">
          {items.map(it => (
            <li key={it.id} className="flex items-center gap-2 text-sm" data-testid={`change-to-modify-${it.id}`}>
              {!p.disabled && (
                <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggle(it.id)} aria-label={t('changes.backlog.select', { id: it.id })} />
              )}
              <span className="flex-1 min-w-0"><ElementRef id={it.id} info={p.elements.get(it.id)} repoPath={p.repoPath} projectId={p.projectId} /></span>
              {!!alsoIn.get(it.id)?.length && (
                <span className="text-xs text-ink-3 shrink-0" data-testid={`change-to-modify-also-${it.id}`}>{t('changes.alsoIn', { ids: alsoIn.get(it.id)!.join(', ') })}</span>
              )}
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
      {moving && (
        <AssignToChangeDialog
          mode="move"
          repoPath={p.repoPath}
          elementIds={chosen}
          component={component}
          sourceChangeId={changeId}
          onDone={() => { setMoving(false); setSelected(new Set()) }}
          onCancel={() => setMoving(false)}
        />
      )}
    </section>
  )
}

/**
 * Éléments impactés : déclarés et calculés par l'analyse (GH199), un statut par élément. Seuls les
 * déclarés se retirent ; une ligne calculée qui n'est plus atteinte est signalée.
 */
export function ImpactedList({ rows, onSetImpact, onAddDeclared, onRemoveDeclared, onPromote, ...p }: ListProps & {
  rows: ChangeImpactRow[]
  onSetImpact: (id: string, status: ChangeImpactStatus, comment: string | undefined) => void
  onAddDeclared: (ids: string[]) => void
  onRemoveDeclared: (id: string) => void
  /** GH199 §8bis — « Passer en à modifier » un élément à traiter. */
  onPromote: (id: string) => void
}) {
  const { t } = useTranslation()
  const [picking, setPicking] = useState(false)
  const [openOnly, setOpenOnly] = useState(false)
  const [open, setOpen] = useState(true)
  const shown = openOnly ? rows.filter(r => !CLOSED_IMPACT_STATUSES.includes(r.status)) : rows
  return (
    <section className="border rounded p-3 mb-4" data-testid="change-impacted">
      <div className="flex items-center justify-between mb-2 gap-3">
        <SectionToggle label={t('changes.impacted')} count={rows.length} open={open} onToggle={() => setOpen(o => !o)} testId="change-impacted-toggle" />
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
      {!open ? null : shown.length === 0 ? <p className="text-xs text-ink-3">{t('changes.none')}</p> : (
        <ul className="space-y-2">
          {shown.map(it => (
            <li key={it.id} className="text-sm" data-testid={`change-impacted-${it.id}`}>
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0"><ElementRef id={it.id} info={p.elements.get(it.id)} repoPath={p.repoPath} projectId={p.projectId} /></span>
                {it.source === 'computed' && <span className="text-xs text-ink-3 shrink-0">{t('changes.computed')}</span>}
                {!it.reached && <span className="text-xs text-status-warning shrink-0" data-testid="change-impacted-unreached">{t('changes.unreached')}</span>}
                {p.elements.get(it.id)?.toProcess && (
                  <>
                    <span className="text-xs text-status-warning shrink-0" data-testid={`change-impacted-to-process-${it.id}`}>{t('changes.toProcess')}</span>
                    {!p.disabled && (
                      <button type="button" className="text-xs text-prim hover:underline shrink-0" onClick={() => onPromote(it.id)} data-testid={`change-impacted-promote-${it.id}`}>
                        {t('changes.promote')}
                      </button>
                    )}
                  </>
                )}
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
