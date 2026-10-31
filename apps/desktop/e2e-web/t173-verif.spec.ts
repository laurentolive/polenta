import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Locator } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * T173 (#5) — vérification des scénarios « manuels » de specs/T173-tests.md dans le client web :
 * N9–N13, N16, N17, L10–L14, R2, R3. L'état est préparé par le bridge (réouvertures T172, paramètre
 * T171, analyse baseline RE1 → RE2) ; les comportements livrés sont vérifiés dans l'interface.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport avec T173.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface Flagged {
  elementId: string
  elementType: 'requirement' | 'test_case'
  title: string
  repo?: { path: string; name: string }
  linked: Array<{ elementId: string; approved: boolean }>
}
interface Node { elementId: string; elementType: string; status: string; comment: string | null; children: Node[]; repo?: { path: string } }
interface Changed { reqId: string; descendantTree: Node[]; ascendantTree: Node[] }
interface Analysis { id: string; label: string; changedRequirements: Changed[] }

const P = () => s.project.localPath
const W = () => s.project.workspaceDir
const listFlagged = () => s.invoke<Flagged[]>('revalidation:list', P(), W())
const flaggedIds = async () => new Set((await listFlagged()).map((f) => f.elementId))
const localAnalysis = () => s.invoke<Analysis>('impact-analysis:local', P(), W())

function flatten(nodes: Node[]): Node[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}
function occurrences(a: Analysis): Map<string, number> {
  const m = new Map<string, number>()
  for (const cr of a.changedRequirements) for (const n of flatten([...cr.descendantTree, ...cr.ascendantTree])) m.set(n.elementId, (m.get(n.elementId) ?? 0) + 1)
  return m
}

// ── Sélecteurs ───────────────────────────────────────────────────────────────
const main = () => s.page.locator('div.flex.flex-col.h-full.overflow-hidden').filter({ has: s.page.locator('div.flex-1.overflow-y-auto') }).last()
/** Lignes de nœud d'arbre (une par occurrence) pour un id. */
const nodeRows = (id: string) => s.page.locator('div.py-1\\.5').filter({ has: s.page.getByRole('button', { name: id, exact: true }) })
const changedRow = (id: string) => s.page.locator('div.py-2\\.5').filter({ has: s.page.getByRole('button', { name: id, exact: true }) })
const flagIcon = (row: Locator) => row.getByRole('img', { name: /Impact à vérifier|Impact to check/ })
const clearBtn = (row: Locator) => row.getByRole('button', { name: /^(Lever le flag|Clear flag)$/ })
const selectionBtn = () => s.page.getByRole('button', { name: /^Lever le flag de la sélection/ })
const modal = () => s.page.locator('div.fixed.inset-0')
const revalidationEntry = () => s.page.getByTestId('changes-revalidation-entry')
const localEntry = () => s.page.getByTestId('changes-local-entry')

async function activate(entry: Locator) {
  const active = await entry.locator('xpath=..').evaluate((el) => el.className.includes('ring-1'))
  if (!active) await entry.click()
}

async function openImpactView() {
  await s.openView('Changesets')
}

let localFlagged: string[] = [] // éléments marqués présents dans les arbres de l'analyse locale
let dupId: string | null = null  // élément marqué présent deux fois (L10)
let trigger = ''

/** Rouvre des exigences approuvées (T172) jusqu'à obtenir assez de nœuds marqués dans l'analyse locale. */
async function reopenUntilFlagged() {
  const reqs = await s.invoke<Array<{ id: string; status: string }>>('requirements:list', P())
  for (const r of reqs.filter((r) => r.status === 'approved')) {
    await s.invoke('requirements:open-draft', P(), r.id, 'draft', W())
    trigger ||= r.id
    const flagged = await flaggedIds()
    const occ = occurrences(await localAnalysis())
    localFlagged = [...occ.keys()].filter((id) => flagged.has(id))
    dupId = localFlagged.find((id) => (occ.get(id) ?? 0) >= 2) ?? null
    if (localFlagged.length >= 8 && dupId) break
  }
  expect(localFlagged.length).toBeGreaterThanOrEqual(8)
}

