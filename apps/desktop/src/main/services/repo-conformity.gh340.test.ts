import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import git from 'isomorphic-git'
import yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AuthService } from './auth.service'
import { GitService } from './git.service'
import { SyncService } from './sync.service'
import type { WorkspaceService } from './workspace.service'
import { RepoConformityService } from './repo-conformity.service'
import { GITATTRIBUTES_LINE, GITIGNORE_LINES } from './repo-conformity.util'

/**
 * GH340 §6 — reprise des dates de création / modification par la mise en conformité (scénarios
 * C1–C9 de specs/GH340-tests.md). Dépôt git réel, historique construit par la CLI git avec des
 * auteurs et des dates fixés ; une branche fusionnée (`--no-ff`) vérifie l'auteur réel.
 */

const execFileAsync = promisify(execFile)

let tmp: string
let origin: string
let repo: string
let service: RepoConformityService
let sync: SyncService

const run = (cwd: string, args: string[], env: Record<string, string> = {}) =>
  execFileAsync('git', ['-c', 'user.name=Testeur', '-c', 'user.email=t@x', '-c', 'core.autocrlf=false', ...args], {
    cwd, env: { ...process.env, ...env },
  })
/** Commit signé `who`, daté `date` (date de commit ; date d'auteur `authorDate`, par défaut la même). */
const commitAs = (who: string, date: string, message: string, authorDate = date) =>
  run(repo, ['commit', '-m', message, `--author=${who} <${who}@x>`], {
    GIT_AUTHOR_DATE: authorDate, GIT_COMMITTER_DATE: date, GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: `${who}@x`,
  })
const write = async (rel: string, content: unknown) => {
  await fsP.mkdir(path.dirname(path.join(repo, rel)), { recursive: true })
  await fsP.writeFile(path.join(repo, rel), typeof content === 'string' ? content : yaml.dump(content))
}
const load = async (rel: string) => yaml.load(await fsP.readFile(path.join(repo, rel), 'utf8')) as Record<string, unknown>
const obj = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, objectTypeRef: 'root::exigence', title: id, status: 'draft', version: 1, fields: {}, ...extra })

const D1 = '2026-01-01T10:00:00Z'
const D2 = '2026-02-01T10:00:00Z'
const D3 = '2026-03-01T10:00:00Z'
const AUDITED = { createdAt: '2026-04-01T00:00:00Z', createdBy: 'x', updatedAt: '2026-04-01T00:00:00Z', updatedBy: 'x' }

beforeEach(async () => {
  tmp = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh340-conf-'))
  origin = path.join(tmp, 'origin.git')
  repo = path.join(tmp, 'repo')
  await run(tmp, ['init', '--bare', '-b', 'main', origin])
  await run(tmp, ['clone', origin, repo])
  // Dépôt déjà conforme pour le reste (GH336) : seule la reprise des dates est proposée.
  await write('.gitattributes', `${GITATTRIBUTES_LINE}\n`)
  await write('.gitignore', `${GITIGNORE_LINES.join('\n')}\n`)
  // Commit racine (Alice, D1) : une exigence, un test, une issue déjà datée en partie, un objet complet.
  await write('requirements/SYS-0001.yaml', obj('SYS-0001'))
  await write('tests/TEST-0001.yaml', obj('TEST-0001', { objectTypeRef: 'root::test' }))
  await write('issues/PI-0001.yaml', obj('PI-0001', { objectTypeRef: 'root::bug', updatedAt: '2026-05-01T00:00:00Z', updatedBy: 'y' }))
  await write('requirements/SYS-0002.yaml', obj('SYS-0002', AUDITED))
  // Mapping en style flux : jamais complété (ajout textuel impossible), reste proposé.
  await write('tests/TEST-0002.yaml', '{id: TEST-0002, title: flux}\n')
  await run(repo, ['add', '-A'])
  await commitAs('alice', D1, 'base')
  // Branche de Bob qui modifie SYS-0001 (commentaire compris) : date d'auteur antérieure à la
  // création (rebase), date de commit D2. Fusionnée par Carol (D3), qui crée SYS-0004 dans le
  // commit de fusion lui-même (comme « Garder les deux », GH37).
  await run(repo, ['checkout', '-b', 'feature'])
  await write('requirements/SYS-0001.yaml', `# note de Bob\n${yaml.dump(obj('SYS-0001', { title: 'Modifiée par Bob' }))}`)
  await run(repo, ['add', '-A'])
  await commitAs('bob', D2, 'bob', '2025-12-01T10:00:00Z')
  await run(repo, ['checkout', 'main'])
  const asCarol = { GIT_AUTHOR_DATE: D3, GIT_COMMITTER_DATE: D3, GIT_AUTHOR_NAME: 'carol', GIT_AUTHOR_EMAIL: 'carol@x', GIT_COMMITTER_NAME: 'carol', GIT_COMMITTER_EMAIL: 'carol@x' }
  await run(repo, ['merge', '--no-ff', '--no-commit', 'feature'], asCarol)
  await write('requirements/SYS-0004.yaml', obj('SYS-0004'))
  await run(repo, ['add', '-A'])
  await run(repo, ['commit', '-m', 'merge', '--no-edit'], asCarol)
  await run(repo, ['push', 'origin', 'main'])

  const auth = { getAuthor: async () => ({ name: 'Testeur', email: 't@x' }), getHttpsCredentials: async () => null } as unknown as AuthService
  sync = new SyncService(auth)
  service = new RepoConformityService(new GitService(), sync, { pendingAgentFiles: async () => [] } as unknown as WorkspaceService)
})

