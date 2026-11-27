import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ session: { defaultSession: { resolveProxy: async () => 'DIRECT' } } }))

import { gitCaConfigArgs } from './git-backend'

describe('GH53 — arguments git pour la CA de l\'entreprise', () => {
  it('T-G3 : URL https avec bundle → http.sslCAInfo=<bundle>', () => {
    expect(gitCaConfigArgs('https://forge.client.fr/org/depot.git', '/data/ca/git-ca-bundle.pem'))
      .toEqual(['-c', 'http.sslCAInfo=/data/ca/git-ca-bundle.pem'])
  })

  it('T-G4 : sans bundle, ou URL non https (http, ssh) → aucun argument', () => {
    expect(gitCaConfigArgs('https://forge.client.fr/org/depot.git', null)).toEqual([])
    expect(gitCaConfigArgs('http://forge.client.fr/org/depot.git', '/x.pem')).toEqual([])
    expect(gitCaConfigArgs('git@forge.client.fr:org/depot.git', '/x.pem')).toEqual([])
  })
})