// Premier test : les réouvertures suivantes font sortir de l'approbation les éléments qui
// utilisent un paramètre.
test('N16 — paramètre modifié : éléments marqués absents des analyses, levables depuis « Impact à vérifier »', async () => {
  const groups = await s.invoke<Array<{ repoPath: string; parameters: Array<{ name: string; value: string; unit?: string; description?: string }> }>>('parameters:list', P())
  const params = groups.find((g) => g.repoPath === P())!.parameters
  let usedBy: string[] = []
  let param: (typeof params)[number] | undefined
  for (const p of params) {
    const usages = await s.invoke<Array<{ elementId: string; isApproval: boolean; isTerminal: boolean }>>('parameters:usages', P(), p.name, W())
    usedBy = usages.filter((u) => u.isApproval && !u.isTerminal).map((u) => u.elementId)
    if (usedBy.length) { param = p; break }
  }
  expect(param, 'paramètre utilisé par un élément approuvé').toBeTruthy()
  const changedBefore = new Set((await localAnalysis()).changedRequirements.map((c) => c.reqId))
  await s.invoke('parameters:update', P(), param!.name, { value: `${param!.value}9`, unit: param!.unit, description: param!.description }, W())
  const flagged = await flaggedIds()
  for (const id of usedBy) expect(flagged.has(id)).toBe(true)
  const changedAfter = (await localAnalysis()).changedRequirements.map((c) => c.reqId)
  for (const id of usedBy) expect(changedAfter.includes(id)).toBe(changedBefore.has(id))

  await openImpactView()
  await revalidationEntry().click()
  const target = usedBy[0]
  const row = s.page.locator('div.border-b').filter({ has: s.page.getByRole('checkbox', { name: `Sélectionner ${target}` }) })
  await expect(row).toBeVisible()
  await clearBtn(row).click()
  await expect(row).toHaveCount(0)
  expect(await flaggedIds()).not.toContain(target)
})


test('N9 — analyse locale : ⚠, case et « Lever le flag » sur les nœuds marqués, pas sur l\'élément changé', async () => {
  await reopenUntilFlagged()
  await openImpactView()
  await activate(localEntry())
  const id = localFlagged[0]
  const row = nodeRows(id).first()
  await expect(row).toBeVisible()
  await expect(flagIcon(row)).toBeVisible()
  await expect(row.getByRole('checkbox')).toBeVisible()
  await expect(clearBtn(row)).toBeVisible()
  await expect(clearBtn(changedRow(trigger))).toHaveCount(0)
  // Un nœud non marqué n'a ni case ni bouton.
  const flagged = await flaggedIds()
  const unflagged = [...occurrences(await localAnalysis()).keys()].find((n) => !flagged.has(n))
  if (unflagged) {
    await expect(nodeRows(unflagged).first().getByRole('checkbox')).toHaveCount(0)
    await expect(clearBtn(nodeRows(unflagged).first())).toHaveCount(0)
  }
  await s.shot('t173-n9-local')
})

test('L10 — élément présent deux fois : une levée efface ⚠ sur toutes les occurrences', async () => {
  test.skip(!dupId, 'aucun élément marqué présent deux fois dans l\'analyse locale de la démo')
  const rows = nodeRows(dupId!)
  expect(await rows.count()).toBeGreaterThanOrEqual(2)
  await clearBtn(rows.first()).click()
  await expect(rows.getByRole('img', { name: /Impact à vérifier/ })).toHaveCount(0)
  await expect(rows.getByRole('button', { name: 'Lever le flag', exact: true })).toHaveCount(0)
  expect(await flaggedIds()).not.toContain(dupId)
})

