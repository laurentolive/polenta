import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AuthService } from './auth.service'
import { MergeResolutionService } from './merge-resolution.service'
import { SchemaService } from './schema.service'
import { SyncService } from './sync.service'
import { mergeRecursive, singleMergeBase } from './recursive-merge.util'

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

const write = (rel: string, content: string) => fsP.writeFile(path.join(repo, rel), content)
const read = (rel: string) => fsP.readFile(path.join(repo, rel), 'utf8')

async function commitAll(message: string) {
  await git.add({ fs, dir: repo, filepath: '.' })
  return git.commit({ fs, dir: repo, message, author: AUTHOR })
}

async function textAt(ref: string, filepath: string) {
  const oid = await git.resolveRef({ fs, dir: repo, ref })
  const { blob } = await git.readBlob({ fs, dir: repo, oid, filepath })
  return Buffer.from(blob).toString('utf8')
}

/** Construit l'histoire croisée ; `mainEdit` / `otherEdit` sont les derniers commits de chaque côté. */
async function crissCross(mainEdit: [string, string], otherEdit: [string, string]) {
  await write('a.yaml', 'a: 0\n')
  await write('b.yaml', 'b: 0\n')
  await write('c.yaml', 'c: 0\n')
  await commitAll('base')
  await git.branch({ fs, dir: repo, ref: 'other' })

  await write('a.yaml', 'a: 1\n')
  const a1 = await commitAll('A1')

  await git.checkout({ fs, dir: repo, ref: 'other' })
  await write('b.yaml', 'b: 1\n')
  const b1 = await commitAll('B1')

  // M1 : main ← B1 ; M2 : other ← A1 (croisé).
  await git.merge({ fs, dir: repo, ours: 'main', theirs: b1, author: AUTHOR })
  await git.merge({ fs, dir: repo, ours: 'other', theirs: a1, author: AUTHOR })
  await git.checkout({ fs, dir: repo, ref: 'other', force: true })
  await write(...otherEdit)
  await commitAll('B2')

  await git.checkout({ fs, dir: repo, ref: 'main', force: true })
  await write(...mainEdit)
  await commitAll('A2')
  return { a1, b1 }
}

beforeEach(async () => {
  repo = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh332-'))
  sync = new SyncService({ getAuthor: async () => AUTHOR } as unknown as AuthService)
  await git.init({ fs, dir: repo, defaultBranch: 'main' })
})

afterEach(async () => {
  await fsP.rm(repo, { recursive: true, force: true })
})

