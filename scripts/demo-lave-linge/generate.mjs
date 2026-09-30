#!/usr/bin/env node
// Génère le workspace Polenta de démonstration « Lave-linge LL800 » : 1 repo produit + 4 repos
// composants/interface, avec un historique git daté (phases P1→P8), des baselines RE1/RE2 en tags
// annotés et une branche de développement non fusionnée.
//
// Usage : node scripts/demo-lave-linge/generate.mjs [--out <dossier>] [--force]
//   --out    dossier du workspace (défaut : <polenta_ws>/demo-lave-linge, à côté de ce repo)
//   --force  supprime le dossier cible s'il existe déjà
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  writeFile, writeYaml, stableUuid, stableSuffix, initRepo, commitAll, annotatedTag, lightweightTag, headSha, git, Canvas, drawio,
} from './lib.mjs'
import { schemaProduit, schemaMoteur, schemaPompe, schemaWifi, schemaBus } from './schemas.mjs'
import {
  REPOS, REPO_ORDER, repoUrl, P, PHASES, DEV_BRANCH, PARAMETERS, ELEMENTS, LINKS, ADHOC_RUNS, CAMPAIGNS, REVIEWS, QUERIES, DASHBOARDS,
} from './content.mjs'
import { README_PRODUIT, README_COMPOSANTS, GUIDE } from './docs.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : null
const WS = path.resolve(outArg ?? path.join(here, '../../../demo-lave-linge'))
const FORCE = args.includes('--force')

const SCHEMAS = { produit: schemaProduit, moteur: schemaMoteur, pompe: schemaPompe, wifi: schemaWifi, bus: schemaBus }
const repoDir = key => path.join(WS, REPOS[key].dir)
const phaseIdx = key => PHASES.findIndex(p => p.key === key)

// ─── Préparation ─────────────────────────────────────────────────────────────

if (fs.existsSync(WS)) {
  if (!FORCE) {
    console.error(`Le dossier ${WS} existe déjà — relancer avec --force pour le régénérer.`)
    process.exit(1)
  }
  fs.rmSync(WS, { recursive: true, force: true })
}
fs.mkdirSync(path.join(WS, '.polenta'), { recursive: true })
writeYaml(WS, '.polenta/workspace.yaml', { rootRepo: REPOS.produit.dir })
for (const key of REPO_ORDER) {
  initRepo(repoDir(key))
  git(repoDir(key), ['remote', 'add', 'origin', repoUrl(key)])
}

// ─── État courant ────────────────────────────────────────────────────────────

const state = new Map() // id → objet YAML courant
const params = Object.fromEntries(REPO_ORDER.map(k => [k, {}]))

function applyPatch(el, patch) {
  const prev = state.get(el.id)
  const base = prev ?? (el.cat === 'requirement'
    ? { id: el.id, projectId: '', branchId: '', objectTypeRef: el.ref, title: el.title, status: 'draft', version: 1, fields: {}, jiraLinks: [] }
    : { id: el.id, projectId: '', branchId: '', objectTypeRef: el.ref, title: el.title, status: 'draft', version: 1,
        preconditions: '', equipment: [], steps: [], postconditions: '', fields: {} })
  const next = { ...base, ...patch, fields: { ...base.fields, ...(patch.fields ?? {}) } }
  if (next.needsRevalidation !== true) delete next.needsRevalidation
  state.set(el.id, next)
  return next
}

/** Snapshot TestCase (campagnes) : champs dérivés git à null, comme l'app avant indexation. */
function testSnapshot(id) {
  const t = state.get(id)
  return { ...structuredClone(t), createdAt: null, createdBy: null, updatedAt: null, updatedBy: null }
}

// ─── Exécutions : numérotation chronologique par test ────────────────────────

