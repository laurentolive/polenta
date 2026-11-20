import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { configureGitHome, gitGlobalConfigPath, PC_GITCONFIG_TEST_ENV, pcGitIdentity, refreshGitIdentity } from './git-config'

/**
 * GH337 P3 — identité Git : `[user]` de la config globale de Polenta suit le compte actif, et l'identité
 * globale du PC sert de repli. Le vrai `~/.gitconfig` du développeur n'est jamais lu : la variable de test
 * `POLENTA_TEST_PC_GITCONFIG` pointe vers un fichier temporaire.
 */

let dir: string
let prevPcConfig: string | undefined

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-gitid-'))
  configureGitHome(path.join(dir, 'git'))
  prevPcConfig = process.env[PC_GITCONFIG_TEST_ENV]
})

afterEach(() => {
  if (prevPcConfig === undefined) delete process.env[PC_GITCONFIG_TEST_ENV]
  else process.env[PC_GITCONFIG_TEST_ENV] = prevPcConfig
  fs.rmSync(dir, { recursive: true, force: true })
})

const globalConfig = (): string => fs.readFileSync(gitGlobalConfigPath(), 'utf8')

describe('identité du compte actif dans la config globale de Polenta', () => {
  it('après un changement de compte, [user] correspond au nouveau compte', () => {
    refreshGitIdentity({ name: 'Bob Martin', email: 'bob@acme.fr' })
    expect(globalConfig()).toContain('[user]')
    expect(globalConfig()).toContain('\tname = "Bob Martin"')
    expect(globalConfig()).toContain('\temail = "bob@acme.fr"')

    refreshGitIdentity({ name: 'Octo', email: 'o@x' })
    expect(globalConfig()).toContain('\tname = "Octo"')
    expect(globalConfig()).not.toContain('Bob Martin')
  })

  it('sans compte, pas de [user] dans la config globale de Polenta', () => {
    refreshGitIdentity({ name: 'Octo', email: 'o@x' })
    refreshGitIdentity(null)
    expect(globalConfig()).not.toContain('[user]')
  })
})

describe('identité globale du PC (pcGitIdentity)', () => {
  it('lit user.name et user.email de la config globale désignée par la variable de test', async () => {
    const file = path.join(dir, 'pc.gitconfig')
    fs.writeFileSync(file, '[user]\n\tname = PC Name\n\temail = pc@example.test\n', 'utf8')
    process.env[PC_GITCONFIG_TEST_ENV] = file
    expect(await pcGitIdentity()).toEqual({ name: 'PC Name', email: 'pc@example.test' })
  })

  it('config globale sans [user] : null (pas d’identité PC)', async () => {
    const file = path.join(dir, 'pc.gitconfig')
    fs.writeFileSync(file, '[core]\n\tautocrlf = false\n', 'utf8')
    process.env[PC_GITCONFIG_TEST_ENV] = file
    expect(await pcGitIdentity()).toBeNull()
  })

  it('nom sans courriel : null', async () => {
    const file = path.join(dir, 'pc.gitconfig')
    fs.writeFileSync(file, '[user]\n\tname = PC Name\n', 'utf8')
    process.env[PC_GITCONFIG_TEST_ENV] = file
    expect(await pcGitIdentity()).toBeNull()
  })
})
