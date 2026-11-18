import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Requirement, TestCase } from '@polenta/types'
import { GitService } from './git.service'
import { IssuesService } from './issues.service'
import { RequirementsIndexService } from './requirements-index.service'
import { RequirementsService } from './requirements.service'
import { RevalidationService } from './revalidation.service'
import type { SchemaService } from './schema.service'
import { TestsIndexService } from './tests-index.service'
import { TestsService } from './tests.service'

// GH404 — un objet écrit dans le repo d'un composant (repo appelant ≠ repo de l'objet) met à jour
// l'index en mémoire de CE repo, jamais celui de l'appelant : exécution d'un test, création /
// modification d'exigence, de test, d'issue, marquage de revalidation.

const types = [
  { name: 'exigence', label: 'Exigence', prefix: 'REQ', category: 'requirement', fields: [], statuses: [{ name: 'draft' }, { name: 'approved', isApproval: true }] },
  { name: 'test', label: 'Test', prefix: 'TEST', category: 'test', fields: [], statuses: [{ name: 'draft' }, { name: 'approved', isApproval: true }] },
  { name: 'bug', label: 'Bug', prefix: 'PI', category: 'issue', fields: [], statuses: [{ name: 'ouverte' }] },
]
/** Produit : déclare le composant `comp` (nom de montage) et ses types ; le composant porte les mêmes. */
const PRODUCT_SCHEMA = {
  version: 1,
  nodes: [
    { name: 'root', label: 'Produit', objectTypes: [{ ...types[0], prefix: 'SYS' }] },
    { name: 'comp', label: 'Composant', readonly: false, objectTypes: types },
  ],
  linkTypes: [{ name: 'verification', sourceRefs: ['test'], targetRefs: ['requirement'] }],
}
const COMP_SCHEMA = { version: 1, nodes: [{ name: 'root', label: 'Composant', objectTypes: types }], linkTypes: [] }

let product: string
let comp: string
let git: GitService
let reqIndex: RequirementsIndexService
let testsIndex: TestsIndexService
let tests: TestsService
let requirements: RequirementsService
let issues: IssuesService
let revalidation: RevalidationService

beforeEach(async () => {
  const ws = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh404-'))
  product = path.join(ws, 'product')
  comp = path.join(ws, 'comp')
  git = new GitService()
  await git.writeYaml(product, '.polenta/schema.yaml', PRODUCT_SCHEMA)
  await git.writeYaml(comp, '.polenta/schema.yaml', COMP_SCHEMA)
  // `comp::…` se range dans le repo du composant (mode workspace), tout le reste dans le repo donné.
  const schema = {
    resolveComponentRepoPath: async (_repo: string, ref: string) => ref.startsWith('comp::') ? comp : null,
    get: async (repo: string) => repo === comp ? COMP_SCHEMA : PRODUCT_SCHEMA,
  } as unknown as SchemaService
  reqIndex = new RequirementsIndexService(git)
  testsIndex = new TestsIndexService(git)
  revalidation = new RevalidationService(git, reqIndex, testsIndex, schema)
  tests = new TestsService(git, testsIndex, schema, revalidation)
  requirements = new RequirementsService(git, reqIndex, schema, revalidation)
  issues = new IssuesService(git, schema)
})

afterEach(async () => {
  await fsP.rm(path.dirname(product), { recursive: true, force: true })
})

/** Index construits (vides) des deux repos : une écriture les met à jour au lieu d'être différée. */
async function buildIndexes(): Promise<void> {
  for (const p of [product, comp]) {
    await testsIndex.findAll(p)
    await reqIndex.findAll(p, {})
    await issues.findAll(p)
  }
}

