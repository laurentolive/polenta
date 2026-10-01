import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { useProjectSchema } from '../hooks/useProjectSchema'
import { useVersioning } from '../contexts/VersioningContext'
import { decodeProjectId } from '../lib/projectId'
import { CancelConfirmModal } from '../components/schema/objectTypeEditor'
import { ViewHeader } from '../components/layout/ViewHeader'
import { TEMPLATE_KEYS, templateKey } from '../lib/exportTemplates'
import type { ExportTemplateKey, ProjectSchema, TemplateExportFormat } from '@polenta/types'

export const Route = createFileRoute('/preferences')({
  component: PreferencesPage,
  validateSearch: (search: Record<string, unknown>) => ({
    repoPath: (search['repoPath'] as string) ?? '',
    projectId: (search['projectId'] as string) ?? '',
  }),
})

// Dedicated page for project-level tool preferences (T96), reached from its own sidebar item
// (ProjectPanel.tsx), separate from the Modèle de données page/schema editor: autoPropagatePin and
// default export templates (GH34) — more will be added to this same EditorState/form as they come.

interface EditorState {
  autoPropagatePin: boolean
  /** GH34 — gabarit d'export par défaut par `<kind>:<format>` ; absent = Standard. */
  exportTemplates: Partial<Record<ExportTemplateKey, string>>
}

function schemaToEditable(schema: ProjectSchema): EditorState {
  return {
    autoPropagatePin: schema.preferences?.autoPropagatePin ?? false,
    exportTemplates: { ...schema.preferences?.exportTemplates },
  }
}

function editableToSchema(state: EditorState, schema: ProjectSchema): ProjectSchema {
  const { exportTemplates: _previous, ...otherPreferences } = schema.preferences ?? {}
  // Entrées « Standard » retirées plutôt qu'écrites vides ; clé entière omise si rien n'est défini.
  const exportTemplates = Object.fromEntries(Object.entries(state.exportTemplates).filter(([, v]) => !!v))
  return {
    ...schema,
    preferences: {
      ...otherPreferences,
      autoPropagatePin: state.autoPropagatePin,
      ...(Object.keys(exportTemplates).length > 0 ? { exportTemplates } : {}),
    },
  }
}

function PreferencesPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { repoPath: repoPathParam, projectId } = Route.useSearch()
  const workspaceDir = projectId ? decodeProjectId(projectId) : repoPathParam
  const { repoPath: contextRepoPath } = useVersioning()
  const repoPath = repoPathParam || contextRepoPath

  useEffect(() => {
    if (workspaceDir) api.workspace.markRecent(workspaceDir)
  }, [workspaceDir])

  const { data: schema, isLoading } = useProjectSchema(repoPath)
  const templateFormats = [...new Set(TEMPLATE_KEYS.map(k => k.format))]
  const templateLists = useQueries({
    queries: templateFormats.map(format => ({
      queryKey: ['export-templates', format],
      queryFn: () => api.export.listTemplates(format),
      staleTime: 0,
    })),
  })
  const templatesByFormat = new Map<TemplateExportFormat, string[]>(
    templateFormats.map((format, i) => [format, templateLists[i]?.data?.templates.map(tpl => tpl.relPath) ?? []]),
  )
  const libraryConfigured = templateLists.some(q => q.data?.dirConfigured)
  const [state, setState] = useState<EditorState | null>(null)
  const [savedState, setSavedState] = useState<EditorState | null>(null)
  const [saved, setSaved] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  useEffect(() => {
    if (schema && !state) {
      const editable = schemaToEditable(schema)
      setState(editable)
      setSavedState(editable)
    }
  }, [schema, state])

  const isDirty = savedState !== null && JSON.stringify(state) !== JSON.stringify(savedState)

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!state || !schema) throw new Error('no state')
      return api.schema.save(repoPath, editableToSchema(state, schema))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schema', repoPath] })
      setSavedState(state)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showCancelConfirm) { setShowCancelConfirm(false); return }
        if (isDirty) setShowCancelConfirm(true)
      }
      if (e.key === 'Enter' && !showCancelConfirm) {
        if (document.activeElement?.closest('.fixed.inset-0')) return
        if (isDirty && !saveMutation.isPending) saveMutation.mutate()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isDirty, showCancelConfirm, saveMutation])

  if (isLoading || !state || !schema) {
    return <div className="text-sm text-ink-3 p-4">{t('preferences.loading')}</div>
  }

  function handleCancelConfirmed() {
    setState(savedState)
    setShowCancelConfirm(false)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {showCancelConfirm && (
        <CancelConfirmModal onConfirm={handleCancelConfirmed} onClose={() => setShowCancelConfirm(false)} />
      )}
      <ViewHeader
        currentProjectId={projectId}
        title={<>{t('preferences.title')}{isDirty && <span className="text-status-warning ml-1">*</span>}</>}
        actions={
          <>
            {saved && <span className="text-xs text-status-success">✓ {t('preferences.saved')}</span>}
            {saveMutation.isError && (
              <span className="text-xs text-status-danger">
                {saveMutation.error instanceof Error ? saveMutation.error.message : t('preferences.error')}
              </span>
            )}
            {isDirty && (
              <button
                type="button"
                onClick={() => setShowCancelConfirm(true)}
                className="btn-secondary-sm"
              >
                {t('common.cancel')}
              </button>
            )}
            {isDirty && (
              <button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
                className="btn-primary-sm">
                {saveMutation.isPending ? t('preferences.saving') : t('common.save')}
              </button>
            )}
          </>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl p-6">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={state.autoPropagatePin}
              onChange={e => setState(s => s ? { ...s, autoPropagatePin: e.target.checked } : s)}
              className="mt-0.5"
            />
            <span className="text-sm text-ink">
              {t('preferences.autoPropagateLabel')}
              <span className="block text-xs text-ink-3 mt-0.5">
                {t('preferences.autoPropagateHelp')}
              </span>
            </span>
          </label>

          {/* GH34 — gabarit d'export par défaut, partagé par l'équipe via schema.yaml. */}
          <div className="mt-6">
            <p className="text-sm text-ink">{t('preferences.exportTemplatesTitle')}</p>
            <p className="text-xs text-ink-3 mt-0.5 mb-3">
              {libraryConfigured ? t('preferences.exportTemplatesHelp') : t('preferences.exportTemplatesNoLibrary')}
            </p>
            <div className="space-y-2">
              {TEMPLATE_KEYS.map(({ kind, format }) => {
                const key = templateKey(kind, format)
                const value = state.exportTemplates[key] ?? ''
                const available = templatesByFormat.get(format) ?? []
                const missing = !!value && !available.includes(value)
                return (
                  <label key={key} className="flex items-center gap-3">
                    <span className="text-xs text-ink-2 w-56">{t(`preferences.exportTemplateKind.${kind}`)} ({format})</span>
                    <select
                      value={value}
                      onChange={e => setState(s => {
                        if (!s) return s
                        // « Standard » = clé retirée (pas une chaîne vide), pour que l'état
                        // redevienne identique à celui enregistré et que la page ne reste pas
                        // marquée modifiée.
                        const { [key]: _previous, ...others } = s.exportTemplates
                        return { ...s, exportTemplates: e.target.value ? { ...others, [key]: e.target.value } : others }
                      })}
                      className="input-field flex-1 text-xs py-1"
                    >
                      <option value="">{t('exportButton.standardTemplate')}</option>
                      {missing && <option value={value}>⚠ {value} ({t('exportButton.notFound')})</option>}
                      {available.map(path => <option key={path} value={path}>{path}</option>)}
                    </select>
                  </label>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
