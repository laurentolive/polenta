import { describe, expect, it } from 'vitest'
import { emptyHistory, GROUP_MS, historyKey, record, redo, undo } from './outputHistory'

describe('GH222 — historique de la sortie', () => {
  it('undo / redo walk back and forth through the recorded steps', () => {
    let h = record(emptyHistory(), 'a', undefined, 0)
    h = record(h, 'b', undefined, 10)
    const u1 = undo(h, 'c')!
    expect(u1.text).toBe('b')
    const u2 = undo(u1.history, u1.text)!
    expect(u2.text).toBe('a')
    expect(undo(u2.history, u2.text)).toBeNull()
    const r1 = redo(u2.history, u2.text)!
    expect(r1.text).toBe('b')
    expect(redo(r1.history, r1.text)!.text).toBe('c')
  })

  it('a new step after an undo clears what could be redone', () => {
    const h = record(emptyHistory(), 'a', undefined, 0)
    const u = undo(h, 'b')!
    expect(redo(record(u.history, 'a', undefined, 5), 'x')).toBeNull()
  })

  it('typing in the same group within GROUP_MS is one step; a choice is always its own step', () => {
    let h = record(emptyHistory(), 'a', 'type', 0)
    h = record(h, 'ab', 'type', 100)
    h = record(h, 'abc', 'type', 200)
    expect(h.past).toEqual(['a'])
    h = record(h, 'abcd', 'type', 200 + GROUP_MS)
    expect(h.past).toEqual(['a', 'abcd'])
    h = record(h, 'x', undefined, 200 + GROUP_MS + 1)
    h = record(h, 'y', undefined, 200 + GROUP_MS + 2)
    expect(h.past).toHaveLength(4)
  })

  it('after an undo, typing starts a new step', () => {
    const h = record(emptyHistory(), 'a', 'type', 0)
    const u = undo(h, 'ab')!
    expect(record(u.history, 'a', 'type', 10).past).toEqual(['a'])
  })

  it('recognizes Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z and ⌘Z', () => {
    const k = (key: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
      historyKey({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o })
    expect(k('z', { ctrlKey: true })).toBe('undo')
    expect(k('Z', { ctrlKey: true, shiftKey: true })).toBe('redo')
    expect(k('y', { ctrlKey: true })).toBe('redo')
    expect(k('z', { metaKey: true })).toBe('undo')
    expect(k('z')).toBeNull()
    expect(k('z', { ctrlKey: true, altKey: true })).toBeNull()
  })
})
