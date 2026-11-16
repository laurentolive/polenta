import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import { E2E } from './support/env'
import { setupSession } from './support/session'

/**
 * GH373 — ajout d'un composant : types de liens par défaut entre les types cochés (vérification,
 * implémentation interne, implémentation depuis le parent ; `issue-impact` affiché grisé), un type
 * propre au composant, lien parent dans le schéma du parent (specs/GH373-tests.md E-1 à E-5).
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface TypeLike { name: string; category: string }
interface NodeLike { name: string; objectTypes?: TypeLike[]; children?: NodeLike[] }
interface LinkTypeLike { name: string; labelSourceToTarget: string; labelTargetToSource: string; sourceRefs?: string[]; targetRefs?: string[]; defaultVisible?: boolean }
interface SchemaLike { nodes: NodeLike[]; linkTypes?: LinkTypeLike[] }

const LABEL = 'Contrôle moteur GH373'
const ROOT = 'CONTROLE_MOTEUR_GH373'
const LROOT = 'controle-moteur-gh373'
const RUN = Date.now().toString(36)

const P = () => s.project.localPath
const W = () => s.project.workspaceDir
const schemaOf = (repoPath: string) => s.invoke<SchemaLike>('schema:get', repoPath)
const linkType = async (repoPath: string, name: string) => (await schemaOf(repoPath)).linkTypes?.find(l => l.name === name)
const rootReqRefs = async () => ((await schemaOf(P())).nodes.find(n => n.name === 'root')?.objectTypes ?? [])
  .filter(t => t.category === 'requirement').map(t => `root::${t.name}`)

async function openStructure() {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/schema', { repoPath: P() }))
  await s.page.waitForLoadState('networkidle')
  await expect(s.page.getByTitle(/^Ajouter à /).first()).toBeAttached({ timeout: 15_000 })
}

async function openAddComponent() {
  await s.page.getByTitle(/^Ajouter à /).first().click()
  await s.page.getByText(/^\+ Composant$/).click()
  const dialog = s.page.locator('div.fixed').filter({ hasText: 'Ajouter un composant' }).first()
  await expect(dialog).toBeVisible()
  return dialog
}

async function addLocalComponent(name: string, uncheck: RegExp[] = []) {
  const dialog = await openAddComponent()
  await dialog.getByPlaceholder('comp-motor-control').fill(name)
  await dialog.getByRole('checkbox', { name: /Composant local/ }).check()
  await dialog.getByPlaceholder(name, { exact: true }).fill(LABEL)
  for (const box of uncheck) await dialog.getByRole('checkbox', { name: box }).uncheck()
  await dialog.getByRole('button', { name: /^Ajouter$/ }).last().click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
}

const VERIF = /^Vérification : test → exigence$/
const IMPL = /^Implémentation : exigence → exigence du composant$/
const IMPL_PARENT = /^Implémentation depuis le parent/
const ISSUE = /^Impact d’issue/

test('E-1 — fenêtre : liens cochés, masqués avec leur extrémité, issue-impact grisé', async () => {
  expect((await rootReqRefs()).length, 'le root de la démo a un type exigence').toBeGreaterThan(0)
  await openStructure()
  const dialog = await openAddComponent()
  const box = (name: RegExp) => dialog.getByRole('checkbox', { name })
  for (const name of [VERIF, IMPL, IMPL_PARENT, ISSUE]) await expect(box(name)).toBeChecked()
  await expect(box(ISSUE)).toBeDisabled()

  await box(VERIF).uncheck()
  await dialog.getByRole('checkbox', { name: 'Tests', exact: true }).uncheck()
  await expect(box(VERIF)).toHaveCount(0)
  await dialog.getByRole('checkbox', { name: 'Tests', exact: true }).check()
  await expect(box(VERIF)).not.toBeChecked()

  await dialog.getByRole('checkbox', { name: 'Issues', exact: true }).uncheck()
  await expect(box(ISSUE)).toHaveCount(0)
  await dialog.getByRole('checkbox', { name: 'Exigences', exact: true }).uncheck()
  for (const name of [VERIF, IMPL, IMPL_PARENT]) await expect(box(name)).toHaveCount(0)
  await expect(dialog.getByText('Types de liens créés par défaut')).toHaveCount(0)
  await s.shot('gh373-dialog')
  await dialog.getByRole('button', { name: 'Annuler' }).click()
  await expect(dialog).toBeHidden()
})

test('E-2 — composant local : 3 types de liens dans le schéma du repo, liens créables', async () => {
  await openStructure()
  await addLocalComponent('gh373-a')
  const parentRefs = await rootReqRefs()
  expect(await linkType(P(), `${LROOT}-verification`)).toEqual({
    name: `${LROOT}-verification`, labelSourceToTarget: 'vérifie', labelTargetToSource: 'est vérifiée par',
    sourceRefs: [`gh373-a::${ROOT}_TEST`], targetRefs: [`gh373-a::${ROOT}_REQ`], defaultVisible: true,
  })
  expect(await linkType(P(), `${LROOT}-implementation`)).toEqual({
    name: `${LROOT}-implementation`, labelSourceToTarget: 'est implémentée par', labelTargetToSource: 'implémente',
    sourceRefs: [`gh373-a::${ROOT}_REQ`], targetRefs: [`gh373-a::${ROOT}_REQ`],
  })
  expect(await linkType(P(), `${LROOT}-implementation-parent`)).toEqual({
    name: `${LROOT}-implementation-parent`, labelSourceToTarget: 'est implémentée par', labelTargetToSource: 'implémente',
    sourceRefs: parentRefs, targetRefs: [`gh373-a::${ROOT}_REQ`],
  })
  expect((await schemaOf(P())).linkTypes?.map(l => l.name)).toContain('issue-impact')

  const req = await s.invoke<{ id: string }>('requirements:create', P(), { objectTypeRef: `gh373-a::${ROOT}_REQ`, title: 'GH373 R', fields: {} }, W())
  const testObj = await s.invoke<{ id: string }>('tests:create', P(), { objectTypeRef: `gh373-a::${ROOT}_TEST`, title: 'GH373 T', fields: {}, steps: [] }, W())
  const sys = await s.invoke<{ id: string }>('requirements:create', P(), { objectTypeRef: parentRefs[0], title: 'GH373 SYS', fields: {} }, W())
  await s.invoke('requirements:link-create', P(), { type: `${LROOT}-verification`, sourceId: testObj.id, targetId: req.id }, W())
  await s.invoke('requirements:link-create', P(), { type: `${LROOT}-implementation-parent`, sourceId: sys.id, targetId: req.id }, W())
  const links = await s.invoke<Array<{ type: string; sourceId: string; targetId: string }>>('links:list', P(), W())
  expect(links.filter(l => l.targetId === req.id).map(l => l.type).sort())
    .toEqual([`${LROOT}-implementation-parent`, `${LROOT}-verification`])
})

test('E-3 / E-4 — lien décoché non créé ; second composant de même label : suffixe -2', async () => {
  await openStructure()
  await addLocalComponent('gh373-b', [IMPL])
  const names = (await schemaOf(P())).linkTypes?.map(l => l.name) ?? []
  expect(names).toContain(`${LROOT}-verification-2`)
  expect(names).toContain(`${LROOT}-implementation-parent-2`)
  expect(names).not.toContain(`${LROOT}-implementation-2`)
  expect((await linkType(P(), `${LROOT}-verification-2`))?.sourceRefs).toEqual([`gh373-b::${ROOT}_TEST_2`])
})

test('E-5 — composant en repo séparé neuf : liens internes chez lui, lien parent chez le parent', async () => {
  const name = `gh373-comp-${RUN}`
  const bare = path.join(E2E.remotesDir, `${name}.git`)
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', bare])
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gh373-seed-'))
  execFileSync('git', ['init', '-q', '--initial-branch=main', work])
  fs.writeFileSync(path.join(work, 'README.md'), 'gh373\n')
  execFileSync('git', ['-C', work, 'add', '-A'])
  execFileSync('git', ['-C', work, '-c', 'user.name=S', '-c', 'user.email=s@x', 'commit', '-qm', 'seed'])
  execFileSync('git', ['-C', work, 'push', '-q', bare, 'main'])
  fs.rmSync(work, { recursive: true, force: true })

  await openStructure()
  const dialog = await openAddComponent()
  await dialog.getByPlaceholder('comp-motor-control').fill(name)
  await dialog.getByPlaceholder(name, { exact: true }).fill('Pompe GH373')
  await dialog.getByPlaceholder('git@github.com:org/repo.git').fill(`${E2E.gitBaseUrl}/${name}.git`)
  await dialog.getByRole('button', { name: /^Ajouter$/ }).last().click()
  await expect(dialog).toBeHidden({ timeout: 60_000 })

  const compPath = path.join(path.dirname(P()), name)
  await expect.poll(async () => {
    try { return (await schemaOf(compPath)).linkTypes?.map(l => l.name).sort() ?? [] } catch { return [] }
  }, { timeout: 30_000 }).toEqual(['issue-impact', 'pompe-gh373-implementation', 'pompe-gh373-verification'])
  expect((await linkType(compPath, 'pompe-gh373-verification'))?.sourceRefs).toEqual(['root::POMPE_GH373_TEST'])
  await expect.poll(async () => (await linkType(P(), 'pompe-gh373-implementation-parent'))?.targetRefs, { timeout: 15_000 })
    .toEqual(['root::POMPE_GH373_REQ'])
  expect((await linkType(P(), 'pompe-gh373-implementation-parent'))?.sourceRefs).toEqual(await rootReqRefs())
})
