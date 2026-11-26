import { describe, expect, it } from 'vitest'
import type { ObjectLink, Requirement } from '@polenta/types'
import { ParametersService } from './parameters.service'
import { ReqRefsService } from './req-refs.service'

// GH442 — exigences couvertes par un test : mêmes liens que la matrice et les instances T179
// (`matchCoverageLink`, deux sens), exigences terminales exclues, tri naturel, tous les repos du workspace.

const MAIN = '/ws/produit'
const COMP = '/ws/comp-moteur'

const req = (id: string, status = 'draft'): Requirement =>
  ({ id, title: `Titre ${id}`, objectTypeRef: 'root::exigence', status, fields: {} }) as unknown as Requirement
const link = (n: number, sourceId: string, targetId: string): ObjectLink =>
  ({ id: `L${n}`, type: 'verification', sourceId, targetId, createdAt: '', createdBy: '' })

interface RepoData { requirements: Requirement[]; links: ObjectLink[] }

/** `ParametersService` avec de vrais `ReqRefsService` / `matchCoverageLink` sur des index simulés. */
function setup(repos: Record<string, RepoData>, workspace = false) {
  const reqIndex = {
    findAll: async (repo: string) => repos[repo]?.requirements ?? [],
    findAllLinks: async (repo: string) => repos[repo]?.links ?? [],
  }
  // Schéma illisible : statut terminal = repli sur « obsolete » (convention T171).
  const schema = { get: async () => null }
  const reqRefs = new ReqRefsService({} as never, reqIndex as never, schema as never)
  const workspaceTree = workspace
    ? { readCache: async () => ({ logicalTree: { repoPath: MAIN }, nodes: [{ name: 'moteur', repoPath: COMP }] }) }
    : undefined
  const revalidation = { readonlyRepoPaths: async () => new Set<string>() }
  const params = new ParametersService(
    {} as never, reqIndex as never, {} as never, schema as never, {} as never, revalidation as never,
    workspaceTree as never, reqRefs,
  )
  return params
}

describe('ParametersService.coveredRequirementIds (GH442)', () => {
  const repos = {
    [MAIN]: {
      requirements: [req('SYS-0001'), req('SYS-0002'), req('SYS-0003'), req('SYS-0004', 'obsolete'), req('SYS-0010')],
      links: [
        link(1, 'TEST-A', 'SYS-0001'),       // sens test → exigence
        link(2, 'SYS-0002', 'TEST-A'),       // sens exigence → test : même résultat
        link(3, 'TEST-C', 'SYS-0001'),
        link(4, 'TEST-C', 'SYS-0003'),
        link(5, 'TEST-D', 'SYS-0004'),       // exigence terminale
        link(6, 'TEST-E', 'SYS-0010'),
        link(7, 'TEST-E', 'SYS-0002'),
        link(8, 'TEST-E', 'SYS-0002'),       // doublon
        link(9, 'TEST-A', 'TEST-X'),         // lien orphelin : ni exigence connue ni test demandé
      ],
    },
  }

  it('liste les exigences liées dans les deux sens, tri naturel des IDs, sans doublon', async () => {
    const covered = await setup(repos).coveredRequirementIds(MAIN, ['TEST-A', 'TEST-C', 'TEST-E'])
    expect(covered.get('TEST-A')).toEqual(['SYS-0001', 'SYS-0002'])
    expect(covered.get('TEST-C')).toEqual(['SYS-0001', 'SYS-0003'])
    // SYS-0002 avant SYS-0010 : tri numérique, pas alphabétique.
    expect(covered.get('TEST-E')).toEqual(['SYS-0002', 'SYS-0010'])
  })

  it('un test sans lien, ou lié seulement à une exigence terminale : vide (jamais absent)', async () => {
    const covered = await setup(repos).coveredRequirementIds(MAIN, ['TEST-B', 'TEST-D'])
    expect(covered.get('TEST-B')).toEqual([])
    expect(covered.get('TEST-D')).toEqual([])
  })

  it('suit l\'état courant : un lien ajouté après coup est vu à l\'appel suivant', async () => {
    const live: Record<string, RepoData> = { [MAIN]: { requirements: [req('SYS-0001'), req('SYS-0005')], links: [link(1, 'TEST-B', 'SYS-0001')] } }
    const params = setup(live)
    expect((await params.coveredRequirementIds(MAIN, ['TEST-B'])).get('TEST-B')).toEqual(['SYS-0001'])
    live[MAIN]!.links.push(link(2, 'SYS-0005', 'TEST-B'))
    expect((await params.coveredRequirementIds(MAIN, ['TEST-B'])).get('TEST-B')).toEqual(['SYS-0001', 'SYS-0005'])
  })

  it('workspace : une exigence d\'un composant en repo séparé est listée', async () => {
    const withComp = {
      [MAIN]: { requirements: [req('SYS-0001')], links: [link(1, 'TEST-A', 'SYS-0001'), link(2, 'TEST-A', 'MOT-0001')] },
      [COMP]: { requirements: [req('MOT-0001')], links: [] },
    }
    const noWorkspace = await setup(withComp).coveredRequirementIds(MAIN, ['TEST-A'])
    expect(noWorkspace.get('TEST-A')).toEqual(['SYS-0001'])
    const workspace = await setup(withComp, true).coveredRequirementIds(MAIN, ['TEST-A'], { workspaceDir: '/ws' })
    expect(workspace.get('TEST-A')).toEqual(['MOT-0001', 'SYS-0001'])
  })

  it('sans test à résoudre : aucune lecture, map vide', async () => {
    expect((await setup(repos).coveredRequirementIds(MAIN, [])).size).toBe(0)
  })
})