describe('GH404 — exécution d\'un test d\'un autre repo', () => {
  it('le run écrit dans le repo du test est indexé dans ce repo, pas dans le repo appelant', async () => {
    // Test lu par l'index du repo appelant, mais typé sur le composant : son repo est celui du composant.
    const tc = { id: 'TEST-0001', title: 'T', objectTypeRef: 'comp::test', status: 'draft', version: 1, fields: {}, steps: [{ order: 1 }] }
    await git.writeYaml(product, 'tests/TEST-0001.yaml', tc as unknown as TestCase)
    await buildIndexes()

    const run = await tests.execute(product, 'TEST-0001', { stepResults: [{ order: 1, result: 'PASS', comment: '' }] }, path.dirname(product))

    expect(await git.fileExists(comp, `test-runs/TEST-0001/${run.id}.yaml`)).toBe(true)
    expect((await testsIndex.findRuns(comp, 'TEST-0001')).map(r => r.id)).toEqual([run.id])
    expect(await testsIndex.findRuns(product, 'TEST-0001')).toEqual([])
  })

  it('même résultat qu\'une reconstruction des deux index', async () => {
    const tc = { id: 'TEST-0001', title: 'T', objectTypeRef: 'comp::test', status: 'draft', version: 1, fields: {}, steps: [{ order: 1 }] }
    await git.writeYaml(product, 'tests/TEST-0001.yaml', tc as unknown as TestCase)
    await buildIndexes()
    await tests.execute(product, 'TEST-0001', { stepResults: [{ order: 1, result: 'FAIL', comment: '' }] }, path.dirname(product))

    const fresh = new TestsIndexService(git)
    for (const p of [product, comp]) {
      expect(await testsIndex.getRunsMap(p)).toEqual(await fresh.getRunsMap(p))
    }
  })
})

describe('GH404 — objets créés ou modifiés dans le repo d\'un composant', () => {
  const ws = () => path.dirname(product)

  it('test créé depuis le produit : indexé dans le composant seulement', async () => {
    await buildIndexes()
    const tc = await tests.create(product, { objectTypeRef: 'comp::test', title: 'Essai', steps: [], fields: {} }, ws())
    expect(await git.fileExists(comp, `tests/${tc.id}.yaml`)).toBe(true)
    expect((await testsIndex.findById(comp, tc.id))?.title).toBe('Essai')
    expect(await testsIndex.findById(product, tc.id)).toBeNull()
  })

  it('exigence créée puis modifiée depuis le produit : indexée dans le composant seulement', async () => {
    await buildIndexes()
    const req = await requirements.create(product, { objectTypeRef: 'comp::exigence', title: 'Exigence', fields: {} }, ws())
    expect(await git.fileExists(comp, `requirements/${req.id}.yaml`)).toBe(true)
    expect(await reqIndex.findById(product, req.id)).toBeNull()
    expect((await reqIndex.findById(comp, req.id))?.title).toBe('Exigence')

    await requirements.update(comp, req.id, { title: 'Renommée' }, ws())
    expect((await reqIndex.findById(comp, req.id))?.title).toBe('Renommée')
    expect(await reqIndex.findById(product, req.id)).toBeNull()
  })

  it('issue créée depuis le produit : indexée dans le composant seulement', async () => {
    await buildIndexes()
    const issue = await issues.create(product, { objectTypeRef: 'comp::bug', title: 'Panne', fields: {} }, ws())
    expect(await git.fileExists(comp, `issues/${issue.id}.yaml`)).toBe(true)
    expect((await issues.findAll(comp)).map(i => i.id)).toEqual([issue.id])
    expect(await issues.findAll(product)).toEqual([])
  })

  it('revalidation : le flag posé sur un élément du composant met à jour l\'index du composant', async () => {
    // Exigence lue dans le produit mais typée sur le composant (même configuration que l'exécution).
    const req = { id: 'REQ-0001', title: 'R', objectTypeRef: 'comp::exigence', status: 'approved', version: 1, fields: {} }
    await git.writeYaml(product, 'requirements/REQ-0001.yaml', req as unknown as Requirement)
    const tc = { id: 'TEST-0001', title: 'T', objectTypeRef: 'root::test', status: 'approved', version: 1, fields: {}, steps: [] }
    await git.writeYaml(product, 'tests/TEST-0001.yaml', tc as unknown as TestCase)
    await git.writeYaml(product, 'links/links.yaml', { links: [{ id: 'L1', type: 'verification', sourceId: 'TEST-0001', targetId: 'REQ-0001' }] })
    await buildIndexes()

    await revalidation.markImpactedBy(product, 'TEST-0001')

    const written = await git.readYaml<Requirement>(comp, 'requirements/REQ-0001.yaml')
    expect(written?.needsRevalidation).toBe(true)
    expect((await reqIndex.findById(comp, 'REQ-0001'))?.needsRevalidation).toBe(true)
    expect((await reqIndex.findById(product, 'REQ-0001'))?.needsRevalidation).toBeFalsy()
  })
})
