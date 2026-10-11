import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { expect, test, type Page } from '@playwright/test'

import { chooseServer, launch, newProfile, signIn, stubFolderPicker } from './support/app'
import { bulkRepos, deleteRepos, repoInfo, resetAccounts, seedItest, setTeamConfig, unbanSelf, uploadSetupScript, TEAM_CONFIG, type Accounts } from './support/forge'

/**
 * GH45 S4 — fonctions P1 contre une vraie forge du kit (specs/GH45-tests.md S4-1 à S4-12) : liste
 * des repos, création sur le serveur (projet et composant), autocomplétion des champs `user`,
 * diagnostic de lecture seule. Repos créés par ces tests : préfixe `s4-`, supprimés à la fin.
 */

let A: Accounts
const RUN = Date.now().toString(36)

test.beforeAll(() => {
  // Les 401 normaux des scénarios (révocation, mauvais mot de passe) cumulés sur plusieurs
  // exécutions finissent par faire bannir l'IP de test par fail2ban.
  unbanSelf()
  uploadSetupScript()
  A = resetAccounts()
  seedItest()
  setTeamConfig(TEAM_CONFIG.replace(/__ORG__/g, A.org))
})

test.afterAll(() => {
  deleteRepos('s4-')
})

const HOME_ACTION = /Créer un nouveau projet|Create a new project/
const OPEN_FROM_REPO = /Ouvrir un projet depuis un repo|Open a project from an existing repo/
const tmpFolder = (tag: string) => fs.mkdtempSync(path.join(os.tmpdir(), `polenta-e2e-${tag}-`))

async function signedIn(login: string, password: string) {
  const launched = await launch(newProfile())
  await chooseServer(launched.page, A.baseUrl)
  await signIn(launched.page, login, password)
  await expect(launched.page.getByText(HOME_ACTION)).toBeVisible({ timeout: 30_000 })
  return launched
}

const repoList = (page: Page) => page.getByRole('listbox', { name: /Projets accessibles|Accessible projects/ })

test('S4-1 / S4-3 — liste des repos : recherche, repo de configuration masqué, « Saisir une URL », clone', async () => {
  const { app, page } = await signedIn('itest-auteur', A.auteur)
  try {
    await page.getByRole('button', { name: OPEN_FROM_REPO }).click()
    await expect(repoList(page).getByRole('option', { name: new RegExp(`${A.org}/itest`) })).toBeVisible({ timeout: 30_000 })
    await expect(repoList(page).getByRole('option', { name: /polenta-config/ })).toHaveCount(0)
    await page.getByPlaceholder(/Rechercher un projet|Search a project/).fill('itest')
    await expect(repoList(page).getByRole('option')).toHaveCount(1)
    // « Saisir une URL » : flux d'avant GH45.
    await page.getByRole('button', { name: /Saisir une URL|Enter a URL/ }).click()
    await expect(page.getByText(/URL du repo Git|Git repository URL/)).toBeVisible()
    await page.keyboard.press('Escape')
    // Clone depuis la liste.
    const folder = tmpFolder('s4-clone')
    await stubFolderPicker(app, folder)
    await page.getByRole('button', { name: OPEN_FROM_REPO }).click()
    await repoList(page).getByRole('option', { name: new RegExp(`${A.org}/itest`) }).click()
    await expect(page).toHaveURL(/projectId=/, { timeout: 60_000 })
    expect(fs.existsSync(path.join(folder, 'itest', '.polenta', 'schema.yaml'))).toBe(true)
  } finally {
    await app.close()
  }
})

test('S4-1 / S4-12 — lecteur : badge « lecture seule », bandeau non bloquant à l’ouverture', async () => {
  const { app, page } = await signedIn('itest-lecteur', A.lecteur)
  try {
    await page.getByRole('button', { name: OPEN_FROM_REPO }).click()
    const option = repoList(page).getByRole('option', { name: new RegExp(`${A.org}/itest`) })
    await expect(option).toContainText(/lecture seule|read-only/, { timeout: 30_000 })
    await stubFolderPicker(app, tmpFolder('s4-ro'))
    await option.click()
    await expect(page.getByRole('status').filter({ hasText: /lecture seule à ce projet|read-only access to this project/ })).toBeVisible({ timeout: 60_000 })
  } finally {
    await app.close()
  }
})

