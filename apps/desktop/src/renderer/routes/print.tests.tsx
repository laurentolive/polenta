import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { TestCase } from '@polenta/types'
import { api } from '../api'
import { useNotifyPrintReady } from '../lib/useNotifyPrintReady'
import { normalizeObject } from '../lib/normalizeObject'
import { buildExportRows } from '../lib/exportColumns'
import { computeSectionNumbers } from '../hooks/useTreeState'
import { getTestTypeDef } from '../hooks/useProjectSchema'

/**
 * Miroir de `print.requirements.tsx` pour le cahier de test — même architecture partagée
 * (`buildExportRows`/`normalizeObject`), voir ce fichier pour le contexte du correctif.
 * `stepsByObjectId` est reconstruit ici exactement comme dans `SystemView.tsx` (tri par `order`,
 * projection `{action, expectedResult}`) à partir de `api.tests.list`, qui renvoie déjà les steps.
 */
export const Route = createFileRoute('/print/tests')({
  component: PrintTestsPage,
  validateSearch: (s: Record<string, unknown>) => ({
    repoPath: (s['repoPath'] as string) ?? '',
    username: (s['username'] as string) ?? 'local',
    filter: (s['filter'] as string) ?? '',
    objectTypeRef: (s['objectTypeRef'] as string) ?? '',
    componentLabel: (s['componentLabel'] as string) ?? '',
  }),
})

function PrintTestsPage() {
  const { repoPath, username, filter, objectTypeRef, componentLabel } = Route.useSearch()
  const [nodeId, typeId] = objectTypeRef.split('::')

  const { data: tests, isSuccess: testsLoaded } = useQuery({
    queryKey: ['print-tests', repoPath],
    queryFn: () => api.tests.list(repoPath),
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

  useNotifyPrintReady(testsLoaded && treeLoaded && schemaLoaded && prefsLoaded)

  const typeDef = getTestTypeDef(schema, objectTypeRef)
  // Même ordre que le fallback de `SystemView.tsx` (section/name/id/status/steps puis champs
  // personnalisés) — sinon un projet sans préférences enregistrées affiche un ordre de colonnes
  // différent entre l'écran et le pdf.
  const fallbackFields = ['section', 'name', 'id', 'status', 'steps', ...(typeDef?.fields.slice(0, 3).map(f => f.name) ?? [])]
  const fields = prefs?.word ?? fallbackFields

  const objects = (tests ?? []).map(normalizeObject)
  const stepsByObjectId = new Map<string, { action: string; expectedResult: string }[]>()
  for (const t of (tests ?? []) as TestCase[]) {
    if (t.id) {
      stepsByObjectId.set(t.id, (t.steps ?? []).slice().sort((a, b) => a.order - b.order).map(s => ({ action: s.action, expectedResult: s.expectedResult })))
    }
  }
  const sectionNumbers = computeSectionNumbers(tree?.root ?? [])
  const { rows, columns } = buildExportRows(fields, tree?.root ?? [], objects, sectionNumbers, stepsByObjectId, typeDef, filter)

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
      <h1 className="text-xl font-semibold mb-1">Cahier de test — {componentLabel}</h1>
      <p className="text-slate-500 mb-8">{rows.length} test(s)</p>
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
              {[idKey && row[idKey], nameKey && row[nameKey]].filter(Boolean).join(' — ') || 'Test'}
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
