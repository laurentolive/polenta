import { describe, expect, it } from 'vitest'
import type { TestCase, TestRun } from '@polenta/types'

import type { GitService } from './git.service'
import { RequirementsIndexService } from './requirements-index.service'
import { TestsIndexService } from './tests-index.service'

// GH87 — une seule construction d'index par repo à la fois, et jamais de construction périmée publiée.

const tc = (id: string) => ({ id, title: id }) as unknown as TestCase
const run = (id: string, testCaseId: string, executedAt: string) => ({ id, testCaseId, executedAt }) as unknown as TestRun

/** Faux dépôt : le contenu de `files` est lu au moment de la lecture, `fileHistoryMap` attend `gate`. */
function fakeGit(files: Record<string, unknown>, gate: () => Promise<void> = async () => {}) {
  const calls = { histories: 0 }
  const git = {
    listFiles: async (_repo: string, dir: string) => Object.keys(files).filter(f => f.startsWith(`${dir}/`)),
    readYaml: async (_repo: string, file: string) => files[file] ?? null,
    fileHistoryMap: async () => { calls.histories++; await gate(); return new Map() },
  } as unknown as GitService
  return { git, calls }
}

function gated() {
  const waiting: Array<() => void> = []
  return {
    gate: () => new Promise<void>(resolve => { waiting.push(resolve) }),
    releaseOne: () => waiting.shift()?.(),
    pending: () => waiting.length,
  }
}

const tick = () => new Promise(resolve => setImmediate(resolve))

describe('TestsIndexService (GH87)', () => {
  it('lecteurs concurrents : une seule construction', async () => {
    const { git, calls } = fakeGit({ 'tests/T-1.yaml': tc('T-1') })
    const index = new TestsIndexService(git)
    await Promise.all([index.findAll('/repo'), index.getLatestRunMap('/repo'), index.getRunsMap('/repo'), index.findById('/repo', 'T-1')])
    expect(calls.histories).toBe(1)
  })

  it('une construction par repo : deux repos ne partagent rien', async () => {
    const { git, calls } = fakeGit({ 'tests/T-1.yaml': tc('T-1') })
    const index = new TestsIndexService(git)
    await Promise.all([index.findAll('/a'), index.findAll('/b')])
    expect(calls.histories).toBe(2)
  })

  it('invalidation pendant une construction : la construction périmée n\'est pas publiée', async () => {
    const files: Record<string, unknown> = { 'tests/T-1.yaml': { ...tc('T-1'), title: 'avant' } }
    const g = gated()
    const { git, calls } = fakeGit(files, g.gate)
    const index = new TestsIndexService(git)
    const reading = index.findById('/repo', 'T-1')
    await tick()
    files['tests/T-1.yaml'] = { ...tc('T-1'), title: 'après' }
    index.invalidate('/repo')
    g.releaseOne()
    await tick()
    g.releaseOne()
    expect((await reading)?.title).toBe('après')
    expect(calls.histories).toBe(2)
  })

  it('test écrit pendant la construction : présent dans l\'index publié', async () => {
    const g = gated()
    const { git } = fakeGit({ 'tests/T-1.yaml': tc('T-1') }, g.gate)
    const index = new TestsIndexService(git)
    const reading = index.findAll('/repo')
    await tick()
    index.upsertTestCase('/repo', tc('T-2'))
    g.releaseOne()
    expect((await reading).map(t => t.id)).toEqual(['T-1', 'T-2'])
  })

  it('exécution écrite pendant la construction : présente et triée, sans doublon', async () => {
    const g = gated()
    const { git } = fakeGit({
      'tests/T-1.yaml': tc('T-1'),
      'test-runs/T-1/RUN-1.yaml': run('RUN-1', 'T-1', '2026-01-01T00:00:00Z'),
    }, g.gate)
    const index = new TestsIndexService(git)
    const reading = index.findRuns('/repo', 'T-1')
    await tick()
    index.upsertRun('/repo', run('RUN-2', 'T-1', '2026-02-01T00:00:00Z'))
    index.upsertRun('/repo', run('RUN-1', 'T-1', '2026-01-01T00:00:00Z'))
    g.releaseOne()
    expect((await reading).map(r => r.id)).toEqual(['RUN-2', 'RUN-1'])
  })

  it('construction en échec : erreur transmise, le prochain lecteur réessaie', async () => {
    let fail = true
    const { git } = fakeGit({ 'tests/T-1.yaml': tc('T-1') }, async () => {
      if (fail) throw new Error('disque')
    })
    const index = new TestsIndexService(git)
    await expect(index.findAll('/repo')).rejects.toThrow('disque')
    fail = false
    expect((await index.findAll('/repo')).map(t => t.id)).toEqual(['T-1'])
  })
})

describe('RequirementsIndexService (GH87)', () => {
  const req = (id: string, title: string) => ({ id, title, objectTypeRef: 'root::x', status: 'draft', fields: {} })

  it('invalidation pendant une construction : la construction périmée n\'est pas publiée', async () => {
    const files: Record<string, unknown> = { 'requirements/R-1.yaml': req('R-1', 'avant') }
    const g = gated()
    const { git, calls } = fakeGit(files, g.gate)
    const index = new RequirementsIndexService(git)
    const reading = index.findById('/repo', 'R-1')
    await tick()
    files['requirements/R-1.yaml'] = req('R-1', 'après')
    index.invalidate('/repo')
    g.releaseOne()
    await tick()
    g.releaseOne()
    expect((await reading)?.title).toBe('après')
    expect(calls.histories).toBe(2)
  })
})
