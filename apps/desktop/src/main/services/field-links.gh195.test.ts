import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition, ProjectSchema, Requirement } from '@polenta/types'
import {
  fieldValueToText, isAcceptedLinkUrl, isFieldRequiredNow, objectFieldReader, parseLinkLine, parseLinksText,
  prepareFieldsWrite, readLinkValues, requiredWhenIssues, sameHistoryValue,
} from '@polenta/types'
import { GitService } from './git.service'
import { RequirementsIndexService } from './requirements-index.service'
import { RequirementsService } from './requirements.service'
import { SchemaService, SchemaValidationError } from './schema.service'
import { validateBulkEntries } from './bulk-import-validation.util'
import { CampaignsService } from './campaigns.service'
import { planUpdate } from './update-validation.util'

// GH195 — type de champ `link` et obligation conditionnelle `requiredWhen` (specs/GH195-tests.md).

const TYPE: ObjectTypeDefinition = {
  name: 'exigence', label: 'Exigence', prefix: 'SYS', category: 'requirement',
  statuses: [{ name: 'draft', label: 'Brouillon' }, { name: 'approved', label: 'Approuvé', isApproval: true }],
  fields: [
    { name: 'datasheet', label: 'Fiche', type: 'link' },
    { name: 'reports', label: 'Rapports', type: 'link', multiple: true },
    { name: 'rationale', label: 'Justification', type: 'text', requiredWhen: { status: ['approved'] } },
    { name: 'safety', label: 'Sécurité', type: 'boolean' },
    { name: 'domains', label: 'Domaines', type: 'multi_enum', values: ['bat', 'sw', 'hw'] },
    { name: 'proof', label: 'Preuve', type: 'link', requiredWhen: { safety: [true], domains: ['bat'] } },
  ],
}

const SCHEMA = {
  version: 1,
  nodes: [{ name: 'root', label: 'Produit', objectTypes: [TYPE] }],
  linkTypes: [],
} as unknown as ProjectSchema

describe('forme texte et URL', () => {
  it('parseLinkLine : dernier « | », URL seule, vide', () => {
    expect(parseLinkLine('RE-118 | https://ged/x')).toEqual({ label: 'RE-118', url: 'https://ged/x' })
    expect(parseLinkLine('  https://ged/x  ')).toEqual({ url: 'https://ged/x' })
    expect(parseLinkLine('a | b | https://x')).toEqual({ label: 'a | b', url: 'https://x' })
    expect(parseLinkLine('   ')).toBeNull()
    expect(parseLinksText('A | https://a\n\nhttps://b\r\n')).toEqual([{ label: 'A', url: 'https://a' }, { url: 'https://b' }])
  })

  it('schémas acceptés', () => {
    for (const ok of ['http://a/b', 'https://a', 'file:///C:/essais/x.pdf', '\\\\srv\\essais\\RE 118.pdf']) {
      expect(isAcceptedLinkUrl(ok), ok).toBe(true)
    }
    for (const ko of ['C:\\docs\\a.pdf', 'javascript:alert(1)', 'mailto:a@b', 'texte', '\\\\srv', 'https://a b']) {
      expect(isAcceptedLinkUrl(ko), ko).toBe(false)
    }
  })

  it('readLinkValues tolère chaîne, objet, liste ; fieldValueToText', () => {
    expect(readLinkValues('https://a')).toEqual([{ url: 'https://a' }])
    expect(readLinkValues({ label: ' ', url: 'https://a' })).toEqual([{ url: 'https://a' }])
    expect(readLinkValues([{ label: 'A', url: 'https://a' }, 'B | https://b'])).toEqual([
      { label: 'A', url: 'https://a' }, { label: 'B', url: 'https://b' },
    ])
    expect(fieldValueToText([{ label: 'A', url: 'https://a' }, { url: 'https://b' }])).toBe('A | https://a\nhttps://b')
    expect(fieldValueToText(3)).toBe('3')
  })

  it('historique : chaîne et objet sont la même valeur', () => {
    expect(sameHistoryValue('link', 'A | https://a', { label: 'A', url: 'https://a' })).toBe(true)
    expect(sameHistoryValue('link', { url: 'https://a' }, { url: 'https://b' })).toBe(false)
  })
})

