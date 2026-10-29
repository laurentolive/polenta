import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiffEditService } from './diff-edit.service'
import type { RequirementsService } from './requirements.service'
import type { TestsService } from './tests.service'
import type { SchemaService } from './schema.service'

/** GH222 sprint 5 — enregistrement depuis la vue de diff (specs/GH222.md §12). */

const dump = (o: unknown) => yaml.dump(o, { lineWidth: 120 })
const schema = {
  version: 1,
  nodes: [{
    name: 'root',
    objectTypes: [
      { name: 'req', prefix: 'SYS', category: 'requirement', fields: [], statuses: [{ name: 'draft' }, { name: 'review' }] },
      { name: 'tst', prefix: 'TEST', category: 'test', fields: [], statuses: [{ name: 'draft' }] },
    ],
  }],
}

let repo: string
let requirements: { update: ReturnType<typeof vi.fn>; transition: ReturnType<typeof vi.fn> }
let tests: { update: ReturnType<typeof vi.fn> }
let service: DiffEditService

const req = { id: 'SYS-0001', objectTypeRef: 'root::req', title: 'T', status: 'draft', version: 1, fields: { a: 1, b: 'x' }, history: { status: [] } }
const tst = { id: 'TEST-0001', objectTypeRef: 'root::tst', title: 'T', status: 'draft', steps: [{ order: 1, action: 'a', expectedResult: 'r' }] }

beforeEach(async () => {
  repo = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh222-edit-'))
  requirements = { update: vi.fn(async () => ({})), transition: vi.fn(async () => ({})) }
  tests = { update: vi.fn(async () => ({})) }
  service = new DiffEditService(
    requirements as unknown as RequirementsService,
    tests as unknown as TestsService,
    { get: async () => schema } as unknown as SchemaService,
  )
  await fsP.mkdir(path.join(repo, 'requirements'), { recursive: true })
  await fsP.mkdir(path.join(repo, 'tests'), { recursive: true })
  await fsP.writeFile(path.join(repo, 'requirements/SYS-0001.yaml'), dump(req))
  await fsP.writeFile(path.join(repo, 'tests/TEST-0001.yaml'), dump(tst))
  await fsP.writeFile(path.join(repo, 'config.yaml'), dump({ a: 1 }))
})

afterEach(async () => {
  await fsP.rm(repo, { recursive: true, force: true })
})

const read = (rel: string) => fsP.readFile(path.join(repo, rel), 'utf8')

