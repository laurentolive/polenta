import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AuthService } from './auth.service'
import { MergeResolutionService } from './merge-resolution.service'
import { SchemaService } from './schema.service'
import { SyncService } from './sync.service'
import { gitFor } from '../git/git-backend'
import { TestRepo } from '../git/test-repo.test-util'

/**
 * GH332 — fusion d'une histoire croisée (plusieurs ancêtres communs). Avant le correctif,
 * `git.merge` d'isomorphic-git levait `MergeNotSupportedError` et « Rafraîchir » / « Publier »
 * restaient bloqués.
 *
 * Histoire construite (main et other se sont fusionnés mutuellement) :
 *
 *   base ── A1 ── M1(main: A1+B1) ── A2   ← main
 *       └─ B1 ── M2(other: B1+A1) ── B2   ← other
 *
 * Ancêtres communs de A2 et B2 : A1 et B1.
 */

const AUTHOR = { name: 'Testeur', email: 't@x' }

let repo: string
let sync: SyncService

const r = () => new TestRepo(repo)
const write = (rel: string, content: string) => fsP.writeFile(path.join(repo, rel), content)
const read = (rel: string) => fsP.readFile(path.join(repo, rel), 'utf8')

async function commitAll(message: string) {
  return r().commitAll(message, AUTHOR)
}

async function textAt(ref: string, filepath: string) {
  const text = await r().git.readText(ref, filepath)
  if (text === null) throw new Error(`${ref}:${filepath} absent`)
  return text
}

/** Construit l'histoire croisée ; `mainEdit` / `otherEdit` sont les derniers commits de chaque côté. */
async function crissCross(mainEdit: [string, string], otherEdit: [string, string]) {
  await write('a.yaml', 'a: 0\n')
  await write('b.yaml', 'b: 0\n')
  await write('c.yaml', 'c: 0\n')
  await commitAll('base')
  await r().branch('other')

  await write('a.yaml', 'a: 1\n')
  const a1 = await commitAll('A1')

  await r().checkout('other')
  await write('b.yaml', 'b: 1\n')
  const b1 = await commitAll('B1')

  // M1 : main ← B1 ; M2 : other ← A1 (croisé). Fusions de refs, sans toucher au disque.
  await r().git.mergeBranches('main', b1, { author: AUTHOR })
  await r().git.mergeBranches('other', a1, { author: AUTHOR })
  await r().checkout('other', { force: true })
  await write(...otherEdit)
  await commitAll('B2')

  await r().checkout('main', { force: true })
  await write(...mainEdit)
  await commitAll('A2')
  return { a1, b1 }
}

beforeEach(async () => {
  repo = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh332-'))
  sync = new SyncService({ getAuthor: async () => AUTHOR } as unknown as AuthService)
  await TestRepo.init(repo, 'main')
})

afterEach(async () => {
  await fsP.rm(repo, { recursive: true, force: true })
})

