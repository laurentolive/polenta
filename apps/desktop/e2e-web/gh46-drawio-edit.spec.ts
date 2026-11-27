import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import { setupSession } from './support/session'

/**
 * GH46 — édition d'un diagramme `.drawio` dans le client web, avec l'éditeur draw.io embarqué
 * (specs/GH46.md, GH46-design.md, GH46-tests.md). Les modifications sont faites par le protocole de
 * l'éditeur (`load`), comme le ferait l'utilisateur ; l'enregistrement passe par `export` puis
 * `web:drawio-save`. Le test porte sur le fichier du repo, pas sur le composant.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

const REL = 'diagrams/gh46.drawio'
const TYPE_NAME = 'gh46_diagrammes'
const TYPE_LABEL = 'GH46 Diagrammes'
const DIAGRAM = (id: string, name: string, label: string) =>
  `<diagram id="${id}" name="${name}"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="${label}" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel></diagram>`
const TWO_PAGES = `<mxfile host="gh46">${DIAGRAM('p1', 'Page-1', 'Bloc initial')}${DIAGRAM('p2', 'Page-2', 'Bloc deux')}</mxfile>`
const EDITED = `<mxfile host="gh46">${DIAGRAM('p1', 'Page-1', 'Bloc GH46 modifié')}${DIAGRAM('p2', 'Page-2', 'Bloc deux')}</mxfile>`
const EXTERNAL = `<mxfile host="tiers">${DIAGRAM('p1', 'Page-1', 'Modifié hors Polenta')}</mxfile>`

interface SchemaLike { nodes: Array<{ name: string; objectTypes?: Array<{ name: string; category: string; fields: unknown[]; statuses?: unknown[]; label?: string; prefix?: string }> }> }
interface ReqLike { id: string; fields: Record<string, unknown> }

let reqId = ''
let abs = ''

const sha = (text: string) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')
const onDisk = () => fs.readFileSync(abs, 'utf8')
const frameSel = 'iframe[title="Éditeur draw.io"]'

test.beforeAll(async () => {
  const { localPath } = s.project
  abs = path.join(localPath, REL)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, TWO_PAGES, 'utf8')

  await s.invoke('schema:invalidate', localPath)
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []), {
    name: TYPE_NAME, label: TYPE_LABEL, prefix: 'GHD', category: 'requirement',
    fields: [{ name: 'diagram', label: 'Diagramme', type: 'drawio' }],
    statuses: [{ name: 'brouillon', label: 'Brouillon' }],
  }]
  await s.invoke('schema:save', localPath, schema)
  reqId = (await s.invoke<ReqLike>('requirements:create', localPath, {
    objectTypeRef: `root::${TYPE_NAME}`, title: 'GH46 diagramme', fields: { diagram: REL },
  })).id
})

async function openForm(): Promise<void> {
  await s.openView('Exigences')
  const combo = s.page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(TYPE_LABEL)
  await combo.press('Enter')
  await s.page.getByTitle('Vue tableau').click()
  await s.page.waitForLoadState('networkidle')
  const row = s.page.locator('tr').filter({ hasText: reqId }).first()
  await row.getByTitle(/Éditer|Modifier/).first().click()
  await expect(s.page.getByRole('button', { name: 'Modifier', exact: true })).toBeVisible()
}

async function openEditor(): Promise<void> {
  await s.page.getByRole('button', { name: 'Modifier', exact: true }).click()
  await expect(s.page.getByTestId('drawio-editor-dialog')).toBeVisible()
  // L'éditeur (≈ 80 Mo de scripts) est prêt quand il a chargé le diagramme.
  await expect(s.page.getByTestId('drawio-editor-dialog').getByText('Éditeur prêt')).toBeVisible({ timeout: 60_000 })
}

/** Remplace le diagramme affiché dans l'éditeur, comme une modification de l'utilisateur. */
async function editInEditor(xml: string): Promise<void> {
  await s.page.evaluate(({ sel, data }) => {
    const frame = document.querySelector<HTMLIFrameElement>(sel)!
    frame.contentWindow!.postMessage(JSON.stringify({ action: 'load', xml: data }), window.location.origin)
  }, { sel: frameSel, data: xml })
  // L'éditeur a traité le message (il réexporte son XML courant) : on laisse la boucle d'événements finir.
  await s.page.waitForTimeout(500)
}

