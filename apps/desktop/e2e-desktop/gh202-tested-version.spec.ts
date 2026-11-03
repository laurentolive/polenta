import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, newProfile } from './support/app'

/**
 * GH202 — version testée à l'écran d'exécution (specs/GH202-tests.md, manuels 1, 2, 4). Sans forge :
 * un repo git local ouvert comme projet par IPC, version et campagne créées par IPC.
 *
 *   pnpm test:e2e:desktop -g GH202
 */

interface Campaign { id: string; runs: Array<{ entryId: string; testCaseId: string }> }

let app: ElectronApplication
let page: Page
let repo: string
let projectId: string
let versionId: string
let campaign: Campaign

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([c, a]) => (window as unknown as { polenta: { invoke: (c: string, ...a: unknown[]) => Promise<unknown> } }).polenta.invoke(c as string, ...(a as unknown[])), [channel, args] as const) as Promise<T>

const executeButtons = () => page.getByRole('button', { name: 'Exécuter' })

const readRun = (testId: string) => {
  const dir = path.join(repo, 'test-runs', testId)
  return fs.readFileSync(path.join(dir, fs.readdirSync(dir).sort().pop()!), 'utf8')
}

test.beforeAll(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-gh202-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo })
  git('init', '-b', 'main')
  git('-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', 'commit', '--allow-empty', '-m', 'init')
  ;({ app, page } = await launch(newProfile()))
  expect((await invoke<{ status: string }>('workspace:open-project', repo)).status).toBe('ok')
  projectId = await page.evaluate(dir => btoa(unescape(encodeURIComponent(dir))).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/, ''), repo)

  await invoke('schema:save', repo, {
    version: 1, linkTypes: [],
    nodes: [{
      name: 'root', label: 'Produit', readonly: false,
      objectTypes: [
        { name: 'essai', label: 'Essai', prefix: 'TST', category: 'test', fields: [], statuses: [{ name: 'valide', label: 'Validé', isApproval: true }] },
        { name: 'campagne', label: 'Campagne', prefix: 'CAMP', category: 'campaign', fields: [], statuses: [{ name: 'planned', label: 'Planifiée' }] },
        { name: 'exigence', label: 'Exigence', prefix: 'SYS', category: 'requirement', fields: [], statuses: [{ name: 'draft', label: 'Brouillon' }] },
        {
          name: 'version', label: 'Version', prefix: 'PRV', category: 'version', fields: [],
          statuses: [{ name: 'en_cours', label: 'En cours' }, { name: 'released', label: 'Released', isApproval: true }, { name: 'abandonnee', label: 'Abandonnée', isTerminal: true }],
        },
      ],
    }],
  })
  const version = await invoke<{ id: string }>('versions:create', repo, { title: '1.0' }, repo)
  versionId = version.id
  const steps = [{ order: 1, action: 'Mesurer', expectedResult: '12 V', notes: '' }]
  const a = await invoke<{ id: string }>('tests:create', repo, { title: 'Essai A', objectTypeRef: 'root::essai', fields: {}, steps }, repo)
  const b = await invoke<{ id: string }>('tests:create', repo, { title: 'Essai B', objectTypeRef: 'root::essai', fields: {}, steps }, repo)
  campaign = await invoke<Campaign>('campaigns:create', repo, { title: 'GH202', objectTypeRef: 'root::campagne', testCaseIds: [a.id, b.id] }, repo)

  // Profil sans compte, et sous file:// le premier pushState reste sur « Not Found » : mise en page
  // affichée, puis une vraie navigation par la barre d'activité (comme GH238).
  await page.evaluate(id => {
    window.history.pushState({}, '', `/graph?projectId=${id}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, projectId)
  await page.locator('button[title="Version"]').first().click()
  await page.waitForFunction(() => window.location.pathname.endsWith('/graph'))
})

test.afterAll(async () => {
  await app?.close()
})

test('GH202 — saisie obligatoire, copie dans le run, reprise, évolution', async () => {
  const [first] = campaign.runs

  // Première exécution : champ vide, enregistrement refusé.
  // Page de la campagne par la barre d'activité (sous file://, un pushState reste sur « Not Found »).
  await page.locator('button[title="Campagnes"]').first().click()
  await page.getByTestId('sidebar').getByText('GH202', { exact: false }).locator('visible=true').first().click()
  await executeButtons().first().click()
  const select = page.getByTestId('tested-version-select')
  await expect(select).toBeVisible()
  await expect(select).toHaveValue('')
  await page.getByRole('button', { name: 'Soumettre le résultat' }).click()
  await expect(page.getByTestId('tested-version-missing')).toBeVisible()
  expect(fs.existsSync(path.join(repo, 'test-runs', first.testCaseId))).toBe(false)

  // Version choisie : le run porte la copie.
  await select.selectOption(versionId)
  await expect(page.getByTestId('tested-version-missing')).toBeHidden()
  await page.getByRole('button', { name: 'Soumettre le résultat' }).click()
  await expect.poll(() => fs.existsSync(path.join(repo, 'test-runs', first.testCaseId))).toBe(true)
  const run = readRun(first.testCaseId)
  expect(run).toContain('testedConfig:')
  expect(run).toContain(`ref: ${versionId}`)
  expect(fs.readFileSync(path.join(repo, 'campaigns', `${campaign.id}.yaml`), 'utf8')).not.toContain('testedConfig')

  // Deuxième exécution : version reprise de la précédente.
  await executeButtons().nth(1).click()
  await expect(page.getByTestId('tested-version-select')).toHaveValue(versionId)

  // La version évolue : la consultation du run le dit.
  fs.mkdirSync(path.join(repo, 'requirements'), { recursive: true })
  await invoke('requirements:create', repo, { title: 'Exigence ajoutée', objectTypeRef: 'root::exigence', fields: {} }, repo).catch(() => null)
  const added = fs.readdirSync(path.join(repo, 'requirements')).find(f => f.endsWith('.yaml'))!.replace('.yaml', '')
  await new Promise(r => setTimeout(r, 1100))   // `at` est à la seconde : l'ajout doit tomber après l'exécution
  await invoke('versions:include', repo, versionId, [added], repo)
  await page.getByRole('button', { name: 'Retour', exact: false }).first().click()
  await page.getByRole('button', { name: 'Voir' }).first().click()
  await expect(page.getByTestId('tested-config')).toContainText('1.0')
  await expect(page.getByTestId('tested-drift')).toContainText(added)
})
