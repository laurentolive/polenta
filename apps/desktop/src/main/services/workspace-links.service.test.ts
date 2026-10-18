import { describe, expect, it } from 'vitest'
import type { ObjectLink, ProjectSchema, Requirement, TestCase, WorkspaceTree } from '@polenta/types'
import { LinkWriteError, WorkspaceLinksService } from './workspace-links.service'
import type { RequirementsIndexService } from './requirements-index.service'
import type { TestsIndexService } from './tests-index.service'
import type { SchemaService } from './schema.service'
import type { GitService } from './git.service'
import type { WorkspaceTreeService } from './workspace-tree.service'

// GH105 — liens inter-repos : fixture de specs/GH105-tests.md (prod racine, comp modifiable,
// pinned épinglé sur un SHA = HEAD détaché).

const WS = '/ws'
const PROD = '/ws/prod'
const COMP = '/ws/comp'
const PIN = '/ws/pinned'

const req = (id: string, ref: string): Requirement =>
  ({ id, title: `Titre ${id}`, status: 'draft', objectTypeRef: ref }) as unknown as Requirement
const tc = (id: string, ref: string): TestCase =>
  ({ id, title: `Titre ${id}`, status: 'draft', objectTypeRef: ref }) as unknown as TestCase
const link = (id: string, type: string, sourceId: string, targetId: string): ObjectLink =>
  ({ id, type, sourceId, targetId, createdAt: '', createdBy: 'user' }) as ObjectLink

const schemaOf = (types: Array<[string, string]>, linkTypes: ProjectSchema['linkTypes'] = [], readonly = false): ProjectSchema =>
  ({
    nodes: [{ name: 'root', label: 'root', readonly, objectTypes: types.map(([name, category]) => ({ name, category, fields: [] })) }],
    linkTypes,
  }) as unknown as ProjectSchema

function makeService(opts: { links?: Record<string, ObjectLink[]>; prodLinkTypes?: ProjectSchema['linkTypes']; compLinkTypes?: ProjectSchema['linkTypes']; compReadonlyNode?: boolean } = {}) {
  const reqs: Record<string, Requirement[]> = {
    [PROD]: [req('P_REQ-0001', 'root::P_REQ')],
    [COMP]: [req('C_REQ-0001', 'root::C_REQ')],
    [PIN]: [req('K_REQ-0001', 'root::K_REQ')],
  }
  const tests: Record<string, TestCase[]> = { [PROD]: [tc('P_TEST-0001', 'root::P_TEST')], [COMP]: [], [PIN]: [] }
  const links: Record<string, ObjectLink[]> = { [PROD]: [], [COMP]: [], [PIN]: [], ...opts.links }
  const schemas: Record<string, ProjectSchema> = {
    [PROD]: schemaOf([['P_REQ', 'requirement'], ['P_TEST', 'test']], opts.prodLinkTypes ?? [
      { name: 'implements', labelSourceToTarget: 'est implémenté par', labelTargetToSource: 'implémente', sourceRefs: ['root::P_REQ'], targetRefs: ['root::C_REQ', 'root::K_REQ'] },
      { name: 'verifies', labelSourceToTarget: 'est vérifié', labelTargetToSource: 'vérifie', sourceRefs: ['root::P_REQ'], targetRefs: ['root::P_TEST'] },
      { name: 'refines', labelSourceToTarget: 'raffine', labelTargetToSource: 'est raffiné par', sourceRefs: ['root::C_REQ'], targetRefs: ['root::P_REQ'] },
      { name: 'feeds', labelSourceToTarget: 'alimente', labelTargetToSource: 'est alimenté par', sourceRefs: ['root::K_REQ'], targetRefs: ['root::P_REQ'] },
    ]),
    [COMP]: schemaOf([['C_REQ', 'requirement']], opts.compLinkTypes ?? [], opts.compReadonlyNode),
    [PIN]: schemaOf([['K_REQ', 'requirement']]),
  }
  const reqIndex = {
    findAll: async (p: string) => reqs[p] ?? [],
    findAllLinks: async (p: string) => links[p] ?? [],
    reloadLinks: async (p: string) => links[p] ?? [],
    invalidate: () => {},
    createLinks: async (p: string, data: Array<{ type: string; sourceId: string; targetId: string }>, by: string) => {
      const created = data.map((d, i) => link(`new-${links[p].length + i}`, d.type, d.sourceId, d.targetId))
      created.forEach((l) => (l.createdBy = by))
      links[p] = [...links[p], ...created]
      return created
    },
    deleteLinks: async (p: string, ids: string[]) => {
      const deleted = links[p].filter((l) => ids.includes(l.id)).map((l) => l.id)
      links[p] = links[p].filter((l) => !ids.includes(l.id))
      return deleted
    },
  } as unknown as RequirementsIndexService
  const testsIndex = { findAll: async (p: string) => tests[p] ?? [], invalidate: () => {} } as unknown as TestsIndexService
  const schema = { get: async (p: string) => schemas[p] } as unknown as SchemaService
  const git = { currentBranch: async (p: string) => (p === PIN ? 'HEAD' : 'main') } as unknown as GitService
  const tree = {
    nodes: [
      { name: 'prod', label: 'Produit', repoPath: PROD },
      { name: 'comp', label: 'Composant', repoPath: COMP },
      { name: 'pinned', repoPath: PIN },
    ],
  } as unknown as WorkspaceTree
  const workspaceTree = { readCache: async () => tree } as unknown as WorkspaceTreeService
  const svc = new WorkspaceLinksService(reqIndex, testsIndex, schema, git, workspaceTree)
  return { svc, links }
}

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p
    return 'OK'
  } catch (e) {
    return e instanceof LinkWriteError ? e.code : `UNEXPECTED ${String(e)}`
  }
}

