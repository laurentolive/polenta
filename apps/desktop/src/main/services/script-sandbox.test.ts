import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { QuickJSWASMModule } from 'quickjs-emscripten-core'
import type { PolentaHost } from '@polenta/types'
import { buildHost } from '@polenta/types'
import { createSandboxModule, normalizeImport, SandboxContext } from './script-sandbox'
import { DEFAULT_SANDBOX_LIMITS } from './script-limits'

// GH74 — bac à sable QuickJS (specs/GH74-tests.md §2, S1–S7, S10–S14 ; §3, L9–L10).

const host: PolentaHost = buildHost({ locale: 'fr', timezone: 'UTC' }, 1, new Date('2026-10-13T12:00:00Z'))
const GRAPH = JSON.stringify({ requirements: [{ id: 'R1', status: 'draft' }], tests: [] })
const LIB = {
  'lib/a.js': 'import { b } from "./b.js"\nexport const a = () => b() + 1',
  'lib/b.js': 'export const b = () => 41\nexport function boom(x) {\n  return x.y.z\n}',
  'lib/sub/c.js': 'import { b } from "../b.js"\nexport const c = () => b()',
  'lib/escape.js': 'import x from "../../secret.js"\nexport const e = x',
  'moteur::lib/mesures.js': 'export const m = 3',
  'moteur::lib/abs.js': 'import { m } from "lib/mesures.js"\nexport const viaAbs = m',
  'lib/conf.js': 'export const CONF = { seuil: 1, liste: [1, 2] }\nexport function f() { return CONF.seuil }',
}

let qjs: QuickJSWASMModule
let ctx: SandboxContext

beforeAll(async () => {
  qjs = await createSandboxModule()
  ctx = SandboxContext.prepare(qjs, GRAPH, LIB)
})
afterAll(() => ctx.dispose())

const run = (script: string) => ctx.runScript(script, host)

