import { useNavigate } from '@tanstack/react-router'
import type { RequirementReflections } from '@polenta/types'

/** GH210 — colonnes système facultatives des reflets (exigences seulement), comme `coverageStatus`. */
export const REFLECTION_COLUMNS = ['designStatus', 'validationStatus'] as const
export type ReflectionColumn = typeof REFLECTION_COLUMNS[number]

export function isReflectionColumn(col: string): col is ReflectionColumn {
  return (REFLECTION_COLUMNS as readonly string[]).includes(col)
}

/** Reflets d'un type d'exigence : repo propriétaire (lien vers une version) et reflets par ID. */
export interface ReflectionsData {
  repoPath: string
  projectId: string
  byId: Map<string, RequirementReflections>
}

/** Texte affiché, trié, filtré et exporté : « 1.2.4 », « Conforme (1.2.4) » ; vide sans reflet. */
export function reflectionText(col: ReflectionColumn, r: RequirementReflections | undefined): string {
  if (col === 'designStatus') return r?.design?.versionLabel ?? ''
  const v = r?.validation
  return v ? `${v.decisionLabel} (${v.versionLabel})` : ''
}

/**
 * GH210 — cellule d'un reflet : texte, label de version cliquable vers sa page. Sans reflet : « — ».
 */
export function ReflectionValue({ col, objectId, data }: {
  col: ReflectionColumn
  objectId: string | undefined
  data: ReflectionsData | undefined
}) {
  const reflections = objectId ? data?.byId.get(objectId) : undefined
  const navigate = useNavigate()
  const target = col === 'designStatus' ? reflections?.design : reflections?.validation
  if (!target) return <span className="text-ink-3" data-testid={`reflection-${col}`}>—</span>
  const prefix = col === 'validationStatus' && reflections?.validation ? `${reflections.validation.decisionLabel} (` : ''
  const suffix = prefix ? ')' : ''
  const label = target.versionLabel
  return (
    <span data-testid={`reflection-${col}`}>
      {prefix}
      {data
        ? (
          <button
            type="button"
            className="text-status-info hover:underline"
            onClick={e => {
              e.stopPropagation()
              void navigate({ to: '/version/$versionId', params: { versionId: target.versionId }, search: { projectId: data.projectId, repoPath: data.repoPath } } as never)
            }}
          >
            {label}
          </button>
        )
        : label}
      {suffix}
    </span>
  )
}
