import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TestRepo } from '../git/test-repo.test-util'
import { GitService } from './git.service'
import { createMcpContainer, type McpContainer } from '../../mcp-server/container'
import { registerVersionTools } from '../../mcp-server/tools/versions.tools'

// GH441 — `get_version` renvoie `verification` ; séquence réelle release → modification → relecture
// (specs/GH441-tests.md, M1 à M5). Dépôt git temporaire et conteneur MCP réel : c'est le câblage qui est vérifié.

const SCHEMA = {
  version: 1,
  linkTypes: [{ name: 'verification', labelSourceToTarget: 'vérifie', labelTargetToSource: 'est vérifiée par', sourceRefs: ['test'], targetRefs: ['requirement'] }],
  nodes: [{
    name: 'root', label: 'Produit', objectTypes: [
      { name: 'exigence', label: 'Exigence', prefix: 'REQ', category: 'requirement', fields: [], statuses: [{ name: 'draft' }, { name: 'approved', isApproval: true }] },
      { name: 'essai', label: 'Essai', prefix: 'TST', category: 'test', fields: [], statuses: [{ name: 'draft' }, { name: 'approved', isApproval: true }] },
      {
        name: 'version', label: 'Version', prefix: 'PV', category: 'version', fields: [],
        statuses: [{ name: 'en_cours' }, { name: 'released', isApproval: true }, { name: 'abandonnee', isTerminal: true }],
      },
    ],
  }],
}

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>

let dir: string
let gitSvc: GitService
let mcp: McpContainer
let tools: Record<string, Handler>
let tick = 0
const T0 = Date.UTC(2026, 10, 1) / 1000

async function commitAll(message: string) {
  await new TestRepo(dir).commitAll(message, { name: 'Alice', email: 'a@x', timestamp: T0 + ++tick })
}
const call = async <T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> => JSON.parse((await tools[name](args)).content[0].text) as T // eslint-disable-line @typescript-eslint/no-explicit-any
const newReq = async (title = 'R') => (await mcp.requirements.create(dir, { objectTypeRef: 'root::exigence', title, fields: {} } as never)).id
const newTest = async () => (await mcp.tests.create(dir, { objectTypeRef: 'root::essai', title: 'T', steps: [], fields: {} } as never)).id
const versionFile = (id: string) => gitSvc.readYaml<{ verification?: unknown }>(dir, `versions/${id}.yaml`)

/** Version released qui inclut `ids` (même séquence que GH271). */
async function released(title: string, ids: string[]) {
  await commitAll('éléments')
  const v = await mcp.versions.create(dir, { title } as never)
  await mcp.versions.include(dir, v.id, ids)
  await commitAll('version')
  return mcp.versions.release(dir, v.id, `produit-${title}`)
}

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh441-'))
  gitSvc = new GitService()
  const repo = await TestRepo.init(dir, 'main')
  await repo.setConfig('user.name', 'Alice')
  await repo.setConfig('user.email', 'a@x')
  await gitSvc.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  await commitAll('schéma')
  mcp = createMcpContainer(dir, undefined, 'alice')
  tools = {}
  const server = { registerTool: (name: string, _def: unknown, handler: Handler) => { tools[name] = handler } } as never
  registerVersionTools(server, mcp)
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('GH441 — get_version et couverture figée', () => {
  it('M1 — version released : verification identique au fichier de version', async () => {
    const reqId = await newReq()
    const testId = await newTest()
    await mcp.requirements.createLink(dir, { type: 'verification', sourceId: testId, targetId: reqId })
    const v = await released('1.0', [reqId])

    const page = await call<{ verification: unknown }>('get_version', { id: v.id })
    const file = await versionFile(v.id)
    expect(file?.verification).toEqual({ computedAt: expect.any(String), rows: [{ id: reqId, status: 'covered', tests: [testId] }] })
    expect(page.verification).toEqual(file!.verification)
  })

  it('M2 — version en cours : verification null', async () => {
    const v = await mcp.versions.create(dir, { title: '2.0' } as never)
    const page = await call<{ state: string; verification: unknown }>('get_version', { id: v.id })
    expect(page.state).toBe('in_progress')
    expect(page.verification).toBeNull()
  })

  it('M3 — clés de get_version inchangées ; verification absente de version (page GH439)', async () => {
    const reqId = await newReq()
    const v = await released('1.0', [reqId])
    const page = await call<Record<string, unknown> & { version: Record<string, unknown> }>('get_version', { id: v.id })
    expect(Object.keys(page).sort()).toEqual(['basedOn', 'changes', 'component', 'components', 'state', 'verification', 'version'])
    expect(page.version).not.toHaveProperty('verification')
  })

  it('M4 — séquence : lien retiré après release ; graphe et get_version gardent la couverture figée', async () => {
    const reqId = await newReq()
    const testId = await newTest()
    const link = await mcp.requirements.createLink(dir, { type: 'verification', sourceId: testId, targetId: reqId })
    const v = await released('1.0', [reqId])
    const frozen = (await versionFile(v.id))!.verification

    await mcp.requirements.deleteLink(dir, link.id)

    const { graph } = await mcp.graph.build(dir)
    // La couverture courante a changé (aucun lien) ; la version figée non.
    expect(graph.requirements.find(r => r.id === reqId)?.coverageStatus).toBe('not_covered')
    expect(graph.versions.find(x => x.id === v.id)?.verification).toEqual(frozen)
    const page = await call<{ verification: unknown }>('get_version', { id: v.id })
    expect(page.verification).toEqual(frozen)
  })

  it('M5 — relecture par une instance neuve du conteneur (aucun cache) : même valeur figée', async () => {
    const reqId = await newReq()
    const testId = await newTest()
    const link = await mcp.requirements.createLink(dir, { type: 'verification', sourceId: testId, targetId: reqId })
    const v = await released('1.0', [reqId])
    const frozen = (await versionFile(v.id))!.verification

    await mcp.requirements.deleteLink(dir, link.id)

    const fresh = createMcpContainer(dir, undefined, 'alice')
    const { graph } = await fresh.graph.build(dir)
    expect(graph.requirements.find(r => r.id === reqId)?.coverageStatus).toBe('not_covered')
    expect(graph.versions.find(x => x.id === v.id)?.verification).toEqual(frozen)
  })
})
