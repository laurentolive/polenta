import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { RevalidationFlag } from '../system/RevalidationFlag'
import { RepoBadge } from './RepoBadge'
import type { FlaggedElement, FlaggedLinkedElement } from '@polenta/types'

export type OpenElement = (type: 'requirement' | 'test_case', id: string, repoPath: string) => void

interface Props {
  elements: FlaggedElement[]
  /** Repo des éléments sans `repo` (repo racine du workspace). */
  rootRepoPath: string
  selected: Set<string>
  toggle: (id: string) => void
  setSelected: (ids: Set<string>) => void
  clear: (ids: string[]) => void
  pending: boolean
  onOpen: OpenElement
}

const typeBadge = (type: 'requirement' | 'test_case') => (type === 'requirement' ? 'EX' : 'TC')

function LinkedRow({ linked, rootRepoPath, onOpen }: { linked: FlaggedLinkedElement; rootRepoPath: string; onOpen: OpenElement }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 py-1 text-xs" style={{ paddingLeft: '62px' }}>
      <span className="font-mono text-[10px] text-ink-3 border border-edge-subtle rounded px-1 shrink-0">{typeBadge(linked.elementType)}</span>
      <button
        type="button"
        onClick={() => onOpen(linked.elementType, linked.elementId, linked.repo?.path ?? rootRepoPath)}
        className="font-mono text-ink truncate hover:underline text-left shrink-0"
      >
        {linked.elementId}
      </button>
      <span className="text-ink-2 truncate min-w-0 flex-1" title={linked.title}>{linked.title}</span>
      <RepoBadge repo={linked.repo} />
      <span className="text-ink-3 shrink-0">{linked.linkType}</span>
      {linked.version !== undefined && <span className="text-ink-3 font-mono shrink-0">v{linked.version}</span>}
      <span
        className={`shrink-0 ${linked.approved ? 'text-ink-2' : 'text-status-warning font-medium'}`}
        title={linked.approved ? undefined : t('impactAnalysisPage.revalidation.notApprovedHint')}
      >
        {linked.status}
        {!linked.approved && ` · ${t('impactAnalysisPage.revalidation.notApproved')}`}
      </span>
    </div>
  )
}

function FlaggedRow({ element, rootRepoPath, selected, toggle, clear, pending, onOpen }: Omit<Props, 'elements' | 'selected' | 'setSelected'> & { element: FlaggedElement; selected: boolean }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const hasLinked = element.linked.length > 0

  return (
    <div className="border-b border-edge-subtle">
      <div className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-hover transition-colors">
        {hasLinked ? (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-ink-3 shrink-0"
            title={t('impactAnalysisPage.revalidation.linked', { count: element.linked.length })}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        <input
          type="checkbox"
          checked={selected}
          onChange={() => toggle(element.elementId)}
          className="shrink-0"
          aria-label={t('impactAnalysisPage.revalidation.select', { id: element.elementId })}
        />
        <span className="font-mono text-[10px] text-ink-3 border border-edge-subtle rounded px-1 shrink-0">{typeBadge(element.elementType)}</span>
        <button
          type="button"
          onClick={() => onOpen(element.elementType, element.elementId, element.repo?.path ?? rootRepoPath)}
          className="font-mono text-ink truncate hover:underline text-left shrink-0"
        >
          {element.elementId}
        </button>
        <RevalidationFlag show />
        <span className="text-ink-2 truncate min-w-0 flex-1" title={element.title}>{element.title}</span>
        <RepoBadge repo={element.repo} />
        <span className="text-xs text-ink-3 shrink-0">{element.status}</span>
        <button
          type="button"
          onClick={() => clear([element.elementId])}
          disabled={pending}
          className="btn-secondary-sm shrink-0"
        >
          {t('impactAnalysisPage.revalidation.clear')}
        </button>
      </div>
      {expanded && hasLinked && (
        <div className="pb-2">
          <p className="text-[11px] text-ink-3 uppercase tracking-wide pb-0.5" style={{ paddingLeft: '62px' }}>
            {t('impactAnalysisPage.revalidation.linked', { count: element.linked.length })}
          </p>
          {element.linked.map((l) => (
            <LinkedRow key={`${l.elementType}-${l.elementId}`} linked={l} rootRepoPath={rootRepoPath} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * T173 — liste de repli « Impact à vérifier » : tous les éléments marqués `needsRevalidation` du
 * workspace, y compris ceux qu'aucune analyse n'atteint (marquage par paramètre T171, réouverture
 * déjà publiée…). Chaque ligne se déplie sur ses éléments liés pour aider à retrouver le
 * déclencheur (un pair non approuvé). La levée de la sélection passe par le bouton d'en-tête de
 * la page, partagé avec les arbres d'analyse.
 */
export function RevalidationList({ elements, rootRepoPath, selected, toggle, setSelected, clear, pending, onOpen }: Props) {
  const { t } = useTranslation()
  const selectAllRef = useRef<HTMLInputElement>(null)
  const selectedCount = elements.filter((e) => selected.has(e.elementId)).length
  const allSelected = elements.length > 0 && selectedCount === elements.length

  // Sélection partielle : case « Tout sélectionner » indéterminée ; un clic vide alors la sélection.
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedCount > 0 && !allSelected
  }, [selectedCount, allSelected])

  if (elements.length === 0) {
    return <p className="text-sm text-ink-3 italic px-4 py-3">{t('impactAnalysisPage.revalidation.empty')}</p>
  }

  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-2 border-b border-edge-subtle text-xs text-ink-2">
        <span className="w-[13px] shrink-0" />
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allSelected}
            onChange={() => setSelected(selectedCount > 0 ? new Set() : new Set(elements.map((e) => e.elementId)))}
          />
          {t('impactAnalysisPage.revalidation.selectAll')}
        </label>
      </div>
      {elements.map((e) => (
        <FlaggedRow
          key={`${e.elementType}-${e.elementId}`}
          element={e}
          rootRepoPath={rootRepoPath}
          selected={selected.has(e.elementId)}
          toggle={toggle}
          clear={clear}
          pending={pending}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}
