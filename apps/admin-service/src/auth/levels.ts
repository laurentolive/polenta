/**
 * GH63 — niveau de droit et portée (design §5.2, §6.3). Jeton de service d'une instance + propriétaire
 * revérifié = niveau « instance », limité à cette instance. Jeton de l'instance d'exploitation
 * (`ADMIN_INSTANCE`) = niveau « hôte ». `ADMIN_INSTANCE` vide : personne n'a le niveau hôte
 * (host.env.example) ; sur un hôte à instance unique, la désigner confond les deux niveaux.
 */
import type { AdminLevel } from '@polenta/types'

export function levelOf(originInstance: string, adminInstance: string): AdminLevel {
  return adminInstance !== '' && originInstance === adminInstance ? 'host' : 'instance'
}

export type ScopeCheck = { ok: true; target: string | null } | { ok: false; reason: string }

/**
 * Cible effective d'une opération : au niveau instance, l'instance d'origine (une autre cible est
 * refusée) ; au niveau hôte, celle demandée.
 */
export function scope(args: {
  level: AdminLevel
  originInstance: string
  opLevel: AdminLevel
  needsInstance: boolean
  requested?: string
}): ScopeCheck {
  if (args.opLevel === 'host' && args.level !== 'host') return { ok: false, reason: 'host-level-required' }
  if (!args.needsInstance) return { ok: true, target: null }
  if (args.level === 'instance') {
    if (args.requested && args.requested !== args.originInstance) return { ok: false, reason: 'out-of-scope' }
    return { ok: true, target: args.originInstance }
  }
  return { ok: true, target: args.requested ?? args.originInstance }
}