test('S4-6 — lecteur : création sur le serveur désactivée, avec l’explication', async () => {
  const { app, page } = await signedIn('itest-lecteur', A.lecteur)
  try {
    await page.getByRole('button', { name: HOME_ACTION }).click()
    const server = page.getByRole('radio', { name: /Sur le serveur|On the server/ })
    await expect(page.getByText(/n’a le droit de créer un projet dans aucune organisation|not allowed to create a project in any organization/)).toBeVisible({ timeout: 30_000 })
    await expect(server).toBeDisabled()
    await expect(page.getByRole('radio', { name: /Sur ce poste|On this computer/ })).toBeChecked()
  } finally {
    await app.close()
  }
})

test('S4-5 / S4-7 — auteur : nom pris refusé avant toute création locale, puis projet créé sur le serveur', async () => {
  const { app, page } = await signedIn('itest-auteur', A.auteur)
  const folder = tmpFolder('s4-create')
  try {
    await stubFolderPicker(app, folder)
    // S4-7 — nom déjà pris.
    await page.getByRole('button', { name: HOME_ACTION }).click()
    await expect(page.getByRole('radio', { name: /Sur le serveur|On the server/ })).toBeChecked({ timeout: 30_000 })
    await page.getByLabel(/Nom du projet|Project name/).fill('itest')
    await page.getByRole('button', { name: /^(Continuer|Continue)$/ }).click()
    await expect(page.getByText(/existe déjà sur le serveur/)).toBeVisible({ timeout: 30_000 })
    expect(fs.existsSync(path.join(folder, 'itest'))).toBe(false)
    // S4-5 — nouveau nom.
    const name = `s4-projet-${RUN}`
    await page.getByRole('button', { name: HOME_ACTION }).click()
    await page.getByLabel(/Nom du projet|Project name/).fill(name)
    await page.getByRole('button', { name: /^(Continuer|Continue)$/ }).click()
    await expect(page).toHaveURL(/projectId=/, { timeout: 60_000 })
    await expect.poll(() => repoInfo(name)).toEqual({ exists: true, private: true, branches: ['main'] })
    const gitConfig = fs.readFileSync(path.join(folder, name, '.git', 'config'), 'utf-8')
    expect(gitConfig).toContain(`${A.baseUrl}/${A.org}/${name}.git`)
  } finally {
    await app.close()
  }
})

test('S4-2 / S4-4 — plus de 50 repos tous listés ; deux comptes : sélecteur de compte', async () => {
  bulkRepos(`s4-pag-${RUN}-`, 55)
  const giteaAccounts = resetAccounts('gitea-test')
  const { app, page } = await signedIn('itest-auteur', A.auteur)
  try {
    await page.getByRole('button', { name: OPEN_FROM_REPO }).click()
    await page.getByPlaceholder(/Rechercher un projet|Search a project/).fill(`s4-pag-${RUN}-`)
    await expect(repoList(page).getByRole('option')).toHaveCount(55, { timeout: 30_000 })
    await page.keyboard.press('Escape')
    // Second compte (Gitea), ajouté par le même canal que l'écran de connexion.
    const result = await page.evaluate(([url, login, password]) =>
      (window as unknown as { polenta: { invoke: (c: string, ...a: unknown[]) => Promise<{ status: string }> } })
        .polenta.invoke('auth:login-password', url, login, password), [giteaAccounts.baseUrl, 'itest-auteur', giteaAccounts.auteur])
    expect(result.status).toBe('ok')
    // Comptes relus à l'ouverture de la fenêtre : aucun rechargement nécessaire.
    await page.getByRole('button', { name: OPEN_FROM_REPO }).click()
    const account = page.getByRole('combobox', { name: /Compte|Account/ })
    await expect(account.locator('option')).toHaveCount(2)
    await account.selectOption({ label: `itest-auteur — ${new URL(giteaAccounts.baseUrl).host}` })
    await expect(repoList(page).getByRole('option', { name: /gitea-test\/itest/ })).toBeVisible({ timeout: 30_000 })
  } finally {
    await app.close()
  }
})

/** Clone de `<org>/itest` depuis la liste (auteur) ; renvoie le dossier du repo. */
async function openItest(app: Awaited<ReturnType<typeof launch>>['app'], page: Page, tag: string): Promise<string> {
  const folder = tmpFolder(tag)
  await stubFolderPicker(app, folder)
  await page.getByRole('button', { name: OPEN_FROM_REPO }).click()
  await repoList(page).getByRole('option', { name: new RegExp(`${A.org}/itest`) }).click()
  await expect(page).toHaveURL(/projectId=/, { timeout: 60_000 })
  return path.join(folder, 'itest')
}

