import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Requirement } from '@polenta/types'
import { CampaignsService } from './campaigns.service'
import { GitService } from './git.service'
import { HistoryBackfillService } from './history-backfill.service'
import { HistoryService } from './history.service'
import { RequirementsIndexService } from './requirements-index.service'
import { RequirementsService } from './requirements.service'
import type { SchemaService } from './schema.service'
import { TestsIndexService } from './tests-index.service'
import { TestsService } from './tests.service'

// GH77 sprint 3 — reprise de l'historique depuis git (scénarios B1–B6 de specs/GH77-tests.md).
// Vrai repo git (isomorphic-git), un commit par étape, dates et auteurs fixés.

const SCHEMA = {
  version: 1,
  nodes: [{
    name: 'root', objectTypes: [{
      name: 'exigence', prefix: 'SYS', category: 'requirement',
      fields: [{ name: 'statement', type: 'richtext', trackHistory: true }],
      statuses: [{ name: 'draft' }, { name: 'review' }, { name: 'approved' }],
    }],
  }],
  linkTypes: [],
}

const T0 = Date.UTC(2026, 8, 1) / 1000 // 2026-09-01T00:00:00Z
const iso = (t: number) => new Date(t * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')

let dir: string
let gitSvc: GitService
let reqIndex: RequirementsIndexService
let backfill: HistoryBackfillService
let requirements: RequirementsService

const schemaStub = { resolveComponentRepoPath: async () => null } as unknown as SchemaService

function req(status: string, statement: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'SYS-0001', projectId: '', branchId: '', objectTypeRef: 'root::exigence', title: 'R',
    status, version: 1, fields: { statement }, jiraLinks: [], ...extra,
  }
}

async function commit(files: Record<string, unknown | null>, author: string, time: number, message = 'm') {
  for (const [file, content] of Object.entries(files)) {
    if (content === null) {
      await fsP.rm(path.join(dir, file), { force: true })
      await git.remove({ fs, dir, filepath: file })
      continue
    }
    if (typeof content === 'string') await fsP.writeFile(path.join(dir, file), content)
    else await gitSvc.writeYaml(dir, file, content)
    await git.add({ fs, dir, filepath: file })
  }
  await git.commit({ fs, dir, message, author: { name: author, email: `${author}@x`, timestamp: time, timezoneOffset: 0 } })
}

