import { describe, expect, it } from 'vitest'
import { consumeStartupJump, initStartupJump } from './startupJump'

describe('GH343 — saut vers le dernier projet au lancement', () => {
  it('T1 — permis : vrai une seule fois', () => {
    initStartupJump(true)
    expect(consumeStartupJump()).toBe(true)
    expect(consumeStartupJump()).toBe(false)
  })

  it('T1 — non permis : toujours faux', () => {
    initStartupJump(false)
    expect(consumeStartupJump()).toBe(false)
    expect(consumeStartupJump()).toBe(false)
  })
})
