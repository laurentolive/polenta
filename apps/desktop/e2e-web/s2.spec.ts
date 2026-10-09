import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import WebSocket from 'ws'
import { E2E } from './support/env'
import { collectErrors, invoke, recordEvents, recordedEvents } from './support/helpers'

/**
 * GH44 — scénarios S2 de specs/GH44-tests.md, exécutés dans un navigateur réel (Chromium) sur le
 * serveur web buildé, avec une forge git locale (support/git-http-server.ts). Une seule session et
 * un seul projet, enchaînés dans l'ordre : chaque étape s'appuie sur la précédente.
 */
test.describe.configure({ mode: 'serial' })

const SHOTS = 'e2e-web/.results'
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const DRAWIO = '<mxfile><diagram id="d1" name="Page-1"><mxGraphModel><root><mxCell id="0"/>' +
  '<mxCell id="1" parent="0"/><mxCell id="node-e2e" value="E2E" vertex="1" parent="1">' +
  '<mxGeometry x="10" y="10" width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>'

interface ProjectInfo { workspaceDir: string; localPath: string }
interface SchemaLike {
  nodes: Array<{ name: string; objectTypes?: Array<{ name: string; category: string }> }>
  linkTypes?: Array<{ name: string; sourceRefs: string[]; targetRefs: string[] }>
}

let context: BrowserContext
let page: Page
let errors: string[]
let project: ProjectInfo
let createdReqId = ''

/** Aucune erreur console depuis le dernier contrôle (S2-20, AC 8). */
function expectNoErrors(): void {
  expect(errors, errors.join('\n')).toEqual([])
}

/** Boutons de la barre d'activité (colonne de gauche). */
function activityBar() {
  return page.locator('button.w-12.h-12[title]')
}

async function shot(name: string, p: Page = page): Promise<void> {
  await p.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}

function remoteLog(format: string): string {
  const bare = path.join(E2E.remotesDir, 'demo-ll800-produit.git')
  return execFileSync('git', ['-C', bare, 'log', '-1', `--format=${format}`], { encoding: 'utf-8' }).trim()
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ acceptDownloads: true })
  page = await context.newPage()
  errors = collectErrors(page)
})

test.afterAll(async () => {
  await context.close()
})

test('S2-1 — connexion et accueil web', async () => {
  await page.goto('/auth/login')
  await expect(page.getByText('Mes projets')).toBeVisible()
  // Pas d'ouverture de dossier local dans la version web.
  await expect(page.getByText('Ouvrir un projet existant', { exact: true })).toHaveCount(0)
  await shot('s2-1-accueil')
  expectNoErrors()
})

test('S2-2 — clone depuis l\'URL d\'un repo, ouverture', async () => {
  await page.getByText('Ouvrir un projet depuis un repo existant').click()
  await page.getByRole('textbox').fill(E2E.demoRemote)
  await page.getByRole('button', { name: 'Continuer' }).click()
  await page.waitForURL(/projectId=/, { timeout: 90_000 })
  await shot('s2-2-projet-ouvert')

  const last = await invoke<{ workspaceDir: string } | null>(page, 'workspace:get-last-opened')
  expect(last).not.toBeNull()
  project = await invoke<ProjectInfo>(page, 'workspace:resolve', last!.workspaceDir)
  // Clone dans l'espace serveur de l'utilisateur.
  expect(path.dirname(project.workspaceDir)).toBe(path.join(E2E.dataDir, 'users', E2E.user.login, 'workspaces'))
  expect(fs.existsSync(path.join(project.localPath, '.git'))).toBe(true)
  expectNoErrors()
})

