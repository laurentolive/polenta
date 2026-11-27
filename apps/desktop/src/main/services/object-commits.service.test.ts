import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { objectHistoryFile, type ObjectCommitKind } from '@polenta/types'
import { TestRepo } from '../git/test-repo.test-util'
import { GitService } from './git.service'
import { listObjectCommits } from './object-commits.service'

// GH446 — liste des commits qui modifient le fichier d'un objet (specs/GH446-tests.md, U1 à U5). Dépôt git temporaire.

let dir: string
let gitSvc: GitService
let tick = 0
const T0 = Date.UTC(2026, 10, 20) / 1000

async function commitAll(message: string, who = 'Alice') {
  await new TestRepo(dir).commitAll(message, { name: who, email: `${who.toLowerCase()}@x`, timestamp: T0 + ++tick })
  return T0 + tick
}

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh446-commits-'))
  gitSvc = new GitService()
  const repo = await TestRepo.init(dir, 'main')
  await repo.setConfig('user.name', 'Alice')
  await repo.setConfig('user.email', 'alice@x')
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('GH446 — fichier de l\'objet', () => {
  it('U1 — chemin par type, et identifiant hors du dossier refusé', () => {
    const cases: Array<[ObjectCommitKind, string]> = [
      ['requirement', 'requirements/REQ-0001.yaml'], ['test', 'tests/TST-0001.yaml'], ['campaign', 'campaigns/CAMP-0001.yaml'],
      ['issue', 'issues/ISS-0001.yaml'], ['version', 'versions/VER-0001.yaml'], ['validation', 'validations/VAL-0001.yaml'],
    ]
    for (const [kind, file] of cases) expect(objectHistoryFile(kind, file.split('/')[1].replace('.yaml', ''))).toBe(file)
    expect(() => objectHistoryFile('requirement', '../../etc/passwd')).toThrow(/identifiant d'objet invalide/)
    expect(() => objectHistoryFile('requirement', '')).toThrow()
  })
})

describe('GH446 — listObjectCommits', () => {
  it('U2 — objet modifié trois fois : trois entrées, du plus récent au plus ancien, date, auteur et sujet exacts', async () => {
    await gitSvc.writeYaml(dir, 'requirements/REQ-0001.yaml', { id: 'REQ-0001', title: 'v1' })
    const t1 = await commitAll('create REQ-0001')
    await gitSvc.writeYaml(dir, 'requirements/REQ-0001.yaml', { id: 'REQ-0001', title: 'v2' })
    const t2 = await commitAll('edit REQ-0001 : titre\n\ncorps du message')
    await gitSvc.writeYaml(dir, 'requirements/REQ-0001.yaml', { id: 'REQ-0001', title: 'v3' })
    const t3 = await commitAll('edit REQ-0001 : statut', 'Bob')

    const list = await listObjectCommits(gitSvc, dir, 'requirement', 'REQ-0001')
    expect(list.map(c => c.subject)).toEqual(['edit REQ-0001 : statut', 'edit REQ-0001 : titre', 'create REQ-0001'])
    expect(list.map(c => c.by)).toEqual(['Bob', 'Alice', 'Alice'])
    expect(list.map(c => c.at)).toEqual([t3, t2, t1].map(ts => new Date(ts * 1000).toISOString()))
    expect(list.every(c => /^[0-9a-f]{40}$/.test(c.oid))).toBe(true)
  })

  it('U3 — fichier jamais commité, ou dépôt sans commit : liste vide', async () => {
    expect(await listObjectCommits(gitSvc, dir, 'test', 'TST-0001')).toEqual([])
    expect(await listObjectCommits(gitSvc, dir, 'requirement', 'REQ-0009')).toEqual([])
  })

  it('U4 — un commit qui ne touche que d\'autres fichiers n\'apparaît pas dans la liste de l\'objet', async () => {
    await gitSvc.writeYaml(dir, 'requirements/REQ-0001.yaml', { id: 'REQ-0001' })
    await commitAll('create REQ-0001')
    await gitSvc.writeYaml(dir, 'requirements/REQ-0002.yaml', { id: 'REQ-0002' })
    await commitAll('create REQ-0002 seulement')

    const list = await listObjectCommits(gitSvc, dir, 'requirement', 'REQ-0001')
    expect(list.map(c => c.subject)).toEqual(['create REQ-0001'])
  })

  it('U5 — kind inconnu : erreur, rien n\'est lu', async () => {
    await expect(listObjectCommits(gitSvc, dir, 'changeset', 'CS-0001')).rejects.toThrow(/unknown object kind: changeset/)
  })
})
