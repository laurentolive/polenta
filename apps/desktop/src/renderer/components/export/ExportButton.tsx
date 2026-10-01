import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueries } from '@tanstack/react-query'
import { AlertTriangle, Download, FileSpreadsheet, FileText, FileType } from 'lucide-react'
import { api } from '../../api'
import { useProjectSchema } from '../../hooks/useProjectSchema'
import { TEMPLATE_FORMATS_BY_KIND, templateKey } from '../../lib/exportTemplates'
import type { ExportFormat, ExportKind, ExportResult, TemplateExportFormat } from '@polenta/types'

const FORMAT_META: Record<ExportFormat, { label: string; icon: typeof Download; extension: string }> = {
  xlsx: { label: 'Excel', icon: FileSpreadsheet, extension: 'xlsx' },
  docx: { label: 'Word', icon: FileText, extension: 'docx' },
  pdf: { label: 'PDF', icon: FileType, extension: 'pdf' },
}

interface ExportButtonProps {
  kind: ExportKind
  formats: ExportFormat[]
  repoPath: string
  /** Nom de fichier par défaut, sans extension — cf. specs/T43.md §4. Fonction (plutôt qu'une
   *  valeur déjà résolue) pour ne calculer les infos nécessaires (ex. SHA du commit HEAD) qu'à
   *  l'ouverture du popover, pas à chaque rendu de la vue qui héberge ce bouton. */
  getSuggestedBaseName: () => string | Promise<string>
  /** xlsx/docx : données déjà chargées/filtrées côté vue, envoyées telles quelles au main process.
   *  Peut être async (ex. dashboard : exécute les requêtes de chaque widget avant export). Reçoit
   *  le format demandé — nécessaire pour les vues dont la configuration de colonnes diffère entre
   *  Excel et Word (`visibleFieldsExcel`/`visibleFieldsWord` de `SystemView.tsx`). `templated`
   *  (GH34) : un gabarit client est choisi — la vue peut joindre des données que seul le gabarit
   *  utilise (ex. arbre complet avec dossiers). */
  getPayload?: (format: 'xlsx' | 'docx', options: { templated: boolean }) => unknown | Promise<unknown>
  /** pdf : paramètres transmis à la route imprimable `/print/<kind>`, qui recharge ses propres données. */
  getPrintParams?: () => Record<string, string>
}

/** Bouton "Exporter" partagé, inséré dans le slot `actions` d'un `ViewHeader` — popover listant
 *  les formats disponibles pour la vue (cf. specs/T43-design.md, mapping formats/type). */