test('N10 / R3 — levée unitaire : ⚠ disparaît de la vue Exigences et de la matrice sans rechargement', async () => {
  const flagged = await listFlagged()
  const matrix = await s.invoke<{ requirements: Array<{ requirement: { id: string }; coverageStatus: string; cells: Array<{ testCaseId: string }> }> }>('traceability:matrix', P(), {}, W())
  const ids = new Set(flagged.map((f) => f.elementId))
  // Exigence du repo racine dans l'arbre, à revalider dans la matrice uniquement à cause d'elle.
  const target = localFlagged.find((id) => {
    const f = flagged.find((x) => x.elementId === id)
    const row = matrix.requirements.find((r) => r.requirement.id === id)
    return f && !f.repo && f.elementType === 'requirement' && row?.coverageStatus === 'needs_revalidation' && row.cells.every((c) => !ids.has(c.testCaseId))
  }) ?? localFlagged.find((id) => { const f = flagged.find((x) => x.elementId === id); return f && !f.repo && f.elementType === 'requirement' })!
  expect(target).toBeTruthy()

  // La vue Exigences n'affiche qu'un type à la fois : choisir celui de la cible.
  interface SchemaNode { label: string; objectTypes?: Array<{ label: string; prefix: string }>; children?: SchemaNode[] }
  const schema = await s.invoke<{ nodes: SchemaNode[] }>('schema:get', P())
  const prefix = target.replace(/-\d+$/, '')
  const types = (nodes: SchemaNode[]): Array<{ label: string; prefix: string }> => nodes.flatMap((n) => [...(n.objectTypes ?? []), ...types(n.children ?? [])])
  const typeLabel = types(schema.nodes).find((t) => t.prefix === prefix)!.label
  async function openTargetType() {
    await s.openView('Exigences')
    const combo = s.page.locator('input.input-field.cursor-pointer').first()
    await combo.click()
    await combo.fill(typeLabel)
    await combo.press('Enter')
    await s.page.waitForLoadState('networkidle')
  }
  // ⚠ vérifié dans l'éditeur ouvert depuis la ligne : les vues Excel/Word ne l'affichent pas (#83).
  const editorFlag = () => s.page.getByRole('img', { name: 'Impact à vérifier' })
  async function openTargetEditor() {
    await openTargetType()
    const reqRow = s.page.locator('tr').filter({ hasText: target })
    await expect(reqRow.first()).toBeVisible()
    await reqRow.first().locator('td').first().click()
    await expect(s.page.getByText(target).first()).toBeVisible()
  }
  await openTargetEditor()
  await expect(editorFlag().first()).toBeVisible()
  await s.shot('t173-n10-editor-before')
  const changedBefore = (await localAnalysis()).changedRequirements.map((c) => c.reqId)

  await openImpactView()
  await activate(localEntry())
  await clearBtn(nodeRows(target).first()).click()
  await expect(flagIcon(nodeRows(target).first())).toHaveCount(0)

  // L'élément levé ne devient pas « élément changé ».
  const changedAfter = (await localAnalysis()).changedRequirements.map((c) => c.reqId)
  expect(changedAfter.includes(target)).toBe(changedBefore.includes(target))

  await openTargetEditor()
  await expect(editorFlag()).toHaveCount(0)

  const after = await s.invoke<{ requirements: Array<{ requirement: { id: string }; coverageStatus: string }> }>('traceability:matrix', P(), {}, W())
  expect(after.requirements.find((r) => r.requirement.id === target)?.coverageStatus).not.toBe('needs_revalidation')
  await s.shot('t173-n10-requirements')
})

test('N11 — multi-sélection de 3 nœuds, confirmation, sélection vidée', async () => {
  await openImpactView()
  await activate(localEntry())
  const flagged = await flaggedIds()
  const three = localFlagged.filter((id) => flagged.has(id)).slice(0, 3)
  expect(three.length).toBe(3)
  for (const id of three) await nodeRows(id).first().getByRole('checkbox').check()
  await expect(selectionBtn()).toHaveText('Lever le flag de la sélection (3)')
  await selectionBtn().click()
  await expect(modal()).toContainText('3 éléments')
  await modal().getByRole('button', { name: 'Lever le flag', exact: true }).click()
  await expect(selectionBtn()).toHaveCount(0)
  const now = await flaggedIds()
  for (const id of three) expect(now.has(id)).toBe(false)
})

test('L11 — changer d\'analyse active vide la sélection', async () => {
  const flagged = await flaggedIds()
  const id = localFlagged.find((x) => flagged.has(x))!
  await nodeRows(id).first().getByRole('checkbox').check()
  await expect(selectionBtn()).toBeVisible()
  await revalidationEntry().click()
  await expect(selectionBtn()).toHaveCount(0)
  await localEntry().click()
  await expect(nodeRows(id).first().getByRole('checkbox')).not.toBeChecked()
})

test('L12 — modification externe d\'un fichier : recalcul live, la sélection est conservée', async () => {
  const flagged = await flaggedIds()
  const id = localFlagged.find((x) => flagged.has(x))!
  await nodeRows(id).first().getByRole('checkbox').check()
  await expect(selectionBtn()).toHaveText('Lever le flag de la sélection (1)')

  // Modifie hors application le titre d'une exigence non encore changée.
  const changed = new Set((await localAnalysis()).changedRequirements.map((c) => c.reqId))
  const reqs = await s.invoke<Array<{ id: string; status: string }>>('requirements:list', P())
  const other = reqs.find((r) => !changed.has(r.id) && fs.existsSync(path.join(P(), 'requirements', `${r.id}.yaml`)))!
  const file = path.join(P(), 'requirements', `${other.id}.yaml`)
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^title: (.*)$/m, 'title: $1 (L12)'))

  await expect(changedRow(other.id)).toBeVisible({ timeout: 15_000 })
  await expect(nodeRows(id).first().getByRole('checkbox')).toBeChecked()
  await expect(selectionBtn()).toHaveText('Lever le flag de la sélection (1)')
  await nodeRows(id).first().getByRole('checkbox').uncheck()
})