test('S4-10 — champ `user` : membres de l’organisation proposés, login enregistré, saisie libre', async () => {
  const { app, page } = await signedIn('itest-auteur', A.auteur)
  try {
    const repo = await openItest(app, page, 's4-user')
    // L'ouverture du projet se termine sur sa vue d'accueil (modèle de données sans « projectHome »
    // d'équipe, ou tableau de bord du projet déjà ouvert) : on attend qu'elle soit affichée.
    await expect(page).toHaveURL(/dashboardId=|\/schema\?/, { timeout: 30_000 })
    await page.locator('button[title="Exigences"], button[title="Requirements"]').first().click()
    await page.getByText(/Create the first element|Créer le premier élément/).click()
    await page.getByText(/^(Create an element|Créer un élément)$/).click()
    const row = page.locator('main tr').filter({ hasText: 'REQ-' }).first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    // Vue Excel : cellule « Responsable » (dernière colonne).
    await row.locator('td').last().dblclick()
    const input = page.locator('main input[list]')
    await expect(input).toBeVisible()
    const listId = await input.getAttribute('list')
    const logins = await page.locator(`datalist[id="${listId}"] option`).evaluateAll(els => els.map(e => (e as HTMLOptionElement).value))
    expect(logins).toEqual(expect.arrayContaining(['alice', 'itest-auteur', 'itest-lecteur']))
    await input.fill('itest-lecteur')
    await input.press('Enter')
    await expect(row.locator('td').last()).toHaveText('itest-lecteur')
    const id = (await row.locator('td').filter({ hasText: /^REQ-\d+$/ }).first().textContent())!.trim()
    await expect.poll(() => fs.readFileSync(path.join(repo, 'requirements', `${id}.yaml`), 'utf-8'), { timeout: 15_000 })
      .toContain('responsable: itest-lecteur')
    // Saisie libre (utilisateur externe) acceptée telle quelle.
    await row.locator('td').last().dblclick()
    await page.locator('main input[list]').fill('prestataire-externe')
    await page.locator('main input[list]').press('Enter')
    await expect.poll(() => fs.readFileSync(path.join(repo, 'requirements', `${id}.yaml`), 'utf-8'), { timeout: 15_000 })
      .toContain('responsable: prestataire-externe')
  } finally {
    await app.close()
  }
})

test('S4-9 — ajout d’un composant : repo créé sur le serveur, URL remplie, ajout et clone', async () => {
  const { app, page } = await signedIn('itest-auteur', A.auteur)
  const name = `s4-comp-${RUN}`
  try {
    const repo = await openItest(app, page, 's4-comp')
    await expect(page).toHaveURL(/dashboardId=|\/schema\?/, { timeout: 30_000 })
    await page.locator('button[title="Projet"], button[title="Project"]').first().click()
    await page.locator('main').getByText('Projet de test', { exact: true }).hover()
    await page.locator('button[title*="Projet de test"]').first().click()
    await page.getByText(/^\+ (Composant|Component)$/).click()
    const dialog = page.locator('div.fixed').filter({ hasText: /Ajouter un composant|Add a component/ })
    await dialog.getByPlaceholder('comp-motor-control').fill(name)
    await dialog.getByRole('button', { name: /Créer le repo sur le serveur|Create the repo on the server/ }).click()
    await expect(dialog.getByRole('combobox', { name: /Organisation|Organization/ })).toHaveValue(A.org, { timeout: 30_000 })
    await dialog.getByRole('button', { name: /^(Créer|Create)$/ }).click()
    await expect(dialog.getByPlaceholder('git@github.com:org/repo.git')).toHaveValue(`${A.baseUrl}/${A.org}/${name}.git`, { timeout: 60_000 })
    await expect.poll(() => repoInfo(name)).toEqual({ exists: true, private: true, branches: ['main'] })
    await dialog.getByRole('button', { name: /^(Ajouter|Add)$/ }).click()
    await expect(dialog).toHaveCount(0, { timeout: 60_000 })
    // Composant cloné et monté : ses types d'objets (préfixe dérivé du nom) apparaissent dans l'arbre.
    await expect(page.locator('main').getByText(name.toUpperCase().replace(/-/g, '_') + '_REQ')).toBeVisible({ timeout: 30_000 })
    expect(fs.readFileSync(path.join(repo, 'polenta-repo.yaml'), 'utf-8')).toContain(`${A.org}/${name}.git`)
  } finally {
    await app.close()
  }
})
