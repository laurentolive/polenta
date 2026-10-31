import { describe, expect, it } from 'vitest'
import type { Requirement } from '@polenta/types'
import { RequirementsIndexService } from './requirements-index.service'
import type { GitService } from './git.service'

// Écriture reçue pendant la construction de l'index (dossier listé avant l'écriture) : l'objet
// créé reste trouvable (e2e s2-core : `requirements:update` juste après `requirements:create`).

const req = (id: string): Requirement => ({
  id, projectId: '', branchId: '', objectTypeRef: 'root::exigence', title: id, status: 'draft', version: 1,
  fields: {}, jiraLinks: [], createdAt: null, createdBy: null, updatedAt: null, updatedBy: null,
})

function slowGit(release: Promise<void>): GitService {
  return {
    listFiles: async (_repo: string, dir: string) => (dir === 'requirements' ? ['requirements/SYS-1.yaml'] : []),
    readYaml: async (_repo: string, file: string) => (file === 'requirements/SYS-1.yaml' ? req('SYS-1') : null),
    fileHistoryMap: async () => { await release; return new Map() },
  } as unknown as GitService
}

describe('RequirementsIndexService — écriture pendant une construction', () => {
  it('l\'objet écrit pendant la construction est dans l\'index publié', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const index = new RequirementsIndexService(slowGit(gate))
    const reading = index.findAll('/repo')
    await Promise.resolve()
    index.upsert('/repo', req('SYS-2'))
    release()
    expect((await reading).map(r => r.id)).toEqual(['SYS-1', 'SYS-2'])
    expect(await index.findById('/repo', 'SYS-2')).not.toBeNull()
  })

  it('lecteurs concurrents : une seule construction', async () => {
    let builds = 0
    const git = {
      listFiles: async () => { builds++; return [] },
      readYaml: async () => null,
      fileHistoryMap: async () => new Map(),
    } as unknown as GitService
    const index = new RequirementsIndexService(git)
    await Promise.all([index.findAll('/repo'), index.findById('/repo', 'X'), index.findAll('/repo')])
    // 3 listages (requirements, versions, links) par construction.
    expect(builds).toBe(3)
  })
})
