import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import ExcelJS from 'exceljs'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, newProfile } from './support/app'

/**
 * GH389 — vue Validation sur la grille commune (specs/GH389-tests.md, E1 à E8), sur le desktop comme
 * GH204. Schéma, exigences, version, validation et premières décisions créés par IPC.
 *
 *   pnpm test:e2e:desktop e2e-desktop/gh389-validation
 */

let app: ElectronApplication
let page: Page
let profile: string
let repo: string
let projectId: string
let versionId: string
let validationId: string
let username: string
/** a, e : conformes ; b : non conforme ; c, d : à décider. e est d'un autre type (préfixe SW). */
let a: string, b: string, c: string, d: string, e: string

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([ch, ar]) => (window as unknown as { polenta: { invoke: (c: string, ...a: unknown[]) => Promise<unknown> } }).polenta.invoke(ch as string, ...(ar as unknown[])), [channel, args] as const) as Promise<T>
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })

const grid = () => page.getByTestId('validation-grid')
const rowIds = () => grid().locator('tbody tr[data-node-id]').evaluateAll(trs => trs.map(tr => (tr as HTMLElement).dataset.nodeId!))
const headerCols = () => grid().locator('thead th[data-col]').evaluateAll(ths => ths.map(th => (th as HTMLElement).dataset.col!))
const activeCell = () => grid().locator('td[data-active]')
const cell = (col: string, id: string) => page.getByTestId(`validation-${col}-${id}`)
const validationFile = () => fs.readFileSync(path.join(repo, 'validations', `${validationId}.yaml`), 'utf8')
const prefs = () => invoke<Record<string, unknown>>('pref:get-field-visibility', repo, username, 'root::validation')
const decisions = async () => {
  const p = await invoke<{ rows: Array<{ requirementId: string; decision: string }> }>('validations:page', repo, validationId, repo)
  return Object.fromEntries(p.rows.map(r => [r.requirementId, r.decision]))
}

