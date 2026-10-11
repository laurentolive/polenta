import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import WebSocket from 'ws'
import { E2E } from './support/env'
import { remoteChangedFiles, remoteLog } from './support/forge'
import { DRAWIO_MINIMAL, PNG_1PX } from './support/files'
import { collectErrors, recordEvents, recordedEvents } from './support/helpers'
import { activityBar, setupSession, type ProjectInfo } from './support/session'

/**
 * GH44 — scénarios S2 de specs/GH44-tests.md (serveur web, bridge navigateur, mode dev). Le projet
 * est cloné par l'interface (S2-2) : la session démarre sans projet.
 */
const s = setupSession({ project: null })

interface SchemaLike {
  nodes: Array<{ name: string; objectTypes?: Array<{ name: string; category: string }> }>
  linkTypes?: Array<{ name: string; sourceRefs: string[]; targetRefs: string[] }>
}

let project: ProjectInfo
let createdReqId = ''

test('S2-1 — connexion et accueil web', async () => {
  // Le serveur garde le dernier projet ouvert par l'utilisateur (autres fichiers de test).
  await s.invoke('workspace:clear-last-opened')
  await s.page.goto('/')
  await expect(s.page.getByText('Mes projets')).toBeVisible()
  // Pas d'ouverture de dossier local dans la version web.
  await expect(s.page.getByText('Ouvrir un projet existant', { exact: true })).toHaveCount(0)
  await s.shot('s2-1-accueil')
})

test('S2-2 — clone depuis l\'URL d\'un repo, ouverture', async () => {
  await s.page.getByText('Ouvrir un projet depuis un repo existant').click()
  await s.page.getByRole('textbox').fill(E2E.demoRemote)
  await s.page.getByRole('button', { name: 'Continuer' }).click()
  await s.page.waitForURL(/projectId=/, { timeout: 90_000 })
  await s.shot('s2-2-projet-ouvert')

  const last = await s.invoke<{ workspaceDir: string } | null>('workspace:get-last-opened')
  expect(last).not.toBeNull()
  project = await s.invoke<ProjectInfo>('workspace:resolve', last!.workspaceDir)
  // Clone dans l'espace serveur de l'utilisateur.
  expect(path.dirname(project.workspaceDir)).toBe(path.join(E2E.dataDir, 'users', E2E.user.login, 'workspaces'))
  expect(fs.existsSync(path.join(project.localPath, '.git'))).toBe(true)
})

