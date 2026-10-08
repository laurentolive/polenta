export type Handler = (event: unknown, ...args: any[]) => unknown

/**
 * GH44 — cible d'enregistrement des handlers (`registerHandlers`), indépendante d'`ipcMain` : le
 * desktop enregistre dans `ipcMain` (`ipcMainRegistry`, desktop-only.handlers.ts), le serveur web
 * dans une table par utilisateur. Même signature que `ipcMain.handle` (premier argument =
 * événement, ignoré par les handlers partagés).
 */
export interface HandlerRegistry {
  handle(channel: string, fn: Handler): void
}