export function ExportButton({ kind, formats, repoPath, getSuggestedBaseName, getPayload, getPrintParams }: ExportButtonProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const templates = useExportTemplates(kind, formats, repoPath, open)

  const exportMutation = useMutation({
    mutationFn: async (format: ExportFormat): Promise<ExportResult> => {
      const baseName = await getSuggestedBaseName()
      const suggestedName = `${baseName}.${FORMAT_META[format].extension}`
      if (format === 'pdf') {
        if (!getPrintParams) throw new Error(t('exportButton.pdfNotAvailable'))
        return api.export.save(repoPath, kind, format, undefined, getPrintParams(), suggestedName)
      }
      if (!getPayload) throw new Error(t('exportButton.formatNotAvailable', { format: FORMAT_META[format].label }))
      const templateRelPath = templates.selection[format as TemplateExportFormat] || undefined
      const payload = await getPayload(format, { templated: !!templateRelPath })
      return api.export.save(repoPath, kind, format, payload, undefined, suggestedName, templateRelPath)
    },
    onSuccess: (result) => {
      setOpen(false)
      if (result.status === 'error') setError(result.message)
      // `canceled` : l'utilisateur a fermé le dialogue natif — pas d'erreur, pas de confirmation
      // (comportement volontaire, distinct d'un succès silencieux).
      if (result.status === 'ok') setSavedPath(result.filePath)
    },
    onError: (err: unknown) => {
      setOpen(false)
      setError(err instanceof Error ? err.message : t('exportButton.exportError'))
    },
  })

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="btn-secondary-sm flex items-center gap-1.5"
        title={t('exportButton.export')}
      >
        <Download size={13} />
        {t('exportButton.export')}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-2 z-50 bg-surface border border-edge rounded-lg shadow-xl p-2 flex flex-col gap-2"
            onClick={e => e.stopPropagation()}
          >
            {templates.formats.map(f => (
              <TemplateSelect
                key={f.format}
                label={t('exportButton.templateFor', { format: FORMAT_META[f.format].label })}
                state={f}
                value={templates.selection[f.format] ?? ''}
                onChange={value => templates.select(f.format, value)}
              />
            ))}
            <div className="flex gap-1">
            {formats.map(format => {
              const meta = FORMAT_META[format]
              const Icon = meta.icon
              return (
                <button
                  key={format}
                  type="button"
                  onClick={() => exportMutation.mutate(format)}
                  // Pas d'export tant que la liste des gabarits de ce format n'est pas chargée :
                  // la présélection (défaut du projet ou Standard) n'est pas encore connue.
                  disabled={exportMutation.isPending || templates.formats.some(f => f.format === format && f.loading)}
                  className="flex flex-col items-center gap-1 px-3 py-2 rounded hover:bg-hover text-xs text-ink-2 disabled:opacity-50"
                >
                  <Icon size={18} />
                  {meta.label}
                </button>
              )
            })}
            </div>
          </div>
        </>
      )}

      {error && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setError(null)} />
          <div
            className="absolute right-0 top-full mt-2 z-50 bg-surface border border-edge rounded-lg shadow-xl p-3 w-72"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-xs text-status-danger mb-2">{error}</p>
            <button type="button" onClick={() => setError(null)} className="btn-secondary-sm">
              {t('common.close')}
            </button>
          </div>
        </>
      )}

      {savedPath && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setSavedPath(null)} />
          <div
            className="absolute right-0 top-full mt-2 z-50 bg-surface border border-edge rounded-lg shadow-xl p-3 w-96"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-xs text-ink-2 mb-2 break-all">{t('exportButton.exportedTo', { path: savedPath })}</p>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => api.export.showInFolder(savedPath)} className="btn-secondary-sm">
                {t('exportButton.openFolder')}
              </button>
              <button type="button" onClick={() => api.export.openFile(savedPath)} className="btn-secondary-sm">
                {t('exportButton.openFile')}
              </button>
              <button type="button" onClick={() => setSavedPath(null)} className="btn-secondary-sm">
                {t('common.close')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

interface TemplateFormatState {
  format: TemplateExportFormat
  loading: boolean
  dirConfigured: boolean
  dirExists: boolean
  templates: string[]
  /** Gabarit par défaut du projet pour ce kind/format, présent ou non dans la bibliothèque. */
  projectDefault: string
  /** Défaut du projet absent de la bibliothèque (non configurée, fichier renommé/supprimé). */
  defaultMissing: boolean
}

/**
 * GH34 — gabarits proposés à l'export, par format acceptant un gabarit pour ce kind : liste de la
 * bibliothèque (relue à chaque ouverture du popover, pas de cache) et présélection du défaut du
 * projet — jamais d'un autre gabarit si ce défaut est introuvable (« Standard » à la place).
 */
function useExportTemplates(kind: ExportKind, formats: ExportFormat[], repoPath: string, open: boolean) {
  const templateFormats = (TEMPLATE_FORMATS_BY_KIND[kind] ?? []).filter(f => formats.includes(f))
  const { data: schema } = useProjectSchema(repoPath)
  const lists = useQueries({
    queries: templateFormats.map(format => ({
      queryKey: ['export-templates', format],
      queryFn: () => api.export.listTemplates(format),
      enabled: open,
      staleTime: 0,
      gcTime: 0,
    })),
  })

  const states: TemplateFormatState[] = templateFormats.map((format, i) => {
    const query = lists[i]
    // Échec de lecture de la liste : traité comme une bibliothèque introuvable (Standard
    // présélectionné), pas comme un chargement sans fin qui bloquerait l'export.
    const list = query?.data ?? (query?.isError ? { dirConfigured: true, dirExists: false, templates: [] } : undefined)
    const projectDefault = schema?.preferences?.exportTemplates?.[templateKey(kind, format)] ?? ''
    const names = list?.templates.map(tpl => tpl.relPath) ?? []
    return {
      format,
      loading: !list,
      dirConfigured: list?.dirConfigured ?? false,
      dirExists: list?.dirExists ?? false,
      templates: names,
      projectDefault,
      defaultMissing: !!list && !!projectDefault && !names.includes(projectDefault),
    }
  })

  const [selection, setSelection] = useState<Partial<Record<TemplateExportFormat, string>>>({})
  const [touched, setTouched] = useState(false)
  // Présélection (défaut du projet, ou Standard s'il est introuvable) recalculée à chaque
  // ouverture tant que l'utilisateur n'a rien choisi ; le choix fait ne modifie pas le défaut.
  const readyKey = states.map(s => `${s.format}:${s.loading}:${s.projectDefault}:${s.defaultMissing}`).join('|')
  useEffect(() => {
    if (!open) {
      setTouched(false)
      return
    }
    if (touched) return
    setSelection(Object.fromEntries(states.map(s => [s.format, s.loading || s.defaultMissing ? '' : s.projectDefault])))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `readyKey` résume `states`
  }, [open, readyKey, touched])

  return {
    formats: states,
    selection,
    select: (format: TemplateExportFormat, value: string) => {
      setTouched(true)
      setSelection(s => ({ ...s, [format]: value }))
    },
  }
}

function TemplateSelect({ label, state, value, onChange }: {
  label: string
  state: TemplateFormatState
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  let hint: string | null = null
  if (!state.loading && !state.dirConfigured) hint = t('exportButton.noTemplateLibrary')
  else if (!state.loading && !state.dirExists) hint = t('exportButton.templateLibraryMissing')
  else if (state.defaultMissing) hint = t('exportButton.defaultTemplateMissing', { path: state.projectDefault })

  return (
    <label className="flex flex-col gap-1 text-xs text-ink-2 w-64">
      {label}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={state.loading}
        className="input-field text-xs py-1"
      >
        <option value="">{t('exportButton.standardTemplate')}</option>
        {state.defaultMissing && (
          <option value={state.projectDefault} disabled>
            ⚠ {state.projectDefault} ({t('exportButton.notFound')})
          </option>
        )}
        {state.templates.map(path => (
          <option key={path} value={path}>{path}</option>
        ))}
      </select>
      {hint && (
        <span className="flex items-start gap-1 text-ink-3">
          <AlertTriangle size={12} className="text-status-warning mt-0.5 shrink-0" />
          {hint}
        </span>
      )}
    </label>
  )
}
