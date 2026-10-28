import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { registerPrefHandlers } from '../ipc/pref.handlers'

// GH133 (Q2) — choix « Fusionner dans <intégration> » mémorisé par branche dans le `.pref`.

type Handler = (e: unknown, ...args: unknown[]) => unknown

let repo: string
const handlers = new Map<string, Handler>()
registerPrefHandlers({ handle: (ch: string, fn: Handler) => { handlers.set(ch, fn) } } as never)

const get = (branch: string) => handlers.get('pref:get-publish-merge')!(null, repo, 'bob', branch)
const set = (branch: string, merge: unknown) => handlers.get('pref:set-publish-merge')!(null, repo, 'bob', branch, merge)

beforeEach(async () => { repo = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-gh133-')) })
afterEach(async () => { await fsP.rm(repo, { recursive: true, force: true }) })

it('8 — mémorisé par branche ; une branche jamais publiée : null', () => {
  expect(get('toolTest')).toBeNull()
  set('toolTest', false)
  set('autre', true)
  expect(get('toolTest')).toBe(false)
  expect(get('autre')).toBe(true)
  expect(get('jamais')).toBeNull()
})

it('refuse une valeur non booléenne', () => {
  expect(() => set('toolTest', 'non')).toThrow()
})