describe('GH105 — WorkspaceLinksService : lecture', () => {
  it('agrège exigences et tests de tous les repos, avec le libellé du repo', async () => {
    const { svc } = makeService()
    const objs = await svc.listObjects(PROD, WS)
    expect(objs.map((o) => `${o.id}@${o.repoLabel}`).sort()).toEqual([
      'C_REQ-0001@Composant', 'K_REQ-0001@pinned', 'P_REQ-0001@Produit', 'P_TEST-0001@Produit',
    ])
  })

  it('liste les liens de chaque repo avec leur repo de stockage et le statut lecture seule', async () => {
    const { svc } = makeService({ links: { [PIN]: [link('l-pin', 'feeds', 'K_REQ-0001', 'P_REQ-0001')] } })
    const [l] = await svc.listLinks(PROD, WS)
    expect(l).toMatchObject({ id: 'l-pin', storedIn: PIN, readonly: true })
  })

  it("dédoublonne un lien présent dans deux links.yaml (racine d'abord) — L11", async () => {
    const dup = link('l1', 'implements', 'P_REQ-0001', 'C_REQ-0001')
    const { svc } = makeService({ links: { [PROD]: [dup], [COMP]: [dup] } })
    const all = await svc.listLinks(PROD, WS)
    expect(all.map((l) => `${l.id}@${l.storedIn}`)).toEqual([`l1@${PROD}`])
  })

  it('union des types de lien par nom, racine prioritaire — L8', async () => {
    const { svc } = makeService({
      compLinkTypes: [{ name: 'implements', labelSourceToTarget: 'x', labelTargetToSource: 'y', sourceRefs: ['root::C_REQ'], targetRefs: ['root::C_REQ'] }],
    })
    const { linkTypes, declaredBy } = await svc.linkTypes(PROD, WS)
    expect(linkTypes.find((t) => t.name === 'implements')).toMatchObject({ definingRepo: PROD, labelSourceToTarget: 'est implémenté par' })
    expect(declaredBy['root::C_REQ']).toEqual([COMP])
  })
})

