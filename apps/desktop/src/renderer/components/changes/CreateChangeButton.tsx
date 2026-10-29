import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { GitPullRequestArrow } from 'lucide-react'
import { flattenSystemNodes, type ProjectSchema } from '@polenta/types'
import { useProjectSchema, getAllObjectTypes } from '../../hooks/useProjectSchema'

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
 * GH198 — « Créer un change » depuis une exigence ou un test (specs/GH198.md §5, Q4) : formulaire
 * de création avec l'élément dans « à modifier » et le composant de l'élément. Masqué tant que le
 * repo ne déclare aucun type de change.
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
  if (!projectId || getAllObjectTypes(schema, 'change').length === 0) return null
  const component = elementComponent(schema, objectTypeRef)
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"
      onClick={() => navigate({ to: '/change/new', search: { projectId, repoPath, element: elementId, component } })}
      data-testid="create-change"
    >
      <GitPullRequestArrow size={13} />
      {t('changes.createFromElement')}
    </button>
  )
}