describe('prepareFieldsWrite', () => {
  it('normalise les liens modifiés (simple / multiple)', () => {
    const r = prepareFieldsWrite(TYPE, null, {
      status: 'draft', fields: { datasheet: 'Fiche | https://a', reports: 'R1 | https://r1\nhttps://r2' },
    })
    expect(r).toEqual({ ok: true, fields: {
      datasheet: { label: 'Fiche', url: 'https://a' },
      reports: [{ label: 'R1', url: 'https://r1' }, { url: 'https://r2' }],
    } })
  })

  it('refuse une URL invalide, plusieurs liens sur un champ simple', () => {
    const bad = prepareFieldsWrite(TYPE, null, { status: 'draft', fields: { datasheet: 'C:\\docs\\a.pdf' } })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.field).toBe('datasheet')
    const two = prepareFieldsWrite(TYPE, null, { status: 'draft', fields: { datasheet: 'https://a\nhttps://b' } })
    expect(two.ok).toBe(false)
  })

  it('ne réécrit pas un champ non modifié (liste sur champ simple tolérée)', () => {
    const legacy = { status: 'draft', fields: { datasheet: [{ url: 'https://a' }, { url: 'https://b' }] } }
    const r = prepareFieldsWrite(TYPE, legacy, { ...legacy, fields: { ...legacy.fields, safety: false } })
    expect(r.ok && r.fields.datasheet).toEqual(legacy.fields.datasheet)
  })

  it('formulaire qui renvoie tous les champs en chaînes : rien de « modifié », valeurs stockées conservées', () => {
    const legacy = {
      status: 'approved',
      fields: { datasheet: [{ url: 'https://a' }, { url: 'https://b' }], reports: [{ label: 'R', url: 'https://r' }], safety: false },
    }
    const form = { status: 'approved', fields: { datasheet: 'https://a\nhttps://b', reports: 'R | https://r', safety: 'false', rationale: '', proof: '' } }
    const r = prepareFieldsWrite(TYPE, legacy, form)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.fields.datasheet).toEqual(legacy.fields.datasheet)
      expect(r.fields.reports).toEqual(legacy.fields.reports)
      expect('proof' in r.fields).toBe(false)
    }
  })

  it('« | » brut refusé dans une URL (séparateur de la forme texte) ; « libellé | » = URL manquante', () => {
    expect(isAcceptedLinkUrl('https://jira/x?jql=a|b')).toBe(false)
    expect(isAcceptedLinkUrl('https://jira/x?jql=a%7Cb')).toBe(true)
    const r = prepareFieldsWrite(TYPE, null, { status: 'draft', fields: { datasheet: 'Spec doc |' } })
    expect(r).toEqual({ ok: false, field: 'datasheet', reason: "URL manquante pour 'datasheet' (libellé « Spec doc »)" })
  })

  it('lien vidé : clé retirée', () => {
    const r = prepareFieldsWrite(TYPE, { fields: { datasheet: { url: 'https://a' } } }, { fields: { datasheet: '' } })
    expect(r.ok && 'datasheet' in r.fields).toBe(false)
  })

  it('requiredWhen sur le statut : transition refusée, message nommant champ et condition', () => {
    const before = { status: 'draft', fields: {} }
    const r = prepareFieldsWrite(TYPE, before, { status: 'approved', fields: {} })
    expect(r).toEqual({ ok: false, field: 'rationale', reason: '« Justification » est obligatoire quand Statut = Approuvé' })
    expect(prepareFieldsWrite(TYPE, before, { status: 'approved', fields: { rationale: 'ok' } }).ok).toBe(true)
  })

  it('Q2 : objet ancien non conforme modifiable sur ses autres champs', () => {
    const legacy = { status: 'approved', fields: {} }
    expect(prepareFieldsWrite(TYPE, legacy, { status: 'approved', fields: { safety: false } }).ok).toBe(true)
    expect(prepareFieldsWrite(TYPE, legacy, { status: 'approved', fields: { rationale: '' } }).ok).toBe(true)
    const filled = { status: 'approved', fields: { rationale: 'retour terrain' } }
    expect(prepareFieldsWrite(TYPE, filled, { status: 'approved', fields: { rationale: '' } }).ok).toBe(false)
  })

  it('requiredWhen sur boolean et multi_enum (intersection), OU entre les clés', () => {
    expect(prepareFieldsWrite(TYPE, null, { status: 'draft', fields: { safety: true } }).ok).toBe(false)
    expect(prepareFieldsWrite(TYPE, null, { status: 'draft', fields: { safety: 'true' } }).ok).toBe(false)
    expect(prepareFieldsWrite(TYPE, null, { status: 'draft', fields: { domains: 'sw, bat' } }).ok).toBe(false)
    expect(prepareFieldsWrite(TYPE, null, { status: 'draft', fields: { domains: 'sw', safety: false } }).ok).toBe(true)
    expect(prepareFieldsWrite(TYPE, null, { status: 'draft', fields: { safety: true, proof: 'https://p' } }).ok).toBe(true)
  })

  it('isFieldRequiredNow suit la valeur courante', () => {
    const proof = TYPE.fields.find(f => f.name === 'proof')!
    expect(isFieldRequiredNow(proof, objectFieldReader(TYPE, { fields: { safety: true } }))).toBe(true)
    expect(isFieldRequiredNow(proof, objectFieldReader(TYPE, { fields: { safety: false } }))).toBe(false)
  })

  it('type introuvable : rien à contrôler', () => {
    expect(prepareFieldsWrite(null, null, { fields: { x: 'C:\\a' } })).toEqual({ ok: true, fields: { x: 'C:\\a' } })
  })
})