const repoOfElement = Object.fromEntries(ELEMENTS.map(e => [e.id, e.repo]))
const allRuns = [
  ...ADHOC_RUNS.map(r => ({ ...r })),
  ...CAMPAIGNS.flatMap(c => c.entries.filter(([, e]) => e.run).map(([testId, e]) => ({
    ...e.run, phase: c.phase, repo: repoOfElement[testId], testId, campaignId: c.id, requirementId: e.requirementId, entry: e,
  }))),
].sort((a, b) => a.at.localeCompare(b.at))
const runCounters = {}
for (const r of allRuns) {
  runCounters[r.testId] = (runCounters[r.testId] ?? 0) + 1
  r.id = `${r.testId}-run-${String(runCounters[r.testId]).padStart(4, '0')}`
  if (r.entry) r.entry.runId = r.id
}

// ─── Écritures par repo ──────────────────────────────────────────────────────

function flattenNodes(nodes, out = []) {
  for (const n of nodes) {
    out.push(n)
    flattenNodes(n.children ?? [], out)
  }
  return out
}

function writeTrees(key) {
  const dir = repoDir(key)
  for (const node of flattenNodes(SCHEMAS[key].nodes)) {
    for (const type of node.objectTypes ?? []) {
      if (type.category === 'campaign') continue
      const ref = `${node.name}::${type.name}`
      const items = ELEMENTS.filter(e => e.repo === key && e.ref === ref && state.has(e.id))
      if (!items.length) continue
      const root = []
      const folders = new Map()
      const folderChildren = folderPath => {
        if (!folderPath) return root
        if (folders.has(folderPath)) return folders.get(folderPath).children
        const parts = folderPath.split('/')
        const parent = folderChildren(parts.slice(0, -1).join('/'))
        const f = { id: stableUuid(`${key}:${ref}:folder:${folderPath}`), kind: 'folder', name: parts.at(-1), children: [] }
        parent.push(f)
        folders.set(folderPath, f)
        return f.children
      }
      for (const e of items) {
        folderChildren(e.folder).push({ id: stableUuid(`${key}:item:${e.id}`), kind: 'item', name: state.get(e.id).title, objectId: e.id, children: [] })
      }
      writeYaml(dir, `.polenta/trees/${node.name}/${type.name}.yaml`, { nodeId: node.name, typeId: type.name, root })
    }
  }
}

function writeCounters(key, extra = {}) {
  const counts = {}
  const bump = id => {
    const m = /^(.+)-(\d+)$/.exec(id)
    if (m) counts[m[1]] = Math.max(counts[m[1]] ?? 0, Number(m[2]))
  }
  for (const e of ELEMENTS) if (e.repo === key && state.has(e.id)) bump(e.id)
  for (const id of extra.ids ?? []) bump(id)
  writeYaml(repoDir(key), 'config/counters.yaml', counts)
}

function writeParameters(key) {
  const sorted = Object.fromEntries(Object.keys(params[key]).sort().map(k => {
    const { value, unit, description } = params[key][k]
    return [k, { value, ...(unit ? { unit } : {}), ...(description ? { description } : {}) }]
  }))
  writeYaml(repoDir(key), 'parameters/parameters.yaml', { parameters: sorted })
}

function writeLinks(key, phaseKey) {
  const upto = phaseIdx(phaseKey)
  const links = LINKS.filter(l => l.repo === key && phaseIdx(l.phase) <= upto).map(l => {
    const createdAt = new Date(PHASES[phaseIdx(l.phase)].date).toISOString()
    const seed = `${l.type}:${l.sourceId}:${l.targetId}`
    return {
      id: `lnk_${Date.parse(createdAt) + (parseInt(stableSuffix(seed, 3), 36) % 1000)}_${stableSuffix(seed)}`,
      type: l.type,
      sourceId: l.sourceId,
      targetId: l.targetId,
      ...(l.coverageType ? { coverageType: l.coverageType } : {}),
      createdAt,
      createdBy: l.by?.name ?? 'user',
    }
  })
  if (links.length) writeYaml(repoDir(key), 'links/links.yaml', { links })
}

function writeRun(r) {
  writeYaml(repoDir(r.repo), `test-runs/${r.testId}/${r.id}.yaml`, {
    id: r.id,
    testCaseId: r.testId,
    campaignRunId: null,
    ...(r.requirementId ? { requirementId: r.requirementId } : {}),
    result: r.result,
    executedAt: r.at,
    executedBy: r.by.name,
    duration: r.duration ?? 0,
    equipmentUsed: r.equipmentUsed ?? [],
    stepResults: r.stepResults.map(s => ({ ...s, executedAt: r.at })),
    notes: r.notes ?? '',
  })
}

