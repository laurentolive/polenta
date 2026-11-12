import { describe, expect, it } from 'vitest'
import {
  fitToDisplays, isRestorableRoute, isValidAppRoute, MAX_SAVED_WINDOWS, offsetPlacement, parseSavedWindows,
} from './window-placement'

const primary = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
const right = { workArea: { x: 1920, y: 0, width: 2560, height: 1400 } }

describe('GH342 offsetPlacement (F5)', () => {
  it('décale de +30/+30 à taille égale', () => {
    expect(offsetPlacement({ x: 100, y: 100, width: 1280, height: 800 }, [primary]))
      .toEqual({ x: 130, y: 130, width: 1280, height: 800 })
  })

  it('reste dans l’écran de la fenêtre d’origine près du bord', () => {
    const r = offsetPlacement({ x: 640, y: 240, width: 1280, height: 800 }, [primary, right])
    expect(r).toEqual({ x: 640, y: 240, width: 1280, height: 800 })
  })

  it('choisit l’écran qui contient le plus la fenêtre d’origine', () => {
    const r = offsetPlacement({ x: 2000, y: 50, width: 1280, height: 800 }, [primary, right])
    expect(r).toEqual({ x: 2030, y: 80, width: 1280, height: 800 })
  })
})

describe('GH342 fitToDisplays (R3, CA11)', () => {
  it('garde un placement entièrement visible, sur le second écran', () => {
    const p = { x: 2100, y: 100, width: 1280, height: 800, maximized: true }
    expect(fitToDisplays(p, [primary, right], primary)).toEqual(p)
  })

  it('recentre sur l’écran principal une fenêtre dont l’écran a disparu', () => {
    const p = { x: 2100, y: 100, width: 1280, height: 800 }
    expect(fitToDisplays(p, [primary], primary)).toEqual({ x: 320, y: 120, width: 1280, height: 800 })
  })

  it('réduit une fenêtre plus grande que l’écran principal', () => {
    const p = { x: 2100, y: 100, width: 2400, height: 1300, fullScreen: true }
    expect(fitToDisplays(p, [primary], primary)).toEqual({ x: 0, y: 0, width: 1920, height: 1040, fullScreen: true })
  })

  it('recentre une fenêtre à cheval sur deux écrans (pas entièrement dans l’un)', () => {
    const p = { x: 1800, y: 100, width: 800, height: 600 }
    expect(fitToDisplays(p, [primary, right], primary)).toEqual({ x: 560, y: 220, width: 800, height: 600 })
  })
})

describe('GH342 routes', () => {
  it('route interne valide', () => {
    expect(isValidAppRoute('/product?projectId=abc')).toBe(true)
    expect(isValidAppRoute('//evil.example/x')).toBe(false)
    expect(isValidAppRoute('https://evil.example')).toBe(false)
    expect(isValidAppRoute('/a\\b')).toBe(false)
    expect(isValidAppRoute('')).toBe(false)
    expect(isValidAppRoute('/' + 'a'.repeat(5000))).toBe(false)
    expect(isValidAppRoute(42)).toBe(false)
  })

  it('R7 — seules les pages d’un projet sont restaurées', () => {
    expect(isRestorableRoute('/product?projectId=abc&repo=x')).toBe(true)
    expect(isRestorableRoute('/')).toBe(false)
    expect(isRestorableRoute('/login')).toBe(false)
    expect(isRestorableRoute('/product?repo=x')).toBe(false)
  })
})

describe('GH342 parseSavedWindows (R6)', () => {
  it('fichier absent, vide ou invalide → aucune fenêtre', () => {
    expect(parseSavedWindows(undefined)).toEqual([])
    expect(parseSavedWindows({})).toEqual([])
    expect(parseSavedWindows({ windows: 'x' })).toEqual([])
    expect(parseSavedWindows('garbage')).toEqual([])
  })

  it('ignore les entrées partielles, garde les valides', () => {
    const windows = parseSavedWindows({
      version: 1,
      windows: [
        { x: 0, y: 0, width: 1280 },
        null,
        { x: 10.4, y: 20, width: 1000, height: 700, maximized: true, route: '/product?projectId=p' },
        { x: 5, y: 5, width: 50, height: 50, route: '/login', fullScreen: 'yes' },
      ],
    })
    expect(windows).toEqual([
      { x: 10, y: 20, width: 1000, height: 700, maximized: true, route: '/product?projectId=p' },
      { x: 5, y: 5, width: 400, height: 300 },
    ])
  })

  it('plafonne le nombre de fenêtres', () => {
    const many = Array.from({ length: 20 }, () => ({ x: 0, y: 0, width: 800, height: 600 }))
    expect(parseSavedWindows({ windows: many })).toHaveLength(MAX_SAVED_WINDOWS)
  })
})
