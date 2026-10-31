import * as fs from 'fs'
import * as path from 'path'
import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH200 — trace par élément (specs/GH200-tests.md A8, A9, A13) : départ / approbation dans la page
 * du changeset, « Voir les modifications », approbation figée à la clôture, modification hors
 * interface signalée dans le backlog.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }
interface ChangeLike { id: string; toModify: Array<{ id: string; state: string; approved?: { sha: string | null; version: number } }> }

const TYPE = 'root::gh200t_req'
let changeId = ''
let reqId = ''

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}
async function publish(message: string) {
  await s.invoke('sync:stage-all', s.project.localPath)
  await s.invoke('sync:commit', s.project.localPath, message)
}

test.beforeAll(async () => {
  const { localPath } = s.project
  await s.invoke('schema:invalidate', localPath)
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []),
    { name: 'gh200t_cs', label: 'GH200T CS', prefix: 'GTC', category: 'changeset', fields: [],
      statuses: [{ name: 'ouvert', label: 'Ouvert' }, { name: 'clos', label: 'Clos', isTerminal: true }] },
    { name: 'gh200t_req', label: 'GH200T Req', prefix: 'GTQ', category: 'requirement', fields: [],
      statuses: [{ name: 'draft', label: 'Brouillon' }, { name: 'approved', label: 'Approuvé', isApproval: true }] },
  ]
  await s.invoke('schema:save', localPath, schema)
  reqId = (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: TYPE, title: 'Avant', status: 'approved' })).id
  await publish('GH200 — approuvée')
  changeId = (await s.invoke<{ id: string }>('changesets:create', localPath, { objectTypeRef: 'root::gh200t_cs', title: 'GH200 trace', component: 'root' })).id
})

test('GH200-A8 — rouvrir, modifier, réapprouver, publier : départ / approbation, diff', async () => {
  const p = s.page
  const { localPath } = s.project
  await s.invoke('requirements:transition', localPath, reqId, { toStatus: 'draft' })
  await s.invoke('requirements:update', localPath, reqId, { title: 'Après' })
  await s.invoke('requirements:transition', localPath, reqId, { toStatus: 'approved' })
  await publish('GH200 — réapprouvée')
  await navigate(p, s.projectUrl(`/changeset/${changeId}`, { repoPath: localPath }))
  // GH207 (2026-10-31) : la page ne montre plus que le lien vers le diff ; la trace reste exposée.
  const [trace] = await s.invoke<Array<{ base: { version: number } | null; approved: { version: number } | null }>>('changesets:trace', localPath, changeId)
  expect(trace.base?.version).toBe(1)
  expect(trace.approved?.version).toBe(2)
  await p.getByTestId(`change-trace-diff-${reqId}`).click()
  await expect(p.getByText('Après').first()).toBeVisible()
})

test('GH200-A9 — clore le changeset : approbation figée dans le fichier', async () => {
  const { localPath } = s.project
  await s.invoke('changesets:update', localPath, changeId, { status: 'clos' })
  const line = (await s.invoke<ChangeLike>('changesets:get', localPath, changeId)).toModify.find(t => t.id === reqId)
  expect(line?.state).toBe('modified')
  expect(line?.approved?.version).toBe(2)
})

test('GH200-A13 — commit direct sur une approuvée : signalée dans le backlog', async () => {
  const p = s.page
  const { localPath } = s.project
  const file = path.join(localPath, 'requirements', `${reqId}.yaml`)
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^title: .*$/m, 'title: Hors interface'))
  await publish('GH200 — commit direct')
  const backlogs = await s.invoke<Array<{ repoPath: string; component: string; items: Array<{ id: string }> }>>('changesets:backlog', localPath, s.project.workspaceDir)
  const own = backlogs.find(b => b.items.some(i => i.id === reqId))!
  await s.openView('Changesets')
  await p.getByTestId(`changes-backlog-entry-${own.repoPath.split(/[\\/]/).filter(Boolean).pop()}-${own.component}`).click()
  await expect(p.getByTestId(`backlog-outside-${reqId}`)).toBeVisible()
})