function writeCampaign(c) {
  const occurrences = {}
  const runs = c.entries.map(([testId, e]) => {
    occurrences[testId] = (occurrences[testId] ?? 0) + 1
    const run = allRuns.find(r => r.entry === e)
    return {
      entryId: `${testId}-${occurrences[testId]}`,
      testCaseId: testId,
      ...(e.requirementId ? { requirementId: e.requirementId } : {}),
      testSnapshot: testSnapshot(testId),
      status: run ? run.result : 'pending',
      ...(run ? { runId: run.id, executedAt: run.at, executedBy: run.by.name } : {}),
      ...(e.paramValues ? { paramValues: e.paramValues } : {}),
      ...(e.resolvedParams ? { resolvedParams: e.resolvedParams } : {}),
      ...(e.resolvedParams && c.baselineRef ? { paramSourceRef: c.baselineRef } : {}),
      ...(e.unresolvedParams ? { unresolvedParams: e.unresolvedParams } : {}),
    }
  })
  writeYaml(repoDir('produit'), `campaigns/${c.id}.yaml`, {
    id: c.id,
    title: c.title,
    objectTypeRef: 'root::campagne-produit',
    fields: c.fields ?? {},
    ...(c.baselineRef ? { baselineRef: c.baselineRef } : {}),
    component: 'root',
    status: c.status,
    testCaseIds: [...new Set(c.entries.map(([t]) => t))],
    runs,
    createdAt: c.createdAt,
    ...(c.completedAt ? { completedAt: c.completedAt } : {}),
  })
}

function manifest(key, phaseKey) {
  const i = phaseIdx(phaseKey)
  const busPin = i >= phaseIdx('P6') ? 'v1.1' : i >= phaseIdx('P4') ? 'v1.0' : 'main'
  if (key === 'moteur') return { dependencies: [{ name: REPOS.bus.dir, url: repoUrl('bus'), pin: busPin }] }
  if (key !== 'produit') return null
  return {
    dependencies: [
      { name: REPOS.moteur.dir, url: repoUrl('moteur'), pin: 'main' },
      { name: REPOS.pompe.dir, url: repoUrl('pompe'), pin: i >= phaseIdx('P8') ? 'v2.0' : 'main', localParent: 'hydraulique' },
      { name: REPOS.wifi.dir, url: repoUrl('wifi'), pin: headSha(repoDir('wifi')) },
      { name: REPOS.bus.dir, url: repoUrl('bus'), pin: busPin },
    ],
  }
}

