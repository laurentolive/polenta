import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { displayIdFieldError, displayIdOf, type ObjectTypeDefinition, type ProjectSchema } from '@polenta/types'
import type { AuthService } from './auth.service'
import { SchemaService } from './schema.service'

// GH229 — « ID affiché » d'un type d'objet (scénarios L1–L3 de specs/GH229-tests.md).

const TYPE: ObjectTypeDefinition = {
  name: 'exigence', category: 'requirement', prefix: 'SYS',
  fields: [
    { name: 'clientRef', type: 'text' },
    { name: 'rank', type: 'number' },
    { name: 'priority', type: 'enum', values: ['high', 'low'] },
    { name: 'statement', type: 'richtext' },
    { name: 'tags', type: 'multi_enum', values: ['a'] },
  ],
}
const withField = (displayIdField: string | undefined): ObjectTypeDefinition => ({ ...TYPE, displayIdField })

describe('displayIdOf (L1)', () => {
  const obj = { id: 'SYS-0001', title: 'Démarrage', fields: { clientRef: 'C-12', rank: 7, priority: 'high', blank: '' } }

  it('sans displayIdField : ID Polenta', () => {
    expect(displayIdOf(obj, TYPE)).toBe('SYS-0001')
    expect(displayIdOf(obj, null)).toBe('SYS-0001')
  })
  it('champ texte, nombre, enum, titre', () => {
    expect(displayIdOf(obj, withField('clientRef'))).toBe('C-12')
    expect(displayIdOf(obj, withField('rank'))).toBe('7')
    expect(displayIdOf(obj, withField('priority'))).toBe('high')
    expect(displayIdOf(obj, withField('title'))).toBe('Démarrage')
  })
  it('champ vide ou blanc : repli sur l\'ID', () => {
    expect(displayIdOf({ ...obj, fields: { clientRef: '   ' } }, withField('clientRef'))).toBe('SYS-0001')
    expect(displayIdOf({ id: 'SYS-0002', fields: {} }, withField('clientRef'))).toBe('SYS-0002')
  })
  it('displayIdField invalide (YAML édité à la main) : ID Polenta', () => {
    expect(displayIdOf({ ...obj, fields: { statement: 'x' } }, withField('statement'))).toBe('SYS-0001')
  })
})

describe('displayIdFieldError (L2)', () => {
  it('accepte title, text, number, enum', () => {
    for (const f of [undefined, 'title', 'clientRef', 'rank', 'priority']) expect(displayIdFieldError(withField(f))).toBeNull()
  })
  it('refuse un champ inconnu, richtext, multi_enum', () => {
    expect(displayIdFieldError(withField('nope'))).toMatch(/inconnu/)
    expect(displayIdFieldError(withField('statement'))).toMatch(/richtext/)
    expect(displayIdFieldError(withField('tags'))).toMatch(/multi_enum/)
  })
})

describe('SchemaService.save (L3)', () => {
  let repo: string
  const schema = (t: ObjectTypeDefinition): ProjectSchema => ({
    version: 1, nodes: [{ name: 'root', label: 'Produit', readonly: false, objectTypes: [t] }], linkTypes: [],
  })

  beforeEach(async () => { repo = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-gh229-')) })
  afterEach(async () => { await fsP.rm(repo, { recursive: true, force: true }) })

  it('refuse un displayIdField invalide sans rien écrire', async () => {
    const service = new SchemaService({} as AuthService)
    await expect(service.save(repo, schema(withField('statement')))).rejects.toMatchObject({ code: 'DISPLAY_ID_FIELD_INVALID' })
    await expect(fsP.access(path.join(repo, '.polenta', 'schema.yaml'))).rejects.toThrow()
  })

  it('un displayIdField déjà invalide sur le disque ne bloque pas les autres écritures', async () => {
    await fsP.mkdir(path.join(repo, '.polenta'), { recursive: true })
    await fsP.writeFile(path.join(repo, '.polenta', 'schema.yaml'), [
      'version: 1', 'nodes:', '  - name: root', '    objectTypes:', '      - name: exigence', '        category: requirement',
      '        prefix: SYS', '        displayIdField: statement', '        fields:', '          - name: statement', '            type: richtext', 'linkTypes: []', '',
    ].join('\n'))
    const service = new SchemaService({} as AuthService)
    const current = await service.get(repo)
    const next: ProjectSchema = { ...current, linkTypes: [{ name: 'verification', labelSourceToTarget: 'vérifie', labelTargetToSource: 'est vérifiée par' }] }
    await expect(service.save(repo, next)).resolves.toBeUndefined()
  })

  it('enregistre un displayIdField valide', async () => {
    const service = new SchemaService({} as AuthService)
    await service.save(repo, schema(withField('clientRef')))
    const text = await fsP.readFile(path.join(repo, '.polenta', 'schema.yaml'), 'utf-8')
    expect(text).toContain('displayIdField: clientRef')
  })
})
