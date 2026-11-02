import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH227 — le champ richtext « Description » d'une campagne (type de campagne de la démo) doit
 * refléter la valeur courante : après un passage à une autre campagne (même route, seul le
 * paramètre change) et après un enregistrement depuis le panneau « Modifier les champs ».
 */
const s = setupSession()

interface Campaign { id: string }

let campaignA: Campaign
let campaignB: Campaign

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}

const campaignUrl = (id: string) => s.projectUrl(`/campaign/${id}`, { repoPath: s.project.localPath })

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  // Type de campagne de la démo (champ richtext `description`), repris d'une campagne existante.
  const existing = await s.invoke<Array<{ objectTypeRef?: string }>>('campaigns:list', localPath)
  const objectTypeRef = existing.find(c => c.objectTypeRef)?.objectTypeRef
  test.skip(!objectTypeRef, 'la démo doit avoir une campagne typée')
  const create = (name: string) => s.invoke<Campaign>('campaigns:create', localPath, {
    title: `GH227 ${name}`, objectTypeRef, fields: { description: `Description GH227 ${name}` }, testCaseIds: [],
  }, workspaceDir)
  campaignA = await create('A')
  campaignB = await create('B')
})

test('passer d\'une campagne à l\'autre affiche la description de la nouvelle', async () => {
  const p = s.page
  await navigate(p, campaignUrl(campaignA.id))
  await expect(p.getByText('Description GH227 A')).toBeVisible()

  await navigate(p, campaignUrl(campaignB.id))
  await expect(p.getByText('Description GH227 B')).toBeVisible()
  await expect(p.getByText('Description GH227 A')).toHaveCount(0)

  // Retour sur A, déjà en cache : pas d'état de chargement, le viewer n'est pas remonté.
  await navigate(p, campaignUrl(campaignA.id))
  await expect(p.getByText('Description GH227 A')).toBeVisible()
  await expect(p.getByText('Description GH227 B')).toHaveCount(0)
})

test('la description enregistrée est affichée sans recharger la page', async () => {
  const p = s.page
  await navigate(p, campaignUrl(campaignA.id))
  await expect(p.getByText('Description GH227 A')).toBeVisible()

  await p.getByTitle('Modifier les champs').click()
  const editor = p.locator('.ProseMirror[contenteditable="true"]').filter({ hasText: 'Description GH227 A' })
  await editor.click()
  await p.keyboard.press('ControlOrMeta+a')
  await p.keyboard.type('Description GH227 A modifiée')
  await p.getByRole('button', { name: 'Enregistrer' }).click()

  await expect(p.locator('.ProseMirror[contenteditable="true"]')).toHaveCount(0)
  await expect(p.getByText('Description GH227 A modifiée')).toBeVisible()
})