function writeStaticAssets(key) {
  const dir = repoDir(key)
  writeFile(dir, '.gitignore', '.local.pref\n.mcp.json\n')
  writeYaml(dir, '.polenta/schema.yaml', SCHEMAS[key])
  if (key === 'produit') {
    writeYaml(dir, 'config/project.yaml', { integrationBranch: 'main' })
    writeFile(dir, 'README.md', README_PRODUIT)
    writeFile(dir, 'diagrams/architecture-systeme.drawio', drawio('Architecture système', [
      { id: 'node-carte-commande', label: 'Carte de commande', x: 360, y: 160, w: 180, h: 80, style: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;' },
      { id: 'node-moteur', label: 'Moteur BLDC & onduleur<br><i>comp-moteur</i>', x: 660, y: 40 },
      { id: 'node-pompe', label: 'Pompe de vidange<br><i>comp-pompe-vidange</i>', x: 660, y: 170 },
      { id: 'node-wifi', label: 'Module Wi-Fi<br><i>comp-module-wifi</i>', x: 660, y: 300 },
      { id: 'node-electrovannes', label: 'Électrovannes', x: 80, y: 60 },
      { id: 'node-ihm', label: 'IHM façade', x: 80, y: 280 },
      { id: 'node-bus', label: 'Bus interne<br><i>if-bus-interne</i>', x: 380, y: 360, w: 140, h: 40, style: 'shape=parallelogram;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;' },
    ], [
      { id: 'e-cc-mot', source: 'node-carte-commande', target: 'node-moteur', label: 'bus' },
      { id: 'e-cc-pompe', source: 'node-carte-commande', target: 'node-pompe', label: 'triac' },
      { id: 'e-cc-wifi', source: 'node-carte-commande', target: 'node-wifi', label: 'bus' },
      { id: 'e-cc-ev', source: 'node-carte-commande', target: 'node-electrovannes' },
      { id: 'e-cc-ihm', source: 'node-carte-commande', target: 'node-ihm', label: 'bus IHM' },
    ]))
    writeFile(dir, 'diagrams/machine-etats-cycle.drawio', drawio('Machine d\'états du cycle', [
      { id: 'node-etat-veille', label: 'Veille', x: 40, y: 140, w: 110 },
      { id: 'node-etat-remplissage', label: 'Remplissage', x: 200, y: 140, w: 110 },
      { id: 'node-etat-lavage', label: 'Lavage', x: 360, y: 140, w: 110, style: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;' },
      { id: 'node-etat-rincage', label: 'Rinçage', x: 520, y: 140, w: 110 },
      { id: 'node-etat-essorage', label: 'Essorage', x: 680, y: 140, w: 110 },
      { id: 'node-etat-fin', label: 'Fin', x: 840, y: 140, w: 90 },
      { id: 'node-etat-defaut', label: 'Défaut / état sûr', x: 440, y: 300, w: 160, style: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;' },
    ], [
      { id: 't1', source: 'node-etat-veille', target: 'node-etat-remplissage', label: 'Départ' },
      { id: 't2', source: 'node-etat-remplissage', target: 'node-etat-lavage', label: 'niveau atteint' },
      { id: 't3', source: 'node-etat-lavage', target: 'node-etat-rincage' },
      { id: 't4', source: 'node-etat-rincage', target: 'node-etat-essorage' },
      { id: 't5', source: 'node-etat-essorage', target: 'node-etat-fin' },
      { id: 't6', source: 'node-etat-lavage', target: 'node-etat-defaut', label: 'défaut' },
      { id: 't7', source: 'node-etat-essorage', target: 'node-etat-defaut', label: 'balourd critique' },
    ]))
    writeFile(dir, 'diagrams/circuit-hydraulique.drawio', drawio('Circuit hydraulique', [
      { id: 'node-arrivee', label: 'Arrivée d\'eau', x: 40, y: 60 },
      { id: 'node-ev-prelavage', label: 'EV prélavage', x: 240, y: 20 },
      { id: 'node-ev-lavage', label: 'EV lavage', x: 240, y: 110 },
      { id: 'node-cuve', label: 'Cuve', x: 460, y: 60, w: 160, h: 100, style: 'shape=cylinder3;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;' },
      { id: 'node-capteur-niveau', label: 'Capteur de niveau', x: 680, y: 30 },
      { id: 'node-pompe', label: 'Pompe de vidange', x: 460, y: 230 },
    ], [
      { id: 'h1', source: 'node-arrivee', target: 'node-ev-prelavage' },
      { id: 'h2', source: 'node-arrivee', target: 'node-ev-lavage' },
      { id: 'h3', source: 'node-ev-prelavage', target: 'node-cuve' },
      { id: 'h4', source: 'node-ev-lavage', target: 'node-cuve' },
      { id: 'h5', source: 'node-cuve', target: 'node-capteur-niveau' },
      { id: 'h6', source: 'node-cuve', target: 'node-pompe' },
    ]))
    writeFile(dir, 'images/facade-ihm.png', facadePng())
    writeFile(dir, 'images/courbe-essorage.png', courbePng())
  } else {
    writeFile(dir, 'README.md', README_COMPOSANTS[key])
  }
  if (key === 'moteur') {
    writeFile(dir, 'diagrams/onduleur.drawio', drawio('Onduleur triphasé', [
      { id: 'node-bus-dc', label: 'Bus DC 325 V', x: 40, y: 100 },
      { id: 'node-pont', label: 'Pont IGBT 3 bras', x: 260, y: 100, style: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;' },
      { id: 'node-moteur-bldc', label: 'Moteur BLDC', x: 480, y: 100, style: 'ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;' },
      { id: 'node-mcu-foc', label: 'MCU FOC', x: 260, y: 240 },
    ], [
      { id: 'o1', source: 'node-bus-dc', target: 'node-pont' },
      { id: 'o2', source: 'node-pont', target: 'node-moteur-bldc', label: 'U V W' },
      { id: 'o3', source: 'node-mcu-foc', target: 'node-pont', label: 'PWM 16 kHz' },
    ]))
  }
}

// ─── Images (PNG générés) ────────────────────────────────────────────────────

function facadePng() {
  const c = new Canvas(360, 240, [245, 247, 250])
  c.rect(20, 20, 320, 200, [230, 233, 238])
  c.frame(20, 20, 320, 200, [120, 130, 145], 3)
  c.rect(40, 40, 280, 50, [40, 48, 60]) // bandeau
  c.rect(140, 52, 80, 26, [20, 25, 30]) // afficheur
  for (let i = 0; i < 4; i++) c.rect(146 + i * 18, 58, 12, 14, [80, 220, 120]) // digits
  const btn = [[60, 65], [90, 65], [250, 65], [280, 65]]
  for (const [x, y] of btn) c.disc(x, y, 9, [200, 205, 215])
  c.disc(300, 65, 7, [230, 90, 70]) // départ
  c.ring(180, 155, 55, 8, [150, 160, 175]) // hublot
  c.disc(180, 155, 45, [185, 215, 235])
  return c.toPng()
}

function courbePng() {
  const c = new Canvas(480, 260, [255, 255, 255])
  c.line(50, 220, 460, 220, [60, 60, 60], 2) // axe t
  c.line(50, 220, 50, 20, [60, 60, 60], 2) // axe vitesse
  for (let y = 60; y < 220; y += 40) c.line(52, y, 460, y, [225, 228, 232], 1)
  const pts = [[50, 220], [90, 190], [140, 190], [170, 150], [220, 150], [300, 50], [420, 50], [450, 220]]
  for (let i = 1; i < pts.length; i++) c.line(...pts[i - 1], ...pts[i], [37, 99, 235], 3)
  c.line(300, 40, 420, 40, [220, 38, 38], 1) // consigne max
  return c.toPng()
}

// ─── Déroulé des phases ──────────────────────────────────────────────────────

for (const phase of PHASES) {
  for (const key of REPO_ORDER) {
    const dir = repoDir(key)
    if (phase.key === 'P1') writeStaticAssets(key)

    const pPatch = PARAMETERS[key]?.[phase.key]
    if (pPatch) {
      Object.assign(params[key], pPatch)
      writeParameters(key)
    }

    const m = manifest(key, phase.key)
    if (m) writeYaml(dir, 'polenta-repo.yaml', m)

    for (const el of ELEMENTS.filter(e => e.repo === key && e.at[phase.key])) {
      const obj = applyPatch(el, el.at[phase.key])
      writeYaml(dir, `${el.cat === 'requirement' ? 'requirements' : 'tests'}/${el.id}.yaml`, obj)
    }

    writeLinks(key, phase.key)
    for (const r of allRuns.filter(r => r.repo === key && r.phase === phase.key)) writeRun(r)

    const extraIds = []
    if (key === 'produit') {
      for (const c of CAMPAIGNS.filter(c => phaseIdx(c.phase) <= phaseIdx(phase.key))) {
        extraIds.push(c.id)
        if (c.phase === phase.key) writeCampaign(c)
      }
      for (const r of REVIEWS.filter(r => phaseIdx(r.phase) <= phaseIdx(phase.key))) {
        extraIds.push(r.id)
        if (r.phase === phase.key) {
          const { phase: _p, ...review } = r
          writeYaml(dir, `reviews/${r.id}.yaml`, review)
        }
      }
      if (phaseIdx(phase.key) >= phaseIdx('P4')) {
        extraIds.push(...QUERIES.map(q => q.id), ...DASHBOARDS.map(d => d.id))
        if (phase.key === 'P4') writeSuivi(dir)
      }
      if (phase.key === 'P8') writeFile(dir, 'GUIDE-EVALUATION.md', GUIDE)
    }

    writeTrees(key)
    writeCounters(key, { ids: extraIds })

    const by = phase.by[key] ?? phase.by.default
    commitAll(dir, `${phase.msg}`, by, phase.date)
    for (const t of phase.repoTags?.[key] ?? []) {
      if (t.lightweight) lightweightTag(dir, t.tag)
      else annotatedTag(dir, t.tag, t.message, P.hugo, t.date)
    }
  }
  for (const t of phase.tags ?? []) for (const key of REPO_ORDER) annotatedTag(repoDir(key), t.tag, t.message, P.hugo, t.date)
}

function writeSuivi(dir) {
  const createdAt = '2026-04-24T15:00:00.000Z'
  for (const q of QUERIES) {
    writeYaml(dir, `queries/${q.id}.yaml`, {
      id: q.id, title: q.title, mode: q.mode,
      ...(q.mode === 'sql' ? { sqlText: q.sqlText } : { builderConfig: q.builderConfig }),
      scope: 'shared', createdBy: P.hugo.name, createdAt,
    })
  }
  for (const d of DASHBOARDS) {
    const widgets = d.widgets.map(w => ({
      id: `widget-${Date.parse(d.createdAt)}-${stableSuffix(`${d.id}:${w.key}`, 6)}`,
      title: w.title, queryId: w.queryId, type: w.type, fieldMapping: w.fieldMapping, size: w.size,
    }))
    writeYaml(dir, `dashboards/${d.id}.yaml`, {
      id: d.id, title: d.title, scope: 'shared', widgetOrder: widgets.map(w => w.id), widgets, createdBy: d.by.name, createdAt: d.createdAt,
    })
  }
}

// ─── Branche de développement non fusionnée ──────────────────────────────────

{
  const dir = repoDir(DEV_BRANCH.repo)
  git(dir, ['checkout', '-q', '-b', DEV_BRANCH.name])
  params.produit.vitesse_essorage = { ...params.produit.vitesse_essorage, value: '1600' }
  writeParameters('produit')
  const prd2 = ELEMENTS.find(e => e.id === 'PRD-0002')
  writeYaml(dir, 'requirements/PRD-0002.yaml', applyPatch(prd2, { status: 'review', version: 2, fields: { kpi_cible: '1600 tr/min' } }))
  const prd14 = { repo: 'produit', id: 'PRD-0014', ref: 'root::exigence-produit', folder: 'Usage', title: 'Programme vapeur anti-froissage', cat: 'requirement', at: {} }
  ELEMENTS.push(prd14)
  writeYaml(dir, 'requirements/PRD-0014.yaml', applyPatch(prd14, { status: 'draft', fields: {
    statement: 'WHERE le programme vapeur est sélectionné\nTHE lave-linge SHALL injecter de la vapeur pendant les 10 dernières minutes du cycle.',
    priority: 'low', source: 'Marketing', marches: 'CN, JP',
  } }))
  writeTrees('produit')
  writeCounters('produit', { ids: [...CAMPAIGNS.map(c => c.id), ...REVIEWS.map(r => r.id), ...QUERIES.map(q => q.id), ...DASHBOARDS.map(d => d.id)] })
  commitAll(dir, DEV_BRANCH.msg, DEV_BRANCH.by, DEV_BRANCH.date)
  git(dir, ['checkout', '-q', 'main'])
}

// ─── Résumé ──────────────────────────────────────────────────────────────────

console.log(`Workspace généré : ${WS}`)
for (const key of REPO_ORDER) {
  const dir = repoDir(key)
  const commits = git(dir, ['rev-list', '--count', '--all'])
  const tags = git(dir, ['tag']).split('\n').filter(Boolean).join(', ')
  console.log(`  ${REPOS[key].dir.padEnd(20)} ${commits} commits  tags: ${tags}  HEAD ${headSha(dir).slice(0, 8)}`)
}
