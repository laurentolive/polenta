import { describe, expect, it } from 'vitest'
import { encodeForgeAccessError, parseForgeAccessError } from '@polenta/types'

import { ForgeAccessError, httpStatusOf, isNonGitResponse, isPushDeclined, revokedError, writeDeniedError } from './forge-access'
import { ForgeHttpError } from './forge-http'

describe('marqueur d’erreur d’accès', () => {
  it('aller-retour, y compris derrière le préfixe de l’IPC Electron', () => {
    const encoded = encodeForgeAccessError({ status: 403, host: 'acme.forge.example.fr', repo: 'acme/essai' }, 'Pas le droit.')
    const ipc = `Error invoking remote method 'sync:push': Error: ${encoded}`
    expect(parseForgeAccessError(ipc)).toEqual({
      issue: { status: 403, host: 'acme.forge.example.fr', repo: 'acme/essai' },
      humanMessage: 'Pas le droit.',
    })
  })

  it('message ordinaire, marqueur tronqué ou contenu invalide → null', () => {
    expect(parseForgeAccessError('fetch failed')).toBeNull()
    expect(parseForgeAccessError('⟦forge-access {"status":401')).toBeNull()
    expect(parseForgeAccessError('⟦forge-access {"status":500,"host":"x"}⟧ x')).toBeNull()
    expect(parseForgeAccessError('⟦forge-access pas du json⟧ x')).toBeNull()
  })

  it('ForgeAccessError porte le marqueur dans message, et le texte lisible à part', () => {
    const err = revokedError('acme.forge.example.fr')
    expect(err).toBeInstanceOf(ForgeAccessError)
    expect(parseForgeAccessError(err.message)?.issue).toEqual({ status: 401, host: 'acme.forge.example.fr' })
    expect(parseForgeAccessError(err.message)?.humanMessage).toBe(err.humanMessage)
    expect(writeDeniedError('h', 'acme/essai').humanMessage).toMatch(/acme\/essai/)
  })
})

describe('httpStatusOf', () => {
  it('isomorphic-git HttpError, git natif, ForgeHttpError', () => {
    expect(httpStatusOf({ code: 'HttpError', data: { statusCode: 401 } })).toBe(401)
    expect(httpStatusOf(new Error("fatal: unable to access 'https://h/r.git/': The requested URL returned error: 403"))).toBe(403)
    expect(httpStatusOf({ message: 'x', stderr: "fatal: Authentication failed for 'https://h/r.git/'" })).toBe(401)
    expect(httpStatusOf(new ForgeHttpError(404, '', 'GET u', 'text/plain'))).toBe(404)
    expect(httpStatusOf(revokedError('h'))).toBe(401)
  })

  it('compte désactivé côté git (HTTP 200 + page HTML) : aucun statut → sonde API (§12)', () => {
    expect(httpStatusOf(new Error("Remote did not reply using the \"smart\" HTTP protocol. Expected \"001e# service=git-upload-pack\" but received \"<!DOCTYPE html>\"")))
      .toBeNull()
    expect(httpStatusOf(null)).toBeNull()
  })
})

describe('isPushDeclined (mesuré sur Forgejo 15 / Gitea 28 avec un lecteur)', () => {
  it('GitPushError isomorphic-git « pre-receive hook declined » → refus de droits', () => {
    const err = Object.assign(new Error('One or more branches were not updated: \n  - refs/heads/main: pre-receive hook declined'), {
      code: 'GitPushError', data: { prettyDetails: '  - refs/heads/main: pre-receive hook declined' },
    })
    expect(isPushDeclined(err)).toBe(true)
    expect(isPushDeclined({ stderr: ' ! [remote rejected] main -> main (protected branch hook declined)' })).toBe(true)
  })

  it('réponse non-git (compte désactivé) détectée ; rejet non fast-forward : ni sonde ni refus de droits', () => {
    expect(isNonGitResponse(Object.assign(new Error('Remote did not reply using the "smart" HTTP protocol.'), { code: 'SmartHttpError' }))).toBe(true)
    expect(isNonGitResponse({ stderr: "fatal: https://h/r.git/info/refs not valid: could not determine hash algorithm; is this a git repository?" })).toBe(true)
    expect(isNonGitResponse(new Error('Push rejected because it was not a simple fast-forward.'))).toBe(false)
  })

  it('rejet non fast-forward ou erreur réseau : pas un refus de droits', () => {
    expect(isPushDeclined(new Error('Push rejected because it was not a simple fast-forward. Use "force: true" to override.'))).toBe(false)
    expect(isPushDeclined(new Error('fetch failed'))).toBe(false)
    expect(isPushDeclined(null)).toBe(false)
  })
})
