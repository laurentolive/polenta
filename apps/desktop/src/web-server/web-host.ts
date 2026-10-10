import type { MachineConfig } from '@polenta/types'
import type { HostContext, TokenStore } from '../main/host/host-context'
import type { PlatformHost } from '../main/host/platform-host'
import type { PrintRenderer } from '../main/host/print-renderer'

/**
 * GH44 — jetons forge d'un utilisateur web : en mémoire uniquement (design D10), jamais persistés
 * ni renvoyés au navigateur. Alimenté à la connexion ; un redémarrage du serveur impose de se
 * reconnecter.
 */
export class MemoryTokenStore implements TokenStore {
  private readonly tokens = new Map<string, string>()
  async get(account: string): Promise<string | null> {
    return this.tokens.get(account) ?? null
  }
  async set(account: string, token: string): Promise<void> {
    this.tokens.set(account, token)
  }
  async delete(account: string): Promise<boolean> {
    return this.tokens.delete(account)
  }
  clear(): void {
    this.tokens.clear()
  }
}

/** Pas d'`openExternal` ni de `mcpServerLaunch` : sans objet côté serveur. */
export function createWebHostContext(userDataDir: string, tokenStore: TokenStore, machineConfig: MachineConfig): HostContext {
  return { userDataDir, tokenStore, machineConfig, deviceLabel: 'web' }
}

export function createWebPlatformHost(
  broadcast: (channel: string, ...args: unknown[]) => void,
  exportTemplateExamplesDir: string,
): PlatformHost {
  return { kind: 'web', broadcast, exportTemplateExamplesDir: () => exportTemplateExamplesDir }
}

/**
 * Sprint 2 : pas encore de rendu des routes `/print/*` côté serveur (Chromium headless : sprint 4).
 * L'export PDF échoue avec un message explicite ; les diagrammes d'un export par gabarit passent
 * par le repli texte prévu par GH34 (carte vide = « non rendu »).
 */
export const pendingPrintRenderer: PrintRenderer = {
  renderPdf: async () => {
    throw new Error('L’export PDF n’est pas encore disponible dans la version web.')
  },
  snapshotDrawios: async () => new Map(),
}
