import { useCallback, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { ParamResolutionPreview, TestCase } from '@polenta/types'
import { api } from '../../api'
import { useProjectSchema, getTestTypeRefs } from '../../hooks/useProjectSchema'
import { useParamPreview } from '../../hooks/useParamPreview'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { FilterOptionsToggle } from '../FilterOptionsToggle'
import { TestParamFields } from '../TestParamFields'
import { ReqInstancePicker } from './ReqInstancePicker'
import { TestPickerGrid } from './TestPickerGrid'
import { NO_FILTER_OPTIONS, type FilterOptions } from '../../lib/textFilter'
import {
  countInstances, effectiveReqSelection, isAddComplete, isIteratingPreview, setReqValue, toggleReq,
  type ReqSelectionState,
} from '../../lib/reqInstances'

export interface PickerResult {
  testIds: string[]
  paramValues: Record<string, Record<string, string>>
  reqSel: ReqSelectionState
}

export const EMPTY_PICKER_RESULT: PickerResult = { testIds: [], paramValues: {}, reqSel: {} }

/**
 * GH33 — sélecteur de tests d'une campagne, en modale à deux étapes : (1) sélection dans une Vue
 * Excel en lecture seule, un type de test à la fois, filtres colonne T51 ; (2) saisie des
 * paramètres / exigences des seuls tests qui en demandent (sautée sinon). Les règles d'éligibilité
 * (`candidates`) et l'écriture (`onConfirm`) restent à l'appelant.
 */
export function TestPickerModal({
  repoPath,
  workspaceDir,
  mode,
  candidates,
  allTests,
  defaultTypeRef,
  previewSource,
  initial,
  presentOf,
  includedCount,
  onConfirm,
  onCancel,
}: {
  repoPath: string
  workspaceDir: string
  /** `add` : ajout à une campagne existante (au moins un test requis) ; `create` : formulaire. */
  mode: 'create' | 'add'
  /** Tests proposés dans la grille. */
  candidates: TestCase[]
  /** Pour retrouver le titre d'un test présélectionné hors `candidates` (préremplissage T46). */
  allTests?: TestCase[]
  defaultTypeRef?: string
  /** Source de la résolution des paramètres (T171) : campagne existante ou `baselineRef` saisi. */
  previewSource: { campaignId?: string; baselineRef?: string }
  initial: PickerResult
  /** T179 — exigences ayant déjà une instance dans la campagne, par test. */
  presentOf: (testId: string) => Set<string>
  /** Nombre d'instances déjà présentes (badge « déjà ×N », mode ajout). */
  includedCount?: (testId: string) => number
  /** `previews` : résolution des paramètres sur laquelle la sélection a été validée (même source
   *  que `previewSource`). Rejet = erreur affichée, modale laissée ouverte. */
  onConfirm: (result: PickerResult, previews: Map<string, ParamResolutionPreview>) => Promise<void> | void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const { data: schema } = useProjectSchema(repoPath)
  const typeRefs = useMemo(() => getTestTypeRefs(schema), [schema])
  const { data: identityLogin, isPending: identityPending } = useQuery({
    queryKey: ['project-username', repoPath],
    queryFn: () => api.auth.projectUsername(repoPath),
    enabled: !!repoPath,
    retry: false,
  })
  const username = identityLogin ?? 'local'

  const [step, setStep] = useState<1 | 2>(1)
  const [chosenTypeRef, setChosenTypeRef] = useState<string | null>(null)
  // Type par défaut : celui de la route s'il existe, sinon le premier type ayant des tests
  // proposés (ex. route filtrée par composant seul), sinon le premier type.
  const typeRef = chosenTypeRef
    ?? (defaultTypeRef && typeRefs.some(r => r.ref === defaultTypeRef) ? defaultTypeRef : undefined)
    ?? typeRefs.find(r => candidates.some(tc => tc.objectTypeRef === r.ref))?.ref
    ?? typeRefs[0]?.ref
  const currentType = typeRefs.find(r => r.ref === typeRef)
  const [filter, setFilter] = useState('')
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(NO_FILTER_OPTIONS)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial.testIds))
  const [displayed, setDisplayed] = useState<string[]>([])
  const [paramValues, setParamValues] = useState(initial.paramValues)
  const [reqSel, setReqSel] = useState<ReqSelectionState>(initial.reqSel)
  const [confirmAbandon, setConfirmAbandon] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const testsById = useMemo(
    () => new Map([...(allTests ?? []), ...candidates].map(tc => [tc.id, tc])),
    [allTests, candidates],
  )
  const typeCandidates = useMemo(
    () => candidates.filter(tc => tc.objectTypeRef === typeRef),
    [candidates, typeRef],
  )
  // Ordre du résultat : ordre des candidats, puis tests présélectionnés hors candidats.
  const orderedSelected = useMemo(() => {
    const inCandidates = candidates.filter(tc => selected.has(tc.id)).map(tc => tc.id)
    const known = new Set(inCandidates)
    return [...inCandidates, ...[...selected].filter(id => !known.has(id))]
  }, [candidates, selected])

  // Prévisualisation sur tous les candidats (+ présélection) : une seule requête à l'ouverture,
  // pas une par changement de sélection.
  const previewIds = useMemo(
    () => [...new Set([...candidates.map(tc => tc.id), ...initial.testIds])],
    [candidates, initial.testIds],
  )
  const { previews, isLoading: previewLoading } = useParamPreview(repoPath, previewSource, previewIds, workspaceDir)

  const needsInput = (id: string) => {
    const p = previews.get(id)
    return isIteratingPreview(p) || (p?.manual?.length ?? 0) > 0
  }
  const inputIds = orderedSelected.filter(needsInput)
  const hasStep2 = inputIds.length > 0
  // Lignes affichées : seulement quand une grille du type courant est montée (étape 1, type avec
  // des tests proposés) — sinon la dernière liste reçue serait celle d'un autre type.
  const displayedSet = new Set(step === 1 && typeCandidates.length > 0 ? displayed : [])
  const hiddenCount = step === 1 ? orderedSelected.filter(id => !displayedSet.has(id)).length : 0
  const complete = isAddComplete(orderedSelected, previews, paramValues, reqSel, presentOf, mode === 'add')
  const instanceCount = countInstances(orderedSelected, previews, reqSel, presentOf)

  const isDirty = useCallback(() => {
    const a = [...selected].sort().join(',')
    const b = [...initial.testIds].sort().join(',')
    return a !== b
      || JSON.stringify(paramValues) !== JSON.stringify(initial.paramValues)
      || JSON.stringify(reqSel) !== JSON.stringify(initial.reqSel)
  }, [selected, paramValues, reqSel, initial])

  const requestCancel = useCallback(() => {
    if (submitting) return
    if (isDirty()) setConfirmAbandon(true)
    else onCancel()
  }, [isDirty, onCancel, submitting])
  useModalHotkeys(requestCancel, undefined, confirmAbandon)
  useModalHotkeys(() => setConfirmAbandon(false), undefined, !confirmAbandon)

  async function confirm() {
    if (previewLoading || !complete || submitting) return
    const keep = new Set(orderedSelected)
    const result: PickerResult = {
      testIds: orderedSelected,
      paramValues: Object.fromEntries(Object.entries(paramValues).filter(([id]) => keep.has(id))),
      reqSel: Object.fromEntries(Object.entries(reqSel).filter(([id]) => keep.has(id))),
    }
    setError(null)
    setSubmitting(true)
    try {
      await onConfirm(result, previews)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const confirmLabel = submitting
    ? t('campaignPage.adding')
    : mode === 'add'
      ? t('campaignPage.addCount', { count: instanceCount })
      : t('campaignPage.picker.confirmSelection', { count: instanceCount })
  const confirmDisabled = submitting || previewLoading || !complete

  const selection = useMemo(() => ({
    selected,
    onChange: setSelected,
    onDisplayedChange: setDisplayed,
    renderBadge: includedCount
      ? (id: string) => {
          const n = includedCount(id)
          return n > 0
            ? <span className="ml-1 text-[10px] text-ink-3" title={t('campaignPage.picker.alreadyIncluded', { count: n })}>×{n}</span>
            : null
        }
      : undefined,
  }), [selected, includedCount, t])

  // Portail : la modale peut être ouverte depuis un <form> (création de campagne) — rendue dans
  // ce formulaire, `Entrée` dans un de ses champs le soumettrait.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={requestCancel}>
      <div
        className="bg-surface border border-edge rounded-lg shadow-xl w-[95vw] h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
          <h2 className="text-sm font-semibold text-ink">
            {step === 1 ? t('campaignPage.picker.titleSelect') : t('campaignPage.picker.titleParams')}
          </h2>
          <span className="text-xs text-ink-3">{t('campaignPage.picker.step', { step, total: hasStep2 ? 2 : 1 })}</span>
        </div>

        {step === 1 && (
          typeRefs.length === 0 ? (
            <p className="flex-1 p-4 text-xs text-ink-3 italic">{t('campaignPage.picker.noTestType')}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-edge">
                <label className="flex items-center gap-2 text-xs text-ink-2">
                  {t('campaignPage.picker.testType')}
                  <select
                    value={typeRef}
                    onChange={e => { setChosenTypeRef(e.target.value); setFilter('') }}
                    className="input-field text-xs"
                  >
                    {typeRefs.map(r => <option key={r.ref} value={r.ref}>{r.label}</option>)}
                  </select>
                </label>
                <input
                  type="text"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  placeholder={t('common.filterPlaceholder')}
                  className="input-field text-xs flex-1 min-w-[12rem]"
                />
                <FilterOptionsToggle options={filterOptions} onChange={setFilterOptions} />
              </div>
              <div className="flex-1 min-h-0 flex flex-col">
                {currentType && !identityPending && (
                  typeCandidates.length === 0 ? (
                    <p className="p-4 text-xs text-ink-3 italic">
                      {mode === 'add' ? t('campaignPage.noApprovedTestAvailable') : t('campaignPage.noTestCaseAvailable')}
                    </p>
                  ) : (
                    <TestPickerGrid
                      repoPath={repoPath}
                      typeRef={currentType.ref}
                      typeDef={currentType.typeDef}
                      tests={typeCandidates}
                      username={username}
                      filter={filter}
                      filterOptions={filterOptions}
                      selection={selection}
                    />
                  )
                )}
              </div>
            </>
          )
        )}

        {step === 2 && (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2">
            {inputIds.map(id => {
              const tc = testsById.get(id)
              const p = previews.get(id)
              const present = presentOf(id)
              return (
                <div key={id} className="border border-edge rounded">
                  <p className="flex items-center gap-2 px-3 py-2 text-xs">
                    <span className="font-mono text-ink-3 shrink-0">{id}</span>
                    <span className="text-ink truncate">{tc?.title ?? ''}</span>
                  </p>
                  {isIteratingPreview(p) ? (() => {
                    const current = effectiveReqSelection(id, p, present, reqSel)
                    return (
                      <ReqInstancePicker
                        preview={p!}
                        present={present}
                        selection={current}
                        onToggle={reqId => setReqSel(prev => toggleReq(prev, id, reqId, current))}
                        onChange={(reqId, key, value) => setReqSel(prev => setReqValue(prev, id, reqId, current, key, value))}
                      />
                    )
                  })() : (
                    <TestParamFields
                      labels={p?.manual ?? []}
                      resolved={p?.resolved}
                      unresolved={p?.unresolved}
                      values={paramValues[id] ?? {}}
                      onChange={(label, value) => setParamValues(prev => ({
                        ...prev,
                        [id]: { ...(prev[id] ?? {}), [label]: value },
                      }))}
                    />
                  )}
                </div>
              )
            })}
            {orderedSelected.length > inputIds.length && (
              <details className="text-xs text-ink-3">
                <summary className="cursor-pointer">
                  {t('campaignPage.picker.withoutParams', { count: orderedSelected.length - inputIds.length })}
                </summary>
                <ul className="mt-1 pl-4 space-y-0.5">
                  {orderedSelected.filter(id => !needsInput(id)).map(id => (
                    <li key={id}><span className="font-mono">{id}</span> {testsById.get(id)?.title ?? ''}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 px-4 py-3 border-t border-edge">
          <p className="text-xs text-ink-2">
            {t('campaignPage.picker.selected', { count: orderedSelected.length })}
            {hiddenCount > 0 && t('campaignPage.picker.hiddenSuffix', { count: hiddenCount })}
          </p>
          {step === 1 && orderedSelected.length > 0 && (
            <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-status-info hover:opacity-80">
              {t('campaignPage.picker.clearSelection')}
            </button>
          )}
          {error && <p className="text-xs text-status-danger truncate">{error}</p>}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={requestCancel} className="btn-secondary" disabled={submitting}>
              {t('common.cancel')}
            </button>
            {step === 2 && (
              <button type="button" onClick={() => setStep(1)} className="btn-secondary" disabled={submitting}>
                {t('campaignPage.picker.previous')}
              </button>
            )}
            {step === 1 && hasStep2 ? (
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={previewLoading || (mode === 'add' && orderedSelected.length === 0)}
                className="btn-primary-sm"
              >
                {t('campaignPage.picker.next')}
              </button>
            ) : (
              <button type="button" onClick={confirm} disabled={confirmDisabled} className="btn-primary-sm">
                {confirmLabel}
              </button>
            )}
          </div>
        </div>
      </div>

      {confirmAbandon && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/40" onClick={e => { e.stopPropagation(); setConfirmAbandon(false) }}>
          <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-sm font-semibold text-ink mb-5">{t('campaignPage.picker.abandonTitle')}</h2>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmAbandon(false)} className="btn-secondary">
                {t('campaignPage.picker.keepEditing')}
              </button>
              <button type="button" onClick={onCancel} className="btn-danger" autoFocus>
                {t('campaignPage.picker.abandon')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
