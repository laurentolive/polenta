import { useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { useNotifyPrintReady } from '../lib/useNotifyPrintReady'
import { loadVersionSectionTables, parseVersionSections } from '../components/versions/versionExportData'

/**
 * GH439 §5.4 — PDF de la page d'une version : relit les données et construit **les mêmes tables** que l'export
 * Excel (`loadVersionSectionTables`), puis les imprime : un titre par section, un tableau statique par section,
 * en-tête répété à chaque page, lignes jamais coupées. A4 paysage et pied « page n / N » : `PDF_LAYOUT_BY_KIND`.
 */
export const Route = createFileRoute('/print/version')({
  component: PrintVersionPage,
  validateSearch: (s: Record<string, unknown>) => ({
    repoPath: (s['repoPath'] as string) ?? '',
    workspaceDir: (s['workspaceDir'] as string) ?? '',
    versionId: (s['versionId'] as string) ?? '',
    sections: (s['sections'] as string) ?? '',
    username: (s['username'] as string) ?? 'local',
    language: (s['language'] as string) ?? '',
  }),
})

function PrintVersionPage() {
  const { t, i18n } = useTranslation()
  const { repoPath, workspaceDir, versionId, sections, username, language } = Route.useSearch()

  // La fenêtre d'impression ne partage pas la langue de l'écran d'origine (web : contexte neuf) : celle de
  // l'utilisateur est transmise. Les données ne sont lues qu'une fois la langue appliquée.
  useEffect(() => {
    if (language && i18n.language !== language) void i18n.changeLanguage(language)
  }, [language, i18n])
  const languageReady = !language || i18n.language === language

  const { data, isSuccess } = useQuery({
    queryKey: ['print-version', repoPath, workspaceDir, versionId, sections, username, i18n.language],
    queryFn: () => loadVersionSectionTables({
      repoPath, workspaceDir, versionId, selected: parseVersionSections(sections), username, t, language: i18n.language,
    }),
    enabled: languageReady && !!repoPath && !!versionId,
    retry: false,
  })
  useNotifyPrintReady(isSuccess)
  if (!data) return null
  const { page, tables } = data

  return (
    <div className="p-6 bg-print-bg text-print-ink text-xs min-h-screen" data-testid="print-version">
      <h1 className="text-lg font-semibold">{page.version.title} — {page.component.label}</h1>
      <p className="text-print-ink-2 mb-6">{page.version.id} · {t(`versions.state.${page.state}`)}</p>
      {tables.map(table => (
        <section key={table.id} className="mb-6" data-testid={`print-version-${table.id}`}>
          <h2 className="text-sm font-semibold mb-2 break-after-avoid">{table.title}</h2>
          <table className="w-full border-collapse">
            {/* En-tête répété sur chaque page ; une ligne n'est jamais coupée entre deux pages. */}
            <thead style={{ display: 'table-header-group' }}>
              <tr>
                {table.columns.map(c => (
                  <th key={c.key} className="text-left font-medium text-print-ink-2 border border-print-border px-1.5 py-1 align-top">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i} className="break-inside-avoid">
                  {table.columns.map(c => (
                    <td key={c.key} className="border border-print-border px-1.5 py-1 align-top whitespace-pre-wrap" style={{ overflowWrap: 'anywhere' }}>{row[c.key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}
