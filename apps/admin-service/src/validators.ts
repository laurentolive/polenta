/**
 * GH63 — motifs stricts des paramètres (design §5.3) : aucun argv n'est construit à partir d'une
 * chaîne qui n'a pas passé l'un d'eux. Mêmes règles que les scripts du kit.
 */
import net from 'node:net'

export const INSTANCE_RE = /^[a-z0-9][a-z0-9-]{1,30}$/
export const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/
export const ORG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/
export const LOGIN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/
export const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/
// Version de forge épinglée : 11.0.3, 11, 1.22.6-rootless… jamais « latest ».
export const VERSION_RE = /^[0-9]+(\.[0-9]+){0,3}(-[A-Za-z0-9.]+)?$/
export const EMAIL_RE = /^[^\s@]{1,64}@[A-Za-z0-9.-]{1,190}$/
export const APP_NAME_RE = /^[\p{L}\p{N} ._'-]{1,60}$/u

export type Validator = (v: unknown) => boolean

const str = (re: RegExp): Validator => (v) => typeof v === 'string' && v.length <= 253 && re.test(v)

export const v = {
  instance: str(INSTANCE_RE),
  domain: str(DOMAIN_RE),
  org: str(ORG_RE),
  login: str(LOGIN_RE),
  tag: str(TAG_RE),
  version: ((x) => str(VERSION_RE)(x) && x !== 'latest') as Validator,
  email: str(EMAIL_RE),
  appName: str(APP_NAME_RE),
  ip: ((x) => typeof x === 'string' && net.isIP(x) !== 0) as Validator,
  bool: ((x) => typeof x === 'boolean') as Validator,
}
