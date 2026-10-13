import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Library } from './sandbox'

export const SPIKE_DIR = __dirname

/** Bibliothèque projet : `lib/<fichier>.js` → source (clé = nom importable). */
export function loadLibrary(dir = path.join(SPIKE_DIR, 'lib')): Library {
  return Object.fromEntries(fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => [`lib/${f}`, fs.readFileSync(path.join(dir, f), 'utf8')]))
}

export const WIDGETS = {
  a: 'a-statuts-exigences',
  b: 'b-matrice-test-campagne',
  c: 'c-avancement-campagne',
} as const
export type WidgetKey = keyof typeof WIDGETS

export function loadWidget(key: WidgetKey, dir = path.join(SPIKE_DIR, 'widgets')): { script: string; spec: unknown } {
  const script = fs.readFileSync(path.join(dir, `${WIDGETS[key]}.js`), 'utf8')
  const specFile = path.join(dir, `${WIDGETS[key]}.vl.json`)
  return { script, spec: fs.existsSync(specFile) ? JSON.parse(fs.readFileSync(specFile, 'utf8')) : null }
}

/** Bibliothèque synthétique de ~`kb` Ko (fonctions utilitaires factices) pour mesurer le coût
 *  de chargement d'une bibliothèque projet qui aurait grossi. */
export function syntheticLibrary(kb: number): string {
  const parts: string[] = []
  let i = 0
  while (parts.join('\n').length < kb * 1024) {
    parts.push(`export function util${i}(list, key) {\n  const out = new Map()\n  for (const o of list) {\n    const k = o && o[key] !== undefined ? String(o[key]) : '(vide)'\n    if (!out.has(k)) out.set(k, [])\n    out.get(k).push(o.id)\n  }\n  return [...out].map(([value, ids]) => ({ value, count: ids.length, _ids: ids, n: ${i} }))\n}`)
    i++
  }
  return parts.join('\n')
}
