import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH299 — couleur du texte et surlignage dans les richtext (specs/GH299-tests.md, E2E 1–6) :
 * application depuis la barre d'outils, écriture `<span class="pl-c-…">` / `<mark class="pl-hl-…">`,
 * aller-retour avec le gras, rendu en Vue Document, filtre sur le texte visible, HTML hors palette
 * littéral, boutons désactivés en Raw.
 */
const s = setupSession()

interface Field { name: string; type: string }
interface ObjType { name: string; label?: string; category: string; fields: Field[] }
interface Schema { nodes: Array<{ name: string; objectTypes?: ObjType[] }> }

const editor = () => s.page.locator('.ProseMirror[contenteditable="true"]').first()
const colorButton = (kind: 'text' | 'highlight') => s.page.locator(`[data-richtext-color="${kind}"]`).first()
const pick = async (kind: 'text' | 'highlight', color: string) => {
  await colorButton(kind).dispatchEvent('mousedown')
  await s.page.locator(`[data-richtext-color-menu="${kind}"] [data-color="${color}"]`).dispatchEvent('mousedown')
}

/** Brouillon du type « Exigence Produit » (non approuvé : modifiable), son premier champ richtext. */
async function createDraft(title: string, value: string): Promise<{ id: string; field: string }> {
  const repo = s.project.localPath
  const schema = await s.invoke<Schema>('schema:get', repo)
  const root = schema.nodes.find(n => n.name === 'root')!
  const type = root.objectTypes!.find(t => t.label === 'Exigence Produit') ?? root.objectTypes!.find(t => t.category === 'requirement')!
  const field = type.fields.find(f => f.type === 'richtext')!.name
  const { id } = await s.invoke<{ id: string }>('requirements:create', repo, {
    objectTypeRef: `root::${type.name}`, title, status: 'draft', fields: { [field]: value },
  })
  return { id, field }
}

const valueOf = async (id: string, field: string) =>
  String((await s.invoke<{ fields: Record<string, unknown> }>('requirements:get', s.project.localPath, id)).fields[field] ?? '')

async function openInEditView(id: string) {
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
  await s.openView('Exigences')
  // Le mode de vue est mémorisé : un test précédent a pu laisser la Vue document.
  await s.page.getByTitle('Vue tableau').click()
  await s.page.waitForLoadState('networkidle')
  await s.page.locator('main tbody tr').filter({ hasText: id }).first().locator('td').first().click()
}

test('E1/E2/E6 — couleur et surlignage depuis la barre d\'outils, aller-retour fichier', async () => {
  const { id, field } = await createDraft('GH299 couleurs', 'WHEN the pack overheats THE BMS SHALL couper la charge')
  await openInEditView(id)

  // Sélection du mot « couper » (plage DOM, reprise par ProseMirror), couleur rouge.
  await editor().click()
  await editor().evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf('couper')
      if (i >= 0) {
        const r = document.createRange()
        r.setStart(n, i); r.setEnd(n, i + 'couper'.length)
        const sel = getSelection()!; sel.removeAllRanges(); sel.addRange(r)
        return
      }
    }
  })
  await pick('text', 'red')
  await expect(editor().locator('span.pl-c-red')).toHaveText('couper')

  // Gras sur le même mot : les balises de couleur restent à l'extérieur du gras.
  await s.page.keyboard.press('Control+b')
  await pick('highlight', 'yellow')
  await expect(editor().locator('mark.pl-hl-yellow span.pl-c-red strong')).toHaveText('couper')

  // Sortie du champ → enregistrement.
  await editor().evaluate(el => (el as HTMLElement).blur())
  await expect.poll(() => valueOf(id, field))
    .toBe('WHEN the pack overheats THE BMS SHALL <mark class="pl-hl-yellow"><span class="pl-c-red">**couper**</span></mark> la charge')

  // Rechargement : la mise en forme est relue à l'identique.
  await openInEditView(id)
  await expect(editor().locator('mark.pl-hl-yellow span.pl-c-red strong')).toHaveText('couper')
  await s.shot('gh299-e1-editor')

  // « Aucun surlignage » retire la balise <mark>, la couleur reste.
  await editor().locator('strong').evaluate((el) => {
    const r = document.createRange(); r.selectNodeContents(el)
    const sel = getSelection()!; sel.removeAllRanges(); sel.addRange(r)
  })
  await pick('highlight', 'none')
  await expect(editor().locator('mark')).toHaveCount(0)
  await editor().evaluate(el => (el as HTMLElement).blur())
  await expect.poll(() => valueOf(id, field))
    .toBe('WHEN the pack overheats THE BMS SHALL <span class="pl-c-red">**couper**</span> la charge')
})

test('E3/E4/E5 — Vue Document, filtre sur le texte visible, HTML hors palette littéral', async () => {
  const { id } = await createDraft('GH299 lecture',
    'Seuil <mark class="pl-hl-green">critique</mark> et <span class="pl-c-blue">bleu</span> ; <span style="color:red">brut</span>')
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
  await s.openView('Exigences')
  await s.page.getByTitle('Vue document').click()
  await s.page.waitForLoadState('networkidle')

  const card = s.page.locator('[data-node-id]').filter({ hasText: id }).first()
  await card.scrollIntoViewIfNeeded()
  await expect(card.locator('mark.pl-hl-green')).toHaveText('critique')
  await expect(card.locator('span.pl-c-blue')).toHaveText('bleu')
  // Liste blanche : `style` n'est jamais interprété, la balise reste du texte.
  await expect(card).toContainText('<span style="color:red">brut</span>')
  await expect(card.locator('span[style]')).toHaveCount(0)
  // Le surlignage est visible (fond non transparent).
  const bg = await card.locator('mark.pl-hl-green').evaluate(el => getComputedStyle(el).backgroundColor)
  expect(bg).not.toBe('rgba(0, 0, 0, 0)')
  await s.shot('gh299-e3-document')

  // Filtre : une balise ne retient pas l'objet, le mot coloré oui.
  const filter = s.page.getByPlaceholder('Filtrer…').first()
  await filter.fill('pl-hl-green')
  await expect(s.page.locator('[data-node-id]').filter({ hasText: id })).toHaveCount(0)
  await filter.fill('critique')
  await expect(s.page.locator('[data-node-id]').filter({ hasText: id }).first()).toBeVisible()
  await filter.fill('')
})

test('E6 — boutons de couleur désactivés en mode Raw', async () => {
  const { id } = await createDraft('GH299 raw', 'texte')
  await openInEditView(id)
  await editor().click()
  await expect(colorButton('text')).toBeEnabled()
  await s.page.locator('[data-richtext-toolbar] button', { hasText: 'Raw' }).dispatchEvent('mousedown')
  await expect(colorButton('text')).toBeDisabled()
  await expect(colorButton('highlight')).toBeDisabled()
})
