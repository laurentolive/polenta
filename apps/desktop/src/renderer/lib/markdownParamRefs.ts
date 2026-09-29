import type MarkdownIt from 'markdown-it'
import { paramRefRegExp } from '@polenta/types'
import type { ParamRefApi } from '../contexts/ParamRefContext'

/** `env` passé à `md.render()` pour résoudre les références (T171). Absent : texte brut. */
export interface ParamRefsEnv {
  paramRefs?: ParamRefApi | null
  /** Libellé traduit de l'infobulle d'une référence non résolue. */
  unresolvedLabel?: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Infobulle d'une référence : nom (et description), ou raison de la non-résolution. */
export function paramRefTitle(api: ParamRefApi, key: string, unresolvedLabel: string): string {
  const r = api.resolve(key)
  if (r.status === 'req') return r.title
  if (r.status === 'literal') return ''
  if (r.status === 'unresolved') return `{${key}} — ${unresolvedLabel}`
  return r.parameter.description ? `${key} — ${r.parameter.description}` : key
}

/**
 * T171 — règle markdown-it : chaque `{nom}` / `{<nœud>::nom}` d'un texte *inline* devient un
 * jeton `param_ref`, rendu en `<span class="param-ref" data-param-ref="clé">valeur</span>` (ou
 * `param-ref--unresolved` avec la référence littérale). Placée après `text_join`, elle ne voit
 * que les jetons `text` : le code inline et les blocs de code restent littéraux. Sans
 * `env.paramRefs`, le rendu est identique au texte d'origine.
 */
export function markdownParamRefs(md: MarkdownIt): void {
  md.core.ruler.after('text_join', 'param_refs', (state) => {
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children) continue
      const out: typeof block.children = []
      for (const tok of block.children) {
        if (tok.type !== 'text' || !tok.content.includes('{')) { out.push(tok); continue }
        const text = tok.content
        let last = 0
        for (const m of text.matchAll(paramRefRegExp())) {
          const idx = m.index ?? 0
          if (idx > last) {
            const t = new state.Token('text', '', 0)
            t.content = text.slice(last, idx)
            out.push(t)
          }
          const ref = new state.Token('param_ref', '', 0)
          ref.content = m[0]
          ref.meta = { key: m[1] ? `${m[1]}::${m[2]}` : m[2] }
          out.push(ref)
          last = idx + m[0].length
        }
        if (last === 0) { out.push(tok); continue }
        if (last < text.length) {
          const t = new state.Token('text', '', 0)
          t.content = text.slice(last)
          out.push(t)
        }
      }
      block.children = out
    }
  })

  md.renderer.rules.param_ref = (tokens, idx, _options, env: ParamRefsEnv) => {
    const tok = tokens[idx]
    const api = env?.paramRefs
    if (!api) return escapeHtml(tok.content)
    const key = tok.meta.key as string
    const r = api.resolve(key)
    // T179 — `{req.<champ>}` hors champ de test : texte brut.
    if (r.status === 'literal') return escapeHtml(tok.content)
    const title = escapeHtml(paramRefTitle(api, key, env.unresolvedLabel ?? ''))
    if (r.status === 'req') {
      return `<span class="param-ref param-ref--req" data-param-ref="${escapeHtml(key)}" title="${title}">${escapeHtml(tok.content)}</span>`
    }
    if (r.status === 'ok') {
      return `<span class="param-ref" data-param-ref="${escapeHtml(key)}" title="${title}">${escapeHtml(r.display)}</span>`
    }
    return `<span class="param-ref param-ref--unresolved" data-param-ref="${escapeHtml(key)}" title="${title}">${escapeHtml(tok.content)}</span>`
  }
}