describe('GH332 — histoire croisée', () => {
  it('reproduit le blocage : isomorphic-git seul lève MergeNotSupportedError', async () => {
    await crissCross(['c.yaml', 'c: main\n'], ['d.yaml', 'd: other\n'])
    const [m, o] = await Promise.all([
      git.resolveRef({ fs, dir: repo, ref: 'main' }), git.resolveRef({ fs, dir: repo, ref: 'other' }),
    ])
    expect(await git.findMergeBase({ fs, dir: repo, oids: [m, o] })).toHaveLength(2)
    await expect(git.merge({ fs, dir: repo, ours: 'main', theirs: 'other', author: AUTHOR }))
      .rejects.toBeInstanceOf(git.Errors.MergeNotSupportedError)
  })

  it('Fusionner (branche courante) aboutit, avec deux parents, et réaligne le working directory', async () => {
    await crissCross(['c.yaml', 'c: main\n'], ['d.yaml', 'd: other\n'])
    const before = await git.resolveRef({ fs, dir: repo, ref: 'main' })
    const otherOid = await git.resolveRef({ fs, dir: repo, ref: 'other' })

    const result = await sync.merge(repo, 'other')

    expect(result.success).toBe(true)
    const head = await git.resolveRef({ fs, dir: repo, ref: 'main' })
    expect(result.success && result.sha).toBe(head)
    const { commit } = await git.readCommit({ fs, dir: repo, oid: head })
    expect(commit.parent).toEqual([before, otherOid])
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
    const before = await git.resolveRef({ fs, dir: repo, ref: 'main' })

    const result = await sync.merge(repo, 'other')

    expect(result).toEqual({ success: false, conflicts: ['c.yaml'], leftRef: 'other', rightRef: 'main' })
    expect(await git.resolveRef({ fs, dir: repo, ref: 'main' })).toBe(before)
    expect(await read('c.yaml')).toBe('c: main\n')
  })

  it('Rafraîchir (pull) : branche locale divergée d\'origin par une histoire croisée — fusionnée', async () => {
    await crissCross(['c.yaml', 'c: main\n'], ['d.yaml', 'd: other\n'])
    // origin/main = la branche `other` (pas de remote configuré : le fetch ne fait rien).
    const remoteOid = await git.resolveRef({ fs, dir: repo, ref: 'other' })
    await git.writeRef({ fs, dir: repo, ref: 'refs/remotes/origin/main', value: remoteOid })

    const result = await sync.pull(repo)

    expect(result.success).toBe(true)
    const { commit } = await git.readCommit({ fs, dir: repo, oid: await git.resolveRef({ fs, dir: repo, ref: 'main' }) })
    expect(commit.parent[1]).toBe(remoteOid)
    expect(commit.message.trim()).toBe("Merge remote-tracking branch 'origin/main' into main")
    expect(await read('d.yaml')).toBe('d: other\n')
  })

  it('simulation (dryRun) : ne déplace aucune branche', async () => {
    await crissCross(['c.yaml', 'c: main\n'], ['d.yaml', 'd: other\n'])
    const before = await git.resolveRef({ fs, dir: repo, ref: 'main' })
    const result = await mergeRecursive({ dir: repo, ours: 'main', theirs: 'other', author: AUTHOR, dryRun: true })
    expect(result.tree).toBeTruthy()
    expect(await git.resolveRef({ fs, dir: repo, ref: 'main' })).toBe(before)
  })

  it('fusion dans une branche non checkoutée : seule la référence avance', async () => {
    await crissCross(['c.yaml', 'c: main\n'], ['d.yaml', 'd: other\n'])
    const result = await sync.mergeInto(repo, 'main', 'other')
    expect(result.success).toBe(true)
    expect(await textAt('other', 'c.yaml')).toBe('c: main\n')
    expect(await git.currentBranch({ fs, dir: repo })).toBe('main')
  })

  it('base virtuelle : contient les deux ancêtres communs (éditeur de fusion)', async () => {
    await crissCross(['c.yaml', 'c: main\n'], ['c.yaml', 'c: other\n'])
    const [m, o] = await Promise.all([
      git.resolveRef({ fs, dir: repo, ref: 'main' }), git.resolveRef({ fs, dir: repo, ref: 'other' }),
    ])
    const base = await singleMergeBase(repo, m, o, AUTHOR)
    expect(base).toBeTruthy()
    const at = async (f: string) => Buffer.from((await git.readBlob({ fs, dir: repo, oid: base!, filepath: f })).blob).toString('utf8')
    expect(await at('a.yaml')).toBe('a: 1\n')
    expect(await at('b.yaml')).toBe('b: 1\n')
    expect(await at('c.yaml')).toBe('c: 0\n')
  })

  it('ancêtres en conflit entre eux : la base virtuelle garde leur version commune, le conflit remonte', async () => {
    // Les deux fusions croisées n'ont pas tranché a.yaml de la même façon.
    await write('a.yaml', 'a: 0\n')
    await commitAll('base')
    await git.branch({ fs, dir: repo, ref: 'other' })
    await write('a.yaml', 'a: main\n')
    const a1 = await commitAll('A1')
    await git.checkout({ fs, dir: repo, ref: 'other' })
    await write('a.yaml', 'a: other\n')
    const b1 = await commitAll('B1')
    // Résolutions divergentes, écrites à la main (commits à deux parents).
    const tree = async (content: string) => {
      const blob = await git.writeBlob({ fs, dir: repo, blob: Buffer.from(content) })
      return git.writeTree({ fs, dir: repo, tree: [{ mode: '100644', path: 'a.yaml', oid: blob, type: 'blob' }] })
    }
    await git.commit({ fs, dir: repo, author: AUTHOR, message: 'M1', tree: await tree('a: main\n'), parent: [a1, b1], ref: 'refs/heads/main' })
    await git.commit({ fs, dir: repo, author: AUTHOR, message: 'M2', tree: await tree('a: other\n'), parent: [b1, a1], ref: 'refs/heads/other' })
    await git.checkout({ fs, dir: repo, ref: 'main', force: true })

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
      const otherOid = await git.resolveRef({ fs, dir: repo, ref: 'other' })
      const before = await git.resolveRef({ fs, dir: repo, ref: 'main' })

      const session = await editor.open(repo, 'other', 'main', { kind: 'merge', from: 'other', into: 'main' })
      expect(session.files.map(f => f.path)).toEqual(['c.yaml'])

      await editor.saveFile(session.id, 'c.yaml', { state: 'merged', text: 'c: both\n' })
      const res = await editor.finalize(session.id)
      expect(res.ok).toBe(true)
      const head = await git.resolveRef({ fs, dir: repo, ref: 'main' })
      const { commit } = await git.readCommit({ fs, dir: repo, oid: head })
      expect(commit.parent).toEqual([before, otherOid])
      expect(await read('c.yaml')).toBe('c: both\n')
      expect(await read('d.yaml').catch(() => null)).toBeNull()
      expect(await textAt('main', 'b.yaml')).toBe('b: 1\n')
    } finally {
      await fsP.rm(userData, { recursive: true, force: true })
    }
  })
})
