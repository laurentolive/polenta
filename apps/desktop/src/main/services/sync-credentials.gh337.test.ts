import { describe, expect, it, vi } from 'vitest'

import type { AuthService } from './auth.service'
import { credentialsFor } from './sync.service'

/**
 * GH337 P2 — fuite du PAT vers un autre hôte : le résolveur d'une opération réseau ne répond avec les
 * identifiants du remote que si l'hôte de l'invite git est l'hôte du remote.
 */

const REMOTE = 'https://github.com/laurentolive/polenta.git'
const CREDS = { username: 'alice', password: 'ghp_secret' }

function authWith() {
  const getHttpsCredentials = vi.fn(async () => CREDS)
  return { auth: { getHttpsCredentials } as unknown as Pick<AuthService, 'getHttpsCredentials'>, getHttpsCredentials }
}

describe('GH337 P2 — credentialsFor limité à l\'hôte du remote', () => {
  it('invite pour un autre hôte : réponse vide, sans appeler getHttpsCredentials', async () => {
    const { auth, getHttpsCredentials } = authWith()
    const resolve = credentialsFor(auth, REMOTE)
    expect(await resolve("Username for 'https://evil.example'")).toBeNull()
    expect(await resolve("Password for 'https://alice@evil.example'")).toBeNull()
    expect(getHttpsCredentials).not.toHaveBeenCalled()
  })

  it('invite pour l\'hôte du remote : identifiants du remote', async () => {
    const { auth, getHttpsCredentials } = authWith()
    const resolve = credentialsFor(auth, REMOTE)
    expect(await resolve("Username for 'https://github.com'")).toEqual(CREDS)
    expect(await resolve("Password for 'https://alice@github.com'")).toEqual(CREDS)
    expect(getHttpsCredentials).toHaveBeenCalledWith(REMOTE)
  })

  it('invite sans hôte HTTP (passphrase SSH, invite inconnue) : réponse vide', async () => {
    const { auth, getHttpsCredentials } = authWith()
    const resolve = credentialsFor(auth, REMOTE)
    expect(await resolve("Enter passphrase for key '/home/x/.ssh/id_ed25519': ")).toBeNull()
    expect(getHttpsCredentials).not.toHaveBeenCalled()
  })

  it('remote absente : aucun identifiant', async () => {
    const { auth, getHttpsCredentials } = authWith()
    expect(await credentialsFor(auth, null)("Username for 'https://github.com'")).toBeNull()
    expect(getHttpsCredentials).not.toHaveBeenCalled()
  })
})