/** Page de la validation, par la barre d'activité (démontée puis remontée à chaque appel). */
async function openValidation(first = false) {
  if (first) {
    // Sous file://, le premier pushState reste sur « Not Found » : mise en page, puis barre d'activité (comme GH204).
    await page.evaluate(id => {
      window.history.pushState({}, '', `/graph?projectId=${id}`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, projectId)
  }
  if (await page.getByTestId('validation-page').count()) {
    await page.locator('button[title="Version"]').first().click()
    await expect(page.getByTestId('validation-page')).toHaveCount(0)
  }
  await page.locator('button[title="Validation"]').last().click()
  await page.getByTestId(`validation-version-${versionId}`).click()
  await expect(page.getByTestId('validation-page')).toBeVisible()
  await expect(grid()).toBeVisible()
}

/** Glisse la poignée de largeur d'une colonne de `dx` px (en plusieurs passes si la fenêtre est trop étroite). */
async function resizeColumn(col: string, dx: number) {
  const width = await page.evaluate(() => window.innerWidth)
  let left = dx
  while (left > 0) {
    const box = (await page.getByTestId(`validation-header-${col}`).locator('[data-col-resize]').boundingBox())!
    const step = Math.min(left, Math.max(20, width - 10 - box.x))
    await page.mouse.move(box.x + 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 2 + step / 2, box.y + box.height / 2, { steps: 4 })
    await page.mouse.move(box.x + 2 + step, box.y + box.height / 2, { steps: 4 })
    await page.mouse.up()
    left -= step
  }
}

async function filterColumn(col: string, text: string, regex = false) {
  await page.getByTestId(`validation-header-${col}`).locator('[data-column-filter-icon]').click()
  const popover = page.locator('[data-column-filter-popover]')
  if (regex) await popover.getByRole('button', { name: '.*' }).click()
  await popover.getByTestId('column-filter-input').fill(text)
  // Échap viderait le filtre : fermeture par un clic extérieur.
  await page.getByTestId('validation-count').click()
  await expect(popover).toHaveCount(0)
}

test.beforeAll(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-gh389-'))
  git('init', '-b', 'main')
  git('config', 'user.name', 'e2e')
  git('config', 'user.email', 'e2e@example.com')
  git('commit', '--allow-empty', '-m', 'init')
  profile = newProfile()
  ;({ app, page } = await launch(profile))
  expect((await invoke<{ status: string }>('workspace:open-project', repo)).status).toBe('ok')
  projectId = await page.evaluate(dir => btoa(unescape(encodeURIComponent(dir))).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/, ''), repo)

  await invoke('schema:save', repo, {
    version: 1,
    linkTypes: [],
    nodes: [{
      name: 'root', label: 'Produit', readonly: false,
      objectTypes: [
        {
          name: 'exigence', label: 'Exigence', prefix: 'SYS', category: 'requirement',
          fields: [{ name: 'priorite', label: 'Priorité', type: 'text' }], statuses: [{ name: 'draft', label: 'Brouillon' }],
        },
        { name: 'logiciel', label: 'Exigence logicielle', prefix: 'SW', category: 'requirement', fields: [], statuses: [{ name: 'draft', label: 'Brouillon' }] },
        { name: 'bug', label: 'Bug', prefix: 'ISS', category: 'issue', fields: [], statuses: [{ name: 'ouverte', label: 'Ouverte' }] },
        {
          name: 'version', label: 'Version', prefix: 'PRV', category: 'version', fields: [],
          statuses: [{ name: 'en_cours', label: 'En cours' }, { name: 'released', label: 'Released', isApproval: true }, { name: 'abandonnee', label: 'Abandonnée', isTerminal: true }],
        },
        {
          name: 'validation', label: 'Validation', prefix: 'VAL', category: 'validation', fields: [],
          statuses: [{ name: 'en_cours', label: 'En cours' }, { name: 'signee', label: 'Signée', isApproval: true }, { name: 'annulee', label: 'Annulée', isTerminal: true }],
          decisions: [
            { name: 'en_attente', label: 'À décider', isPending: true },
            { name: 'conforme', label: 'Conforme' },
            { name: 'non_conforme', label: 'Non conforme', proposesIssue: true },
          ],
        },
      ],
    }],
  })
  const req = async (title: string, type = 'exigence', fields: Record<string, unknown> = {}) =>
    (await invoke<{ id: string }>('requirements:create', repo, { title, objectTypeRef: `root::${type}`, fields }, repo)).id
  a = await req('Démarrage rapide', 'exigence', { priorite: 'haute-priorite-a' })
  b = await req('Arrêt sur surchauffe')
  c = await req('Charge lente')
  d = await req('Témoin de charge')
  e = await req('Pilote moteur', 'logiciel')
  git('add', '-A')
  git('commit', '-m', 'exigences')
  versionId = (await invoke<{ id: string }>('versions:create', repo, { title: '1.0' }, repo)).id
  await invoke('versions:include', repo, versionId, [a, b, c, d, e], repo)
  git('add', '-A')
  git('commit', '-m', 'version')
  await invoke('versions:release', repo, versionId, 'produit-1.0', repo)
  validationId = (await invoke<{ id: string }>('validations:create', repo, { versionId, title: 'Feu vert 1.0' }, repo)).id
  for (const [id, decision] of [[a, 'conforme'], [e, 'conforme'], [b, 'non_conforme']]) {
    await invoke('validations:decide', repo, validationId, { requirementId: id, decision }, repo)
  }
  // E4 — champ de l'onglet « Popup » du type des exigences.
  username = await invoke<string>('auth:project-username', repo)
  await invoke('pref:set-field-visibility', repo, username, 'root::exigence', { popup: ['priorite'] })
  await openValidation(true)
})

test.afterAll(async () => {
  await app?.close()
})

test.describe.configure({ mode: 'serial' })