describe('GH74 — bac à sable', () => {
  it('exécute un script avec la bibliothèque (imports absolus, relatifs, composant)', () => {
    const r = run(
      'import { a } from "lib/a.js"\nimport { c } from "lib/sub/c.js"\nimport { m } from "moteur::lib/mesures.js"\n' +
      'export default (data, polenta) => [{ n: a() + c() + m, id: data.requirements[0].id, tz: polenta.timezone, _ids: ["R1"] }]',
    )
    expect(r).toEqual({ ok: true, rows: [{ n: 86, id: 'R1', tz: 'UTC', _ids: ['R1'] }] })
  })

  it('S1 — aucun accès aux globaux de l\'hôte', () => {
    const r = run('export default () => [{ r: [typeof fetch, typeof require, typeof process, typeof setTimeout, typeof console, typeof WebAssembly].join() }]')
    expect(r.ok && r.rows[0].r).toBe('undefined,undefined,undefined,undefined,undefined,undefined')
  })

  it.each([
    ['os', 'import x from "os"\nexport default () => []'],
    ['fs', 'import * as fs from "fs"\nexport default () => []'],
    ['node:fs', 'import { readFileSync } from "node:fs"\nexport default () => []'],
    ['https://example.com/x.js', 'import x from "https://example.com/x.js"\nexport default () => []'],
    ['../x.js', 'import x from "../x.js"\nexport default () => []'],
    ['lib/../../x.js', 'import x from "lib/../../x.js"\nexport default () => []'],
  ])('S2 — import interdit : %s', (name, script) => {
    const r = run(script)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe('import')
      expect(r.error.message).toContain('Module introuvable')
      expect(r.error.message).toContain(name)
    }
  })

  it('S2 — un module de bibliothèque ne sort pas de lib/', () => {
    const r = run('import { e } from "lib/escape.js"\nexport default () => []')
    expect(!r.ok && r.error.kind).toBe('import')
  })

  it('S3 — données en lecture seule', () => {
    const r = run('export default (data) => { data.requirements[0].status = "x"; return [] }')
    expect(!r.ok && r.error.message).toMatch(/read-only/)
    const r2 = run('export default (data) => { data.requirements = []; return [] }')
    expect(r2.ok).toBe(false)
  })

  it('S4 — une exécution ne laisse rien à la suivante', () => {
    expect(run('export default () => { globalThis.leak = 1; return [] }').ok).toBe(false)
    expect(run('export default () => { Array.prototype.sum = () => 1; return [] }').ok).toBe(false)
    const r = run('export default () => [{ leak: typeof globalThis.leak, sum: typeof [].sum }]')
    expect(r).toEqual({ ok: true, rows: [{ leak: 'undefined', sum: 'undefined' }] })
  })

  it('S4 — les exports de la bibliothèque sont gelés (contexte partagé entre exécutions)', () => {
    const tamper = run('import * as c from "lib/conf.js"\nexport default () => { c.CONF.seuil = 99; return [] }')
    expect(!tamper.ok && tamper.error.message).toMatch(/read-only|not extensible/)
    expect(run('import * as c from "lib/conf.js"\nexport default () => { c.CONF.liste.push(3); return [] }').ok).toBe(false)
    expect(run('import * as c from "lib/conf.js"\nexport default () => { c.f.x = 1; return [] }').ok).toBe(false)
    expect(run('import { f, CONF } from "lib/conf.js"\nexport default () => [{ s: f(), n: CONF.liste.length }]')).toEqual({ ok: true, rows: [{ s: 1, n: 2 }] })
  })

  it('import absolu depuis un module de composant : sa propre bibliothèque', () => {
    expect(run('import { viaAbs } from "moteur::lib/abs.js"\nexport default () => [{ viaAbs }]')).toEqual({ ok: true, rows: [{ viaAbs: 3 }] })
  })

  it('S5 — boucle infinie interrompue, contexte réutilisable', () => {
    const fast = SandboxContext.prepare(qjs, GRAPH, {}, { ...DEFAULT_SANDBOX_LIMITS, timeMs: 300 })
    try {
      const t0 = Date.now()
      const r = fast.runScript('export default () => { for (;;) {} }', host)
      expect(!r.ok && r.error.kind).toBe('timeout')
      expect(Date.now() - t0).toBeLessThan(2000)
      expect(fast.runScript('export default () => [{ ok: true }]', host).ok).toBe(true)
    } finally {
      fast.dispose()
    }
  })

  it('S6 — allocation massive : mémoire dépassée, signalée comme fatale', async () => {
    const small = await createSandboxModule({ ...DEFAULT_SANDBOX_LIMITS, wasmMaxMb: 64, memoryBytes: 16 * 1024 * 1024 })
    const c = SandboxContext.prepare(small, GRAPH, {}, { ...DEFAULT_SANDBOX_LIMITS, wasmMaxMb: 64, memoryBytes: 16 * 1024 * 1024 })
    try {
      const r = c.runScript('export default () => { const a = []; for (;;) a.push(new Array(10000).fill(1)) }', host)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error.kind).toBe('memory')
        expect(r.fatal).toBe(true)
      }
      const buf = (small as unknown as { getWasmMemory(): WebAssembly.Memory }).getWasmMemory().buffer
      expect(buf.byteLength).toBeLessThanOrEqual(64 * 1024 * 1024)
    } finally {
      c.dispose()
    }
  })

  it('S7 — récursion infinie : pile dépassée', () => {
    const r = run('export default () => { const f = (n) => f(n + 1) + 1; return [{ x: f(0) }] }')
    expect(!r.ok && r.error.kind).toBe('stack')
  })

  it('S10 — erreurs localisées (script, bibliothèque, transformation)', () => {
    const thrown = run('export default () => {\n  const x = 1\n  throw new Error("seuil " + x)\n}')
    expect(thrown).toMatchObject({ ok: false, error: { kind: 'runtime', message: 'seuil 1', file: 'script.js', line: 3 } })
    const inLib = run('import { boom } from "lib/b.js"\nexport default () => boom({})')
    expect(inLib).toMatchObject({ ok: false, error: { kind: 'runtime', file: 'lib/b.js', line: 3 } })
    const syntax = run('export default () => {\n  return [(\n}')
    expect(syntax).toMatchObject({ ok: false, error: { kind: 'syntax', file: 'script.js' } })
    const tr = ctx.runTransform('export default (rows) => {\n  return rows.map(r => r.x.y)\n}', [{ a: 1 }], host, 'w1.js')
    expect(tr).toMatchObject({ ok: false, error: { kind: 'runtime', file: 'w1.js', line: 2 } })
  })

  it.each([
    ['non-tableau', 'export default () => 3', /tableau de lignes/],
    ['ligne non objet', 'export default () => [1]', /Ligne 0 : objet attendu/],
    ['valeur objet', 'export default () => [{ a: { b: 1 } }]', /Ligne 0, colonne "a" : valeur non scalaire/],
    ['_ids non tableau', 'export default () => [{ _ids: "R1" }]', /"_ids" doit être un tableau/],
  ])('S11 — sortie invalide : %s', (_label, script, message) => {
    const r = run(script)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe('rows')
      expect(r.error.message).toMatch(message)
    }
  })

  it('S12 — fonction async refusée', () => {
    expect(run('export default async () => []')).toMatchObject({ ok: false, error: { kind: 'async' } })
  })

  it('S13 — pas d\'export par défaut', () => {
    expect(run('export const x = 1')).toMatchObject({ ok: false, error: { kind: 'export' } })
  })

  it('transformation : reçoit les lignes gelées et les renvoie transformées', () => {
    const r = ctx.runTransform('export default (rows, polenta) => rows.map(r => ({ ...r, k: polenta.locale }))', [{ a: 1, _ids: ['X'] }], host, 'w1.js')
    expect(r).toEqual({ ok: true, rows: [{ a: 1, _ids: ['X'], k: 'fr' }] })
    const frozen = ctx.runTransform('export default (rows) => { rows[0].a = 2; return rows }', [{ a: 1 }], host, 'w1.js')
    expect(frozen.ok).toBe(false)
  })
})

describe('GH74 — normalizeImport', () => {
  it.each([
    ['__polenta_script_1.js', 'lib/a.js', 'lib/a.js'],
    ['__polenta_script_1.js', 'moteur::lib/x/y.js', 'moteur::lib/x/y.js'],
    ['lib/a.js', './b.js', 'lib/b.js'],
    ['lib/sub/c.js', '../b.js', 'lib/b.js'],
    ['moteur::lib/a.js', './b.js', 'moteur::lib/b.js'],
    ['moteur::lib/a.js', 'lib/b.js', 'moteur::lib/b.js'],
    ['moteur::lib/a.js', 'pompe::lib/b.js', 'pompe::lib/b.js'],
    ['lib/a.js', 'lib/b.js', 'lib/b.js'],
    ['__polenta_script_1.js', './b.js', null],
    ['lib/a.js', '../../x.js', null],
    ['__polenta_script_1.js', 'lib/../x.js', null],
    ['__polenta_script_1.js', 'os', null],
    ['__polenta_script_1.js', 'a b::lib/x.js', null],
  ])('%s importe %s → %s', (base, req, expected) => {
    expect(normalizeImport(base, req)).toBe(expected)
  })
})
