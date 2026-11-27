import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH468 — « Publier » avec beaucoup de conflits : la popup « Publication impossible » liste chaque
 * fichier en conflit. Sans hauteur bornée, elle sortait de la fenêtre et « Résoudre les conflits »
 * (en bas) était inaccessible : aucune fusion ne démarrait. Vérifié dans une fenêtre 1280 × 720
 * avec 90 fichiers en conflit entre la branche de travail et l'intégration.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

const WORK = 'dev-gh468'
// Noms sans tiret ni barre : aucun point de coupure, donc un mot long peut déborder la largeur de la
// popup et faire apparaître une barre de défilement en largeur.
const FILES = Array.from({ length: 90 }, (_, i) => `gh468_EXIGENCE_SYSTEME_LONGUE_DESCRIPTION_FICHIER_${String(i + 1).padStart(2, '0')}.txt`)
const GRAPH_WORK = 'dev-gh468-arbre'
const GRAPH_FILES = Array.from({ length: 90 }, (_, i) => `gh468_arbre_EXIGENCE_SYSTEME_LONGUE_DESCRIPTION_FICHIER_${String(i + 1).padStart(2, '0')}.txt`)

interface IntegrationState { currentBranch: string; configured: string }

const state = () => s.invoke<IntegrationState>('integration:state', s.project.localPath)

function writeAll(content: string, files: string[] = FILES) {
  for (const rel of files) {
    const full = path.join(s.project.localPath, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
}

async function commit(message: string) {
  await s.invoke('sync:stage-all', s.project.localPath)
  await s.invoke('sync:commit', s.project.localPath, message)
}

test('GH468-1 — 90 fichiers en conflit : la popup tient dans la fenêtre et « Résoudre les conflits » ouvre la fusion', async () => {
  const { localPath } = s.project
  await s.page.setViewportSize({ width: 1280, height: 720 })

  // Ma branche de travail et l'intégration divergent sur les mêmes 90 fichiers.
  const { currentBranch, configured } = await state()
  if (currentBranch !== configured) await s.invoke('sync:checkout-branch', localPath, configured)
  await s.invoke('sync:create-branch', localPath, WORK)
  await s.invoke('sync:checkout-branch', localPath, WORK)
  writeAll('mon travail\n')
  await commit('GH468 mon travail')
  await s.invoke('sync:checkout-branch', localPath, configured)
  writeAll('la version de l\'équipe\n')
  await commit('GH468 équipe')
  await s.invoke('sync:checkout-branch', localPath, WORK)
  // Une modif en cours sur la branche de travail : « Publier » est actif.
  fs.writeFileSync(path.join(localPath, FILES[0]), 'mon travail en cours\n')
  await s.page.reload({ waitUntil: 'networkidle' })

  // « Publier » fusionne la branche de travail dans l'intégration : conflits sur les 90 fichiers.
  await s.page.getByRole('button', { name: 'Publier', exact: true }).first().click()
  const title = s.page.getByPlaceholder('Titre de la modification…')
  await title.fill('GH468 publication')
  await title.press('Enter')

  await expect(s.page.getByText('Publication impossible', { exact: true })).toBeVisible({ timeout: 60_000 })
  const resolve = s.page.getByRole('button', { name: 'Résoudre les conflits', exact: true })
  await expect(resolve).toBeVisible()
  // Le symptôme : le bouton doit être dans la fenêtre, pas coupé en bas de l'écran.
  const viewport = s.page.viewportSize()!
  const box = await resolve.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
  // Pas de défilement en largeur dans la popup (noms de fichiers longs compris).
  const overflowing = await s.page.getByText('Publication impossible', { exact: true }).evaluate(h => {
    const pop = h.parentElement!
    return [pop, ...pop.querySelectorAll('*')]
      .filter(el => el instanceof HTMLElement && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
      .map(el => `${el.tagName.toLowerCase()} « ${(el.textContent ?? '').trim().slice(0, 40)} »`)
  })
  expect(overflowing).toEqual([])
  await s.shot('gh468-1-popup')

  // Cliquable : la fusion démarre dans l'éditeur de résolution.
  await resolve.click()
  await expect(s.page.getByTestId('merge-files-panel')).toContainText('FICHIER_01.txt', { timeout: 60_000 })
  await s.shot('gh468-1-resolution')
})

test('GH468-2 — fusion depuis le clic droit sur la branche (vue arbre de versions) : le bouton reste dans la fenêtre', async () => {
  const { localPath } = s.project
  await s.page.setViewportSize({ width: 1280, height: 720 })

  // Même conflit, fusion lancée depuis le menu contextuel de la branche dans l'arbre.
  const { currentBranch, configured } = await state()
  if (currentBranch !== configured) await s.invoke('sync:checkout-branch', localPath, configured)
  await s.invoke('sync:create-branch', localPath, GRAPH_WORK)
  await s.invoke('sync:checkout-branch', localPath, GRAPH_WORK)
  writeAll('mon travail\n', GRAPH_FILES)
  await commit('GH468 arbre mon travail')
  await s.invoke('sync:checkout-branch', localPath, configured)
  writeAll("la version de l'équipe\n", GRAPH_FILES)
  await commit('GH468 arbre équipe')

  await s.page.evaluate(u => { history.pushState({}, '', u); dispatchEvent(new PopStateEvent('popstate')) },
    s.projectUrl('/graph', { repoPath: localPath }))
  await s.page.waitForLoadState('networkidle')
  await s.page.getByText(GRAPH_WORK, { exact: true }).first().click({ button: 'right' })
  await s.page.getByRole('button', { name: 'Merger branche dans…' }).click()
  await s.page.getByRole('button', { name: configured, exact: true }).click()

  const resolve = s.page.getByRole('button', { name: 'Résoudre les conflits', exact: true })
  await expect(resolve).toBeVisible({ timeout: 60_000 })
  const viewport = s.page.viewportSize()!
  const box = await resolve.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
  // Pas de défilement en largeur dans le menu (message d'erreur compris).
  const overflowing = await resolve.evaluate(btn => {
    const menu = btn.closest('.fixed') as HTMLElement
    return [menu, ...menu.querySelectorAll('*')]
      .filter(el => el instanceof HTMLElement && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
      .map(el => `${el.tagName.toLowerCase()} « ${(el.textContent ?? '').trim().slice(0, 40)} »`)
  })
  expect(overflowing).toEqual([])
  await s.shot('gh468-2-menu')

  await resolve.click()
  await expect(s.page.getByTestId('merge-files-panel')).toContainText('FICHIER_01.txt', { timeout: 60_000 })
})
