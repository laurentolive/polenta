import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { TestCase } from '@polenta/types'
import { CampaignsService } from './campaigns.service'
import { GitService } from './git.service'
import type { SchemaService } from './schema.service'
import type { TestsService } from './tests.service'

// GH298 — un ID de test inconnu du repo de la campagne est refusé (plus d'entrée sans copie).

let base: string
let product: string
let component: string
let service: CampaignsService

const testCase = (id: string) => ({
  id, title: id, projectId: '', branchId: '', objectTypeRef: 'root::test', status: 'approved', version: 1,
  preconditions: '', postconditions: '', equipment: [], fields: {}, steps: [],
}) as unknown as TestCase

beforeEach(async () => {
  base = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh298-'))
  product = path.join(base, 'produit')
  component = path.join(base, 'moteur')
  await fsP.mkdir(path.join(component, 'tests'), { recursive: true })
  await fsP.mkdir(product, { recursive: true })
  // Test du composant, présent dans son repo et pas dans celui du produit.
  await fsP.writeFile(path.join(component, 'tests', 'TMOT-0003.yaml'), 'id: TMOT-0003\n', 'utf-8')

  const own = new Map([['PT-0001', testCase('PT-0001')]])
  const testsService = {
    // Comme TestsIndex.findById : seuls les tests du repo demandé sont trouvés.
    findOne: async (repo: string, id: string) => {
      const tc = repo === product ? own.get(id) : undefined
      if (!tc) throw new Error(`Test case ${id} not found`)
      return structuredClone(tc)
    },
  } as unknown as TestsService
  const schema = {
    resolveComponentRepoPath: async (_r: string, ref: string) => ref.startsWith('moteur::') ? component : null,
    get: async () => ({ version: 1, nodes: [{ name: 'root', label: 'Produit' }, { name: 'moteur', label: 'Moteur', url: 'x' }], linkTypes: [] }),
  } as unknown as SchemaService
  service = new CampaignsService(new GitService(), testsService, undefined, schema)
})

afterEach(async () => {
  await fsP.rm(base, { recursive: true, force: true })
})

describe('GH298 — ID de test inconnu du repo de la campagne', () => {
  it('création : test d\'un composant → TEST_OTHER_REPO, aucune campagne écrite', async () => {
    await expect(service.create(product, { title: 'C', testCaseIds: ['PT-0001', 'TMOT-0003'] })).rejects.toThrow(/TEST_OTHER_REPO: TMOT-0003/)
    expect(await service.list(product)).toEqual([])
  })

  it('création : ID inexistant → TEST_NOT_FOUND', async () => {
    await expect(service.create(product, { title: 'C', testCaseIds: ['TOTO-0001'] })).rejects.toThrow(/TEST_NOT_FOUND: TOTO-0001/)
    expect(await service.list(product)).toEqual([])
  })

  it('ajout et duplication : mêmes refus, la campagne reste inchangée', async () => {
    const c = await service.create(product, { title: 'C', testCaseIds: ['PT-0001'] })
    expect(c.runs[0].testSnapshot?.id).toBe('PT-0001')
    await expect(service.addTests(product, c.id, ['TMOT-0003'])).rejects.toThrow(/TEST_OTHER_REPO: TMOT-0003/)
    await expect(service.addTests(product, c.id, ['PT-0001', 'TOTO-0001'])).rejects.toThrow(/TEST_NOT_FOUND: TOTO-0001/)
    await expect(service.duplicateTest(product, c.id, 'TOTO-0001', {})).rejects.toThrow(/TEST_NOT_FOUND/)
    await expect(service.duplicateTest(product, c.id, 'TMOT-0003', {})).rejects.toThrow(/TEST_OTHER_REPO/)
    expect((await service.get(product, c.id)).testCaseIds).toEqual(['PT-0001'])
  })

  it('un ID qui n\'est pas un simple identifiant n\'est cherché dans aucun composant', async () => {
    await expect(service.create(product, { title: 'C', testCaseIds: ['../moteur/tests/TMOT-0003'] })).rejects.toThrow(/TEST_NOT_FOUND/)
  })
})