test('E1 — en-tête repliable, mémorisé', async () => {
  await expect(page.getByTestId('validation-header')).toBeVisible()
  const before = (await page.getByTestId('validation-datagrid').boundingBox())!.height
  await page.getByTestId('validation-header-toggle').click()
  await expect(page.getByTestId('validation-header')).toHaveCount(0)
  await expect(page.getByTestId('validation-header-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('validation-state-short')).toHaveText('En cours')
  await expect(page.getByTestId('validation-remaining-short')).toContainText('2')
  await expect.poll(async () => (await page.getByTestId('validation-datagrid').boundingBox())!.height).toBeGreaterThan(before)

  // Autre page puis retour : toujours replié.
  await openValidation()
  await expect(page.getByTestId('validation-header')).toHaveCount(0)

  // Redémarrage (même profil) : toujours replié.
  await app.close()
  ;({ app, page } = await launch(profile))
  expect((await invoke<{ status: string }>('workspace:open-project', repo)).status).toBe('ok')
  await openValidation(true)
  await expect(page.getByTestId('validation-header')).toHaveCount(0)
  await page.getByTestId('validation-header-toggle').click()
  await expect(page.getByTestId('validation-header')).toBeVisible()
})

test('E2 — filtres de colonne combinés en ET, compteur', async () => {
  await expect(page.getByTestId('validation-count')).toHaveText('5 / 5')
  await filterColumn('decision', '^conf', true)
  await filterColumn('id', 'SYS')
  await expect.poll(rowIds).toEqual([a])
  await expect(page.getByTestId('validation-count')).toHaveText('1 / 5')
  await expect(page.getByTestId('validation-header-decision').locator('[data-column-filter-icon]')).toHaveAttribute('data-active', 'true')
  await expect(page.getByTestId('validation-header-mentions').locator('[data-column-filter-icon]')).toHaveCount(0)
  // Échap dans le popover vide le filtre.
  for (const col of ['decision', 'id']) {
    await page.getByTestId(`validation-header-${col}`).locator('[data-column-filter-icon]').click()
    await page.getByTestId('column-filter-input').press('Escape')
  }
  await expect(page.getByTestId('validation-count')).toHaveText('5 / 5')
})

test('E3 — largeur, gel et ordre mémorisés ; Réinitialiser', async () => {
  const defaults = await headerCols()
  expect(defaults.slice(0, 4)).toEqual(['id', 'title', 'decision', 'comment'])

  // Gel jusqu'au titre.
  await page.getByTestId('validation-header-title').click({ button: 'right' })
  await page.getByTestId('column-freeze').click()
  await expect.poll(async () => (await prefs()).freezeColCountExcel).toBe(2)

  // Largeur de la décision.
  const widthBefore = (await page.getByTestId('validation-header-decision').boundingBox())!.width
  await resizeColumn('decision', 80)
  const storedWidth = async () => ((await prefs()).colWidthsExcel as Record<string, number> | undefined)?.decision ?? 0
  await expect.poll(storedWidth).toBeGreaterThan(widthBefore + 70)
  const width = await storedWidth()

  // Ordre : Rédaction glissée avant Décision.
  await page.getByTestId('validation-header-status').dragTo(page.getByTestId('validation-header-decision'), { targetPosition: { x: 3, y: 5 } })
  await expect.poll(headerCols).toEqual(['id', 'title', 'status', 'decision', ...defaults.slice(3).filter(k => k !== 'status')])

  // Page quittée, rouverte : retrouvés.
  await openValidation()
  await expect.poll(headerCols).toEqual(['id', 'title', 'status', 'decision', ...defaults.slice(3).filter(k => k !== 'status')])
  await expect(page.getByTestId('validation-header-title')).toHaveCSS('position', 'sticky')
  expect(Math.abs((await page.getByTestId('validation-header-decision').boundingBox())!.width - width)).toBeLessThan(2)

  // Réinitialiser : colonnes par défaut.
  await page.getByTestId('validation-columns').click()
  await page.getByTestId('column-picker-reset').click()
  await page.getByTestId('column-picker-close').click()
  await expect.poll(headerCols).toEqual(defaults)
})

test('E4 — liens d’élément : popup, Ctrl+clic, version de l’en-tête', async () => {
  const link = cell('id', a).locator(`[data-element-link="${a}"]`)
  await link.hover()
  await expect(page.getByTestId('element-preview')).toBeVisible()
  await expect(page.getByTestId('element-preview')).toContainText('haute-priorite-a')
  await page.mouse.move(0, 0)
  await expect(page.getByTestId('element-preview')).toHaveCount(0)

  const tabs = page.locator('button.group[title]')
  const count = await tabs.count()
  await link.click({ modifiers: ['Control'] })
  await expect(tabs).toHaveCount(count + 1)
  await tabs.filter({ hasText: 'Feu vert' }).first().click()
  await expect(page.getByTestId('validation-page')).toBeVisible()

  const versionLink = page.getByTestId('validation-header').locator(`[data-element-link="${versionId}"]`)
  await versionLink.hover()
  await expect(page.getByTestId('element-preview')).toContainText(versionId)
  await expect(page.getByTestId('element-preview')).toContainText('1.0')
  await expect(page.getByTestId('element-preview')).toContainText(/released/i)
  await versionLink.click()
  await expect.poll(() => page.url()).toContain(`/version/${versionId}`)
  await openValidation()
})

test('E5 — clavier : flèches, Tab, Entrée / Échap, cellule ramenée à l’écran', async () => {
  const ids = await rowIds()
  await page.getByTestId('validation-header-title').click({ position: { x: 4, y: 4 } }) // focus dans la grille, sans cellule
  await page.keyboard.press('ArrowDown')
  await expect(activeCell()).toHaveAttribute('data-col', '__expand')
  // Sur la colonne de dépli : → déplie, ← replie.
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId(`validation-toggle-${ids[0]}`)).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId(`validation-toggle-${ids[0]}`)).toHaveAttribute('aria-expanded', 'false')

  await cell('title', ids[0]).click()
  for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowRight']) await page.keyboard.press(key)
  await expect(activeCell()).toHaveAttribute('data-testid', `validation-comment-${ids[3]}`)
  await expect(grid().locator('tbody tr[data-selected]')).toHaveAttribute('data-node-id', ids[3])

  // Tab en bout de ligne : première cellule de la ligne suivante.
  await cell('mentions', ids[0]).click()
  await page.keyboard.press('Tab')
  await expect(activeCell()).toHaveAttribute('data-col', '__expand')
  await expect(page.locator(`tr[data-node-id="${ids[1]}"] td[data-active]`)).toHaveCount(1)

  // Entrée ouvre l'éditeur de la décision, Échap le referme sans écrire.
  const before = validationFile()
  await cell('title', c).click()
  await page.keyboard.press('ArrowRight')
  await expect(activeCell()).toHaveAttribute('data-col', 'decision')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId(`validation-decision-${c}-editor`)).toBeVisible()
  // Liste ouverte (comme la Vue Excel) : le premier Échap referme la liste du système, le second l'éditeur.
  await page.keyboard.press('Escape')
  if (await page.getByTestId(`validation-decision-${c}-editor`).count()) await page.keyboard.press('Escape')
  await expect(page.getByTestId(`validation-decision-${c}-editor`)).toHaveCount(0)
  expect(validationFile()).toBe(before)

  // Cellule hors écran : ramenée dans la zone visible.
  await resizeColumn('comment', 1600)
  await cell('title', c).click()
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight')
  await expect(activeCell()).toHaveAttribute('data-col', 'mentions')
  const container = (await page.locator('[data-testid="validation-datagrid"] [data-excel-grid]').boundingBox())!
  const target = (await activeCell().boundingBox())!
  expect(target.x).toBeGreaterThanOrEqual(container.x - 1)
  expect(target.x + target.width).toBeLessThanOrEqual(container.x + container.width + 1)
})

