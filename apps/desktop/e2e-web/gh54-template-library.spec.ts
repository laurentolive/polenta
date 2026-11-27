import { test, expect, type Locator } from '@playwright/test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createHash } from 'crypto'
import PizZip from 'pizzip'
import { setupSession } from './support/session'
import { E2E } from './support/env'

/**
 * GH54 — gabarits d'export ajoutables depuis le client web (specs/GH54.md, GH54-design.md, GH54-tests.md).
 * Les envois passent par le sélecteur de fichier du navigateur, comme pour l'utilisateur. Les fichiers
 * viennent des exemples livrés (`resources/export-templates`) : aucun binaire ajouté au dépôt.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

const EXAMPLES = path.resolve(__dirname, '..', 'resources', 'export-templates')
const EXAMPLE = path.join(EXAMPLES, 'Cahier des exigences.docx')
const OTHER = path.join(EXAMPLES, 'Dashboard.docx')
const NAME = 'GH54 Cahier.docx'
const REF_NAME = 'GH54 Référence.docx'
const EXPORT_NAME = 'GH54 Export.docx'
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh54-e2e-'))

const sha = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
/** Copie d'un fichier d'exemple sous le nom voulu (le serveur prend le nom du fichier envoyé). */
function asName(source: string, name: string): string {
  const target = path.join(tmp, name)
  fs.copyFileSync(source, target)
  return target
}
const libDir = () => path.join(E2E.dataDir, 'users', E2E.user.login, 'userData', 'export-templates')
const wordBlock = () => s.page.getByTestId('template-library-web').locator('div.space-y-2', { hasText: 'Word (.docx)' }).first()
const rowOf = (block: Locator, name: string) => block.locator('li', { hasText: name })
const status = () => s.page.getByTestId('template-library-web').getByRole('status')

/** Clique sur un bouton qui ouvre le sélecteur de fichier, puis choisit `file`. */
async function pickWith(button: Locator, file: string): Promise<void> {
  const chooser = s.page.waitForEvent('filechooser')
  await button.click()
  await (await chooser).setFiles(file)
}

