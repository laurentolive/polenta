import { afterEach, describe, expect, it } from 'vitest'

import { normalizeNetworkTimeout } from '../../shared/network-timeout'
import {
  CONNECT_TIMEOUT_BASE_MS, FORGE_TIMEOUT_BASE_MS, GIT_IO_TIMEOUT_BASE_MS,
  getNetworkTimeoutSeconds, scaledTimeout, setNetworkTimeoutSeconds,
} from './net-timeouts'

describe('GH15 — délai de connexion réseau', () => {
  afterEach(() => setNetworkTimeoutSeconds(10))

  it('normalisation : entier dans [10, 120], sinon 10', () => {
    for (const v of [undefined, null, '30', NaN, 5, 9, 121, 500, 12.5]) expect(normalizeNetworkTimeout(v)).toBe(10)
    for (const v of [10, 30, 120]) expect(normalizeNetworkTimeout(v)).toBe(v)
  })

  it('réglage par défaut : délais d\'origine', () => {
    expect(scaledTimeout(CONNECT_TIMEOUT_BASE_MS)).toBe(10_000)
    expect(scaledTimeout(FORGE_TIMEOUT_BASE_MS)).toBe(20_000)
    expect(scaledTimeout(GIT_IO_TIMEOUT_BASE_MS)).toBe(300_000)
  })

  it('réglage 30 s : facteur 3, pris en compte dès l\'appel suivant', () => {
    setNetworkTimeoutSeconds(30)
    expect(scaledTimeout(CONNECT_TIMEOUT_BASE_MS)).toBe(30_000)
    expect(scaledTimeout(FORGE_TIMEOUT_BASE_MS)).toBe(60_000)
    expect(scaledTimeout(GIT_IO_TIMEOUT_BASE_MS)).toBe(900_000)
  })

  it('valeur invalide → défaut', () => {
    setNetworkTimeoutSeconds(500)
    expect(getNetworkTimeoutSeconds()).toBe(10)
  })
})
