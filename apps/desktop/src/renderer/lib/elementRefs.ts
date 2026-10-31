import type MarkdownIt from 'markdown-it'

/**
 * GH229 §2.2 — ID d'élément écrits dans le texte : une séquence `<préfixe>-<chiffres>` délimitée
 * (ni lettre, ni chiffre, ni `_` / `-` collés devant ; ni lettre, chiffre ou `_` derrière) qui est
 * l'ID exact d'un élément existant devient un lien. Le préfixe peut contenir des tirets
 * (`REQ-MC-SW-001`) : la séquence est prise en entier, jamais en partie. Le texte n'est jamais
 * modifié : le lien affiche ce qui est écrit.
 */
export function elementRefRegExp(): RegExp {
  return /(?<![\p{L}\p{N}_-])[A-Za-z][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*-\d+(?![\p{L}\p{N}_])/gu
}

export interface ElementRefMatch {
  index: number
  id: string
}

/** ID existants (`exists`) trouvés dans `text`, dans l'ordre. */
export function findElementRefs(text: string, exists: (id: string) => boolean): ElementRefMatch[] {
  if (!text || !/\d/.test(text)) return []
  const out: ElementRefMatch[] = []
  for (const m of text.matchAll(elementRefRegExp())) {
    if (exists(m[0])) out.push({ index: m.index ?? 0, id: m[0] })
  }
  return out
}

/** `env` passé à `md.render()` : sans `elementRefs`, le rendu est le texte d'origine. */
export interface ElementRefsEnv {
  elementRefs?: { exists: (id: string) => boolean } | null
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Règle markdown-it : chaque ID existant d'un jeton `text` devient
 * `<span class="element-ref" data-element-ref="ID">ID</span>`. Placée en fin de chaîne, elle ne
 * voit que les jetons `text` : code inline et blocs de code restent littéraux ; le texte d'un lien
 * Markdown (`link_open … link_close`) aussi.
 */
export function markdownElementRefs(md: MarkdownIt): void {
  md.core.ruler.push('element_refs', (state) => {
    const exists = (state.env as ElementRefsEnv | undefined)?.elementRefs?.exists
    if (!exists) return
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children) continue
      const out: typeof block.children = []
      let linkDepth = 0
      for (const tok of block.children) {
        if (tok.type === 'link_open') linkDepth++
        if (tok.type === 'link_close') linkDepth--
        if (tok.type !== 'text' || linkDepth > 0) { out.push(tok); continue }
        const refs = findElementRefs(tok.content, exists)
        if (refs.length === 0) { out.push(tok); continue }
        let last = 0
        for (const ref of refs) {
          if (ref.index > last) {
            const t = new state.Token('text', '', 0)
            t.content = tok.content.slice(last, ref.index)
            out.push(t)
          }
          const t = new state.Token('element_ref', '', 0)
          t.content = ref.id
          out.push(t)
          last = ref.index + ref.id.length
        }
        if (last < tok.content.length) {
          const t = new state.Token('text', '', 0)
          t.content = tok.content.slice(last)
          out.push(t)
        }
      }
      block.children = out
    }
  })
  md.renderer.rules.element_ref = (tokens, idx) => {
    const id = escapeHtml(tokens[idx].content)
    return `<span class="element-ref" data-element-ref="${id}">${id}</span>`
  }
}
