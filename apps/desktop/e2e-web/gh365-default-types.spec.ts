import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import { E2E } from './support/env'
import { setupSession } from './support/session'

/**
 * GH365 — ajout d'un composant : toutes les catégories de types proposées et cochées (sans version /
 * validation pour un composant local), nom et préfixe tirés du label affiché, sans collision
 * (specs/GH365-tests.md E-1 à E-3, M-1 automatisé avec un repo nu de la forge locale).
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface TypeLike { name: string; prefix?: string; category: string }
interface NodeLike { name: string; label?: string; objectTypes?: TypeLike[]; children?: NodeLike[] }
interface SchemaLike { nodes: NodeLike[]; linkTypes?: Array<{ name: string }> }

const LABEL = 'Contrôle moteur GH365'
const ROOT = 'CONTROLE_MOTEUR_GH365'
const RUN = Date.now().toString(36)

const schemaOf = (repoPath: string) => s.invoke<SchemaLike>('schema:get', repoPath)
const typesOf = async (repoPath: string, node: string) =>
  ((await schemaOf(repoPath)).nodes.find(n => n.name === node)?.objectTypes ?? []).map(t => [t.category, t.name, t.prefix])

async function openStructure() {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/schema', { repoPath: s.project.localPath }))
  await s.page.waitForLoadState('networkidle')
  await expect(s.page.getByTitle(/^Ajouter à /).first()).toBeAttached({ timeout: 15_000 })
}

/** Ouvre « + Composant » depuis la ligne du repo racine, renvoie la fenêtre. */
async function openAddComponent() {
  await s.page.getByTitle(/^Ajouter à /).first().click()
  await s.page.getByText(/^\+ Composant$/).click()
  const dialog = s.page.locator('div.fixed').filter({ hasText: 'Ajouter un composant' }).first()
  await expect(dialog).toBeVisible()
  return dialog
}

async function addLocalComponent(name: string) {
  const dialog = await openAddComponent()
  await dialog.getByPlaceholder('comp-motor-control').fill(name)
  await dialog.getByRole('checkbox', { name: /Composant local/ }).check()
  await dialog.getByPlaceholder(name, { exact: true }).fill(LABEL)
  await dialog.getByRole('button', { name: /^Ajouter$/ }).last().click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
}

test('E-1 — composant local : 4 cases cochées (sans versions / validations), types CONTROLE_MOTEUR_GH365_*', async () => {
  await openStructure()
  const dialog = await openAddComponent()
  const box = (name: string) => dialog.getByRole('checkbox', { name, exact: true })
  for (const name of ['Exigences', 'Tests', 'Campagnes', 'Issues', 'Versions', 'Validations']) await expect(box(name)).toBeChecked()
  await dialog.getByRole('checkbox', { name: /Composant local/ }).check()
  await expect(box('Versions')).toHaveCount(0)
  await expect(box('Validations')).toHaveCount(0)
  for (const name of ['Exigences', 'Tests', 'Campagnes', 'Issues']) await expect(box(name)).toBeChecked()
  // Décocher « Composant local » rend les deux cases, dans l'état où elles étaient.
  await dialog.getByRole('checkbox', { name: /Composant local/ }).uncheck()
  await expect(box('Versions')).toBeChecked()
  await dialog.getByRole('button', { name: 'Annuler' }).click()
  await expect(dialog).toBeHidden()

  await addLocalComponent('gh365-a')
  expect(await typesOf(s.project.localPath, 'gh365-a')).toEqual([
    ['requirement', `${ROOT}_REQ`, `${ROOT}_REQ`],
    ['test', `${ROOT}_TEST`, `${ROOT}_TEST`],
    ['campaign', `${ROOT}_CAMP`, `${ROOT}_CAMP`],
    ['issue', `${ROOT}_ISS`, `${ROOT}_ISS`],
  ])
  await s.shot('gh365-local')
})

test('E-3 — second composant de même label : suffixe _2, sans erreur de préfixe', async () => {
  await openStructure()
  await addLocalComponent('gh365-b')
  expect((await typesOf(s.project.localPath, 'gh365-b')).map(t => t[2])).toEqual([
    `${ROOT}_REQ_2`, `${ROOT}_TEST_2`, `${ROOT}_CAMP_2`, `${ROOT}_ISS_2`,
  ])
})

test('M-1 — composant en repo séparé neuf : 6 types sur son root, lien issue-impact', async () => {
  // Repo nu avec un premier commit, sur la forge locale des tests.
  const name = `gh365-comp-${RUN}`
  const bare = path.join(E2E.remotesDir, `${name}.git`)
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', bare])
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gh365-seed-'))
  execFileSync('git', ['init', '-q', '--initial-branch=main', work])
  fs.writeFileSync(path.join(work, 'README.md'), 'gh365\n')
  execFileSync('git', ['-C', work, 'add', '-A'])
  execFileSync('git', ['-C', work, '-c', 'user.name=S', '-c', 'user.email=s@x', 'commit', '-qm', 'seed'])
  execFileSync('git', ['-C', work, 'push', '-q', bare, 'main'])
  fs.rmSync(work, { recursive: true, force: true })

  await openStructure()
  const dialog = await openAddComponent()
  await dialog.getByPlaceholder('comp-motor-control').fill(name)
  await dialog.getByPlaceholder(name, { exact: true }).fill('Pompe à eau')
  await dialog.getByPlaceholder('git@github.com:org/repo.git').fill(`${E2E.gitBaseUrl}/${name}.git`)
  await dialog.getByRole('button', { name: /^Ajouter$/ }).last().click()
  await expect(dialog).toBeHidden({ timeout: 60_000 })

  const compPath = path.join(path.dirname(s.project.localPath), name)
  await expect.poll(async () => {
    try { return (await typesOf(compPath, 'root')).map(t => t[1]) } catch { return [] }
  }, { timeout: 30_000 }).toEqual(['POMPE_A_EAU_REQ', 'POMPE_A_EAU_TEST', 'POMPE_A_EAU_CAMP', 'POMPE_A_EAU_ISS', 'POMPE_A_EAU_VER', 'POMPE_A_EAU_VAL'])
  expect((await schemaOf(compPath)).linkTypes?.map(l => l.name)).toContain('issue-impact')
})

test('E-2 — (en dernier : laisse ouverte la fenêtre du type créé) « + Exigence » sur le composant : racine tirée du label, premier suffixe libre', async () => {
  await openStructure()
  const row = s.page.getByText(LABEL, { exact: true }).first()
    .locator('xpath=ancestor::*[contains(@class, \'group/local\')][1]')
  await row.getByTitle('Ajouter à ce composant').click()
  // Menu ouvert en bas du conteneur défilant : un clic aux coordonnées tombe sur la ligne suivante
  // pendant le défilement ; l'action testée est celle de l'item, pas le placement du menu.
  await row.getByRole('button', { name: '+ Exigence', exact: true }).dispatchEvent('click')
  await expect.poll(async () => (await typesOf(s.project.localPath, 'gh365-a')).map(t => t[2]))
    .toContain(`${ROOT}_REQ_3`)
})
