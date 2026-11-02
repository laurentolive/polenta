import { describe, expect, it } from 'vitest'
import { zoomShortcutAction } from './zoomShortcut'

const key = (key: string, code: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean } = { ctrl: true }) => ({
  key, code, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, altKey: !!mods.alt,
})

describe('GH237 — raccourcis de zoom (U4)', () => {
  it('zoomer', () => {
    expect(zoomShortcutAction(key('=', 'Equal'), false)).toBe('in')
    expect(zoomShortcutAction(key('+', 'Equal'), false)).toBe('in')
    expect(zoomShortcutAction(key('+', 'NumpadAdd'), false)).toBe('in')
  })

  it('dézoomer', () => {
    expect(zoomShortcutAction(key('-', 'Minus'), false)).toBe('out')
    expect(zoomShortcutAction(key('-', 'Digit6'), false)).toBe('out')   // AZERTY
    expect(zoomShortcutAction(key('-', 'NumpadSubtract'), false)).toBe('out')
  })

  it('revenir à 100 %', () => {
    expect(zoomShortcutAction(key('0', 'Digit0'), false)).toBe('reset')
    expect(zoomShortcutAction(key('0', 'Numpad0'), false)).toBe('reset')
    expect(zoomShortcutAction(key('à', 'Digit0'), false)).toBe('reset') // AZERTY sans Maj
  })

  it('autres combinaisons ignorées', () => {
    expect(zoomShortcutAction(key('=', 'Equal', {}), false)).toBeNull()
    expect(zoomShortcutAction(key('=', 'Equal', { ctrl: true, alt: true }), false)).toBeNull()
    expect(zoomShortcutAction(key('b', 'KeyB'), false)).toBeNull()
  })

  it('macOS : Cmd requis', () => {
    expect(zoomShortcutAction(key('=', 'Equal', { meta: true }), true)).toBe('in')
    expect(zoomShortcutAction(key('=', 'Equal'), true)).toBeNull()
  })
})
