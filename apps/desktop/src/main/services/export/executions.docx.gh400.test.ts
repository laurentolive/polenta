import { describe, expect, it } from 'vitest'
import { Packer } from 'docx'
import PizZip from 'pizzip'
import { buildExecutionsDocument } from './executions.docx'

// GH400 — export docx du Document de la vue Exécutions (specs/GH400-tests.md U8).

async function documentXml(payload: Parameters<typeof buildExecutionsDocument>[0]): Promise<string> {
  const buffer = await Packer.toBuffer(buildExecutionsDocument(payload))
  return new PizZip(buffer).file('word/document.xml')!.asText()
}

describe('exportExecutionsDocx', () => {
  it('une section par exécution : en-tête, champs, notes, étapes', async () => {
    const xml = await documentXml({
      title: 'Exécutions — Produit / Essai',
      labels: { notes: 'Notes', stepVerdict: 'Verdict', stepComment: 'Commentaire' },
      runs: [
        {
          heading: 'TA-1 — Démarrage', meta: 'Réussi · 01/10/2026 · alice · C1 — Campagne 1 · TA-1-1',
          fields: [{ label: 'Banc', value: 'B-42' }, { label: 'Durée', value: '' }],
          notes: 'RAS',
          steps: [{ order: 1, result: 'Réussi', comment: 'ok', fields: [{ label: 'Mesure', value: '480 ms' }] }],
        },
        { heading: 'TA-2 — Arrêt', meta: 'Échec', fields: [], notes: '' },
      ],
    })
    expect(xml).toContain('Exécutions — Produit / Essai')
    expect(xml).toContain('TA-1 — Démarrage')
    expect(xml).toContain('TA-2 — Arrêt')
    expect(xml).toContain('B-42')
    expect(xml).not.toContain('Durée')                     // champ vide : omis
    expect(xml).toContain('RAS')
    expect(xml).toContain('480 ms')
    expect((xml.match(/<w:tbl>/g) ?? []).length).toBe(1)   // étapes de TA-1 seulement
  })
})
