/**
 * GH387 — résumé des mesures d'un passage e2e :
 *   POLENTA_E2E_TIMINGS=<timings.jsonl> PLAYWRIGHT_JSON_OUTPUT_NAME=<report.json> npx playwright test --reporter=list,json
 *   node e2e-web/support/timings.mjs <timings.jsonl> [report.json]
 *
 * `timings.jsonl` : une ligne par hook de `setupSession` (support/session.ts) — étapes du `beforeAll`
 * (context, login, clone | copy, template, open, goto) et de l'`afterAll`. `report.json` (reporter
 * json de Playwright) : durée totale et somme des corps de test.
 */
import fs from 'fs'

const [timingsFile, reportFile] = process.argv.slice(2)
if (!timingsFile) {
  process.stderr.write('usage : node timings.mjs <timings.jsonl> [report.json]\n')
  process.exit(2)
}

const s = ms => `${(ms / 1000).toFixed(1)} s`
const lines = fs.readFileSync(timingsFile, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l))
for (const hook of ['beforeAll', 'afterAll']) {
  const rows = lines.filter(l => l.hook === hook)
  if (!rows.length) continue
  const sums = {}
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) if (typeof v === 'number' && !['worker'].includes(k)) sums[k] = (sums[k] ?? 0) + v
  }
  const modes = rows.reduce((m, r) => ((m[r.mode ?? 'none'] = (m[r.mode ?? 'none'] ?? 0) + 1), m), {})
  console.log(`${hook} — ${rows.length} fichiers ${JSON.stringify(modes)}`)
  for (const [k, v] of Object.entries(sums)) console.log(`  ${k.padEnd(10)} ${s(v).padStart(9)}   moy. ${s(v / rows.length)}`)
}

if (reportFile) {
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf-8'))
  let body = 0
  const statuses = {}
  const walk = suite => {
    for (const child of suite.suites ?? []) walk(child)
    for (const spec of suite.specs ?? []) for (const t of spec.tests) for (const r of t.results) {
      body += r.duration
      statuses[r.status] = (statuses[r.status] ?? 0) + 1
    }
  }
  report.suites.forEach(walk)
  console.log(`Playwright : ${s(report.stats.duration)} — corps de test ${s(body)} — ${JSON.stringify(statuses)}`)
}
