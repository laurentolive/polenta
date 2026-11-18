import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { gitInstall } from './git-binary'

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

export function setGitLowSpeedTime(seconds: number): void {
  state.lowSpeedTimeSeconds = Math.max(30, Math.round(seconds))
  state.written = false
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
    '[safe]',
    '\tdirectory = *',
    '[http]',
    '\tlowSpeedLimit = 1',
    `\tlowSpeedTime = ${lowSpeedTime}`,
  ]
  if (identity) lines.push('[user]', `\tname = ${quote(identity.name)}`, `\temail = ${quote(identity.email)}`)
  return lines.join('\n') + '\n'
}

/** Chemin de la config globale, écrite si besoin. */
export function gitGlobalConfigPath(): string {
  const file = path.join(state.dir, 'config')
  if (!state.written || !fs.existsSync(file)) {
    const hooksDir = path.join(state.dir, 'hooks')
    fs.mkdirSync(hooksDir, { recursive: true })
    fs.writeFileSync(file, renderGitConfig(hooksDir, state.identity, state.lowSpeedTimeSeconds), 'utf8')
    state.written = true
  }
  return file
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
