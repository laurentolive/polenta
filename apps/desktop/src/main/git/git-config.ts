import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { gitInstall } from './git-binary'
import { ensurePrivateDir } from './private-dir'
import { GIT_IO_TIMEOUT_BASE_MS, scaledTimeout } from '../services/net-timeouts'

/**
 * GH337 — configuration isolée de git (spec §4.2, design §2.2).
 *
 * Tout processus git lancé par Polenta (et le terminal GH238) ignore la config système
 * (`GIT_CONFIG_NOSYSTEM`) et lit comme config globale un fichier propre à Polenta. Ni hooks, ni
 * signature, ni credential helper du poste : le comportement ne dépend pas de la machine.
 */

export interface GitIdentity { name: string; email: string }

interface GitHomeState {
  dir: string
  identity: GitIdentity | null
  /** Délai bas débit (s) appliqué aux transferts HTTP (GH15). */
  lowSpeedTimeSeconds: number
  written: boolean
}

const state: GitHomeState = {
  dir: path.join(os.tmpdir(), `polenta-git-${process.pid}`),
  identity: null,
  lowSpeedTimeSeconds: 300,
  written: false,
}

/** Dossier de la config git de Polenta (`<userData>/git` sur le desktop, `<dataDir>/git` côté web). */
export function configureGitHome(dir: string): void {
  if (state.dir !== dir) {
    state.dir = dir
    state.written = false
  }
}

/** Identité du compte actif, écrite dans la config globale de Polenta (terminal ; Polenta passe l'auteur à chaque commit). */
export function setGitIdentity(identity: GitIdentity | null): void {
  state.identity = identity
  state.written = false
}

/**
 * GH337 P3 — changement de compte actif : `[user]` de la config globale de Polenta suit le compte
 * (spec §2.2). `null` ou compte sans nom/courriel → pas de `[user]`. Écrit tout de suite.
 */
export function refreshGitIdentity(account: GitIdentity | null): void {
  setGitIdentity(account && account.name && account.email ? { name: account.name, email: account.email } : null)
  gitGlobalConfigPath()
}

export function setGitLowSpeedTime(seconds: number): void {
  state.lowSpeedTimeSeconds = Math.max(30, Math.round(seconds))
  state.written = false
}

/**
 * GH337 P3 — initialisation au démarrage : config globale dans `dir` (userData), identité du compte
 * actif (`activeAccount` : `null` ou compte sans nom/courriel → pas de `[user]`). Écrit la config tout de
 * suite. Le délai bas débit (GH15) passe par `applyNetworkTimeoutToGit`, appelé à chaque réglage.
 */
export async function initGitHome(dir: string, activeAccount: () => Promise<GitIdentity | null>): Promise<void> {
  configureGitHome(dir)
  const account = await activeAccount().catch(() => null)
  refreshGitIdentity(account && account.name && account.email ? { name: account.name, email: account.email } : null)
}

/** GH337 P3 — réglage GH15 → `http.lowSpeedTime` : délai git HTTP (300 s de base) mis à l'échelle. */
export function applyNetworkTimeoutToGit(): void {
  setGitLowSpeedTime(scaledTimeout(GIT_IO_TIMEOUT_BASE_MS) / 1000)
}

