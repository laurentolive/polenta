import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ObjectLink, WorkspaceLink, WorkspaceLinkType, WorkspaceObject } from '@polenta/types'
import { api } from '../api'
import i18n from '../i18n'
import { decodeProjectId } from '../lib/projectId'
import { normRepoPath, type CandidateRefScope } from '../components/system/linkUtils'
import type { Candidate } from '../components/system/LinkCombobox'

/**
 * GH105 — liens inter-repos côté renderer (specs/GH105-design.md D8) : objets, liens et types de
 * lien agrégés sur tous les repos du workspace (`api.links.*`), création côté source et
 * suppression dans le repo de stockage (`linkCreate` / `linkDelete` avec `workspaceDir`).
 *
 * Les clés de requête portent l'empreinte de la liste des repos du workspace
 * (`['workspace-open', workspaceDir]`, mise à jour par l'onglet Structure) : un composant ajouté
 * est pris en compte sans redémarrage. `useLiveFileSync` invalide ces clés sur tout changement
 * d'objet, de lien ou de schéma, dans n'importe quel repo.
 *
 * Les objets sont indexés par id seul : les préfixes étant uniques dans le projet (règle 10), un
 * id ne désigne qu'un objet du workspace (le main garde le premier et le signale sinon).
 */

export const WORKSPACE_LINK_QUERY_KEYS = ['links-objects', 'links-list', 'links-types'] as const

export interface WorkspaceLinks {
  /** Repo racine du projet (premier argument des channels `links:*`). */
  rootRepoPath: string
  /** Absent en mono-repo : les écritures gardent alors le comportement antérieur. */
  workspaceDir?: string
  linkTypes: WorkspaceLinkType[]
  /** Types de lien du workspace reçus (sinon l'appelant garde ceux du schéma courant). */
  typesLoaded: boolean
  declaredBy: Record<string, string[]>
  objects: WorkspaceObject[]
  /** Objets du workspace reçus : avant, un pair absent n'est pas encore « introuvable ». */
  objectsLoaded: boolean
  objectsById: Map<string, WorkspaceObject>
  links: WorkspaceLink[]
  linksById: Map<string, WorkspaceLink>
  linksByObjectId: Map<string, WorkspaceLink[]>
  linksPending: boolean
  /** Libellé d'un repo du workspace (repo de stockage d'un lien). */
  repoLabelOf: (repoPath: string) => string | undefined
  /** Candidats de l'éditeur de liens (exigences et tests du workspace). */
  candidates: Candidate[]
  /** Portée de résolution des refs d'un type de lien (D2). */
  scopeOf: (lt: { name: string }) => CandidateRefScope | undefined
  /** Écritures : invalident liens, objets et couverture une fois terminées. */
  createLink: (type: string, sourceId: string, targetId: string) => Promise<void>
  deleteLink: (linkId: string) => Promise<void>
  /** Invalide liens, objets et couverture. */
  invalidate: () => void
}

/** Liens d'un objet indexés par id d'objet (source et cible). */
export function indexLinksByObject<L extends ObjectLink>(links: L[]): Map<string, L[]> {
  const map = new Map<string, L[]>()
  for (const link of links) {
    for (const id of [link.sourceId, link.targetId]) {
      const group = map.get(id)
      if (group) group.push(link)
      else map.set(id, [link])
    }
  }
  return map
}