test('L13 — échec partiel (fichier en lecture seule) : bandeau, les autres levés', async () => {
  const flagged = await listFlagged()
  const rootFlagged = localFlagged.filter((id) => flagged.some((f) => f.elementId === id && !f.repo))
  const [locked, ok] = rootFlagged
  expect(ok).toBeTruthy()
  const f = flagged.find((x) => x.elementId === locked)!
  const file = path.join(P(), f.elementType === 'requirement' ? 'requirements' : 'tests', `${locked}.yaml`)
  fs.chmodSync(file, 0o444)
  try {
    await nodeRows(locked).first().getByRole('checkbox').check()
    await nodeRows(ok).first().getByRole('checkbox').check()
    await selectionBtn().click()
    await modal().getByRole('button', { name: 'Lever le flag', exact: true }).click()
    const banner = s.page.getByText(/^Flag non levé :/)
    await expect(banner).toBeVisible()
    await expect(banner).toContainText(locked)
    await expect(banner).not.toContainText(ok)
    await s.shot('t173-l13-banner')
    const now = await flaggedIds()
    expect(now.has(locked)).toBe(true)
    expect(now.has(ok)).toBe(false)
    await s.page.getByRole('button', { name: 'Fermer' }).click()
    await expect(banner).toHaveCount(0)
  } finally {
    fs.chmodSync(file, 0o644)
  }
})

test('N17 — clic sur un id d\'un composant (liste de repli) : popup ouvert dans le bon repo', async () => {
  const comp = (await listFlagged()).find((f) => f.repo)
  expect(comp, 'élément marqué d\'un composant').toBeTruthy()
  await activate(revalidationEntry())
  await s.page.getByRole('button', { name: comp!.elementId, exact: true }).first().click()
  await expect(modal()).toBeVisible()
  await expect(modal()).toContainText(comp!.title)
  await s.shot('t173-n17-popup')
  await s.page.keyboard.press('Escape')
})

test('N14 bis — compteur exact et dépliage des éléments liés', async () => {
  const flagged = await listFlagged()
  await expect(revalidationEntry()).toContainText(`${flagged.length}`)
  const withPeers = flagged.find((f) => f.linked.some((l) => !l.approved))
  if (withPeers) {
    const row = s.page.locator('div.border-b').filter({ has: s.page.getByRole('checkbox', { name: `Sélectionner ${withPeers.elementId}` }) })
    await row.getByTitle(/élément(s)? lié(s)?/).click()
    await expect(row.getByText(/non approuvé/).first()).toBeVisible()
  }
  await s.shot('t173-n14-list')
})

test('L14 — libellés T173 en anglais', async () => {
  await s.page.evaluate(() => localStorage.setItem('polenta:locale', 'en'))
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
  try {
    await s.openView('Changesets')
    const entry = revalidationEntry()
    await expect(entry).toBeVisible()
    await expect(entry).toContainText(/Impact to check\s*\d+/)
    await entry.click()
    await expect(s.page.getByText('Select all')).toBeVisible()
    await expect(s.page.getByRole('button', { name: 'Clear flag', exact: true }).first()).toBeVisible()
    await s.page.getByText('Select all').click()
    await expect(s.page.getByRole('button', { name: /^Clear flag on selection \(\d+\)$/ })).toBeVisible()
    await s.page.getByRole('button', { name: /^Clear flag on selection/ }).click()
    await expect(modal()).toContainText(/Clear the flag on \d+ items?\?/)
    await s.shot('t173-l14-en')
    await modal().getByRole('button', { name: 'Cancel' }).click()
    const body = await main().innerText()
    expect(body).not.toMatch(/Lever le flag|Tout sélectionner|Impact à vérifier|non approuvé/)
  } finally {
    await s.page.evaluate(() => localStorage.setItem('polenta:locale', 'fr'))
  }
})
