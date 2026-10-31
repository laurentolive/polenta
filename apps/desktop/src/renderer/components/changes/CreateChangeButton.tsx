import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { GitPullRequestArrow } from 'lucide-react'
import { flattenSystemNodes, type ProjectSchema } from '@polenta/types'
import { api } from '../../api'
import { useProjectSchema, getAllObjectTypes, getChangeTypeDef } from '../../hooks/useProjectSchema'

/** Composant local qui porte le type de l'élément : nœud nommé par la ref, sinon celui qui déclare
 *  le type (alias `root::`) ; absent si introuvable (choix laissé au formulaire). */
export function elementComponent(schema: ProjectSchema | undefined, objectTypeRef: string | undefined): string | undefined {
  if (!objectTypeRef) return undefined
  const [nodeName, typeName] = objectTypeRef.includes('::') ? objectTypeRef.split('::') : [undefined, objectTypeRef]
  const local = flattenSystemNodes(schema?.nodes ?? []).map(({ node }) => node).filter(n => n.objectTypes !== undefined)
  if (nodeName && local.some(n => n.name === nodeName)) return nodeName
  return local.find(n => n.objectTypes?.some(ot => ot.name === typeName))?.name
}

/**
 * « Analyser l'impact » d'une exigence ou d'un test (GH199 §5, ex-« Créer un change » GH198) : si
 * des changes non terminaux du repo listent l'élément, menu « Ouvrir … / Créer un change » ; sinon
 * formulaire de création avec l'élément dans « à modifier » et le composant de l'élément. Masqué
 * tant que le repo ne déclare aucun type de change.
 */
export function CreateChangeButton({ repoPath, projectId, elementId, objectTypeRef }: {
  repoPath: string
  projectId: string
  elementId: string
  objectTypeRef?: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: schema } = useProjectSchema(repoPath)
  const hasType = getAllObjectTypes(schema, 'changeset').length > 0
  const { data: changes = [] } = useQuery({
    queryKey: ['changesets', 'repo', repoPath],
    queryFn: () => api.changesets.list(repoPath),
    enabled: !!repoPath && hasType,
  })
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (!projectId || !hasType) return null
  const listing = changes.filter(c => c.elementIds.includes(elementId)
    && !getChangeTypeDef(schema, c.objectTypeRef)?.statuses?.find(s => s.name === c.status)?.isTerminal)
  const create = () => navigate({ to: '/changeset/new', search: { projectId, repoPath, element: elementId, component: elementComponent(schema, objectTypeRef) } })

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"
        onClick={() => (listing.length === 0 ? create() : setOpen(o => !o))}
        data-testid="create-change"
      >
        <GitPullRequestArrow size={13} />
        {t('changes.analyzeImpact')}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-surface border border-edge rounded shadow-lg py-1 w-72" data-testid="create-change-menu">
          {listing.map(c => (
            <button
              key={c.id}
              type="button"
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-hover flex gap-2"
              onClick={() => { setOpen(false); navigate({ to: '/changeset/$changeId', params: { changeId: c.id }, search: { projectId, repoPath: c.repoPath } }) }}
            >
              <span className="text-ink-3 shrink-0">{t('changes.openChange')}</span>
              <span className="font-mono shrink-0">{c.id}</span>
              <span className="truncate text-ink">{c.title}</span>
            </button>
          ))}
          <div className="border-t border-edge my-1" />
          <button type="button" className="w-full text-left px-3 py-1.5 text-xs hover:bg-hover text-prim" onClick={() => { setOpen(false); create() }}>
            {t('changes.createFromElement')}
          </button>
        </div>
      )}
    </div>
  )
}