export function useWorkspaceLinks(currentProjectId: string | undefined): WorkspaceLinks {
  const qc = useQueryClient()
  const { data: project } = useQuery({
    queryKey: ['workspace', currentProjectId],
    queryFn: () => api.workspace.resolve(decodeProjectId(currentProjectId!)),
    enabled: !!currentProjectId,
  })
  const rootRepoPath = project?.localPath ?? ''
  const workspaceDir = project?.workspaceDir || undefined

  // Même clé que useWorkspaceStructure : partage le cache (pas de second appel).
  const { data: openResult } = useQuery({
    queryKey: ['workspace-open', workspaceDir ?? ''],
    queryFn: () => api.workspace.open(workspaceDir!),
    enabled: !!workspaceDir,
  })
  const repoNodes = useMemo(() => (openResult?.status === 'ok' ? openResult.tree.nodes : []), [openResult])
  const reposKey = repoNodes.map(n => n.repoPath).join('|')
  // En mode workspace, attendre l'arbre : sinon chaque requête tournerait deux fois (clé sans puis
  // avec l'empreinte des repos).
  const enabled = !!rootRepoPath && (!workspaceDir || !!openResult)

  const { data: objectsData } = useQuery({
    queryKey: ['links-objects', rootRepoPath, workspaceDir, reposKey],
    queryFn: () => api.links.objects(rootRepoPath, workspaceDir),
    enabled,
  })
  const { data: linksData, isPending: linksPending } = useQuery({
    queryKey: ['links-list', rootRepoPath, workspaceDir, reposKey],
    queryFn: () => api.links.list(rootRepoPath, workspaceDir),
    enabled,
  })
  const { data: types } = useQuery({
    queryKey: ['links-types', rootRepoPath, workspaceDir, reposKey],
    queryFn: () => api.links.types(rootRepoPath, workspaceDir),
    enabled,
  })
  const objects = useMemo(() => objectsData ?? [], [objectsData])
  const links = useMemo(() => linksData ?? [], [linksData])
  const linkTypes = useMemo(() => types?.linkTypes ?? [], [types])
  const declaredBy = useMemo(() => types?.declaredBy ?? {}, [types])

  const objectsById = useMemo(() => new Map(objects.map(o => [o.id, o])), [objects])
  const linksById = useMemo(() => new Map(links.map(l => [l.id, l])), [links])
  const linksByObjectId = useMemo(() => indexLinksByObject(links), [links])
  const repoLabels = useMemo(() => {
    const map = new Map<string, string>()
    for (const n of repoNodes) map.set(normRepoPath(n.repoPath), n.label || n.name)
    for (const o of objects) if (!map.has(normRepoPath(o.repoPath))) map.set(normRepoPath(o.repoPath), o.repoLabel)
    return map
  }, [repoNodes, objects])
  const repoLabelOf = useCallback((repoPath: string) => repoLabels.get(normRepoPath(repoPath)), [repoLabels])
  const candidates = useMemo((): Candidate[] => objects.map(o => ({
    id: o.id, title: o.title, objectTypeRef: o.objectTypeRef, category: o.category,
    repoPath: o.repoPath, repoLabel: o.repoLabel, readonly: o.readonly,
  })), [objects])

  const scopeOf = useCallback((lt: { name: string }): CandidateRefScope | undefined => {
    if (!workspaceDir) return undefined
    const def = linkTypes.find(t => t.name === lt.name)
    return def ? { definingRepo: def.definingRepo, declaredBy } : undefined
  }, [workspaceDir, linkTypes, declaredBy])

  const invalidate = useCallback(() => {
    for (const key of WORKSPACE_LINK_QUERY_KEYS) qc.invalidateQueries({ queryKey: [key] })
    qc.invalidateQueries({ queryKey: ['links-all'] })
    qc.invalidateQueries({ queryKey: ['traceability-matrix'] })
  }, [qc])

  const notReady = (): never => { throw new Error(i18n.t('system.linkCombobox.notReady')) }

  const createLink = useCallback(async (type: string, sourceId: string, targetId: string) => {
    if (!rootRepoPath) notReady()
    try {
      await api.requirements.linkCreate(rootRepoPath, { type, sourceId, targetId }, workspaceDir)
    } finally {
      invalidate()
    }
  }, [rootRepoPath, workspaceDir, invalidate]) // eslint-disable-line react-hooks/exhaustive-deps

  const deleteLink = useCallback(async (linkId: string) => {
    if (!rootRepoPath) notReady()
    try {
      // Mono-repo : le lien est dans le repo racine (chemin historique).
      await api.requirements.linkDelete(rootRepoPath, linkId, workspaceDir)
    } finally {
      invalidate()
    }
  }, [rootRepoPath, workspaceDir, invalidate]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    rootRepoPath, workspaceDir, linkTypes, typesLoaded: !!types, declaredBy,
    objects, objectsLoaded: !!objectsData, objectsById, links, linksById, linksByObjectId, linksPending,
    repoLabelOf, candidates, scopeOf, createLink, deleteLink, invalidate,
  }
}

/** Repo d'un objet, comparé sans tenir compte de l'écriture du chemin. */
export function isSameRepo(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && normRepoPath(a) === normRepoPath(b)
}

const WorkspaceLinksContext = createContext<WorkspaceLinks | null>(null)

export function WorkspaceLinksProvider({ value, children }: { value: WorkspaceLinks; children: ReactNode }) {
  return <WorkspaceLinksContext.Provider value={value}>{children}</WorkspaceLinksContext.Provider>
}

/** Liens du workspace fournis par la vue englobante (SystemView, SearchEditPane). */
export function useWorkspaceLinksContext(): WorkspaceLinks | null {
  return useContext(WorkspaceLinksContext)
}
