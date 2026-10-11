import * as path from 'path'
import type { MachineConfig } from '@polenta/types'
import { BRAND } from '../../shared/brand'

/**
 * GH45 — configuration « machine » déployée par la DSI (GPO, télédistribution), lue une fois au
 * démarrage du desktop (spec §3). Fichier absent, illisible ou invalide : comportement par défaut,
 * jamais d'exception — l'application doit toujours démarrer.
 */

export const DEFAULT_MACHINE_CONFIG: MachineConfig = { hideGithub: false }

export interface MachineConfigSource {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  /** Contenu du fichier, `null` s'il n'existe pas (toute autre erreur de lecture : levée). */
  readFile: (file: string) => string | null
  warn: (message: string) => void
}

// GH49 — un dossier par marque (Polenta : « Polenta » / « polenta », chemins inchangés).
export function machineConfigPath(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  if (env['POLENTA_CONFIG']) return env['POLENTA_CONFIG']
  switch (platform) {
    case 'win32': return path.win32.join(env['ProgramData'] ?? 'C:\\ProgramData', BRAND.productName, 'config.json')
    case 'darwin': return `/Library/Application Support/${BRAND.productName}/config.json`
    default: return `/etc/${BRAND.id}/config.json`
  }
}

function httpUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

export function loadMachineConfig(src: MachineConfigSource): MachineConfig {
  const file = machineConfigPath(src.platform, src.env)
  let raw: string | null
  try {
    raw = src.readFile(file)
  } catch (err) {
    src.warn(`[machine-config] lecture impossible de ${file} : ${err instanceof Error ? err.message : String(err)}`)
    return { ...DEFAULT_MACHINE_CONFIG }
  }
  if (raw === null) return { ...DEFAULT_MACHINE_CONFIG }
  return parseMachineConfig(raw, file, src.warn)
}

/** Validation clé par clé : une clé inconnue ou invalide est ignorée et signalée. */
export function parseMachineConfig(raw: string, file: string, warn: (message: string) => void): MachineConfig {
  let json: unknown
  try {
    json = JSON.parse(raw.replace(/^\uFEFF/, ''))   // BOM éventuel (fichier écrit par PowerShell 5.1)
  } catch (err) {
    warn(`[machine-config] ${file} ignoré : JSON invalide (${err instanceof Error ? err.message : String(err)})`)
    return { ...DEFAULT_MACHINE_CONFIG }
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    warn(`[machine-config] ${file} ignoré : un objet JSON est attendu`)
    return { ...DEFAULT_MACHINE_CONFIG }
  }
  const config: MachineConfig = { ...DEFAULT_MACHINE_CONFIG }
  for (const [key, value] of Object.entries(json)) {
    switch (key) {
      case 'defaultServer': {
        const url = httpUrl(value)
        if (url) config.defaultServer = `${url.protocol}//${url.host}`
        else warn(`[machine-config] defaultServer ignoré : URL http(s) attendue`)
        break
      }
      case 'demoProjectUrl': {
        const url = httpUrl(value)
        if (url) config.demoProjectUrl = url.toString()
        else warn(`[machine-config] demoProjectUrl ignoré : URL http(s) attendue`)
        break
      }
      case 'hideGithub':
        if (typeof value === 'boolean') config.hideGithub = value
        else warn(`[machine-config] hideGithub ignoré : booléen attendu`)
        break
      case 'autoUpdate':
        if (value === false) config.autoUpdate = false
        else if (value !== true) warn(`[machine-config] autoUpdate ignoré : seul false a un effet`)
        break
      default:
        warn(`[machine-config] clé inconnue ignorée : ${key}`)
    }
  }
  return config
}
