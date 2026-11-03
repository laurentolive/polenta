import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ISSUE_IMPACT_LINK } from '@polenta/types'
import { api } from '../../api'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { getObjectTypeRefs, useProjectSchema } from '../../hooks/useProjectSchema'
import { parseLinkError } from '../system/linkUtils'

/** Vrai si le composant a un type issue : sinon, rien à proposer. */
export function useHasIssueType(repoPath: string): boolean {
  const { data: schema } = useProjectSchema(repoPath)
  return getObjectTypeRefs(schema, 'issue').length > 0
}

/**
 * GH244 §5 — proposition après une exécution en échec : créer une issue (pré-remplie), lier à une issue
 * existante, ou ignorer. Rien n'est écrit avant « Créer » ou « Lier ».
 */
export function IssueProposalDialog({ repoPath, workspaceDir, runId, testId, requirementId, onClose }: {
  repoPath: string
  workspaceDir?: string
  runId: string
  testId: string
  /** Exigence de l'instance exécutée, le cas échéant. */
  requirementId?: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: schema } = useProjectSchema(repoPath)
  const types = useMemo(() => getObjectTypeRefs(schema, 'issue'), [schema])
  const ownReqTypes = useMemo(() => new Set(getObjectTypeRefs(schema, 'requirement').map(r => r.ref)), [schema])
  const { data: objects = [] } = useQuery({
    queryKey: ['links-objects', repoPath, workspaceDir], queryFn: () => api.links.objects(repoPath, workspaceDir),
  })
  const { data: links = [] } = useQuery({
    queryKey: ['links-list', repoPath, workspaceDir], queryFn: () => api.links.list(repoPath, workspaceDir),
  })
  const { data: issues = [] } = useQuery({ queryKey: ['issues', repoPath], queryFn: () => api.issues.list(repoPath) })

  // Exigences du test (celle de l'instance si l'exécution en porte une), du composant seulement.
  const requirements = useMemo(() => {
    const linked = new Set(links.flatMap(l => (l.sourceId === testId ? [l.targetId] : l.targetId === testId ? [l.sourceId] : [])))
    return objects.filter(o => o.category === 'requirement' && linked.has(o.id) && ownReqTypes.has(o.objectTypeRef)
      && (!requirementId || o.id === requirementId) && o.repoPath === repoPath)
  }, [links, objects, testId, requirementId, ownReqTypes, repoPath])
  const testTitle = objects.find(o => o.id === testId)?.title ?? ''

  const [mode, setMode] = useState<'create' | 'link'>('create')
  const [chosenType, setChosenType] = useState<string | null>(null)
  const typeRef = chosenType ?? types[0]?.ref
  const [title, setTitle] = useState<string | null>(null)
  const shownTitle = title ?? t('issues.proposal.defaultTitle', { id: testId, title: testTitle })
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set())
  const [existing, setExisting] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Issue déjà créée quand l'écriture d'un lien a échoué : la relance reprend les liens.
  const created = useRef<string | null>(null)
  useEffect(() => setError(null), [mode])
  useModalHotkeys(onClose)

  const selectedReqs = requirements.filter(r => !unchecked.has(r.id))
  const canSubmit = !saving && (mode === 'create' ? !!typeRef && !!shownTitle.trim() : !!existing)

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      const issueId = mode === 'link'
        ? (await api.issues.addRun(repoPath, existing, runId, workspaceDir)).id
        : created.current ?? (await api.issues.create(repoPath, { objectTypeRef: typeRef!, title: shownTitle.trim(), fields: {}, origin: { runs: [runId] } }, workspaceDir)).id
      if (mode === 'create') created.current = issueId
      const already = new Set(links.filter(l => l.type === ISSUE_IMPACT_LINK && (l.sourceId === issueId || l.targetId === issueId))
        .flatMap(l => [l.sourceId, l.targetId]))
      for (const r of selectedReqs) {
        if (already.has(r.id)) continue
        await api.requirements.linkCreate(repoPath, { type: ISSUE_IMPACT_LINK, sourceId: issueId, targetId: r.id }, workspaceDir)
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['issues', repoPath] }),
        qc.invalidateQueries({ queryKey: ['objects', repoPath, 'issue'] }),
        qc.invalidateQueries({ queryKey: ['versions'] }),
        qc.invalidateQueries({ queryKey: ['links-list'] }),
        qc.invalidateQueries({ queryKey: ['links-objects'] }),
      ])
      onClose()
    } catch (err) {
      setError(parseLinkError(err).reason || (err instanceof Error ? err.message : t('common.unknownError')))
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={onClose}>
      <div role="dialog" aria-label={t('issues.proposal.title')} className="bg-surface border border-edge rounded-lg shadow-xl w-[32rem] max-w-[95vw] p-4 flex flex-col gap-3" onClick={e => e.stopPropagation()} data-testid="issue-proposal">
        <div>
          <h2 className="text-sm font-semibold text-ink">{t('issues.proposal.title')}</h2>
          <p className="text-xs text-ink-3">{t('issues.proposal.hint', { id: testId })}</p>
        </div>
        <div className="flex gap-3 text-xs">
          <label className="flex items-center gap-1.5 text-ink-2">
            <input type="radio" checked={mode === 'create'} onChange={() => setMode('create')} data-testid="issue-proposal-create-mode" />
            {t('issues.proposal.create')}
          </label>
          <label className="flex items-center gap-1.5 text-ink-2">
            <input type="radio" checked={mode === 'link'} onChange={() => setMode('link')} disabled={issues.length === 0} data-testid="issue-proposal-link-mode" />
            {t('issues.proposal.link')}
          </label>
        </div>
        {mode === 'create' ? (
          <>
            {types.length > 1 && (
              <label className="flex flex-col gap-1 text-xs text-ink-2">
                {t('issues.proposal.type')}
                <select value={typeRef} onChange={e => setChosenType(e.target.value)} className="input-field text-xs">
                  {types.map(r => <option key={r.ref} value={r.ref}>{r.label}</option>)}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs text-ink-2">
              {t('issues.proposal.issueTitle')}
              <input value={shownTitle} onChange={e => setTitle(e.target.value)} className="input-field text-xs" data-testid="issue-proposal-title" />
            </label>
          </>
        ) : (
          <label className="flex flex-col gap-1 text-xs text-ink-2">
            {t('issues.proposal.existing')}
            <select value={existing} onChange={e => setExisting(e.target.value)} className="input-field text-xs" data-testid="issue-proposal-existing">
              <option value="">—</option>
              {issues.map(i => <option key={i.id} value={i.id}>{i.id} — {i.title}</option>)}
            </select>
          </label>
        )}
        <div className="flex flex-col gap-1 text-xs text-ink-2">
          {t('issues.proposal.impacted')}
          {requirements.length === 0
            ? <span className="italic text-ink-3">{t('issues.proposal.noRequirement')}</span>
            : requirements.map(r => (
              <label key={r.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={!unchecked.has(r.id)}
                  onChange={() => setUnchecked(prev => { const n = new Set(prev); if (!n.delete(r.id)) n.add(r.id); return n })}
                />
                <span className="font-mono">{r.id}</span> <span className="truncate">{r.title}</span>
              </label>
            ))}
        </div>
        {error && <p className="text-xs text-status-danger" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary-sm" data-testid="issue-proposal-ignore">{t('issues.proposal.ignore')}</button>
          <button type="button" onClick={() => void submit()} disabled={!canSubmit} className="btn-primary-sm" data-testid="issue-proposal-submit">
            {mode === 'create' ? t('issues.proposal.create') : t('issues.proposal.link')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
