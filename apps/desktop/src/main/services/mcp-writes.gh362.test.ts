import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { GitService } from './git.service'
import { createMcpContainer, type McpContainer } from '../../mcp-server/container'
import { registerValidationTools } from '../../mcp-server/tools/validations.tools'
import { registerVersionTools } from '../../mcp-server/tools/versions.tools'

// GH362 — écriture des versions (release comprise) et des validations (sans signature) par le MCP.
// Conteneur MCP réel sur un vrai repo git, handlers appelés comme le ferait le SDK (scénarios GH362-tests.md).

const SCHEMA = {
  version: 1,
  linkTypes: [],
  nodes: [{
    name: 'root', label: 'Produit', objectTypes: [
      { name: 'exigence', label: 'Exigence', prefix: 'REQ', category: 'requirement', fields: [], statuses: [{ name: 'draft' }, { name: 'approved', isApproval: true }] },
      {
        name: 'version', label: 'Version', prefix: 'PV', category: 'version', fields: [],
        statuses: [{ name: 'en_cours' }, { name: 'released', isApproval: true }, { name: 'abandonnee', isTerminal: true }],
      },
      {
        name: 'validation', label: 'Validation', prefix: 'VAL', category: 'validation', fields: [],
        statuses: [{ name: 'en_cours' }, { name: 'signee', isApproval: true }, { name: 'annulee', isTerminal: true }],
        decisions: [{ name: 'en_attente', label: 'En attente', isPending: true }, { name: 'conforme', label: 'Conforme' }, { name: 'non_conforme', label: 'Non conforme' }],
      },
    ],
  }],
}

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>

let dir: string
let mcp: McpContainer
let tools: Record<string, Handler>
let tick = 0
const T0 = Date.UTC(2026, 10, 16) / 1000

async function commitAll(message: string) {
  await git.add({ fs, dir, filepath: '.' })
  await git.commit({ fs, dir, message, author: { name: 'Alice', email: 'a@x', timestamp: T0 + ++tick, timezoneOffset: 0 } })
}
const call = async <T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> => JSON.parse((await tools[name](args)).content[0].text) as T // eslint-disable-line @typescript-eslint/no-explicit-any
const newReq = async (title = 'R') => (await mcp.requirements.create(dir, { objectTypeRef: 'root::exigence', title, fields: {} } as never)).id
const tagExists = (tag: string) => git.resolveRef({ fs, dir, ref: `refs/tags/${tag}` }).then(() => true, () => false)