test('E6 — décision en lot ; proposition d’issue unique', async () => {
  await cell('title', b).click()
  await cell('title', d).click({ modifiers: ['Shift'] })
  await expect(grid().locator('tbody tr[data-selected]')).toHaveCount(3)
  await cell('decision', c).dblclick()
  await page.getByTestId(`validation-decision-${c}-editor`).selectOption('conforme')
  await expect.poll(async () => { const all = await decisions(); return [all[b], all[c], all[d]] }).toEqual(['conforme', 'conforme', 'conforme'])
  await expect(grid().locator('tbody tr[data-selected]')).toHaveCount(3)

  await cell('decision', b).dblclick()
  await page.getByTestId(`validation-decision-${b}-editor`).selectOption('non_conforme')
  await expect(page.getByTestId('issue-proposal')).toHaveCount(1)
  await page.getByTestId('issue-proposal-submit').click()
  await expect(page.getByTestId('issue-proposal')).toHaveCount(0)
  await expect.poll(async () => { const all = await decisions(); return [all[b], all[c], all[d]] }).toEqual(['non_conforme', 'non_conforme', 'non_conforme'])
  const issues = fs.readdirSync(path.join(repo, 'issues'))
  expect(issues).toHaveLength(1)
  const issue = fs.readFileSync(path.join(repo, 'issues', issues[0]), 'utf8')
  for (const id of [b, c, d]) expect(issue).toContain(`${validationId}/${id}`)
  const links = fs.readFileSync(path.join(repo, 'links', 'links.yaml'), 'utf8')
  expect(links.match(/issue-impact/g)).toHaveLength(3)
})