describe('GH332 — histoire croisée', () => {
  // Remplace l'ancien test « isomorphic-git seul lève MergeNotSupportedError » : ce test ne visait
  // que la bibliothèque, plus utilisée. Il garde la précondition de la fixture (deux ancêtres).
  it('la fixture est une histoire croisée : deux ancêtres communs entre main et other', async () => {
    await crissCross(['c.yaml', 'c: main\n'], ['d.yaml', 'd: other\n'])
    const m = await r().resolve('main')
    const o = await r().resolve('other')
    expect(await gitFor(repo).mergeBases(m, o)).toHaveLength(2)
  })

  it('Fusionner (branche courante) aboutit, avec deux parents, et réaligne le working directory', async () => {
    await crissCross(['c.yaml', 'c: main\n'], ['d.yaml', 'd: other\n'])
    const before = await r().resolve('main')
    const otherOid = await r().resolve('other')

    const result = await sync.merge(repo, 'other')

    expect(result.success).toBe(true)
    const head = await r().resolve('main')
    expect(result.success && result.sha).toBe(head)
    const commit = (await r().git.readCommit(head))!
    expect(commit.parents).toEqual([before, otherOid])
    expect(await textAt('main', 'a.yaml')).toBe('a: 1\n')
    expect(await textAt('main', 'b.yaml')).toBe('b: 1\n')
    expect(await textAt('main', 'c.yaml')).toBe('c: main\n')
    expect(await textAt('main', 'd.yaml')).toBe('d: other\n')
    // Working directory et index alignés : rien à committer, fichier de l'autre côté présent.
    expect(await read('d.yaml')).toBe('d: other\n')
    const status = await sync.status(repo)
    expect(status.staged.length + status.unstaged.length).toBe(0)
  })

  it('un vrai conflit remonte comme un conflit ordinaire (éditeur de fusion), rien n\'est écrit', async () => {
    await crissCross(['c.yaml', 'c: main\n'], ['c.yaml', 'c: other\n'])
    const before = await r().resolve('main')

    const result = await sync.merge(repo, 'other')

    expect(result).toEqual({ success: false, conflicts: ['c.yaml'], leftRef: 'other', rightRef: 'main' })
    expect(await r().resolve('main')).toBe(before)
    expect(await read('c.yaml')).toBe('c: main\n')
  })

  it('Rafraîchir (pull) : branche locale divergée d\'origin par une histoire croisée — fusionnée', async () => {
    await crissCross(['c.yaml', 'c: main\n'], ['d.yaml', 'd: other\n'])
    // origin/main = la branche `other` (pas de remote configuré : le fetch ne fait rien).
    const remoteOid = await r().resolve('other')
    await r().git.updateRefs([{ ref: 'refs/remotes/origin/main', newOid: remoteOid }])

    const result = await sync.pull(repo)

    expect(result.success).toBe(true)
    const commit = (await r().git.readCommit(await r().resolve('main')))!
    expect(commit.parents[1]).toBe(remoteOid)
    expect(commit.message.trim()).toBe("Merge remote-tracking branch 'origin/main' into main")
    expect(await read('d.yaml')).toBe('d: other\n')
  })

  it('simulation (dryRun) : ne déplace aucune branche', async () => {
    await crissCross(['c.yaml', 'c: main\n'], ['d.yaml', 'd: other\n'])
    const before = await r().resolve('main')
    const result = await gitFor(repo).mergeBranches('main', 'other', { author: AUTHOR, dryRun: true })
    expect(result.tree).toBeTruthy()
    expect(await r().resolve('main')).toBe(before)
  })

  it('fusion dans une branche non checkoutée : seule la référence avance', async () => {
    await crissCross(['c.yaml', 'c: main\n'], ['d.yaml', 'd: other\n'])
    const result = await sync.mergeInto(repo, 'main', 'other')
    expect(result.success).toBe(true)
    expect(await textAt('other', 'c.yaml')).toBe('c: main\n')
    expect(await r().currentBranch()).toBe('main')
  })

  it('base virtuelle : contient les deux ancêtres communs (éditeur de fusion)', async () => {
    await crissCross(['c.yaml', 'c: main\n'], ['c.yaml', 'c: other\n'])
    const m = await r().resolve('main')
    const o = await r().resolve('other')
    const base = await gitFor(repo).displayBase(m, o)
    expect(base).toBeTruthy()
    const at = async (f: string) => (await r().git.readText(base!, f)) ?? ''
    expect(await at('a.yaml')).toBe('a: 1\n')
    expect(await at('b.yaml')).toBe('b: 1\n')
    expect(await at('c.yaml')).toBe('c: 0\n')
  })

  it('ancêtres en conflit entre eux : la base virtuelle garde leur version commune, le conflit remonte', async () => {
    // Les deux fusions croisées n'ont pas tranché a.yaml de la même façon.
    await write('a.yaml', 'a: 0\n')
    await commitAll('base')
    await r().branch('other')
    await write('a.yaml', 'a: main\n')
    const a1 = await commitAll('A1')
    await r().checkout('other')
    await write('a.yaml', 'a: other\n')
    const b1 = await commitAll('B1')
    // Résolutions divergentes, écrites à la main (commits à deux parents).
    const tree = async (content: string) => {
      const blob = await r().git.writeBlob(Buffer.from(content))
      return r().git.mktree([{ mode: '100644', path: 'a.yaml', oid: blob, type: 'blob' }])
    }
    const m1 = await r().git.commitTree(await tree('a: main\n'), [a1, b1], 'M1', AUTHOR)
    const m2 = await r().git.commitTree(await tree('a: other\n'), [b1, a1], 'M2', AUTHOR)
    await r().git.updateRefs([{ ref: 'refs/heads/main', newOid: m1 }, { ref: 'refs/heads/other', newOid: m2 }])
    await r().checkout('main', { force: true })

    const result = await sync.merge(repo, 'other')
    expect(result).toEqual({ success: false, conflicts: ['a.yaml'], leftRef: 'other', rightRef: 'main' })
  })
})

describe('GH332 — éditeur de fusion sur une histoire croisée', () => {
  it('s\'ouvre sur le seul fichier en conflit et finalise un commit à deux parents', async () => {
    await crissCross(['c.yaml', 'c: main\n'], ['c.yaml', 'c: other\n'])
    const userData = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh332-ud-'))
    try {
      const auth = { getAuthor: async () => AUTHOR } as unknown as AuthService
      const editor = new MergeResolutionService(userData, auth, sync, new SchemaService(auth))
      const otherOid = await r().resolve('other')
      const before = await r().resolve('main')

      const session = await editor.open(repo, 'other', 'main', { kind: 'merge', from: 'other', into: 'main' })
      expect(session.files.map(f => f.path)).toEqual(['c.yaml'])

      await editor.saveFile(session.id, 'c.yaml', { state: 'merged', text: 'c: both\n' })
      const res = await editor.finalize(session.id)
      expect(res.ok).toBe(true)
      const head = await r().resolve('main')
      const commit = (await r().git.readCommit(head))!
      expect(commit.parents).toEqual([before, otherOid])
      expect(await read('c.yaml')).toBe('c: both\n')
      expect(await read('d.yaml').catch(() => null)).toBeNull()
      expect(await textAt('main', 'b.yaml')).toBe('b: 1\n')
    } finally {
      await fsP.rm(userData, { recursive: true, force: true })
    }
  })
})
