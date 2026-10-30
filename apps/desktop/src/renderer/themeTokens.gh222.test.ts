import * as fs from 'fs'
import * as path from 'path'
import { describe, expect, it } from 'vitest'
import { themeTokens } from './theme.config'

/**
 * GH222 — `theme:generate` réécrit le bloc des variables de `index.css` à partir de
 * `theme.config.ts` seul : une variable ajoutée à la main dans ce bloc disparaît à la génération
 * suivante (cela a effacé les couleurs `chart-progress-*` de GH71). Toute variable de thème lue par
 * la bibliothèque de dashboards (`var(--…)` dans ses specs) doit donc être déclarée ici.
 */
describe('jetons de thème utilisés par la bibliothèque de dashboards', () => {
  it('chaque var(--…) de resources/dashboard-lib est déclarée dans theme.config.ts', () => {
    const dir = path.resolve(__dirname, '../../resources/dashboard-lib')
    const used = new Set<string>()
    for (const name of fs.readdirSync(dir)) {
      const text = fs.readFileSync(path.join(dir, name), 'utf8')
      for (const m of text.matchAll(/var\(--([a-z0-9-]+)\)/g)) used.add(m[1])
    }
    expect(used.size).toBeGreaterThan(0)
    expect([...used].filter(name => !(name in themeTokens))).toEqual([])
  })
})