test('E7, E8 — validation signée : lecture seule ; export de la grille filtrée', async () => {
  await invoke('validations:sign', repo, validationId, repo)
  await expect(page.getByTestId('validation-sign')).toHaveCount(0)
  await expect(page.getByTestId('validation-confirm-selection')).toHaveCount(0)

  // Ni double-clic ni Entrée n'ouvrent d'éditeur ; les flèches se déplacent.
  await cell('decision', a).dblclick()
  await expect(page.getByTestId(`validation-decision-${a}-editor`)).toHaveCount(0)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId(`validation-decision-${a}-editor`)).toHaveCount(0)
  await page.keyboard.press('ArrowRight')
  await expect(activeCell()).toHaveAttribute('data-col', 'comment')

  // Filtre, puis export : exactement ce qui est affiché.
  await filterColumn('decision', 'Non')
  await page.getByTestId('validation-count').click()
  await expect(page.getByTestId('validation-count')).toHaveText('3 / 5')
  const shownIds = await rowIds()
  const shownCols = await headerCols()
  const labels = await grid().locator('thead th[data-col]').evaluateAll(ths => ths.map(th => (th.firstChild?.textContent ?? '').trim()))
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-gh389-export-')), 'grille.xlsx')
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog
  }, file)
  await page.getByTestId('validation-toolbar').getByRole('button', { name: /Exporter|Export/ }).click()
  await page.getByRole('button', { name: 'Excel' }).click()
  // Écrit quand le message « exporté » s'affiche (le fichier existe, vide, dès le début de l'écriture).
  await expect(page.getByText(file)).toBeVisible()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const sheet = wb.worksheets[0]
  expect(sheet.name).toBe('Feu vert 1.0')
  expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual(labels)
  expect(sheet.rowCount).toBe(1 + shownIds.length)
  const idCol = shownCols.indexOf('id') + 1
  const decisionCol = shownCols.indexOf('decision') + 1
  for (let i = 0; i < shownIds.length; i++) {
    expect(sheet.getRow(i + 2).getCell(idCol).value).toBe(shownIds[i])
    expect(sheet.getRow(i + 2).getCell(decisionCol).value).toBe('Non conforme')
  }
})