/** Ne pas laisser passer de retour ligne ni de guillemet dans un fichier de config git. */
function quote(value: string): string {
  return `"${value.replace(/[\r\n]/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function renderGitConfig(hooksDir: string, identity: GitIdentity | null, lowSpeedTime: number): string {
  const lines = [
    '# Polenta — configuration git isolée (GH337). Réécrite par l\'application : ne pas modifier.',
    '[core]',
    '\tautocrlf = false',
    '\tsafecrlf = false',
    '\tlongpaths = true',
    '\tfsmonitor = false',
    // Réglages Windows de la config système de Git for Windows, perdus avec GIT_CONFIG_NOSYSTEM :
    // cache du système de fichiers (statut, checkout) et pas de liens symboliques.
    '\tfscache = true',
    '\tsymlinks = false',
    '\tpreloadIndex = true',
    `\thooksPath = ${quote(hooksDir.replace(/\\/g, '/'))}`,
    '[credential]',
    '\thelper = ',
    '[commit]',
    '\tgpgSign = false',
    '[tag]',
    '\tgpgSign = false',
    '[init]',
    '\tdefaultBranch = main',
    // GH337 P9 — `directory = *` : pourquoi `*` : les dépôts créés par un autre compte Windows ou sur un
    // partage réseau doivent s'ouvrir (spec §2.2), et `gitFindRoot` découvre le dépôt avant de pouvoir le
    // lister, donc une liste par dépôt ne suffit pas. Risque (CVE-2022-24765) : git refuse normalement un
    // dépôt dont le propriétaire n'est pas l'utilisateur courant ; avec `*`, un dépôt d'un autre utilisateur
    // peut déclencher des commandes via sa config locale (core.fsmonitor, hooks…). Décision de l'humain
    // (2026-11-19) : gardé, risque documenté ; à restreindre si la décision change (specs/GH337-sprint4.md).
    '[safe]',
    '\tdirectory = *',
    '[http]',
    '\tlowSpeedLimit = 1',
    `\tlowSpeedTime = ${lowSpeedTime}`,
  ]
  if (identity) lines.push('[user]', `\tname = ${quote(identity.name)}`, `\temail = ${quote(identity.email)}`)
  return lines.join('\n') + '\n'
}

/**
 * GH337 P4 — dossier vide des hooks (`core.hooksPath`) : sous le dossier privé de Polenta, jamais dans un
 * dossier partagé de tmpdir. Sert à la config globale et aux commits/fusions de Polenta.
 */
export function gitHooksDir(): string {
  return path.join(ensurePrivateDir(state.dir), 'hooks')
}

/** Chemin de la config globale, écrite si besoin. */
export function gitGlobalConfigPath(): string {
  const file = path.join(ensurePrivateDir(state.dir), 'config')
  if (!state.written || !fs.existsSync(file)) {
    const hooksDir = gitHooksDir()
    fs.writeFileSync(file, renderGitConfig(hooksDir, state.identity, state.lowSpeedTimeSeconds), 'utf8')
    state.written = true
  }
  return file
}

/**
 * GH337 P3 — variable de TEST uniquement : chemin d'une config globale temporaire qui remplace le
 * `~/.gitconfig` du PC dans `pcGitIdentity()`. Le vrai fichier du développeur n'est jamais lu par les tests.
 */
export const PC_GITCONFIG_TEST_ENV = 'POLENTA_TEST_PC_GITCONFIG'

/**
 * GH337 P3 — identité globale du PC (`user.name` / `user.email` du fichier global réel, comme
 * `git config --global` sans isolation). Lue par un processus git ponctuel, avec les variables
 * `GIT_CONFIG_*` de Polenta retirées. `null` si l'une des deux manque ou si git est indisponible.
 * Repli après l'identité du dépôt et le compte actif (voir `getAuthor`, `gitUserName`, terminal).
 */
export async function pcGitIdentity(): Promise<GitIdentity | null> {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const k of Object.keys(env)) if (/^GIT_CONFIG/i.test(k)) delete env[k]
  const override = process.env[PC_GITCONFIG_TEST_ENV]
  if (override) env.GIT_CONFIG_GLOBAL = override
  const name = await gitGlobalValue('user.name', env)
  const email = await gitGlobalValue('user.email', env)
  return name && email ? { name, email } : null
}

function gitGlobalValue(key: string, env: NodeJS.ProcessEnv): Promise<string> {
  let exe: string
  try {
    exe = gitInstall().gitExe
  } catch {
    return Promise.resolve('')
  }
  return new Promise(resolve => {
    execFile(exe, ['config', '--global', '--get', key], { env, windowsHide: true, timeout: 10_000 }, (err, stdout) => {
      resolve(err ? '' : String(stdout).trim())
    })
  })
}

export interface GitEnvOptions {
  /** Terminal GH238 : locale et invites de l'utilisateur conservées. */
  terminal?: boolean
  /** Lecture seule : pas de verrou optionnel (`index.lock` du statut). */
  readOnly?: boolean
  /** Variables d'identification (askpass) de l'opération. */
  extra?: Record<string, string>
}

/** Protocoles autorisés : serveur web limité à HTTPS (garde des remotes, GH44). */
let allowedProtocols = 'https:http:ssh:file'
export function setAllowedGitProtocols(list: string): void {
  allowedProtocols = list
}

/** Environnement d'un processus git de Polenta, à partir de celui du processus courant. */
export function gitEnv(opts: GitEnvOptions = {}, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(base)) {
    if (/^GIT_/i.test(k) && !/^GIT_TRACE/i.test(k)) continue
    env[k] = v
  }
  const install = gitInstall()
  const pathKey = Object.keys(env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH'
  if (install.pathDirs.length) env[pathKey] = [...install.pathDirs, env[pathKey] ?? ''].filter(Boolean).join(path.delimiter)
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_CONFIG_GLOBAL = gitGlobalConfigPath()
  env.GIT_ALLOW_PROTOCOL = allowedProtocols
  if (!opts.terminal) {
    env.GIT_TERMINAL_PROMPT = '0'
    env.LC_ALL = 'C'
    env.LANGUAGE = 'C'
    env.GCM_INTERACTIVE = 'never'
    // Les chemins passés par Polenta sont des noms de fichiers, jamais des motifs : `a[1].yaml` ne doit
    // pas viser `a1.yaml` (add, restore, status, log…). Le terminal garde les pathspecs usuels.
    env.GIT_LITERAL_PATHSPECS = '1'
  }
  if (opts.readOnly) env.GIT_OPTIONAL_LOCKS = '0'
  if (opts.extra) Object.assign(env, opts.extra)
  return env
}