async function openPreferences(): Promise<void> {
  await s.page.reload()
  await s.page.evaluate(url => {
    history.pushState({}, '', url)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/preferences', { repoPath: s.project.localPath }))
  await s.page.waitForLoadState('networkidle')
  await expect(s.page.getByTestId('template-library-web')).toBeVisible()
}

test('GH54-1 — ajout d’un gabarit : il apparaît dans la liste Word sans rechargement', async () => {
  await openPreferences()
  await pickWith(wordBlock().getByRole('button', { name: 'Ajouter un gabarit' }), asName(EXAMPLE, NAME))
  await expect(status()).toHaveText(`« ${NAME} » ajouté.`)
  await expect(rowOf(wordBlock(), NAME)).toBeVisible()
})

test('GH54-2 — le fichier ajouté est identique à l’envoi (SHA-256)', async () => {
  expect(sha(path.join(libDir(), NAME))).toBe(sha(EXAMPLE))
})

test('GH54-3 — nom déjà présent : dialogue de remplacement, « Annuler » ne change rien', async () => {
  const before = sha(path.join(libDir(), NAME))
  await pickWith(wordBlock().getByRole('button', { name: 'Ajouter un gabarit' }), asName(OTHER, NAME))
  const dialog = s.page.getByRole('alertdialog', { name: 'Remplacer le gabarit' })
  await expect(dialog).toContainText(`« ${NAME} » existe déjà`)
  await dialog.getByRole('button', { name: 'Annuler' }).click()
  await expect(dialog).toHaveCount(0)
  expect(sha(path.join(libDir(), NAME))).toBe(before)
})

test('GH54-4 — « Remplacer » : le contenu devient celui du nouvel envoi ; un autre nom est refusé', async () => {
  const row = rowOf(wordBlock(), NAME)
  await pickWith(row.getByRole('button', { name: 'Remplacer' }), asName(EXAMPLE, 'autre.docx'))
  await expect(status()).toContainText(`Pour remplacer « ${NAME} », choisissez un fichier portant ce nom.`)
  expect(sha(path.join(libDir(), NAME))).toBe(sha(EXAMPLE))

  await pickWith(row.getByRole('button', { name: 'Remplacer' }), asName(OTHER, NAME))
  await expect(status()).toHaveText(`« ${NAME} » remplacé.`)
  expect(sha(path.join(libDir(), NAME))).toBe(sha(OTHER))
})

test('GH54-5 — « Supprimer » : confirmation, le fichier disparaît du disque et de la liste', async () => {
  await rowOf(wordBlock(), NAME).getByRole('button', { name: 'Supprimer' }).click()
  const dialog = s.page.getByRole('alertdialog', { name: 'Supprimer le gabarit' })
  await expect(dialog).toContainText(NAME)
  await dialog.getByRole('button', { name: 'Supprimer', exact: true }).click()
  await expect(status()).toHaveText(`« ${NAME} » supprimé.`)
  await expect(rowOf(wordBlock(), NAME)).toHaveCount(0)
  expect(fs.existsSync(path.join(libDir(), NAME))).toBe(false)
})

test('GH54-6 — gabarit par défaut du projet : le dialogue de suppression le signale', async () => {
  await pickWith(wordBlock().getByRole('button', { name: 'Ajouter un gabarit' }), asName(EXAMPLE, REF_NAME))
  await expect(rowOf(wordBlock(), REF_NAME)).toBeVisible()

  const P = s.project.localPath
  await s.invoke('schema:invalidate', P)
  const schema = await s.invoke<{ preferences?: Record<string, unknown> }>('schema:get', P)
  schema.preferences = { ...(schema.preferences ?? {}), exportTemplates: { 'requirements:docx': REF_NAME } }
  await s.invoke('schema:save', P, schema)
  await openPreferences()

  await rowOf(wordBlock(), REF_NAME).getByRole('button', { name: 'Supprimer' }).click()
  const dialog = s.page.getByRole('alertdialog', { name: 'Supprimer le gabarit' })
  await expect(dialog).toContainText('gabarit par défaut du projet')
  await dialog.getByRole('button', { name: 'Annuler' }).click()
  expect(fs.existsSync(path.join(libDir(), REF_NAME))).toBe(true)
})

test('GH54-7 — fichier non valide (texte renommé .docx) : refus, rien n’est ajouté', async () => {
  const bad = path.join(tmp, 'GH54 faux.docx')
  fs.writeFileSync(bad, 'ceci n’est pas une archive')
  await pickWith(wordBlock().getByRole('button', { name: 'Ajouter un gabarit' }), bad)
  await expect(status()).toHaveText('Ce fichier n’est pas un document Word valide.')
  expect(fs.existsSync(path.join(libDir(), 'GH54 faux.docx'))).toBe(false)
})

test('GH54-8 — fichier trop volumineux : le message du serveur est affiché', async () => {
  // Le serveur répond 413 : c'est le refus attendu, journalisé par le navigateur.
  s.allowConsoleErrors(/status of 413/)
  const big = path.join(tmp, 'GH54 gros.docx')
  fs.writeFileSync(big, Buffer.alloc(21 * 1024 * 1024, 1))
  await pickWith(wordBlock().getByRole('button', { name: 'Ajouter un gabarit' }), big)
  await expect(status()).toContainText('Fichier trop volumineux')
  expect(fs.existsSync(path.join(libDir(), 'GH54 gros.docx'))).toBe(false)
})

test('GH54-9 — export Word avec le gabarit ajouté : le téléchargement est produit', async () => {
  await openPreferences()
  await pickWith(wordBlock().getByRole('button', { name: 'Ajouter un gabarit' }), asName(EXAMPLE, EXPORT_NAME))
  await expect(rowOf(wordBlock(), EXPORT_NAME)).toBeVisible()

  // Vue Exigences du produit (sans composant : pas de clone réseau requis).
  await s.openView('Exigences')
  await s.page.waitForLoadState('networkidle')

  await s.page.getByRole('button', { name: 'Exporter' }).first().click()
  await s.page.getByRole('combobox', { name: 'Gabarit Word' }).selectOption({ label: EXPORT_NAME })
  const downloadPromise = s.page.waitForEvent('download', { timeout: 120_000 })
  await s.page.getByRole('button', { name: 'Word' }).click()
  const download = await downloadPromise
  const target = path.join(tmp, `export-${download.suggestedFilename()}`)
  await download.saveAs(target)
  await s.page.getByRole('button', { name: 'Fermer' }).click()

  const zip = new PizZip(fs.readFileSync(target))
  expect(zip.file('word/document.xml')).not.toBeNull()
})
