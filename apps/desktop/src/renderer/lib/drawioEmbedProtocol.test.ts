import { describe, it, expect } from 'vitest'
import { editorSrc, EDITOR_PATH, exportMessage, isFromEditor, loadMessage, parseEditorEvent } from './drawioEmbedProtocol'

/** GH46 — protocole de l'éditeur draw.io embarqué (messages, origine, URL). */

describe('GH46 — URL de l’éditeur', () => {
  it('sert la page depuis le serveur web, en mode embarqué JSON hors ligne, sans boutons de l’éditeur', () => {
    const src = editorSrc('fr')
    expect(src.startsWith(EDITOR_PATH + '?')).toBe(true)
    const params = new URLSearchParams(src.split('?')[1])
    expect(params.get('embed')).toBe('1')
    expect(params.get('proto')).toBe('json')
    expect(params.get('offline')).toBe('1')
    expect(params.get('noSaveBtn')).toBe('1')
    expect(params.get('noExitBtn')).toBe('1')
    expect(params.get('lang')).toBe('fr')
  })

  it('repli sur le français si la langue est vide', () => {
    expect(new URLSearchParams(editorSrc('').split('?')[1]).get('lang')).toBe('fr')
  })

  it('ne référence aucun hôte externe', () => {
    expect(editorSrc('en')).not.toMatch(/https?:/)
  })
})

describe('GH46 — messages envoyés à l’éditeur', () => {
  it('charge le XML avec l’action load', () => {
    expect(JSON.parse(loadMessage('<mxfile/>'))).toEqual({ action: 'load', xml: '<mxfile/>' })
  })

  it('demande le XML avec l’action export (format xml)', () => {
    expect(JSON.parse(exportMessage())).toEqual({ action: 'export', format: 'xml' })
  })
})

describe('GH46 — événements reçus de l’éditeur', () => {
  it('lit les événements en chaîne JSON (mode proto=json)', () => {
    expect(parseEditorEvent('{"event":"init"}')).toEqual({ type: 'init' })
    expect(parseEditorEvent('{"event":"load"}')).toEqual({ type: 'load' })
    expect(parseEditorEvent('{"event":"exit","modified":true}')).toEqual({ type: 'exit' })
  })

  it('lit le XML d’une réponse export', () => {
    expect(parseEditorEvent(JSON.stringify({ event: 'export', format: 'xml', xml: '<mxfile/>' }))).toEqual({ type: 'export', xml: '<mxfile/>' })
  })

  it('ignore une réponse export qui n’est pas du XML, un export sans xml, et les autres événements', () => {
    expect(parseEditorEvent(JSON.stringify({ event: 'export', format: 'png', data: 'x' }))).toBeNull()
    expect(parseEditorEvent(JSON.stringify({ event: 'export', format: 'xml' }))).toBeNull()
    expect(parseEditorEvent(JSON.stringify({ event: 'resize', rect: {} }))).toBeNull()
    expect(parseEditorEvent(JSON.stringify({ event: 'shortcut', command: 'save' }))).toBeNull()
  })

  it('accepte un objet déjà décodé et refuse les données illisibles', () => {
    expect(parseEditorEvent({ event: 'init' })).toEqual({ type: 'init' })
    expect(parseEditorEvent('{pas du json')).toBeNull()
    expect(parseEditorEvent(42)).toBeNull()
    expect(parseEditorEvent(null)).toBeNull()
  })
})

describe('GH46 — origine et source des messages', () => {
  const frame = { name: 'éditeur' }

  it('accepte un message de l’iframe, même origine', () => {
    expect(isFromEditor({ source: frame, origin: 'https://polenta.local' }, frame, 'https://polenta.local')).toBe(true)
  })

  it('refuse une autre fenêtre, même origine', () => {
    expect(isFromEditor({ source: { name: 'autre' }, origin: 'https://polenta.local' }, frame, 'https://polenta.local')).toBe(false)
  })

  it('refuse l’iframe si l’origine diffère (page tierce)', () => {
    expect(isFromEditor({ source: frame, origin: 'https://evil.example' }, frame, 'https://polenta.local')).toBe(false)
  })

  it('refuse tout message tant que l’iframe n’existe pas', () => {
    expect(isFromEditor({ source: frame, origin: 'https://polenta.local' }, null, 'https://polenta.local')).toBe(false)
  })
})