describe('DiffEditService.saveWorkingFile', () => {
  it('a requirement goes through its service: title, fields (removal = null), then status', async () => {
    const before = await read('requirements/SYS-0001.yaml')
    const edited = dump({ ...req, title: 'T2', status: 'review', fields: { a: 2 } })
    expect(await service.saveWorkingFile(repo, 'requirements/SYS-0001.yaml', edited, before)).toEqual({ ok: true })
    expect(requirements.update).toHaveBeenCalledWith(repo, 'SYS-0001', { title: 'T2', fields: { a: 2, b: null } }, undefined, { removeNullFields: true })
    expect(requirements.transition).toHaveBeenCalledWith(repo, 'SYS-0001', { toStatus: 'review' }, undefined)
    // The file itself is not written by the diff: the service does it.
    expect(await read('requirements/SYS-0001.yaml')).toBe(before)
  })

  it('history and version edited by hand are ignored; another root key is refused', async () => {
    const before = await read('requirements/SYS-0001.yaml')
    expect(await service.saveWorkingFile(repo, 'requirements/SYS-0001.yaml', dump({ ...req, version: 9, history: {} }), before)).toEqual({ ok: true })
    expect(requirements.update).not.toHaveBeenCalled()
    expect(await service.saveWorkingFile(repo, 'requirements/SYS-0001.yaml', dump({ ...req, jiraLinks: ['X-1'] }), before))
      .toEqual({ ok: false, reason: 'unsupported', keys: ['jiraLinks'] })
    expect(await service.saveWorkingFile(repo, 'requirements/SYS-0001.yaml', dump({ ...req, branchId: 'b' }), before))
      .toEqual({ ok: false, reason: 'unsupported', keys: ['branchId'] })
  })

  it('an invalid object is refused (unknown status, id mismatch)', async () => {
    const before = await read('requirements/SYS-0001.yaml')
    expect(await service.saveWorkingFile(repo, 'requirements/SYS-0001.yaml', dump({ ...req, status: 'nope' }), before))
      .toMatchObject({ ok: false, reason: 'invalid' })
    expect(await service.saveWorkingFile(repo, 'requirements/SYS-0001.yaml', dump({ ...req, id: 'SYS-0002' }), before))
      .toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('another file is written as is; invalid YAML refused', async () => {
    const before = await read('config.yaml')
    expect(await service.saveWorkingFile(repo, 'config.yaml', 'a: 2\n', before)).toEqual({ ok: true })
    expect(await read('config.yaml')).toBe('a: 2\n')
    expect(await service.saveWorkingFile(repo, 'config.yaml', 'a: [\n', 'a: 2\n')).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('a file changed on disk since it was loaded is not overwritten; a path outside the repo is refused', async () => {
    expect(await service.saveWorkingFile(repo, 'config.yaml', 'a: 3\n', 'a: 0\n')).toEqual({ ok: false, reason: 'changed' })
    expect(await read('config.yaml')).toBe(dump({ a: 1 }))
    expect(await service.saveWorkingFile(repo, '../x.yaml', 'a: 1\n', '')).toEqual({ ok: false, reason: 'outside' })
  })

  it('a test goes through the tests service with its own keys; removing its steps is refused', async () => {
    const steps = [{ order: 1, action: 'b', expectedResult: 'r' }]
    expect(await service.saveWorkingFile(repo, 'tests/TEST-0001.yaml', dump({ ...tst, steps }), dump(tst))).toEqual({ ok: true })
    expect(tests.update).toHaveBeenCalledWith(repo, 'TEST-0001', { steps }, undefined, { removeNullFields: true })
    const { steps: _removed, ...withoutSteps } = tst
    void _removed
    expect(await service.saveWorkingFile(repo, 'tests/TEST-0001.yaml', dump(withoutSteps), dump(tst)))
      .toEqual({ ok: false, reason: 'unsupported', keys: ['steps'] })
  })

  it('files maintained by the app, and an object outside its own file, are refused', async () => {
    await fsP.mkdir(path.join(repo, '.polenta'), { recursive: true })
    await fsP.writeFile(path.join(repo, '.polenta/schema.yaml'), 'version: 1\n')
    expect(await service.saveWorkingFile(repo, '.polenta/schema.yaml', 'version: 2\n', 'version: 1\n'))
      .toMatchObject({ ok: false, reason: 'unsupported' })
    await fsP.mkdir(path.join(repo, 'requirements/SYS'), { recursive: true })
    await fsP.writeFile(path.join(repo, 'requirements/SYS/SYS-0001.yaml'), dump(req))
    expect(await service.saveWorkingFile(repo, 'requirements/SYS/SYS-0001.yaml', dump({ ...req, title: 'X' }), dump(req)))
      .toMatchObject({ ok: false, reason: 'unsupported' })
    expect(requirements.update).not.toHaveBeenCalled()
  })

  it('a file with a BOM, and a file whose YAML is broken on disk, can be saved', async () => {
    await fsP.writeFile(path.join(repo, 'config.yaml'), '﻿a: 1\n')
    expect(await service.saveWorkingFile(repo, 'config.yaml', 'a: 2\n', 'a: 1\n')).toEqual({ ok: true })
    await fsP.writeFile(path.join(repo, 'config.yaml'), 'a: [\n')
    expect(await service.saveWorkingFile(repo, 'config.yaml', 'a: 3\n', 'a: [\n')).toEqual({ ok: true })
    expect(await read('config.yaml')).toBe('a: 3\n')
  })
})
