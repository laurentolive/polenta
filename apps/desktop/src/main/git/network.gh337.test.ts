import { execFile, execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { promisify } from 'util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AuthService } from '../services/auth.service'
import { SyncService } from '../services/sync.service'
import { activeAskpassTokens, askpassDir, closeAskpassServer, openAskpassSession, type AskpassSession } from './askpass'
import { gitClone, gitFor, gitLsRemoteHeads } from './git-backend'
import { gitInstall } from './git-binary'

/**
 * GH337 sprint 3 — réseau du git natif (clone, ls-remote, fetch, pull ff, push, suppression de
 * branche), identifiants askpass (design §6) et routage SSH par le `ssh` embarqué (PATH en tête).
 * Les remotes sont des dépôts nus locaux (chemin, `file://`) : aucun serveur n'est requis.
 */

const execFileAsync = promisify(execFile)
const AUTHOR = { name: 'Testeur', email: 't@x' }

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-net-'))
})

afterEach(async () => {
  await closeAskpassServer()
  fs.rmSync(root, { recursive: true, force: true })
})

/** Dépôt nu vide (`git init --bare`, hors API : Polenta ne crée que des dépôts non nus). */
function bareRemote(name: string): string {
  const dir = path.join(root, name)
  execFileSync(gitInstall().gitExe, ['init', '--bare', '-q', '-b', 'main', dir])
  return dir
}

/** Dépôt de travail avec un premier commit `file` (contenu `content`), remote `origin` vers `remote`. */
async function workRepo(name: string, remote: string, file = 'a.txt', content = 'a\n'): Promise<string> {
  const dir = path.join(root, name)
  const g = gitFor(dir)
  await g.init('main')
  fs.writeFileSync(path.join(dir, file), content)
  await g.add([file])
  await g.commit({ message: `init ${name}`, author: AUTHOR })
  await g.addRemote('origin', remote)
  await g.push('origin', ['refs/heads/main:refs/heads/main'])
  return dir
}

function syncService(): SyncService {
  return new SyncService({
    getAuthor: async () => AUTHOR,
    getHttpsCredentials: async () => null,
    isAccessRevoked: () => false,
  } as unknown as AuthService)
}

/** Lance le shim askpass comme git le ferait, avec l'environnement de la session seulement. */
async function ask(session: AskpassSession, prompt: string): Promise<string> {
  const { stdout } = await execFileAsync(process.execPath, [path.join(askpassDir(), 'askpass.js'), prompt], {
    // Environnement du poste (Node a besoin de SystemRoot sous Windows) + celui de la session.
    env: { ...process.env, ...session.env },
  })
  return stdout.replace(/\r?\n$/, '')
}

