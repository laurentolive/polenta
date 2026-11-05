import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, newProfile } from './support/app'

/**
 * GH210 — reflets Design et Validation dans la vue Tableau (specs/GH210-tests.md, I1, I2, I7). Sur le desktop ;
 * le client web a son propre scénario (`e2e-web/gh252-versions.spec.ts`). Version et validation créées par IPC.
 *
 *   pnpm test:e2e:desktop -g GH210
 */

let app: ElectronApplication
let page: Page
let repo: string
let projectId: string
let reqA: string
let reqB: string
let validationId: string

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([c, a]) => (window as unknown as { polenta: { invoke: (c: string, ...a: unknown[]) => Promise<unknown> } }).polenta.invoke(c as string, ...(a as unknown[])), [channel, args] as const) as Promise<T>
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })

test.beforeAll(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-gh210-'))
  git('init', '-b', 'main')
  git('config', 'user.name', 'e2e')
  git('config', 'user.email', 'e2e@example.com')
  git('commit', '--allow-empty', '-m', 'init')
  ;({ app, page } = await launch(newProfile()))
  expect((await invoke<{ status: string }>('workspace:open-project', repo)).status).toBe('ok')
  projectId = await page.evaluate(dir => btoa(unescape(encodeURIComponent(dir))).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/, ''), repo)

  await invoke('schema:save', repo, {
    version: 1,
    linkTypes: [],
    nodes: [{
      name: 'root', label: 'Produit', readonly: false,
      objectTypes: [
        { name: 'exigence', label: 'Exigence GH210', prefix: 'SYS', category: 'requirement', fields: [], statuses: [{ name: 'draft', label: 'Brouillon' }] },
        {
          name: 'version', label: 'Version', prefix: 'PRV', category: 'version', fields: [],
          statuses: [{ name: 'en_cours', label: 'En cours' }, { name: 'released', label: 'Released', isApproval: true }, { name: 'abandonnee', label: 'Abandonnée', isTerminal: true }],
        },
        {
          name: 'validation', label: 'Validation', prefix: 'VAL', category: 'validation', fields: [],
          statuses: [{ name: 'en_cours', label: 'En cours' }, { name: 'signee', label: 'Signée', isApproval: true }, { name: 'annulee', label: 'Annulée', isTerminal: true }],
          decisions: [
            { name: 'en_attente', label: 'En attente', isPending: true },
            { name: 'conforme', label: 'Conforme' },
            { name: 'non_conforme', label: 'Non conforme', proposesIssue: true },
          ],
        },
      ],
    }],
  })
  reqA = (await invoke<{ id: string }>('requirements:create', repo, { title: 'Exigence livrée', objectTypeRef: 'root::exigence', fields: {} }, repo)).id
  reqB = (await invoke<{ id: string }>('requirements:create', repo, { title: 'Exigence nouvelle', objectTypeRef: 'root::exigence', fields: {} }, repo)).id
  git('add', '-A')
  git('commit', '-m', 'exigences')
  const version = await invoke<{ id: string }>('versions:create', repo, { title: '1.0' }, repo)
  await invoke('versions:include', repo, version.id, [reqA], repo)
  git('add', '-A')
  git('commit', '-m', 'version')
  await invoke('versions:release', repo, version.id, 'produit-1.0', repo)
  validationId = (await invoke<{ id: string }>('validations:create', repo, { versionId: version.id, title: 'Feu vert 1.0' }, repo)).id
  for (const id of [reqA, reqB]) await invoke('validations:decide', repo, validationId, { requirementId: id, decision: 'conforme' }, repo)
  await invoke('validations:sign', repo, validationId, repo)

  // Colonnes des reflets visibles dans la vue Tableau (décochées par défaut).
  const username = await invoke<string>('auth:project-username', repo)
  await invoke('pref:set-field-visibility', repo, username, 'root::exigence', {
    excel: ['section', 'name', 'id', 'coverageStatus', 'designStatus', 'validationStatus'],
  })

  // Sous file://, le premier pushState reste sur « Not Found » : mise en page, puis barre d'activité (comme GH204).
  await page.evaluate(id => {
    window.history.pushState({}, '', `/graph?projectId=${id}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, projectId)
  await page.locator('button[title="Exigences"]').first().click()
})

test.afterAll(async () => {
  await app?.close()
})

const row = (id: string) => page.locator('tr').filter({ hasText: id })

test('GH210 — colonnes Design et Validation, « Vérification », mise à jour après annulation', async () => {
  const combo = page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill('Exigence GH210')
  await combo.press('Enter')
  await page.getByTitle('Vue tableau').click()

  // I2 — le statut de couverture s'appelle « Vérification ».
  await expect(page.locator('th').filter({ hasText: 'Vérification' })).toBeVisible()
  await expect(page.locator('th').filter({ hasText: 'Design' })).toBeVisible()

  // I1 — exigence livrée : design 1.0, décision de la validation signée.
  await expect(row(reqA).getByTestId('reflection-designStatus')).toHaveText('1.0')
  await expect(row(reqA).getByTestId('reflection-validationStatus')).toHaveText('Conforme (1.0)')
  // Exigence jamais livrée : pas de design ; décision prise quand même.
  await expect(row(reqB).getByTestId('reflection-designStatus')).toHaveText('—')
  await expect(row(reqB).getByTestId('reflection-validationStatus')).toHaveText('Conforme (1.0)')

  // I7 — annulation : la colonne se met à jour sans recharger (aucune autre validation signée).
  await invoke('validations:cancel', repo, validationId, repo)
  await expect(row(reqA).getByTestId('reflection-validationStatus')).toHaveText('—')

  // I6 — le label de version ouvre la page de la version.
  await row(reqA).getByTestId('reflection-designStatus').getByRole('button', { name: '1.0' }).click()
  await page.waitForFunction(() => window.location.pathname.includes('/version/'))
})