/** Version released par le MCP, incluant `ids`. */
async function releasedByMcp(title: string, ids: string[]) {
  await commitAll('éléments')
  const v = await call<{ id: string }>('create_version', { title })
  await call('include_in_version', { id: v.id, elementIds: ids })
  return call<{ id: string; status: string }>('release_version', { id: v.id, tag: `produit-${title}` })
}

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh362-'))
  await git.init({ fs, dir, defaultBranch: 'main' })
  await git.setConfig({ fs, dir, path: 'user.name', value: 'Alice' })
  await git.setConfig({ fs, dir, path: 'user.email', value: 'a@x' })
  await new GitService().writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
  await commitAll('schéma')
  mcp = createMcpContainer(dir, undefined, 'alice')
  tools = {}
  const server = { registerTool: (name: string, _def: unknown, handler: Handler) => { tools[name] = handler } } as never
  registerVersionTools(server, mcp)
  registerValidationTools(server, mcp)
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('versions par le MCP (GH362 §3)', () => {
  it('cycle complet : création, inclusion, retrait, impact, release (scénario 1)', async () => {
    const [a, b, c] = [await newReq('A'), await newReq('B'), await newReq('C')]
    await commitAll('éléments')
    const v = await call<{ id: string; status: string }>('create_version', { title: '1.0' })
    expect(v.status).toBe('en_cours')
    await call('include_in_version', { id: v.id, elementIds: [a, b] })
    const removed = await call<{ changes: Array<{ id: string }> }>('remove_from_version', { id: v.id, elementIds: [b] })
    expect(removed.changes.map(x => x.id)).toEqual([a])
    const impacted = await call<{ impacted: unknown[] }>('set_version_impact', { id: v.id, elementId: c, status: 'pas_d_impact_reel', comment: 'Hors périmètre' })
    expect(impacted.impacted).toEqual([{ id: c, status: 'pas_d_impact_reel', comment: 'Hors périmètre' }])

    const preview = await call<{ suggestedTag: string; problems: unknown[] }>('get_version_release_preview', { id: v.id })
    expect(preview.problems).toEqual([])
    const released = await call<{ status: string; freeze: { tag: string; sha: string }; history: { status: Array<{ value: string; source?: string }> } }>(
      'release_version', { id: v.id },
    )
    expect(released.status).toBe('released')
    expect(released.freeze.tag).toBe(preview.suggestedTag)
    expect(await tagExists(preview.suggestedTag)).toBe(true)
    expect(released.history.status.at(-1)).toMatchObject({ value: 'released' })
    expect(released.history.status[0]).toMatchObject({ source: 'mcp' })
  })

  it('include_in_version signale les IDs introuvables (revue GH362)', async () => {
    const a = await newReq()
    const v = await call<{ id: string }>('create_version', { title: '1.0' })
    const res = await call<{ changes: Array<{ id: string }>; notFound: string[] }>('include_in_version', { id: v.id, elementIds: [a, 'REQ-9999'] })
    expect(res.changes.map(c => c.id)).toEqual([a])
    expect(res.notFound).toEqual(['REQ-9999'])
  })

  it('release sans config git locale : commit et tag signés par le --user du MCP (revue GH362)', async () => {
    await git.setConfig({ fs, dir, path: 'user.name', value: undefined })
    await git.setConfig({ fs, dir, path: 'user.email', value: undefined })
    const v = await releasedByMcp('1.0', [await newReq()])
    const tagOid = await git.resolveRef({ fs, dir, ref: 'refs/tags/produit-1.0' })
    const { tag } = await git.readTag({ fs, dir, oid: tagOid })
    expect(tag.tagger).toMatchObject({ name: 'alice' })
    const { commit } = await git.readCommit({ fs, dir, oid: tag.object })
    expect(commit.author).toMatchObject({ name: 'alice' })
    expect(commit.message).toContain(v.id)
  })

  it('update_version : champs et label en cours ; released → RELEASE_REQUIRED (scénario 2)', async () => {
    const v = await call<{ id: string }>('create_version', { title: '1.0' })
    const updated = await call<{ title: string }>('update_version', { id: v.id, title: '1.1' })
    expect(updated.title).toBe('1.1')
    await expect(tools.update_version({ id: v.id, status: 'released' })).rejects.toThrow(/RELEASE_REQUIRED/)
  })

  it('version released : verrouillée, seulement abandonnable (scénario 3) ; impact refusé (scénario 7)', async () => {
    const v = await releasedByMcp('1.0', [await newReq()])
    await expect(tools.update_version({ id: v.id, title: 'Autre' })).rejects.toThrow(/VERSION_LOCKED/)
    await expect(tools.set_version_impact({ id: v.id, elementId: 'REQ-0001', status: 'impact_teste' })).rejects.toThrow(/NOT_IN_PROGRESS/)
    expect((await call<{ status: string }>('update_version', { id: v.id, status: 'abandonnee' })).status).toBe('abandonnee')
  })

  it('release refusée sur un changement non commité, sans tag ni écriture (scénario 4)', async () => {
    const a = await newReq()
    const v = await call<{ id: string }>('create_version', { title: '1.0' })
    await call('include_in_version', { id: v.id, elementIds: [a] })
    await expect(tools.release_version({ id: v.id, tag: 'produit-1.0' })).rejects.toThrow(/DIRTY_CHANGES/)
    expect(await tagExists('produit-1.0')).toBe(false)
    expect((await mcp.versions.get(dir, v.id)).status).toBe('en_cours')
  })

  it('release refusée sur un tag déjà pris (scénario 5) ; copie = nouvelle version en cours (scénario 6)', async () => {
    const v = await releasedByMcp('1.0', [await newReq()])
    const copy = await call<{ id: string; status: string }>('copy_version', { id: v.id })
    expect(copy.id).not.toBe(v.id)
    expect(copy.status).toBe('en_cours')
    await commitAll('copie')
    await expect(tools.release_version({ id: copy.id, tag: 'produit-1.0' })).rejects.toThrow(/TAG_EXISTS/)
  })
})

