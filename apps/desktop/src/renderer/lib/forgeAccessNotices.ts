import type { ForgeAccessIssue } from '@polenta/types'

/**
 * GH45 — erreurs d'accès à une forge remontées par n'importe quel appel au process main (intercepté
 * dans renderer/api.ts). Une bannière unique (ForgeAccessBanner) s'abonne : un même accès révoqué ne
 * produit qu'une notification par hôte jusqu'à la reconnexion (`clear`), même si l'auto-pull, Publier
 * et le chargement du workspace échouent tous.
 */
type Listener = (issues: ForgeAccessIssue[]) => void

let issues: ForgeAccessIssue[] = []
const listeners = new Set<Listener>()

function emit(): void {
  for (const l of listeners) l(issues)
}

export const forgeAccessNotices = {
  report(issue: ForgeAccessIssue): void {
    // 403 (droits d'écriture) : déjà affiché par l'appelant (Publier), pas de bannière globale.
    if (issue.status !== 401) return
    if (issues.some(i => i.host === issue.host)) return
    issues = [...issues, issue]
    emit()
  },
  clear(host: string): void {
    if (!issues.some(i => i.host === host)) return
    issues = issues.filter(i => i.host !== host)
    emit()
  },
  current(): ForgeAccessIssue[] {
    return issues
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
}