describe('requiredWhenIssues', () => {
  const issues = (fields: ObjectTypeDefinition['fields']) => requiredWhenIssues({ ...TYPE, fields })

  it('erreurs de structure', () => {
    expect(issues([{ name: 'a', type: 'text', requiredWhen: { a: ['x'] } }])[0].level).toBe('error')
    expect(issues([{ name: 'a', type: 'text', requiredWhen: { status: [] } }])[0].level).toBe('error')
    expect(issues([{ name: 't', type: 'text' }, { name: 'a', type: 'text', requiredWhen: { t: ['x'] } }])[0].level).toBe('error')
  })

  it('avertissements : référence ou valeur inconnue', () => {
    expect(issues([{ name: 'a', type: 'text', requiredWhen: { ghost: ['x'] } }])[0].level).toBe('warning')
    expect(issues([{ name: 'a', type: 'text', requiredWhen: { status: ['urgent'] } }])[0].level).toBe('warning')
    expect(issues([{ name: 'b', type: 'boolean' }, { name: 'a', type: 'text', requiredWhen: { b: [true] } }])).toEqual([])
  })

  it('campagne : statuts fixes', () => {
    expect(requiredWhenIssues({ category: 'campaign', fields: [{ name: 'a', type: 'text', requiredWhen: { status: ['completed'] } }] })).toEqual([])
  })
})

describe('écritures réelles et MCP', () => {
  let dir: string
  let git: GitService
  let requirements: RequirementsService

  beforeEach(async () => {
    dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh195-'))
    git = new GitService()
    await git.writeYaml(dir, '.polenta/schema.yaml', SCHEMA)
    const schemaStub = { resolveComponentRepoPath: async () => null, get: async () => SCHEMA } as unknown as SchemaService
    requirements = new RequirementsService(git, new RequirementsIndexService(git), schemaStub)
  })

  afterEach(async () => {
    await fsP.rm(dir, { recursive: true, force: true })
  })

  it('création : forme texte convertie et écrite en objets', async () => {
    const r = await requirements.create(dir, { objectTypeRef: 'root::exigence', title: 'R', fields: { reports: 'RE-118 | https://ged/118' } })
    const onDisk = await git.readYaml<Requirement>(dir, `requirements/${r.id}.yaml`)
    expect(onDisk?.fields.reports).toEqual([{ label: 'RE-118', url: 'https://ged/118' }])
  })

  it('mise à jour : URL invalide refusée, rien n’est écrit', async () => {
    const r = await requirements.create(dir, { objectTypeRef: 'root::exigence', title: 'R', fields: {} })
    await expect(requirements.update(dir, r.id, { fields: { datasheet: 'C:\\docs\\a.pdf' } })).rejects.toThrow(/URL refusée/)
    expect((await git.readYaml<Requirement>(dir, `requirements/${r.id}.yaml`))?.fields.datasheet).toBeUndefined()
  })

  it('transition : requiredWhen refusé', async () => {
    const r = await requirements.create(dir, { objectTypeRef: 'root::exigence', title: 'R', fields: {} })
    await expect(requirements.transition(dir, r.id, { toStatus: 'approved' })).rejects.toThrow(/Justification/)
    await requirements.update(dir, r.id, { fields: { rationale: 'retour terrain' } })
    expect((await requirements.transition(dir, r.id, { toStatus: 'approved' })).status).toBe('approved')
  })

  it('bulk import (dryRun) : forme texte acceptée, URL invalide refusée', () => {
    const res = validateBulkEntries(SCHEMA, [
      { objectTypeRef: 'root::exigence', title: 'A', fields: { reports: 'RE | https://x' } },
      { objectTypeRef: 'root::exigence', title: 'B', fields: { reports: 'javascript:alert(1)' } },
    ] as never, () => 'SYS-0001')
    expect(res.valid.map(v => v.index)).toEqual([0])
    expect(res.errors[0]).toMatchObject({ index: 1, field: 'reports' })
  })

  it('update MCP (planUpdate) : requiredWhen contrôlé', () => {
    const existing = { id: 'SYS-0001', objectTypeRef: 'root::exigence', title: 'R', status: 'draft', fields: {} }
    const plan = planUpdate(SCHEMA, 'requirement', existing as never, { id: 'SYS-0001', status: 'approved' } as never)
    expect(plan).toMatchObject({ ok: false, field: 'rationale' })
  })
})

