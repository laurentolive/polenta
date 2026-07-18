import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useNotifyPrintReady } from '../lib/useNotifyPrintReady'
import { normalizeObject } from '../lib/normalizeObject'
import { buildExportRows } from '../lib/exportColumns'
import { computeSectionNumbers } from '../hooks/useTreeState'
import { getReqTypeDef } from '../hooks/useProjectSchema'

/**
 * Route imprimable — jamais visitée par l'utilisateur, chargée uniquement par la fenêtre Electron
 * cachée d'un export PDF (cf. `pdf.util.ts`). Recharge elle-même l'arbre, le schéma, la
 * configuration de colonnes (`visibleFieldsWord` — le pdf vise un rendu visuel équivalent au
 * docx, cf. specs/T43-tests.md scénario 5) et les exigences, puis construit les mêmes
 * colonnes/lignes que `SystemView.tsx` via `buildExportRows` — décision structurante de
 * specs/T43-design.md, corrigée post-validation pour utiliser la configuration réelle plutôt
 * qu'un jeu de champs fixe (cf. `RequirementsExportPayload` dans `@polenta/types`).
 */
export const Route = createFileRoute('/print/requirements')({
  component: PrintRequirementsPage,
  validateSearch: (s: Record<string, unknown>) => ({
    repoPath: (s['repoPath'] as string) ?? '',
    username: (s['username'] as string) ?? 'local',
    filter: (s['filter'] as string) ?? '',
    objectTypeRef: (s['objectTypeRef'] as string) ?? '',
    componentLabel: (s['componentLabel'] as string) ?? '',
  }),
})

function PrintRequirementsPage() {
  const { repoPath, username, filter, objectTypeRef, componentLabel } = Route.useSearch()
  const [nodeId, typeId] = objectTypeRef.split('::')

  const { data: requirements, isSuccess: reqLoaded } = useQuery({
    queryKey: ['print-requirements', repoPath],
    queryFn: () => api.requirements.list(repoPath),
    enabled: !!repoPath,
  })
  const { data: tree, isSuccess: treeLoaded } = useQuery({
    queryKey: ['print-tree', repoPath, nodeId, typeId],
    queryFn: () => api.tree.get(repoPath, nodeId!, typeId!),
    enabled: !!repoPath && !!nodeId && !!typeId,
  })
  const { data: schema, isSuccess: schemaLoaded } = useQuery({
    queryKey: ['print-schema', repoPath],
    queryFn: () => api.schema.get(repoPath),
    enabled: !!repoPath,
  })
  const { data: prefs, isSuccess: prefsLoaded } = useQuery({
    queryKey: ['print-prefs', repoPath, username, objectTypeRef],
    queryFn: () => api.pref.getFieldVisibility(repoPath, username, objectTypeRef),
    enabled: !!repoPath && !!username && !!objectTypeRef,
  })

  useNotifyPrintReady(reqLoaded && treeLoaded && schemaLoaded && prefsLoaded)

  const typeDef = getReqTypeDef(schema, objectTypeRef)
  const fallbackFields = ['section', 'name', 'id', 'status', 'version', ...(typeDef?.fields.slice(0, 3).map(f => f.name) ?? [])]
  const fields = prefs?.word ?? fallbackFields

  const objects = (requirements ?? []).map(normalizeObject)
  const sectionNumbers = computeSectionNumbers(tree?.root ?? [])
  const { rows, columns } = buildExportRows(fields, tree?.root ?? [], objects, sectionNumbers, undefined, typeDef, filter)

  const idKey = columns.find(c => c.key === 'id')?.key
  const nameKey = columns.find(c => c.key === 'name')?.key
  const sectionKey = columns.find(c => c.key === 'section')?.key
  const statusKey = columns.find(c => c.key === 'status')?.key
  const versionKey = columns.find(c => c.key === 'version')?.key
  // section/statut/version : compacts dans le sous-titre (miroir du badge d'en-tête de
  // `WordView.ItemCard`) plutôt que répétés en paragraphe labellisé dans le corps.
  const headerKeys = new Set([idKey, nameKey, sectionKey, statusKey, versionKey].filter((k): k is string => !!k))
  const bodyColumns = columns.filter(c => !headerKeys.has(c.key))

  return (
    <div className="p-10 bg-white text-slate-900 text-sm min-h-screen">
      <h1 className="text-xl font-semibold mb-1">Cahier d'exigences — {componentLabel}</h1>
      <p className="text-slate-500 mb-8">{rows.length} exigence(s)</p>
      <div className="space-y-6">
        {rows.map((row, i) => {
          const meta = [
            sectionKey && row[sectionKey] && `§${row[sectionKey]}`,
            statusKey && row[statusKey],
            versionKey && row[versionKey] && `v${row[versionKey]}`,
          ].filter(Boolean).join(' · ')
          return (
          <section key={(idKey && row[idKey]) || i} className="break-inside-avoid border-b border-slate-200 pb-4">
            <h2 className="text-base font-medium">
              {[idKey && row[idKey], nameKey && row[nameKey]].filter(Boolean).join(' — ') || 'Exigence'}
            </h2>
            {meta && <p className="text-xs text-slate-500 italic mb-2">{meta}</p>}
            {bodyColumns.map(col => row[col.key]?.trim() && (
              <div key={col.key} className="mt-2">
                <p className="text-xs font-medium text-slate-600">{col.label}</p>
                <pre className="whitespace-pre-wrap font-sans text-sm">{row[col.key]}</pre>
              </div>
            ))}
          </section>
          )
        })}
      </div>
    </div>
  )
}
