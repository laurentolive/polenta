/**
 * GH106 — message affichable d'un échec d'opération sur une branche, sans le préfixe de l'IPC
 * Electron (« Error invoking remote method '…': X: »). Les refus de la garde de la branche
 * d'intégration arrivent déjà traduits (`api.ts`).
 */
export function branchErrorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '')
}