describe('réseau — clone, ls-remote, fetch, pull, push', () => {
  it('clone file:// : progression lue sur stderr, branche courante, branches distantes', async () => {
    const remote = bareRemote('remote.git')
    await workRepo('w', remote)
    const lines: string[] = []
    const dest = path.join(root, 'clone')
    // file:// passe par le transport pack (comme https) : git y affiche la progression.
    const url = pathToFileURL(remote).href
    await gitClone(url, dest, { onProgress: l => lines.push(l) })
    expect(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8')).toBe('a\n')
    expect(await gitFor(dest).currentBranch()).toBe('main')
    expect(await gitLsRemoteHeads(url)).toEqual(['main'])
    expect(lines.some(l => /Receiving objects:\s+\d+%/.test(l))).toBe(true)
  })

  it('fetch puis pull en avance rapide : la branche courante suit le remote', async () => {
    const remote = bareRemote('remote.git')
    const w = await workRepo('w', remote)
    const c = path.join(root, 'c')
    await gitClone(remote, c)

    fs.writeFileSync(path.join(w, 'a.txt'), 'a2\n')
    await gitFor(w).add(['a.txt'])
    const tip = await gitFor(w).commit({ message: 'a2', author: AUTHOR })
    await gitFor(w).push('origin', ['refs/heads/main:refs/heads/main'])

    await syncService().pullFastForwardOnly(c)
    expect(await gitFor(c).resolve('HEAD')).toBe(tip)
    expect(fs.readFileSync(path.join(c, 'a.txt'), 'utf8')).toBe('a2\n')
  })

  it('pull en avance rapide refuse une branche divergente sans rien écrire', async () => {
    const remote = bareRemote('remote.git')
    const w = await workRepo('w', remote)
    const c = path.join(root, 'c')
    await gitClone(remote, c)
    fs.writeFileSync(path.join(c, 'local.txt'), 'l\n')
    await gitFor(c).add(['local.txt'])
    const localTip = await gitFor(c).commit({ message: 'local', author: AUTHOR })
    fs.writeFileSync(path.join(w, 'a.txt'), 'remote\n')
    await gitFor(w).add(['a.txt'])
    await gitFor(w).commit({ message: 'remote', author: AUTHOR })
    await gitFor(w).push('origin', ['refs/heads/main:refs/heads/main'])

    await expect(syncService().pullFastForwardOnly(c)).rejects.toMatchObject({ kind: 'non-fast-forward' })
    expect(await gitFor(c).resolve('HEAD')).toBe(localTip)
  })

  it('push de la branche courante, puis push et suppression d\'une branche distante', async () => {
    const remote = bareRemote('remote.git')
    await workRepo('w', remote)
    const c = path.join(root, 'c')
    await gitClone(remote, c)
    const sync = syncService()

    fs.writeFileSync(path.join(c, 'b.txt'), 'b\n')
    await gitFor(c).add(['b.txt'])
    const tip = await gitFor(c).commit({ message: 'b', author: AUTHOR })
    await sync.push(c)
    expect(await gitFor(remote).resolve('refs/heads/main')).toBe(tip)

    await gitFor(c).createBranch('feature', 'HEAD')
    await sync.pushBranch(c, 'feature')
    expect(await gitLsRemoteHeads(remote)).toEqual(['feature', 'main'])
    await sync.deleteRemoteBranch(c, 'feature')
    expect(await gitLsRemoteHeads(remote)).toEqual(['main'])
  })

  it('fetch d\'une remote non configurée : repli sur l\'URL déclarée, branches sous <remote>/*', async () => {
    const remote = bareRemote('remote.git')
    await workRepo('w', remote)
    const c = path.join(root, 'c')
    fs.mkdirSync(c)
    await gitFor(c).init('main')
    await syncService().fetch(c, remote, 'origin')
    expect(await gitFor(c).resolve('refs/remotes/origin/main')).toBe(await gitFor(remote).resolve('refs/heads/main'))
  })
})

describe('askpass — identifiants hors de l\'environnement de git (design §6)', () => {
  it('répond username puis password, sans que l\'identifiant entre dans l\'environnement', async () => {
    const session = await openAskpassSession(async () => ({ username: 'alice', password: 's3cret-pat-value' }))
    try {
      expect(await ask(session, "Username for 'https://forge.example': ")).toBe('alice')
      expect(await ask(session, "Password for 'https://alice@forge.example': ")).toBe('s3cret-pat-value')
      // L'environnement transmis à git ne contient ni le mot de passe ni le login.
      expect(Object.values(session.env).some(v => v.includes('s3cret-pat-value') || v === 'alice')).toBe(false)
      // Invite inconnue : réponse vide.
      expect(await ask(session, 'Enter passphrase: ')).toBe('')
    } finally {
      session.revoke()
    }
  })

  it('un jeton révoqué ne répond plus rien', async () => {
    const session = await openAskpassSession(async () => ({ username: 'bob', password: 'pw' }))
    expect(await ask(session, "Password for 'https://h': ")).toBe('pw')
    session.revoke()
    expect(await ask(session, "Password for 'https://h': ")).toBe('')
    expect(activeAskpassTokens()).toBe(0)
  })

  it('pas d\'identifiant connu : réponse vide, git échouera en auth', async () => {
    const session = await openAskpassSession(async () => null)
    try {
      expect(await ask(session, "Username for 'https://h': ")).toBe('')
    } finally {
      session.revoke()
    }
  })

  it('une opération réseau sans identifiants ne laisse aucun jeton ouvert', async () => {
    const remote = bareRemote('remote.git')
    await workRepo('w', remote)
    const c = path.join(root, 'c')
    await gitClone(remote, c)
    await gitFor(c).fetch('origin')
    expect(activeAskpassTokens()).toBe(0)
  })
})

describe('SSH — le ssh embarqué est celui qui sert au remote ssh://', () => {
  it('ls-remote ssh:// lance le ssh du dossier embarqué (PATH en tête), sans invite', async () => {
    // Pas de sshd ici : le ssh embarqué échoue à la résolution DNS de l'hôte fictif. Son message
    // prouve qu'il a été lancé ; `pathDirs` contient le dossier de Git for Windows qui le porte.
    const err = await gitLsRemoteHeads('ssh://ssh-test.invalid/repo.git').then(() => null, (e: unknown) => e)
    expect(err).toBeTruthy()
    expect((err as { stderr: string }).stderr).toMatch(/ssh-test\.invalid|Could not resolve hostname/i)
    expect(gitInstall().pathDirs.length).toBeGreaterThan(0)
  })
})