test('S2-3 — parité : exigences, liens, vues', async () => {
  const schema = await invoke<SchemaLike>(page, 'schema:get', project.localPath)
  const root = schema.nodes[0]
  const reqType = root.objectTypes?.find(t => t.category === 'requirement')
  expect(reqType, 'type d\'exigence dans le schéma de la démo').toBeTruthy()

  // Création + modification d'une exigence (même service que le desktop, via le bridge).
  const created = await invoke<{ id: string }>(page, 'requirements:create', project.localPath, {
    objectTypeRef: `${root.name}::${reqType!.name}`,
    title: 'E2E — démarrage rapide',
    fields: { statement: 'WHEN the user presses the power button\nTHE system SHALL start within 500 ms' },
  }, project.workspaceDir)
  createdReqId = created.id
  expect(createdReqId).toMatch(/^[A-Z]+-\d+/)
  await invoke(page, 'requirements:update', project.localPath, createdReqId, { title: 'E2E — démarrage rapide (modifié)' }, project.workspaceDir)
  const reread = await invoke<{ title: string }>(page, 'requirements:get', project.localPath, createdReqId)
  expect(reread.title).toBe('E2E — démarrage rapide (modifié)')

  // Lien test → exigence.
  const tests = await invoke<Array<{ id: string }>>(page, 'tests:list', project.localPath)
  const linkType = schema.linkTypes?.find(l => l.sourceRefs.includes('test') || l.targetRefs.includes('test'))
  if (tests.length && linkType) {
    await invoke(page, 'requirements:link-create', project.localPath, { type: linkType.name, sourceId: tests[0].id, targetId: createdReqId })
    const links = await invoke<Array<{ sourceId: string; targetId: string }>>(page, 'requirements:links', project.localPath, createdReqId)
    expect(links.some(l => l.sourceId === tests[0].id && l.targetId === createdReqId)).toBe(true)
  }

  // Chaque vue de la barre d'activité s'affiche sans erreur.
  const titles = await activityBar().evaluateAll(els => els.map(e => e.getAttribute('title') ?? ''))
  expect(titles.length).toBeGreaterThan(5)
  for (const title of titles) {
    await page.keyboard.press('Escape')
    await activityBar().and(page.locator(`[title="${title}"]`)).click()
    await page.waitForTimeout(1500)
    await expect(page.getByText(/wasn't caught|Something went wrong/i)).toHaveCount(0)
    await shot(`s2-3-vue-${title.replace(/[^a-zA-Z0-9]+/g, '_')}`)
  }
  expectNoErrors()
})

test('S2-4 — image et diagramme draw.io par upload', async () => {
  const pickImage = invoke<{ status: string; path: string; copied: boolean }>(page, 'image:pick-file', project.localPath)
  const imageChooser = await page.waitForEvent('filechooser')
  await imageChooser.setFiles({ name: 'logo e2e.png', mimeType: 'image/png', buffer: PNG_1PX })
  const image = await pickImage
  expect(image).toEqual({ status: 'ok', path: 'images/logo e2e.png', copied: true })
  expect(fs.readFileSync(path.join(project.localPath, image.path))).toEqual(PNG_1PX)

  const pickDrawio = invoke<{ status: string; path: string }>(page, 'dialog:pick-drawio-file', project.localPath)
  const drawioChooser = await page.waitForEvent('filechooser')
  await drawioChooser.setFiles({ name: 'e2e.drawio', mimeType: 'application/xml', buffer: Buffer.from(DRAWIO) })
  const drawio = await pickDrawio
  expect(drawio.status).toBe('ok')
  expect(drawio.path).toBe('diagrams/e2e.drawio')
  const pages = await invoke<Array<{ name: string }>>(page, 'drawio:read', project.localPath, drawio.path)
  expect(pages?.length).toBeGreaterThan(0)

  // Annulation du sélecteur : même résultat que le dialogue natif annulé.
  const canceled = invoke<{ status: string }>(page, 'image:pick-file', project.localPath)
  const chooser = await page.waitForEvent('filechooser')
  await chooser.setFiles([])
  expect((await canceled).status).toBe('canceled')
  expectNoErrors()
})

test('S2-5 — export Word téléchargé, sans « Ouvrir le dossier »', async () => {
  // Vue Suivi (dashboard) : bouton Exporter de la barre de titre.
  await page.keyboard.press('Escape')
  await activityBar().and(page.locator('[title="Suivi"]')).click()
  await page.getByRole('button', { name: 'Exporter' }).first().click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Word' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.docx$/)
  const target = path.join(E2E.downloadsDir, download.suggestedFilename())
  await download.saveAs(target)
  expect(fs.statSync(target).size).toBeGreaterThan(1000)
  await expect(page.getByText(/^Téléchargé :/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ouvrir le dossier' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Ouvrir le fichier' })).toHaveCount(0)
  await shot('s2-5-export')
  await page.keyboard.press('Escape')
  expectNoErrors()
})

test('S2-6 — classeur d\'exécution : export puis réimport', async () => {
  const campaigns = await invoke<Array<{ id: string; status: string }>>(page, 'campaigns:list', project.localPath)
  // Règle métier GH36 : pas d'exécution hors outil sur une campagne clôturée — vérifiée au passage.
  const closed = campaigns.find(c => c.status === 'completed' || c.status === 'abandoned')
  if (closed) {
    const refused = await invoke<{ status: string; message?: string }>(page, 'campaigns:execution-sheet-export', project.localPath, closed.id, 'fr')
    expect(refused.status).toBe('error')
    expect(refused.message).toMatch(/clôturée/)
  }
  const open = campaigns.find(c => c.status !== 'completed' && c.status !== 'abandoned')
  test.skip(!open, 'aucune campagne ouverte dans la démo')
  const campaignId = open!.id

  const downloadPromise = page.waitForEvent('download')
  const exported = await invoke<{ status: string; filePath?: string }>(page, 'campaigns:execution-sheet-export', project.localPath, campaignId, 'fr')
  expect(exported, JSON.stringify(exported)).toMatchObject({ status: 'ok' })
  const download = await downloadPromise
  const sheet = path.join(E2E.downloadsDir, download.suggestedFilename())
  await download.saveAs(sheet)
  expect(download.suggestedFilename()).toMatch(new RegExp(`^${campaignId}_execution_.*\\.xlsx$`))

  const previewPromise = invoke<{ fileName: string; filePath: string; fatal?: unknown }>(page, 'campaigns:execution-sheet-preview', project.localPath, campaignId)
  const chooser = await page.waitForEvent('filechooser')
  await chooser.setFiles(sheet)
  const preview = await previewPromise
  expect(preview.fatal).toBeUndefined()
  expect(preview.fileName).toBe(download.suggestedFilename())
  // Le classeur non rempli n'apporte aucun verdict : l'application est un no-op sans erreur.
  await invoke(page, 'campaigns:execution-sheet-apply', project.localPath, campaignId, preview.filePath, project.workspaceDir)
  expectNoErrors()
})

test('S2-7 — deux onglets : une écriture de l\'un est notifiée à l\'autre', async () => {
  const second = await context.newPage()
  const secondErrors = collectErrors(second)
  await second.goto(page.url())
  await second.waitForLoadState('networkidle')
  await recordEvents(second, 'repo:file-changed', 'changes')
  await invoke(page, 'requirements:update', project.localPath, createdReqId, { title: 'E2E — vu depuis le second onglet' }, project.workspaceDir)
  await expect.poll(async () => (await recordedEvents(second, 'changes'))
    .some(([repo, rel]) => repo === project.localPath && String(rel).includes(createdReqId)), { timeout: 15_000 }).toBe(true)
  await shot('s2-7-second-onglet', second)
  expect(secondErrors).toEqual([])
  await second.close()
})

test('S2-8 — coupure réseau : reconnexion des événements', async () => {
  // La connexion d'événements passe par le test, qui peut la couper comme une perte de réseau
  // (`setOffline` seul ne ferme pas une WebSocket déjà ouverte).
  const pageSockets: Array<{ close(opts?: { code?: number; reason?: string }): Promise<void> }> = []
  await page.routeWebSocket(/\/events$/, ws => {
    ws.connectToServer()
    pageSockets.push(ws)
  })
  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect.poll(() => pageSockets.length).toBeGreaterThan(0)
  await recordEvents(page, 'web:events-reconnected', 'reconnected')

  await context.setOffline(true)
  await pageSockets[pageSockets.length - 1].close({ code: 1001, reason: 'coupure simulée' })
  await page.waitForTimeout(3000) // tentatives de reconnexion hors ligne
  await context.setOffline(false)
  await expect.poll(async () => (await recordedEvents(page, 'reconnected')).length, { timeout: 30_000 }).toBeGreaterThan(0)

  // Les événements circulent de nouveau après la reconnexion.
  await recordEvents(page, 'repo:file-changed', 'afterReconnect')
  await invoke(page, 'requirements:update', project.localPath, createdReqId, { title: 'E2E — après reconnexion' }, project.workspaceDir)
  await expect.poll(async () => (await recordedEvents(page, 'afterReconnect')).length, { timeout: 15_000 }).toBeGreaterThan(0)
  await page.unrouteAll()
  // Erreurs réseau attendues pendant la coupure : non imputables à l'application.
  errors.splice(0, errors.length, ...errors.filter(e => !/WebSocket|ERR_INTERNET_DISCONNECTED|Failed to fetch|net::/i.test(e)))
  expectNoErrors()
})

test('S2-9 — Publier : commit à l\'identité de l\'utilisateur, poussé vers la forge', async () => {
  const before = remoteLog('%H')
  await page.getByRole('button', { name: 'Publier' }).first().click()
  await page.getByPlaceholder(/Titre de la modification/).fill('E2E : publication depuis le web')
  await shot('s2-9-popover')
  await page.getByRole('button', { name: 'Publier' }).last().click()
  await expect.poll(() => remoteLog('%H'), { timeout: 60_000 }).not.toBe(before)
  await shot('s2-9-publie')
  expect(remoteLog('%an <%ae>')).toBe(`${E2E.user.name} <${E2E.user.email}>`)
  const files = execFileSync('git', ['-C', path.join(E2E.remotesDir, 'demo-ll800-produit.git'), 'log', '-3', '--name-only', '--format='], { encoding: 'utf-8' })
  expect(files).toContain(createdReqId)
  expect(files).toContain('images/logo e2e.png')
  expectNoErrors()
})

test('S2-25 — WebSocket depuis une autre origine refusé', async () => {
  const cookies = await context.cookies()
  const cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ')
  const code = await new Promise<number>((resolve, reject) => {
    const ws = new WebSocket(`${E2E.baseUrl.replace('http', 'ws')}/events`, { headers: { Origin: 'http://127.0.0.1:9999', Cookie: cookie } })
    ws.on('close', c => resolve(c))
    ws.on('error', reject)
  })
  expect(code).toBe(4403)
  // Même origine : connexion conservée.
  const same = await new Promise<boolean>((resolve) => {
    const ws = new WebSocket(`${E2E.baseUrl.replace('http', 'ws')}/events`, { headers: { Origin: E2E.baseUrl, Cookie: cookie } })
    ws.on('open', () => setTimeout(() => { resolve(ws.readyState === WebSocket.OPEN); ws.close() }, 500))
    ws.on('close', () => resolve(false))
  })
  expect(same).toBe(true)
})

test('S2-20 — aucune erreur console sur l\'ensemble du parcours', async () => {
  expectNoErrors()
})
