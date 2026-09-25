import { useEffect, useMemo, useRef } from 'react'
import MarkdownIt from 'markdown-it'
import { api } from '../api'
import { escapeXml } from './drawioRender'
import { parseDrawioFencePayload } from '../tiptap/mediaAttrs'
import { renderStaticDrawio } from './staticDrawio'
import { markdownParamRefs, type ParamRefsEnv } from './markdownParamRefs'
import { useParamRefs } from '../contexts/ParamRefContext'
import { useTranslation } from 'react-i18next'

/**
 * Read-only counterpart to RichTextField/RichTextViewer, for lists that render many objects at
 * once (WordView's document view) — a live Tiptap/ProseMirror editor per richtext field, even
 * `editable: false`, still pays the full editor-construction cost (schema, plugins, DOM
 * binding). For N items × M richtext fields that's N×M editors mounted at once, which is what
 * froze the "Exigences" tab on a project the size of PL/Product (281 items × 3 richtext fields —
 * confirmed by profiling, see the freeze investigation this component was extracted from).
 * `markdown-it` alone (also what tiptap-markdown parses with) renders the same source string to
 * plain HTML with no editor/DOM-binding cost.
 *
 * `image`/`drawio` fences are ResizableImageExtension/DrawioEmbedExtension's own markdown
 * encoding (not standard markdown) — mirrored here so those blocks don't fall through to a
 * plain, unreadable code-fence render. The `drawio` fence emits a `<span class="static-drawio">`
 * placeholder (keeping the `📐 label` as fallback); a post-render effect mounts the real
 * vendored mxGraph viewer into each placeholder, but only once it nears the viewport
 * (IntersectionObserver) — so the per-diagram canvas cost stays bounded to what's on screen,
 * not the hundreds of rows. The rendered diagram is non-interactive: a click passes through to
 * the field, which enters edit mode and mounts the full DrawioEmbedView. See lib/staticDrawio.ts.
 */

let sharedMd: MarkdownIt | null = null

function getMarkdownIt(): MarkdownIt {
  if (sharedMd) return sharedMd
  const md = new MarkdownIt({ html: false, linkify: true })
  const defaultFence = md.renderer.rules.fence?.bind(md.renderer.rules)
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const info = token.info.trim()

    if (info === 'image') {
      try {
        const parsed = JSON.parse(token.content.trim()) as {
          src?: unknown; alt?: unknown; title?: unknown; width?: unknown; height?: unknown
        }
        const src = typeof parsed.src === 'string' ? parsed.src : ''
        const attrs = [`src="${escapeXml(src)}"`, `data-static-img-src="${escapeXml(src)}"`]
        if (typeof parsed.alt === 'string' && parsed.alt) attrs.push(`alt="${escapeXml(parsed.alt)}"`)
        if (typeof parsed.title === 'string' && parsed.title) attrs.push(`title="${escapeXml(parsed.title)}"`)
        if (typeof parsed.width === 'number') attrs.push(`width="${parsed.width}"`)
        if (typeof parsed.height === 'number') attrs.push(`height="${parsed.height}"`)
        return `<img ${attrs.join(' ')}>`
      } catch {
        return ''
      }
    }

    if (info === 'drawio') {
      // Contenu non-JSON (édition manuelle du markdown) : comme l'ancien viewer
      // statique, on omet le bloc plutôt que d'émettre un placeholder qui
      // tenterait `api.drawio.read` sur du texte brut. L'éditeur (DrawioEmbed),
      // lui, reste indulgent (chemin brut).
      try {
        JSON.parse(token.content.trim())
      } catch {
        return ''
      }
      const { path, nodeId, width, height, crop } = parseDrawioFencePayload(token.content)
      const label = path.split(/[/\\]/).pop() || 'diagramme'
      // Badge de repli : affiché tel quel avant le rendu du viewer, si
      // `repoPath` est absent, en cas d'erreur, ou si le bloc n'a pas de `path`
      // (rien à rendre — on garde juste le repère visuel).
      const badge = `<span class="inline-flex items-center gap-1 text-xs text-ink-3 italic border border-edge rounded px-1.5 py-0.5">📐 ${escapeXml(label)}</span>`
      if (!path) return badge
      // Placeholder : porte le payload en data-attributs. Le viewer réel est
      // monté par renderStaticDrawio quand le bloc approche le viewport (cf.
      // useEffect plus bas).
      const attrs = [`class="static-drawio"`, `data-drawio-path="${escapeXml(path)}"`]
      if (nodeId) attrs.push(`data-drawio-node-id="${escapeXml(nodeId)}"`)
      if (width) attrs.push(`data-drawio-width="${width}"`)
      if (height) attrs.push(`data-drawio-height="${height}"`)
      if (crop) attrs.push(`data-drawio-crop="${escapeXml(JSON.stringify(crop))}"`)
      // Réserve la place connue (dims du payload) pour éviter que le document
      // ne "saute" quand le badge cède la place au diagramme au défilement.
      // Sans dims (diagramme auto) : pas de réservation possible, décalage assumé.
      const reserve: string[] = []
      if (width) reserve.push(`min-width:${width}px`)
      if (height) reserve.push(`min-height:${height}px`)
      const styleAttr = reserve.length > 0 ? ` style="${reserve.join(';')}"` : ''
      return `<span ${attrs.join(' ')}${styleAttr}>${badge}</span>`
    }

    return defaultFence ? defaultFence(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
  }
  markdownParamRefs(md)
  sharedMd = md
  return md
}

