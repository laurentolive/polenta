import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { isPruned, isSafeEntryName, parsePruneRules, sha256Hex, sha256Matches } from './drawio-editor-lib'

const enc = (s: string) => new TextEncoder().encode(s)

describe('GH46 — élagage de l’éditeur draw.io', () => {
  const rules = parsePruneRules(fs.readFileSync(path.join(__dirname, 'drawio-prune.txt'), 'utf8'))

  it('ignore les commentaires et les lignes vides', () => {
    expect(parsePruneRules('# titre\n\nWEB-INF/\n  *.map  \r\n')).toEqual(['WEB-INF/', '*.map'])
  })

  it('élague les dossiers d’intégration, les visionneuses, les cartes et les pages annexes', () => {
    expect(isPruned('WEB-INF/web.xml', rules)).toBe(true)
    expect(isPruned('templates/basic/blank.xml', rules)).toBe(true)
    expect(isPruned('js/integrate.min.js', rules)).toBe(true)
    expect(isPruned('js/viewer-static.min.js', rules)).toBe(true)
    expect(isPruned('js/app.min.js.map', rules)).toBe(true)
    expect(isPruned('teams.html', rules)).toBe(true)
  })

  it('garde le service worker de l’éditeur (offline=1 l’enregistre)', () => {
    expect(isPruned('service-worker.js', rules)).toBe(false)
    expect(isPruned('workbox-05b6c01b.js', rules)).toBe(false)
  })

  it('garde l’éditeur et ses ressources', () => {
    expect(isPruned('index.html', rules)).toBe(false)
    expect(isPruned('js/app.min.js', rules)).toBe(false)
    expect(isPruned('js/main.js', rules)).toBe(false)
    expect(isPruned('styles/grapheditor.css', rules)).toBe(false)
    expect(isPruned('images/manifest.json', rules)).toBe(false)
    expect(isPruned('js/grapheditor/Graph.js', rules)).toBe(false)
  })

  it('une règle « préfixe » ne désigne pas un fichier voisin qui s’en distingue par un nom plus long', () => {
    expect(isPruned('js/integrate.min.js.bak', ['js/integrate.min.js'])).toBe(false)
  })
})

describe('GH46 — chemins d’entrée du zip', () => {
  it.each(['js/app.min.js', 'index.html', 'images/a-b.png'])('accepte %s', name => {
    expect(isSafeEntryName(name)).toBe(true)
  })

  it.each(['../evil.js', 'js/../../evil.js', '/etc/passwd', 'C:/Windows/x.dll', 'C:\\x.dll', '..\\evil.js', ''])('refuse %j', name => {
    expect(isSafeEntryName(name)).toBe(false)
  })
})

describe('GH46 — intégrité de draw.war', () => {
  it('calcule le SHA-256 hexadécimal (test vectoriel)', () => {
    expect(sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('accepte la valeur en majuscules, refuse un contenu altéré', () => {
    const expected = 'BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD'
    expect(sha256Matches(enc('abc'), expected)).toBe(true)
    expect(sha256Matches(enc('abd'), expected)).toBe(false)
  })

  it('la valeur épinglée dans drawio-editor.json est un SHA-256 valide', () => {
    const pinned = JSON.parse(fs.readFileSync(path.join(__dirname, 'drawio-editor.json'), 'utf8')) as { sha256: string; version: string }
    expect(pinned.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(pinned.version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
