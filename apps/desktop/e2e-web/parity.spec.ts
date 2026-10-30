import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'
import { publish } from './support/ui'
import { DEMO_REPO, bareRepoPath, outsideClone, remoteLog } from './support/forge'
import { execFileSync } from 'child_process'

/**
 * GH44 — parcours de parité desktop/web (specs/GH44-tests.md §Parcours de parité) : ce que fait un
 * utilisateur sur le desktop doit marcher à l'identique dans le navigateur. Projet : la démo,
 * clonée à neuf pour ce fichier.
 */
const s = setupSession()

/** Terme absent de la démo : la recherche ne touche que l'exigence créée par le test. */
const MARKER = 'ZORGLUB-E2E'
let markedReqId = ''

test('P-1 — recherche et « remplacer tout »', async () => {
  const schema = await s.invoke<{ nodes: Array<{ name: string; objectTypes?: Array<{ name: string; category: string }> }> }>(
    'schema:get', s.project.localPath)
  const root = schema.nodes[0]
  const reqType = root.objectTypes!.find(t => t.category === 'requirement')!
  const created = await s.invoke<{ id: string }>('requirements:create', s.project.localPath, {
    objectTypeRef: `${root.name}::${reqType.name}`,
    title: `Exigence ${MARKER}`,
    fields: { statement: `THE system SHALL display ${MARKER} on startup` },
  }, s.project.workspaceDir)
  markedReqId = created.id

  await s.openView('Recherche')
  await s.page.getByRole('button', { name: 'Afficher le remplacement' }).click()
  await s.page.getByRole('textbox', { name: 'Rechercher…' }).fill(MARKER)
  await expect(s.page.getByText(/2 occurrences dans 1 élément/)).toBeVisible()
  await expect(s.page.getByRole('button', { name: new RegExp(`${markedReqId} Exigence ${MARKER}`) })).toBeVisible()
  await s.page.getByRole('textbox', { name: 'Remplacer par…' }).fill('QUUX-E2E')
  await s.page.getByRole('button', { name: 'Tout' }).click()

  await expect.poll(async () => (await s.invoke<{ title: string }>('requirements:get', s.project.localPath, markedReqId)).title)
    .toBe('Exigence QUUX-E2E')
  const req = await s.invoke<{ fields: { statement: string } }>('requirements:get', s.project.localPath, markedReqId)
  expect(req.fields.statement).toBe('THE system SHALL display QUUX-E2E on startup')
  await s.shot('p-1-remplacement')
})

test('P-2 — créer un dashboard et y ajouter un widget', async () => {
  await s.openView('Suivi')
  await s.page.getByRole('button', { name: 'Ajouter un dashboard' }).click()
  await s.page.getByPlaceholder('Mon dashboard…').fill('E2E dashboard')
  await s.page.getByRole('button', { name: 'Créer', exact: true }).click()
  await expect(s.page.getByText('Aucun widget dans ce dashboard.')).toBeVisible()

  await s.page.getByRole('button', { name: 'Ajouter un widget' }).click()
  await s.page.getByPlaceholder('Mon widget…').fill('Sécurité (E2E)')
  await s.page.getByLabel('Requête', { exact: true }).selectOption({ label: 'Exigences de sécurité' })
  // GH74 — contenu du widget : modèle « Table » (le code est généré).
  await s.page.getByLabel('Modèle', { exact: true }).selectOption({ label: 'Table' })
  await s.page.getByRole('dialog').getByRole('button', { name: 'Sauvegarder', exact: true }).click()

  await expect(s.page.getByText('Sécurité (E2E)')).toBeVisible()
  await expect(s.page.getByText('Aucun widget dans ce dashboard.')).toHaveCount(0)
  await s.shot('p-2-dashboard')
})

test('P-3 — publier puis créer une baseline', async () => {
  // Une baseline exige des repos sans modification en attente : on publie d'abord.
  const before = remoteLog('%H')
  await publish(s.page, 'E2E : parité avant baseline')
  await expect.poll(() => remoteLog('%H'), { timeout: 60_000 }).not.toBe(before)

  await s.openView('Version')
  await s.page.getByRole('button', { name: 'Baselines' }).click()
  await s.page.getByRole('button', { name: 'Rafraîchir' }).click()
  await expect(s.page.getByText('Création bloquée')).toHaveCount(0)
  await s.page.getByPlaceholder('v1.0.0').fill('E2E-1')
  await s.page.getByPlaceholder('Décrire cette baseline…').fill('Baseline créée depuis le web')
  await s.page.getByRole('button', { name: 'Créer la baseline' }).click()

  await expect(s.page.getByRole('button', { name: /E2E-1 Baseline créée depuis le web/ })).toBeVisible()
  const baselines = await s.invoke<Array<{ tag: string }>>('baseline:list', s.project.localPath)
  expect(baselines.map(b => b.tag)).toContain('E2E-1')
  await s.shot('p-3-baseline')
})

test('P-4 — conflit à la publication, résolu dans le navigateur (GH37)', async () => {
  const rel = 'requirements/PRD-0001.yaml'
  // Un autre utilisateur modifie le titre de PRD-0001 depuis son poste et publie.
  const other = outsideClone('conflit')
  other.write(rel, other.read(rel).replace(/^title: .*$/m, 'title: Capacité de charge (autre poste)'))
  other.commitAndPush('autre poste : titre PRD-0001')

  // Même champ, autre valeur, dans le navigateur.
  await s.invoke('requirements:update', s.project.localPath, 'PRD-0001', { title: 'Capacité de charge (web)' }, s.project.workspaceDir)
  await publish(s.page, 'web : titre PRD-0001')

  await expect(s.page.getByRole('heading', { name: 'Publication impossible' })).toBeVisible({ timeout: 60_000 })
  await expect(s.page.getByRole('listitem').filter({ hasText: rel })).toBeVisible()
  await s.page.getByRole('button', { name: 'Résoudre les conflits' }).click()

  await expect(s.page.getByText('0 / 1 fichiers mergés').first()).toBeVisible()
  await s.shot('p-4-conflit')
  // « Mes modifications » à gauche : on garde la valeur du web.
  await s.page.getByRole('button', { name: 'Tout prendre à gauche' }).click()
  await s.page.getByRole('button', { name: 'Merger' }).click()
  await expect(s.page.getByText('1 / 1 fichiers mergés').first()).toBeVisible()
  await s.page.getByRole('button', { name: 'Finaliser le merge' }).click()
  await expect(s.page.getByRole('heading', { name: 'Merge finalisé' })).toBeVisible({ timeout: 60_000 })
  await s.shot('p-4-merge-finalise')

  // Sur la forge : commit de merge à l'identité de l'utilisateur web, valeur du web retenue.
  await expect.poll(() => remoteLog('%an | %s'), { timeout: 30_000 }).toMatch(/^E2E Tester \| Merge branch /)
  expect(remoteLog('%P').split(' ')).toHaveLength(2)
  const remoteFile = execFileSync('git', ['-C', bareRepoPath(DEMO_REPO), 'show', `HEAD:${rel}`], { encoding: 'utf-8' })
  expect(remoteFile).toMatch(/^title: Capacité de charge \(web\)$/m)
})
