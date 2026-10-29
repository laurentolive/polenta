import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import yaml from 'js-yaml'
import { setupSession } from './support/session'

/**
 * GH222 sprint 2 — mise en évidence des différences (specs/GH222-tests.md H1–H11) : diff Raw sur
 * `@codemirror/merge` (fond plein, caractères, règle de vue d'ensemble, navigation `F7`,
 * côte à côte / en ligne, hachures, pas de troncature) et résolution de conflits Raw (ce que chaque
 * côté a changé, actions dans chaque panneau, « Prendre les deux », « Réinitialiser », compteurs).
 *
 * Fixtures écrites directement dans le repo du projet (même machine que le serveur web), commitées
 * par les canaux du client.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

const dump = (o: unknown) => yaml.dump(o, { lineWidth: 120 })
let cTitle = ''
let cBig = ''
let currentBranch = ''
let sessionId = ''

async function write(rel: string, content: string) {
  const full = path.join(s.project.localPath, rel)
  await fs.promises.mkdir(path.dirname(full), { recursive: true })
  await fs.promises.writeFile(full, content)
}

async function commit(message: string): Promise<string> {
  const { localPath } = s.project
  await s.invoke('sync:stage-all', localPath)
  await s.invoke('sync:commit', localPath, message)
  return s.invoke<string>('git:head-sha', localPath)
}

const bigLines = (changed: Record<number, string>, inserted: Record<number, string[]> = {}) => {
  const out: string[] = []
  for (let i = 1; i <= 5000; i++) {
    out.push(changed[i] ?? `ligne ${i}`)
    for (const extra of inserted[i] ?? []) out.push(extra)
  }
  return `${out.join('\n')}\n`
}

test.beforeAll(async () => {
  const { localPath } = s.project
  // Diff : un titre dont un seul mot change, et un fichier de 5 000 lignes à 5 changements.
  await write('gh222/titre.yaml', dump({ id: 'X', priority: 'high', title: 'Démarrage rapide alpha' }))
  await write('gh222/big.txt', bigLines({}))
  await commit('GH222 base diff')
  await write('gh222/titre.yaml', dump({ id: 'X', priority: 'low', title: 'Démarrage rapide beta' }))
  cTitle = await commit('GH222 titre')
  await write('gh222/big.txt', bigLines({ 10: 'changée 10', 1200: 'changée 1200', 2500: 'changée 2500', 4990: 'changée 4990' }, { 3700: ['ajout a', 'ajout b', 'ajout c'] }))
  cBig = await commit('GH222 big')

  // Merge : deux fichiers YAML génériques en conflit entre une branche et la branche courante.
  const branches = await s.invoke<Array<{ name: string; isCurrent: boolean }>>('sync:branches', localPath)
  currentBranch = branches.find(b => b.isCurrent)!.name
  const base = { title: 'base', rows: [['un'], ['deux']], note: 'ligne 1\nligne 2\n', keep: 'commun' }
  await write('gh222/conflit-a.yaml', dump(base))
  await write('gh222/conflit-b.yaml', dump({ value: 'base' }))
  await commit('GH222 base merge')
  await s.invoke('sync:create-branch', localPath, 'gh222-gauche')
  await write('gh222/conflit-a.yaml', dump({ ...base, title: 'titre gauche', rows: [['un'], ['GAUCHE']] }))
  await write('gh222/conflit-b.yaml', dump({ value: 'gauche' }))
  await commit('GH222 gauche')
  await s.invoke('sync:checkout-branch', localPath, currentBranch)
  await write('gh222/conflit-a.yaml', dump({ ...base, title: 'titre droite', rows: [['un'], ['DROITE']] }))
  await write('gh222/conflit-b.yaml', dump({ value: 'droite' }))
  await commit('GH222 droite')
  const session = await s.invoke<{ id: string }>('merge-resolution:open', localPath, 'gh222-gauche', currentBranch,
    { kind: 'merge', from: 'gh222-gauche', into: currentBranch })
  sessionId = session.id
})

async function goto(url: string) {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await s.page.waitForLoadState('networkidle')
}

const commitDiff = (sha: string, filepath: string) =>
  goto(s.projectUrl('/diff', { repoPath: s.project.localPath, filepath, commitSha: sha }))
const raw = () => s.page.getByTestId('raw-diff')
const counter = () => s.page.getByTestId('diff-nav-counter')

async function rawMode() {
  const toggle = s.page.getByTestId('diff-mode-toggle')
  if (await toggle.count()) await toggle.getByRole('button', { name: 'Raw' }).click()
}

test.describe('diff Raw', () => {
  test('H1 — ligne pleine des deux côtés, seuls les mots changés surlignés ; lisible en sombre', async () => {
    await commitDiff(cTitle, 'gh222/titre.yaml')
    await rawMode()
    await expect(raw()).toBeVisible()
    const a = raw().locator('.cm-merge-a')
    const b = raw().locator('.cm-merge-b')
    await expect(a.locator('.cm-changedText').filter({ hasText: 'alpha' })).toHaveCount(1)
    await expect(b.locator('.cm-changedText').filter({ hasText: 'beta' })).toHaveCount(1)
    await expect(a.locator('.cm-changedText').filter({ hasText: 'Démarrage' })).toHaveCount(0)
    await expect(s.page.getByText('+2 / −2')).toBeVisible()

    await s.page.evaluate(() => document.documentElement.classList.add('dark'))
    const bg = await a.locator('.cm-changedLine').first().evaluate(el => getComputedStyle(el).backgroundColor)
    expect(bg).toBe('rgb(74, 30, 38)')
    await s.shot('gh222-raw-dark')
    await s.page.evaluate(() => document.documentElement.classList.remove('dark'))
  })

  test('H2/H3/H4/H6 — 5 000 lignes : rien de tronqué, régions repliées, règle, F7, hachures', async () => {
    const t0 = Date.now()
    await commitDiff(cBig, 'gh222/big.txt')
    await expect(raw().locator('.cm-changedLine').first()).toBeVisible()
    const elapsed = Date.now() - t0
    console.log(`GH222 H2 — premier rendu d'un diff de 5 000 lignes : ${elapsed} ms`)
    expect(elapsed).toBeLessThan(1500)

    await expect(raw().locator('.cm-collapsedLines').first()).toBeVisible()
    await expect(s.page.getByTestId('overview-ruler').locator('[data-ruler-mark]')).toHaveCount(5)
    await expect(raw().locator('.cm-merge-a .cm-mergeSpacer').first()).toBeAttached()

    await s.page.keyboard.press('F7')
    await expect(counter()).toHaveText('Changement 1 / 5')
    for (let i = 0; i < 3; i++) await s.page.keyboard.press('F7')
    await expect(counter()).toHaveText('Changement 4 / 5')
    await s.page.keyboard.press('Shift+F7')
    await expect(counter()).toHaveText('Changement 3 / 5')

    // The last change (line 4 990) is there: no 2 000-line cap any more.
    await s.page.getByTestId('overview-ruler').locator('[data-ruler-mark]').nth(4).click()
    await expect(raw().locator('.cm-merge-b .cm-line').filter({ hasText: 'changée 4990' })).toBeInViewport()
    await s.shot('gh222-raw-big')
  })

  test('H5 — côte à côte / en ligne, mémorisé', async () => {
    await commitDiff(cTitle, 'gh222/titre.yaml')
    await rawMode()
    await s.page.getByTestId('diff-layout-toggle').getByRole('button', { name: 'En ligne' }).click()
    await expect(raw()).toHaveAttribute('data-layout', 'inline')
    await expect(raw().locator('.cm-deletedChunk')).not.toHaveCount(0)
    await commitDiff(cBig, 'gh222/big.txt')
    await expect(raw()).toHaveAttribute('data-layout', 'inline')
    await s.page.getByTestId('diff-layout-toggle').getByRole('button', { name: 'Côte à côte' }).click()
    await expect(raw()).toHaveAttribute('data-layout', 'side')
  })
})

test.describe('résolution de conflits Raw', () => {
  const openSession = () => goto(s.projectUrl('/merge-resolve', { id: sessionId }))
  const file = (name: string) => s.page.getByRole('button', { name: new RegExp(name) })
  const leftPane = () => s.page.locator('.cm-editor').nth(0)
  const output = () => s.page.locator('.cm-editor').last()

  test('H11 — la liste des fichiers montre les conflits restants', async () => {
    await openSession()
    await expect(file('conflit-a.yaml').getByTestId('file-conflict-count')).toHaveText('2 conflits')
    await expect(file('conflit-b.yaml').getByTestId('file-conflict-count')).toHaveText('1 conflit')
  })

  test('H7/H8/H9 — changements de chaque côté, action dans le panneau, les deux, réinitialiser', async () => {
    await openSession()
    await file('conflit-a.yaml').click()
    const raw = s.page.getByRole('button', { name: 'Raw' })
    if (await raw.count()) await raw.click()

    // H7 — what each side changed since the ancestor, down to the characters.
    await expect(leftPane().locator('.cm-side-left-char').filter({ hasText: 'gauche' })).not.toHaveCount(0)
    await expect(s.page.locator('.cm-editor').nth(1).locator('.cm-side-right-char').filter({ hasText: 'droite' })).not.toHaveCount(0)
    await expect(s.page.getByTestId('diff-nav-counter')).toHaveText('Conflit – / 2')

    // H8 — « Prendre gauche » from the left pane itself.
    await leftPane().locator('.cm-merge-actions').filter({ hasText: 'Prendre gauche' }).first().getByRole('button').click()
    await expect(s.page.getByTestId('diff-nav-counter')).toHaveText('Conflit – / 1')
    await expect(output().locator('.cm-merge-actions-resolved')).toHaveCount(1)

    // H9 — « Prendre les deux » on the list block, then « Réinitialiser ».
    const listBlock = output().locator('.cm-merge-actions:not(.cm-merge-actions-resolved)')
    await listBlock.getByRole('button', { name: 'Prendre les deux' }).click()
    await expect(output()).toContainText('GAUCHE')
    await expect(output()).toContainText('DROITE')
    await expect(s.page.getByTestId('diff-nav-counter')).toHaveText('Aucun conflit restant')
    await output().locator('.cm-merge-actions-resolved').filter({ hasText: 'les deux' }).getByRole('button', { name: 'Réinitialiser' }).click()
    await expect(s.page.getByTestId('diff-nav-counter')).toHaveText('Conflit – / 1')
    await s.shot('gh222-merge-raw')
  })

  test('H10 — F7 après le dernier conflit résolu passe au fichier suivant', async () => {
    await openSession()
    await file('conflit-b.yaml').click()
    await s.page.getByRole('button', { name: 'Tout prendre à droite' }).click()
    await expect(s.page.getByTestId('diff-nav-counter')).toHaveText('Aucun conflit restant')
    await s.page.keyboard.press('F7')
    await expect(s.page.locator('p.font-mono').filter({ hasText: 'gh222/conflit-a.yaml' })).toBeVisible()
  })
})