test('S2-3 — parité : exigences, liens, vues', async () => {
  const schema = await s.invoke<SchemaLike>('schema:get', project.localPath)
  const root = schema.nodes[0]
  const reqType = root.objectTypes?.find(t => t.category === 'requirement')
  expect(reqType, 'type d\'exigence dans le schéma de la démo').toBeTruthy()

  // Création + modification d'une exigence (même service que le desktop, via le bridge).
  const created = await s.invoke<{ id: string }>('requirements:create', project.localPath, {
    objectTypeRef: `${root.name}::${reqType!.name}`,
    title: 'E2E — démarrage rapide',
    fields: { statement: 'WHEN the user presses the power button\nTHE system SHALL start within 500 ms' },
  }, project.workspaceDir)
  createdReqId = created.id
  expect(createdReqId).toMatch(/^[A-Z]+-\d+/)
  await s.invoke('requirements:update', project.localPath, createdReqId, { title: 'E2E — démarrage rapide (modifié)' }, project.workspaceDir)
  const reread = await s.invoke<{ title: string }>('requirements:get', project.localPath, createdReqId)
  expect(reread.title).toBe('E2E — démarrage rapide (modifié)')

  // Lien test → exigence.
  const tests = await s.invoke<Array<{ id: string }>>('tests:list', project.localPath)
  const linkType = schema.linkTypes?.find(l => l.sourceRefs.includes('test') || l.targetRefs.includes('test'))
  if (tests.length && linkType) {
    await s.invoke('requirements:link-create', project.localPath, { type: linkType.name, sourceId: tests[0].id, targetId: createdReqId })
    const links = await s.invoke<Array<{ sourceId: string; targetId: string }>>('requirements:links', project.localPath, createdReqId)
    expect(links.some(l => l.sourceId === tests[0].id && l.targetId === createdReqId)).toBe(true)
  }

  // Chaque vue de la barre d'activité s'affiche sans erreur.
  const titles = await activityBar(s.page).evaluateAll(els => els.map(e => e.getAttribute('title') ?? ''))
  expect(titles.length).toBeGreaterThan(5)
  for (const title of titles) {
    await s.openView(title)
    await s.page.waitForTimeout(1000)
    await expect(s.page.getByText(/wasn't caught|Something went wrong/i)).toHaveCount(0)
    await s.shot(`s2-3-vue-${title.replace(/[^a-zA-Z0-9]+/g, '_')}`)
  }
})

test('S2-4 — image et diagramme draw.io par upload', async () => {
  const pickImage = s.invoke<{ status: string; path: string; copied: boolean }>('image:pick-file', project.localPath)
  const imageChooser = await s.page.waitForEvent('filechooser')
  await imageChooser.setFiles({ name: 'logo e2e.png', mimeType: 'image/png', buffer: PNG_1PX })
  const image = await pickImage
  expect(image).toEqual({ status: 'ok', path: 'images/logo e2e.png', copied: true })
  expect(fs.readFileSync(path.join(project.localPath, image.path))).toEqual(PNG_1PX)

  const pickDrawio = s.invoke<{ status: string; path: string }>('dialog:pick-drawio-file', project.localPath)
  const drawioChooser = await s.page.waitForEvent('filechooser')
  await drawioChooser.setFiles({ name: 'e2e.drawio', mimeType: 'application/xml', buffer: DRAWIO_MINIMAL })
  const drawio = await pickDrawio
  expect(drawio).toMatchObject({ status: 'ok', path: 'diagrams/e2e.drawio' })
  const pages = await s.invoke<Array<{ name: string }>>('drawio:read', project.localPath, drawio.path)
  expect(pages?.length).toBeGreaterThan(0)

  // Annulation du sélecteur : même résultat que le dialogue natif annulé.
  const canceled = s.invoke<{ status: string }>('image:pick-file', project.localPath)
  const chooser = await s.page.waitForEvent('filechooser')
  await chooser.setFiles([])
  expect((await canceled).status).toBe('canceled')
})

test('S2-5 — export Word téléchargé, sans « Ouvrir le dossier »', async () => {
  await s.openView('Suivi')
  await s.page.getByRole('button', { name: 'Exporter' }).first().click()
  const downloadPromise = s.page.waitForEvent('download')
  await s.page.getByRole('button', { name: 'Word' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.docx$/)
  const target = path.join(E2E.downloadsDir, download.suggestedFilename())
  await download.saveAs(target)
  expect(fs.statSync(target).size).toBeGreaterThan(1000)
  await expect(s.page.getByText(/^Téléchargé :/)).toBeVisible()
  await expect(s.page.getByRole('button', { name: 'Ouvrir le dossier' })).toHaveCount(0)
  await expect(s.page.getByRole('button', { name: 'Ouvrir le fichier' })).toHaveCount(0)
  await s.shot('s2-5-export')
  await s.page.keyboard.press('Escape')
})

test('S2-6 — classeur d\'exécution : export puis réimport', async () => {
  const campaigns = await s.invoke<Array<{ id: string; status: string }>>('campaigns:list', project.localPath)
  // Règle métier GH36 : pas d'exécution hors outil sur une campagne clôturée — vérifiée au passage.
  const closed = campaigns.find(c => c.status === 'completed' || c.status === 'abandoned')
  if (closed) {
    const refused = await s.invoke<{ status: string; message?: string }>('campaigns:execution-sheet-export', project.localPath, closed.id, 'fr')
    expect(refused.status).toBe('error')
    expect(refused.message).toMatch(/clôturée/)
  }
  const open = campaigns.find(c => c.status !== 'completed' && c.status !== 'abandoned')
  test.skip(!open, 'aucune campagne ouverte dans la démo')
  const campaignId = open!.id

  const downloadPromise = s.page.waitForEvent('download')
  const exported = await s.invoke<{ status: string }>('campaigns:execution-sheet-export', project.localPath, campaignId, 'fr')
  expect(exported, JSON.stringify(exported)).toMatchObject({ status: 'ok' })
  const download = await downloadPromise
  const sheet = path.join(E2E.downloadsDir, download.suggestedFilename())
  await download.saveAs(sheet)
  expect(download.suggestedFilename()).toMatch(new RegExp(`^${campaignId}_execution_.*\\.xlsx$`))

  const previewPromise = s.invoke<{ fileName: string; filePath: string; fatal?: unknown }>('campaigns:execution-sheet-preview', project.localPath, campaignId)
  const chooser = await s.page.waitForEvent('filechooser')
  await chooser.setFiles(sheet)
  const preview = await previewPromise
  expect(preview.fatal).toBeUndefined()
  expect(preview.fileName).toBe(download.suggestedFilename())
  // Le classeur non rempli n'apporte aucun verdict : l'application est un no-op sans erreur.
  await s.invoke('campaigns:execution-sheet-apply', project.localPath, campaignId, preview.filePath, project.workspaceDir)
})

test('S2-7 — deux onglets : une écriture de l\'un est notifiée à l\'autre', async () => {
  const second = await s.context.newPage()
  const secondErrors = collectErrors(second)
  await second.goto(s.page.url())
  await second.waitForLoadState('networkidle')
  await recordEvents(second, 'repo:file-changed', 'changes')
  await s.invoke('requirements:update', project.localPath, createdReqId, { title: 'E2E — vu depuis le second onglet' }, project.workspaceDir)
  await expect.poll(async () => (await recordedEvents(second, 'changes'))
    .some(([repo, rel]) => repo === project.localPath && String(rel).includes(createdReqId)), { timeout: 15_000 }).toBe(true)
  await s.shot('s2-7-second-onglet', second)
  expect(secondErrors).toEqual([])
  await second.close()
})

test('S2-8 — coupure réseau : reconnexion des événements', async () => {
  // Erreurs réseau attendues pendant la coupure : non imputables à l'application.
  s.allowConsoleErrors(/WebSocket|ERR_INTERNET_DISCONNECTED|Failed to fetch|net::/i)
  // La connexion d'événements passe par le test, qui peut la couper comme une perte de réseau
  // (`setOffline` seul ne ferme pas une WebSocket déjà ouverte).
  const pageSockets: Array<{ close(opts?: { code?: number; reason?: string }): Promise<void> }> = []
  await s.page.routeWebSocket(/\/events$/, ws => {
    ws.connectToServer()
    pageSockets.push(ws)
  })
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
  await expect.poll(() => pageSockets.length).toBeGreaterThan(0)
  await recordEvents(s.page, 'web:events-reconnected', 'reconnected')

  await s.context.setOffline(true)
  await pageSockets[pageSockets.length - 1].close({ code: 1001, reason: 'coupure simulée' })
  await s.page.waitForTimeout(3000) // tentatives de reconnexion hors ligne
  await s.context.setOffline(false)
  await expect.poll(async () => (await recordedEvents(s.page, 'reconnected')).length, { timeout: 30_000 }).toBeGreaterThan(0)

  // Les événements circulent de nouveau après la reconnexion.
  await recordEvents(s.page, 'repo:file-changed', 'afterReconnect')
  await s.invoke('requirements:update', project.localPath, createdReqId, { title: 'E2E — après reconnexion' }, project.workspaceDir)
  await expect.poll(async () => (await recordedEvents(s.page, 'afterReconnect')).length, { timeout: 15_000 }).toBeGreaterThan(0)
  await s.page.unrouteAll()
})

test('S2-9 — Publier : commit à l\'identité de l\'utilisateur, poussé vers la forge', async () => {
  const before = remoteLog('%H')
  await s.page.getByRole('button', { name: 'Publier' }).first().click()
  await s.page.getByPlaceholder(/Titre de la modification/).fill('E2E : publication depuis le web')
  await s.shot('s2-9-popover')
  await s.page.getByRole('button', { name: 'Publier' }).last().click()
  await expect.poll(() => remoteLog('%H'), { timeout: 60_000 }).not.toBe(before)
  await s.shot('s2-9-publie')
  expect(remoteLog('%an <%ae>')).toBe(`${E2E.user.name} <${E2E.user.email}>`)
  const files = remoteChangedFiles(3)
  expect(files).toContain(createdReqId)
  expect(files).toContain('images/logo e2e.png')
})

test('S2-25 — WebSocket depuis une autre origine refusé', async () => {
  const cookies = await s.context.cookies()
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

// S2-20 (aucune erreur console) : vérifié après chaque test par `setupSession`.
