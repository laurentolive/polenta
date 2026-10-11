import { describe, expect, it } from 'vitest'
import { printHost } from './app'
import { SessionStore } from './session'

/** GH44 S4 — impression headless : adresse interne et sessions d'impression. */
describe('printHost', () => {
  it('boucle locale quand le serveur écoute sur toutes les interfaces', () => {
    expect(printHost('0.0.0.0')).toBe('127.0.0.1')
    expect(printHost('::')).toBe('[::1]')
  })

  it("adresse d'écoute elle-même sinon (IPv6 entre crochets)", () => {
    expect(printHost('127.0.0.1')).toBe('127.0.0.1')
    expect(printHost('10.0.0.5')).toBe('10.0.0.5')
    expect(printHost('::1')).toBe('[::1]')
    expect(printHost('localhost')).toBe('localhost')
  })
})

describe("sessions d'impression", () => {
  const who = { login: 'alice', name: 'Alice', email: 'alice@example.org' }

  it("ne comptent pas comme une connexion (déconnexion pendant un rendu, vérification d'accès)", () => {
    const store = new SessionStore(60_000)
    const user = store.create(who)
    const print = store.createPrint({ ...who, name: 'impression' }, 60_000)
    expect(store.get(print.id)?.print).toBe(true)
    expect(store.hasLogin('alice')).toBe(true)
    store.destroy(user.id)
    // Seule reste la session d'impression : l'utilisateur est déconnecté (jetons oubliés).
    expect(store.hasLogin('alice')).toBe(false)
    expect(store.activeLogins()).toEqual([])
    expect(store.get(print.id)).not.toBeNull()
  })

  it('expirent à la fin de leur durée propre', () => {
    const store = new SessionStore(60_000)
    const print = store.createPrint(who, -1)
    expect(store.get(print.id)).toBeNull()
  })

  it("sont détruites avec les autres sessions de l'utilisateur à la révocation", () => {
    const store = new SessionStore(60_000)
    store.create(who)
    const print = store.createPrint(who, 60_000)
    expect(store.destroyLogin('alice')).toBe(2)
    expect(store.get(print.id)).toBeNull()
  })
})
