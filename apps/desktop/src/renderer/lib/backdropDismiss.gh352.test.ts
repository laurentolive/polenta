import { describe, it, expect, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { backdropDismiss } from './backdropDismiss'

// GH352 — une popup ne se ferme que si l'appui ET le relâchement ont lieu sur son fond.

const backdrop = { id: 'backdrop' }
const input = { id: 'input' }

function ev(target: object) {
  return { target, currentTarget: backdrop, stopPropagation: vi.fn() } as unknown as ReactMouseEvent
}

/** Rejoue un geste : appui sur `down`, relâchement sur `up`, puis le clic que le navigateur
 *  envoie à l'ancêtre commun des deux cibles (le fond dès que l'une d'elles est le fond). */
function gesture(props: ReturnType<typeof backdropDismiss>, down: object, up: object) {
  props.onMouseDown(ev(down))
  props.onMouseUp(ev(up))
  const clickTarget = down === up ? down : backdrop
  const click = ev(clickTarget)
  props.onClick(click)
  return click
}

describe('GH352 — backdropDismiss', () => {
  it('ferme sur un clic franc sur le fond', () => {
    const close = vi.fn()
    gesture(backdropDismiss(close), backdrop, backdrop)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('ne ferme pas quand une sélection commencée dans la popup se termine sur le fond', () => {
    const close = vi.fn()
    gesture(backdropDismiss(close), input, backdrop)
    expect(close).not.toHaveBeenCalled()
  })

  it('ne ferme pas quand l’appui sur le fond se termine dans la popup', () => {
    const close = vi.fn()
    gesture(backdropDismiss(close), backdrop, input)
    expect(close).not.toHaveBeenCalled()
  })

  it('un geste ignoré ne contamine pas le clic suivant', () => {
    const close = vi.fn()
    gesture(backdropDismiss(close), input, backdrop)
    // nouvelles props à chaque rendu : l'état vit sur l'élément, pas dans la fermeture
    gesture(backdropDismiss(close), backdrop, backdrop)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('ferme sur un clic sans appui mémorisé (clavier, clic synthétique)', () => {
    const close = vi.fn()
    backdropDismiss(close).onClick(ev(backdrop))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('sans action de fermeture (opération en cours) : aucun effet', () => {
    expect(() => gesture(backdropDismiss(undefined), backdrop, backdrop)).not.toThrow()
  })

  it('stopPropagation : propagation arrêtée même quand le geste est ignoré', () => {
    const close = vi.fn()
    const click = gesture(backdropDismiss(close, { stopPropagation: true }), input, backdrop)
    expect(click.stopPropagation).toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })
})

describe('GH352 — aucun fond de popup ne ferme sur un onClick brut', () => {
  const rendererDir = join(__dirname, '..')
  function tsxFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) return tsxFiles(p)
      return p.endsWith('.tsx') ? [p] : []
    })
  }

  it('chaque <div … inset-0 …> passe par backdropDismiss', () => {
    const offenders: string[] = []
    for (const file of tsxFiles(rendererDir)) {
      const src = readFileSync(file, 'utf8')
      // balise ouvrante d'un fond plein écran (className simple ou gabarit)
      const re = /<div\s[^>]*?\binset-0\b/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        // fin de la balise ouvrante, accolades équilibrées (le gabarit `${…}` en contient)
        let depth = 0
        let j = m.index + 4
        for (; j < src.length; j++) {
          const c = src[j]
          if (c === '{') depth++
          else if (c === '}') depth--
          else if (depth === 0 && c === '>') break
        }
        const tag = src.slice(m.index, j)
        const onClick = tag.match(/\bonClick=\{([^\n]*)/)
        // seul `e => e.stopPropagation()` (fond non fermable) reste admis
        if (onClick && !/^e => e\.stopPropagation\(\)\}/.test(onClick[1])) {
          const line = src.slice(0, m.index).split('\n').length
          offenders.push(`${relative(rendererDir, file)}:${line}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
