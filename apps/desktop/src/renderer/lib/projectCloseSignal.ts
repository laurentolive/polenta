/**
 * T105 — in-memory (not disk-backed) signal that a project close was just requested
 * deliberately (ProjectPanel's croix "Fermer le projet", or the "Ouvrir un projet…" /
 * "Fermer le projet" menu items).
 *
 * `HomePage` normally re-derives "is a project open?" by reading `workspace:get-last-opened`
 * off disk when it mounts on "/". That read races the `workspace:clear-last-opened` write the
 * close action had just issued — both are separate IPC round trips, and while each individual
 * one resolves in order on its own, nothing stops `HomePage`'s read from landing before the
 * clear's write has actually been observed by a fresh read (seen in practice under `pnpm dev`
 * with repeated/rapid clicks, where every failed attempt restarts the whole chain: `HomePage`
 * still saw the pre-clear value and redirected straight back into the project the user had just
 * closed). A plain module-level flag sidesteps the disk round trip entirely for this one case —
 * it's set synchronously right before navigating, and consumed (read + reset) by `HomePage`
 * before it ever asks the disk, so the close is honored deterministically on the first click.
 */
let justClosed = false

export function markProjectJustClosed(): void {
  justClosed = true
}

export function consumeProjectJustClosed(): boolean {
  const value = justClosed
  justClosed = false
  return value
}
