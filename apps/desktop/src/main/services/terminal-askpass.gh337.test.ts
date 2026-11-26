import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { IPty } from 'node-pty'
import { promisify } from 'util'
import { afterEach, describe, expect, it } from 'vitest'

import { activeAskpassTokens, askpassDir, closeAskpassServer, hostFromPrompt, hostFromRemoteUrl } from '../git/askpass'
import { gitFor } from '../git/git-backend'
import { gitInstall } from '../git/git-binary'
import { gitEnv } from '../git/git-config'
import { TerminalService, type TerminalDeps } from './terminal.service'
import { shellEnv, type ShellSpec } from './terminal-shell.util'

/**
 * GH337 sprint 5 — askpass côté terminal (design §6, spec §6 « Terminal »). Le pseudo-terminal est
 * remplacé par un faux (`spawnPty`) : on lit l'environnement que le shell reçoit, et on fait répondre
 * le vrai `askpass.js` (lancé comme git le ferait) au nonce de cette session.
 */

const execFileAsync = promisify(execFile)
const PAT = 'ghp_TERMINAL_PAT_must_never_reach_env_0123'
const ACCOUNT = { username: 'alice', password: PAT }

const REMOTE = 'https://forge.example/org/repo.git'
const tmpDirs: string[] = []

afterEach(async () => {
  await closeAskpassServer()
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

/** Dossier de départ du terminal : un dépôt dont `origin` vaut `remote` (ou un dossier sans dépôt). */
async function startDir(remote: string | null): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-askpass-'))
  tmpDirs.push(dir)
  if (remote !== null) {
    await gitFor(dir).init('main')
    await gitFor(dir).addRemote('origin', remote)
  }
  return dir
}

interface FakePty {
  pty: IPty
  /** Déclenche la fin du shell (fermeture de la session). */
  exit(code: number): void
}

function fakePty(): FakePty {
  const exits: Array<(e: { exitCode: number }) => void> = []
  const pty = {
    // PID inexistant : le repli `taskkill` de `kill()` ne peut toucher aucun processus réel.
    pid: 2147483000,
    onData: () => ({ dispose: () => undefined }),
    onExit: (cb: (e: { exitCode: number }) => void) => { exits.push(cb); return { dispose: () => undefined } },
    write: () => undefined,
    resize: () => undefined,
    kill: () => undefined,
  } as unknown as IPty
  return { pty, exit: code => exits.forEach(cb => cb({ exitCode: code })) }
}

const SHELL: ShellSpec = { name: 'Git Bash', file: process.execPath, args: [] }

/**
 * Démarre une session terminal avec un faux pty ; `env()` donne l'environnement passé au shell.
 * Par défaut, le terminal démarre dans un dépôt dont le remote est `REMOTE` (hôte `forge.example`).
 */
async function startTerminal(lookups: string[], account: typeof ACCOUNT | null = ACCOUNT, remote: string | null = REMOTE, cwd?: string) {
  const fake = fakePty()
  let env: Record<string, string> = {}
  const deps: TerminalDeps = {
    auth: {
      getHttpsCredentials: async (remote: string) => {
        lookups.push(remote)
        return account && remote === 'https://forge.example' ? account : null
      },
    },
    shell: () => SHELL,
    spawnPty: (_file, _args, opts) => {
      env = opts.env as Record<string, string>
      return fake.pty
    },
  }
  const service = new TerminalService(() => undefined, deps)
  const { id } = await service.start('shell', cwd ?? await startDir(remote), 80, 24, 1)
  return { service, id, fake, env: () => env }
}

/** Lance le shim `askpass.sh` comme le ferait `sh` de git, avec l'environnement reçu par le shell. */
async function askViaShim(env: Record<string, string>, prompt: string): Promise<string> {
  const { stdout } = await execFileAsync(shExe(), [path.join(askpassDir(), 'askpass.sh').replace(/\\/g, '/'), prompt], {
    env: { ...process.env, ...env },
    windowsHide: true,
  })
  return stdout.replace(/\r?\n$/, '')
}

/** `sh` de Git for Windows (celui qui exécute GIT_ASKPASS), ou `/bin/sh` ailleurs. */
function shExe(): string {
  if (process.platform !== 'win32') return '/bin/sh'
  const bash = gitInstall().bashExe
  if (!bash) throw new Error('Git Bash embarqué absent : lancer `pnpm git:fetch`')
  return path.join(path.dirname(bash), 'sh.exe')
}

describe('terminal — askpass de la session (GH337 §6)', () => {
  it('(1) l\'environnement du shell ne contient aucun PAT, seulement le nonce et les shims', async () => {
    const { env } = await startTerminal([])
    const shellEnvValues = Object.values(env())
    expect(shellEnvValues.some(v => v.includes(PAT))).toBe(false)
    expect(shellEnvValues.some(v => v === ACCOUNT.username)).toBe(false)
    expect(env().POLENTA_ASKPASS_NONCE).toMatch(/^[0-9a-f]{64}$/)
    expect(env().GIT_ASKPASS).toMatch(/^[^"]*askpass\.sh$/) // GH448 — jamais cité
    // Le shell reste interactif : pas de SSH_ASKPASS, et ELECTRON_RUN_AS_NODE n'est pas posé
    // pour le terminal (le shim le pose pour son seul processus).
    expect(env().SSH_ASKPASS).toBeUndefined()
    expect(env().ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('(1bis) shellEnv garde les variables askpass ajoutées et filtre le reste de POLENTA_/ELECTRON_', () => {
    const session = { POLENTA_ASKPASS_NONCE: 'n', GIT_ASKPASS: '/x/askpass.sh' }
    const out = shellEnv({ ...gitEnv({ terminal: true }), POLENTA_LEAK: 'x', ELECTRON_RUN_AS_NODE: '1' }, 'win32', session)
    expect(out.POLENTA_ASKPASS_NONCE).toBe('n')
    expect(out.GIT_ASKPASS).toBe('/x/askpass.sh')
    expect(out.POLENTA_LEAK).toBeUndefined()
    expect(out.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('(2) l\'hôte est extrait d\'une invite typique, sans port ni identifiant', () => {
    expect(hostFromPrompt("Password for 'https://alice@forge.example': ")).toBe('forge.example')
    expect(hostFromPrompt("Username for 'https://github.com': ")).toBe('github.com')
    expect(hostFromPrompt("Password for 'https://alice@forge.example:8443/': ")).toBe('forge.example')
    // Invites qui ne visent pas une URL web : pas d'hôte.
    expect(hostFromPrompt("Enter passphrase for key '/home/u/.ssh/id_ed25519': ")).toBeNull()
    expect(hostFromPrompt("Password for 'ssh://forge.example': ")).toBeNull()
    expect(hostFromPrompt('Enter passphrase: ')).toBeNull()
  })

  it('(2ter) l\'hôte d\'un remote est lu sans schéma, identifiant ni port ; chemin local : pas d\'hôte', () => {
    expect(hostFromRemoteUrl('https://alice@Forge.example:8443/org/repo.git')).toBe('forge.example')
    expect(hostFromRemoteUrl('ssh://git@forge.example:2222/org/repo.git')).toBe('forge.example')
    expect(hostFromRemoteUrl('git@forge.example:org/repo.git')).toBe('forge.example')
    expect(hostFromRemoteUrl('C:\\depots\\repo.git')).toBeNull()
    expect(hostFromRemoteUrl('/srv/git/repo.git')).toBeNull()
    expect(hostFromRemoteUrl('file:///srv/git/repo.git')).toBeNull()
  })

  it('(2bis) l\'invite du shim transmet l\'hôte lu et répond le compte connecté pour cet hôte', async () => {
    const lookups: string[] = []
    const { env } = await startTerminal(lookups)
    expect(await askViaShim(env(), "Username for 'https://alice@forge.example': ")).toBe('alice')
    expect(await askViaShim(env(), "Password for 'https://alice@forge.example': ")).toBe(PAT)
    expect(lookups).toEqual(['https://forge.example', 'https://forge.example'])
  })

  it('(3) une invite pour un hôte hors des remotes du dépôt reçoit une réponse vide, sans consulter le compte', async () => {
    const lookups: string[] = []
    const { env } = await startTerminal(lookups)
    expect(await askViaShim(env(), "Password for 'https://autre.example': ")).toBe('')
    expect(await askViaShim(env(), 'Enter passphrase for key \'/k\': ')).toBe('')
    expect(lookups).toEqual([])
  })

  it('(3bis) pas de compte connecté du tout : réponse vide', async () => {
    const { env } = await startTerminal([], null)
    expect(await askViaShim(env(), "Password for 'https://forge.example': ")).toBe('')
  })

  it('(3ter) dossier de départ sans dépôt : aucun identifiant, même pour l\'hôte d\'un compte connecté', async () => {
    const lookups: string[] = []
    const { env } = await startTerminal(lookups, ACCOUNT, null, await startDir(null))
    expect(await askViaShim(env(), "Password for 'https://forge.example': ")).toBe('')
    expect(await askViaShim(env(), "Username for 'https://forge.example': ")).toBe('')
    expect(lookups).toEqual([])
  })

  it('(3quater) dépôt avec plusieurs remotes : chaque hôte de remote est reconnu, un hôte absent des remotes non', async () => {
    const dir = await startDir(REMOTE)
    await gitFor(dir).addRemote('miroir', 'https://miroir.example/org/repo.git')
    const lookups: string[] = []
    const { env } = await startTerminal(lookups, ACCOUNT, null, dir)
    expect(await askViaShim(env(), "Password for 'https://autre.example': ")).toBe('')
    expect(await askViaShim(env(), "Password for 'https://forge.example': ")).toBe(PAT)
    // miroir.example est un remote du dépôt : consulté (pas de compte pour lui dans ce faux).
    expect(await askViaShim(env(), "Password for 'https://miroir.example': ")).toBe('')
    expect(lookups).toEqual(['https://forge.example', 'https://miroir.example'])
  })

  it('(3quinquies) remote avec identifiant et port dans l\'URL : son hôte est reconnu, sans port ni identifiant', async () => {
    const lookups: string[] = []
    const { env } = await startTerminal(lookups, ACCOUNT, 'https://alice@forge.example:8443/org/repo.git')
    expect(await askViaShim(env(), "Password for 'https://alice@forge.example:8443/': ")).toBe(PAT)
    expect(await askViaShim(env(), "Username for 'https://forge.example': ")).toBe('alice')
    expect(lookups).toEqual(['https://forge.example', 'https://forge.example'])
  })

  it('(3sexies) remote en forme scp (git@hôte:chemin) : l\'hôte est reconnu', async () => {
    const lookups: string[] = []
    const { env } = await startTerminal(lookups, ACCOUNT, 'git@forge.example:org/repo.git')
    expect(await askViaShim(env(), "Password for 'https://forge.example': ")).toBe(PAT)
    expect(lookups).toEqual(['https://forge.example'])
  })

  it('(4) le nonce est refusé après la fermeture de la session (fin du shell)', async () => {
    const { env, fake } = await startTerminal([])
    expect(await askViaShim(env(), "Password for 'https://forge.example': ")).toBe(PAT)
    expect(activeAskpassTokens()).toBe(1)
    fake.exit(0)
    expect(activeAskpassTokens()).toBe(0)
    expect(await askViaShim(env(), "Password for 'https://forge.example': ")).toBe('')
  })

  it('(4bis) le nonce est refusé dès la fermeture demandée par l\'utilisateur (kill)', async () => {
    const { env, service, id } = await startTerminal([])
    expect(await askViaShim(env(), "Password for 'https://forge.example': ")).toBe(PAT)
    service.kill(id)
    expect(activeAskpassTokens()).toBe(0)
    expect(await askViaShim(env(), "Password for 'https://forge.example': ")).toBe('')
  })

  it('le nonce d\'un terminal n\'est pas limité en nombre de réponses (durée bornée par la session)', async () => {
    const { env } = await startTerminal([])
    for (let i = 0; i < 8; i++) {
      expect(await askViaShim(env(), "Password for 'https://forge.example': ")).toBe(PAT)
    }
  })
})

describe('terminal — pas de nonce orphelin si le shell ne démarre pas', () => {
  it('un échec de lancement révoque le nonce ouvert pour la session', async () => {
    const service = new TerminalService(() => undefined, {
      shell: () => SHELL,
      spawnPty: () => { throw new Error('spawn impossible (test)') },
    })
    await expect(service.start('shell', os.tmpdir(), 80, 24, 1)).rejects.toThrow(/spawn impossible/)
    expect(activeAskpassTokens()).toBe(0)
  })
})