test('GH46-1 — bouton « Modifier » sur le champ diagramme, ouvre la fenêtre de l’éditeur', async () => {
  await openForm()
  await openEditor()
  await expect(s.page.locator(frameSel)).toHaveAttribute('src', /\/drawio-editor\/index\.html\?.*embed=1.*proto=json/)
})

test('GH46-2 — ouverture et enregistrement sans requête vers diagrams.net', async () => {
  const hosts: string[] = []
  const onRequest = (req: { url(): string }) => {
    const host = new URL(req.url()).host
    if (/diagrams\.net$/.test(host)) hosts.push(host)
  }
  s.page.on('request', onRequest)
  try {
    await s.page.reload()
    await openForm()
    await openEditor()
    await editInEditor(EDITED)
    await s.page.getByTestId('drawio-editor-dialog').getByRole('button', { name: 'Enregistrer', exact: true }).click()
    await expect(s.page.getByTestId('drawio-editor-dialog').getByRole('status')).toHaveText('Enregistré.')
  } finally {
    s.page.off('request', onRequest)
  }
  expect(hosts).toEqual([])
})

test('GH46-3 — enregistrer écrit le diagramme dans le repo et le bloc le relit', async () => {
  const saved = onDisk()
  expect(saved).toContain('Bloc GH46 modifié')
  const read = await s.invoke<Array<{ name: string; xml: string }> | null>('drawio:read', s.project.localPath, REL)
  expect(read?.[0]?.xml).toContain('Bloc GH46 modifié')
})

test('GH46-4 — fermer sans enregistrer laisse le fichier intact', async () => {
  await s.page.reload()
  await openForm()
  await openEditor()
  const before = sha(onDisk())
  await editInEditor(TWO_PAGES.replace('Bloc initial', 'Bloc non enregistré'))
  await s.page.getByTestId('drawio-editor-dialog').getByRole('button', { name: 'Fermer', exact: true }).click()
  const confirm = s.page.getByRole('alertdialog', { name: 'Quitter sans enregistrer' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Quitter sans enregistrer' }).click()
  await expect(s.page.getByTestId('drawio-editor-dialog')).toHaveCount(0)
  expect(sha(onDisk())).toBe(before)
})

test('GH46-5 — fenêtre ouverte : l’avertissement de fermeture du navigateur est armé', async () => {
  await openEditor()
  const armed = await s.page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(armed).toBe(true)
  await s.page.getByTestId('drawio-editor-dialog').getByRole('button', { name: 'Fermer', exact: true }).click()
  const confirm = s.page.getByRole('alertdialog', { name: 'Quitter sans enregistrer' })
  if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: 'Quitter sans enregistrer' }).click()
  await expect(s.page.getByTestId('drawio-editor-dialog')).toHaveCount(0)
  const after = await s.page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(after).toBe(false)
})

test('GH46-6 — fichier à deux pages : les deux pages sont conservées après enregistrement', async () => {
  await s.page.reload()
  await openForm()
  await openEditor()
  await editInEditor(EDITED)
  await s.page.getByTestId('drawio-editor-dialog').getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(s.page.getByTestId('drawio-editor-dialog').getByRole('status')).toHaveText('Enregistré.')
  const pages = await s.invoke<Array<{ name: string }> | null>('drawio:read', s.project.localPath, REL)
  expect(pages?.map(p => p.name)).toEqual(['Page-1', 'Page-2'])
})

test('GH46-7 — fichier modifié hors Polenta pendant l’édition : conflit, rien d’écrasé', async () => {
  await s.page.reload()
  await openForm()
  await openEditor()
  // Modification faite hors de Polenta (autre outil, autre utilisateur) pendant que la fenêtre est ouverte.
  fs.writeFileSync(abs, EXTERNAL, 'utf8')
  await editInEditor(EDITED)
  await s.page.getByTestId('drawio-editor-dialog').getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(s.page.getByTestId('drawio-editor-dialog').getByRole('status')).toContainText('Rien n’a été écrasé')
  await expect(s.page.getByRole('button', { name: 'Recharger', exact: true })).toBeVisible()
  expect(onDisk()).toBe(EXTERNAL)
})
