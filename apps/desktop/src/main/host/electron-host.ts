import * as fs from 'fs'
import * as os from 'os'
import keytar from 'keytar'
import { app, shell } from 'electron'
import type { HostContext, TokenStore } from './host-context'
import { resolveMcpServerLaunchConfig } from './mcp-launch'
import { loadMachineConfig } from '../services/machine-config'
import { setNetworkTimeoutSeconds } from '../services/net-timeouts'
import { BRAND } from '../../shared/brand'

// GH49 — comptes séparés par marque ; Polenta garde 'polenta' (comptes existants retrouvés).
// GH45 S2b — POLENTA_KEYTAR_SERVICE : service dédié aux tests d'interface (les jetons personnels
// du poste ne sont jamais touchés). Non défini en usage normal.
const KEYTAR_SERVICE = process.env['POLENTA_KEYTAR_SERVICE'] || BRAND.id

/** Jetons dans le trousseau de l'OS (SPEC-ACCOUNTS-AUTH §1) — comportement d'avant GH44. */
export class KeytarTokenStore implements TokenStore {
  get(account: string): Promise<string | null> {
    return keytar.getPassword(KEYTAR_SERVICE, account)
  }
  set(account: string, token: string): Promise<void> {
    return keytar.setPassword(KEYTAR_SERVICE, account, token)
  }
  delete(account: string): Promise<boolean> {
    return keytar.deletePassword(KEYTAR_SERVICE, account)
  }
}

export function createElectronHostContext(): HostContext {
  return {
    userDataDir: app.getPath('userData'),
    tokenStore: new KeytarTokenStore(),
    openExternal: (url) => shell.openExternal(url),
    mcpServerLaunch: resolveMcpServerLaunchConfig,
    machineConfig: loadMachineConfig({
      platform: process.platform,
      env: process.env,
      readFile: (file) => {
        try {
          return fs.readFileSync(file, 'utf-8')
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw err
        }
      },
      warn: (message) => console.warn(message),
    }),
    deviceLabel: os.hostname(),
    applyNetworkTimeout: setNetworkTimeoutSeconds,
  }
}