function isLiteralSrc(src: string): boolean {
  return src.startsWith('data:') || /^https?:\/\//.test(src)
}

// Conteneur défilant le plus proche (la Vue Word défile dans une div
// `overflow-auto` interne, pas le viewport) : sert de `root` à
// l'IntersectionObserver pour que la marge de préchargement soit réellement
// efficace. `null` (viewport) en repli si aucun ancêtre ne défile.
function nearestScrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const oy = getComputedStyle(node).overflowY
    if (oy === 'auto' || oy === 'scroll') return node
  }
  return null
}

const VIEWER_CLASS = 'text-sm text-ink [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:font-medium [&_h3]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-status-neutral-bg [&_code]:px-1 [&_code]:rounded [&_code]:font-mono [&_code]:text-xs [&_blockquote]:border-l-2 [&_blockquote]:border-status-neutral-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-ink-2 [&_pre]:bg-status-neutral-bg [&_pre]:p-2 [&_pre]:rounded [&_img]:max-w-full [&_img]:rounded [&_table]:border-collapse [&_table]:my-2 [&_th]:border [&_th]:border-edge [&_th]:bg-hover [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-edge [&_td]:px-2 [&_td]:py-1 [&_p]:my-1 [&_.static-drawio]:inline-block [&_.static-drawio]:my-2 [&_.static-drawio]:align-top'

// T169 — cellule de la Vue Excel : même rendu, mais une ligne de texte ≈ une ligne de cellule
// (1rem en text-xs) pour que la hauteur max « N lignes » corresponde à ~N lignes de contenu.
// Partagée avec l'éditeur (`RichTextField variant="compact"`) : même taille de texte en lecture
// et en édition dans la cellule.
export const VIEWER_CLASS_COMPACT = 'text-xs text-ink [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-status-neutral-bg [&_code]:px-1 [&_code]:rounded [&_code]:font-mono [&_blockquote]:border-l-2 [&_blockquote]:border-status-neutral-border [&_blockquote]:pl-2 [&_blockquote]:italic [&_blockquote]:text-ink-2 [&_pre]:bg-status-neutral-bg [&_pre]:px-1 [&_pre]:rounded [&_pre]:whitespace-pre-wrap [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded [&_table]:border-collapse [&_table]:my-0.5 [&_th]:border [&_th]:border-edge [&_th]:bg-hover [&_th]:px-1 [&_th]:text-left [&_td]:border [&_td]:border-edge [&_td]:px-1 [&_.static-drawio]:inline-block [&_.static-drawio]:max-w-full [&_.static-drawio]:align-top'

/**
 * T167 — retire les `<mark data-search-hl>` posés par un passage précédent et
 * refusionne les nœuds texte. Indispensable : quand seul `regex` change (frappe dans
 * le champ de recherche), `html` est identique donc React ne réinitialise PAS
 * l'innerHTML — sans ce nettoyage les surbrillances s'empileraient.
 */
function clearSearchHighlights(root: HTMLElement): void {
  const marks = root.querySelectorAll('mark[data-search-hl]')
  if (marks.length === 0) return
  for (const mark of marks) {
    mark.replaceWith(document.createTextNode(mark.textContent ?? ''))
  }
  root.normalize()
}

/**
 * T167 — surligne (`<mark>`) les occurrences de `regex` dans les nœuds texte de `root`.
 * « Best effort » : ignore le contenu des `pre`/`code`/`.static-drawio` (et des `mark`
 * déjà posés). Aucune dépendance React — opère directement sur le DOM rendu par
 * `dangerouslySetInnerHTML`.
 */
function highlightTextNodes(root: HTMLElement, regex: RegExp): void {
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g')
  const SKIP = new Set(['PRE', 'CODE', 'MARK', 'SCRIPT', 'STYLE'])
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.nodeValue
      if (!text || !text.trim()) return NodeFilter.FILTER_REJECT
      for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
        if (SKIP.has(el.tagName) || el.classList.contains('static-drawio')) return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const targets: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    re.lastIndex = 0
    if (re.test(n.nodeValue ?? '')) targets.push(n as Text)
  }
  for (const textNode of targets) {
    const text = textNode.nodeValue ?? ''
    re.lastIndex = 0
    const frag = document.createDocumentFragment()
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue }
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)))
      const mark = document.createElement('mark')
      mark.className = 'bg-status-warning-solid/70 text-inherit rounded-sm px-px not-italic'
      mark.setAttribute('data-search-hl', '')
      mark.textContent = m[0]
      frag.appendChild(mark)
      last = m.index + m[0].length
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
    textNode.parentNode?.replaceChild(frag, textNode)
  }
}