describe('GH105 — WorkspaceLinksService : création côté source', () => {
  it('écrit le lien dans le repo de la source (produit), pas dans le composant — N2', async () => {
    const { svc, links } = makeService()
    const l = await svc.createLink(PROD, { type: 'implements', sourceId: 'P_REQ-0001', targetId: 'C_REQ-0001' }, WS)
    expect(l.storedIn).toBe(PROD)
    expect(links[PROD]).toHaveLength(1)
    expect(links[COMP]).toHaveLength(0)
  })

  it('sens fourni inversé : stocké côté sourceRefs, sens conservé — N3', async () => {
    const { svc, links } = makeService()
    await svc.createLink(PROD, { type: 'implements', sourceId: 'C_REQ-0001', targetId: 'P_REQ-0001' }, WS)
    expect(links[PROD].map((l) => `${l.sourceId}>${l.targetId}`)).toEqual(['C_REQ-0001>P_REQ-0001'])
    expect(links[COMP]).toHaveLength(0)
  })

  it('source dans un composant modifiable : écrit dans le composant — N7', async () => {
    const { svc, links } = makeService()
    const l = await svc.createLink(PROD, { type: 'refines', sourceId: 'C_REQ-0001', targetId: 'P_REQ-0001' }, WS)
    expect(l.storedIn).toBe(COMP)
    expect(links[COMP]).toHaveLength(1)
  })

  it('cible dans un composant épinglé : accepté, écrit dans le produit — L1', async () => {
    const { svc, links } = makeService()
    await svc.createLink(PROD, { type: 'implements', sourceId: 'P_REQ-0001', targetId: 'K_REQ-0001' }, WS)
    expect(links[PROD]).toHaveLength(1)
    expect(links[PIN]).toHaveLength(0)
  })

  it('source dans un composant épinglé : READONLY_REPO, rien écrit — L2', async () => {
    const { svc, links } = makeService()
    expect(await codeOf(svc.createLink(PROD, { type: 'feeds', sourceId: 'K_REQ-0001', targetId: 'P_REQ-0001' }, WS))).toBe('READONLY_REPO')
    expect(links[PIN]).toHaveLength(0)
  })

  it("source dans un nœud readonly d'un repo modifiable : READONLY_REPO", async () => {
    const { svc, links } = makeService({ compReadonlyNode: true })
    expect(await codeOf(svc.createLink(PROD, { type: 'refines', sourceId: 'C_REQ-0001', targetId: 'P_REQ-0001' }, WS))).toBe('READONLY_REPO')
    expect(links[COMP]).toHaveLength(0)
  })

  it('doublon (même type, sens inverse) dans le workspace : DUPLICATE_LINK — L5', async () => {
    const { svc } = makeService({ links: { [PROD]: [link('l1', 'implements', 'P_REQ-0001', 'C_REQ-0001')] } })
    expect(await codeOf(svc.createLink(PROD, { type: 'implements', sourceId: 'C_REQ-0001', targetId: 'P_REQ-0001' }, WS))).toBe('DUPLICATE_LINK')
  })

  it('refs respectées : implements ne cible pas un test — critère 9', async () => {
    const { svc } = makeService()
    expect(await codeOf(svc.createLink(PROD, { type: 'implements', sourceId: 'P_REQ-0001', targetId: 'P_TEST-0001' }, WS))).toBe('LINK_TYPE_INCOMPATIBLE')
  })

  it('objet absent du workspace : OBJECT_NOT_FOUND', async () => {
    const { svc } = makeService()
    expect(await codeOf(svc.createLink(PROD, { type: 'implements', sourceId: 'P_REQ-0001', targetId: 'X-0001' }, WS))).toBe('OBJECT_NOT_FOUND')
  })

  it('lot MCP : erreurs par entrée, entrées valides écrites dans leur repo — L13', async () => {
    const { svc, links } = makeService()
    const { created, errors } = await svc.createLinks(PROD, [
      { type: 'refines', sourceId: 'C_REQ-0001', targetId: 'P_REQ-0001' },
      { type: 'feeds', sourceId: 'K_REQ-0001', targetId: 'P_REQ-0001' },
    ], 'mcp', WS)
    expect(created.map((c) => `${c.index}@${c.link.storedIn}`)).toEqual([`0@${COMP}`])
    expect(errors.map((e) => `${e.index}:${e.code}`)).toEqual(['1:READONLY_REPO'])
    expect(links[COMP][0].createdBy).toBe('mcp')
  })

  it('sans workspaceDir : seul le repo racine (mono-repo) — L9', async () => {
    const { svc } = makeService()
    expect((await svc.listObjects(PROD)).map((o) => o.id)).toEqual(['P_REQ-0001', 'P_TEST-0001'])
    expect(await codeOf(svc.createLink(PROD, { type: 'implements', sourceId: 'P_REQ-0001', targetId: 'C_REQ-0001' }))).toBe('OBJECT_NOT_FOUND')
    const l = await svc.createLink(PROD, { type: 'verifies', sourceId: 'P_REQ-0001', targetId: 'P_TEST-0001' })
    expect(l.storedIn).toBe(PROD)
  })
})

describe('GH105 — WorkspaceLinksService : suppression', () => {
  it('supprime dans le repo qui stocke le lien — N6', async () => {
    const { svc, links } = makeService({ links: { [PROD]: [link('l1', 'implements', 'P_REQ-0001', 'C_REQ-0001')] } })
    await svc.deleteLink(PROD, 'l1', WS)
    expect(links[PROD]).toHaveLength(0)
  })

  it('lien stocké dans un repo épinglé : READONLY_REPO — L3', async () => {
    const { svc, links } = makeService({ links: { [PIN]: [link('l-pin', 'feeds', 'K_REQ-0001', 'P_REQ-0001')] } })
    expect(await codeOf(svc.deleteLink(PROD, 'l-pin', WS))).toBe('READONLY_REPO')
    expect(links[PIN]).toHaveLength(1)
  })

  it('id inconnu : LINK_NOT_FOUND', async () => {
    const { svc } = makeService()
    expect(await codeOf(svc.deleteLink(PROD, 'nope', WS))).toBe('LINK_NOT_FOUND')
  })
})
