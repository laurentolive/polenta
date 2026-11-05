import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, newProfile } from './support/app'

/**
 * GH204 — vue Validation (specs/GH204-tests.md, E1 à E6), sur le desktop ; le client web a son propre
 * scénario (`e2e-web/gh252-versions.spec.ts`). Exigences, version et exécutions créées par
 * IPC ou sur disque ; le type validation et les décisions, par l'interface.
 *
 *   pnpm test:e2e:desktop -g GH204
 */

let app: ElectronApplication
let page: Page
let repo: string
let projectId: string
let versionId: string
let reqA: string
let reqB: string
let testId: string

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([c, a]) => (window as unknown as { polenta: { invoke: (c: string, ...a: unknown[]) => Promise<unknown> } }).polenta.invoke(c as string, ...(a as unknown[])), [channel, args] as const) as Promise<T>
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })

const writeRun = (id: string, executedAt: string, ref: string) => {
  const dir = path.join(repo, 'test-runs', testId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${id}.yaml`), [
    `id: ${id}`, `testCaseId: ${testId}`, 'result: PASS', `executedAt: ${executedAt}`, 'executedBy: qualite', 'duration: 1',
    'equipmentUsed: []', 'stepResults: []', 'notes: ""', 'testedConfig:', '  component: produit', `  ref: ${ref}`, '  label: "1.0"', '',
  ].join('\n'))
}

test.beforeAll(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-gh204-'))
  git('init', '-b', 'main')
  git('config', 'user.name', 'e2e')
  git('config', 'user.email', 'e2e@example.com')
  git('commit', '--allow-empty', '-m', 'init')
  ;({ app, page } = await launch(newProfile()))
  expect((await invoke<{ status: string }>('workspace:open-project', repo)).status).toBe('ok')
  projectId = await page.evaluate(dir => btoa(unescape(encodeURIComponent(dir))).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/, ''), repo)

  await invoke('schema:save', repo, {
    version: 1,
    linkTypes: [{ name: 'verification', labelSourceToTarget: 'vérifie', labelTargetToSource: 'est vérifiée par', sourceRefs: ['test'], targetRefs: ['requirement'] }],
    nodes: [{
      name: 'root', label: 'Produit', readonly: false,
      objectTypes: [
        { name: 'essai', label: 'Essai', prefix: 'TST', category: 'test', fields: [], statuses: [{ name: 'valide', label: 'Validé', isApproval: true }] },
        { name: 'exigence', label: 'Exigence', prefix: 'SYS', category: 'requirement', fields: [], statuses: [{ name: 'draft', label: 'Brouillon' }] },
        { name: 'bug', label: 'Bug', prefix: 'ISS', category: 'issue', fields: [], statuses: [{ name: 'ouverte', label: 'Ouverte' }] },
        {
          name: 'version', label: 'Version', prefix: 'PRV', category: 'version', fields: [],
          statuses: [{ name: 'en_cours', label: 'En cours' }, { name: 'released', label: 'Released', isApproval: true }, { name: 'abandonnee', label: 'Abandonnée', isTerminal: true }],
        },
      ],
    }],
  })
  reqA = (await invoke<{ id: string }>('requirements:create', repo, { title: 'Exigence A', objectTypeRef: 'root::exigence', fields: {} }, repo)).id
  reqB = (await invoke<{ id: string }>('requirements:create', repo, { title: 'Exigence B', objectTypeRef: 'root::exigence', fields: {} }, repo)).id
  testId = (await invoke<{ id: string }>('tests:create', repo, { title: 'Essai A', objectTypeRef: 'root::essai', fields: {}, steps: [] }, repo)).id
  await invoke('requirements:link-create', repo, { type: 'verification', sourceId: testId, targetId: reqA }, repo)

  const version = await invoke<{ id: string }>('versions:create', repo, { title: '1.0' }, repo)
  versionId = version.id
  await invoke('versions:include', repo, versionId, [reqA, reqB], repo)
  writeRun('RUN-1', '2026-10-01T10:00:00.000Z', versionId)
  writeRun('RUN-2', '2026-10-02T10:00:00.000Z', 'PRV-9999')
  git('add', '-A')
  git('commit', '-m', 'exigences et version')
  await invoke('versions:release', repo, versionId, 'produit-1.0', repo)

  // Sous file://, le premier pushState reste sur « Not Found » : mise en page, puis barre d'activité (comme GH238).
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

test('GH204 — type, création, décisions, issue, vues, signature', async () => {
  // E6 — type validation ajouté dans /schema, avec le jeu de décisions par défaut.
  await page.locator('button[title="Validation"]').last().click()
  await expect(page.getByTestId('validation-no-type')).toBeVisible()
  await page.getByTestId('validation-no-type').getByRole('button').click()
  const addButton = page.locator('button[title^="Ajouter à"]').first()
  await expect(addButton).toBeAttached()
  await addButton.locator('xpath=ancestor::div[contains(@class,"group")][1]').hover()
  await addButton.click()
  await page.getByTestId('add-validation-type').click()
  await expect(page.getByTestId('decision-row-en_attente')).toBeVisible()
  await expect(page.getByTestId('decision-row-non_conforme')).toBeVisible()
  await page.getByRole('button', { name: /^Enregistrer|^Créer|^Ajouter$/ }).last().click()
  await expect.poll(() => fs.readFileSync(path.join(repo, '.polenta', 'schema.yaml'), 'utf8')).toContain('category: validation')
  const schema = fs.readFileSync(path.join(repo, '.polenta', 'schema.yaml'), 'utf8')
  expect(schema).toContain('isPending: true')
  expect(schema).toContain('proposesIssue: true')

  // E1 — création sur la version released : une ligne par exigence, statuts affichés.
  await page.locator('button[title="Validation"]').last().click()
  await page.getByTestId(`validation-create-${versionId}`).click()
  await page.getByTestId('new-validation-submit').click()
  await expect(page.getByTestId('validation-page')).toBeVisible()
  await expect(page.getByTestId('validation-remaining')).toHaveText('2')
  await expect(page.getByTestId(`validation-row-${reqA}`)).toBeVisible()
  await expect(page.getByTestId(`validation-row-${reqB}`)).toBeVisible()
  await expect(page.getByTestId(`validation-row-${reqA}`)).toContainText('Brouillon')
  await expect(page.getByTestId(`validation-row-${reqA}`)).toContainText('1.0')
  await expect(page.getByTestId(`validation-impact-${reqA}`)).toContainText('changée')

  // E4 — signature refusée, tous les motifs affichés.
  await page.getByTestId('validation-sign').click()
  await expect(page.getByTestId('validation-problem-DECISION_PENDING')).toContainText(reqA)
  await expect(page.getByTestId('validation-problem-DECISION_PENDING')).toContainText(reqB)
  await expect(page.getByTestId('validation-dialog-confirm')).toHaveCount(0)
  await page.getByTestId('validation-dialog-close').click()

  // E2 — décision, commentaire, tests et exécutions, mentions.
  await page.getByTestId(`validation-decision-${reqA}`).selectOption('conforme')
  await expect(page.getByTestId('validation-remaining')).toHaveText('1')
  await page.getByTestId(`validation-comment-${reqA}`).fill('Vu au banc')
  await page.getByTestId(`validation-comment-${reqA}`).blur()
  await expect.poll(() => fs.readdirSync(path.join(repo, 'validations')).map(f => fs.readFileSync(path.join(repo, 'validations', f), 'utf8')).join()).toContain('Vu au banc')
  await page.getByTestId(`validation-toggle-${reqA}`).click()
  await page.getByTestId(`validation-test-toggle-${testId}`).click()
  await expect(page.getByTestId('validation-run-RUN-1').getByTestId('validation-mention-other_version')).toHaveCount(0)
  await expect(page.getByTestId('validation-run-RUN-2').getByTestId('validation-mention-other_version')).toBeVisible()
  await page.getByTestId(`validation-toggle-${reqB}`).click()
  await expect(page.getByTestId('validation-no-test')).toBeVisible()
  await page.getByTestId(`validation-toggle-${reqB}`).click()

  // E3 — non conforme : proposition d'issue, origine et lien d'impact.
  await page.getByTestId(`validation-decision-${reqB}`).selectOption('non_conforme')
  await expect(page.getByTestId('issue-proposal')).toBeVisible()
  await page.getByTestId('issue-proposal-submit').click()
  await expect(page.getByTestId('issue-proposal')).toHaveCount(0)
  const issueText = fs.readFileSync(path.join(repo, 'issues', fs.readdirSync(path.join(repo, 'issues'))[0]), 'utf8')
  expect(issueText).toContain(`/${reqB}`)
  expect(issueText).toContain('decisions:')
  expect(fs.readFileSync(path.join(repo, 'links', 'links.yaml'), 'utf8')).toContain('issue-impact')

  // E5 — vue enregistrée : colonnes restituées.
  await page.getByTestId('saved-views-button').click()
  await page.getByTestId('saved-views-save-as').click()
  await page.getByTestId('saved-view-name').fill('Sans rédaction')
  await page.getByTestId('saved-view-scope-personal').check()
  await page.getByTestId('saved-view-confirm').click()
  await expect(page.getByTestId('saved-view-dialog')).toHaveCount(0)
  await page.getByTestId('validation-columns').click()
  await page.getByTestId('validation-column-status').uncheck()
  await page.getByTestId('validation-columns').click()
  const grid = page.getByTestId('validation-grid')
  await expect(grid.locator('th').filter({ hasText: 'Rédaction' })).toHaveCount(0)
  await expect(page.getByTestId('saved-views-modified')).toBeVisible()
  await page.getByTestId('saved-views-button').click()
  await page.getByTestId('saved-view-personal-Sans rédaction').click()
  await expect(grid.locator('th').filter({ hasText: 'Rédaction' })).toHaveCount(1)
  await expect(page.getByTestId('saved-views-modified')).toHaveCount(0)

  await page.screenshot({ path: path.join(__dirname, '.results', 'gh204-grid.png') })

  // GH271 (5ac8a6f) — une relecture de la page, ici une décision écrite ailleurs, garde la saisie en cours.
  const titleInput = page.getByTestId('validation-title')
  const savedTitle = await titleInput.inputValue()
  await titleInput.fill('Titre en cours de saisie')
  const validationId = /\/validation\/([^/?]+)/.exec(page.url())![1]
  const current = await invoke<{ validation: { entries: Array<{ requirementId: string; decision: string }> } }>('validations:page', repo, validationId, repo)
  const entryA = current.validation.entries.find(e => e.requirementId === reqA)!
  await invoke('validations:decide', repo, validationId, { requirementId: reqA, decision: entryA.decision, comment: 'Écrit ailleurs' }, repo)
  await expect(page.getByTestId(`validation-comment-${reqA}`)).toHaveValue('Écrit ailleurs')
  await page.waitForTimeout(500) // l'effet de relecture passe après le rendu du commentaire
  await expect(titleInput).toHaveValue('Titre en cours de saisie')
  await titleInput.fill(savedTitle)

  // E4 — tout est décidé : signature, sans tag ; grille en lecture.
  const tagsBefore = git('tag', '--list')
  await page.getByTestId('validation-sign').click()
  await page.getByTestId('validation-dialog-confirm').click()
  await expect(page.getByTestId('validation-state')).toHaveText('Signée')
  expect(git('tag', '--list')).toBe(tagsBefore)
  expect(git('log', '-1', '--format=%s')).toContain('signée')
  await expect(page.getByTestId(`validation-decision-${reqA}`).locator('option')).toHaveCount(0)
  await expect(page.getByTestId('validation-sign')).toHaveCount(0)
  // GH267 — la grille d'une validation signée montre ce que le signataire a vu.
  await expect(page.getByTestId('validation-frozen')).toBeVisible()
})
