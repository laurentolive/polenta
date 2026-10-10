import * as fs from 'fs'
import * as os from 'os'
import keytar from 'keytar'
import { app, shell } from 'electron'
import type { HostContext, TokenStore } from './host-context'
import { resolveMcpServerLaunchConfig } from './mcp-launch'
import { loadMachineConfig } from '../services/machine-config'

const KEYTAR_SERVICE = 'polenta'

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
  }
}
