import { useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import type { ExportTemplateKey, TemplateExportFormat } from '@polenta/types'
import { api } from '../../api'

/**
 * GH54 — bibliothèque personnelle de gabarits d'export, dans les préférences du client web : ajouter,
 * remplacer (ligne par ligne, sur confirmation) et supprimer (avec avertissement si le gabarit est la
 * préférence du projet). Après chaque action, les listes d'export sont relues.
 */

const FORMAT_LABEL: Record<TemplateExportFormat, string> = { docx: 'Word (.docx)', xlsx: 'Excel (.xlsx)' }

type Pending =
  | { kind: 'replace'; format: TemplateExportFormat; relPath: string }
  | { kind: 'delete'; format: TemplateExportFormat; relPath: string; referencedBy: string[] }

interface Props {
  formats: TemplateExportFormat[]
  /** Gabarits par défaut du projet ouvert (`schema.preferences.exportTemplates`). */
  projectTemplates: Partial<Record<ExportTemplateKey, string>>
}

/** Un gabarit à la racine de la bibliothèque peut être remplacé (le nom du fichier envoyé doit être le sien). */
function replaceable(relPath: string): boolean {
  return !relPath.includes('/')
}

export function TemplateLibraryWeb({ formats, projectTemplates }: Props) {
  const queryClient = useQueryClient()
  const lists = useQueries({
    queries: formats.map(format => ({
      queryKey: ['export-templates', format],
      queryFn: () => api.export.listTemplates(format),
    })),
  })
  const [pending, setPending] = useState<Pending | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['export-templates'] })

  /** Envoi d'un gabarit ; `exists` ouvre la confirmation de remplacement (D3). */
  async function send(format: TemplateExportFormat, replace: boolean, expectedName?: string) {
    setMessage(null)
    setBusy(true)
    try {
      const result = await api.export.importTemplate(format, replace, expectedName)
      if (result.status === 'exists') setPending({ kind: 'replace', format, relPath: result.relPath })
      else if (result.status === 'refused') setMessage(result.message)
      else if (result.status === 'ok') {
        setMessage(`« ${result.relPath} » ${replace ? 'remplacé' : 'ajouté'}.`)
        refresh()
      }
    } catch (err) {
      // Message du serveur (ex. fichier trop volumineux) ; sinon réseau ou session.
      setMessage(err instanceof Error && err.message ? err.message : 'Envoi impossible : session expirée ou réseau indisponible. Rien n’a été modifié.')
    } finally {
      setBusy(false)
    }
  }

  function askDelete(format: TemplateExportFormat, relPath: string) {
    const referencedBy = Object.entries(projectTemplates)
      .filter(([key, value]) => value === relPath && key.endsWith(`:${format}`))
      .map(([key]) => key)
    setPending({ kind: 'delete', format, relPath, referencedBy })
  }

  async function confirmDelete(p: Extract<Pending, { kind: 'delete' }>) {
    setPending(null)
    setMessage(null)
    setBusy(true)
    try {
      const result = await api.export.deleteTemplate(p.relPath)
      if (result.status === 'ok') {
        setMessage(`« ${p.relPath} » supprimé.`)
        refresh()
      } else {
        setMessage(result.message)
      }
    } catch (err) {
      setMessage(err instanceof Error && err.message ? err.message : 'Suppression impossible : session expirée ou réseau indisponible. Rien n’a été supprimé.')
    } finally {
      setBusy(false)
    }
  }

  const button = 'text-xs px-3 py-1.5 border border-edge rounded hover:bg-hover text-ink-2 disabled:opacity-40 shrink-0'

  return (
    <div className="mt-4 space-y-4" data-testid="template-library-web">
      {formats.map((format, i) => {
        const templates = lists[i]?.data?.templates ?? []
        return (
          <div key={format} className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-sm text-ink flex-1">{FORMAT_LABEL[format]}</p>
              <button type="button" className={button} disabled={busy} onClick={() => void send(format, false)}>
                Ajouter un gabarit
              </button>
            </div>
            {templates.length === 0 ? (
              <p className="text-xs text-ink-3">Aucun gabarit dans votre bibliothèque.</p>
            ) : (
              <ul className="space-y-1">
                {templates.map(tpl => (
                  <li key={tpl.relPath} className="flex items-center gap-2 text-xs text-ink-2">
                    <span className="flex-1 truncate" title={tpl.relPath}>{tpl.relPath}</span>
                    {replaceable(tpl.relPath) && (
                      <button
                        type="button"
                        className={button}
                        disabled={busy}
                        onClick={() => void send(format, true, tpl.relPath)}
                        title="Choisissez un fichier portant ce nom"
                      >
                        Remplacer
                      </button>
                    )}
                    <button type="button" className={button} disabled={busy} onClick={() => askDelete(format, tpl.relPath)}>
                      Supprimer
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}

      {message && <p role="status" className="text-xs text-ink-2">{message}</p>}

      {pending?.kind === 'replace' && (
        <div role="alertdialog" aria-label="Remplacer le gabarit" className="p-3 border border-edge rounded bg-surface space-y-2">
          <p className="text-sm text-ink">Un gabarit nommé « {pending.relPath} » existe déjà. Le remplacer ? Son contenu actuel sera perdu.</p>
          <p className="text-xs text-ink-3">Choisissez ensuite le fichier de remplacement, qui doit porter ce nom.</p>
          <div className="flex gap-2">
            <button type="button" className={button} onClick={() => setPending(null)}>Annuler</button>
            <button type="button" className={button} onClick={() => {
              const p = pending
              setPending(null)
              void send(p.format, true, p.relPath)
            }}>Remplacer</button>
          </div>
        </div>
      )}

      {pending?.kind === 'delete' && (
        <div role="alertdialog" aria-label="Supprimer le gabarit" className="p-3 border border-edge rounded bg-surface space-y-2">
          <p className="text-sm text-ink">Supprimer « {pending.relPath} » de votre bibliothèque ? Le fichier est effacé du disque.</p>
          {pending.referencedBy.length > 0 && (
            <p className="text-xs text-status-danger">
              Ce gabarit est le gabarit par défaut du projet ({pending.referencedBy.join(', ')}). Après suppression, l'export
              utilisera « Standard » à la place.
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" className={button} onClick={() => setPending(null)}>Annuler</button>
            <button type="button" className={button} onClick={() => void confirmDelete(pending)}>Supprimer</button>
          </div>
        </div>
      )}
    </div>
  )
}