export function StaticRichTextViewer({
  value,
  repoPath,
  highlightRegex,
  variant = 'default',
}: {
  value: string
  repoPath?: string
  /** T167 — surligne les occurrences dans le rendu lecture (Vue Recherche). */
  highlightRegex?: RegExp
  /** T169 — `compact` : typographie resserrée pour une cellule de la Vue Excel (text-xs,
   *  titres ramenés au corps du texte, marges verticales quasi nulles). */
  variant?: 'default' | 'compact'
}) {
  // T171 — références de paramètres : résolues via le ParamRefProvider englobant, s'il existe.
  const paramRefs = useParamRefs()
  const { t } = useTranslation()
  const unresolvedLabel = t('parameters.unresolved')
  const html = useMemo(() => {
    if (!value) return ''
    const env: ParamRefsEnv = { paramRefs, unresolvedLabel }
    return getMarkdownIt().render(value, env)
    // `paramRefs.version` : les bases ont changé → re-rendu des valeurs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, paramRefs?.version, unresolvedLabel])
  const containerRef = useRef<HTMLDivElement>(null)

  // Repo-relative image paths (T76) can't be resolved by the browser directly (not a web URL) —
  // same async read RichTextField's live image node view uses, just applied to plain <img> tags
  // instead of a NodeView instance. Runs once per actual image present, not per row/field, so it
  // stays cheap even across hundreds of items.
  useEffect(() => {
    const container = containerRef.current
    if (!container || !repoPath) return
    const imgs = container.querySelectorAll<HTMLImageElement>('img[data-static-img-src]')
    let cancelled = false
    for (const img of imgs) {
      const src = img.getAttribute('data-static-img-src') ?? ''
      if (!src || isLiteralSrc(src)) continue
      void api.image.read(repoPath, src).then(result => {
        if (cancelled || !result) return
        img.src = `data:${result.mimeType};base64,${result.base64}`
      })
    }
    return () => { cancelled = true }
  }, [html, repoPath])

  // Diagrammes draw.io (T163) : la *fence* `drawio` a émis un placeholder
  // `<span class="static-drawio">`. On monte le viewer mxGraph réel dedans, mais
  // seulement quand le bloc approche le viewport — le coût par diagramme reste
  // borné à ce qui est à l'écran, pas aux centaines de lignes. Un diagramme
  // rendu une fois est laché (`unobserve`) : pas de re-rendu au scroll ni au
  // retour de focus fenêtre.
  useEffect(() => {
    const container = containerRef.current
    if (!container || !repoPath) return
    const placeholders = container.querySelectorAll<HTMLElement>('.static-drawio')
    if (placeholders.length === 0) return

    let disposed = false
    const teardowns: Array<() => void> = []
    const io = new IntersectionObserver(entries => {
      if (disposed) return
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const el = entry.target as HTMLElement
        io.unobserve(el)
        teardowns.push(renderStaticDrawio(el, repoPath))
      }
    }, { root: nearestScrollParent(container), rootMargin: '300px' })

    for (const el of placeholders) io.observe(el)
    return () => {
      disposed = true
      io.disconnect()
      for (const fn of teardowns) fn()
    }
  }, [html, repoPath])

  // T167 — surbrillance des occurrences (Vue Recherche). `html` change → React
  // réinitialise l'innerHTML ; `regex` seul change → il faut nettoyer nous-mêmes
  // les marques du passage précédent avant d'en reposer.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    clearSearchHighlights(container)
    if (highlightRegex) highlightTextNodes(container, highlightRegex)
  }, [html, highlightRegex])

  if (!value) return null
  return (
    <div
      ref={containerRef}
      className={variant === 'compact' ? VIEWER_CLASS_COMPACT : VIEWER_CLASS}
      dangerouslySetInnerHTML={{ __html: html }}
      // Comme un lien : un clic simple sur une référence ne remonte pas (la cellule / le champ
      // passerait en édition avant que le double-clic n'arrive).
      onClick={paramRefs ? e => {
        if ((e.target as HTMLElement).closest('[data-param-ref]')) e.stopPropagation()
      } : undefined}
      onDoubleClick={paramRefs ? e => {
        // T171 — double-clic sur une référence : édition (ou création) du paramètre.
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-param-ref]')
        if (!el?.dataset.paramRef) return
        e.preventDefault()
        e.stopPropagation()
        paramRefs.openParameter(el.dataset.paramRef)
      } : undefined}
    />
  )
}