afterEach(async () => {
  await fsP.rm(tmp, { recursive: true, force: true })
})

describe('GH340 — reprise des dates', () => {
  const UNDATED = ['issues/PI-0001.yaml', 'requirements/SYS-0001.yaml', 'requirements/SYS-0004.yaml', 'tests/TEST-0001.yaml', 'tests/TEST-0002.yaml']

  it('C1 / C9 — check : les fichiers sans leurs quatre dates, et eux seuls', async () => {
    expect(await service.check(repo, false)).toEqual([{ id: 'audit-dates', files: UNDATED }])
  })

  it('C2 / C3 — auteur réel (hors fusion), date de commit, commit racine, fichier créé dans une fusion', async () => {
    const dates = await new GitService().auditDatesFromHistory(repo, ['requirements', 'tests', 'issues'])
    // Date d'auteur de Bob antérieure à la création (rebase) : la date de commit fait foi.
    expect(dates.get('requirements/SYS-0001.yaml')).toEqual({ createdAt: D1, createdBy: 'alice', updatedAt: D2, updatedBy: 'bob' })
    expect(dates.get('tests/TEST-0001.yaml')).toEqual({ createdAt: D1, createdBy: 'alice', updatedAt: D1, updatedBy: 'alice' })
    expect(dates.get('requirements/SYS-0004.yaml')).toEqual({ createdAt: D3, createdBy: 'carol', updatedAt: D3, updatedBy: 'carol' })
  })

  it('C4 / C5 — Valider : seules les clés absentes, ajoutées en texte ; un commit [polenta] de ces fichiers, poussé', async () => {
    const result = await service.apply(repo, false)
    expect(result.pushed).toBe(true)
    expect(await load('requirements/SYS-0001.yaml')).toMatchObject({ title: 'Modifiée par Bob', createdAt: D1, createdBy: 'alice', updatedAt: D2, updatedBy: 'bob' })
    expect(await fsP.readFile(path.join(repo, 'requirements/SYS-0001.yaml'), 'utf8')).toMatch(/^# note de Bob\n/)
    expect(await load('tests/TEST-0001.yaml')).toMatchObject({ createdAt: D1, createdBy: 'alice', updatedAt: D1, updatedBy: 'alice' })
    expect(await load('requirements/SYS-0004.yaml')).toMatchObject({ createdBy: 'carol' })
    // Valeurs présentes jamais réécrites ; mapping en style flux laissé tel quel.
    expect(await load('issues/PI-0001.yaml')).toMatchObject({ createdAt: D1, createdBy: 'alice', updatedAt: '2026-05-01T00:00:00Z', updatedBy: 'y' })
    expect(await load('requirements/SYS-0002.yaml')).toMatchObject(AUDITED)
    expect(await fsP.readFile(path.join(repo, 'tests/TEST-0002.yaml'), 'utf8')).toBe('{id: TEST-0002, title: flux}\n')

    const [last] = await git.log({ fs, dir: repo, depth: 1 })
    expect(last.commit.message).toMatch(/^\[polenta\] Mise en conformité du dépôt \(audit-dates\)/)
    const changed = await git.walk({
      fs, dir: repo, trees: [git.TREE({ ref: last.oid }), git.TREE({ ref: last.commit.parent[0] })],
      map: async (file, [a, b]) => (file !== '.' && (await a?.type()) === 'blob' && (await a?.oid()) !== (await b?.oid()) ? file : undefined),
    })
    expect((changed as string[]).sort()).toEqual(['issues/PI-0001.yaml', 'requirements/SYS-0001.yaml', 'requirements/SYS-0004.yaml', 'tests/TEST-0001.yaml'])
    expect((await run(origin, ['rev-parse', 'main'])).stdout.trim()).toBe(last.oid)
    expect(await service.check(repo, false)).toEqual([{ id: 'audit-dates', files: ['tests/TEST-0002.yaml'] }])
  })

  it('C5b — rien à compléter : aucun commit vide', async () => {
    await service.apply(repo, false)
    const [before] = await git.log({ fs, dir: repo, depth: 1 })
    expect(await service.apply(repo, false)).toEqual({ sha: null, pushed: true })
    const [after] = await git.log({ fs, dir: repo, depth: 1 })
    expect(after.oid).toBe(before.oid)
  })

  it('C7 — arbre de travail modifié : refus, rien n\'est écrit', async () => {
    await write('requirements/SYS-0003.yaml', obj('SYS-0003'))
    await expect(service.apply(repo, false)).rejects.toThrow('conformity-dirty')
    expect(await load('requirements/SYS-0001.yaml')).not.toHaveProperty('createdAt')
  })
})