const onDisk = () => gitSvc.readYaml<Requirement>(dir, 'requirements/SYS-0001.yaml') as Promise<Requirement>

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh77-backfill-'))
  await git.init({ fs, dir, defaultBranch: 'main' })
  gitSvc = new GitService()
  await fsP.mkdir(path.join(dir, 'requirements'), { recursive: true })
  await commit({ '.polenta/schema.yaml': SCHEMA }, 'Admin', T0 - 100)
  reqIndex = new RequirementsIndexService(gitSvc)
  const history = new HistoryService(gitSvc, async () => ({ by: 'lolive' }), () => new Date((T0 + 10_000) * 1000))
  requirements = new RequirementsService(gitSvc, reqIndex, schemaStub, undefined, undefined, history)
  const tests = new TestsService(gitSvc, new TestsIndexService(gitSvc), schemaStub, undefined, undefined, history)
  backfill = new HistoryBackfillService(gitSvc, requirements, tests, new CampaignsService(gitSvc, tests, undefined, history))
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('HistoryBackfillService', () => {
  it('B1 — draft → review → approved en 3 commits : 3 entrées git datées et signées des commits', async () => {
    await commit({ 'requirements/SYS-0001.yaml': req('draft', 'a') }, 'Alice', T0)
    await commit({ 'requirements/SYS-0001.yaml': req('review', 'a') }, 'Bob', T0 + 60)
    await commit({ 'requirements/SYS-0001.yaml': req('approved', 'a') }, 'Alice', T0 + 120)

    const result = await backfill.run(dir)
    expect(result).toMatchObject({ objects: 1, failed: [] })
    expect((await onDisk()).history?.status).toEqual([
      { value: 'draft', at: iso(T0), by: 'Alice', source: 'git' },
      { value: 'review', at: iso(T0 + 60), by: 'Bob', source: 'git' },
      { value: 'approved', at: iso(T0 + 120), by: 'Alice', source: 'git' },
    ])
  })

  it('B2 — relancer la reprise n\'ajoute rien', async () => {
    await commit({ 'requirements/SYS-0001.yaml': req('draft', 'a') }, 'Alice', T0)
    await commit({ 'requirements/SYS-0001.yaml': req('review', 'a') }, 'Bob', T0 + 60)
    await backfill.run(dir)
    const first = await fsP.readFile(path.join(dir, 'requirements/SYS-0001.yaml'), 'utf-8')
    reqIndex.invalidate(dir)
    expect(await backfill.run(dir)).toEqual({ objects: 0, entriesAdded: 0, failed: [] })
    expect(await fsP.readFile(path.join(dir, 'requirements/SYS-0001.yaml'), 'utf-8')).toBe(first)
  })

  it('B3 — changement déjà noté par l\'application : pas de doublon git', async () => {
    const appEntry = { value: 'review', at: iso(T0 + 30), by: 'lolive' }
    await commit({ 'requirements/SYS-0001.yaml': req('draft', 'a', { history: { status: [{ value: 'draft', at: iso(T0 - 10), by: 'lolive' }] } }) }, 'Alice', T0)
    await commit({
      'requirements/SYS-0001.yaml': req('review', 'a', { history: { status: [{ value: 'draft', at: iso(T0 - 10), by: 'lolive' }, appEntry] } }),
    }, 'Bob', T0 + 60)

    await backfill.run(dir)
    const status = (await onDisk()).history?.status ?? []
    expect(status.filter(e => e.value === 'review')).toEqual([appEntry])
    expect(status.filter(e => e.value === 'draft')).toHaveLength(1)
  })

  it('B4 — champ richtext suivi modifié dans 2 commits : 2 entrées sans valeur', async () => {
    await commit({ 'requirements/SYS-0001.yaml': req('draft', 'v1') }, 'Alice', T0)
    await commit({ 'requirements/SYS-0001.yaml': req('draft', 'v2') }, 'Bob', T0 + 60)
    await backfill.run(dir)
    expect((await onDisk()).history?.statement).toEqual([
      { at: iso(T0), by: 'Alice', source: 'git' },
      { at: iso(T0 + 60), by: 'Bob', source: 'git' },
    ])
  })

  it('B5 — fusion : chaîne des premiers parents, le changement de la branche est daté du commit de fusion, sans doublon', async () => {
    await commit({ 'requirements/SYS-0001.yaml': req('draft', 'a') }, 'Alice', T0)
    await git.branch({ fs, dir, ref: 'feature', checkout: true })
    await commit({ 'requirements/SYS-0001.yaml': req('review', 'a') }, 'Bob', T0 + 60)
    await git.checkout({ fs, dir, ref: 'main' })
    await commit({ 'README.md': 'x' }, 'Carol', T0 + 90)
    const merged = await git.merge({ fs, dir, ours: 'main', theirs: 'feature', author: { name: 'Merge', email: 'm@x', timestamp: T0 + 120, timezoneOffset: 0 } })
    expect(merged.mergeCommit).toBe(true)
    await git.checkout({ fs, dir, ref: 'main', force: true })

    await backfill.run(dir)
    expect((await onDisk()).history?.status).toEqual([
      { value: 'draft', at: iso(T0), by: 'Alice', source: 'git' },
      { value: 'review', at: iso(T0 + 120), by: 'Merge', source: 'git' },
    ])
  })

  it('entrée « début du suivi » rendue redondante par la reprise : retirée', async () => {
    // Suivi démarré après coup (GH77 S1) : `draft` constaté et daté du dernier commit, puis `review`.
    await commit({ 'requirements/SYS-0001.yaml': req('draft', 'a') }, 'Alice', T0)
    await commit({ 'requirements/SYS-0001.yaml': req('draft', 'b') }, 'Bob', T0 + 60)
    await gitSvc.writeYaml(dir, 'requirements/SYS-0001.yaml', req('review', 'b', { history: { status: [
      { value: 'draft', at: iso(T0 + 60), by: 'Bob', source: 'schema' },
      { value: 'review', at: iso(T0 + 500), by: 'lolive' },
    ] } }))
    const result = await backfill.run(dir)
    expect((await onDisk()).history?.status).toEqual([
      { value: 'draft', at: iso(T0), by: 'Alice', source: 'git' },
      { value: 'review', at: iso(T0 + 500), by: 'lolive' },
    ])
    expect(result.entriesAdded).toBe(3) // draft (git) + 2 événements statement
  })

  it('B6 — YAML corrompu dans un commit : listé, les autres versions reprises', async () => {
    await commit({ 'requirements/SYS-0001.yaml': req('draft', 'a') }, 'Alice', T0)
    await commit({ 'requirements/SYS-0001.yaml': 'id: [cassé' }, 'Bob', T0 + 60)
    await commit({ 'requirements/SYS-0001.yaml': req('approved', 'a') }, 'Alice', T0 + 120)
    const result = await backfill.run(dir)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].file).toMatch(/^requirements\/SYS-0001\.yaml@/)
    expect((await onDisk()).history?.status?.map(e => e.value)).toEqual(['draft', 'approved'])
  })

  it('fichier supprimé du repo : ignoré', async () => {
    await commit({ 'requirements/SYS-0001.yaml': req('draft', 'a') }, 'Alice', T0)
    await commit({ 'requirements/SYS-0001.yaml': null }, 'Bob', T0 + 60)
    expect(await backfill.run(dir)).toEqual({ objects: 0, entriesAdded: 0, failed: [] })
  })
})
