import type { ForgeIdentity, ForgeKind } from '@polenta/types'

/**
 * GH45 — ce qui est propre à une forge (design §3.2). Sprint 2 : l'identité ; les fonctions P1
 * (repos, organisations, membres — sprint 4) s'y ajouteront. `generic` (git HTTPS sans API connue)
 * n'a pas de provider.
 */
export interface ForgeProvider {
  readonly kind: ForgeKind
  resolveIdentity(baseUrl: string, token: string): Promise<ForgeIdentity>
}