describe('validations par le MCP (GH362 §4)', () => {
  it('cycle : création, décision directe, proposition rejetée puis confirmée ; jamais signée (scénarios 8, 12)', async () => {
    const [a, b] = [await newReq('A'), await newReq('B')]
    const v = await releasedByMcp('1.0', [a, b])
    const val = await call<{ id: string; status: string }>('create_validation', { versionId: v.id, title: 'Validation 1.0' })
    expect(val.status).toBe('en_cours')

    expect(await call('decide_validation', { id: val.id, requirementId: a, decision: 'conforme', comment: 'OK' }))
      .toMatchObject({ decision: 'conforme', decidedBy: 'alice', comment: 'OK' })
    await call('propose_validation_decision', { id: val.id, requirementId: b, decision: 'non_conforme' })
    expect((await call<{ entry: unknown }>('reject_validation_decision', { id: val.id, requirementId: b })).entry).toBeNull()
    await call('propose_validation_decision', { id: val.id, requirementId: b, decision: 'conforme' })
    const confirmed = await call<Record<string, unknown>>('confirm_validation_decision', { id: val.id, requirementId: b })
    expect(confirmed).toMatchObject({ decision: 'conforme', decidedBy: 'alice' })
    expect(confirmed.proposed).toBeUndefined()

    const page = await call<{ pendingCount: number; validation: { status: string } }>('get_validation', { id: val.id })
    expect(page.pendingCount).toBe(0)
    expect(page.validation.status).toBe('en_cours')
    expect(Object.keys(tools).filter(n => /sign/.test(n))).toEqual([])
    // La signature reste possible pour l'humain, par le service.
    expect((await mcp.validations.sign(dir, val.id)).status).toBe('signee')
  })

  it('création refusée en double ou sans titre (scénario 9) ; modification (scénario 10)', async () => {
    const v = await releasedByMcp('1.0', [await newReq()])
    const val = await call<{ id: string }>('create_validation', { versionId: v.id, title: 'V' })
    await expect(tools.create_validation({ versionId: v.id, title: 'Bis' })).rejects.toThrow(/VALIDATION_EXISTS/)
    await expect(mcp.validations.create(dir, { versionId: v.id, title: ' ', fields: {} })).rejects.toThrow(/TITLE_EMPTY/)
    expect(await call('update_validation', { id: val.id, title: 'V2', fields: { note: 'x' } })).toMatchObject({ title: 'V2', fields: { note: 'x' } })
  })

  it('annulation : statut terminal, puis plus aucune écriture (scénario 11)', async () => {
    const a = await newReq()
    const v = await releasedByMcp('1.0', [a])
    const val = await call<{ id: string }>('create_validation', { versionId: v.id, title: 'V' })
    expect((await call<{ status: string }>('cancel_validation', { id: val.id })).status).toBe('annulee')
    await expect(tools.decide_validation({ id: val.id, requirementId: a, decision: 'conforme' })).rejects.toThrow(/VALIDATION_LOCKED/)
    await expect(tools.update_validation({ id: val.id, title: 'X' })).rejects.toThrow(/VALIDATION_LOCKED/)
  })
})