describe('campagne', () => {
  let dir: string
  beforeEach(async () => { dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh195c-')) })
  afterEach(async () => { await fsP.rm(dir, { recursive: true, force: true }) })

  it('passage implicite planned → in_progress au premier résultat : requiredWhen sur le statut non déclenché', async () => {
    const git = new GitService()
    const campaignType = {
      name: 'campagne', prefix: 'CAMP', category: 'campaign', fields: [
        { name: 'bench', label: 'Banc', type: 'text', requiredWhen: { status: ['in_progress', 'completed'] } },
      ],
    }
    await git.writeYaml(dir, '.polenta/schema.yaml', { version: 1, nodes: [{ name: 'root', objectTypes: [campaignType] }], linkTypes: [] })
    const tc = { id: 'TEST-0001', title: 'T', objectTypeRef: 'root::test', status: 'approved', version: 1, fields: {}, steps: [] }
    await git.writeYaml(dir, 'campaigns/CAMP-0001.yaml', {
      id: 'CAMP-0001', title: 'C', objectTypeRef: 'root::campagne', fields: {}, status: 'planned',
      createdAt: '2026-10-01T00:00:00.000Z', completedAt: null, testCaseIds: ['TEST-0001'],
      runs: [{ entryId: 'TEST-0001-1', testCaseId: 'TEST-0001', status: 'pending', testSnapshot: tc }],
    })
    const service = new CampaignsService(git, { findOne: async () => tc } as never, {} as never)
    const updated = await service.updateRun(dir, 'CAMP-0001', 'TEST-0001-1', 'PASS', 'RUN-1')
    expect(updated.status).toBe('in_progress')
  })
})

describe('schéma', () => {
  let dir: string
  beforeEach(async () => { dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh195s-')) })
  afterEach(async () => { await fsP.rm(dir, { recursive: true, force: true }) })

  const withFields = (fields: ObjectTypeDefinition['fields']) =>
    ({ ...SCHEMA, nodes: [{ name: 'root', label: 'Produit', objectTypes: [{ ...TYPE, fields }] }] }) as unknown as ProjectSchema

  it('save refuse les erreurs, accepte les avertissements', async () => {
    const svc = new SchemaService({} as never)
    await expect(svc.save(dir, withFields([{ name: 'a', type: 'text', requiredWhen: { a: ['x'] } }]))).rejects.toBeInstanceOf(SchemaValidationError)
    await expect(svc.save(dir, withFields([{ name: 'a', type: 'text', requiredWhen: { status: ['ghost'] } }]))).resolves.toBeUndefined()
  })

  it('addField refuse aussi une valeur inconnue', async () => {
    const svc = new SchemaService({} as never)
    await svc.save(dir, SCHEMA)
    await expect(svc.addField(dir, { nodeName: 'root', typeName: 'exigence', field: { name: 'z', type: 'text', requiredWhen: { status: ['ghost'] } } }))
      .rejects.toMatchObject({ code: 'REQUIRED_WHEN_INVALID' })
    await expect(svc.addField(dir, { nodeName: 'root', typeName: 'exigence', field: { name: 'z', type: 'link', multiple: true } })).resolves.toBeTruthy()
  })
})
