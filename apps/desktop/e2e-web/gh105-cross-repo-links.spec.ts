import { test, expect, type Locator } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH105 — liens inter-repos (specs/GH105-tests.md : N1, N2, N4, N5, N6, N8, L4) : candidats d'un
 * composant proposés dans l'éditeur de liens, lien écrit dans le repo de sa source, affiché sur la
 * source et sur la cible (vue document), navigation vers le repo de la cible et retour, suppression
 * depuis la cible, pair introuvable signalé.
 *
 * Préparation par le bridge : un type de lien `gh105-implements` (exigence du repo racine →
 * exigence d'un composant de la démo) est ajouté au schéma du repo racine.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface WObj { id: string; title: string; status: string; objectTypeRef: string; category: string; repoPath: string; repoLabel: string; readonly: boolean }
interface WLink { id: string; type: string; sourceId: string; targetId: string; storedIn: string; readonly: boolean }
interface SchemaNode { name: string; objectTypes?: Array<{ name: string; label: string }>; children?: SchemaNode[] }
interface Schema { nodes: SchemaNode[]; linkTypes: Array<Record<string, unknown>> }

const LT = 'gh105-implements'
const OUT = 'GH105 implémenté par'
const IN = 'GH105 implémente'
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const P = () => s.project.localPath
const W = () => s.project.workspaceDir
const links = () => s.invoke<WLink[]>('links:list', P(), W())
const gh105Links = async () => (await links()).filter((l) => l.type === LT)

let R: WObj
let C: WObj
let rTypeLabel = ''
let cComboText = ''

function typeLabel(schema: Schema, ref: string): string {
  const [node, type] = ref.split('::')
  const flat = (nodes: SchemaNode[]): SchemaNode[] => nodes.flatMap((n) => [n, ...flat(n.children ?? [])])
  return flat(schema.nodes).find((n) => n.name === node)?.objectTypes?.find((t) => t.name === type)?.label ?? type
}

/** Un élément approuvé est verrouillé (pas d'édition de liens) : brouillon de préférence, sinon
 *  rouvert en brouillon (T172). */
async function editable(candidates: WObj[]): Promise<WObj> {
  const draft = candidates.find((o) => o.status !== 'approved')
  if (draft) return draft
  const o = candidates[0]
  await s.invoke('requirements:open-draft', o.repoPath, o.id, 'draft', W())
  return o
}

test.beforeAll(async () => {
  const objs = await s.invoke<WObj[]>('links:objects', P(), W())
  const rootReqs = objs.filter((o) => o.category === 'requirement' && norm(o.repoPath) === norm(P()))
  const compReqs = objs.filter((o) => o.category === 'requirement' && norm(o.repoPath) !== norm(P()) && !o.readonly)
  expect(rootReqs.length, 'exigence du repo racine').toBeGreaterThan(0)
  expect(compReqs.length, "exigence d'un composant modifiable").toBeGreaterThan(0)
  R = await editable(rootReqs)
  C = await editable(compReqs)

  const schema = await s.invoke<Schema>('schema:get', P())
  schema.linkTypes = [...(schema.linkTypes ?? []).filter((t) => t['name'] !== LT), {
    name: LT, labelSourceToTarget: OUT, labelTargetToSource: IN, sourceRefs: [R.objectTypeRef], targetRefs: [C.objectTypeRef],
  }]
  await s.invoke('schema:save', P(), schema)
  rTypeLabel = typeLabel(schema, R.objectTypeRef)
  cComboText = `${C.repoLabel} / ${typeLabel(await s.invoke<Schema>('schema:get', C.repoPath), C.objectTypeRef)}`
})

/** Vue Exigences, type choisi dans la combobox Composant / Élément, vue document. */
async function openDocView(comboText: string) {
  await s.openView('Exigences')
  const combo = s.page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(comboText)
  await combo.press('Enter')
  await s.page.getByTitle('Vue document').click()
  await s.page.waitForLoadState('networkidle')
}

/** Carte de la vue document d'un élément. */
const card = (id: string) => s.page.locator('[data-node-id]').filter({ has: s.page.locator('span.font-mono', { hasText: new RegExp(`^${id}$`) }) }).first()
/** Ligne de liens d'une carte pour un libellé de sens. */
const linkLine = (c: Locator, label: string) => c.locator('[data-link-popover]').filter({ hasText: label }).first()
const popover = () => s.page.locator('div.fixed[data-link-popover]')

test('GH105-1 — candidat d\'un composant proposé, lien écrit dans le repo de la source (N1, N2, N4)', async () => {
  await openDocView(rTypeLabel)
  await linkLine(card(R.id), OUT).click()
  const input = popover().getByPlaceholder('Rechercher un élément…')
  await input.fill(C.id)
  const option = popover().getByRole('button', { name: new RegExp(C.id) }).first()
  await expect(option).toContainText(C.repoLabel)
  await option.dispatchEvent('mousedown')

  await expect.poll(async () => (await gh105Links()).map((l) => `${l.sourceId}>${l.targetId}@${norm(l.storedIn)}`))
    .toEqual([`${R.id}>${C.id}@${norm(P())}`])
  const chip = popover().locator(`[data-link-chip="${C.id}"]`)
  await expect(chip).toContainText(C.title)
  await expect(chip).toContainText(C.repoLabel)
  await s.shot('gh105-1-source')
  await s.page.keyboard.press('Escape')
})

test('GH105-2 — lien affiché sur la cible, navigation vers le repo de la source et retour (N5, N8)', async () => {
  await openDocView(cComboText)
  const line = linkLine(card(C.id), IN)
  await expect(line).toContainText(R.id)
  await s.shot('gh105-2-cible')

  await line.getByText(R.id, { exact: true }).click()
  await expect(card(R.id)).toBeVisible()
  // GH228 — le « ← Retour » de la vue système est remplacé par Précédent.
  await s.page.getByTestId('history-back').click()
  await expect(card(C.id)).toBeVisible()
})

test('GH105-3 — suppression depuis la cible, dans le repo qui stocke le lien (N6)', async () => {
  await openDocView(cComboText)
  await linkLine(card(C.id), IN).click()
  await popover().locator(`[data-link-chip="${R.id}"]`).getByRole('button', { name: '×' }).click()
  await expect.poll(async () => (await gh105Links()).length).toBe(0)
})

test('GH105-4 — pair absent du workspace : pastille « introuvable » (L4)', async () => {
  // Lien écrit sans validation (chemin historique, sans workspaceDir) vers un id inexistant.
  await s.invoke('requirements:link-create', P(), { type: LT, sourceId: R.id, targetId: 'GHOST-9999' })
  await openDocView(rTypeLabel)
  await linkLine(card(R.id), OUT).click()
  await expect(popover().locator('[data-link-chip="GHOST-9999"]')).toContainText('introuvable')
  await s.shot('gh105-4-introuvable')
  await s.page.keyboard.press('Escape')
})
